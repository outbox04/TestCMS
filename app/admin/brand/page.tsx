import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { BrandProfileRow } from "@/lib/supabase/types";
import { updateBrandProfileAction } from "./actions";

interface BrandPageProps {
  searchParams: Promise<{ error?: string; notice?: string }>;
}

export default async function BrandProfilePage({
  searchParams,
}: BrandPageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: isAdminData } = await supabase.rpc("is_admin");
  const isAdmin = Boolean(isAdminData);

  const { data: readyData } = await supabase.rpc("brand_profile_ready");
  const isReady = Boolean(readyData);

  const { data: brandData } = await supabase
    .from("brand_profile")
    .select(
      "id, brand_name, description, products, voice, facts, forbidden_claims, updated_by, updated_at"
    )
    .eq("id", true)
    .maybeSingle();

  const brand = brandData as BrandProfileRow | null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Hồ sơ Thương hiệu (`brand_profile`)
        </h1>
        <p className="text-sm text-slate-600">
          Nguồn sự thật duy nhất (Single Source of Truth) cho Agent khi lập dàn ý,
          viết bài và kiểm chứng số liệu (R-18, R-31, R-32).{" "}
          {isAdmin
            ? "Bạn có quyền chỉnh sửa (admin)."
            : "Bạn đang ở chế độ chỉ xem (editor)."}
        </p>
      </div>

      {!isReady ? (
        <div
          role="alert"
          className="rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <strong>Cảnh báo:</strong> `brand_profile_ready()` đang trả về{" "}
          <code>false</code>. Hồ sơ thương hiệu chưa đủ thông tin bắt buộc (tên
          thương hiệu, ít nhất 1 sản phẩm, và giọng văn). Hàng đợi tác vụ Agent
          sẽ từ chối chạy cho đến khi điền đủ.
        </div>
      ) : null}

      {params.error ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {params.error}
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
        action={updateBrandProfileAction}
        className="rounded border border-slate-200 bg-white p-6 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="brand_name"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Tên thương hiệu
            </label>
            <input
              id="brand_name"
              name="brand_name"
              type="text"
              disabled={!isAdmin}
              defaultValue={brand?.brand_name ?? ""}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Mô tả ngắn
            </label>
            <input
              id="description"
              name="description"
              type="text"
              disabled={!isAdmin}
              defaultValue={brand?.description ?? ""}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="voice"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            Giọng văn thương hiệu (`voice`)
          </label>
          <textarea
            id="voice"
            name="voice"
            rows={2}
            disabled={!isAdmin}
            defaultValue={brand?.voice ?? ""}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
          />
        </div>

        <div>
          <label
            htmlFor="products_json"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            Danh sách sản phẩm (`products` — JSON)
          </label>
          <textarea
            id="products_json"
            name="products_json"
            rows={10}
            disabled={!isAdmin}
            defaultValue={JSON.stringify(brand?.products ?? [], null, 2)}
            className="w-full font-mono rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
          />
        </div>

        <div>
          <label
            htmlFor="facts_json"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            Sự thật đã kiểm chứng (`facts` — JSON, mỗi phần tử có `id`)
          </label>
          <textarea
            id="facts_json"
            name="facts_json"
            rows={10}
            disabled={!isAdmin}
            defaultValue={JSON.stringify(brand?.facts ?? [], null, 2)}
            className="w-full font-mono rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
          />
        </div>

        <div>
          <label
            htmlFor="forbidden_claims"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            Tuyên bố cấm (`forbidden_claims` — mỗi dòng 1 cụm từ)
          </label>
          <textarea
            id="forbidden_claims"
            name="forbidden_claims"
            rows={4}
            disabled={!isAdmin}
            defaultValue={(brand?.forbidden_claims ?? []).join("\n")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
          />
        </div>

        {isAdmin ? (
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Lưu hồ sơ thương hiệu
          </button>
        ) : null}
      </form>
    </div>
  );
}

