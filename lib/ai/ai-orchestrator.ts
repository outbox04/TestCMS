import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/supabase/types";
import {
  ConnectorAuthorizationError,
  assertStaffCanUseAi,
  getMuseConnectionRowInternal,
  recordProviderLog,
} from "./connector-manager";
import { MuseAiProvider } from "./providers/muse";
import { XingchiProvider } from "./providers/xingchi";
import { decryptCredentialPayload, redactSecretsFromLog } from "./secret-vault";
import type {
  AiExecuteTaskInput,
  AiExecuteTaskOutput,
  MuseCredentialPayload,
} from "./provider-types";

const museAdapter = new MuseAiProvider();
const xingchiAdapter = new XingchiProvider();

// Theo dõi các tác vụ đang thực thi theo idempotency_key để chống tạo tác vụ trùng lặp
// và khóa cứng không tự động đổi Provider khi tác vụ đang chạy dở.
const activeTasksByIdempotencyKey = new Map<
  string,
  { provider: "muse" | "xingchi"; startedAt: number }
>();

export interface ExecuteSharedAiTaskParams {
  actorId: string;
  actorRole: UserRole | string | null;
  task: AiExecuteTaskInput;
  customFetch?: typeof fetch;
}

/**
 * Thực thi tác vụ AI qua tài khoản Muse AI dùng chung toàn hệ thống (Global Shared Account).
 * - Mọi nhân viên có quyền ('admin' | 'editor') đều dùng chung kết nối global.
 * - Không bao giờ trả về cookie/token trong kết quả.
 * - Không tự động chuyển Provider khi tác vụ đang thực hiện dở.
 */
export async function executeSharedAiTask(
  params: ExecuteSharedAiTaskParams
): Promise<AiExecuteTaskOutput> {
  assertStaffCanUseAi(params.actorRole);

  const startMs = Date.now();
  const idemKey = params.task.idempotency_key?.trim();

  if (idemKey && activeTasksByIdempotencyKey.has(idemKey)) {
    throw new ConnectorAuthorizationError(
      "CONCURRENT_DUPLICATE_TASK",
      `Tác vụ với idempotency_key "${idemKey}" đang được thực thi. Chặn gọi trùng lặp.`,
      409
    );
  }

  // Đặt khóa đồng bộ ngay trước khi await bất kỳ I/O nào để chống race-condition giữa 2 request đồng thời
  if (idemKey) {
    activeTasksByIdempotencyKey.set(idemKey, {
      provider: "muse",
      startedAt: startMs,
    });
  }

  try {
    const museRow = await getMuseConnectionRowInternal();

    // Nếu Muse AI chưa kết nối hoặc không ở trạng thái 'connected':
    // Chỉ cho phép chuyển sang Provider dự phòng (Xingchi) TRƯỚC KHI bắt đầu tác vụ
    // khi có cả allow_fallback_before_start=true VÀ idempotency_key hợp lệ.
    if (
      !museRow ||
      museRow.status !== "connected" ||
      !museRow.encrypted_credentials
    ) {
      if (params.task.allow_fallback_before_start && idemKey) {
        activeTasksByIdempotencyKey.set(idemKey, {
          provider: "xingchi",
          startedAt: startMs,
        });

        const fallbackPayload: MuseCredentialPayload = {
          auth_type: "api_token",
          credential_value: "FALLBACK_PROVIDER_KEY",
          rotated_at: new Date().toISOString(),
        };
        const fbRes = await xingchiAdapter.executeTask(
          fallbackPayload,
          params.task
        );
        await recordProviderLog({
          provider: "xingchi",
          taskType: params.task.task_type,
          userId: params.actorId,
          status: fbRes.ok ? "completed" : "failed",
          durationMs: fbRes.duration_ms,
          errorCode: fbRes.error_code ?? null,
        });
        return fbRes;
      }

      const reasonCode =
        museRow?.status === "expired"
          ? "MUSE_SESSION_EXPIRED"
          : museRow?.status === "unsupported"
            ? "MUSE_UNSUPPORTED_METHOD"
            : "MUSE_NOT_CONNECTED";

      await recordProviderLog({
        provider: "muse",
        taskType: params.task.task_type,
        userId: params.actorId,
        status: "failed",
        durationMs: Date.now() - startMs,
        errorCode: reasonCode,
      });

      return {
        ok: false,
        provider_used: "muse",
        task_type: params.task.task_type,
        status: "failed",
        duration_ms: Date.now() - startMs,
        error_code: reasonCode,
        error_message:
          museRow?.status === "expired"
            ? "Phiên kết nối Muse AI dùng chung đã hết hạn. Vui lòng báo Admin cập nhật thông tin xác thực."
            : "Tài khoản Muse AI dùng chung chưa được kết nối hoặc chưa xác minh thành công.",
      };
    }

    let decrypted: MuseCredentialPayload;
    try {
      decrypted = decryptCredentialPayload(museRow.encrypted_credentials);
    } catch {
      await recordProviderLog({
        provider: "muse",
        taskType: params.task.task_type,
        userId: params.actorId,
        status: "failed",
        durationMs: Date.now() - startMs,
        errorCode: "DECRYPTION_FAILED",
      });
      return {
        ok: false,
        provider_used: "muse",
        task_type: params.task.task_type,
        status: "failed",
        duration_ms: Date.now() - startMs,
        error_code: "DECRYPTION_FAILED",
        error_message: "Không thể giải mã thông tin xác thực Muse AI.",
      };
    }

    // Thực thi trên Muse AI (KHÔNG tự động failover sang provider khác khi đang chạy dở để tránh tạo tác vụ trùng lặp)
    const result = await museAdapter.executeTask(decrypted, params.task, {
      customFetch: params.customFetch,
    });

    const admin = createAdminSupabaseClient();
    const nowIso = new Date().toISOString();

    if (result.error_code === "SESSION_EXPIRED") {
      await admin
        .from("ai_provider_connections")
        .update({
          status: "expired",
          error_code: "SESSION_EXPIRED",
          error_message:
            "Phiên đăng nhập Muse AI đã hết hạn trong quá trình sử dụng.",
          last_used_at: nowIso,
        })
        .eq("provider", "muse")
        .eq("scope", "global");
    } else if (result.ok) {
      await admin
        .from("ai_provider_connections")
        .update({
          last_used_at: nowIso,
        })
        .eq("provider", "muse")
        .eq("scope", "global");
    }

    await recordProviderLog({
      provider: "muse",
      taskType: params.task.task_type,
      userId: params.actorId,
      status: result.ok ? "completed" : "failed",
      durationMs: result.duration_ms,
      errorCode: result.error_code ?? null,
    });

    // Đảm bảo tuyệt đối không rò rỉ secret trong output_text hay error_message
    return {
      ...result,
      output_text: result.output_text
        ? redactSecretsFromLog(result.output_text, [decrypted.credential_value])
        : undefined,
      error_message: result.error_message
        ? redactSecretsFromLog(result.error_message, [
            decrypted.credential_value,
          ])
        : null,
    };
  } finally {
    if (idemKey) {
      activeTasksByIdempotencyKey.delete(idemKey);
    }
  }
}
