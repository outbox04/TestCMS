import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { ArticleRow, BrandProfileRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Dựng /llms.txt từ brand_profile và danh sách bài viết đã đăng (published) theo R-40.
 */
export async function GET() {
  const siteUrl = (process.env.SITE_URL ?? "https://example.com").replace(
    /\/+$/,
    ""
  );

  let brand: BrandProfileRow | null = null;
  let publishedArticles: ArticleRow[] = [];

  try {
    const admin = createAdminSupabaseClient();
    const { data: brandData } = await admin
      .from("brand_profile")
      .select("*")
      .eq("id", true)
      .maybeSingle();

    brand = (brandData as BrandProfileRow | null) ?? null;

    const { data: articlesData } = await admin
      .from("articles")
      .select("id, topic, slug, seo, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false });

    publishedArticles = (articlesData ?? []) as ArticleRow[];
  } catch {
    // Khi chạy build/test không có kết nối DB vẫn trả về khung llms.txt hợp lệ
  }

  const brandName = brand?.brand_name ?? "Content Agent Demo Brand";
  const brandDesc =
    brand?.description ??
    "Hệ thống quản trị và xuất bản nội dung chuẩn SEO/GEO/AEO.";

  const lines: string[] = [
    `# ${brandName}`,
    `> ${brandDesc}`,
    "",
    "## Sản phẩm chính",
  ];

  if (brand?.products && brand.products.length > 0) {
    for (const prod of brand.products) {
      lines.push(
        `- **${prod.name}** (${prod.price_formatted}): ${prod.description}`
      );
    }
  } else {
    lines.push("- Chưa cập nhật danh sách sản phẩm.");
  }

  lines.push("", "## Sự thật đã kiểm chứng (Verified Facts)");
  if (brand?.facts && brand.facts.length > 0) {
    for (const fact of brand.facts) {
      lines.push(`- [${fact.id}] ${fact.statement}`);
    }
  } else {
    lines.push("- Chưa cập nhật danh sách facts.");
  }

  lines.push("", "## Bài viết đã xuất bản");
  if (publishedArticles.length > 0) {
    for (const art of publishedArticles) {
      const title = art.seo?.title ?? art.topic;
      const desc = art.seo?.meta_description ?? "";
      const url = `${siteUrl}/blog/${art.slug ?? art.id}`;
      lines.push(`- [${title}](${url}): ${desc}`);
    }
  } else {
    lines.push("- Chưa có bài viết xuất bản.");
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

