import { beforeEach, describe, expect, it } from "vitest";
import { getDemoState, resetDemoState } from "@/lib/supabase/local-demo-store";
import {
  buildNonOverlappingTopicSchedule,
  buildOrchestratorJobStatus,
  buildWebsiteContentStandardExport,
  suggestInternalLinks,
} from "@/lib/writing-engine";

describe("tests/phase3-orchestrator.test.ts — Kiểm thử Phase 3: Content Orchestrator Output 11 trường, Internal Links & Bàn giao 4 Phần", () => {
  beforeEach(() => {
    resetDemoState();
  });

  it("buildOrchestratorJobStatus xuất đúng 11 trường chuẩn cho các trạng thái published, preview_review và writing (NEEDS_HUMAN_REVIEW)", () => {
    const state = getDemoState();
    const publishedArt = state.articles.find((a) => a.status === "published")!;
    const gate2Art = state.articles.find((a) => a.status === "preview_review")!;
    const blockedWritingArt = state.articles.find(
      (a) => a.status === "writing"
    )!;

    // 1. Bài đã published
    const pubOut = buildOrchestratorJobStatus(
      publishedArt,
      state.brandProfile,
      { siteUrl: "https://lumibrew.vn" }
    );
    expect(pubOut.job_id).toBe(publishedArt.id);
    expect(pubOut.website_id).toBe("lumibrew-vn");
    expect(pubOut.brand_id).toBe("brand-lumibrew-viet-nam");
    expect(pubOut.workflow_status).toBe("PUBLISHED");
    expect(pubOut.evidence_status).toBe("VERIFIED");
    expect(pubOut.approval_required).toBe(false);
    expect(pubOut.final_artifact_reference).toBe(
      `https://lumibrew.vn/blog/${publishedArt.slug}`
    );

    // 2. Bài ở Cổng 2 (preview_review) -> bắt buộc approval_required = true
    const gate2Out = buildOrchestratorJobStatus(gate2Art, state.brandProfile);
    expect(gate2Out.workflow_status).toBe("AWAITING_GATE_2_APPROVAL");
    expect(gate2Out.current_agent).toBe("Human Reviewer (Gate 2)");
    expect(gate2Out.approval_required).toBe(true);
    expect(gate2Out.evidence_status).toBe("VERIFIED");

    // 3. Bài bị chặn do thiếu dữ liệu bảo hành (needs_info khác rỗng) -> NEEDS_HUMAN_REVIEW
    const blockedOut = buildOrchestratorJobStatus(
      blockedWritingArt,
      state.brandProfile
    );
    expect(blockedOut.workflow_status).toBe("NEEDS_HUMAN_REVIEW");
    expect(blockedOut.evidence_status).toBe("NEEDS_HUMAN_REVIEW");
    expect(blockedOut.quality_status).toBe("BLOCKED_BY_TRUTH");
    expect(blockedOut.approval_required).toBe(true);
  });

  it("suggestInternalLinks chỉ gợi ý liên kết tới các bài đã xuất bản thật (status='published') và loại trừ chính nó (R-23)", () => {
    const state = getDemoState();
    const gate2Art = state.articles.find((a) => a.status === "preview_review")!;
    const publishedArt = state.articles.find((a) => a.status === "published")!;

    const linksForGate2 = suggestInternalLinks(gate2Art, state.articles);
    expect(linksForGate2.length).toBeGreaterThan(0);
    expect(linksForGate2[0].target_url).toBe(`/blog/${publishedArt.slug}`);
    expect(linksForGate2.some((l) => l.target_article_id === gate2Art.id)).toBe(
      false
    );

    // Bài published tự gọi sẽ không tự trỏ về chính nó
    const linksForPublished = suggestInternalLinks(
      publishedArt,
      state.articles
    );
    expect(
      linksForPublished.some((l) => l.target_article_id === publishedArt.id)
    ).toBe(false);
  });

  it("buildWebsiteContentStandardExport xuất đầy đủ 4 phần (PHẦN A – D) và đối tượng orchestrator", () => {
    const state = getDemoState();
    const gate2Art = state.articles.find((a) => a.status === "preview_review")!;
    const assets = state.articleAssets.filter(
      (a) => a.article_id === gate2Art.id
    );

    const deliverable = buildWebsiteContentStandardExport({
      article: gate2Art,
      brand: state.brandProfile,
      assets,
      publishedArticles: state.articles,
      siteUrl: "https://lumibrew.vn",
    });

    expect(deliverable.orchestrator.job_id).toBe(gate2Art.id);
    expect(deliverable.part_a_seo_metadata.primary_keyword).toBe(
      "LumiGrind Pro G2"
    );
    expect(deliverable.part_b_website_content.h2_headings.length).toBe(2);
    expect(deliverable.part_b_website_content.faqs.length).toBe(1);
    expect(deliverable.part_c_seo_assets.internal_links.length).toBe(1);
    expect(deliverable.part_c_seo_assets.schema_types).toEqual([
      "Article",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(deliverable.part_d_quality_report.total_score).toBe(88);
    expect(deliverable.part_d_quality_report.band).toBe("MINOR_EDITS");
  });

  it("buildNonOverlappingTopicSchedule chống trùng lặp chủ đề đã có (R-07 anti-cannibalization) khi bấm Lập lịch bằng AI nhiều lần", () => {
    const state = getDemoState();
    const existingTopics = state.articles.map((a) => a.topic);

    const batch1 = buildNonOverlappingTopicSchedule(
      state.brandProfile,
      existingTopics,
      3
    );
    expect(batch1).toHaveLength(3);

    // Không chủ đề nào trong batch1 trùng với các bài mẫu ban đầu
    for (const item of batch1) {
      expect(existingTopics).not.toContain(item.topic);
    }

    // Gọi lần 2 tiếp theo cũng trả về 3 chủ đề hoàn toàn mới không trùng batch1
    const afterBatch1 = [...existingTopics, ...batch1.map((b) => b.topic)];
    const batch2 = buildNonOverlappingTopicSchedule(
      state.brandProfile,
      afterBatch1,
      3
    );
    expect(batch2).toHaveLength(3);
    for (const item of batch2) {
      expect(afterBatch1).not.toContain(item.topic);
    }
  });
});
