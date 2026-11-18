import { CHECK_CONFIG } from "@/lib/checks/config";
import {
  buildProductEntityProfiles,
  validateArticleConsistencyAndEntities,
  type ConsistencyValidationInput,
  type ConsistencyValidationResult,
  type ProductEntityProfile,
  type ValidationIssue,
  type ValidationSeverity,
} from "@/lib/checks/consistency";
import { computeArticleQualityRubric } from "@/lib/checks/scorer";
import {
  buildArticleJsonLd,
  countWords,
  validateArticleJsonLd,
} from "@/lib/seo/schema";
import { blockMentionsBrandOrProduct } from "@/lib/writing-engine/fact-verifier";
import type {
  ArticleAssetRow,
  ArticleSeo,
  BrandProfileRow,
  CheckItemResult,
  CheckReport,
  ContentBlock,
} from "@/lib/supabase/types";

export interface RunArticleChecksInput {
  topic?: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  slug: string;
  seo: ArticleSeo;
  contentBlocks: ContentBlock[];
  needsInfo: string[];
  brandProfile: BrandProfileRow;
  assets: Pick<ArticleAssetRow, "id" | "alt_text">[];
  siteUrl?: string;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractBodyPlainText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "h2":
      case "h3":
      case "paragraph":
        parts.push(block.text);
        break;
      case "callout":
        if (block.title) parts.push(block.title);
        parts.push(block.text);
        break;
      case "list":
        parts.push(block.items.join(" "));
        break;
      case "table":
        if (block.caption) parts.push(block.caption);
        parts.push(block.headers.join(" "));
        for (const row of block.rows) {
          parts.push(row.join(" "));
        }
        break;
      case "faq":
        parts.push(`${block.q} ${block.a}`);
        break;
      case "image":
        break;
    }
  }
  return parts.join(" ");
}

function extractNumbersFromText(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return matches.map((m) => m.replace(/\./g, "").replace(",", "."));
}

function collectAllowedBrandNumbers(brand: BrandProfileRow): Set<string> {
  const allowed = new Set<string>([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "100",
  ]);

  const rawCorpusParts: string[] = [
    brand.brand_name ?? "",
    brand.description ?? "",
    brand.voice ?? "",
  ];

  for (const prod of brand.products ?? []) {
    rawCorpusParts.push(prod.name, prod.description, String(prod.price), prod.price_formatted);
    for (const val of Object.values(prod.specs ?? {})) {
      rawCorpusParts.push(val);
    }
  }

  for (const fact of brand.facts ?? []) {
    rawCorpusParts.push(fact.statement);
  }

  const allNums = extractNumbersFromText(rawCorpusParts.join(" "));
  for (const n of allNums) {
    allowed.add(n);
  }

  return allowed;
}

/**
 * Kiểm tra 1: Title, Meta Description đúng độ dài; từ khóa chính có trong title và 100 từ đầu (R-19, R-20).
 */
export function checkSeoTitleAndMeta(
  input: Pick<
    RunArticleChecksInput,
    "primaryKeyword" | "seo" | "contentBlocks"
  >
): CheckItemResult {
  const errors: string[] = [];
  const title = input.seo.title.trim();
  const metaDesc = input.seo.meta_description.trim();
  const pk = normalizeForMatch(input.primaryKeyword);

  if (
    title.length < CHECK_CONFIG.TITLE_MIN_CHARS ||
    title.length > CHECK_CONFIG.TITLE_MAX_CHARS
  ) {
    errors.push(
      `Độ dài title (${title.length} ký tự) phải trong khoảng ${CHECK_CONFIG.TITLE_MIN_CHARS}–${CHECK_CONFIG.TITLE_MAX_CHARS} ký tự [R-20]`
    );
  }

  if (
    metaDesc.length < CHECK_CONFIG.META_DESC_MIN_CHARS ||
    metaDesc.length > CHECK_CONFIG.META_DESC_MAX_CHARS
  ) {
    errors.push(
      `Độ dài meta_description (${metaDesc.length} ký tự) phải trong khoảng ${CHECK_CONFIG.META_DESC_MIN_CHARS}–${CHECK_CONFIG.META_DESC_MAX_CHARS} ký tự [R-20]`
    );
  }

  if (!pk) {
    errors.push("Thiếu primary_keyword [R-19]");
  } else {
    if (!normalizeForMatch(title).includes(pk)) {
      errors.push(`Title không chứa từ khóa chính "${input.primaryKeyword}" [R-19]`);
    }

    const firstParagraphsText = input.contentBlocks
      .filter(
        (b): b is Extract<ContentBlock, { type: "paragraph" | "h2" | "callout" }> =>
          b.type === "paragraph" || b.type === "h2" || b.type === "callout"
      )
      .map((b) => b.text)
      .join(" ");

    const first100Words = firstParagraphsText
      .trim()
      .split(/\s+/)
      .slice(0, CHECK_CONFIG.PRIMARY_KEYWORD_INTRO_WORDS)
      .join(" ");

    if (!normalizeForMatch(first100Words).includes(pk)) {
      errors.push(
        `Từ khóa chính "${input.primaryKeyword}" không xuất hiện trong ${CHECK_CONFIG.PRIMARY_KEYWORD_INTRO_WORDS} từ đầu tiên [R-19]`
      );
    }
  }

  return {
    code: "seo_title_meta",
    ruleIds: ["R-19", "R-20"],
    passed: errors.length === 0,
    message:
      errors.length === 0
        ? "Title, meta description và vị trí từ khóa chính đạt chuẩn."
        : errors.join("; "),
  };
}

/**
 * Kiểm tra 2: Đủ số H2, đủ FAQ, độ dài câu trả lời FAQ trong giới hạn (R-08, R-19, R-29).
 */
export function checkStructureH2AndFaq(
  contentBlocks: ContentBlock[]
): CheckItemResult {
  const errors: string[] = [];
  const h2Blocks = contentBlocks.filter((b) => b.type === "h2");
  const faqBlocks = contentBlocks.filter(
    (b): b is Extract<ContentBlock, { type: "faq" }> => b.type === "faq"
  );

  if (h2Blocks.length < CHECK_CONFIG.MIN_H2_COUNT) {
    errors.push(
      `Số lượng thẻ H2 (${h2Blocks.length}) ít hơn mức tối thiểu ${CHECK_CONFIG.MIN_H2_COUNT} [R-19]`
    );
  }

  if (
    faqBlocks.length < CHECK_CONFIG.MIN_FAQ_COUNT ||
    faqBlocks.length > CHECK_CONFIG.MAX_FAQ_COUNT
  ) {
    errors.push(
      `Số lượng câu hỏi FAQ (${faqBlocks.length}) phải từ ${CHECK_CONFIG.MIN_FAQ_COUNT} đến ${CHECK_CONFIG.MAX_FAQ_COUNT} [R-08, R-29]`
    );
  }

  faqBlocks.forEach((faq, idx) => {
    const wordCount = countWords(faq.a);
    if (
      wordCount < CHECK_CONFIG.FAQ_ANSWER_MIN_WORDS ||
      wordCount >= CHECK_CONFIG.FAQ_ANSWER_MAX_WORDS
    ) {
      errors.push(
        `Câu trả lời FAQ #${idx + 1} dài ${wordCount} từ (phải từ ${CHECK_CONFIG.FAQ_ANSWER_MIN_WORDS} đến dưới ${CHECK_CONFIG.FAQ_ANSWER_MAX_WORDS} từ) [R-29]`
      );
    }
  });

  return {
    code: "structure_h2_faq",
    ruleIds: ["R-08", "R-19", "R-29"],
    passed: errors.length === 0,
    message:
      errors.length === 0
        ? `Cấu trúc đạt chuẩn (${h2Blocks.length} H2, ${faqBlocks.length} FAQ).`
        : errors.join("; "),
  };
}

/**
 * Kiểm tra 3: JSON-LD hợp lệ (trường bắt buộc) và khớp nội dung hiển thị (R-25, R-26, R-27, R-28, R-29).
 */
export function checkSchemaConsistency(
  input: Pick<
    RunArticleChecksInput,
    "slug" | "seo" | "contentBlocks" | "brandProfile" | "siteUrl"
  >
): CheckItemResult {
  const nowIso = new Date().toISOString();
  const doc = buildArticleJsonLd({
    siteUrl: input.siteUrl ?? process.env.SITE_URL ?? "https://example.com",
    slug: input.slug || "bai-viet-demo",
    seo: input.seo,
    contentBlocks: input.contentBlocks,
    brandName: input.brandProfile.brand_name || "Thương hiệu Demo",
    publishedAt: nowIso,
    updatedAt: nowIso,
  });

  const validation = validateArticleJsonLd(doc, input.contentBlocks);

  return {
    code: "schema_jsonld",
    ruleIds: ["R-25", "R-26", "R-27", "R-28", "R-29"],
    passed: validation.valid,
    message: validation.valid
      ? "JSON-LD (Article, BreadcrumbList, FAQPage) hợp lệ và khớp nội dung hiển thị."
      : validation.errors.join("; "),
  };
}

/**
 * Kiểm tra 4: Mọi con số, giá, thông số, tên sản phẩm, fact_ids trong bài phải khớp brand_profile;
 * không chứa forbidden_claims (R-18, R-31, R-32).
 */
export function checkBrandFactsAndForbiddenClaims(
  input: Pick<RunArticleChecksInput, "seo" | "contentBlocks" | "brandProfile">
): CheckItemResult {
  const errors: string[] = [];
  const brand = input.brandProfile;
  const fullText = `${input.seo.title} ${input.seo.meta_description} ${extractBodyPlainText(
    input.contentBlocks
  )}`;
  const normalizedFull = normalizeForMatch(fullText);

  // 4.1 Kiểm tra forbidden_claims (R-18, R-32)
  for (const claim of brand.forbidden_claims ?? []) {
    const cleanClaim = normalizeForMatch(claim);
    if (cleanClaim && normalizedFull.includes(cleanClaim)) {
      errors.push(`Bài viết chứa tuyên bố cấm "${claim}" [R-18, R-32]`);
    }
  }

  // 4.2 Kiểm tra mọi fact_ids được gắn trong các block đều tồn tại trong brand_profile.facts
  // và kiểm tra nhãn dữ kiện (VERIFIED / NEEDS_VERIFICATION) (R-31)
  const validFactIds = new Set((brand.facts ?? []).map((f) => f.id));
  for (const block of input.contentBlocks) {
    if ("fact_ids" in block && Array.isArray(block.fact_ids)) {
      for (const fid of block.fact_ids) {
        if (!validFactIds.has(fid)) {
          errors.push(
            `Block chứa fact_id không tồn tại trong brand_profile: "${fid}" [R-31]`
          );
        }
      }
    }
    if ("claim_label" in block && block.claim_label) {
      if (block.claim_label === "NEEDS_VERIFICATION") {
        errors.push(
          "Block chứa thông tin gắn nhãn NEEDS_VERIFICATION chưa được xác thực [R-31]"
        );
      } else if (block.claim_label === "VERIFIED") {
        const fids =
          "fact_ids" in block && Array.isArray(block.fact_ids)
            ? block.fact_ids
            : [];
        if (fids.length === 0 || fids.some((fid) => !validFactIds.has(fid))) {
          errors.push(
            "Block gắn nhãn VERIFIED nhưng thiếu hoặc sai fact_ids trong brand_profile [R-31]"
          );
        }
      }
    }
  }

  // 4.3 Kiểm tra mọi con số trong các đoạn văn/block có nhắc tới thương hiệu hoặc sản phẩm phải khớp brand_profile (R-31)
  const allowedNumbers = collectAllowedBrandNumbers(brand);
  for (const block of input.contentBlocks) {
    let blockText = "";
    if (block.type === "paragraph" || block.type === "callout") {
      blockText = block.text;
    } else if (block.type === "list") {
      blockText = block.items.join(" ");
    } else if (block.type === "table") {
      blockText = [
        block.caption ?? "",
        block.headers.join(" "),
        ...block.rows.map((r) => r.join(" ")),
      ].join(" ");
    } else if (block.type === "faq") {
      blockText = `${block.q} ${block.a}`;
    }
    if (!blockText) continue;

    // Nếu block được gắn nhãn rõ ràng là GENERAL_KNOWLEDGE và KHÔNG nhắc tới tên thương hiệu/sản phẩm
    // thì cho phép số liệu kiến thức phổ thông (ví dụ: 200 ml nước, 90 độ C)
    const isPureGeneralKnowledge =
      "claim_label" in block &&
      block.claim_label === "GENERAL_KNOWLEDGE" &&
      !blockMentionsBrandOrProduct(blockText, brand);

    if (isPureGeneralKnowledge) {
      continue;
    }

    const numsInBlock = extractNumbersFromText(blockText);
    for (const num of numsInBlock) {
      if (!allowedNumbers.has(num)) {
        errors.push(
          `Phát hiện số liệu "${num}" không có trong brand_profile (nghi vấn tự bịa số liệu/giá/thông số) [R-31]`
        );
      }
    }
  }

  return {
    code: "brand_facts_and_claims",
    ruleIds: ["R-18", "R-31", "R-32"],
    passed: errors.length === 0,
    message:
      errors.length === 0
        ? "Số liệu, sản phẩm, fact_ids khớp brand_profile và không chứa forbidden_claims."
        : errors.join("; "),
  };
}

/**
 * Kiểm tra 5: Mọi block image có asset_id tồn tại và alt không rỗng, <= 125 ký tự (R-17).
 */
export function checkImageBlocks(
  contentBlocks: ContentBlock[],
  assets: Pick<ArticleAssetRow, "id" | "alt_text">[]
): CheckItemResult {
  const errors: string[] = [];
  const validAssetIds = new Set(assets.map((a) => a.id));
  const imageBlocks = contentBlocks.filter(
    (b): b is Extract<ContentBlock, { type: "image" }> => b.type === "image"
  );

  imageBlocks.forEach((img, idx) => {
    if (!validAssetIds.has(img.asset_id)) {
      errors.push(
        `Block image #${idx + 1} tham chiếu asset_id "${img.asset_id}" không tồn tại trong bài [R-17]`
      );
    }
    const alt = img.alt.trim();
    if (!alt) {
      errors.push(`Block image #${idx + 1} có thuộc tính alt rỗng [R-17]`);
    } else if (alt.length > CHECK_CONFIG.IMAGE_ALT_MAX_CHARS) {
      errors.push(
        `Block image #${idx + 1} có alt dài ${alt.length} ký tự (vượt tối đa ${CHECK_CONFIG.IMAGE_ALT_MAX_CHARS} ký tự) [R-17]`
      );
    }
  });

  return {
    code: "image_blocks",
    ruleIds: ["R-17"],
    passed: errors.length === 0,
    message:
      errors.length === 0
        ? "Tất cả block ảnh đều có asset_id hợp lệ và alt đạt chuẩn."
        : errors.join("; "),
  };
}

/**
 * Kiểm tra 6: needs_info rỗng thì mới đạt (R-31, R-34).
 */
export function checkNeedsInfoEmpty(needsInfo: string[]): CheckItemResult {
  const nonEmpty = needsInfo.map((s) => s.trim()).filter(Boolean);
  return {
    code: "needs_info_empty",
    ruleIds: ["R-31", "R-34"],
    passed: nonEmpty.length === 0,
    message:
      nonEmpty.length === 0
        ? "Không có thông tin thiếu (needs_info rỗng)."
        : `Bài viết còn thiếu thông tin từ hồ sơ thương hiệu (needs_info): ${nonEmpty.join("; ")} [R-31, R-34]`,
  };
}

/**
 * Chạy toàn bộ 6 kiểm tra xác định bằng code kèm kiểm tra nhất quán chủ đề/thực thể và thang điểm 100 điểm (R-34, R-35).
 */
export function runAllArticleChecks(input: RunArticleChecksInput): CheckReport {
  const consistencyResult = validateArticleConsistencyAndEntities({
    topic: input.topic,
    primaryKeyword: input.primaryKeyword,
    secondaryKeywords: input.secondaryKeywords,
    seo: input.seo,
    contentBlocks: input.contentBlocks,
    brandProfile: input.brandProfile,
  });

  const seoMetaCheck = checkSeoTitleAndMeta(input);
  const structureCheck = checkStructureH2AndFaq(input.contentBlocks);
  const schemaCheck = checkSchemaConsistency(input);
  const brandCheck = checkBrandFactsAndForbiddenClaims(input);
  const imageCheck = checkImageBlocks(input.contentBlocks, input.assets);
  const needsInfoCheck = checkNeedsInfoEmpty(input.needsInfo);

  // Gộp các lỗi nhất quán chủ đề / Sapo / Meta Description vào seo_title_meta
  const topicMetaIssues = consistencyResult.issues.filter(
    (i) =>
      i.code === "TOPIC_TITLE_H1_MISMATCH" ||
      i.code === "TOPIC_META_DESC_MISMATCH" ||
      i.code === "TOPIC_SAPO_MISMATCH" ||
      i.code === "KEYWORD_STUFFING_BAIT"
  );
  if (topicMetaIssues.length > 0) {
    const extraMsg = topicMetaIssues
      .map((i) => `[${i.code} @ ${i.location}] ${i.message}`)
      .join("; ");
    seoMetaCheck.passed = false;
    seoMetaCheck.message = seoMetaCheck.message.endsWith("đạt chuẩn.")
      ? extraMsg
      : `${seoMetaCheck.message}; ${extraMsg}`;
  }

  // Gộp các lỗi lệch H2/Body và FAQ lệch chủ đề vào structure_h2_faq
  const structureFaqIssues = consistencyResult.issues.filter(
    (i) =>
      i.code === "TOPIC_HEADING_BODY_MISMATCH" ||
      i.code === "FAQ_OFF_TOPIC_ENTITY" ||
      i.code === "FAQ_UNVERIFIED_CLAIM"
  );
  if (structureFaqIssues.length > 0) {
    const extraMsg = structureFaqIssues
      .map((i) => `[${i.code} @ ${i.location}] ${i.message}`)
      .join("; ");
    structureCheck.passed = false;
    structureCheck.message = structureCheck.message.includes("đạt chuẩn")
      ? extraMsg
      : `${structureCheck.message}; ${extraMsg}`;
  }

  // Gộp các lỗi gán nhầm thông số sản phẩm / sai lệch fact_ids thực thể vào brand_facts_and_claims
  const entityFactIssues = consistencyResult.issues.filter(
    (i) =>
      i.code === "ENTITY_SPEC_MISATTRIBUTION" ||
      i.code === "ENTITY_FACT_MISMATCH" ||
      i.code === "FACT_UNVERIFIED_SPEC"
  );
  if (entityFactIssues.length > 0) {
    const extraMsg = entityFactIssues
      .map((i) => `[${i.code} @ ${i.location}] ${i.message}`)
      .join("; ");
    brandCheck.passed = false;
    brandCheck.message = brandCheck.message.includes("khớp brand_profile")
      ? extraMsg
      : `${brandCheck.message}; ${extraMsg}`;
  }

  const items: CheckItemResult[] = [
    seoMetaCheck,
    structureCheck,
    schemaCheck,
    brandCheck,
    imageCheck,
    needsInfoCheck,
  ];

  const qualityScore = computeArticleQualityRubric({
    primaryKeyword: input.primaryKeyword,
    seo: input.seo,
    contentBlocks: input.contentBlocks,
    needsInfo: input.needsInfo,
    brandProfile: input.brandProfile,
    assets: input.assets,
    checkItems: items,
    consistencyResult,
  });

  const passed =
    items.every((item) => item.passed) &&
    consistencyResult.passed &&
    !qualityScore.blocked_by_truth;

  return {
    passed,
    checked_at: new Date().toISOString(),
    items,
    needs_info: input.needsInfo.map((s) => s.trim()).filter(Boolean),
    quality_score: qualityScore,
  };
}

export { computeArticleQualityRubric } from "@/lib/checks/scorer";
export {
  buildProductEntityProfiles,
  validateArticleConsistencyAndEntities,
  type ConsistencyValidationInput,
  type ConsistencyValidationResult,
  type ProductEntityProfile,
  type ValidationIssue,
  type ValidationSeverity,
};

