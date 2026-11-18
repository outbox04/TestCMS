import Link from "next/link";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { ArticleRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function BlogIndexPage() {
  let articles: ArticleRow[] = [];
  let errorMsg: string | null = null;

  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("articles")
      .select(
        "id, topic, slug, status, seo, published_at, created_at, updated_at"
      )
      .eq("status", "published")
      .order("published_at", { ascending: false });

    if (error) {
      errorMsg = error.message;
    } else {
      articles = (data ?? []) as ArticleRow[];
    }
  } catch (err) {
    errorMsg =
      err instanceof Error ? err.message : "Chưa kết nối được Supabase";
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Blog Kiến thức
            </h1>
            <p className="text-sm text-slate-600">
              Chỉ hiển thị các bài viết đã qua 2 cổng duyệt và ở trạng thái{" "}
              <code>published</code> (R-41).
            </p>
          </div>
          <Link
            href="/admin/articles"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Quản trị CMS
          </Link>
        </div>

        {errorMsg ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {errorMsg}
          </div>
        ) : articles.length === 0 ? (
          <p className="text-sm text-slate-600">
            Chưa có bài viết nào được xuất bản.
          </p>
        ) : (
          <div className="space-y-6">
            {articles.map((article) => {
              const title = article.seo?.title ?? article.topic;
              const desc = article.seo?.meta_description ?? "";
              const href = `/blog/${article.slug ?? article.id}`;
              return (
                <article
                  key={article.id}
                  className="rounded border border-slate-200 p-5 hover:border-slate-300"
                >
                  <h2 className="text-lg font-bold text-slate-900 mb-1">
                    <Link href={href} className="hover:underline">
                      {title}
                    </Link>
                  </h2>
                  {article.published_at ? (
                    <div className="text-xs text-slate-500 mb-2">
                      Đăng ngày:{" "}
                      {new Date(article.published_at).toLocaleString("vi-VN")}
                    </div>
                  ) : null}
                  {desc ? (
                    <p className="text-sm text-slate-700">{desc}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

