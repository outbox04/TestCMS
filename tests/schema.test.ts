import { describe, expect, it } from "vitest";
import {
  buildArticleJsonLd,
  serializeJsonLd,
  validateArticleJsonLd,
} from "@/lib/seo/schema";
import type { ContentBlock } from "@/lib/supabase/types";

describe("lib/seo/schema.ts — Dựng và kiểm tra JSON-LD bằng code", () => {
  const sampleBlocks: ContentBlock[] = [
    { type: "h2", text: "Cách pha espresso với LumiBrew Mini X1" },
    {
      type: "paragraph",
      text: "LumiBrew Mini X1 làm nóng nước trong 35 giây ở mức 92 độ C.",
    },
    {
      type: "faq",
      q: "Thời gian làm nóng của LumiBrew Mini X1 là bao lâu?",
      a: "Máy làm nóng trong 35 giây nhờ công suất 1350W.",
    },
  ];

  it("Dựng đủ Article, BreadcrumbList, FAQPage và khớp 100% nội dung hiển thị", () => {
    const doc = buildArticleJsonLd({
      siteUrl: "https://demo.example.com",
      slug: "cach-pha-espresso-lumibrew",
      seo: {
        title: "Cách pha espresso chuẩn vị với LumiBrew Mini X1",
        meta_description:
          "Hướng dẫn chi tiết cách pha espresso với máy pha cà phê LumiBrew Mini X1 tại nhà.",
      },
      contentBlocks: sampleBlocks,
      brandName: "LumiBrew Việt Nam",
      publishedAt: "2026-11-17T08:00:00.000Z",
      updatedAt: "2026-11-17T09:00:00.000Z",
    });

    const validation = validateArticleJsonLd(doc, sampleBlocks);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(doc["@graph"]).toHaveLength(3);
  });

  it("Escape ký tự < thành \\u003c khi serialize JSON-LD (R-25)", () => {
    const doc = buildArticleJsonLd({
      siteUrl: "https://demo.example.com",
      slug: "test-xss",
      seo: {
        title: "Tiêu đề chứa </script><script>alert(1)</script>",
        meta_description:
          "Mô tả an toàn kiểm thử khả năng escape ký tự nhọn trong JSON-LD.",
      },
      contentBlocks: sampleBlocks,
      brandName: "LumiBrew Việt Nam",
      publishedAt: "2026-11-17T08:00:00.000Z",
      updatedAt: "2026-11-17T09:00:00.000Z",
    });

    const serialized = serializeJsonLd(doc);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script>");
  });

  it("Phát hiện lỗi khi FAQ trong JSON-LD không khớp FAQ hiển thị trên trang (R-26, R-29)", () => {
    const doc = buildArticleJsonLd({
      siteUrl: "https://demo.example.com",
      slug: "lech-faq",
      seo: {
        title: "Bài viết kiểm thử lệch FAQ",
        meta_description:
          "Mô tả kiểm thử phát hiện lệch nội dung giữa FAQPage và content_blocks.",
      },
      contentBlocks: sampleBlocks,
      brandName: "LumiBrew Việt Nam",
      publishedAt: "2026-11-17T08:00:00.000Z",
      updatedAt: "2026-11-17T09:00:00.000Z",
    });

    const differentVisibleBlocks: ContentBlock[] = [
      { type: "h2", text: "Mục H2" },
      {
        type: "faq",
        q: "Một câu hỏi khác hoàn toàn trên giao diện?",
        a: "Câu trả lời khác.",
      },
    ];

    const validation = validateArticleJsonLd(doc, differentVisibleBlocks);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("không khớp");
  });
});

