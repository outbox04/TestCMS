"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { z } from "zod";
import { createLlmProvider } from "@/lib/llm";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImageAnalysisSchema } from "@/lib/supabase/types";

async function requireAdminUser(): Promise<{ id: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Chưa đăng nhập");
  }
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    throw new Error("Chỉ admin mới có quyền thực hiện thao tác này");
  }
  return { id: user.id };
}

function normalizeModelsForProvider(
  provider: "gemini" | "anthropic" | "openai",
  writerInput: string,
  visionInput: string
): { modelWriter: string; modelVision: string } {
  let modelWriter = writerInput.trim();
  let modelVision = visionInput.trim();

  if (provider === "gemini") {
    if (
      !modelWriter ||
      modelWriter.startsWith("gpt-") ||
      modelWriter.startsWith("claude-")
    ) {
      modelWriter = "gemini-2.5-flash";
    }
    if (
      !modelVision ||
      modelVision.startsWith("gpt-") ||
      modelVision.startsWith("claude-")
    ) {
      modelVision = "gemini-2.5-flash";
    }
  } else if (provider === "openai") {
    if (
      !modelWriter ||
      modelWriter.startsWith("claude-") ||
      modelWriter.startsWith("gemini-")
    ) {
      modelWriter = "gpt-4o";
    }
    if (
      !modelVision ||
      modelVision.startsWith("claude-") ||
      modelVision.startsWith("gemini-")
    ) {
      modelVision = "gpt-4o-mini";
    }
  } else if (provider === "anthropic") {
    if (
      !modelWriter ||
      modelWriter.startsWith("gpt-") ||
      modelWriter.startsWith("gemini-")
    ) {
      modelWriter = "claude-sonnet-4-20250514";
    }
    if (
      !modelVision ||
      modelVision.startsWith("gpt-") ||
      modelVision.startsWith("gemini-")
    ) {
      modelVision = "claude-3-5-haiku-latest";
    }
  }

  return { modelWriter, modelVision };
}

function validateApiKeyFormatForProvider(
  provider: "gemini" | "anthropic" | "openai",
  apiKey: string
): void {
  if (apiKey === "LOCAL_DEMO_MODE_KEY") return;

  if (provider === "gemini") {
    if (apiKey.startsWith("sk-")) {
      throw new Error(
        "API Key vừa nhập bắt đầu bằng 'sk-...' (của OpenAI/Anthropic), không phải Google Gemini API Key. Với Gemini, vui lòng dùng key bắt đầu bằng 'AQ....' hoặc 'AIza...'."
      );
    }
    const isGeminiKey =
      /^AIza/i.test(apiKey) || /^AQ\./i.test(apiKey) || apiKey.length >= 25;
    if (!isGeminiKey || apiKey.length < 20) {
      throw new Error(
        "Định dạng Google Gemini API Key không chuẩn (phải bắt đầu bằng 'AQ....' hoặc 'AIza...' và dài tối thiểu 20 ký tự)."
      );
    }
  } else if (provider === "anthropic") {
    if (/^(AIza|AQ\.)/i.test(apiKey)) {
      throw new Error(
        "API Key bắt đầu bằng 'AQ....' hoặc 'AIza...' là của Google Gemini. Vui lòng chuyển Nhà cung cấp AI sang 'Google Gemini' hoặc nhập key 'sk-ant-...' cho Anthropic."
      );
    }
  } else if (provider === "openai") {
    if (/^(AIza|AQ\.)/i.test(apiKey)) {
      throw new Error(
        "API Key bắt đầu bằng 'AQ....' hoặc 'AIza...' là của Google Gemini. Vui lòng chuyển Nhà cung cấp AI sang 'Google Gemini' hoặc nhập key 'sk-...' cho OpenAI."
      );
    }
  }
}

/**
 * Kiểm tra chuẩn cả 2 chiều:
 * (1) Sinh JSON có cấu trúc bằng model_writer
 * (2) Đọc và phân tích hình ảnh thực tế bằng model_vision (Gemini Vision / Claude Vision / GPT Vision)
 * Tuyệt đối không báo thành công giả nếu đang ở chế độ LOCAL_DEMO_MODE_KEY.
 */
async function verifyRealAiTextAndVisionConnection(): Promise<string> {
  const adminClient = createAdminSupabaseClient();
  const { data: currentKey } = await adminClient.rpc("get_ai_api_key");

  if (
    !currentKey ||
    typeof currentKey !== "string" ||
    !currentKey.trim() ||
    currentKey.trim() === "LOCAL_DEMO_MODE_KEY"
  ) {
    throw new Error(
      "Chưa tích hợp API Key thật (hiện đang ở chế độ LOCAL_DEMO_MODE_KEY). Vui lòng dán API Key (ví dụ: Google Gemini 'AIza...') vào ô nhập API Key bên dưới rồi bấm 'Lưu & Kiểm tra kết nối ngay'!"
    );
  }

  const llm = createLlmProvider();
  const PingSchema = z.object({
    ok: z.boolean(),
    reply: z.string(),
  });

  // Bước 1: Kiểm tra model viết bài (Text / Structured JSON)
  const textRes = await llm.generateStructured({
    step: "connection_test",
    schema: PingSchema,
    prompt: 'Trả về JSON {"ok": true, "reply": "pong"} để kiểm tra kết nối.',
  });

  // Bước 2: Tạo 1 bức ảnh JPEG thực tế (320x240px) bằng sharp và kiểm tra đọc ảnh Vision
  const testJpegBuffer = await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: { r: 210, g: 225, b: 240 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

  const visionRes = await llm.analyzeImage({
    step: "vision_connection_test",
    schema: ImageAnalysisSchema,
    imageBytes: new Uint8Array(testJpegBuffer),
    mimeType: "image/jpeg",
    prompt:
      "Đọc bức ảnh mẫu này và trả về JSON gồm description (<= 40 từ), alt_text (<= 125 ký tự, không rỗng), subjects (mảng chuỗi) và visible_text (null nếu không có chữ).",
  });

  return `✅ KIỂM TRA CHUẨN ĐẠT 2/2: [1] Viết bài (${textRes.model}: in=${textRes.inputTokens}, out=${textRes.outputTokens} token) · [2] Đọc ảnh Vision (${visionRes.model}: alt="${visionRes.data.alt_text}", in=${visionRes.inputTokens}, out=${visionRes.outputTokens} token).`;
}

export async function saveAiSettingsAction(formData: FormData): Promise<void> {
  const intent = String(formData.get("intent") ?? "save");
  let noticeMsg = "Đã lưu cài đặt AI thành công.";

  try {
    const adminUser = await requireAdminUser();
    const provider = String(formData.get("provider") ?? "")
      .trim()
      .toLowerCase();
    const rawWriter = String(formData.get("model_writer") ?? "").trim();
    const rawVision = String(formData.get("model_vision") ?? "").trim();
    const monthlyBudgetRaw = Number(formData.get("monthly_token_budget") ?? 0);
    const apiKeyInput = String(formData.get("api_key") ?? "").trim();

    if (
      provider !== "gemini" &&
      provider !== "anthropic" &&
      provider !== "openai"
    ) {
      redirect(
        "/admin/settings/ai?error=" +
          encodeURIComponent(
            "Nhà cung cấp phải là gemini, anthropic hoặc openai"
          )
      );
    }

    if (apiKeyInput.length > 0) {
      validateApiKeyFormatForProvider(provider, apiKeyInput);
    }

    const { modelWriter, modelVision } = normalizeModelsForProvider(
      provider,
      rawWriter,
      rawVision
    );

    if (!Number.isFinite(monthlyBudgetRaw) || monthlyBudgetRaw < 0) {
      redirect(
        "/admin/settings/ai?error=" +
          encodeURIComponent("Hạn mức token tháng không hợp lệ")
      );
    }

    const supabase = await createServerSupabaseClient();
    const { error: updateErr } = await supabase
      .from("ai_settings")
      .update({
        provider,
        model_writer: modelWriter,
        model_vision: modelVision,
        monthly_token_budget: Math.floor(monthlyBudgetRaw),
      })
      .eq("id", true);

    if (updateErr) {
      redirect(
        "/admin/settings/ai?error=" + encodeURIComponent(updateErr.message)
      );
    }

    // Nếu người dùng nhập API key mới -> lưu vào Supabase Vault qua service_role RPC (R-42)
    if (apiKeyInput.length > 0) {
      const adminClient = createAdminSupabaseClient();
      const { error: keyErr } = await adminClient.rpc("set_ai_api_key", {
        p_key: apiKeyInput,
        p_actor: adminUser.id,
      });
      if (keyErr) {
        redirect(
          "/admin/settings/ai?error=" + encodeURIComponent(keyErr.message)
        );
      }
    }

    if (intent === "save_and_test") {
      noticeMsg = await verifyRealAiTextAndVisionConnection();
    }

    revalidatePath("/admin/settings/ai");
    revalidatePath("/admin/articles");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi lưu cài đặt AI";
    if (message.includes("NEXT_REDIRECT")) throw err;
    redirect("/admin/settings/ai?error=" + encodeURIComponent(message));
  }

  redirect("/admin/settings/ai?notice=" + encodeURIComponent(noticeMsg));
}

export async function testAiConnectionAction(): Promise<void> {
  let statusMsg = "";
  let isError = false;
  try {
    await requireAdminUser();
    statusMsg = await verifyRealAiTextAndVisionConnection();
  } catch (err) {
    isError = true;
    statusMsg =
      err instanceof Error ? err.message : "Kiểm tra kết nối thất bại";
  }

  revalidatePath("/admin/settings/ai");
  revalidatePath("/admin/articles");
  if (isError) {
    redirect("/admin/settings/ai?error=" + encodeURIComponent(statusMsg));
  }
  redirect("/admin/settings/ai?notice=" + encodeURIComponent(statusMsg));
}
