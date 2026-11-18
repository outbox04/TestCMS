import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBrandFactsAndForbiddenClaims,
  checkImageBlocks,
  checkNeedsInfoEmpty,
  checkSchemaConsistency,
  checkSeoTitleAndMeta,
  checkStructureH2AndFaq,
  runAllArticleChecks,
} from "@/lib/checks";
import type { BrandProfileRow, ContentBlock } from "@/lib/supabase/types";

function loadDemoBrandProfile(): BrandProfileRow {
  const fixturePath = path.join(process.cwd(), "fixtures", "brand.demo.json");
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return {
    id: true,
    brand_name: raw.brand_name,
    description: raw.description,
    products: raw.products,
    voice: raw.voice,
    facts: raw.facts,
    forbidden_claims: raw.forbidden_claims,
    updated_by: null,
    updated_at: new Date().toISOString(),
  };
}

const VALID_BLOCKS: ContentBlock[] = [
  {
    type: "h2",
    text: "Tổng quan máy pha cà phê LumiBrew Mini X1 tại nhà",
  },
  {
    type: "paragraph",
    text: "Máy pha cà phê LumiBrew Mini X1 có giá niêm yết 4.890.000 VNĐ, công suất 1350W và áp suất bơm 15 bar giúp pha cà phê chuẩn vị trong 35 giây.",
    fact_ids: ["fact-01", "fact-02"],
  },
  {
    type: "image",
    asset_id: "asset-1",
    alt: "Máy pha cà phê espresso đặt trên bàn bếp hiện đại",
  },
  {
    type: "h2",
    text: "Kết hợp cùng máy xay LumiGrind Pro G2",
  },
  {
    type: "paragraph",
    text: "Máy xay LumiGrind Pro G2 có giá 2.490.000 VNĐ, công suất 180W với 38 cấp độ mịn và lưỡi phẳng 48 mm.",
    fact_ids: ["fact-04", "fact-05"],
  },
  {
    type: "faq",
    q: "Nên chỉnh độ mịn cấp mấy trên LumiGrind Pro G2 khi pha espresso?",
    a: "Khi pha espresso với LumiBrew Mini X1, mức độ mịn khuyến nghị là từ cấp 5 đến cấp 10.",
    fact_ids: ["fact-06"],
  },
];

describe("lib/checks — 6 hạng mục kiểm tra tự động (mỗi check 1 ca đạt + 1 ca trượt)", () => {
  const brand = loadDemoBrandProfile();

  it("Check 1 (seo_title_meta): ca đạt và ca trượt", () => {
    const passRes = checkSeoTitleAndMeta({
      primaryKeyword: "LumiBrew Mini X1",
      seo: {
        title: "Đánh giá máy pha cà phê LumiBrew Mini X1 cho gia đình",
        meta_description:
          "Tìm hiểu thông số kỹ thuật, áp suất 15 bar và bộ điều khiển nhiệt độ PID trên máy pha cà phê LumiBrew Mini X1.",
      },
      contentBlocks: VALID_BLOCKS,
    });
    expect(passRes.passed).toBe(true);

    const failRes = checkSeoTitleAndMeta({
      primaryKeyword: "LumiBrew Mini X1",
      seo: {
        title: "Tiêu đề không chứa từ khóa chính",
        meta_description: "Mô tả quá ngắn",
      },
      contentBlocks: VALID_BLOCKS,
    });
    expect(failRes.passed).toBe(false);
    expect(failRes.message).toContain("LumiBrew Mini X1");
  });

  it("Check 2 (structure_h2_faq): ca đạt và ca trượt", () => {
    const passRes = checkStructureH2AndFaq(VALID_BLOCKS);
    expect(passRes.passed).toBe(true);

    const failRes = checkStructureH2AndFaq([
      { type: "h2", text: "Chỉ có 1 H2 và không có FAQ" },
      { type: "paragraph", text: "Nội dung ngắn." },
    ]);
    expect(failRes.passed).toBe(false);
  });

  it("Check 3 (schema_jsonld): ca đạt và ca trượt", () => {
    const passRes = checkSchemaConsistency({
      slug: "danh-gia-lumibrew-mini-x1",
      seo: {
        title: "Đánh giá máy pha cà phê LumiBrew Mini X1",
        meta_description:
          "Tìm hiểu thông số kỹ thuật chuẩn xác của máy pha cà phê LumiBrew Mini X1.",
      },
      contentBlocks: VALID_BLOCKS,
      brandProfile: brand,
      siteUrl: "https://demo.example.com",
    });
    expect(passRes.passed).toBe(true);

    const tooLongFaqAnswer = Array.from({ length: 305 }, () => "từ").join(" ");
    const failRes = checkSchemaConsistency({
      slug: "danh-gia-lumibrew-mini-x1",
      seo: {
        title: "Đánh giá máy pha cà phê LumiBrew Mini X1",
        meta_description:
          "Tìm hiểu thông số kỹ thuật chuẩn xác của máy pha cà phê LumiBrew Mini X1.",
      },
      contentBlocks: [
        ...VALID_BLOCKS,
        {
          type: "faq",
          q: "Câu hỏi có câu trả lời quá 300 từ?",
          a: tooLongFaqAnswer,
        },
      ],
      brandProfile: brand,
      siteUrl: "https://demo.example.com",
    });
    expect(failRes.passed).toBe(false);
  });

  it("Check 4 (brand_facts_and_claims): ca đạt, ca trượt do bịa số liệu, và ca trượt do dùng forbidden_claims", () => {
    const passRes = checkBrandFactsAndForbiddenClaims({
      seo: {
        title: "Đánh giá LumiBrew Mini X1",
        meta_description:
          "Khám phá máy pha cà phê LumiBrew Mini X1 công suất 1350W và áp suất 15 bar.",
      },
      contentBlocks: VALID_BLOCKS,
      brandProfile: brand,
    });
    expect(passRes.passed).toBe(true);

    // Ca trượt 4a: bịa đặt con số (ví dụ áp suất 25 bar hoặc giá 1990000 không có trong brand_profile)
    const hallucinatedBlocks: ContentBlock[] = [
      ...VALID_BLOCKS,
      {
        type: "paragraph",
        text: "Máy có áp suất lên tới 25 bar và công suất 2999W.",
      },
    ];
    const failHallucination = checkBrandFactsAndForbiddenClaims({
      seo: {
        title: "Đánh giá LumiBrew Mini X1",
        meta_description:
          "Khám phá máy pha cà phê LumiBrew Mini X1 công suất 1350W và áp suất 15 bar.",
      },
      contentBlocks: hallucinatedBlocks,
      brandProfile: brand,
    });
    expect(failHallucination.passed).toBe(false);
    expect(failHallucination.message).toContain("25");

    // Ca trượt 4b: dùng forbidden_claims ("rẻ nhất thị trường")
    const forbiddenBlocks: ContentBlock[] = [
      ...VALID_BLOCKS,
      {
        type: "paragraph",
        text: "Đây là dòng máy pha cà phê rẻ nhất thị trường hiện nay.",
      },
    ];
    const failForbidden = checkBrandFactsAndForbiddenClaims({
      seo: {
        title: "Đánh giá LumiBrew Mini X1",
        meta_description:
          "Khám phá máy pha cà phê LumiBrew Mini X1 công suất 1350W và áp suất 15 bar.",
      },
      contentBlocks: forbiddenBlocks,
      brandProfile: brand,
    });
    expect(failForbidden.passed).toBe(false);
    expect(failForbidden.message).toContain("rẻ nhất thị trường");
  });

  it("Check 5 (image_blocks): ca đạt và ca trượt khi asset_id không tồn tại hoặc alt rỗng", () => {
    const passRes = checkImageBlocks(VALID_BLOCKS, [
      { id: "asset-1", alt_text: "Ảnh minh họa" },
    ]);
    expect(passRes.passed).toBe(true);

    const failRes = checkImageBlocks(
      [
        {
          type: "image",
          asset_id: "missing-asset",
          alt: "",
        },
      ],
      [{ id: "asset-1", alt_text: "Ảnh minh họa" }]
    );
    expect(failRes.passed).toBe(false);
  });

  it("Check 6 (needs_info_empty): ca đạt và ca trượt (bẫy Kịch bản C bảo hành/đổi trả)", () => {
    const passRes = checkNeedsInfoEmpty([]);
    expect(passRes.passed).toBe(true);

    const failRes = checkNeedsInfoEmpty([
      "Thiếu thông tin chính sách bảo hành và đổi trả trong brand_profile",
    ]);
    expect(failRes.passed).toBe(false);
  });

  it("runAllArticleChecks tổng hợp cả 6 checks chính xác", () => {
    const fullPass = runAllArticleChecks({
      primaryKeyword: "LumiBrew Mini X1",
      slug: "danh-gia-lumibrew-mini-x1",
      seo: {
        title: "Đánh giá máy pha cà phê LumiBrew Mini X1 cho gia đình",
        meta_description:
          "Tìm hiểu thông số kỹ thuật, áp suất 15 bar và nhiệt độ PID trên máy pha cà phê LumiBrew Mini X1.",
      },
      contentBlocks: VALID_BLOCKS,
      needsInfo: [],
      brandProfile: brand,
      assets: [{ id: "asset-1", alt_text: "Ảnh máy pha cà phê" }],
    });
    expect(fullPass.passed).toBe(true);
    expect(fullPass.items).toHaveLength(6);
  });
});

