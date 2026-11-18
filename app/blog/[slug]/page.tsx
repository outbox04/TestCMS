import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleRenderer } from "@/components/ArticleRenderer";
import { buildArticleJsonLd, serializeJsonLd } from "@/lib/seo/schema";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  ArticleAssetRow,
  ArticleRow,
  BrandProfileRow,
  ContentBlock,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

async function fetchPublishedArticleBySlug(slug: string): Promise<{
  article: ArticleRow;
  brand: BrandProfileRow | null;
  assetUrlMap: Record<string, string>;
} | null> {
  const admin = createAdminSupabaseClient();

  // Chỉ lấy bài có trạng thái published — tuyệt đối không lộ bản nháp ra công khai (R-41)
  const { data: articleData } = await admin
    .from("articles")
    .select("*")
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();

  if (!articleData) {
    return null;
  }

  const article = articleData as ArticleRow;

  const { data: brandData } = await admin
    .from("brand_profile")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  const { data: assetsData } = await admin
    .from("article_assets")
    .select("id, storage_path")
    .eq("article_id", article.id);

  const assetUrlMap: Record<string, string> = {};
  for (const asset of (assetsData ?? []) as Pick<
    ArticleAssetRow,
    "id" | "storage_path"
  >[]) {
    const { data: signed } = await admin.storage
      .from("article-images")
      .createSignedUrl(asset.storage_path, 3600);
    if (signed?.signedUrl) {
      assetUrlMap[asset.id] = signed.signedUrl;
    }
  }

  return {
    article,
    brand: (brandData as BrandProfileRow | null) ?? null,
    assetUrlMap,
  };
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const fetched = await fetchPublishedArticleBySlug(slug);
    if (!fetched) {
      return { title: "Không tìm thấy bài viết" };
    }
    const { article } = fetched;
    const siteUrl = (process.env.SITE_URL ?? "https://example.com").replace(
      /\/+$/,
      ""
    );
    const title = article.seo?.title ?? article.topic;
    const description = article.seo?.meta_description ?? "";
    const canonical = `${siteUrl}/blog/${article.slug ?? slug}`;

    return {
      title,
      description,
      alternates: {
        canonical,
      },
      openGraph: {
        title,
        description,
        url: canonical,
        type: "article",
      },
    };
  } catch {
    return { title: "Blog" };
  }
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const fetched = await fetchPublishedArticleBySlug(slug);

  if (!fetched) {
    notFound();
  }

  const { article, brand, assetUrlMap } = fetched;
  const blocks: ContentBlock[] = Array.isArray(article.content_blocks)
    ? article.content_blocks
    : [];
  const seo = article.seo ?? {
    title: article.topic,
    meta_description: article.topic,
  };

  const jsonLdDoc = buildArticleJsonLd({
    siteUrl: process.env.SITE_URL ?? "https://example.com",
    slug: article.slug ?? slug,
    seo,
    contentBlocks: blocks,
    brandName: brand?.brand_name ?? "Thương hiệu Demo",
    publishedAt: article.published_at ?? article.created_at,
    updatedAt: article.updated_at,
  });

  return (
    <main className="min-h-screen bg-white py-10 px-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(jsonLdDoc),
        }}
      />
      <div className="mx-auto max-w-3xl mb-6">
        <Link
          href="/blog"
          className="text-sm text-slate-600 hover:text-slate-900 underline"
        >
          ← Quay lại danh sách Blog
        </Link>
      </div>
      <ArticleRenderer
        title={seo.title}
        publishedAt={article.published_at}
        brandName={brand?.brand_name}
        blocks={blocks}
        assetUrlMap={assetUrlMap}
      />
    </main>
  );
}

