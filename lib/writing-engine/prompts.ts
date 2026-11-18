import { CHECK_CONFIG } from "@/lib/checks/config";
import type { KeywordSuggestionItem } from "@/lib/keywords/provider";
import { loadRules, type RuleStep } from "@/lib/knowledge/rules";
import type {
  BrandProfileRow,
  ContentBlock,
  OutlineItem,
  SearchIntent,
} from "@/lib/supabase/types";
import {
  WRITING_ENGINE_PROMPT_VERSION,
  type ContentType,
} from "./types";

export interface IntentAndTopicPreAnalysis {
  inferredIntent: SearchIntent;
  inferredContentType: ContentType;
  dedupedKeywords: string[];
  intentClusters: Record<string, string[]>;
}

/**
 * Năng lực 1 & 2 (Pre-analysis bằng code 0 token):
 * Phân tích sơ bộ Search Intent và gom nhóm chủ đề từ `topic` + `KeywordSuggestionItem[]`.
 */
export function analyzeSearchIntentAndTopic(
  topic: string,
  suggestions: KeywordSuggestionItem[] = []
): IntentAndTopicPreAnalysis {
  const lower = topic.toLowerCase();
  let inferredIntent: SearchIntent = "informational";
  let inferredContentType: ContentType = "knowledge";

  if (
    lower.includes("mua") ||
    lower.includes("đặt hàng") ||
    lower.includes("bảng giá") ||
    lower.includes("khuyến mãi")
  ) {
    inferredIntent = "transactional";
    inferredContentType = "product";
  } else if (
    lower.includes("so sánh") ||
    lower.includes("nên mua") ||
    lower.includes("đánh giá") ||
    lower.includes("review") ||
    lower.includes("tốt nhất")
  ) {
    inferredIntent = "commercial";
    inferredContentType = lower.includes("so sánh") ? "comparison" : "product";
  } else if (
    lower.includes("hướng dẫn") ||
    lower.includes("cách ") ||
    lower.includes("quy trình") ||
    lower.includes("mẹo")
  ) {
    inferredIntent = "informational";
    inferredContentType = "guide";
  } else if (
    lower.includes("chính sách") ||
    lower.includes("bảo hành") ||
    lower.includes("đổi trả") ||
    lower.includes("dịch vụ")
  ) {
    inferredIntent = "navigational";
    inferredContentType = "service";
  }

  const intentClusters: Record<string, string[]> = {};
  const dedupedKeywords: string[] = [];
  const seen = new Set<string>();

  for (const item of suggestions) {
    const kw = item.keyword.trim();
    if (!kw) continue;
    const norm = kw.toLowerCase();
    if (!seen.has(norm) && dedupedKeywords.length < CHECK_CONFIG.MAX_KEYWORD_SUGGESTIONS) {
      seen.add(norm);
      dedupedKeywords.push(kw);
    }
    const clusterKey = item.intentCluster ?? "general-topic";
    if (!intentClusters[clusterKey]) {
      intentClusters[clusterKey] = [];
    }
    if (!intentClusters[clusterKey].includes(kw)) {
      intentClusters[clusterKey].push(kw);
    }
  }

  return {
    inferredIntent,
    inferredContentType,
    dedupedKeywords,
    intentClusters,
  };
}

function normalizeTopicKey(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Xây dựng ngân hàng chủ đề đa dạng theo cụm ý định tìm kiếm (Topic Cluster) từ brand_profile,
 * chống trùng lặp chủ đề và ăn thịt từ khóa (Cannibalization — R-07).
 */
export function buildNonOverlappingTopicSchedule(
  brand: BrandProfileRow | null,
  existingTopics: string[],
  count: number = 3
): Array<{ topic: string; daysFromNow: number }> {
  const brandName = brand?.brand_name ?? "LumiBrew Việt Nam";
  const prod1 = brand?.products?.[0]?.name ?? "LumiBrew Mini X1";
  const prod2 = brand?.products?.[1]?.name ?? "LumiGrind Pro G2";

  const candidatePool: string[] = [
    `So sánh kết hợp bộ đôi ${prod1} và máy xay ${prod2} cho góc pha chế tại căn hộ nhỏ`,
    `Hướng dẫn vệ sinh bình nước 1.2 lít trên ${prod1} và bảo dưỡng lưỡi xay 48 mm của ${prod2}`,
    `Cách pha pour-over V60 chuẩn vị với cấp độ mịn 22–28 trên máy xay hạt ${prod2}`,
    `Tìm hiểu áp suất bơm 15 bar và thời gian làm nóng 35 giây trên máy pha cà phê ${prod1}`,
    `Kinh nghiệm thiết lập quầy cà phê espresso cho văn phòng nhỏ với thiết bị ${brandName}`,
    `Vì sao lưỡi xay phẳng 48 mm tốc độ 450 vòng/phút trên ${prod2} giúp bột cà phê đồng đều?`,
    `Hướng dẫn chuyển đổi nhanh giữa pha Espresso (cấp 5–10) và Pour-over (cấp 22–28) trên ${prod2}`,
    `Đánh giá chi tiết thiết kế vỏ thép không gỉ 304 nặng 4.2 kg của máy pha ${prod1}`,
    `Hướng dẫn pha cà phê espresso chuẩn vị tại nhà với máy ${prod1}`,
    `Cách chọn cấp độ mịn trên máy xay ${prod2} cho espresso và pour-over`,
    `Vì sao kiểm soát nhiệt độ PID 92 độ C trên ${prod1} của ${brandName} quyết định hương vị espresso?`,
  ];

  const existingSet = new Set(existingTopics.map(normalizeTopicKey));
  const selected: Array<{ topic: string; daysFromNow: number }> = [];

  for (const candidate of candidatePool) {
    const key = normalizeTopicKey(candidate);
    const prefix = key.slice(0, 55);
    const isDuplicate =
      existingSet.has(key) ||
      Array.from(existingSet).some((ex) => ex.startsWith(prefix));

    if (!isDuplicate) {
      existingSet.add(key);
      selected.push({
        topic: candidate,
        daysFromNow: selected.length * 2 + 1,
      });
      if (selected.length >= count) break;
    }
  }

  let seq = existingTopics.length + 1;
  while (selected.length < count) {
    const dynamicTopic = `Chuyên đề pha chế #${seq}: Tối ưu chiết xuất espresso 92 độ C với ${prod1} và ${prod2}`;
    const key = normalizeTopicKey(dynamicTopic);
    if (!existingSet.has(key)) {
      existingSet.add(key);
      selected.push({
        topic: dynamicTopic,
        daysFromNow: selected.length * 2 + 1,
      });
    }
    seq++;
  }

  return selected;
}

export interface PlanOutlinePromptInput {
  topic: string;
  dedupedKeywords: string[];
  inferredIntent?: SearchIntent;
  inferredContentType?: ContentType;
  editorNote?: string | null;
}

/**
 * Xây dựng phần đầu cố định (System Prefix có Prompt Caching R-16) cho bước Lập dàn ý.
 */
export function buildPlanOutlineSystemPrefix(brand: BrandProfileRow): string {
  const planRules = loadRules("plan");
  return [
    `BẠN LÀ CONTENT AGENT BƯỚC LẬP DÀN Ý (plan_outline — Prompt v${WRITING_ENGINE_PROMPT_VERSION}).`,
    "NHIỆM VỤ: Thực hiện (1) Phân tích Search Intent, (2) Nghiên cứu chủ đề & từ khóa, (3) Xây dựng Content Outline chuẩn SEO/GEO/AEO.",
    "TUÂN THỦ NGHIÊM NGẶT BỘ QUY TẮC SAU:",
    planRules,
    "",
    "NGUYÊN TẮC PHÂN LOẠI NHÃN DỮ KIỆN (5 MỨC BẮT BUỘC):",
    "- VERIFIED: Dữ kiện đã có nguồn xác thực trực tiếp trong brand_profile.facts hoặc brand_profile.products (bắt buộc gắn đúng fact_ids).",
    "- USER_PROVIDED: Thông tin do người dùng/Editor cung cấp trực tiếp trong chủ đề hoặc ghi chú.",
    "- GENERAL_KNOWLEDGE: Kiến thức phổ thông, định nghĩa chuyên ngành có thể kiểm chứng độc lập (không tự gán cho sản phẩm thương hiệu).",
    "- NEEDS_VERIFICATION: Chưa đủ căn cứ trong brand_profile -> BẮT BUỘC đẩy vào mảng needs_info, tuyệt đối không tự chuyển thành VERIFIED.",
    "- OPINION: Nhận định, góc nhìn tư vấn (không chứa forbidden_claims).",
    "",
    "HỒ SƠ THƯƠNG HIỆU (NGUỒN SỰ THẬT DUY NHẤT):",
    JSON.stringify(
      {
        brand_name: brand.brand_name,
        description: brand.description,
        voice: brand.voice,
        products: brand.products,
        facts: brand.facts,
        forbidden_claims: brand.forbidden_claims,
      },
      null,
      2
    ),
  ].join("\n");
}

/**
 * Xây dựng User Prompt cho bước Lập dàn ý (Năng lực 1 + 2 + 3).
 */
export function buildPlanOutlineUserPrompt(
  input: PlanOutlinePromptInput
): string {
  const lines: string[] = [
    `Chủ đề bài viết: "${input.topic}"`,
    `Gợi ý phân tích Search Intent sơ bộ: intent="${input.inferredIntent ?? "informational"}", loại bài="${input.inferredContentType ?? "guide"}"`,
    `Danh sách gợi ý từ khóa (đã loại trùng, tối đa 30): ${JSON.stringify(input.dedupedKeywords)}`,
  ];

  if (input.editorNote && input.editorNote.trim()) {
    lines.push(
      "",
      `GHI CHÚ YÊU CẦU CHỈNH SỬA TỪ NGƯỜI DUYỆT (CỔNG 1): "${input.editorNote.trim()}"`
    );
  }

  lines.push(
    "",
    "Yêu cầu đầu ra:",
    "- Xác định rõ search_intent (informational | commercial | transactional | navigational) và content_type.",
    "- Chọn primary_keyword phù hợp nhất với chủ đề và Search Intent.",
    "- Chọn tối đa 8 secondary_keywords.",
    "- Đề xuất tối đa 6 câu hỏi FAQ (faq_questions) thực tế phục vụ AEO.",
    "- Lập dàn ý outline gồm tối thiểu 2 mục H2; mỗi mục có key_points, direct_answer_hint (câu trả lời trực tiếp mở đầu mục), claim_label và mảng fact_ids tham chiếu đúng id trong brand_profile.facts.",
    "- Nếu chủ đề yêu cầu thông tin KHÔNG CÓ trong brand_profile (ví dụ: chính sách bảo hành, đổi trả, khuyến mãi...) thì BẮT BUỘC gắn claim_label='NEEDS_VERIFICATION' và ghi rõ điều còn thiếu vào mảng needs_info, tuyệt đối không tự bịa sự thật."
  );

  return lines.join("\n");
}

export interface WriteArticlePromptInput {
  topic: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  faqQuestions: string[];
  outlineItems: OutlineItem[];
  outlineNeedsInfo: string[];
  assets: Array<{
    asset_id: string;
    alt_text: string | null;
    analysis: unknown;
  }>;
  editorNote?: string | null;
  retryErrors?: string[];
}

/**
 * Xây dựng phần đầu cố định (System Prefix có Prompt Caching R-16) cho bước Viết bài.
 */
export function buildWriteArticleSystemPrefix(brand: BrandProfileRow): string {
  const writeAndSchemaRules = loadRules(["write", "schema"]);
  return [
    `BẠN LÀ WEBSITE CONTENT STANDARD AGENT BƯỚC VIẾT BÀI (write_article — Prompt v${WRITING_ENGINE_PROMPT_VERSION}).`,
    "NGUYÊN TẮC CỐT LÕI: VIẾT ĐỂ GIẢI QUYẾT NHU CẦU NGƯỜI DÙNG, KHÔNG VIẾT ĐỂ NHỒI NHÉT TỪ KHÓA.",
    "PHẦN CỐ ĐỊNH 1 — BỘ QUY TẮC VIẾT BÀI & SCHEMA (docs/knowledge/RULES.md):",
    writeAndSchemaRules,
    "",
    "QUY TẮC TRẢ LỜI AEO & GEO:",
    "- Áp dụng công thức AEO ngay sau mỗi thẻ H2: CÂU HỎI/CHỦ ĐỀ -> TRẢ LỜI TRỰC TIẾP (1-2 câu đầu) -> GIẢI THÍCH -> DẪN CHỨNG -> ĐIỀU KIỆN ÁP DỤNG.",
    "- Xác định rõ Entity (thương hiệu, sản phẩm, thông số) và gắn nhãn claim_label chính xác cho từng block (VERIFIED | USER_PROVIDED | GENERAL_KNOWLEDGE | NEEDS_VERIFICATION | OPINION).",
    "- Không bao giờ tự chuyển thông tin thuộc diện NEEDS_VERIFICATION thành VERIFIED nếu không có fact_id thật trong brand_profile.",
    "",
    "PHẦN CỐ ĐỊNH 2 — HỒ SƠ THƯƠNG HIỆU (brand_profile — NGUỒN SỰ THẬT DUY NHẤT):",
    JSON.stringify(
      {
        brand_name: brand.brand_name,
        description: brand.description,
        voice: brand.voice,
        products: brand.products,
        facts: brand.facts,
        forbidden_claims: brand.forbidden_claims,
      },
      null,
      2
    ),
  ].join("\n");
}

/**
 * Xây dựng User Prompt cho bước Viết bài (Năng lực 4 + 5 + 6).
 */
export function buildWriteArticleUserPrompt(
  input: WriteArticlePromptInput
): string {
  const lines: string[] = [
    `Chủ đề bài viết: "${input.topic}"`,
    `Từ khóa chính (primary_keyword): "${input.primaryKeyword}"`,
    `Từ khóa phụ (secondary_keywords): ${JSON.stringify(input.secondaryKeywords)}`,
    `Danh sách câu hỏi FAQ cần trả lời: ${JSON.stringify(input.faqQuestions)}`,
    `Dàn ý đã được duyệt (outline): ${JSON.stringify(input.outlineItems, null, 2)}`,
    `Thông tin còn thiếu đã ghi nhận ở bước dàn ý (nếu có): ${JSON.stringify(input.outlineNeedsInfo)}`,
    `Danh sách ảnh đã phân tích (dùng đúng id làm asset_id cho block image): ${JSON.stringify(input.assets, null, 2)}`,
  ];

  if (input.editorNote && input.editorNote.trim()) {
    lines.push(
      "",
      `GHI CHÚ YÊU CẦU SỬA BÀI TỪ NGƯỜI DUYỆT (CỔNG 2): "${input.editorNote.trim()}"`
    );
  }

  lines.push(
    "",
    "YÊU CẦU NGHIÊM NGẶT:",
    `1. seo.title phải từ ${CHECK_CONFIG.TITLE_MIN_CHARS}–${CHECK_CONFIG.TITLE_MAX_CHARS} ký tự và CHỨA nguyên văn từ khóa chính "${input.primaryKeyword}".`,
    `2. seo.meta_description phải từ ${CHECK_CONFIG.META_DESC_MIN_CHARS}–${CHECK_CONFIG.META_DESC_MAX_CHARS} ký tự.`,
    `3. Đoạn mở đầu (trong 100 từ đầu tiên) PHẢI chứa nguyên văn từ khóa chính "${input.primaryKeyword}".`,
    "4. Có ít nhất 2 block h2; ngay sau mỗi h2 là đoạn paragraph trả lời trực tiếp 1–2 câu (Direct Answer Pattern - R-21). Có thể dùng thêm h3, list, table hoặc callout khi cần hệ thống hóa dữ liệu.",
    "5. Nhúng ít nhất 1 block image sử dụng đúng asset_id từ danh sách ảnh ở trên và alt không rỗng (<= 125 ký tự).",
    "6. Có từ 1 đến 6 block faq (q, a), mỗi câu trả lời a từ 5 đến dưới 300 từ.",
    "7. CHỐNG BỊA ĐẶT & NHÃN SỰ THẬT (R-31, R-32): Mọi con số, giá, thông số kỹ thuật của thương hiệu/sản phẩm bắt buộc lấy đúng từ brand_profile, gắn claim_label='VERIFIED' và gắn fact_ids tương ứng. Câu kiến thức phổ thông không nói về thương hiệu thì gắn claim_label='GENERAL_KNOWLEDGE'. TUYỆT ĐỐI KHÔNG dùng bất kỳ cụm từ nào trong forbidden_claims. Nếu chủ đề/yêu cầu đòi hỏi thông tin không có trong brand_profile (như chính sách bảo hành, đổi trả) hoặc yêu cầu câu cấm nói, KHÔNG ĐƯỢC TỰ BỊA mà phải ghi rõ lý do vào mảng needs_info."
  );

  if (input.retryErrors && input.retryErrors.length > 0) {
    lines.push(
      "",
      "LƯU Ý SỬA LỖI TỪ LẦN KIỂM TRA TRƯỚC:",
      ...input.retryErrors
    );
  }

  return lines.join("\n");
}

export interface PromptRegistryItem {
  id: string;
  version: string;
  ruleSteps: RuleStep[];
  description: string;
}

export const PROMPT_REGISTRY: Record<
  "plan_outline" | "analyze_images" | "write_article",
  PromptRegistryItem
> = {
  plan_outline: {
    id: "intent_research_and_outline",
    version: WRITING_ENGINE_PROMPT_VERSION,
    ruleSteps: ["plan"],
    description:
      "Phân tích Search Intent, nghiên cứu từ khóa/thực thể và xây dựng dàn ý gắn nhãn dữ kiện.",
  },
  analyze_images: {
    id: "vision_image_analyzer",
    version: WRITING_ENGINE_PROMPT_VERSION,
    ruleSteps: ["image"],
    description:
      "Phân tích hình ảnh <= 1568px JPEG, sinh alt_text <= 125 ký tự và lọc tên thương hiệu không hiển thị.",
  },
  write_article: {
    id: "seo_geo_aeo_standard_writer",
    version: WRITING_ENGINE_PROMPT_VERSION,
    ruleSteps: ["write", "schema"],
    description:
      "Viết bài theo cấu trúc block chuẩn SEO/GEO/AEO, Direct Answer sau H2 và gắn nhãn sự thật 5 mức.",
  },
};

export type { ContentBlock };

