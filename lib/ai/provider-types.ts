import type {
  AiAuthType,
  AiConnectionStatus,
  AiProviderId,
  AiProviderLogRow,
  AiProviderTaskStatus,
} from "@/lib/supabase/types";

export type {
  AiAuthType,
  AiConnectionStatus,
  AiProviderId,
  AiProviderLogRow,
  AiProviderTaskStatus,
};

export interface MuseCredentialPayload {
  auth_type: AiAuthType;
  credential_value: string;
  endpoint_url?: string | null;
  account_label?: string | null;
  rotated_at: string;
}

/**
 * Trạng thái kết nối an toàn trả về cho giao diện Admin / API Status.
 * TUYỆT ĐỐI KHÔNG chứa cookie, token hay encrypted_credentials.
 */
export interface SafeProviderConnectionStatus {
  provider: AiProviderId;
  provider_name: string;
  scope: "global";
  auth_type: AiAuthType;
  status: AiConnectionStatus;
  has_saved_credentials: boolean;
  compatibility: {
    official_api_configured: boolean;
    cookie_auth_allowed_by_policy: boolean;
    recommended_method: "oauth_or_api_token" | "cookie";
    notice: string;
  };
  error_code: string | null;
  error_message: string | null;
  last_verified_at: string | null;
  last_used_at: string | null;
  updated_at: string | null;
}

export interface ProviderVerificationResult {
  connected: boolean;
  status: AiConnectionStatus;
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  verified_at: string | null;
}

export interface AiExecuteTaskInput {
  task_type:
    | "research"
    | "plan_outline"
    | "write_article"
    | "seo_geo_aeo_optimize"
    | "fact_check"
    | "custom_prompt";
  prompt: string;
  system_instruction?: string;
  article_id?: string | null;
  timeout_ms?: number;
  idempotency_key?: string;
  allow_fallback_before_start?: boolean;
}

export interface AiExecuteTaskOutput {
  ok: boolean;
  provider_used: AiProviderId;
  task_type: string;
  status: AiProviderTaskStatus;
  duration_ms: number;
  output_text?: string;
  structured_data?: unknown;
  error_code?: string | null;
  error_message?: string | null;
}

export interface AiProviderAdapter {
  readonly id: AiProviderId;
  readonly displayName: string;
  checkCompatibility(authType: AiAuthType): {
    supported: boolean;
    errorCode: string | null;
    reason: string;
  };
  verifyCredentials(
    payload: MuseCredentialPayload,
    options?: { timeoutMs?: number; customFetch?: typeof fetch }
  ): Promise<ProviderVerificationResult>;
  executeTask(
    payload: MuseCredentialPayload,
    input: AiExecuteTaskInput,
    options?: { customFetch?: typeof fetch }
  ): Promise<AiExecuteTaskOutput>;
}

