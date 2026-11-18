import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AiRunRow, AiSettingsRow } from "@/lib/supabase/types";
import { saveAiSettingsAction, testAiConnectionAction } from "./actions";

interface AiSettingsPageProps {
  searchParams: Promise<{ error?: string; notice?: string }>;
}

export default async function AiSettingsPage({
  searchParams,
}: AiSettingsPageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    redirect("/admin/articles");
  }

  const { data: settingsData } = await supabase
    .from("ai_settings")
    .select(
      "id, provider, model_writer, model_vision, api_key_secret_id, api_key_last4, monthly_token_budget, updated_by, updated_at"
    )
    .eq("id", true)
    .maybeSingle();

  const settings = settingsData as AiSettingsRow | null;
  const isRealKeyConfigured = Boolean(
    settings?.api_key_last4 &&
      settings.api_key_last4 !== "DEMO" &&
      settings.api_key_last4 !== "b171"
  );
  const currentProvider = settings?.provider ?? "gemini";
  const displayWriterModel =
    currentProvider === "gemini" &&
    (!settings?.model_writer ||
      settings.model_writer.startsWith("gpt-") ||
      settings.model_writer.startsWith("claude-"))
      ? "gemini-2.5-flash"
      : (settings?.model_writer ?? "gemini-2.5-flash");
  const displayVisionModel =
    currentProvider === "gemini" &&
    (!settings?.model_vision ||
      settings.model_vision.startsWith("gpt-") ||
      settings.model_vision.startsWith("claude-"))
      ? "gemini-2.5-flash"
      : (settings?.model_vision ?? "gemini-2.5-flash");

  const { data: usedTokensData } = await supabase.rpc(
    "ai_tokens_used_this_month"
  );
  const usedTokens = Number(usedTokensData ?? 0);
  const budget = Number(settings?.monthly_token_budget ?? 2000000);

  const { data: runsData } = await supabase
    .from("ai_runs")
    .select(
      "id, article_id, step, model, input_tokens, output_tokens, cost_usd, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  const aiRuns = (runsData ?? []) as AiRunRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/articles"
            className="text-xs text-slate-600 hover:text-slate-900 underline"
          >
            ← Quay lại Danh sách bài viết
          </Link>
          <h1 className="text-xl font-bold text-slate-900 mt-1">
            Tích hợp AI (Google Gemini Vision & Viết bài) & Ngân sách Token
          </h1>
          <p className="text-sm text-slate-600">
            Hỗ trợ chính thức <strong>Google Gemini</strong> (đọc ảnh{" "}
            <code>Gemini Vision</code> + viết bài chuẩn JSON), Anthropic Claude
            và OpenAI. API key được mã hóa trong Vault, chỉ hiển thị 4 ký tự
            cuối (R-42).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/settings/ai/providers/muse"
            className="rounded bg-slate-950 border border-amber-500/40 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-slate-900"
          >
            ✨ Mở AI Providers → Muse AI Connector (Global Account) →
          </Link>

          <form action={testAiConnectionAction}>
            <button
              type="submit"
              className="rounded border border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              🧪 Kiểm tra chuẩn Kết nối AI & Đọc ảnh Vision
            </button>
          </form>
        </div>
      </div>

      {params.error ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900"
        >
          <strong>❌ Kiểm tra kết nối / Cấu hình chưa đạt:</strong>{" "}
          {params.error}
        </div>
      ) : null}

      {params.notice ? (
        <div
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          {params.notice}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Token đã dùng tháng này</div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {usedTokens.toLocaleString("vi-VN")}
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Hạn mức token tháng</div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {budget.toLocaleString("vi-VN")}
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">
            Trạng thái Tích hợp API Key (Vault)
          </div>
          <div className="text-sm font-bold mt-1">
            {isRealKeyConfigured ? (
              <span className="text-emerald-700">
                🟢 Đã tích hợp Key thật (•••• {settings?.api_key_last4})
              </span>
            ) : (
              <span className="text-amber-700">
                🟡 Chế độ Demo mẫu (Chưa nhập API Key thật)
              </span>
            )}
          </div>
        </div>
      </div>

      <form
        action={saveAiSettingsAction}
        className="rounded border border-slate-300 bg-white p-6 space-y-5"
      >
        <div className="border-b border-slate-200 pb-3">
          <h2 className="text-base font-bold text-slate-900">
            1. Cấu hình Nhà cung cấp, Model Đọc ảnh (Gemini Vision) & Ô nhập API
            Key
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Khi nhập API Key thật và bấm{" "}
            <strong>&ldquo;Lưu & Kiểm tra kết nối ngay&rdquo;</strong>, hệ thống
            sẽ gọi trực tiếp tới máy chủ Google Gemini / OpenAI / Anthropic để
            kiểm tra <strong>cả 2 tác vụ: Viết bài JSON và Đọc ảnh Vision</strong>{" "}
            (không dùng dữ liệu giả lập).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="provider"
              className="block text-sm font-semibold text-slate-800 mb-1"
            >
              Nhà cung cấp AI (`provider`)
            </label>
            <select
              id="provider"
              name="provider"
              defaultValue={settings?.provider ?? "gemini"}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="gemini">
                Google Gemini (Khuyến nghị — Đọc ảnh Gemini Vision & Viết bài)
              </option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="monthly_token_budget"
              className="block text-sm font-semibold text-slate-800 mb-1"
            >
              Hạn mức token tháng (`monthly_token_budget`)
            </label>
            <input
              id="monthly_token_budget"
              name="monthly_token_budget"
              type="number"
              min={0}
              required
              defaultValue={budget}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="model_writer"
              className="block text-sm font-semibold text-slate-800 mb-1"
            >
              Model Lập dàn ý & Viết bài (`model_writer`)
            </label>
            <input
              id="model_writer"
              name="model_writer"
              type="text"
              required
              list="writer-models-preset"
              placeholder="gemini-2.5-flash hoặc gemini-2.5-pro"
              defaultValue={displayWriterModel}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900"
            />
            <datalist id="writer-models-preset">
              <option value="gemini-2.5-flash" />
              <option value="gemini-2.5-pro" />
              <option value="gemini-2.0-flash" />
              <option value="claude-sonnet-4-20250514" />
              <option value="gpt-4o" />
            </datalist>
            <p className="text-[11px] text-slate-500 mt-1">
              Với Google Gemini: khuyên dùng <code>gemini-2.5-flash</code> hoặc{" "}
              <code>gemini-2.5-pro</code>.
            </p>
          </div>

          <div>
            <label
              htmlFor="model_vision"
              className="block text-sm font-semibold text-slate-800 mb-1"
            >
              Model Đọc & Phân tích Ảnh (`model_vision` — Gemini Vision)
            </label>
            <input
              id="model_vision"
              name="model_vision"
              type="text"
              required
              list="vision-models-preset"
              placeholder="gemini-2.5-flash hoặc gemini-2.0-flash"
              defaultValue={displayVisionModel}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900"
            />
            <datalist id="vision-models-preset">
              <option value="gemini-2.5-flash" />
              <option value="gemini-2.0-flash" />
              <option value="gemini-2.5-pro" />
              <option value="claude-3-5-haiku-latest" />
              <option value="gpt-4o-mini" />
            </datalist>
            <p className="text-[11px] text-slate-500 mt-1">
              Dùng để đọc ảnh sản phẩm (resize ≤ 1568px JPEG), trích xuất chữ{" "}
              <code>visible_text</code> và sinh <code>alt_text</code> chuẩn SEO.
            </p>
          </div>
        </div>

        <div className="rounded border border-slate-300 bg-slate-50 p-4 space-y-2">
          <label
            htmlFor="api_key"
            className="block text-sm font-bold text-slate-900"
          >
            🔑 Ô Nhập API Key Tích hợp AI (`api_key`)
          </label>
          <input
            id="api_key"
            name="api_key"
            type="password"
            autoComplete="off"
            placeholder="Dán Google Gemini API Key (bắt đầu bằng AQ.... hoặc AIza...) hoặc OpenAI / Anthropic API Key vào đây..."
            className="w-full rounded border border-slate-400 bg-white px-3 py-2.5 text-sm font-mono text-slate-900"
          />
          <div className="text-xs text-slate-600 space-y-1">
            <div>
              • <strong>Google Gemini API Key</strong>: Hỗ trợ cả chuẩn{" "}
              <code>AQ....</code> (Google Cloud / Vertex AI Express) và{" "}
              <code>AIza...</code> (Google AI Studio).
            </div>
            <div>
              • Nếu để trống ô này khi bấm Lưu, hệ thống sẽ giữ nguyên key hiện
              tại trong Vault (
              {isRealKeyConfigured
                ? `••••${settings?.api_key_last4}`
                : "LOCAL_DEMO_MODE_KEY"}
              ).
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            name="intent"
            value="save_and_test"
            className="rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            🚀 Lưu & Kiểm tra chuẩn Kết nối AI + Đọc ảnh Gemini Vision ngay
          </button>

          <button
            type="submit"
            name="intent"
            value="save"
            className="rounded border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
          >
            Chỉ lưu cài đặt
          </button>
        </div>
      </form>

      <section className="rounded border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-slate-900 mb-3">
          Nhật ký gọi AI gần đây (`ai_runs`)
        </h2>
        {aiRuns.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có lượt gọi AI nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Thời gian</th>
                  <th className="py-2 pr-3">Bước (`step`)</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Token vào</th>
                  <th className="py-2 pr-3">Token ra</th>
                  <th className="py-2 pr-3">Chi phí ước tính (USD)</th>
                </tr>
              </thead>
              <tbody>
                {aiRuns.map((run) => (
                  <tr key={run.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-600">
                      {new Date(run.created_at).toLocaleString("vi-VN")}
                    </td>
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {run.step}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">
                      {run.model ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{run.input_tokens}</td>
                    <td className="py-2 pr-3">{run.output_tokens}</td>
                    <td className="py-2 pr-3">
                      {run.cost_usd !== null ? `$${run.cost_usd}` : "—"}
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
