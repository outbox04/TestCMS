import { slugifyVietnamese } from "@/lib/agent/worker";
import { buildArticleJsonLd } from "@/lib/seo/schema";
import {
  ArticleOutlinePayloadSchema,
  type ArticleAssetRow,
  type ArticleRow,
  type BrandProfileRow,
  type ContentBlock,
  type SearchIntent,
} from "@/lib/supabase/types";

/**
 * Định dạng đầu ra 11 trường chuẩn của CONTENT ORCHESTRATOR.
 */
export interface ContentOrchestratorOutput {
  job_id: string;
  website_id: string;
  brand_id: string;
  workflow_status:
    | "IN_PROGRESS"
    | "AWAITING_GATE_1_APPROVAL"
    | "AWAITING_IMAGE_UPLOAD"
    | "AWAITING_GATE_2_APPROVAL"
    | "NEEDS_HUMAN_REVIEW"
    | "SCHEDULED"
    | "PUBLISHED";
  current_agent: string;
  completed_agents: string[];
  pending_tasks: string[];
  quality_status: string;
  evidence_status:
    | "VERIFIED"
    | "NEEDS_HUMAN_REVIEW"
    | "PENDING_VERIFICATION";
  approval_required: boolean;
  final_artifact_reference: string | null;
}

export interface SuggestedInternalLink {
  anchor_text: string;
  target_url: string;
  target_article_id: string;
  reason: string;
}

/**
 * Định dạng bàn giao 4 phần chuẩn của WEBSITE CONTENT STANDARD AGENT.
 */
export interface WebsiteContentStandardDeliverable {
  orchestrator: ContentOrchestratorOutput;
  part_a_seo_metadata: {
    seo_title: string;
    meta_description: string;
    slug: string;
    primary_keyword: string;
    secondary_keywords: string[];
    search_intent: SearchIntent;
  };
  part_b_website_content: {
    h1: string;
    sapo: string | null;
    blocks_count: number;
    h2_headings: string[];
    h3_headings: string[];
    tables_count: number;
    faqs: Array<{ q: string; a: string }>;
  };
  part_c_seo_assets: {
    featured_image_id: string | null;
    in_article_images: Array<{
      asset_id: string;
      alt: string;
      caption?: string;
    }>;
    internal_links: SuggestedInternalLink[];
    schema_types: string[];
  };
  part_d_quality_report: {
    seo_score: number;
    geo_score: number;
    aeo_score: number;
    trust_score: number;
    ux_score: number;
    total_score: number;
    band: string;
    band_label: string;
    needs_verification: string[];
    errors_to_fix: string[];
    hard_blockers?: Array<{
      code: string;
      severity: string;
      location: string;
      message: string;
    }>;
    major_issues?: Array<{
      code: string;
      severity: string;
      location: string;
      message: string;
    }>;
    minor_warnings?: Array<{
      code: string;
      severity: string;
      location: string;
      message: string;
    }>;
    passed_checks?: string[];
  };
}

function collectArticleNeedsInfo(article: ArticleRow): string[] {
  const needs = new Set<string>();
  if (article.outline && !Array.isArray(article.outline)) {
    const parsed = ArticleOutlinePayloadSchema.safeParse(article.outline);
    if (parsed.success) {
      for (const n of parsed.data.needs_info) {
        if (n.trim()) needs.add(n.trim());
      }
    }
  }
  for (const n of article.seo?.needs_info ?? []) {
    if (n.trim()) needs.add(n.trim());
  }
  for (const n of article.check_report?.needs_info ?? []) {
    if (n.trim()) needs.add(n.trim());
  }
  return Array.from(needs);
}

/**
 * Dựng báo cáo trạng thái 11 trường của Content Orchestrator từ bản ghi bài viết và thương hiệu.
 */
export function buildOrchestratorJobStatus(
  article: ArticleRow,
  brand: BrandProfileRow | null,
  options?: { websiteId?: string; siteUrl?: string }
): ContentOrchestratorOutput {
  const siteUrl = (
    options?.siteUrl ??
    process.env.SITE_URL ??
    "https://example.com"
  ).replace(/\/+$/, "");

  const websiteId =
    options?.websiteId ??
    slugifyVietnamese(siteUrl.replace(/^https?:\/\//, "")) ??
    "website-main";

  const brandId = brand?.brand_name
    ? `brand-${slugifyVietnamese(brand.brand_name)}`
    : "brand-singleton";

  const needsInfo = collectArticleNeedsInfo(article);
  const blocks = Array.isArray(article.content_blocks)
    ? article.content_blocks
    : [];
  const hasUnverifiedBlock = blocks.some(
    (b) => "claim_label" in b && b.claim_label === "NEEDS_VERIFICATION"
  );
  const blockedByTruth = Boolean(
    article.check_report?.quality_score?.blocked_by_truth ||
      needsInfo.length > 0 ||
      hasUnverifiedBlock
  );

  let evidenceStatus: ContentOrchestratorOutput["evidence_status"] =
    "PENDING_VERIFICATION";
  if (blockedByTruth) {
    evidenceStatus = "NEEDS_HUMAN_REVIEW";
  } else if (blocks.length > 0 && article.checks_passed) {
    evidenceStatus = "VERIFIED";
  }

  const qualityStatus =
    article.check_report?.quality_score?.band ??
    (article.checks_passed
      ? "PASSED"
      : article.check_report
        ? "FAILED_CHECKS"
        : "NOT_EVALUATED");

  let workflowStatus: ContentOrchestratorOutput["workflow_status"] =
    "IN_PROGRESS";
  let currentAgent = "Content Orchestrator";
  let completedAgents: string[] = ["Content Orchestrator"];
  let pendingTasks: string[] = [];
  let approvalRequired = true;

  switch (article.status) {
    case "outline_draft":
      workflowStatus = "IN_PROGRESS";
      currentAgent = "Research Agent & SEO Strategist";
      completedAgents = ["Content Orchestrator"];
      pendingTasks = [
        "Bước 3–5: Nghiên cứu từ khóa, phân tích Search Intent và lập Content Outline",
        "Chờ duyệt Cổng 1 (outline_review)",
      ];
      break;

    case "outline_review":
      workflowStatus = blockedByTruth
        ? "NEEDS_HUMAN_REVIEW"
        : "AWAITING_GATE_1_APPROVAL";
      currentAgent = "Human Reviewer (Gate 1)";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
      ];
      pendingTasks = [
        "Con người kiểm tra và phê duyệt dàn ý tại Cổng 1 (outline_review)",
        "Tải ảnh minh họa (awaiting_images)",
      ];
      break;

    case "awaiting_images":
      workflowStatus = "AWAITING_IMAGE_UPLOAD";
      currentAgent = "Human Editor (Image Upload)";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
      ];
      pendingTasks = [
        "Tải lên ít nhất 1 ảnh minh họa (sharp resize <= 1568px + sha256)",
        "Phân tích ảnh và viết bài chuẩn SEO/GEO/AEO",
      ];
      break;

    case "analyzing_images":
      workflowStatus = "IN_PROGRESS";
      currentAgent = "Vision Image Analyzer";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
      ];
      pendingTasks = [
        "Phân tích thị giác ảnh và lọc tên thương hiệu (R-10..R-17)",
        "Viết bài và kiểm chứng sự thật",
      ];
      break;

    case "writing":
      workflowStatus = blockedByTruth ? "NEEDS_HUMAN_REVIEW" : "IN_PROGRESS";
      currentAgent = blockedByTruth
        ? "Fact Checker (Blocked — Awaiting Brand Data)"
        : "Content Writer & GEO/AEO Agent";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
        "Vision Image Analyzer",
      ];
      pendingTasks = blockedByTruth
        ? [
            "Con người bổ sung dữ kiện còn thiếu vào brand_profile (needs_info)",
            "Chạy lại bước viết và kiểm định tự động",
          ]
        : [
            "Bước 6–9: Viết bài, tối ưu GEO/AEO, kiểm chứng sự thật và chấm điểm SEO Auditor",
          ];
      break;

    case "draft_ready":
      workflowStatus = "IN_PROGRESS";
      currentAgent = "SEO Auditor";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
        "Vision Image Analyzer",
        "Content Writer",
        "GEO & AEO Agent",
        "Fact Checker",
      ];
      pendingTasks = ["Chuyển bản nháp sang Cổng 2 (preview_review)"];
      break;

    case "preview_review":
      workflowStatus = blockedByTruth
        ? "NEEDS_HUMAN_REVIEW"
        : "AWAITING_GATE_2_APPROVAL";
      currentAgent = "Human Reviewer (Gate 2)";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
        "Vision Image Analyzer",
        "Content Writer",
        "GEO & AEO Agent",
        "Fact Checker",
        "SEO Auditor",
        "CMS Draft Publisher",
      ];
      pendingTasks = [
        "Bước 11: Chờ con người phê duyệt xuất bản hoặc lên lịch tại Cổng 2 (preview_review)",
      ];
      break;

    case "scheduled":
      workflowStatus = "SCHEDULED";
      currentAgent = "CMS Cron Publisher";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
        "Vision Image Analyzer",
        "Content Writer",
        "GEO & AEO Agent",
        "Fact Checker",
        "SEO Auditor",
        "CMS Draft Publisher",
        "Human Reviewer",
      ];
      pendingTasks = [
        `Tự động xuất bản khi đến lịch hẹn (${article.scheduled_at ?? "scheduled"})`,
      ];
      approvalRequired = false;
      break;

    case "published":
      workflowStatus = "PUBLISHED";
      currentAgent = "Completed";
      completedAgents = [
        "Content Orchestrator",
        "Research Agent",
        "SEO Strategist",
        "Content Architect",
        "Vision Image Analyzer",
        "Content Writer",
        "GEO & AEO Agent",
        "Fact Checker",
        "SEO Auditor",
        "CMS Publisher",
        "Human Reviewer",
      ];
      pendingTasks = [];
      approvalRequired = false;
      break;
  }

  const finalArtifactRef =
    article.status === "published" && article.slug
      ? `${siteUrl}/blog/${article.slug}`
      : `/admin/articles/${article.id}`;

  return {
    job_id: article.id,
    website_id: websiteId,
    brand_id: brandId,
    workflow_status: workflowStatus,
    current_agent: currentAgent,
    completed_agents: completedAgents,
    pending_tasks: pendingTasks,
    quality_status: qualityStatus,
    evidence_status: evidenceStatus,
    approval_required: approvalRequired,
    final_artifact_reference: finalArtifactRef,
  };
}

/**
 * Đề xuất Internal Links an toàn từ các bài viết đã xuất bản thực tế trên hệ thống (R-23).
 * Tuyệt đối không tự bịa URL chưa tồn tại.
 */
export function suggestInternalLinks(
  currentArticle: Pick<
    ArticleRow,
    "id" | "topic" | "primary_keyword" | "secondary_keywords"
  >,
  publishedArticles: Array<
    Pick<ArticleRow, "id" | "topic" | "slug" | "primary_keyword" | "seo" | "status">
  >
): SuggestedInternalLink[] {
  const suggestions: SuggestedInternalLink[] = [];

  for (const candidate of publishedArticles) {
    if (
      candidate.id === currentArticle.id ||
      candidate.status !== "published" ||
      !candidate.slug
    ) {
      continue;
    }

    const anchorText =
      candidate.seo?.title?.trim() ||
      candidate.primary_keyword?.trim() ||
      candidate.topic.trim();

    suggestions.push({
      anchor_text: anchorText,
      target_url: `/blog/${candidate.slug}`,
      target_article_id: candidate.id,
      reason: `Liên kết nội bộ tới bài đã xuất bản cùng cụm chủ đề (Topic Cluster — R-23)`,
    });
  }

  return suggestions.slice(0, 5);
}

/**
 * Tổng hợp báo cáo bàn giao 4 phần (PHẦN A – D) theo chuẩn Website Content Standard Agent.
 */
export function buildWebsiteContentStandardExport(params: {
  article: ArticleRow;
  brand: BrandProfileRow | null;
  assets: ArticleAssetRow[];
  publishedArticles: Array<
    Pick<ArticleRow, "id" | "topic" | "slug" | "primary_keyword" | "seo" | "status">
  >;
  siteUrl?: string;
}): WebsiteContentStandardDeliverable {
  const { article, brand, assets, publishedArticles, siteUrl } = params;
  const orchestrator = buildOrchestratorJobStatus(article, brand, { siteUrl });

  let searchIntent: SearchIntent = "informational";
  if (article.outline && !Array.isArray(article.outline)) {
    const parsed = ArticleOutlinePayloadSchema.safeParse(article.outline);
    if (parsed.success && parsed.data.search_intent) {
      searchIntent = parsed.data.search_intent;
    }
  }
  if (article.seo?.search_intent) {
    searchIntent = article.seo.search_intent;
  }

  const blocks: ContentBlock[] = Array.isArray(article.content_blocks)
    ? article.content_blocks
    : [];

  const firstParagraph = blocks.find(
    (b): b is Extract<ContentBlock, { type: "paragraph" }> =>
      b.type === "paragraph"
  );
  const h2Headings = blocks
    .filter((b): b is Extract<ContentBlock, { type: "h2" }> => b.type === "h2")
    .map((b) => b.text);
  const h3Headings = blocks
    .filter((b): b is Extract<ContentBlock, { type: "h3" }> => b.type === "h3")
    .map((b) => b.text);
  const tablesCount = blocks.filter((b) => b.type === "table").length;
  const faqs = blocks
    .filter(
      (b): b is Extract<ContentBlock, { type: "faq" }> => b.type === "faq"
    )
    .map((b) => ({ q: b.q, a: b.a }));
  const inArticleImages = blocks
    .filter(
      (b): b is Extract<ContentBlock, { type: "image" }> => b.type === "image"
    )
    .map((b) => ({
      asset_id: b.asset_id,
      alt: b.alt,
      caption: b.caption,
    }));

  const seo = article.seo ?? {
    title: article.topic,
    meta_description: article.topic,
  };
  const slug = article.slug ?? slugifyVietnamese(article.topic);

  const jsonLd = buildArticleJsonLd({
    siteUrl: siteUrl ?? process.env.SITE_URL ?? "https://example.com",
    slug,
    seo,
    contentBlocks: blocks,
    brandName: brand?.brand_name ?? "Thương hiệu Demo",
    publishedAt: article.published_at ?? article.created_at,
    updatedAt: article.updated_at,
  });

  const schemaTypes = jsonLd["@graph"].map((node) => node["@type"]);
  const internalLinks = suggestInternalLinks(article, publishedArticles);

  const qScore = article.check_report?.quality_score;
  const needsVerificationSet = new Set<string>(collectArticleNeedsInfo(article));
  for (const hb of qScore?.hard_blockers ?? []) {
    if (
      hb.code.includes("ENTITY_") ||
      hb.code.includes("FACT_") ||
      hb.code.includes("TOPIC_")
    ) {
      needsVerificationSet.add(`[${hb.code} @ ${hb.location}] ${hb.message}`);
    }
  }

  const errorsSet = new Set<string>();
  for (const hb of qScore?.hard_blockers ?? []) {
    errorsSet.add(`[HARD_BLOCKER:${hb.code} @ ${hb.location}] ${hb.message}`);
  }
  for (const mj of qScore?.major_issues ?? []) {
    errorsSet.add(`[MAJOR_ISSUE:${mj.code} @ ${mj.location}] ${mj.message}`);
  }
  for (const i of article.check_report?.items ?? []) {
    if (!i.passed) {
      errorsSet.add(`[${i.code}] ${i.message}`);
    }
  }

  const needsVerification = Array.from(needsVerificationSet);
  const errorsToFix = Array.from(errorsSet);

  return {
    orchestrator,
    part_a_seo_metadata: {
      seo_title: seo.title,
      meta_description: seo.meta_description,
      slug,
      primary_keyword: article.primary_keyword ?? article.topic,
      secondary_keywords: article.secondary_keywords ?? [],
      search_intent: searchIntent,
    },
    part_b_website_content: {
      h1: seo.title,
      sapo: firstParagraph?.text ?? null,
      blocks_count: blocks.length,
      h2_headings: h2Headings,
      h3_headings: h3Headings,
      tables_count: tablesCount,
      faqs,
    },
    part_c_seo_assets: {
      featured_image_id: assets[0]?.id ?? null,
      in_article_images: inArticleImages,
      internal_links: internalLinks,
      schema_types: schemaTypes,
    },
    part_d_quality_report: {
      seo_score: qScore?.seo_score ?? 0,
      geo_score: qScore?.geo_score ?? 0,
      aeo_score: qScore?.aeo_score ?? 0,
      trust_score: qScore?.trust_score ?? 0,
      ux_score: qScore?.ux_score ?? 0,
      total_score: qScore?.total_score ?? 0,
      band: qScore?.band ?? "NOT_EVALUATED",
      band_label: qScore?.band_label ?? "Chưa chấm điểm",
      needs_verification: needsVerification,
      errors_to_fix: errorsToFix,
      hard_blockers: qScore?.hard_blockers ?? [],
      major_issues: qScore?.major_issues ?? [],
      minor_warnings: qScore?.minor_warnings ?? [],
      passed_checks: qScore?.passed_checks ?? [],
    },
  };
}

