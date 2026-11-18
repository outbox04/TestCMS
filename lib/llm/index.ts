import "server-only";
import { generateText, Output, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AiSettingsRow } from "@/lib/supabase/types";

export interface GenerateStructuredOptions<T extends z.ZodType> {
  step: string;
  articleId?: string | null;
  schema: T;
  systemCacheablePrefix?: string;
  prompt: string;
}

export interface AnalyzeImageOptions<T extends z.ZodType> {
  step: string;
  articleId?: string | null;
  schema: T;
  imageBytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  prompt: string;
}

export interface LlmCallResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  model: string;
}

export interface LlmProvider {
  generateStructured<T extends z.ZodType>(
    options: GenerateStructuredOptions<T>
  ): Promise<LlmCallResult<z.infer<T>>>;
  analyzeImage<T extends z.ZodType>(
    options: AnalyzeImageOptions<T>
  ): Promise<LlmCallResult<z.infer<T>>>;
}

export interface BudgetCheckInput {
  usedThisMonth: number;
  monthlyBudget: number;
}

/**
 * Kiểm tra hạn mức token tháng trước mỗi lần gọi AI (R-42).
 * Nếu đã dùng >= hạn mức hoặc hạn mức <= 1 (bẫy Kịch bản F) thì ném lỗi.
 */
export function assertTokenBudgetAvailable({
  usedThisMonth,
  monthlyBudget,
}: BudgetCheckInput): void {
  if (monthlyBudget <= 1 || usedThisMonth >= monthlyBudget) {
    throw new Error(
      `Đã chạm hạn mức token tháng (${usedThisMonth}/${monthlyBudget} token). Tác vụ AI bị chặn.`
    );
  }
}

interface ResolvedAiConfig {
  provider: "gemini" | "anthropic" | "openai";
  modelWriter: string;
  modelVision: string;
  apiKey: string;
  monthlyBudget: number;
  usedThisMonth: number;
}

async function resolveAiConfigForRequest(): Promise<ResolvedAiConfig> {
  const admin = createAdminSupabaseClient();

  const { data: settingsData, error: settingsErr } = await admin
    .from("ai_settings")
    .select(
      "id, provider, model_writer, model_vision, api_key_secret_id, api_key_last4, monthly_token_budget, updated_by, updated_at"
    )
    .eq("id", true)
    .single();

  if (settingsErr || !settingsData) {
    throw new Error(
      `Không đọc được cấu hình ai_settings: ${settingsErr?.message ?? "chưa khởi tạo"}`
    );
  }

  const settings = settingsData as AiSettingsRow;
  const providerRaw = (settings.provider ?? "").trim().toLowerCase();
  if (
    providerRaw !== "gemini" &&
    providerRaw !== "anthropic" &&
    providerRaw !== "openai"
  ) {
    throw new Error(
      "Nhà cung cấp AI chưa được cấu hình hợp lệ trong /admin/settings/ai (chọn gemini, anthropic hoặc openai)."
    );
  }

  const modelWriter = (settings.model_writer ?? "").trim();
  const modelVision = (settings.model_vision ?? "").trim();
  if (!modelWriter || !modelVision) {
    throw new Error(
      "Tên model viết bài (model_writer) hoặc model phân tích ảnh (model_vision) chưa được cấu hình trong /admin/settings/ai."
    );
  }

  const { data: usedData, error: usedErr } = await admin.rpc(
    "ai_tokens_used_this_month"
  );
  if (usedErr) {
    throw new Error(
      `Không kiểm tra được lượng token đã dùng: ${usedErr.message}`
    );
  }

  const usedThisMonth = Number(usedData ?? 0);
  const monthlyBudget = Number(settings.monthly_token_budget ?? 0);

  assertTokenBudgetAvailable({ usedThisMonth, monthlyBudget });

  const { data: keyData, error: keyErr } = await admin.rpc("get_ai_api_key");
  if (keyErr || !keyData || typeof keyData !== "string" || !keyData.trim()) {
    throw new Error(
      "Chưa cấu hình API key trong Supabase Vault (/admin/settings/ai)."
    );
  }

  return {
    provider: providerRaw,
    modelWriter,
    modelVision,
    apiKey: keyData.trim(),
    monthlyBudget,
    usedThisMonth,
  };
}

function buildLanguageModel(
  provider: "anthropic" | "openai",
  apiKey: string,
  modelName: string
): LanguageModel {
  if (provider === "anthropic") {
    const anthropic = createAnthropic({ apiKey });
    return anthropic(modelName);
  }
  const customBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const openai = createOpenAI({
    apiKey,
    ...(customBaseUrl ? { baseURL: customBaseUrl } : {}),
  });
  return openai(modelName);
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function extractJsonObjectFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  return JSON.parse(candidate);
}

function buildGeminiSchemaInstruction(step: string): string {
  if (step === "connection_test") {
    return 'BẮT BUỘC trả về duy nhất 1 JSON object hợp lệ có cấu trúc: {"ok": true, "reply": "pong"}';
  }
  if (step === "plan_topic_schedule") {
    return 'BẮT BUỘC trả về duy nhất 1 JSON object hợp lệ có cấu trúc: {"topics": ["chủ đề 1", "chủ đề 2", "chủ đề 3"]}';
  }
  if (step === "plan_outline") {
    return [
      "BẮT BUỘC trả về duy nhất 1 JSON object hợp lệ theo đúng cấu trúc:",
      '{',
      '  "search_intent": "informational" | "commercial" | "transactional" | "navigational",',
      '  "content_type": "guide" | "knowledge" | "product" | "comparison" | "service" | "news",',
      '  "primary_keyword": "từ khóa chính",',
      '  "secondary_keywords": ["tối đa 8 từ khóa phụ"],',
      '  "faq_questions": ["từ 1 đến 6 câu hỏi FAQ"],',
      '  "outline": [',
      '    {',
      '      "h2": "Tiêu đề mục H2 (tối thiểu 2 mục H2)",',
      '      "key_points": ["ý chính 1", "ý chính 2"],',
      '      "fact_ids": ["fact-01"],',
      '      "claim_label": "VERIFIED" | "GENERAL_KNOWLEDGE" | "NEEDS_VERIFICATION"',
      '    }',
      '  ],',
      '  "needs_info": ["ghi rõ thông tin thiếu nếu không có trong brand_profile, hoặc mảng rỗng []"]',
      '}',
    ].join("\n");
  }
  if (step.startsWith("write_article")) {
    return [
      "BẮT BUỘC trả về duy nhất 1 JSON object hợp lệ theo đúng cấu trúc:",
      '{',
      '  "seo": {',
      '    "title": "Tiêu đề SEO từ 10 đến 60 ký tự chứa nguyên văn primary_keyword",',
      '    "meta_description": "Mô tả meta từ 30 đến 155 ký tự đúng chủ đề chính"',
      '  },',
      '  "content_blocks": [',
      '    { "type": "h2", "text": "Tiêu đề H2 #1" },',
      '    { "type": "paragraph", "text": "Đoạn mở đầu chứa nguyên văn primary_keyword và trả lời trực tiếp...", "fact_ids": ["fact-01"], "claim_label": "VERIFIED" },',
      '    { "type": "image", "asset_id": "id-anh-tu-danh-sach", "alt": "Mô tả ảnh <= 125 ký tự", "caption": "Chú thích" },',
      '    { "type": "h2", "text": "Tiêu đề H2 #2" },',
      '    { "type": "paragraph", "text": "Đoạn văn trả lời trực tiếp dưới H2 #2...", "fact_ids": ["fact-02"], "claim_label": "VERIFIED" },',
      '    { "type": "list", "ordered": false, "items": ["Mục 1", "Mục 2"], "fact_ids": ["fact-06"], "claim_label": "VERIFIED" },',
      '    { "type": "faq", "q": "Câu hỏi FAQ liên quan đúng chủ đề?", "a": "Câu trả lời từ 5 đến dưới 300 từ...", "fact_ids": ["fact-02"], "claim_label": "VERIFIED" }',
      '  ],',
      '  "needs_info": []',
      '}',
    ].join("\n");
  }
  if (step === "analyze_images" || step === "vision_connection_test") {
    return [
      "BẮT BUỘC trả về duy nhất 1 JSON object hợp lệ theo đúng cấu trúc:",
      '{',
      '  "description": "Mô tả ngắn gọn nội dung thị giác trong ảnh (<= 40 từ)",',
      '  "alt_text": "Văn bản thay thế mô tả chính xác ảnh (<= 125 ký tự, không rỗng)",',
      '  "subjects": ["đối tượng 1", "đối tượng 2"],',
      '  "visible_text": "chữ thực sự nhìn thấy trên ảnh hoặc null nếu không có chữ"',
      '}',
    ].join("\n");
  }
  return "BẮT BUỘC trả về duy nhất 1 JSON object hợp lệ khớp với yêu cầu.";
}

async function callGoogleGeminiApi<T extends z.ZodType>(params: {
  apiKey: string;
  modelName: string;
  step: string;
  schema: T;
  systemInstruction?: string;
  userPrompt: string;
  imagePart?: { mimeType: string; bytes: Uint8Array };
}): Promise<{
  data: z.infer<T>;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}> {
  const cleanModel = params.modelName.replace(/^models\//, "").trim();

  const schemaHint = buildGeminiSchemaInstruction(params.step);
  const parts: Array<Record<string, unknown>> = [];

  // Đặt khối image đứng trước khối text theo đúng chuẩn R-14
  if (params.imagePart) {
    parts.push({
      inlineData: {
        mimeType: params.imagePart.mimeType,
        data: Buffer.from(params.imagePart.bytes).toString("base64"),
      },
    });
  }

  parts.push({
    text: `${params.userPrompt}\n\n${schemaHint}`,
  });

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  };

  if (params.systemInstruction && params.systemInstruction.trim()) {
    requestBody.systemInstruction = {
      parts: [{ text: params.systemInstruction }],
    };
  }

  const isVertexExpressKey = /^aq\./i.test(params.apiKey.trim());
  const primaryEndpoint = isVertexExpressKey
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(
        cleanModel
      )}:generateContent?key=${encodeURIComponent(params.apiKey.trim())}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        cleanModel
      )}:generateContent?key=${encodeURIComponent(params.apiKey.trim())}`;

  const fallbackEndpoint = isVertexExpressKey
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        cleanModel
      )}:generateContent?key=${encodeURIComponent(params.apiKey.trim())}`
    : `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(
        cleanModel
      )}:generateContent?key=${encodeURIComponent(params.apiKey.trim())}`;

  let response = await fetch(primaryEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  // Nếu key AQ. hoặc AIza gọi endpoint thứ nhất báo lỗi xác thực key (400/401/403), tự động thử endpoint Gemini còn lại
  if (
    !response.ok &&
    (response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404)
  ) {
    const retryRes = await fetch(fallbackEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    if (retryRes.ok) {
      response = retryRes;
    }
  }

  let payload: GeminiGenerateResponse;
  try {
    payload = (await response.json()) as GeminiGenerateResponse;
  } catch {
    throw new Error(
      `Google Gemini API trả về phản hồi không phải JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok || payload.error) {
    const errMsg =
      payload.error?.message ??
      `HTTP ${response.status} khi gọi model ${cleanModel}`;
    throw new Error(`Lỗi từ Google Gemini API (${cleanModel}): ${errMsg}`);
  }

  const rawText =
    payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";

  if (!rawText) {
    throw new Error(
      `Google Gemini API (${cleanModel}) trả về nội dung rỗng (finishReason: ${payload.candidates?.[0]?.finishReason ?? "unknown"}).`
    );
  }

  let rawJson: unknown;
  try {
    rawJson = extractJsonObjectFromText(rawText);
  } catch (err) {
    throw new Error(
      `Không thể phân tích JSON từ phản hồi của Gemini (${cleanModel}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const parsed = params.schema.parse(rawJson);

  return {
    data: parsed,
    inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
    cachedTokens: payload.usageMetadata?.cachedContentTokenCount ?? 0,
  };
}

async function recordAiRun(params: {
  articleId?: string | null;
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const admin = createAdminSupabaseClient();
  const estimatedCostUsd = Number(
    (
      (params.inputTokens * 0.000003 + params.outputTokens * 0.000015)
    ).toFixed(6)
  );
  const { error } = await admin.from("ai_runs").insert({
    article_id: params.articleId ?? null,
    step: params.step,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: estimatedCostUsd,
  });
  if (error) {
    throw new Error(`Không ghi được nhật ký ai_runs: ${error.message}`);
  }
}

function buildLocalDemoResponse(step: string, prompt: string): unknown {
  const topicMatch = prompt.match(/Chủ đề bài viết:\s*"([^"]+)"/i);
  const rawTopic = topicMatch ? topicMatch[1].trim() : prompt.trim();
  const topicText = rawTopic.toLowerCase();
  const pkMatch = prompt.match(
    /Từ khóa chính \(primary_keyword\):\s*"([^"]+)"/i
  );
  const requestedPk = pkMatch ? pkMatch[1].trim() : "";

  const isWarrantyTrap =
    topicText.includes("bảo hành") || topicText.includes("đổi trả");
  const isForbiddenTrap =
    topicText.includes("rẻ nhất thị trường") ||
    topicText.includes("chữa bệnh");

  const isGrinderTopic =
    topicText.includes("lumigrind") ||
    topicText.includes("máy xay") ||
    topicText.includes("cấp độ mịn") ||
    topicText.includes("lưỡi xay") ||
    topicText.includes("pour-over") ||
    topicText.includes("v60");

  const isPidTopic =
    topicText.includes("pid") ||
    topicText.includes("92 độ") ||
    topicText.includes("nhiệt độ");

  const isComboOrComparisonTopic =
    topicText.includes("so sánh") ||
    topicText.includes("kết hợp") ||
    topicText.includes("combo") ||
    topicText.includes("văn phòng") ||
    topicText.includes("căn hộ");

  const isMaintenanceTopic =
    topicText.includes("vệ sinh") ||
    topicText.includes("bình nước") ||
    topicText.includes("phễu chứa hạt");

  if (step === "connection_test") {
    return { ok: true, reply: "pong (Local Demo)" };
  }

  if (step === "plan_outline") {
    if (isGrinderTopic) {
      return {
        search_intent: "informational",
        content_type: "guide",
        primary_keyword: "LumiGrind Pro G2",
        secondary_keywords: [
          "máy xay cà phê lưỡi phẳng 48mm",
          "chỉnh độ mịn máy xay cà phê espresso",
          "cách pha pour over V60 tại nhà",
        ],
        faq_questions: [
          "Mức độ mịn nào trên LumiGrind Pro G2 phù hợp để pha V60?",
          "Nên chỉnh cấp độ mịn nào trên LumiGrind Pro G2 khi pha espresso?",
        ],
        outline: [
          {
            h2: "Cấu tạo lưỡi xay phẳng 48 mm và 38 cấp độ mịn trên LumiGrind Pro G2",
            key_points: [
              "Giá niêm yết 2.490.000 VNĐ, công suất 180W, tốc độ quay 450 vòng/phút",
              "Phễu chứa hạt 250 g, trọng lượng máy 2.6 kg",
            ],
            fact_ids: ["fact-04", "fact-05"],
            claim_label: "VERIFIED",
          },
          {
            h2: "Hướng dẫn chọn cấp độ mịn trên LumiGrind Pro G2 cho Espresso và Pour-over",
            key_points: [
              "Pha espresso: chỉnh từ cấp 5 đến cấp 10",
              "Pha pour-over (V60): chỉnh từ cấp 22 đến cấp 28",
            ],
            fact_ids: ["fact-06", "fact-07"],
            claim_label: "VERIFIED",
          },
        ],
        needs_info: isWarrantyTrap
          ? [
              "Hồ sơ thương hiệu (brand_profile) chưa có thông tin về chính sách bảo hành và đổi trả của LumiBrew Việt Nam.",
            ]
          : [],
      };
    }

    if (isPidTopic) {
      return {
        search_intent: "informational",
        content_type: "knowledge",
        primary_keyword: "kiểm soát nhiệt độ PID 92 độ C",
        secondary_keywords: [
          "LumiBrew Mini X1",
          "nhiệt độ nước pha cà phê espresso chuẩn",
          "máy pha cà phê 15 bar nhỏ gọn",
        ],
        faq_questions: [
          "Bộ điều khiển PID trên LumiBrew Mini X1 giữ nhiệt độ nước ở bao nhiêu độ C?",
          "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
        ],
        outline: [
          {
            h2: "Vai trò của kiểm soát nhiệt độ PID 92 độ C trên LumiBrew Mini X1",
            key_points: [
              "Giữ nhiệt độ nước chiết xuất ổn định ở mức 92 độ C",
              "Kết hợp công suất 1350W và áp suất bơm 15 bar, làm nóng trong 35 giây",
            ],
            fact_ids: ["fact-01", "fact-02", "fact-03"],
            claim_label: "VERIFIED",
          },
          {
            h2: "Phối hợp cùng độ mịn cấp 5–10 trên máy xay LumiGrind Pro G2",
            key_points: [
              "Lưỡi xay phẳng 48 mm giúp bột cà phê đồng đều khi chiết xuất ở 92 độ C",
            ],
            fact_ids: ["fact-04", "fact-06"],
            claim_label: "VERIFIED",
          },
        ],
        needs_info: isWarrantyTrap
          ? [
              "Hồ sơ thương hiệu (brand_profile) chưa có thông tin về chính sách bảo hành và đổi trả của LumiBrew Việt Nam.",
            ]
          : [],
      };
    }

    if (isComboOrComparisonTopic) {
      return {
        search_intent: "commercial",
        content_type: "comparison",
        primary_keyword: "máy pha cà phê espresso gia đình",
        secondary_keywords: [
          "LumiBrew Mini X1",
          "LumiGrind Pro G2",
          "so sánh máy pha cà phê gia đình",
        ],
        faq_questions: [
          "Giá niêm yết của LumiBrew Mini X1 và LumiGrind Pro G2 là bao nhiêu?",
          "LumiBrew Việt Nam được thành lập vào năm nào?",
        ],
        outline: [
          {
            h2: "Thông số máy pha cà phê espresso gia đình LumiBrew Mini X1",
            key_points: [
              "Giá 4.890.000 VNĐ, công suất 1350W, áp suất 15 bar, nặng 4.2 kg",
              "Bình nước tháo rời 1.2 lít, làm nóng 35 giây, PID 92 độ C",
            ],
            fact_ids: ["fact-01", "fact-02", "fact-03"],
            claim_label: "VERIFIED",
          },
          {
            h2: "Ghép đôi cùng máy xay hạt LumiGrind Pro G2 cho góc pha chế tại nhà",
            key_points: [
              "Giá 2.490.000 VNĐ, công suất 180W, lưỡi phẳng 48 mm, 38 cấp độ mịn",
              "Thương hiệu LumiBrew Việt Nam thành lập năm 2024 tại TP. Hồ Chí Minh",
            ],
            fact_ids: ["fact-04", "fact-05", "fact-08"],
            claim_label: "VERIFIED",
          },
        ],
        needs_info: isWarrantyTrap
          ? [
              "Hồ sơ thương hiệu (brand_profile) chưa có thông tin về chính sách bảo hành và đổi trả của LumiBrew Việt Nam.",
            ]
          : [],
      };
    }

    if (isMaintenanceTopic) {
      return {
        search_intent: "informational",
        content_type: "guide",
        primary_keyword: "vệ sinh máy pha cà phê LumiBrew",
        secondary_keywords: [
          "LumiBrew Mini X1",
          "LumiGrind Pro G2",
          "máy pha cà phê espresso gia đình",
        ],
        faq_questions: [
          "Dung tích bình nước tháo rời của LumiBrew Mini X1 là bao nhiêu?",
          "Phễu chứa hạt của máy xay LumiGrind Pro G2 chứa được bao nhiêu gam?",
        ],
        outline: [
          {
            h2: "Cách tháo lắp và vệ sinh máy pha cà phê LumiBrew Mini X1",
            key_points: [
              "Bình nước tháo rời dung tích 1.2 lít, trọng lượng máy 4.2 kg",
              "Giữ sạch cụm chiết xuất áp suất 15 bar và bộ điều khiển PID 92 độ C",
            ],
            fact_ids: ["fact-01", "fact-02", "fact-03"],
            claim_label: "VERIFIED",
          },
          {
            h2: "Bảo dưỡng phễu hạt 250 g và lưỡi phẳng 48 mm trên LumiGrind Pro G2",
            key_points: [
              "Lưỡi xay phẳng 48 mm, 38 cấp độ mịn, tốc độ quay 450 vòng/phút",
            ],
            fact_ids: ["fact-04", "fact-05"],
            claim_label: "VERIFIED",
          },
        ],
        needs_info: isWarrantyTrap
          ? [
              "Hồ sơ thương hiệu (brand_profile) chưa có thông tin về chính sách bảo hành và đổi trả của LumiBrew Việt Nam.",
            ]
          : [],
      };
    }

    return {
      search_intent: "informational",
      content_type: "guide",
      primary_keyword: "LumiBrew Mini X1",
      secondary_keywords: [
        "máy pha cà phê espresso gia đình",
        "máy xay cà phê LumiGrind Pro G2",
        "pha cà phê kiểm soát nhiệt độ PID",
      ],
      faq_questions: [
        "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
        "Nên chỉnh cấp độ mịn nào trên LumiGrind Pro G2 khi pha espresso?",
      ],
      outline: [
        {
          h2: "Thông số nổi bật của máy pha cà phê LumiBrew Mini X1",
          key_points: [
            "Công suất 1350W, áp suất bơm 15 bar, bình nước 1.2 lít, làm nóng 35 giây",
            "Kiểm soát nhiệt độ PID ổn định ở mức 92 độ C",
          ],
          fact_ids: ["fact-01", "fact-02", "fact-03"],
          claim_label: "VERIFIED",
        },
        {
          h2: "Kết hợp cùng máy xay hạt LumiGrind Pro G2 chuẩn mịn",
          key_points: [
            "Lưỡi xay phẳng 48 mm với 38 cấp độ mịn, công suất 180W",
            "Mức mịn cấp 5 đến cấp 10 cho espresso",
          ],
          fact_ids: ["fact-04", "fact-05", "fact-06"],
          claim_label: "VERIFIED",
        },
      ],
      needs_info: isWarrantyTrap
        ? [
            "Hồ sơ thương hiệu (brand_profile) chưa có thông tin về chính sách bảo hành và đổi trả của LumiBrew Việt Nam.",
          ]
        : [],
    };
  }

  if (step.startsWith("write_article")) {
    const assetMatch = prompt.match(/"asset_id":\s*"([^"]+)"/);
    const firstAssetId = assetMatch ? assetMatch[1] : "asset-demo";
    const effectivePk = requestedPk || "LumiBrew Mini X1";
    const pkLower = effectivePk.toLowerCase();

    // Nếu từ khóa chính hoặc chủ đề tập trung riêng vào máy xay LumiGrind Pro G2
    if (pkLower.includes("lumigrind") || (isGrinderTopic && !isComboOrComparisonTopic)) {
      return {
        seo: {
          title: `Hướng dẫn chỉnh cấp độ mịn trên ${effectivePk}`.slice(0, 60),
          meta_description: `Tìm hiểu lưỡi xay phẳng 48 mm, 38 cấp độ mịn và cách chọn độ mịn trên máy xay cà phê ${effectivePk}.`.slice(
            0,
            155
          ),
        },
        content_blocks: [
          {
            type: "h2",
            text: `Cấu tạo lưỡi xay phẳng 48 mm trên ${effectivePk}`,
          },
          {
            type: "paragraph",
            text: isForbiddenTrap
              ? `Máy xay cà phê ${effectivePk} là dòng máy rẻ nhất thị trường với công suất 180W và lưỡi phẳng 48 mm.`
              : `Máy xay cà phê ${effectivePk} có giá niêm yết 2.490.000 VNĐ, công suất 180W, trang bị lưỡi xay phẳng đường kính 48 mm với 38 cấp độ mịn, phễu chứa hạt 250 g, tốc độ quay 450 vòng/phút và nặng 2.6 kg.`,
            fact_ids: ["fact-04", "fact-05"],
            claim_label: "VERIFIED",
          },
          {
            type: "image",
            asset_id: firstAssetId,
            alt: "Hình ảnh minh họa hạt cà phê và phụ kiện xay tại quầy",
            caption: "Chọn đúng cấp độ mịn trong 38 cấp độ giúp chiết xuất đồng đều",
          },
          {
            type: "h2",
            text: `Bảng cấp độ mịn khuyến nghị trên ${effectivePk}`,
          },
          {
            type: "paragraph",
            text: `Trên tổng số 38 cấp độ chỉnh độ mịn của ${effectivePk}, người dùng dễ dàng điều chỉnh cỡ hạt phù hợp cho cả pha espresso trên LumiBrew Mini X1 lẫn pha thủ công pour-over V60.`,
            fact_ids: ["fact-05", "fact-06", "fact-07"],
            claim_label: "VERIFIED",
          },
          {
            type: "list",
            ordered: false,
            items: [
              "Pha espresso trên LumiBrew Mini X1: chỉnh độ mịn trên LumiGrind Pro G2 từ cấp 5 đến cấp 10.",
              "Pha pour-over (V60): chỉnh độ mịn trên LumiGrind Pro G2 từ cấp 22 đến cấp 28.",
            ],
            fact_ids: ["fact-06", "fact-07"],
            claim_label: "VERIFIED",
          },
          {
            type: "faq",
            q: "Mức độ mịn nào trên LumiGrind Pro G2 phù hợp để pha V60?",
            a: "Với phương pháp pour-over (V60), mức độ mịn khuyến nghị trên máy xay LumiGrind Pro G2 là từ cấp 22 đến cấp 28.",
            fact_ids: ["fact-07"],
            claim_label: "VERIFIED",
          },
          {
            type: "faq",
            q: "Nên chỉnh cấp độ mịn nào trên LumiGrind Pro G2 khi pha espresso?",
            a: "Khi pha espresso với LumiBrew Mini X1, mức độ mịn khuyến nghị trên máy xay LumiGrind Pro G2 là từ cấp 5 đến cấp 10.",
            fact_ids: ["fact-06"],
            claim_label: "VERIFIED",
          },
        ],
        needs_info: isWarrantyTrap
          ? [
              "Thiếu dữ liệu chính sách bảo hành và đổi trả trong brand_profile — Agent từ chối tự bịa thông tin.",
            ]
          : [],
      };
    }

    const seoTitleCandidate = `Hướng dẫn chi tiết về ${effectivePk}`.slice(
      0,
      60
    );

    return {
      seo: {
        title:
          effectivePk === "LumiBrew Mini X1"
            ? "Hướng dẫn pha espresso với máy LumiBrew Mini X1"
            : seoTitleCandidate,
        meta_description: `Tìm hiểu thông số áp suất 15 bar, bộ điều khiển PID 92 độ C và kinh nghiệm thực tế về ${effectivePk}.`.slice(
          0,
          155
        ),
      },
      content_blocks: [
        {
          type: "h2",
          text: `Thông số nổi bật và ứng dụng của ${effectivePk}`,
        },
        {
          type: "paragraph",
          text: isForbiddenTrap
            ? `Máy pha cà phê LumiBrew Mini X1 (${effectivePk}) là dòng máy rẻ nhất thị trường hiện nay với công suất 1350W và áp suất 15 bar.`
            : `Máy pha cà phê LumiBrew Mini X1 (${effectivePk}) có giá niêm yết 4.890.000 VNĐ, công suất 1350W và áp suất bơm 15 bar, giúp làm nóng nhanh trong 35 giây cùng bộ điều khiển PID giữ nhiệt ở mức 92 độ C.`,
          fact_ids: ["fact-01", "fact-02", "fact-03"],
          claim_label: "VERIFIED",
        },
        {
          type: "image",
          asset_id: firstAssetId,
          alt: "Hình ảnh minh họa thiết bị pha cà phê tại quầy bếp",
          caption: "Thiết bị pha chế cà phê nhỏ gọn cho gia đình",
        },
        {
          type: "h2",
          text: "Kết hợp cùng máy xay hạt LumiGrind Pro G2",
        },
        {
          type: "paragraph",
          text: "Máy xay cà phê LumiGrind Pro G2 có giá niêm yết 2.490.000 VNĐ, công suất 180W, trang bị lưỡi xay phẳng 48 mm với 38 cấp độ mịn và tốc độ 450 vòng/phút.",
          fact_ids: ["fact-04", "fact-05"],
          claim_label: "VERIFIED",
        },
        {
          type: "list",
          ordered: false,
          items: [
            "Pha espresso: chỉnh độ mịn từ cấp 5 đến cấp 10 trên LumiGrind Pro G2.",
            "Pha pour-over: chỉnh độ mịn từ cấp 22 đến cấp 28.",
          ],
          fact_ids: ["fact-06", "fact-07"],
          claim_label: "VERIFIED",
        },
        {
          type: "faq",
          q: "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
          a: "LumiBrew Mini X1 làm nóng nước trong 35 giây với bình nước tháo rời dung tích 1.2 lít và trọng lượng máy 4.2 kg.",
          fact_ids: ["fact-02"],
          claim_label: "VERIFIED",
        },
        {
          type: "faq",
          q: "Nên chỉnh cấp độ mịn nào trên LumiGrind Pro G2 khi pha espresso?",
          a: "Khi pha espresso với LumiBrew Mini X1, mức độ mịn khuyến nghị trên máy xay LumiGrind Pro G2 là từ cấp 5 đến cấp 10.",
          fact_ids: ["fact-06"],
          claim_label: "VERIFIED",
        },
      ],
      needs_info: isWarrantyTrap
        ? [
            "Thiếu dữ liệu chính sách bảo hành và đổi trả trong brand_profile — Agent từ chối tự bịa thông tin.",
          ]
        : [],
    };
  }

  return {};
}

export function createLlmProvider(): LlmProvider {
  return {
    async generateStructured<T extends z.ZodType>(
      options: GenerateStructuredOptions<T>
    ): Promise<LlmCallResult<z.infer<T>>> {
      const cfg = await resolveAiConfigForRequest();

      if (cfg.apiKey === "LOCAL_DEMO_MODE_KEY") {
        const mockRaw = buildLocalDemoResponse(options.step, options.prompt);
        const parsed = options.schema.parse(mockRaw);
        const inputTokens = 420;
        const outputTokens = 260;
        const cachedTokens = options.systemCacheablePrefix ? 310 : 0;

        await recordAiRun({
          articleId: options.articleId ?? null,
          step:
            cachedTokens > 0
              ? `${options.step} (cached:${cachedTokens})`
              : options.step,
          model: `${cfg.modelWriter} (demo)`,
          inputTokens,
          outputTokens,
        });

        return {
          data: parsed,
          inputTokens,
          outputTokens,
          cachedTokens,
          model: cfg.modelWriter,
        };
      }

      if (cfg.provider === "gemini") {
        const gemRes = await callGoogleGeminiApi({
          apiKey: cfg.apiKey,
          modelName: cfg.modelWriter,
          step: options.step,
          schema: options.schema,
          systemInstruction: options.systemCacheablePrefix,
          userPrompt: options.prompt,
        });

        const stepLabel =
          gemRes.cachedTokens > 0
            ? `${options.step} (cached:${gemRes.cachedTokens})`
            : options.step;

        await recordAiRun({
          articleId: options.articleId ?? null,
          step: stepLabel,
          model: cfg.modelWriter,
          inputTokens: gemRes.inputTokens,
          outputTokens: gemRes.outputTokens,
        });

        return {
          data: gemRes.data,
          inputTokens: gemRes.inputTokens,
          outputTokens: gemRes.outputTokens,
          cachedTokens: gemRes.cachedTokens,
          model: cfg.modelWriter,
        };
      }

      const model = buildLanguageModel(
        cfg.provider,
        cfg.apiKey,
        cfg.modelWriter
      );

      // Áp dụng Prompt Caching (R-16) cho phần đầu cố định [RULES + brand_profile]
      const messages =
        options.systemCacheablePrefix && cfg.provider === "anthropic"
          ? [
              {
                role: "system" as const,
                content: options.systemCacheablePrefix,
                providerOptions: {
                  anthropic: { cacheControl: { type: "ephemeral" } },
                },
              },
              {
                role: "user" as const,
                content: options.prompt,
              },
            ]
          : [
              {
                role: "user" as const,
                content: options.systemCacheablePrefix
                  ? `${options.systemCacheablePrefix}\n\n---\n\n${options.prompt}`
                  : options.prompt,
              },
            ];

      const result = await generateText({
        model,
        output: Output.object({ schema: options.schema }),
        messages,
      });

      const outputData = result.output as z.infer<T>;
      const inputTokens = result.usage?.inputTokens ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;
      const cachedTokens =
        result.usage?.inputTokenDetails?.cacheReadTokens ?? 0;
      const stepLabel =
        cachedTokens > 0
          ? `${options.step} (cached:${cachedTokens})`
          : options.step;

      await recordAiRun({
        articleId: options.articleId ?? null,
        step: stepLabel,
        model: cfg.modelWriter,
        inputTokens,
        outputTokens,
      });

      return {
        data: outputData,
        inputTokens,
        outputTokens,
        cachedTokens,
        model: cfg.modelWriter,
      };
    },

    async analyzeImage<T extends z.ZodType>(
      options: AnalyzeImageOptions<T>
    ): Promise<LlmCallResult<z.infer<T>>> {
      const cfg = await resolveAiConfigForRequest();

      if (cfg.apiKey === "LOCAL_DEMO_MODE_KEY") {
        const mockImg = options.schema.parse({
          description:
            "Hình ảnh chụp góc pha chế cà phê tại bàn bếp với ánh sáng tự nhiên rõ nét.",
          alt_text: "Góc pha chế cà phê gia đình trên mặt bàn bếp hiện đại",
          subjects: ["góc pha chế", "ly cà phê", "bàn bếp"],
          visible_text: null,
        });
        const inputTokens = 280;
        const outputTokens = 65;

        await recordAiRun({
          articleId: options.articleId ?? null,
          step: options.step,
          model: `${cfg.modelVision} (demo)`,
          inputTokens,
          outputTokens,
        });

        return {
          data: mockImg,
          inputTokens,
          outputTokens,
          cachedTokens: 0,
          model: cfg.modelVision,
        };
      }

      if (cfg.provider === "gemini") {
        const gemVisionRes = await callGoogleGeminiApi({
          apiKey: cfg.apiKey,
          modelName: cfg.modelVision,
          step: options.step,
          schema: options.schema,
          userPrompt: options.prompt,
          imagePart: {
            mimeType: options.mimeType,
            bytes: options.imageBytes,
          },
        });

        const stepLabel =
          gemVisionRes.cachedTokens > 0
            ? `${options.step} (cached:${gemVisionRes.cachedTokens})`
            : options.step;

        await recordAiRun({
          articleId: options.articleId ?? null,
          step: stepLabel,
          model: cfg.modelVision,
          inputTokens: gemVisionRes.inputTokens,
          outputTokens: gemVisionRes.outputTokens,
        });

        return {
          data: gemVisionRes.data,
          inputTokens: gemVisionRes.inputTokens,
          outputTokens: gemVisionRes.outputTokens,
          cachedTokens: gemVisionRes.cachedTokens,
          model: cfg.modelVision,
        };
      }

      const model = buildLanguageModel(
        cfg.provider,
        cfg.apiKey,
        cfg.modelVision
      );

      // Đặt khối image đứng trước khối text câu hỏi (R-14)
      const result = await generateText({
        model,
        output: Output.object({ schema: options.schema }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: options.imageBytes,
                mediaType: options.mimeType,
              },
              {
                type: "text",
                text: options.prompt,
              },
            ],
          },
        ],
      });

      const outputData = result.output as z.infer<T>;
      const inputTokens = result.usage?.inputTokens ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;
      const cachedTokens =
        result.usage?.inputTokenDetails?.cacheReadTokens ?? 0;
      const stepLabel =
        cachedTokens > 0
          ? `${options.step} (cached:${cachedTokens})`
          : options.step;

      await recordAiRun({
        articleId: options.articleId ?? null,
        step: stepLabel,
        model: cfg.modelVision,
        inputTokens,
        outputTokens,
      });

      return {
        data: outputData,
        inputTokens,
        outputTokens,
        cachedTokens,
        model: cfg.modelVision,
      };
    },
  };
}
