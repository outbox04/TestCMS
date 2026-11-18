"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BrandFactSchema, BrandProductSchema } from "@/lib/supabase/types";
import { z } from "zod";

export async function updateBrandProfileAction(
  formData: FormData
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    redirect(
      "/admin/brand?error=" +
        encodeURIComponent("Chỉ admin mới có quyền sửa hồ sơ thương hiệu")
    );
  }

  const brandName = String(formData.get("brand_name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const voice = String(formData.get("voice") ?? "").trim();
  const productsRaw = String(formData.get("products_json") ?? "[]");
  const factsRaw = String(formData.get("facts_json") ?? "[]");
  const forbiddenRaw = String(formData.get("forbidden_claims") ?? "");

  let productsParsed: unknown;
  let factsParsed: unknown;

  try {
    productsParsed = JSON.parse(productsRaw);
    factsParsed = JSON.parse(factsRaw);
  } catch {
    redirect(
      "/admin/brand?error=" +
        encodeURIComponent("Định dạng JSON của Sản phẩm hoặc Facts không hợp lệ")
    );
  }

  const productsValidation = z.array(BrandProductSchema).safeParse(productsParsed);
  if (!productsValidation.success) {
    redirect(
      "/admin/brand?error=" +
        encodeURIComponent(
          "Danh sách sản phẩm không đúng cấu trúc: " +
            productsValidation.error.issues.map((i) => i.message).join(", ")
        )
    );
  }

  const factsValidation = z.array(BrandFactSchema).safeParse(factsParsed);
  if (!factsValidation.success) {
    redirect(
      "/admin/brand?error=" +
        encodeURIComponent(
          "Danh sách facts không đúng cấu trúc: " +
            factsValidation.error.issues.map((i) => i.message).join(", ")
        )
    );
  }

  const forbiddenClaims = forbiddenRaw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const { error } = await supabase
    .from("brand_profile")
    .update({
      brand_name: brandName,
      description,
      voice,
      products: productsValidation.data,
      facts: factsValidation.data,
      forbidden_claims: forbiddenClaims,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) {
    redirect("/admin/brand?error=" + encodeURIComponent(error.message));
  }

  revalidatePath("/admin/brand");
  revalidatePath("/llms.txt");
  redirect(
    "/admin/brand?notice=" +
      encodeURIComponent("Đã cập nhật hồ sơ thương hiệu")
  );
}

