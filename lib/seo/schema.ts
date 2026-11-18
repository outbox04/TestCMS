import { CHECK_CONFIG } from "@/lib/checks/config";
import type { ArticleSeo, ContentBlock } from "@/lib/supabase/types";

export interface BuildJsonLdInput {
  siteUrl: string;
  slug: string;
  seo: ArticleSeo;
  contentBlocks: ContentBlock[];
  brandName: string;
  publishedAt: string;
  updatedAt: string;
}

export interface JsonLdArticleNode {
  "@type": "Article";
  "@id": string;
  headline: string;
  description: string;
  author: {
    "@type": "Organization" | "Person";
    name: string;
  };
  publisher: {
    "@type": "Organization";
    name: string;
  };
  datePublished: string;
  dateModified: string;
  mainEntityOfPage: {
    "@type": "WebPage";
    "@id": string;
  };
}

export interface JsonLdBreadcrumbNode {
  "@type": "BreadcrumbList";
  "@id": string;
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
}

export interface JsonLdFaqNode {
  "@type": "FAQPage";
  "@id": string;
  mainEntity: Array<{
    "@type": "Question";
    name: string;
    acceptedAnswer: {
      "@type": "Answer";
      text: string;
    };
  }>;
}

export type JsonLdGraphNode =
  | JsonLdArticleNode
  | JsonLdBreadcrumbNode
  | JsonLdFaqNode;

export interface JsonLdDocument {
  "@context": "https://schema.org";
  "@graph": JsonLdGraphNode[];
}

function normalizeSiteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return "https://example.com";
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Dựng dữ liệu có cấu trúc JSON-LD bằng code từ content_blocks và seo (R-25, R-26, R-27, R-28, R-29).
 * Tuyệt đối không để AI tự viết JSON-LD.
 */
export function buildArticleJsonLd(input: BuildJsonLdInput): JsonLdDocument {
  const baseUrl = normalizeSiteUrl(input.siteUrl);
  const cleanSlug = input.slug.replace(/^\/+/, "");
  const canonicalUrl = `${baseUrl}/blog/${cleanSlug}`;

  const articleNode: JsonLdArticleNode = {
    "@type": "Article",
    "@id": `${canonicalUrl}#article`,
    headline: input.seo.title.slice(0, CHECK_CONFIG.SCHEMA_HEADLINE_MAX_CHARS),
    description: input.seo.meta_description,
    author: {
      "@type": "Organization",
      name: input.brandName,
    },
    publisher: {
      "@type": "Organization",
      name: input.brandName,
    },
    datePublished: input.publishedAt,
    dateModified: input.updatedAt,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
  };

  const breadcrumbNode: JsonLdBreadcrumbNode = {
    "@type": "BreadcrumbList",
    "@id": `${canonicalUrl}#breadcrumb`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Trang chủ",
        item: `${baseUrl}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${baseUrl}/blog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: input.seo.title,
        item: canonicalUrl,
      },
    ],
  };

  const graph: JsonLdGraphNode[] = [articleNode, breadcrumbNode];

  const faqBlocks = input.contentBlocks.filter(
    (b): b is Extract<ContentBlock, { type: "faq" }> => b.type === "faq"
  );

  // Chỉ thêm FAQPage khi bài viết thực sự có khối FAQ hiển thị trên trang (R-26, R-27)
  if (faqBlocks.length > 0) {
    const faqNode: JsonLdFaqNode = {
      "@type": "FAQPage",
      "@id": `${canonicalUrl}#faq`,
      mainEntity: faqBlocks.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.a,
        },
      })),
    };
    graph.push(faqNode);
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

/**
 * Tuần tự hóa JSON-LD an toàn, escape ký tự `<` thành `\u003c` để chống XSS trong thẻ script (R-25).
 */
export function serializeJsonLd(doc: JsonLdDocument): string {
  return JSON.stringify(doc).replace(/</g, "\\u003c");
}

export interface JsonLdValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Kiểm tra tính hợp lệ của JSON-LD và đối chiếu khớp nội dung hiển thị (R-25, R-26, R-28, R-29).
 */
export function validateArticleJsonLd(
  doc: JsonLdDocument,
  contentBlocks: ContentBlock[]
): JsonLdValidationResult {
  const errors: string[] = [];

  if (doc["@context"] !== "https://schema.org") {
    errors.push("Thiếu hoặc sai @context https://schema.org");
  }

  const serialized = serializeJsonLd(doc);
  if (/\{\{.*?\}\}/.test(serialized)) {
    errors.push("JSON-LD còn chứa placeholder {{...}} chưa thay thế (R-25)");
  }

  const articleNode = doc["@graph"].find(
    (n): n is JsonLdArticleNode => n["@type"] === "Article"
  );
  if (!articleNode) {
    errors.push("Thiếu node Article trong @graph (R-27)");
  } else {
    if (!articleNode.headline || !articleNode.headline.trim()) {
      errors.push("Article thiếu headline (R-28)");
    } else if (
      articleNode.headline.length > CHECK_CONFIG.SCHEMA_HEADLINE_MAX_CHARS
    ) {
      errors.push(
        `Article.headline vượt quá ${CHECK_CONFIG.SCHEMA_HEADLINE_MAX_CHARS} ký tự (R-28)`
      );
    }
    if (!articleNode.description || !articleNode.description.trim()) {
      errors.push("Article thiếu description (R-28)");
    }
    if (!articleNode.author?.name?.trim()) {
      errors.push("Article thiếu author.name (R-28)");
    }
    if (
      !articleNode.datePublished ||
      Number.isNaN(Date.parse(articleNode.datePublished))
    ) {
      errors.push("Article.datePublished không đúng chuẩn ISO 8601 (R-28)");
    }
    if (
      !articleNode.dateModified ||
      Number.isNaN(Date.parse(articleNode.dateModified))
    ) {
      errors.push("Article.dateModified không đúng chuẩn ISO 8601 (R-28)");
    }
    if (!articleNode.mainEntityOfPage?.["@id"]?.startsWith("http")) {
      errors.push("Article.mainEntityOfPage.@id phải là URL tuyệt đối (R-28)");
    }
  }

  const breadcrumbNode = doc["@graph"].find(
    (n): n is JsonLdBreadcrumbNode => n["@type"] === "BreadcrumbList"
  );
  if (!breadcrumbNode) {
    errors.push("Thiếu node BreadcrumbList trong @graph (R-27)");
  } else {
    if (breadcrumbNode.itemListElement.length === 0) {
      errors.push("BreadcrumbList rỗng (R-29)");
    }
    breadcrumbNode.itemListElement.forEach((item, index) => {
      if (item.position !== index + 1) {
        errors.push(
          `BreadcrumbList position tại phần tử ${index} phải bằng ${index + 1} (R-29)`
        );
      }
      if (!item.name.trim()) {
        errors.push(`BreadcrumbList phần tử ${index + 1} thiếu name (R-29)`);
      }
      if (!/^https?:\/\//.test(item.item)) {
        errors.push(
          `BreadcrumbList phần tử ${index + 1} có item không phải URL tuyệt đối (R-29)`
        );
      }
    });
  }

  const visibleFaqs = contentBlocks.filter(
    (b): b is Extract<ContentBlock, { type: "faq" }> => b.type === "faq"
  );
  const faqNode = doc["@graph"].find(
    (n): n is JsonLdFaqNode => n["@type"] === "FAQPage"
  );

  if (visibleFaqs.length === 0 && faqNode) {
    errors.push(
      "JSON-LD có FAQPage nhưng nội dung hiển thị không có block FAQ nào (R-26)"
    );
  }

  if (visibleFaqs.length > 0) {
    if (!faqNode) {
      errors.push(
        "Bài viết có block FAQ hiển thị nhưng thiếu FAQPage trong JSON-LD (R-27)"
      );
    } else {
      if (faqNode.mainEntity.length !== visibleFaqs.length) {
        errors.push(
          `Số lượng câu hỏi trong FAQPage (${faqNode.mainEntity.length}) không khớp số FAQ hiển thị (${visibleFaqs.length}) (R-26, R-29)`
        );
      } else {
        faqNode.mainEntity.forEach((qNode, idx) => {
          const visible = visibleFaqs[idx];
          if (
            qNode.name.trim() !== visible.q.trim() ||
            qNode.acceptedAnswer.text.trim() !== visible.a.trim()
          ) {
            errors.push(
              `FAQPage phần tử #${idx + 1} không khớp nguyên văn câu hỏi/câu trả lời hiển thị trên trang (R-26, R-29)`
            );
          }
          const words = countWords(qNode.acceptedAnswer.text);
          if (words >= CHECK_CONFIG.FAQ_ANSWER_MAX_WORDS) {
            errors.push(
              `Câu trả lời FAQ #${idx + 1} dài ${words} từ (vượt ngưỡng < ${CHECK_CONFIG.FAQ_ANSWER_MAX_WORDS} từ theo R-29)`
            );
          }
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

