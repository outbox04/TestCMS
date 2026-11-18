import { beforeEach, describe, expect, it } from "vitest";
import { saveAndValidateArticleContent } from "@/app/admin/articles/[id]/actions";
import { runAllArticleChecks } from "@/lib/checks";
import {
  createLocalDemoSupabaseClient,
  getDemoState,
  resetDemoState,
} from "@/lib/supabase/local-demo-store";
import type { ContentBlock } from "@/lib/supabase/types";

describe("tests/phase2-editor-scorer.test.ts — Kiểm thử Phase 2: Thang điểm 100 & Trình biên tập trực quan tại Cổng 2", () => {
  beforeEach(() => {
    const state = resetDemoState();
    state.vaultApiKey = "LOCAL_DEMO_MODE_KEY";
  });

  it("Thang điểm 100 (Quality Rubric): Chấm đúng 5 trụ cột (SEO 25 + GEO 25 + AEO 20 + TRUST 15 + UX 15 = 100) cho bài đạt chuẩn", () => {
    const state = getDemoState();
    const art1 = state.articles[0];
    const assets = state.articleAssets
      .filter((a) => a.article_id === art1.id)
      .map((a) => ({ id: a.id, alt_text: a.alt_text }));

    const report = runAllArticleChecks({
      primaryKeyword: art1.primary_keyword ?? art1.topic,
      slug: art1.slug ?? "demo-slug",
      seo: art1.seo!,
      contentBlocks: art1.content_blocks!,
      needsInfo: [],
      brandProfile: state.brandProfile,
      assets,
    });

    expect(report.passed).toBe(true);
    expect(report.quality_score).toBeDefined();
    expect(report.quality_score?.seo_score).toBe(25);
    expect(report.quality_score?.geo_score).toBe(25);
    expect(report.quality_score?.aeo_score).toBe(20);
    expect(report.quality_score?.trust_score).toBe(15);
    expect(report.quality_score?.ux_score).toBe(15);
    expect(report.quality_score?.total_score).toBe(100);
    expect(report.quality_score?.band).toBe("READY_TO_PUBLISH");
    expect(report.quality_score?.blocked_by_truth).toBe(false);
  });

  it("Quy tắc chặn cứng sự thật (Truth Hard Block): Dù điểm SEO/GEO/AEO/UX rất cao nhưng vi phạm sự thật hoặc còn needs_info thì bắt buộc bị BLOCKED_BY_TRUTH", () => {
    const state = getDemoState();
    const art1 = state.articles[0];
    const assets = state.articleAssets
      .filter((a) => a.article_id === art1.id)
      .map((a) => ({ id: a.id, alt_text: a.alt_text }));

    const reportWithMissingFact = runAllArticleChecks({
      primaryKeyword: art1.primary_keyword ?? art1.topic,
      slug: art1.slug ?? "demo-slug",
      seo: art1.seo!,
      contentBlocks: art1.content_blocks!,
      needsInfo: ["Cần xác minh thêm thời hạn bảo hành"],
      brandProfile: state.brandProfile,
      assets,
    });

    expect(reportWithMissingFact.passed).toBe(false);
    expect(reportWithMissingFact.quality_score?.total_score).toBeGreaterThanOrEqual(
      90
    );
    expect(reportWithMissingFact.quality_score?.blocked_by_truth).toBe(true);
    expect(reportWithMissingFact.quality_score?.band).toBe("BLOCKED_BY_TRUTH");
  });

  it("Chỉnh sửa trực quan tại Cổng 2 (saveAndValidateArticleContent): Lưu thành công block h3 + table, tự động chạy lại Truth Guard và chấm điểm 100", async () => {
    const state = getDemoState();
    // Bài #2 đang ở preview_review
    const art2 = state.articles.find((a) => a.status === "preview_review")!;
    expect(art2).toBeDefined();

    const updatedBlocks: ContentBlock[] = [
      ...(art2.content_blocks ?? []),
      {
        type: "h3",
        text: "Bảng tóm tắt thông số máy xay LumiGrind Pro G2",
      },
      {
        type: "table",
        caption: "Thông số kỹ thuật chuẩn từ nhà sản xuất",
        headers: ["Thông số", "Giá trị"],
        rows: [
          ["Công suất", "180W"],
          ["Đường kính lưỡi xay", "48 mm (38 cấp độ mịn)"],
        ],
        fact_ids: ["fact-04", "fact-05"],
        claim_label: "VERIFIED",
      },
    ];

    const editorClient = createLocalDemoSupabaseClient(false);

    const res = await saveAndValidateArticleContent({
      articleId: art2.id,
      slugInput: "huong-dan-38-cap-do-min-lumigrind-pro-g2",
      seoTitle: "Hướng dẫn chỉnh 38 cấp độ mịn trên LumiGrind Pro G2",
      seoMetaDescription:
        "Chi tiết cách chọn cấp độ mịn từ cấp 5 đến cấp 28 trên máy xay cà phê LumiGrind Pro G2 lưỡi phẳng 48 mm.",
      rawBlocksJson: JSON.stringify(updatedBlocks),
      editorClient,
    });

    expect(res.passed).toBe(true);
    expect(res.slug).toBe("huong-dan-38-cap-do-min-lumigrind-pro-g2");
    expect(res.checkReport.quality_score?.total_score).toBe(100);
    expect(res.checkReport.quality_score?.band).toBe("READY_TO_PUBLISH");

    // Nếu Editor vô tình sửa thêm câu chứa tuyên bố cấm "rẻ nhất thị trường" -> bị chặn ngay
    const badBlocks: ContentBlock[] = [
      ...updatedBlocks,
      {
        type: "paragraph",
        text: "LumiGrind Pro G2 là máy xay cà phê rẻ nhất thị trường hiện nay.",
        fact_ids: ["fact-04"],
        claim_label: "VERIFIED",
      },
    ];

    const badRes = await saveAndValidateArticleContent({
      articleId: art2.id,
      slugInput: "huong-dan-38-cap-do-min-lumigrind-pro-g2",
      seoTitle: "Hướng dẫn chỉnh 38 cấp độ mịn trên LumiGrind Pro G2",
      seoMetaDescription:
        "Chi tiết cách chọn cấp độ mịn từ cấp 5 đến cấp 28 trên máy xay cà phê LumiGrind Pro G2 lưỡi phẳng 48 mm.",
      rawBlocksJson: JSON.stringify(badBlocks),
      editorClient,
    });

    expect(badRes.passed).toBe(false);
    expect(badRes.checkReport.quality_score?.blocked_by_truth).toBe(true);
    expect(badRes.checkReport.quality_score?.band).toBe("BLOCKED_BY_TRUTH");
  });
});
