import { redactSecretsFromLog } from "../secret-vault";
import type {
  AiAuthType,
  AiExecuteTaskInput,
  AiExecuteTaskOutput,
  AiProviderAdapter,
  MuseCredentialPayload,
  ProviderVerificationResult,
} from "../provider-types";

const DEFAULT_MUSE_TIMEOUT_MS = 10_000;

export class MuseAiProvider implements AiProviderAdapter {
  public readonly id = "muse" as const;
  public readonly displayName = "Muse AI (Global Shared Account)";

  public getConfiguredBaseUrl(overrideUrl?: string | null): string | null {
    const raw =
      overrideUrl?.trim() || process.env.MUSE_AI_API_BASE_URL?.trim() || "";
    if (!raw) return null;
    if (!raw.startsWith("https://") && !raw.startsWith("http://localhost")) {
      return null;
    }
    return raw.replace(/\/+$/, "");
  }

  public isCookieAuthAllowedByPolicy(): boolean {
    return (
      (process.env.MUSE_AI_ALLOW_COOKIE_AUTH ?? "").trim().toLowerCase() ===
      "true"
    );
  }

  /**
   * Kiểm tra tính tương thích & chính sách trước khi kích hoạt kết nối Muse AI.
   * Không tự suy đoán API nội bộ; nếu chưa cấu hình endpoint chính thức hoặc cookie bị tắt theo chính sách,
   * trả về supported=false và hướng dẫn dùng OAuth/API chính thức.
   */
  public checkCompatibility(
    authType: AiAuthType,
    overrideBaseUrl?: string | null
  ): {
    supported: boolean;
    errorCode: string | null;
    reason: string;
  } {
    const baseUrl = this.getConfiguredBaseUrl(overrideBaseUrl);

    if (authType === "cookie" && !this.isCookieAuthAllowedByPolicy()) {
      return {
        supported: false,
        errorCode: "COOKIE_AUTH_NOT_SUPPORTED_BY_POLICY",
        reason:
          "Xác thực bằng Cookie hiện đang bị khóa theo chính sách bảo mật (MUSE_AI_ALLOW_COOKIE_AUTH chưa bật). Vui lòng ưu tiên sử dụng API Token / OAuth chính thức của Muse AI, hoặc cấu hình MUSE_AI_ALLOW_COOKIE_AUTH=true kèm MUSE_AI_API_BASE_URL nếu điều khoản Muse AI cho phép.",
      };
    }

    if (!baseUrl) {
      return {
        supported: false,
        errorCode: "OFFICIAL_ENDPOINT_NOT_CONFIGURED",
        reason:
          "Chưa cấu hình biến môi trường MUSE_AI_API_BASE_URL cho cổng kết nối chính thức của Muse AI. Hệ thống từ chối tự suy đoán endpoint nội bộ và không đánh dấu Connected giả.",
      };
    }

    return {
      supported: true,
      errorCode: null,
      reason: "Cấu hình cổng kết nối Muse AI hợp lệ.",
    };
  }

  private validateCredentialFormat(payload: MuseCredentialPayload): {
    valid: boolean;
    errorCode?: string;
    message?: string;
  } {
    const raw = payload.credential_value?.trim() ?? "";
    if (!raw || raw.length < 10) {
      return {
        valid: false,
        errorCode: "INVALID_CREDENTIAL_FORMAT",
        message:
          "Thông tin xác thực Muse AI không hợp lệ (rỗng hoặc quá ngắn < 10 ký tự).",
      };
    }

    if (payload.auth_type === "cookie") {
      // Cookie hợp lệ phải có dạng key=value hoặc token phiên hợp lệ, không chứa ký tự xuống dòng tiêm header
      if (/[\r\n]/.test(raw) || !raw.includes("=")) {
        return {
          valid: false,
          errorCode: "INVALID_COOKIE_FORMAT",
          message:
            "Định dạng Cookie không hợp lệ (phải có cấu trúc key=value và không chứa ký tự xuống dòng).",
        };
      }
    } else {
      if (/[\r\n\s]/.test(raw)) {
        return {
          valid: false,
          errorCode: "INVALID_TOKEN_FORMAT",
          message:
            "API Token / OAuth Token không được chứa khoảng trắng hoặc ký tự xuống dòng.",
        };
      }
    }

    return { valid: true };
  }

  private buildAuthHeaders(
    payload: MuseCredentialPayload
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (payload.auth_type === "cookie") {
      headers["Cookie"] = payload.credential_value.trim();
    } else {
      headers["Authorization"] = `Bearer ${payload.credential_value.trim()}`;
    }

    return headers;
  }

  public async verifyCredentials(
    payload: MuseCredentialPayload,
    options?: { timeoutMs?: number; customFetch?: typeof fetch }
  ): Promise<ProviderVerificationResult> {
    const startMs = Date.now();
    const formatCheck = this.validateCredentialFormat(payload);
    if (!formatCheck.valid) {
      return {
        connected: false,
        status: "error",
        latency_ms: Date.now() - startMs,
        error_code: formatCheck.errorCode ?? "INVALID_CREDENTIALS",
        error_message: formatCheck.message ?? "Thông tin xác thực không hợp lệ.",
        verified_at: null,
      };
    }

    const compat = this.checkCompatibility(
      payload.auth_type,
      payload.endpoint_url
    );
    if (!compat.supported) {
      return {
        connected: false,
        status: "unsupported",
        latency_ms: Date.now() - startMs,
        error_code: compat.errorCode ?? "UNSUPPORTED_INTEGRATION",
        error_message: compat.reason,
        verified_at: null,
      };
    }

    const baseUrl = this.getConfiguredBaseUrl(payload.endpoint_url)!;
    const fetchFn = options?.customFetch ?? fetch;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_MUSE_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(`${baseUrl}/v1/session/verify`, {
        method: "GET",
        headers: this.buildAuthHeaders(payload),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startMs;

      if (response.status === 401 || response.status === 403) {
        let bodyText = "";
        try {
          bodyText = await response.text();
        } catch {
          bodyText = "";
        }
        const isExpired =
          bodyText.toLowerCase().includes("expired") ||
          response.headers.get("x-session-expired") === "true";

        return {
          connected: false,
          status: isExpired ? "expired" : "error",
          latency_ms: latencyMs,
          error_code: isExpired ? "SESSION_EXPIRED" : "INVALID_CREDENTIALS",
          error_message: isExpired
            ? "Phiên đăng nhập / Token Muse AI đã hết hạn. Vui lòng cập nhật thông tin xác thực mới."
            : "Thông tin xác thực Muse AI bị từ chối (401/403 Unauthorized).",
          verified_at: null,
        };
      }

      if (!response.ok) {
        return {
          connected: false,
          status: "error",
          latency_ms: latencyMs,
          error_code: `HTTP_${response.status}`,
          error_message: `Máy chủ Muse AI phản hồi mã lỗi HTTP ${response.status}.`,
          verified_at: null,
        };
      }

      return {
        connected: true,
        status: "connected",
        latency_ms: latencyMs,
        error_code: null,
        error_message: null,
        verified_at: new Date().toISOString(),
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      const rawErr = err instanceof Error ? err.message : String(err);
      const isTimeout =
        rawErr.toLowerCase().includes("abort") ||
        rawErr.toLowerCase().includes("timeout");

      return {
        connected: false,
        status: "error",
        latency_ms: latencyMs,
        error_code: isTimeout ? "PROVIDER_TIMEOUT" : "NETWORK_ERROR",
        error_message: isTimeout
          ? `Quá thời gian chờ (${timeoutMs}ms) khi kết nối tới Muse AI.`
          : redactSecretsFromLog(
              `Không thể kết nối tới Muse AI: ${rawErr}`,
              [payload.credential_value]
            ),
        verified_at: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async executeTask(
    payload: MuseCredentialPayload,
    input: AiExecuteTaskInput,
    options?: { customFetch?: typeof fetch }
  ): Promise<AiExecuteTaskOutput> {
    const startMs = Date.now();
    const compat = this.checkCompatibility(
      payload.auth_type,
      payload.endpoint_url
    );
    if (!compat.supported) {
      return {
        ok: false,
        provider_used: "muse",
        task_type: input.task_type,
        status: "failed",
        duration_ms: Date.now() - startMs,
        error_code: compat.errorCode ?? "UNSUPPORTED_INTEGRATION",
        error_message: compat.reason,
      };
    }

    const baseUrl = this.getConfiguredBaseUrl(payload.endpoint_url)!;
    const fetchFn = options?.customFetch ?? fetch;
    const timeoutMs = input.timeout_ms ?? DEFAULT_MUSE_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(`${baseUrl}/v1/completions`, {
        method: "POST",
        headers: this.buildAuthHeaders(payload),
        body: JSON.stringify({
          task_type: input.task_type,
          system_instruction: input.system_instruction ?? "",
          prompt: input.prompt,
          article_id: input.article_id ?? null,
        }),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startMs;

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          provider_used: "muse",
          task_type: input.task_type,
          status: "failed",
          duration_ms: durationMs,
          error_code: "SESSION_EXPIRED",
          error_message:
            "Phiên xác thực Muse AI đã hết hạn hoặc không hợp lệ khi thực thi tác vụ.",
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          provider_used: "muse",
          task_type: input.task_type,
          status: "failed",
          duration_ms: durationMs,
          error_code: `HTTP_${response.status}`,
          error_message: `Muse AI trả về lỗi HTTP ${response.status}.`,
        };
      }

      const data = (await response.json()) as {
        output_text?: string;
        structured_data?: unknown;
      };

      return {
        ok: true,
        provider_used: "muse",
        task_type: input.task_type,
        status: "completed",
        duration_ms: durationMs,
        output_text: data.output_text ?? JSON.stringify(data),
        structured_data: data.structured_data ?? data,
        error_code: null,
        error_message: null,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const rawErr = err instanceof Error ? err.message : String(err);
      const isTimeout =
        rawErr.toLowerCase().includes("abort") ||
        rawErr.toLowerCase().includes("timeout");

      return {
        ok: false,
        provider_used: "muse",
        task_type: input.task_type,
        status: "failed",
        duration_ms: durationMs,
        error_code: isTimeout ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
        error_message: redactSecretsFromLog(rawErr, [payload.credential_value]),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

