import { describe, expect, it } from "vitest";
import { runAllArticleChecks } from "@/lib/checks";
import { getDemoState } from "@/lib/supabase/local-demo-store";
import { ContentBlockSchema } from "@/lib/supabase/types";
import {
  PROMPT_REGISTRY,
  WRITING_ENGINE_PROMPT_VERSION,
  analyzeSearchIntentAndTopic,
  buildPlanOutlineSystemPrefix,
  buildPlanOutlineUserPrompt,
  buildWriteArticleSystemPrefix,
  buildWriteArticleUserPrompt,
  getRevalidatePathsForArticle,
  verifyArticleClaimsAndEnforceTruthLabels,
  verifyOutlineFacts,
} from "@/lib/writing-engine";

describe("tests/writing-engine.test.ts — Kiểm thử 7 năng lực của AI Writing Engine (Phase 1)", () => {
  const demoBrand = getDemoState().brandProfile;

  it("Năng lực 1 & 2: analyzeSearchIntentAndTopic xác định đúng Search Intent và loại bài viết", () => {
    const guideRes = analyzeSearchIntentAndTopic(
      "Hướng dẫn cách pha cà phê espresso tại nhà",
      [
        {
          keyword: "cách pha espresso",
          source: "mock",
          volume: "unknown",
          intentCluster: "informational-guide",
        },
      ]
    );
    expect(guideRes.inferredIntent).toBe("informational");
    expect(guideRes.inferredContentType).toBe("guide");
    expect(guideRes.dedupedKeywords).toContain("cách pha espresso");

    const compRes = analyzeSearchIntentAndTopic(
      "So sánh máy pha cà phê LumiBrew Mini X1 và các dòng máy gia đình"
    );
    expect(compRes.inferredIntent).toBe("commercial");
    expect(compRes.inferredContentType).toBe("comparison");

    const transRes = analyzeSearchIntentAndTopic(
      "Bảng giá mua máy pha cà phê LumiBrew Mini X1 khuyến mãi"
    );
    expect(transRes.inferredIntent).toBe("transactional");
    expect(transRes.inferredContentType).toBe("product");

    const navRes = analyzeSearchIntentAndTopic(
      "Chính sách bảo hành và đổi trả LumiBrew Việt Nam"
    );
    expect(navRes.inferredIntent).toBe("navigational");
    expect(navRes.inferredContentType).toBe("service");
  });

  it("Năng lực 3: Prompt lập dàn ý có phiên bản v2.0.0, truyền editorNote và verifyOutlineFacts chặn VERIFIED giả mạo", () => {
    expect(PROMPT_REGISTRY.plan_outline.version).toBe(
      WRITING_ENGINE_PROMPT_VERSION
    );

    const sysPrefix = buildPlanOutlineSystemPrefix(demoBrand);
    expect(sysPrefix).toContain(`v${WRITING_ENGINE_PROMPT_VERSION}`);
    expect(sysPrefix).toContain("[R-01]");

    const userPrompt = buildPlanOutlineUserPrompt({
      topic: "Hướng dẫn sử dụng LumiBrew Mini X1",
      dedupedKeywords: ["LumiBrew Mini X1"],
      inferredIntent: "informational",
      inferredContentType: "guide",
      editorNote: "Bổ sung mục hướng dẫn vệ sinh vòi đánh sữa",
    });
    expect(userPrompt).toContain(
      "Bổ sung mục hướng dẫn vệ sinh vòi đánh sữa"
    );

    // Bẫy: AI trả về mục H2 gắn nhãn VERIFIED nhưng dùng fact_id không tồn tại
    const verifiedOutline = verifyOutlineFacts(
      {
        search_intent: "informational",
        content_type: "guide",
        primary_keyword: "LumiBrew Mini X1",
        secondary_keywords: ["pha espresso"],
        faq_questions: ["Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?"],
        outline: [
          {
            h2: "Thông số kỹ thuật LumiBrew Mini X1",
            key_points: ["Công suất 1350W, áp suất 15 bar"],
            fact_ids: ["fact-01"],
            claim_label: "VERIFIED",
          },
          {
            h2: "Chính sách bảo hành 5 năm tại nhà",
            key_points: ["Bảo hành 5 năm miễn phí"],
            fact_ids: ["fact-999-gia-mao"],
            claim_label: "VERIFIED",
          },
        ],
        needs_info: [],
      },
      demoBrand
    );

    expect(verifiedOutline.downgraded_count).toBe(1);
    expect(verifiedOutline.items[0].claim_label).toBe("VERIFIED");
    expect(verifiedOutline.items[1].claim_label).toBe("NEEDS_VERIFICATION");
    expect(verifiedOutline.needs_info.length).toBeGreaterThan(0);
    expect(verifiedOutline.needs_info[0]).toContain("fact-999-gia-mao");
  });

  it("Năng lực 4 & 6: Mở rộng tương thích ngược ContentBlockSchema (h3, table, claim_label) và Prompt viết bài", () => {
    const writeSys = buildWriteArticleSystemPrefix(demoBrand);
    expect(writeSys).toContain(`v${WRITING_ENGINE_PROMPT_VERSION}`);
    expect(writeSys).toContain("[R-19]");

    const writePrompt = buildWriteArticleUserPrompt({
      topic: "Hướng dẫn pha espresso với LumiBrew Mini X1",
      primaryKeyword: "LumiBrew Mini X1",
      secondaryKeywords: ["máy xay LumiGrind Pro G2"],
      faqQuestions: ["Thời gian làm nóng bao lâu?"],
      outlineItems: [
        {
          h2: "Thông số máy LumiBrew Mini X1",
          key_points: ["Công suất 1350W"],
          fact_ids: ["fact-01"],
        },
      ],
      outlineNeedsInfo: [],
      assets: [{ asset_id: "asset-1", alt_text: "Ảnh máy", analysis: null }],
      editorNote: "Thêm bảng so sánh cấp độ mịn",
      retryErrors: ["- [seo_title_meta] Title quá dài"],
    });

    expect(writePrompt).toContain("Thêm bảng so sánh cấp độ mịn");
    expect(writePrompt).toContain("- [seo_title_meta] Title quá dài");

    // Kiểm tra parse các block mới (h3, table) và block cũ (h2, paragraph)
    const sampleBlocks = [
      { type: "h2", text: "Thông số kỹ thuật" },
      { type: "h3", text: "Bảng thông số chi tiết" },
      {
        type: "table",
        caption: "So sánh thông số thiết bị LumiBrew",
        headers: ["Thiết bị", "Công suất", "Giá niêm yết"],
        rows: [
          ["LumiBrew Mini X1", "1350W", "4.890.000 VNĐ"],
          ["LumiGrind Pro G2", "180W", "2.490.000 VNĐ"],
        ],
        fact_ids: ["fact-01", "fact-04"],
        claim_label: "VERIFIED",
      },
    ];

    const parsed = sampleBlocks.map((b) => ContentBlockSchema.parse(b));
    expect(parsed).toHaveLength(3);
    expect(parsed[1].type).toBe("h3");
    expect(parsed[2].type).toBe("table");
  });

  it("Năng lực 5 (Truth Guard): Chặn AI tự nâng NEEDS_VERIFICATION thành VERIFIED và phân biệt GENERAL_KNOWLEDGE với số liệu thương hiệu", () => {
    // Bẫy 1 & 2: AI tự gắn VERIFIED khi không có fact_ids, đồng thời cố tình trả về needs_info rỗng dù outlineNeedsInfo có cảnh báo bảo hành
    const trapResult = verifyArticleClaimsAndEnforceTruthLabels({
      contentBlocks: [
        {
          type: "h2",
          text: "Thông số máy pha cà phê LumiBrew Mini X1",
        },
        {
          type: "paragraph",
          text: "Máy pha cà phê LumiBrew Mini X1 có công suất 1350W và được bảo hành chính hãng 36 tháng.",
          fact_ids: [], // Không có fact_id thật nhưng AI tự gắn VERIFIED
          claim_label: "VERIFIED",
        },
      ],
      rawNeedsInfo: [],
      outlineNeedsInfo: [
        "Thiếu thông tin chính sách bảo hành trong brand_profile.",
      ],
      brand: demoBrand,
    });

    expect(trapResult.downgraded_blocks).toBe(1);
    const paraBlock = trapResult.content_blocks[1];
    expect(
      "claim_label" in paraBlock ? paraBlock.claim_label : undefined
    ).toBe("NEEDS_VERIFICATION");
    expect(trapResult.needs_info.length).toBeGreaterThanOrEqual(2);

    // Bẫy 3: Kiểm tra runAllArticleChecks cho phép số liệu phổ thông trong GENERAL_KNOWLEDGE (không nhắc tên thương hiệu),
    // nhưng chặn ngay nếu câu nhắc tới LumiBrew Mini X1 kèm con số bịa đặt (19 bar)
    const validGeneralCheck = runAllArticleChecks({
      primaryKeyword: "LumiBrew Mini X1",
      slug: "pha-espresso-lumibrew-mini-x1",
      seo: {
        title: "Hướng dẫn pha espresso với máy LumiBrew Mini X1",
        meta_description:
          "Tìm hiểu cách pha cà phê espresso tại nhà với máy pha cà phê LumiBrew Mini X1 áp suất 15 bar.",
      },
      contentBlocks: [
        {
          type: "h2",
          text: "Thông số máy pha cà phê LumiBrew Mini X1",
        },
        {
          type: "paragraph",
          text: "Máy pha cà phê LumiBrew Mini X1 có công suất 1350W, áp suất bơm 15 bar và giữ nhiệt PID ở mức 92 độ C.",
          fact_ids: ["fact-01", "fact-03"],
          claim_label: "VERIFIED",
        },
        {
          type: "h2",
          text: "Nguyên lý chiết xuất cà phê theo kiến thức phổ thông",
        },
        {
          type: "paragraph",
          text: "Trong nghệ thuật pha chế truyền thống, một tách đồ uống tiêu chuẩn thường sử dụng khoảng 18 gram bột cà phê chiết xuất trong 27 giây để lấy 36 ml cốt.",
          claim_label: "GENERAL_KNOWLEDGE",
        },
        {
          type: "image",
          asset_id: "asset-1",
          alt: "Góc pha chế cà phê tại nhà",
        },
        {
          type: "faq",
          q: "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
          a: "LumiBrew Mini X1 làm nóng nhanh trong 35 giây với bình nước 1.2 lít.",
          fact_ids: ["fact-02"],
          claim_label: "VERIFIED",
        },
      ],
      needsInfo: [],
      brandProfile: demoBrand,
      assets: [{ id: "asset-1", alt_text: "Góc pha chế cà phê tại nhà" }],
    });

    expect(validGeneralCheck.passed).toBe(true);

    // Nhưng nếu gắn GENERAL_KNOWLEDGE mà câu văn lại nhắc tới "LumiBrew Mini X1" kèm số bịa "19 bar" -> BỊ CHẶN
    const fakeBrandNumberCheck = runAllArticleChecks({
      primaryKeyword: "LumiBrew Mini X1",
      slug: "pha-espresso-lumibrew-mini-x1",
      seo: {
        title: "Hướng dẫn pha espresso với máy LumiBrew Mini X1",
        meta_description:
          "Tìm hiểu cách pha cà phê espresso tại nhà với máy pha cà phê LumiBrew Mini X1.",
      },
      contentBlocks: [
        {
          type: "h2",
          text: "Thông số máy pha cà phê LumiBrew Mini X1",
        },
        {
          type: "paragraph",
          text: "Máy pha cà phê LumiBrew Mini X1 đạt áp suất 19 bar vượt trội.",
          claim_label: "GENERAL_KNOWLEDGE",
        },
        {
          type: "h2",
          text: "Kết hợp máy xay",
        },
        {
          type: "paragraph",
          text: "Sử dụng LumiGrind Pro G2 công suất 180W.",
          fact_ids: ["fact-04"],
          claim_label: "VERIFIED",
        },
        {
          type: "image",
          asset_id: "asset-1",
          alt: "Góc pha chế cà phê tại nhà",
        },
        {
          type: "faq",
          q: "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
          a: "LumiBrew Mini X1 làm nóng nhanh trong 35 giây.",
          fact_ids: ["fact-02"],
          claim_label: "VERIFIED",
        },
      ],
      needsInfo: [],
      brandProfile: demoBrand,
      assets: [{ id: "asset-1", alt_text: "Góc pha chế cà phê tại nhà" }],
    });

    expect(fakeBrandNumberCheck.passed).toBe(false);
    const brandCheckItem = fakeBrandNumberCheck.items.find(
      (i) => i.code === "brand_facts_and_claims"
    );
    expect(brandCheckItem?.passed).toBe(false);
    expect(brandCheckItem?.message).toContain("19");
  });

  it("Năng lực 7: getRevalidatePathsForArticle trả về đúng danh sách đường dẫn cần làm mới", () => {
    expect(getRevalidatePathsForArticle("bai-viet-moi")).toEqual([
      "/blog",
      "/llms.txt",
      "/blog/bai-viet-moi",
    ]);
    expect(getRevalidatePathsForArticle(null)).toEqual(["/blog", "/llms.txt"]);
  });
});

