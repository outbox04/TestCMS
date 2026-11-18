import { beforeEach, describe, expect, it } from "vitest";
import { runAllArticleChecks } from "@/lib/checks";
import { getDemoState, resetDemoState } from "@/lib/supabase/local-demo-store";
import type { ArticleRow, ContentBlock } from "@/lib/supabase/types";
import { buildWebsiteContentStandardExport } from "@/lib/writing-engine";

describe("tests/critical-quality-validation.test.ts — Kiểm thử Hồi quy Chất lượng Trọng yếu (Nhiệm vụ 5)", () => {
  beforeEach(() => {
    resetDemoState();
  });

  it("1. Bắt trọn bộ lỗi bài LumiGrind Pro G2 bị lẫn nội dung LumiBrew Mini X1 (Sapo, Meta Description, FAQ, Thông số) và chặn 100/100 + READY_TO_PUBLISH", () => {
    const state = getDemoState();
    const brand = state.brandProfile;

    const brokenLumiGrindBlocks: ContentBlock[] = [
      {
        type: "h2",
        text: "Thông số nổi bật và ứng dụng của LumiGrind Pro G2",
      },
      {
        type: "paragraph",
        text: "Trong chủ đề LumiGrind Pro G2, máy pha cà phê LumiBrew Mini X1 có giá niêm yết 4.890.000 VNĐ, công suất 1350W và áp suất bơm 15 bar, giúp làm nóng nhanh trong 35 giây cùng bộ điều khiển PID giữ nhiệt ở mức 92 độ C.",
        fact_ids: ["fact-01", "fact-02", "fact-03"],
        claim_label: "VERIFIED",
      },
      {
        type: "image",
        asset_id: "asset-1",
        alt: "Hình ảnh minh họa thiết bị pha cà phê tại quầy bếp",
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
    ];

    const brokenSeo = {
      title: "Hướng dẫn chi tiết về LumiGrind Pro G2",
      meta_description:
        "Tìm hiểu thông số áp suất 15 bar, bộ điều khiển PID 92 độ C và kinh nghiệm thực tế về LumiGrind Pro G2.",
    };

    const report = runAllArticleChecks({
      topic: "Cách chọn cấp độ mịn trên máy xay LumiGrind Pro G2 cho espresso và pour-over",
      primaryKeyword: "LumiGrind Pro G2",
      slug: "huong-dan-chi-tiet-ve-lumigrind-pro-g2",
      seo: brokenSeo,
      contentBlocks: brokenLumiGrindBlocks,
      needsInfo: [],
      brandProfile: brand,
      assets: [{ id: "asset-1", alt_text: "Ảnh thiết bị" }],
    });

    // Không được vượt qua kiểm tra
    expect(report.passed).toBe(false);

    const hbCodes = (report.quality_score?.hard_blockers ?? []).map(
      (h) => h.code
    );

    // 1. Phát hiện Sapo lệch chủ đề
    expect(hbCodes).toContain("TOPIC_SAPO_MISMATCH");
    // 2. Phát hiện Meta Description lệch chủ đề / gán nhầm thông số 15 bar, PID 92 độ C
    expect(hbCodes).toContain("TOPIC_META_DESC_MISMATCH");
    // 3. Phát hiện FAQ không đúng chủ đề (hỏi về thời gian làm nóng LumiBrew Mini X1)
    expect(hbCodes).toContain("FAQ_OFF_TOPIC_ENTITY");
    // 4. Phát hiện nội dung dưới H2 của LumiGrind Pro G2 lại gắn thông số của LumiBrew Mini X1
    expect(hbCodes).toContain("TOPIC_HEADING_BODY_MISMATCH");

    // 5. Không được trả về 100/100 và không được trả về READY_TO_PUBLISH
    expect(report.quality_score?.total_score).toBeLessThan(100);
    expect(report.quality_score?.band).not.toBe("READY_TO_PUBLISH");
    expect(report.quality_score?.band).toBe("BLOCKED_BY_TRUTH");
    expect(report.quality_score?.blocked_by_truth).toBe(true);

    // 6. Kiểm tra xuất báo cáo 4 phần: needs_verification và errors_to_fix phải có dữ liệu lỗi cụ thể
    const mockArticle: ArticleRow = {
      ...state.articles[1],
      primary_keyword: "LumiGrind Pro G2",
      seo: brokenSeo,
      content_blocks: brokenLumiGrindBlocks,
      checks_passed: report.passed,
      check_report: report,
    };

    const deliverable = buildWebsiteContentStandardExport({
      article: mockArticle,
      brand,
      assets: [],
      publishedArticles: state.articles,
    });

    expect(
      deliverable.part_d_quality_report.needs_verification.length
    ).toBeGreaterThan(0);
    expect(
      deliverable.part_d_quality_report.errors_to_fix.length
    ).toBeGreaterThan(0);
  });

  it("2. Bài có hai sản phẩm liên quan nhưng phân biệt đúng thông số -> Đạt kiểm tra (READY_TO_PUBLISH)", () => {
    const state = getDemoState();
    const art1 = state.articles[0]; // Bài hướng dẫn pha espresso kết hợp cả LumiBrew Mini X1 và LumiGrind Pro G2 đúng thông số
    const assets = state.articleAssets
      .filter((a) => a.article_id === art1.id)
      .map((a) => ({ id: a.id, alt_text: a.alt_text }));

    const report = runAllArticleChecks({
      topic: art1.topic,
      primaryKeyword: art1.primary_keyword!,
      slug: art1.slug!,
      seo: art1.seo!,
      contentBlocks: art1.content_blocks!,
      needsInfo: [],
      brandProfile: state.brandProfile,
      assets,
    });

    expect(report.passed).toBe(true);
    expect(report.quality_score?.hard_blockers).toHaveLength(0);
    expect(report.quality_score?.band).toBe("READY_TO_PUBLISH");
  });

  it("3. Bài chỉ nói về một sản phẩm (LumiGrind Pro G2) với đúng thông số của sản phẩm đó -> Đạt 100/100 (READY_TO_PUBLISH)", () => {
    const state = getDemoState();
    const singleProductBlocks: ContentBlock[] = [
      {
        type: "h2",
        text: "Cấu tạo lưỡi xay phẳng 48 mm trên LumiGrind Pro G2",
      },
      {
        type: "paragraph",
        text: "Máy xay cà phê LumiGrind Pro G2 có giá niêm yết 2.490.000 VNĐ, công suất 180W và sử dụng lưỡi xay phẳng đường kính 48 mm.",
        fact_ids: ["fact-04"],
        claim_label: "VERIFIED",
      },
      {
        type: "image",
        asset_id: "asset-1",
        alt: "Máy xay cà phê hạt lưỡi phẳng đặt trên bàn",
      },
      {
        type: "h2",
        text: "Hệ thống 38 cấp độ mịn cho Pour-over V60",
      },
      {
        type: "paragraph",
        text: "LumiGrind Pro G2 hỗ trợ 38 cấp độ chỉnh độ mịn, phễu chứa hạt 250 g, tốc độ quay 450 vòng/phút và nặng 2.6 kg.",
        fact_ids: ["fact-05"],
        claim_label: "VERIFIED",
      },
      {
        type: "list",
        ordered: false,
        items: [
          "Pha pour-over (V60): chỉnh độ mịn trên LumiGrind Pro G2 từ cấp 22 đến cấp 28.",
        ],
        fact_ids: ["fact-07"],
        claim_label: "VERIFIED",
      },
      {
        type: "faq",
        q: "Phễu chứa hạt của LumiGrind Pro G2 có dung tích bao nhiêu?",
        a: "Phễu chứa hạt của máy xay LumiGrind Pro G2 có dung tích 250 g với tốc độ quay 450 vòng/phút.",
        fact_ids: ["fact-05"],
        claim_label: "VERIFIED",
      },
    ];

    const report = runAllArticleChecks({
      topic: "Đánh giá máy xay cà phê LumiGrind Pro G2",
      primaryKeyword: "LumiGrind Pro G2",
      slug: "danh-gia-lumigrind-pro-g2",
      seo: {
        title: "Đánh giá máy xay cà phê hạt LumiGrind Pro G2",
        meta_description:
          "Tìm hiểu lưỡi xay phẳng 48 mm, công suất 180W và 38 cấp độ mịn trên máy xay cà phê LumiGrind Pro G2.",
      },
      contentBlocks: singleProductBlocks,
      needsInfo: [],
      brandProfile: state.brandProfile,
      assets: [{ id: "asset-1", alt_text: "Ảnh máy xay" }],
    });

    expect(report.passed).toBe(true);
    expect(report.quality_score?.total_score).toBe(100);
    expect(report.quality_score?.band).toBe("READY_TO_PUBLISH");
  });

  it("4. Bài có thông số sản phẩm gán nhầm trong câu văn hoặc chưa xác minh -> Bị chặn bởi HARD_BLOCKER", () => {
    const state = getDemoState();
    const misattributedBlocks: ContentBlock[] = [
      {
        type: "h2",
        text: "Đánh giá máy xay LumiGrind Pro G2",
      },
      {
        type: "paragraph",
        // Gán nhầm công suất 1350W và áp suất 15 bar của LumiBrew Mini X1 cho LumiGrind Pro G2 trong cùng 1 câu
        text: "Máy xay LumiGrind Pro G2 sở hữu công suất 1350W và áp suất 15 bar mạnh mẽ.",
        fact_ids: ["fact-04"],
        claim_label: "VERIFIED",
      },
      {
        type: "h2",
        text: "Cấp độ mịn cho V60",
      },
      {
        type: "paragraph",
        text: "Với pha pour-over V60, mức mịn khuyến nghị trên LumiGrind Pro G2 là cấp 22 đến cấp 28.",
        fact_ids: ["fact-07"],
        claim_label: "VERIFIED",
      },
      {
        type: "image",
        asset_id: "asset-1",
        alt: "Ảnh máy xay cà phê",
      },
      {
        type: "faq",
        q: "Cấp độ mịn pha V60 là bao nhiêu?",
        a: "Từ cấp 22 đến cấp 28 trên máy xay LumiGrind Pro G2.",
        fact_ids: ["fact-07"],
        claim_label: "VERIFIED",
      },
    ];

    const report = runAllArticleChecks({
      topic: "Đánh giá máy xay LumiGrind Pro G2",
      primaryKeyword: "LumiGrind Pro G2",
      slug: "danh-gia-lumigrind-pro-g2",
      seo: {
        title: "Đánh giá máy xay cà phê LumiGrind Pro G2",
        meta_description:
          "Tìm hiểu thông số kỹ thuật lưỡi xay phẳng 48 mm của máy xay LumiGrind Pro G2.",
      },
      contentBlocks: misattributedBlocks,
      needsInfo: [],
      brandProfile: state.brandProfile,
      assets: [{ id: "asset-1", alt_text: "Ảnh máy xay" }],
    });

    expect(report.passed).toBe(false);
    const hbCodes = (report.quality_score?.hard_blockers ?? []).map(
      (h) => h.code
    );
    expect(hbCodes).toContain("ENTITY_SPEC_MISATTRIBUTION");
    expect(report.quality_score?.band).toBe("BLOCKED_BY_TRUTH");
  });

  it("5 & 6. Bài có FAQ liên quan nhưng không chứa từ khóa chính, và các Heading không bắt buộc đều phải chứa từ khóa chính -> Đạt 100/100", () => {
    const state = getDemoState();
    const naturalBlocks: ContentBlock[] = [
      {
        type: "h2",
        // Heading 1 không chứa nguyên văn từ khóa chính "LumiGrind Pro G2"
        text: "Ưu điểm của lưỡi xay phẳng đường kính 48 mm",
      },
      {
        type: "paragraph",
        text: "Máy xay cà phê LumiGrind Pro G2 có giá niêm yết 2.490.000 VNĐ, công suất 180W và sử dụng lưỡi xay phẳng đường kính 48 mm giúp hạt chín đều.",
        fact_ids: ["fact-04"],
        claim_label: "VERIFIED",
      },
      {
        type: "image",
        asset_id: "asset-1",
        alt: "Hạt cà phê rang mộc",
      },
      {
        type: "h2",
        // Heading 2 cũng không chứa nguyên văn từ khóa chính
        text: "Cách thiết lập cỡ hạt cho phương pháp thủ công V60",
      },
      {
        type: "paragraph",
        text: "Nhờ 38 cấp độ chỉnh độ mịn và tốc độ quay 450 vòng/phút trên LumiGrind Pro G2, người pha kiểm soát dễ dàng độ thô mịn.",
        fact_ids: ["fact-05"],
        claim_label: "VERIFIED",
      },
      {
        type: "list",
        ordered: false,
        items: [
          "Phương pháp pour-over (V60): chỉnh từ cấp 22 đến cấp 28.",
        ],
        fact_ids: ["fact-07"],
        claim_label: "VERIFIED",
      },
      {
        type: "faq",
        // Câu hỏi FAQ liên quan trực tiếp đến chủ đề pha V60 nhưng KHÔNG chứa từ khóa chính "LumiGrind Pro G2"
        q: "Khi pha pour-over V60 tại nhà nên chọn dải độ mịn nào?",
        a: "Với phương pháp pour-over (V60), mức độ mịn khuyến nghị là từ cấp 22 đến cấp 28 để dòng nước chảy ổn định.",
        fact_ids: ["fact-07"],
        claim_label: "VERIFIED",
      },
    ];

    const report = runAllArticleChecks({
      topic: "Kinh nghiệm xay cà phê với LumiGrind Pro G2",
      primaryKeyword: "LumiGrind Pro G2",
      secondaryKeywords: [
        "máy xay cà phê lưỡi phẳng 48mm",
        "cách pha pour over V60 tại nhà",
      ],
      slug: "kinh-nghiem-xay-ca-phe-lumigrind-pro-g2",
      seo: {
        title: "Kinh nghiệm xay cà phê chuẩn với LumiGrind Pro G2",
        meta_description:
          "Khám phá ưu điểm lưỡi xay phẳng 48 mm và 38 cấp độ mịn trên máy xay cà phê LumiGrind Pro G2.",
      },
      contentBlocks: naturalBlocks,
      needsInfo: [],
      brandProfile: state.brandProfile,
      assets: [{ id: "asset-1", alt_text: "Hạt cà phê" }],
    });

    expect(report.passed).toBe(true);
    expect(report.quality_score?.total_score).toBe(100);
    expect(report.quality_score?.band).toBe("READY_TO_PUBLISH");
  });
});

