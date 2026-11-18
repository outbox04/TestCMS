import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleRenderer } from "@/components/ArticleRenderer";
import { VisualBlockEditor } from "@/components/VisualBlockEditor";
import {
  runPendingWorkerJobAction,
  triggerPublishDueAction,
} from "@/app/admin/articles/actions";
import { buildArticleJsonLd, serializeJsonLd } from "@/lib/seo/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildWebsiteContentStandardExport } from "@/lib/writing-engine";
import {
  ArticleOutlinePayloadSchema,
  type ArticleAssetRow,
  type ArticleEventRow,
  type ArticleRow,
  type BrandProfileRow,
  type ContentBlock,
  type OutlineItem,
} from "@/lib/supabase/types";
import {
  saveOutlineReviewAction,
  savePreviewContentAction,
  transitionArticleAction,
  uploadArticleImageAction,
  uploadDemoSampleImageAction,
} from "./actions";

interface ArticleDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}

function parseOutlineAndNeedsInfo(article: ArticleRow): {
  outlineItems: OutlineItem[];
  needsInfo: string[];
} {
  let outlineItems: OutlineItem[] = [];
  const needsSet = new Set<string>();

  if (article.outline) {
    if (Array.isArray(article.outline)) {
      outlineItems = article.outline;
    } else {
      const parsed = ArticleOutlinePayloadSchema.safeParse(article.outline);
      if (parsed.success) {
        outlineItems = parsed.data.items;
        for (const item of parsed.data.needs_info) {
          if (item.trim()) needsSet.add(item.trim());
        }
      }
    }
  }

  for (const item of article.seo?.needs_info ?? []) {
    if (item.trim()) needsSet.add(item.trim());
  }

  for (const item of article.check_report?.needs_info ?? []) {
    if (item.trim()) needsSet.add(item.trim());
  }

  return {
    outlineItems,
    needsInfo: Array.from(needsSet),
  };
}

export default async function AdminArticleDetailPage({
  params,
  searchParams,
}: ArticleDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: articleData } = await supabase
    .from("articles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!articleData) {
    notFound();
  }

  const article = articleData as ArticleRow;
  const { outlineItems, needsInfo } = parseOutlineAndNeedsInfo(article);

  const { data: assetsData } = await supabase
    .from("article_assets")
    .select("*")
    .eq("article_id", article.id)
    .order("created_at", { ascending: true });

  const assets = (assetsData ?? []) as ArticleAssetRow[];

  const assetUrlMap: Record<string, string> = {};
  for (const asset of assets) {
    const { data: signed } = await supabase.storage
      .from("article-images")
      .createSignedUrl(asset.storage_path, 3600);
    if (signed?.signedUrl) {
      assetUrlMap[asset.id] = signed.signedUrl;
    }
  }

  const { data: eventsData } = await supabase
    .from("article_events")
    .select("*")
    .eq("article_id", article.id)
    .order("created_at", { ascending: false });

  const events = (eventsData ?? []) as ArticleEventRow[];

  const { data: brandData } = await supabase
    .from("brand_profile")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  const brand = (brandData as BrandProfileRow | null) ?? null;

  const { data: publishedArticlesData } = await supabase
    .from("articles")
    .select("id, topic, slug, primary_keyword, seo, status")
    .eq("status", "published");

  const publishedArticles = (publishedArticlesData ?? []) as Array<
    Pick<
      ArticleRow,
      "id" | "topic" | "slug" | "primary_keyword" | "seo" | "status"
    >
  >;

  const standardDeliverable = buildWebsiteContentStandardExport({
    article,
    brand,
    assets,
    publishedArticles,
    siteUrl: process.env.SITE_URL ?? "https://example.com",
  });

  const contentBlocks: ContentBlock[] = Array.isArray(article.content_blocks)
    ? article.content_blocks
    : [];

  const seo = article.seo ?? {
    title: article.topic,
    meta_description: article.topic,
  };

  const jsonLdPreview =
    contentBlocks.length > 0
      ? buildArticleJsonLd({
        siteUrl: process.env.SITE_URL ?? "https://example.com",
        slug: article.slug ?? article.id,
        seo,
        contentBlocks,
        brandName: brand?.brand_name ?? "Thương hiệu Demo",
        publishedAt: article.published_at ?? article.created_at,
        updatedAt: article.updated_at,
      })
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/articles"
            className="text-xs text-slate-600 hover:text-slate-900 underline"
          >
            ← Danh sách bài viết
          </Link>
          <h1 className="text-xl font-bold text-slate-900 mt-1">
            {article.topic}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mt-1">
            <span>
              Trạng thái:{" "}
              <strong className="rounded bg-slate-200 px-2 py-0.5 text-slate-900">
                {article.status}
              </strong>
            </span>
            <span>
              Phiên bản (`expected_version`): <strong>v{article.version}</strong>
            </span>
            {article.slug ? (
              <span>
                Slug: <code>{article.slug}</code>
              </span>
            ) : null}
            {article.status === "published" && article.slug ? (
              <Link
                href={`/blog/${article.slug}`}
                className="text-emerald-700 font-semibold underline"
              >
                Xem bài đã đăng công khai ↗
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <form action={runPendingWorkerJobAction}>
            <input
              type="hidden"
              name="return_to"
              value={`/admin/articles/${article.id}`}
            />
            <button
              type="submit"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              ▶ Chạy tác vụ chờ (Dev Worker)
            </button>
          </form>

          {article.status === "scheduled" ? (
            <form action={triggerPublishDueAction}>
              <input
                type="hidden"
                name="return_to"
                value={`/admin/articles/${article.id}`}
              />
              <button
                type="submit"
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                ⏰ Chạy đăng bài đến hạn
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {query.error ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          <strong>Lỗi từ Cơ sở dữ liệu / Server:</strong> {query.error}
        </div>
      ) : null}

      {query.notice ? (
        <div
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {query.notice}
        </div>
      ) : null}

      {article.last_error ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900"
        >
          <div className="font-bold mb-1">Lỗi gần nhất (`last_error`):</div>
          <div>{article.last_error}</div>
        </div>
      ) : null}

      {needsInfo.length > 0 ? (
        <div
          role="alert"
          className="rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <div className="font-bold mb-1">
            Danh sách thông tin còn thiếu trong `brand_profile` (`needs_info` —
            chặn tự bịa theo R-31, R-34):
          </div>
          <ul className="list-disc pl-5 space-y-1">
            {needsInfo.map((info, idx) => (
              <li key={idx}>{info}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Trạng thái chờ Worker xử lý */}
      {article.status === "outline_draft" ||
        article.status === "analyzing_images" ||
        article.status === "writing" ||
        article.status === "draft_ready" ? (
        <section className="rounded border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900">
            Đang ở bước xử lý của Agent (`{article.status}`)
          </h2>
          <p className="text-sm text-slate-600">
            Tác vụ đã được đẩy vào hàng đợi `pgmq` (`agent_jobs`). Bấm nút{" "}
            <strong>&ldquo;▶ Chạy tác vụ chờ (Dev Worker)&rdquo;</strong> ở góc
            trên để thực thi bước tiếp theo.
          </p>
        </section>
      ) : null}

      {/* CỔNG 1: outline_review */}
      {article.status === "outline_review" ? (
        <section className="rounded border border-slate-300 bg-white p-6 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-lg font-bold text-slate-900">
              CỔNG 1 — Duyệt hoặc Sửa Ý chính & Từ khóa (`outline_review`)
            </h2>
            <p className="text-xs text-slate-600">
              Kiểm tra từ khóa chính/phụ, câu hỏi FAQ và các mục H2 (kèm{" "}
              <code>fact_ids</code>) trước khi sang bước tải ảnh (R-08, R-09,
              R-36).
            </p>
          </div>

          <form action={saveOutlineReviewAction} className="space-y-4">
            <input type="hidden" name="article_id" value={article.id} />

            <div>
              <label
                htmlFor="primary_keyword"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Từ khóa chính (`primary_keyword`)
              </label>
              <input
                id="primary_keyword"
                name="primary_keyword"
                type="text"
                required
                defaultValue={article.primary_keyword ?? ""}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="secondary_keywords"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Từ khóa phụ (`secondary_keywords`, tối đa 8 — mỗi dòng 1 từ)
                </label>
                <textarea
                  id="secondary_keywords"
                  name="secondary_keywords"
                  rows={5}
                  defaultValue={(article.secondary_keywords ?? []).join("\n")}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="faq_questions"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Câu hỏi FAQ (`faq_questions`, tối đa 6 — mỗi dòng 1 câu)
                </label>
                <textarea
                  id="faq_questions"
                  name="faq_questions"
                  rows={5}
                  defaultValue={(article.faq_questions ?? []).join("\n")}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="outline_json"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Dàn ý chi tiết (`outline` JSON — mảng `{"{h2, key_points, fact_ids}"}`)
              </label>
              <textarea
                id="outline_json"
                name="outline_json"
                rows={10}
                defaultValue={JSON.stringify(outlineItems, null, 2)}
                className="w-full font-mono rounded border border-slate-300 px-3 py-2 text-xs text-slate-900"
              />
            </div>

            <button
              type="submit"
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Lưu chỉnh sửa dàn ý
            </button>
          </form>

          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center gap-3">
            <form action={transitionArticleAction}>
              <input type="hidden" name="article_id" value={article.id} />
              <input
                type="hidden"
                name="expected_version"
                value={article.version}
              />
              <input type="hidden" name="to_status" value="awaiting_images" />
              <input
                type="hidden"
                name="note"
                value="Nhân viên duyệt ý chính tại Cổng 1"
              />
              <button
                type="submit"
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                ✓ Duyệt ý chính (Chuyển sang tải ảnh)
              </button>
            </form>

            <form action={transitionArticleAction} className="flex gap-2">
              <input type="hidden" name="article_id" value={article.id} />
              <input
                type="hidden"
                name="expected_version"
                value={article.version}
              />
              <input type="hidden" name="to_status" value="outline_draft" />
              <input
                type="text"
                name="note"
                placeholder="Ghi chú yêu cầu lập lại..."
                className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-900"
              />
              <button
                type="submit"
                className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
              >
                ↺ Yêu cầu lập lại
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {/* Bước awaiting_images */}
      {article.status === "awaiting_images" ? (
        <section className="rounded border border-slate-300 bg-white p-6 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-lg font-bold text-slate-900">
              Bước Tải ảnh minh họa (`awaiting_images`)
            </h2>
            <p className="text-xs text-slate-600">
              Server Action dùng <code>sharp</code> tính <code>sha256</code>, tạo
              bản phân tích JPEG cạnh dài ≤ 1568px (R-10, R-11), lưu vào bucket{" "}
              <code>article-images</code>; tự động bỏ qua nếu trùng{" "}
              <code>sha256</code> trong cùng bài (R-13).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <form
              action={uploadArticleImageAction}
              className="flex flex-wrap items-center gap-3"
            >
              <input type="hidden" name="article_id" value={article.id} />
              <input
                type="file"
                name="image"
                accept="image/png,image/jpeg,image/webp"
                required
                className="text-sm text-slate-700"
              />
              <button
                type="submit"
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                ↑ Upload & Tạo bản phân tích JPEG
              </button>
            </form>

            <form action={uploadDemoSampleImageAction}>
              <input type="hidden" name="article_id" value={article.id} />
              <button
                type="submit"
                className="rounded border border-slate-900 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
              >
                🖼️ Tạo nhanh ảnh mẫu Demo (2400×1600px → Resize 1568px)
              </button>
            </form>
          </div>

          <div className="pt-4 border-t border-slate-200">
            <form action={transitionArticleAction}>
              <input type="hidden" name="article_id" value={article.id} />
              <input
                type="hidden"
                name="expected_version"
                value={article.version}
              />
              <input type="hidden" name="to_status" value="analyzing_images" />
              <input
                type="hidden"
                name="note"
                value="Đã upload xong ảnh, chuyển cho Agent phân tích"
              />
              <button
                type="submit"
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                ✓ Xong ảnh, phân tích (`analyzing_images`)
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {/* Danh sách ảnh đã tải lên */}
      {assets.length > 0 ? (
        <section className="rounded border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900">
            Danh sách ảnh của bài viết (`article_assets` — {assets.length} ảnh)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="rounded border border-slate-200 p-3 text-xs space-y-1.5"
              >
                <div className="font-mono text-slate-500">ID: {asset.id}</div>
                <div>
                  Kích thước gốc: {asset.width ?? "?"}×{asset.height ?? "?"}px ·
                  SHA-256: <code>{asset.sha256.slice(0, 16)}...</code>
                </div>
                <div>
                  Bản phân tích: <code>{asset.analysis_path ?? "—"}</code>
                </div>
                <div>
                  Alt text: <strong>{asset.alt_text ?? "(chưa phân tích)"}</strong>
                </div>
                {asset.analysis ? (
                  <div className="bg-slate-50 p-2 rounded border border-slate-100">
                    <div>
                      <strong>Mô tả:</strong> {asset.analysis.description}
                    </div>
                    <div>
                      <strong>Chữ nhìn thấy:</strong>{" "}
                      {asset.analysis.visible_text ?? "Không có"}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* CỔNG 2: preview_review */}
      {article.status === "preview_review" ? (
        <section className="rounded border border-slate-300 bg-white p-6 space-y-6">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-lg font-bold text-slate-900">
              CỔNG 2 — Xem trước & Quyết định Xuất bản (`preview_review`)
            </h2>
            <p className="text-xs text-slate-600">
              Hiển thị bằng cùng một component <code>&lt;ArticleRenderer&gt;</code>{" "}
              và file <code>article-theme.css</code> với trang công khai{" "}
              <code>/blog/[slug]</code> (R-41). Chỉ nhân viên mới có quyền Đăng
              ngay hoặc Lên lịch (R-37).
            </p>
          </div>

          {/* Thẻ xem trước SEO & Open Graph (R-41) */}
          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-xs space-y-1">
            <div className="font-bold text-slate-700 uppercase">
              Xem trước Thẻ Tìm kiếm & Mạng xã hội (SEO / OG Preview — R-20, R-41)
            </div>
            <div className="text-base font-bold text-blue-800">{seo.title}</div>
            <div className="text-emerald-700">
              {(process.env.SITE_URL ?? "https://example.com").replace(
                /\/+$/,
                ""
              )}
              /blog/{article.slug ?? article.id}
            </div>
            <div className="text-slate-700">{seo.meta_description}</div>
          </div>

          <div className="rounded border border-slate-200 bg-white p-6">
            <ArticleRenderer
              title={seo.title}
              publishedAt={article.published_at ?? article.created_at}
              brandName={brand?.brand_name}
              blocks={contentBlocks}
              assetUrlMap={assetUrlMap}
            />
          </div>

          {jsonLdPreview ? (
            <details className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-800">
                Xem JSON-LD Schema do code dựng (`Article` + `BreadcrumbList` +
                `FAQPage` — R-25..R-29)
              </summary>
              <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-slate-800">
                {serializeJsonLd(jsonLdPreview)}
              </pre>
            </details>
          ) : null}

          {/* Trình chỉnh sửa trực quan Nội dung & SEO (Phase 2) */}
          <details className="rounded border border-slate-300 bg-white">
            <summary className="cursor-pointer p-4 text-sm font-bold text-slate-900 bg-slate-50 hover:bg-slate-100">
              ✏️ Mở Trình Chỉnh sửa Trực quan Nội dung & SEO (`content_blocks` +
              `seo`)
            </summary>
            <div className="p-4">
              <VisualBlockEditor
                articleId={article.id}
                initialSlug={article.slug ?? ""}
                initialSeoTitle={seo.title}
                initialSeoMetaDescription={seo.meta_description}
                initialBlocks={contentBlocks}
                availableAssets={assets.map((a) => ({
                  id: a.id,
                  alt_text: a.alt_text,
                }))}
                availableFacts={brand?.facts ?? []}
                saveAction={savePreviewContentAction}
              />
            </div>
          </details>

          {!article.checks_passed ? (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Lưu ý chặn xuất bản:</strong> Bài viết hiện chưa vượt qua
              đầy đủ 6/6 kiểm tra tự động (`checks_passed = false`). Vui lòng
              sửa nội dung trong Trình chỉnh sửa Trực quan ở trên hoặc bấm
              &ldquo;↺ Yêu cầu sửa&rdquo; trước khi Đăng ngay hoặc Lên lịch.
            </div>
          ) : null}

          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-end gap-4">
            {/* Nút 1: Đăng ngay */}
            <form action={transitionArticleAction}>
              <input type="hidden" name="article_id" value={article.id} />
              <input
                type="hidden"
                name="expected_version"
                value={article.version}
              />
              <input type="hidden" name="to_status" value="published" />
              <input
                type="hidden"
                name="note"
                value="Nhân viên duyệt Đăng ngay tại Cổng 2"
              />
              <button
                type="submit"
                disabled={!article.checks_passed}
                className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
              >
                🚀 Đăng ngay (`published`)
              </button>
            </form>

            {/* Nút 2: Lên lịch */}
            <form
              action={transitionArticleAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="article_id" value={article.id} />
              <input
                type="hidden"
                name="expected_version"
                value={article.version}
              />
              <input type="hidden" name="to_status" value="scheduled" />
              <input
                type="hidden"
                name="note"
                value="Nhân viên đặt lịch đăng tại Cổng 2"
              />
              <div>
                <label
                  htmlFor="scheduled_at"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Thời điểm lên lịch (tương lai)
                </label>
                <input
                  id="scheduled_at"
                  name="scheduled_at"
                  type="datetime-local"
                  required
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={!article.checks_passed}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
              >
                📅 Lên lịch (`scheduled`)
              </button>
            </form>

            {/* Nút 3: Yêu cầu sửa */}
            <form
              action={transitionArticleAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="article_id" value={article.id} />
              <input
                type="hidden"
                name="expected_version"
                value={article.version}
              />
              <input type="hidden" name="to_status" value="writing" />
              <div>
                <label
                  htmlFor="reject_note"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Ghi chú yêu cầu sửa
                </label>
                <input
                  id="reject_note"
                  name="note"
                  type="text"
                  required
                  placeholder="Nhập nội dung cần chỉnh sửa..."
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
              </div>
              <button
                type="submit"
                className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
              >
                ↺ Yêu cầu sửa (Quay lại `writing`)
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {/* Trạng thái scheduled */}
      {article.status === "scheduled" ? (
        <section className="rounded border border-slate-300 bg-white p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            Bài viết đã lên lịch đăng (`scheduled`)
          </h2>
          <p className="text-sm text-slate-700">
            Thời điểm đăng dự kiến:{" "}
            <strong>
              {article.scheduled_at
                ? new Date(article.scheduled_at).toLocaleString("vi-VN")
                : "—"}
            </strong>
          </p>
          <form action={transitionArticleAction}>
            <input type="hidden" name="article_id" value={article.id} />
            <input
              type="hidden"
              name="expected_version"
              value={article.version}
            />
            <input type="hidden" name="to_status" value="preview_review" />
            <input
              type="hidden"
              name="note"
              value="Nhân viên hủy lịch, đưa về xem trước"
            />
            <button
              type="submit"
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Hủy lịch (Quay về `preview_review`)
            </button>
          </form>
        </section>
      ) : null}

      {/* Báo cáo kiểm tra tự động check_report */}
      <section className="rounded border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-base font-bold text-slate-900">
          Báo cáo Kiểm tra Tự động (`check_report` — Chạy bằng code, không gọi AI)
        </h2>
        {!article.check_report ? (
          <p className="text-sm text-slate-500">
            Chưa có kết quả kiểm tra tự động cho bài viết này.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-slate-600">
              Trạng thái tổng:{" "}
              <strong
                className={
                  article.check_report.passed
                    ? "text-emerald-700"
                    : "text-red-700"
                }
              >
                {article.check_report.passed ? "ĐẠT (PASSED)" : "CHƯA ĐẠT (FAILED)"}
              </strong>{" "}
              · Lúc:{" "}
              {new Date(article.check_report.checked_at).toLocaleString("vi-VN")}
            </div>

            {/* Thang điểm chất lượng 100 điểm (Phase 2 Quality Rubric) */}
            {article.check_report.quality_score ? (
              <div className="rounded border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-900">
                    📊 Thang Điểm Chất Lượng Nội Bộ (100 Điểm — Không đánh đồng
                    với thứ hạng Google/AI):
                  </div>
                  <span
                    className={`rounded px-2.5 py-0.5 text-xs font-bold ${
                      article.check_report.quality_score.blocked_by_truth
                        ? "bg-red-100 text-red-800"
                        : article.check_report.quality_score.total_score >= 90
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    Tổng điểm:{" "}
                    {article.check_report.quality_score.total_score}/100 ·{" "}
                    {article.check_report.quality_score.band_label}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  <div className="rounded border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">A. SEO</div>
                    <div className="text-sm font-bold text-slate-900">
                      {article.check_report.quality_score.seo_score}/25
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">B. GEO</div>
                    <div className="text-sm font-bold text-slate-900">
                      {article.check_report.quality_score.geo_score}/25
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">C. AEO</div>
                    <div className="text-sm font-bold text-slate-900">
                      {article.check_report.quality_score.aeo_score}/20
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">D. TRUST</div>
                    <div className="text-sm font-bold text-slate-900">
                      {article.check_report.quality_score.trust_score}/15
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">E. UX & CTA</div>
                    <div className="text-sm font-bold text-slate-900">
                      {article.check_report.quality_score.ux_score}/15
                    </div>
                  </div>
                </div>

                {(article.check_report.quality_score.hard_blockers?.length ??
                  0) > 0 ? (
                  <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900 space-y-1">
                    <div className="font-bold">
                      ⛔ Hard Blockers (Chặn xuất bản — Bắt buộc sửa):
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {article.check_report.quality_score.hard_blockers?.map(
                        (hb, idx) => (
                          <li key={idx}>
                            <code>{hb.code}</code> tại{" "}
                            <strong>{hb.location}</strong>: {hb.message}
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                ) : null}

                {(article.check_report.quality_score.major_issues?.length ??
                  0) > 0 ? (
                  <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                    <div className="font-bold">
                      ⚠️ Major Issues (Lỗi cấu trúc / SEO chính):
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {article.check_report.quality_score.major_issues?.map(
                        (mj, idx) => (
                          <li key={idx}>
                            <code>{mj.code}</code> tại{" "}
                            <strong>{mj.location}</strong>: {mj.message}
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                ) : null}

                {article.check_report.quality_score.advisory_notes.length >
                0 ? (
                  <div className="text-xs text-slate-700 space-y-1">
                    <div className="font-semibold">
                      Gợi ý tối ưu chi tiết:
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {article.check_report.quality_score.advisory_notes.map(
                        (note, nIdx) => (
                          <li key={nIdx}>{note}</li>
                        )
                      )}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="divide-y divide-slate-100 border border-slate-200 rounded">
              {article.check_report.items.map((item) => (
                <div
                  key={item.code}
                  className="p-3 text-xs flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      {item.passed ? "✅" : "❌"} {item.code}{" "}
                      <span className="text-slate-500 font-normal">
                        [{item.ruleIds.join(", ")}]
                      </span>
                    </div>
                    <div className="text-slate-700 mt-0.5">{item.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Báo cáo Content Orchestrator (11 trường) & Bàn giao 4 Phần (Phase 3) */}
      <section className="rounded border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              🧭 Trạng thái Điều phối Content Orchestrator & Hồ sơ Bàn giao 4
              Phần (Phase 3)
            </h2>
            <p className="text-xs text-slate-600">
              Xuất cấu trúc chuẩn 11 trường của Content Orchestrator kèm gợi ý
              Internal Links xác thực (`R-23`) và hồ sơ Phần A – Phần D.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2.5 py-1 text-xs font-mono text-slate-800">
            workflow_status: {standardDeliverable.orchestrator.workflow_status} ·
            evidence_status: {standardDeliverable.orchestrator.evidence_status}
          </span>
        </div>

        {standardDeliverable.part_c_seo_assets.internal_links.length > 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
            <div className="font-semibold text-slate-800">
              🔗 Gợi ý Liên kết Nội bộ xác thực (`Internal Links` từ bài đã xuất
              bản — R-23):
            </div>
            <ul className="list-disc pl-5 space-y-1 text-slate-700">
              {standardDeliverable.part_c_seo_assets.internal_links.map(
                (link) => (
                  <li key={link.target_article_id}>
                    Anchor: <strong>{link.anchor_text}</strong> →{" "}
                    <code>{link.target_url}</code>{" "}
                    <span className="text-slate-500">({link.reason})</span>
                  </li>
                )
              )}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <details className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-800">
              Xem Output 11 trường của Content Orchestrator (JSON)
            </summary>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-slate-800">
              {JSON.stringify(standardDeliverable.orchestrator, null, 2)}
            </pre>
          </details>

          <details className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-800">
              Xem Hồ sơ Bàn giao 4 Phần (PHẦN A – D Website Content Standard)
            </summary>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-slate-800">
              {JSON.stringify(
                {
                  PHAN_A_SEO_METADATA: standardDeliverable.part_a_seo_metadata,
                  PHAN_B_WEBSITE_CONTENT:
                    standardDeliverable.part_b_website_content,
                  PHAN_C_SEO_ASSETS: standardDeliverable.part_c_seo_assets,
                  PHAN_D_QUALITY_REPORT:
                    standardDeliverable.part_d_quality_report,
                },
                null,
                2
              )}
            </pre>
          </details>
        </div>
      </section>

      {/* Lịch sử sự kiện article_events */}
      <section className="rounded border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-base font-bold text-slate-900">
          Lịch sử Chuyển trạng thái (`article_events`)
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có sự kiện nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Thời gian</th>
                  <th className="py-2 pr-3">Từ trạng thái</th>
                  <th className="py-2 pr-3">Sang trạng thái</th>
                  <th className="py-2 pr-3">Vai trò (`actor_kind`)</th>
                  <th className="py-2 pr-3">Ghi chú (`note`)</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-600">
                      {new Date(ev.created_at).toLocaleString("vi-VN")}
                    </td>
                    <td className="py-2 pr-3">{ev.from_status ?? "—"}</td>
                    <td className="py-2 pr-3 font-semibold text-slate-900">
                      {ev.to_status}
                    </td>
                    <td className="py-2 pr-3">
                      <code>{ev.actor_kind}</code>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">
                      {ev.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
