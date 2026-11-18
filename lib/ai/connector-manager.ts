import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  AiAuthType,
  AiProviderConnectionRow,
  AiProviderLogRow,
  UserRole,
} from "@/lib/supabase/types";
import { MuseAiProvider } from "./providers/muse";
import {
  checkAuthRateLimit,
  decryptCredentialPayload,
  encryptCredentialPayload,
  redactSecretsFromLog,
} from "./secret-vault";
import type {
  MuseCredentialPayload,
  SafeProviderConnectionStatus,
} from "./provider-types";

const museAdapter = new MuseAiProvider();

export class ConnectorAuthorizationError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number = 403) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function assertAdminRole(role?: UserRole | string | null): void {
  if (role !== "admin") {
    throw new ConnectorAuthorizationError(
      "FORBIDDEN_NOT_ADMIN",
      "Chỉ quản trị viên (Admin) mới có quyền cấu hình, cập nhật hoặc ngắt kết nối Muse AI dùng chung.",
      403
    );
  }
}

export function assertStaffCanUseAi(role?: UserRole | string | null): void {
  if (role !== "admin" && role !== "editor") {
    throw new ConnectorAuthorizationError(
      "UNAUTHORIZED_STAFF",
      "Bạn không có quyền sử dụng tài khoản AI của hệ thống.",
      403
    );
  }
}

function toSafeStatus(
  row: AiProviderConnectionRow | null
): SafeProviderConnectionStatus {
  const authType: AiAuthType = row?.auth_type ?? "api_token";
  const officialApiConfigured = Boolean(museAdapter.getConfiguredBaseUrl());
  const cookieAllowed = museAdapter.isCookieAuthAllowedByPolicy();
  const compat = museAdapter.checkCompatibility(authType);

  return {
    provider: "muse",
    provider_name: "Muse AI",
    scope: "global",
    auth_type: authType,
    status: row?.status ?? "disconnected",
    has_saved_credentials: Boolean(row?.encrypted_credentials),
    compatibility: {
      official_api_configured: officialApiConfigured,
      cookie_auth_allowed_by_policy: cookieAllowed,
      recommended_method: "oauth_or_api_token",
      notice: compat.reason,
    },
    error_code: row?.error_code ?? null,
    error_message: row?.error_message
      ? redactSecretsFromLog(row.error_message)
      : null,
    last_verified_at: row?.last_verified_at ?? null,
    last_used_at: row?.last_used_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

export async function recordProviderLog(params: {
  provider: string;
  taskType: string;
  userId?: string | null;
  status: "pending" | "running" | "completed" | "failed";
  durationMs: number;
  errorCode?: string | null;
}): Promise<void> {
  const admin = createAdminSupabaseClient();
  await admin.from("ai_provider_logs").insert({
    provider: params.provider,
    task_type: params.taskType,
    user_id: params.userId ?? null,
    status: params.status,
    duration_ms: Math.max(0, Math.round(params.durationMs)),
    error_code: params.errorCode
      ? redactSecretsFromLog(params.errorCode)
      : null,
  });
}

export async function getMuseConnectionRowInternal(): Promise<AiProviderConnectionRow | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("ai_provider_connections")
    .select("*")
    .eq("provider", "muse")
    .eq("scope", "global")
    .maybeSingle();

  return (data as AiProviderConnectionRow | null) ?? null;
}

/**
 * Đọc trạng thái kết nối Muse AI an toàn (Tuyệt đối không lộ encrypted_credentials hay cookie/token).
 */
export async function getMuseConnectionStatus(): Promise<SafeProviderConnectionStatus> {
  const row = await getMuseConnectionRowInternal();
  return toSafeStatus(row);
}

export async function getMuseProviderLogs(
  limit: number = 25
): Promise<AiProviderLogRow[]> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("ai_provider_logs")
    .select("*")
    .eq("provider", "muse")
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as AiProviderLogRow[]).map((r) => ({
    ...r,
    error_code: r.error_code ? redactSecretsFromLog(r.error_code) : null,
  }));
}

export interface ConnectOrUpdateMuseInput {
  actorId: string;
  actorRole: UserRole | string | null;
  authType: AiAuthType;
  credentialValue: string;
  endpointUrl?: string | null;
  accountLabel?: string | null;
  customFetch?: typeof fetch;
}

/**
 * Lưu mới hoặc cập nhật thông tin xác thực Muse AI (mã hóa AES-256-GCM) và kiểm tra kết nối thực tế.
 * Không bao giờ đánh dấu Connected nếu xác minh chưa thành công.
 */
export async function connectOrUpdateMuseCredentials(
  input: ConnectOrUpdateMuseInput,
  mode: "connect" | "update" = "connect"
): Promise<SafeProviderConnectionStatus> {
  assertAdminRole(input.actorRole);

  const rateCheck = checkAuthRateLimit(`muse_auth_${input.actorId}`);
  if (!rateCheck.allowed) {
    throw new ConnectorAuthorizationError(
      "RATE_LIMITED",
      `Quá nhiều lần thử xác thực. Vui lòng thử lại sau ${rateCheck.retryAfterSeconds} giây.`,
      429
    );
  }

  const trimmedSecret = input.credentialValue?.trim() ?? "";
  if (!trimmedSecret) {
    throw new ConnectorAuthorizationError(
      "EMPTY_CREDENTIALS",
      "Vui lòng nhập thông tin xác thực (API Token / OAuth hoặc Cookie được hỗ trợ).",
      400
    );
  }

  const payload: MuseCredentialPayload = {
    auth_type: input.authType,
    credential_value: trimmedSecret,
    endpoint_url: input.endpointUrl?.trim() || null,
    account_label: input.accountLabel?.trim() || "Muse AI Global Account",
    rotated_at: new Date().toISOString(),
  };

  const encrypted = encryptCredentialPayload(payload);
  const verifyRes = await museAdapter.verifyCredentials(payload, {
    customFetch: input.customFetch,
  });

  const admin = createAdminSupabaseClient();
  const existing = await getMuseConnectionRowInternal();

  const cleanErrorMsg = verifyRes.error_message
    ? redactSecretsFromLog(verifyRes.error_message, [trimmedSecret])
    : null;

  const upsertData = {
    provider: "muse" as const,
    scope: "global" as const,
    auth_type: input.authType,
    encrypted_credentials: encrypted,
    status: verifyRes.status,
    error_code: verifyRes.error_code,
    error_message: cleanErrorMsg,
    last_verified_at: verifyRes.verified_at ?? existing?.last_verified_at ?? null,
    last_used_at: existing?.last_used_at ?? null,
    created_by: existing?.created_by ?? input.actorId,
    updated_by: input.actorId,
  };

  const { data: savedRow, error: saveErr } = await admin
    .from("ai_provider_connections")
    .upsert(upsertData, { onConflict: "provider,scope" })
    .select("*")
    .single();

  if (saveErr) {
    throw new Error(
      `Không thể lưu kết nối Muse AI: ${redactSecretsFromLog(saveErr.message, [trimmedSecret])}`
    );
  }

  await recordProviderLog({
    provider: "muse",
    taskType: mode === "connect" ? "auth_connect" : "auth_update_credentials",
    userId: input.actorId,
    status: verifyRes.connected ? "completed" : "failed",
    durationMs: verifyRes.latency_ms,
    errorCode: verifyRes.error_code,
  });

  return toSafeStatus(savedRow as AiProviderConnectionRow);
}

/**
 * Kiểm tra lại trạng thái kết nối của thông tin xác thực Muse AI đang lưu trong Vault AES-256-GCM.
 */
export async function verifyStoredMuseConnection(params: {
  actorId: string;
  actorRole: UserRole | string | null;
  customFetch?: typeof fetch;
}): Promise<SafeProviderConnectionStatus> {
  assertAdminRole(params.actorRole);

  const rateCheck = checkAuthRateLimit(`muse_verify_${params.actorId}`);
  if (!rateCheck.allowed) {
    throw new ConnectorAuthorizationError(
      "RATE_LIMITED",
      `Quá nhiều yêu cầu kiểm tra kết nối. Thử lại sau ${rateCheck.retryAfterSeconds} giây.`,
      429
    );
  }

  const existing = await getMuseConnectionRowInternal();
  if (!existing || !existing.encrypted_credentials) {
    throw new ConnectorAuthorizationError(
      "NO_STORED_CREDENTIALS",
      "Chưa có thông tin xác thực Muse AI nào được lưu để kiểm tra.",
      400
    );
  }

  let decrypted: MuseCredentialPayload;
  try {
    decrypted = decryptCredentialPayload(existing.encrypted_credentials);
  } catch {
    throw new ConnectorAuthorizationError(
      "DECRYPTION_FAILED",
      "Không thể giải mã thông tin xác thực đã lưu (khóa mã hóa thay đổi hoặc dữ liệu hỏng).",
      500
    );
  }

  const verifyRes = await museAdapter.verifyCredentials(decrypted, {
    customFetch: params.customFetch,
  });

  const admin = createAdminSupabaseClient();
  const { data: updatedRow } = await admin
    .from("ai_provider_connections")
    .update({
      status: verifyRes.status,
      error_code: verifyRes.error_code,
      error_message: verifyRes.error_message
        ? redactSecretsFromLog(verifyRes.error_message, [
            decrypted.credential_value,
          ])
        : null,
      last_verified_at:
        verifyRes.verified_at ?? existing.last_verified_at ?? null,
      updated_by: params.actorId,
    })
    .eq("provider", "muse")
    .eq("scope", "global")
    .select("*")
    .single();

  await recordProviderLog({
    provider: "muse",
    taskType: "auth_verify",
    userId: params.actorId,
    status: verifyRes.connected ? "completed" : "failed",
    durationMs: verifyRes.latency_ms,
    errorCode: verifyRes.error_code,
  });

  return toSafeStatus((updatedRow as AiProviderConnectionRow) ?? existing);
}

/**
 * Thu hồi và xóa hoàn toàn thông tin xác thực Muse AI khỏi cơ sở dữ liệu.
 */
export async function disconnectMuseProvider(params: {
  actorId: string;
  actorRole: UserRole | string | null;
}): Promise<SafeProviderConnectionStatus> {
  assertAdminRole(params.actorRole);

  const startMs = Date.now();
  const admin = createAdminSupabaseClient();

  const { data: updatedRow } = await admin
    .from("ai_provider_connections")
    .upsert(
      {
        provider: "muse",
        scope: "global",
        auth_type: "api_token",
        encrypted_credentials: null,
        status: "disconnected",
        error_code: null,
        error_message: null,
        updated_by: params.actorId,
      },
      { onConflict: "provider,scope" }
    )
    .select("*")
    .single();

  await recordProviderLog({
    provider: "muse",
    taskType: "auth_disconnect",
    userId: params.actorId,
    status: "completed",
    durationMs: Date.now() - startMs,
    errorCode: null,
  });

  return toSafeStatus((updatedRow as AiProviderConnectionRow) ?? null);
}

