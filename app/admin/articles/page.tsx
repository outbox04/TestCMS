import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AiSettingsRow, ArticleRow, ArticleStatus } from "@/lib/supabase/types";
import {
  aiAutoScheduleAndPlanAction,
  createArticleAction,
  runPendingWorkerJobAction,
  triggerPublishDueAction,
} from "./actions";

interface ArticlesPageProps {
  searchParams: Promise<{ error?: string; notice?: string }>;
}

const STATUS_LABELS: Record<ArticleStatus, string> = {
  outline_draft: "1. Agent đang lập dàn ý (outline_draft)",
  outline_review: "CỔNG 1: Chờ duyệt dàn ý (outline_review)",
  awaiting_images: "2. Chờ upload ảnh (awaiting_images)",
  analyzing_images: "3. Agent phân tích ảnh (analyzing_images)",
  writing: "4. Agent viết bài (writing)",
  draft_ready: "5. Chờ kiểm tra tự động (draft_ready)",
  preview_review: "CỔNG 2: Chờ duyệt xem trước (preview_review)",
  scheduled: "Đã lên lịch (scheduled)",
  published: "Đã đăng công khai (published)",
};

export default async function AdminArticlesPage({
  searchParams,
}: ArticlesPageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: articlesData, error } = await supabase
    .from("articles")
    .select(
      "id, topic, slug, planned_publish_at, status, version, primary_keyword, checks_passed, scheduled_at, published_at, last_error, created_at, updated_at"
    )
    .order("planned_publish_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const articles = (articlesData ?? []) as ArticleRow[];

  const { data: aiSettingsData } = await supabase
    .from("ai_settings")
    .select("provider, model_writer, model_vision, api_key_last4")
    .eq("id", true)
    .maybeSingle();

  const aiSettings = aiSettingsData as Pick<
    AiSettingsRow,
    "provider" | "model_writer" | "model_vision" | "api_key_last4"
  > | null;
  const isRealAiKey = Boolean(
    aiSettings?.api_key_last4 && aiSettings.api_key_last4 !== "DEMO"
  );

  return (
    <div className="space-y-6">
      {/* Thanh trạng thái tích hợp AI & Gemini Vision */}
      <div
        className={`rounded border p-3.5 text-xs flex flex-wrap items-center justify-between gap-3 ${
          isRealAiKey
            ? "border-emerald-300 bg-emerald-50 text-emerald-900"
            : "border-amber-300 bg-amber-50 text-amber-900"
        }`}
      >
        <div>
          <strong>Trạng thái AI & Đọc ảnh Vision:</strong>{" "}
          {isRealAiKey ? (
            <span>
              🟢 Đang chạy <strong>AI thật</strong> ({aiSettings?.provider?.toUpperCase()} ·
              Viết bài: <code>{aiSettings?.model_writer}</code> · Đọc ảnh Vision:{" "}
              <code>{aiSettings?.model_vision}</code> · Key:{" "}
              <code>••••{aiSettings?.api_key_last4}</code>)
            </span>
          ) : (
            <span>
              🟡 Đang ở <strong>Chế độ Demo mẫu</strong> (chưa nhập API Key
              thật). Để dùng <strong>Google Gemini đọc ảnh & viết bài thật</strong>,
              vui lòng nhập API Key.
            </span>
          )}
        </div>
        <Link
          href="/admin/settings/ai"
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          🔑 Nhập API Key Gemini & Kiểm tra kết nối →
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Danh sách Bài viết & Lịch nội dung (`articles`)
          </h1>
          <p className="text-sm text-slate-600">
            Luồng 5 bước: Agent lập lịch + ý chính → <strong>CỔNG 1</strong>{" "}
            nhân viên duyệt/sửa → Upload ảnh → Agent phân tích ảnh & viết bài →{" "}
            <strong>CỔNG 2</strong> xem trước & đăng/lên lịch.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action={aiAutoScheduleAndPlanAction}>
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              ✨ AI Tự động Lập lịch & Ý chính (3 bài từ Hồ sơ thương hiệu)
            </button>
          </form>

          <form action={runPendingWorkerJobAction}>
            <input type="hidden" name="return_to" value="/admin/articles" />
            <button
              type="submit"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              ▶ Chạy tác vụ chờ (Dev Worker)
            </button>
          </form>

          <form action={triggerPublishDueAction}>
            <input type="hidden" name="return_to" value="/admin/articles" />
            <button
              type="submit"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              ⏰ Chạy đăng bài đến hạn
            </button>
          </form>
        </div>
      </div>

      {params.error || error ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {params.error ?? error?.message}
        </div>
      ) : null}

      {params.notice ? (
        <div
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {params.notice}
        </div>
      ) : null}

      <form
        action={createArticleAction}
        className="rounded border border-slate-200 bg-white p-5 space-y-4"
      >
        <h2 className="text-base font-bold text-slate-900">
          Hoặc nhập chủ đề cụ thể để AI lập lịch & sinh dàn ý ngay (Bao gồm test
          Kịch bản C: &ldquo;Chính sách bảo hành và đổi trả&rdquo;)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label
              htmlFor="topic"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Chủ đề bài viết (`topic`)
            </label>
            <input
              id="topic"
              name="topic"
              type="text"
              required
              placeholder="Ví dụ: Hướng dẫn pha espresso chuẩn vị với máy pha cà phê LumiBrew Mini X1"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="planned_publish_at"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Ngày đăng dự kiến (để trống = AI tự xếp lịch ngày mai)
            </label>
            <input
              id="planned_publish_at"
              name="planned_publish_at"
              type="datetime-local"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
        </div>

        <button
          type="submit"
          className="rounded border border-slate-900 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
        >
          + Tạo bài & Cho AI lập dàn ý ngay
        </button>
      </form>

      <div className="rounded border border-slate-200 bg-white overflow-x-auto">
        {articles.length === 0 ? (
          <div className="p-6 text-sm text-slate-600 space-y-3">
            <p>
              Chưa có bài viết nào trong lịch. Bạn hãy bấm nút{" "}
              <strong>
                &ldquo;✨ AI Tự động Lập lịch & Ý chính (3 bài từ Hồ sơ thương
                hiệu)&rdquo;
              </strong>{" "}
              ở góc trên để AI tự động lên lịch 3 bài viết kèm từ khóa, FAQ và
              dàn ý!
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                <th className="p-3">Chủ đề / Từ khóa chính</th>
                <th className="p-3">Trạng thái</th>
                <th className="p-3">Phiên bản</th>
                <th className="p-3">Dự kiến đăng</th>
                <th className="p-3">Kiểm tra</th>
                <th className="p-3">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((art) => (
                <tr
                  key={art.id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">
                      <Link
                        href={`/admin/articles/${art.id}`}
                        className="hover:underline"
                      >
                        {art.topic}
                      </Link>
                    </div>
                    {art.primary_keyword ? (
                      <div className="text-xs text-slate-500 mt-0.5">
                        Từ khóa: <code>{art.primary_keyword}</code>
                      </div>
                    ) : null}
                    {art.last_error ? (
                      <div className="text-xs text-red-600 mt-1 line-clamp-1">
                        Lỗi: {art.last_error}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3 text-xs font-medium text-slate-800">
                    {STATUS_LABELS[art.status]}
                  </td>
                  <td className="p-3 text-xs text-slate-600">v{art.version}</td>
                  <td className="p-3 text-xs text-slate-600">
                    {art.planned_publish_at
                      ? new Date(art.planned_publish_at).toLocaleString("vi-VN")
                      : "—"}
                  </td>
                  <td className="p-3 text-xs">
                    {art.checks_passed ? (
                      <span className="text-emerald-700 font-semibold">
                        Đạt
                      </span>
                    ) : (
                      <span className="text-slate-500">Chưa đạt</span>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    <Link
                      href={`/admin/articles/${art.id}`}
                      className="rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
                    >
                      Mở chi tiết →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
