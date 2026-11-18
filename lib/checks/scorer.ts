import { CHECK_CONFIG } from "@/lib/checks/config";
import type { ConsistencyValidationResult } from "@/lib/checks/consistency";
import { countWords } from "@/lib/seo/schema";
import { blockMentionsBrandOrProduct } from "@/lib/writing-engine/fact-verifier";
import type {
  ArticleAssetRow,
  ArticleSeo,
  BrandProfileRow,
  CheckItemResult,
  ContentBlock,
  QualityRubricBand,
  QualityRubricReport,
  QualityValidationFinding,
} from "@/lib/supabase/types";

export interface ComputeQualityRubricInput {
  primaryKeyword: string;
  seo: ArticleSeo;
  contentBlocks: ContentBlock[];
  needsInfo: string[];
  brandProfile: BrandProfileRow;
  assets: Pick<ArticleAssetRow, "id" | "alt_text">[];
  checkItems: CheckItemResult[];
  consistencyResult?: ConsistencyValidationResult;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Chấm điểm chất lượng bài viết theo thang 100 điểm của Website Content Standard Agent:
 * - A. SEO: 25 điểm
 * - B. GEO: 25 điểm
 * - C. AEO: 20 điểm
 * - D. TRUST: 15 điểm
 * - E. UX & CONVERSION: 15 điểm
 *
 * Bảo vệ Quality Scoring (Nhiệm vụ 3):
 * - Điểm cuối cùng bắt buộc tính 100% từ kết quả kiểm tra bằng code (không dùng điểm do AI tự chấm).
 * - Phân biệt rõ: hard_blockers, major_issues, minor_warnings, passed_checks.
 * - Nếu có bất kỳ hard_blocker nào: KHÔNG ĐƯỢC trả về 100/100 và KHÔNG ĐƯỢC trả về READY_TO_PUBLISH.
 */
export function computeArticleQualityRubric(
  input: ComputeQualityRubricInput
): QualityRubricReport {
  const advisoryNotes: string[] = [];
  const hardBlockers: QualityValidationFinding[] = [];
  const majorIssues: QualityValidationFinding[] = [];
  const minorWarnings: QualityValidationFinding[] = [];
  const passedChecks: string[] = [];

  const consistencyIssues = input.consistencyResult?.issues ?? [];
  for (const issue of consistencyIssues) {
    const finding: QualityValidationFinding = {
      code: issue.code,
      severity: issue.severity,
      location: issue.location,
      message: issue.message,
    };
    if (issue.severity === "HARD_BLOCKER") {
      hardBlockers.push(finding);
    } else if (issue.severity === "MAJOR_ISSUE") {
      majorIssues.push(finding);
    } else {
      minorWarnings.push(finding);
    }
    advisoryNotes.push(`[${issue.code} @ ${issue.location}] ${issue.message}`);
  }

  for (const item of input.checkItems) {
    if (item.passed) {
      passedChecks.push(item.code);
    } else if (
      item.code === "brand_facts_and_claims" ||
      item.code === "needs_info_empty" ||
      item.code === "schema_jsonld"
    ) {
      hardBlockers.push({
        code: item.code,
        severity: "HARD_BLOCKER",
        location: item.code,
        message: item.message,
      });
    } else if (item.code !== "content_entity_consistency") {
      majorIssues.push({
        code: item.code,
        severity: "MAJOR_ISSUE",
        location: item.code,
        message: item.message,
      });
    }
  }

  const pk = normalize(input.primaryKeyword);
  const title = input.seo.title.trim();
  const metaDesc = input.seo.meta_description.trim();
  const blocks = input.contentBlocks;

  const hasMetaMismatch = consistencyIssues.some(
    (i) => i.code === "TOPIC_META_DESC_MISMATCH"
  );
  const hasSapoMismatch = consistencyIssues.some(
    (i) =>
      i.code === "TOPIC_SAPO_MISMATCH" || i.code === "KEYWORD_STUFFING_BAIT"
  );
  const hasHeadingBodyMismatch = consistencyIssues.some(
    (i) => i.code === "TOPIC_HEADING_BODY_MISMATCH"
  );
  const hasEntityMisattribution = consistencyIssues.some(
    (i) =>
      i.code === "ENTITY_SPEC_MISATTRIBUTION" ||
      i.code === "ENTITY_FACT_MISMATCH" ||
      i.code === "FACT_UNVERIFIED_SPEC"
  );
  const hasFaqOffTopic = consistencyIssues.some(
    (i) =>
      i.code === "FAQ_OFF_TOPIC_ENTITY" || i.code === "FAQ_UNVERIFIED_CLAIM"
  );

  // =========================================================================
  // A. SEO (25 điểm)
  // =========================================================================
  let seoScore = 0;

  if (
    title.length >= CHECK_CONFIG.TITLE_MIN_CHARS &&
    title.length <= CHECK_CONFIG.TITLE_MAX_CHARS
  ) {
    seoScore += 5;
  } else {
    advisoryNotes.push(
      `[SEO] Độ dài SEO Title (${title.length} ký tự) nên trong khoảng ${CHECK_CONFIG.TITLE_MIN_CHARS}–${CHECK_CONFIG.TITLE_MAX_CHARS} ký tự.`
    );
  }

  if (
    metaDesc.length >= CHECK_CONFIG.META_DESC_MIN_CHARS &&
    metaDesc.length <= CHECK_CONFIG.META_DESC_MAX_CHARS &&
    !hasMetaMismatch
  ) {
    seoScore += 5;
  } else if (!hasMetaMismatch) {
    advisoryNotes.push(
      `[SEO] Độ dài Meta Description (${metaDesc.length} ký tự) nên trong khoảng ${CHECK_CONFIG.META_DESC_MIN_CHARS}–${CHECK_CONFIG.META_DESC_MAX_CHARS} ký tự.`
    );
  }

  if (pk && normalize(title).includes(pk)) {
    seoScore += 5;
  } else {
    advisoryNotes.push(
      `[SEO] SEO Title chưa chứa nguyên văn từ khóa chính "${input.primaryKeyword}".`
    );
  }

  const introText = blocks
    .filter(
      (
        b
      ): b is Extract<ContentBlock, { type: "paragraph" | "h2" | "callout" }> =>
        b.type === "paragraph" || b.type === "h2" || b.type === "callout"
    )
    .map((b) => b.text)
    .join(" ")
    .trim()
    .split(/\s+/)
    .slice(0, CHECK_CONFIG.PRIMARY_KEYWORD_INTRO_WORDS)
    .join(" ");

  if (pk && normalize(introText).includes(pk) && !hasSapoMismatch) {
    seoScore += 5;
  } else if (!hasSapoMismatch) {
    advisoryNotes.push(
      `[SEO] Từ khóa chính "${input.primaryKeyword}" chưa xuất hiện tự nhiên trong 100 từ đầu tiên.`
    );
  }

  const h2Blocks = blocks.filter(
    (b): b is Extract<ContentBlock, { type: "h2" }> => b.type === "h2"
  );
  if (h2Blocks.length >= CHECK_CONFIG.MIN_H2_COUNT && !hasHeadingBodyMismatch) {
    seoScore += 5;
  } else if (h2Blocks.length < CHECK_CONFIG.MIN_H2_COUNT) {
    advisoryNotes.push(
      `[SEO] Bài viết cần tối thiểu ${CHECK_CONFIG.MIN_H2_COUNT} thẻ H2.`
    );
  }

  // =========================================================================
  // B. GEO (25 điểm)
  // =========================================================================
  let geoScore = 0;

  const fullText = blocks
    .map((b) => {
      if ("text" in b) return b.text;
      if (b.type === "list") return b.items.join(" ");
      if (b.type === "table")
        return `${b.headers.join(" ")} ${b.rows.map((r) => r.join(" ")).join(" ")}`;
      if (b.type === "faq") return `${blockFaqText(b)}`;
      return "";
    })
    .join(" ");

  if (
    blockMentionsBrandOrProduct(fullText, input.brandProfile) &&
    !hasSapoMismatch &&
    !hasEntityMisattribution
  ) {
    geoScore += 7;
  } else if (!hasSapoMismatch && !hasEntityMisattribution) {
    advisoryNotes.push(
      "[GEO] Bài viết chưa xác định rõ Entity thương hiệu hoặc sản phẩm."
    );
  }

  const validFactIds = new Set(
    (input.brandProfile.facts ?? []).map((f) => f.id)
  );
  const usedValidFacts = new Set<string>();
  for (const b of blocks) {
    if ("fact_ids" in b && Array.isArray(b.fact_ids)) {
      for (const fid of b.fact_ids) {
        if (validFactIds.has(fid)) {
          usedValidFacts.add(fid);
        }
      }
    }
  }

  if (
    usedValidFacts.size >= 2 &&
    !hasEntityMisattribution &&
    !hasHeadingBodyMismatch
  ) {
    geoScore += 10;
  } else if (usedValidFacts.size >= 1 && !hasEntityMisattribution) {
    geoScore += 5;
    advisoryNotes.push(
      "[GEO] Nên dẫn chứng từ 2 dữ kiện xác thực (fact_ids) đúng chủ đề trở lên."
    );
  } else if (!hasEntityMisattribution) {
    advisoryNotes.push(
      "[GEO] Bài viết chưa gắn dữ kiện xác thực (fact_ids) nào từ hồ sơ thương hiệu."
    );
  }

  const hasStructuredGeoBlock = blocks.some(
    (b) => b.type === "list" || b.type === "table" || b.type === "callout"
  );
  if (hasStructuredGeoBlock) {
    geoScore += 8;
  } else {
    minorWarnings.push({
      code: "GEO_MISSING_STRUCTURED_BLOCK",
      severity: "MINOR_WARNING",
      location: "content_blocks",
      message:
        "Nên bổ sung danh sách (list), bảng biểu (table) hoặc khối tóm tắt (callout) để hệ thống AI dễ trích xuất.",
    });
    advisoryNotes.push(
      "[GEO] Nên bổ sung danh sách (list), bảng biểu (table) hoặc khối tóm tắt (callout) để hệ thống AI dễ trích xuất."
    );
  }

  // =========================================================================
  // C. AEO (20 điểm)
  // =========================================================================
  let aeoScore = 0;

  let h2WithDirectAnswer = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === "h2") {
      const nextBlock = blocks[i + 1];
      if (
        nextBlock &&
        nextBlock.type === "paragraph" &&
        countWords(nextBlock.text) >= 8
      ) {
        h2WithDirectAnswer++;
      }
    }
  }

  if (
    h2Blocks.length > 0 &&
    h2WithDirectAnswer === h2Blocks.length &&
    !hasSapoMismatch &&
    !hasHeadingBodyMismatch
  ) {
    aeoScore += 8;
  } else if (h2WithDirectAnswer > 0 && !hasHeadingBodyMismatch) {
    aeoScore += 4;
    advisoryNotes.push(
      "[AEO] Một số thẻ H2 chưa có đoạn trả lời trực tiếp đúng chủ đề ngay phía dưới."
    );
  } else {
    advisoryNotes.push(
      "[AEO] Cần đặt câu trả lời trọng tâm (paragraph) đúng chủ đề ngay dưới mỗi thẻ H2."
    );
  }

  const faqCheck = input.checkItems.find(
    (c) => c.code === "structure_h2_faq"
  );
  const faqBlocks = blocks.filter(
    (b): b is Extract<ContentBlock, { type: "faq" }> => b.type === "faq"
  );
  if (faqCheck?.passed && faqBlocks.length >= 1 && !hasFaqOffTopic) {
    aeoScore += 8;
  } else if (!hasFaqOffTopic) {
    advisoryNotes.push(
      "[AEO] Khối FAQ chưa đạt chuẩn (cần 1–6 câu hỏi liên quan trực tiếp chủ đề, câu trả lời < 300 từ)."
    );
  }

  if (blocks.some((b) => b.type === "list" || b.type === "table")) {
    aeoScore += 4;
  } else {
    advisoryNotes.push(
      "[AEO] Nên có ít nhất 1 danh sách (list) hoặc bảng (table) để tối ưu Featured Snippet."
    );
  }

  // =========================================================================
  // D. TRUST (15 điểm)
  // =========================================================================
  let trustScore = 0;
  const brandFactsCheck = input.checkItems.find(
    (c) => c.code === "brand_facts_and_claims"
  );
  const needsInfoCheck = input.checkItems.find(
    (c) => c.code === "needs_info_empty"
  );

  const hasForbiddenClaimError =
    brandFactsCheck?.message.includes("tuyên bố cấm") ?? false;
  if (!hasForbiddenClaimError) {
    trustScore += 5;
  } else {
    advisoryNotes.push(
      "[TRUST] Bài viết vi phạm tuyên bố cấm (forbidden_claims) của thương hiệu."
    );
  }

  if (
    brandFactsCheck?.passed &&
    !hasEntityMisattribution &&
    !hasMetaMismatch &&
    !hasSapoMismatch &&
    !hasHeadingBodyMismatch
  ) {
    trustScore += 5;
  } else {
    advisoryNotes.push(
      "[TRUST] Phát hiện thông số sản phẩm bị gán nhầm, lệch chủ đề hoặc chưa khớp với hồ sơ thương hiệu."
    );
  }

  const hasNeedsVerificationBlock = blocks.some(
    (b) => "claim_label" in b && b.claim_label === "NEEDS_VERIFICATION"
  );
  if (needsInfoCheck?.passed && !hasNeedsVerificationBlock) {
    trustScore += 5;
  } else {
    advisoryNotes.push(
      "[TRUST] Bài viết còn thông tin thuộc diện NEEDS_VERIFICATION / needs_info cần con người xác minh."
    );
  }

  // =========================================================================
  // E. UX & CONVERSION (15 điểm)
  // =========================================================================
  let uxScore = 0;

  const paragraphBlocks = blocks.filter(
    (b): b is Extract<ContentBlock, { type: "paragraph" }> =>
      b.type === "paragraph"
  );
  const longParagraphs = paragraphBlocks.filter(
    (p) => countWords(p.text) > 120
  );
  if (paragraphBlocks.length > 0 && longParagraphs.length === 0) {
    uxScore += 5;
  } else if (paragraphBlocks.length > 0) {
    uxScore += 2;
    minorWarnings.push({
      code: "UX_LONG_PARAGRAPH",
      severity: "MINOR_WARNING",
      location: "content_blocks",
      message: `Có ${longParagraphs.length} đoạn văn dài trên 120 từ; nên tách ngắn để dễ đọc.`,
    });
    advisoryNotes.push(
      `[UX] Có ${longParagraphs.length} đoạn văn dài trên 120 từ; nên tách ngắn để dễ đọc.`
    );
  }

  const imageCheck = input.checkItems.find((c) => c.code === "image_blocks");
  const imageBlocks = blocks.filter((b) => b.type === "image");
  if (imageCheck?.passed && imageBlocks.length >= 1) {
    uxScore += 5;
  } else {
    advisoryNotes.push(
      "[UX] Cần nhúng ít nhất 1 hình ảnh minh họa hợp lệ có mô tả ALT <= 125 ký tự."
    );
  }

  if (
    h2Blocks.length >= 2 &&
    paragraphBlocks.length >= 2 &&
    faqBlocks.length >= 1
  ) {
    uxScore += 5;
  } else {
    advisoryNotes.push(
      "[UX] Bố cục bài viết cần đầy đủ H2, đoạn văn giải thích và phần FAQ."
    );
  }

  const totalScore = seoScore + geoScore + aeoScore + trustScore + uxScore;

  // Quy tắc chặn cứng (Hard Blocker):
  // Nếu có bất kỳ hard_blocker nào (bao gồm lỗi sự thật, thiếu dữ liệu, hoặc lệch chủ đề/gán nhầm thông số sản phẩm),
  // KHÔNG ĐƯỢC trả về READY_TO_PUBLISH và KHÔNG ĐƯỢC qua cổng kiểm duyệt cuối.
  const blockedByTruth = Boolean(
    hardBlockers.length > 0 ||
      !brandFactsCheck?.passed ||
      !needsInfoCheck?.passed ||
      hasNeedsVerificationBlock
  );

  let band: QualityRubricBand;
  let bandLabel: string;

  if (blockedByTruth) {
    band = "BLOCKED_BY_TRUTH";
    bandLabel =
      "Bị chặn do Hard Blocker (lỗi nhất quán chủ đề / gán nhầm thông số / thiếu dữ liệu xác thực)";
  } else if (majorIssues.length > 0) {
    band = totalScore >= 70 ? "MAJOR_OPTIMIZATION" : "REWRITE_REQUIRED";
    bandLabel =
      "Chưa đủ điều kiện xuất bản: Cần khắc phục các lỗi cấu trúc/SEO chính (Major Issues)";
  } else if (totalScore >= 90) {
    band = "READY_TO_PUBLISH";
    bandLabel = "90–100: Đủ điều kiện đề xuất xuất bản";
  } else if (totalScore >= 80) {
    band = "MINOR_EDITS";
    bandLabel = "80–89: Cần chỉnh sửa nhẹ một số nội dung";
  } else if (totalScore >= 70) {
    band = "MAJOR_OPTIMIZATION";
    bandLabel = "70–79: Cần tối ưu đáng kể";
  } else {
    band = "REWRITE_REQUIRED";
    bandLabel = "Dưới 70: Phải viết lại hoặc nghiên cứu bổ sung";
  }

  return {
    seo_score: seoScore,
    geo_score: geoScore,
    aeo_score: aeoScore,
    trust_score: trustScore,
    ux_score: uxScore,
    total_score: totalScore,
    band,
    band_label: bandLabel,
    blocked_by_truth: blockedByTruth,
    advisory_notes: advisoryNotes,
    hard_blockers: hardBlockers,
    major_issues: majorIssues,
    minor_warnings: minorWarnings,
    passed_checks: passedChecks,
  };
}

function blockFaqText(b: Extract<ContentBlock, { type: "faq" }>): string {
  return `${b.q} ${b.a}`;
}
