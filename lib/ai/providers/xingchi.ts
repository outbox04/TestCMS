import { z } from "zod";
import { createLlmProvider } from "@/lib/llm";
import { redactSecretsFromLog } from "../secret-vault";
import type {
  AiAuthType,
  AiExecuteTaskInput,
  AiExecuteTaskOutput,
  AiProviderAdapter,
  MuseCredentialPayload,
  ProviderVerificationResult,
} from "../provider-types";

/**
 * Provider dự phòng (XingchiAPI / Gemini / OpenAI / Anthropic qua createLlmProvider hiện tại).
 */
export class XingchiProvider implements AiProviderAdapter {
  public readonly id = "xingchi" as const;
  public readonly displayName = "XingchiAPI / Standard LLM Fallback Provider";

  public checkCompatibility(authType: AiAuthType): {
    supported: boolean;
    errorCode: string | null;
    reason: string;
  } {
    if (authType === "cookie") {
      return {
        supported: false,
        errorCode: "COOKIE_NOT_SUPPORTED_ON_XINGCHI",
        reason: "XingchiAPI chỉ hỗ trợ xác thực qua API Key (api_token).",
      };
    }
    return {
      supported: true,
      errorCode: null,
      reason: "Hỗ trợ xác thực qua API Key chuẩn.",
    };
  }

  public async verifyCredentials(
    payload: MuseCredentialPayload
  ): Promise<ProviderVerificationResult> {
    const startMs = Date.now();
    const compat = this.checkCompatibility(payload.auth_type);
    if (!compat.supported) {
      return {
        connected: false,
        status: "unsupported",
        latency_ms: Date.now() - startMs,
        error_code: compat.errorCode,
        error_message: compat.reason,
        verified_at: null,
      };
    }

    if (
      !payload.credential_value ||
      payload.credential_value.trim().length < 8
    ) {
      return {
        connected: false,
        status: "error",
        latency_ms: Date.now() - startMs,
        error_code: "INVALID_API_KEY",
        error_message: "API Key của XingchiAPI không hợp lệ.",
        verified_at: null,
      };
    }

    return {
      connected: true,
      status: "connected",
      latency_ms: Date.now() - startMs,
      error_code: null,
      error_message: null,
      verified_at: new Date().toISOString(),
    };
  }

  public async executeTask(
    payload: MuseCredentialPayload,
    input: AiExecuteTaskInput
  ): Promise<AiExecuteTaskOutput> {
    const startMs = Date.now();
    try {
      const llm = createLlmProvider();
      const GenericTaskSchema = z.object({
        result: z.string(),
      });

      const res = await llm.generateStructured({
        step: `xingchi_${input.task_type}`,
        articleId: input.article_id ?? null,
        schema: GenericTaskSchema,
        systemCacheablePrefix: input.system_instruction,
        prompt: `${input.prompt}\n\nTrả về JSON {"result": "..."}`,
      });

      return {
        ok: true,
        provider_used: "xingchi",
        task_type: input.task_type,
        status: "completed",
        duration_ms: Date.now() - startMs,
        output_text: res.data.result,
        structured_data: res.data,
        error_code: null,
        error_message: null,
      };
    } catch (err) {
      const rawErr = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        provider_used: "xingchi",
        task_type: input.task_type,
        status: "failed",
        duration_ms: Date.now() - startMs,
        error_code: "EXECUTION_FAILED",
        error_message: redactSecretsFromLog(rawErr, [payload.credential_value]),
      };
    }
  }
}

