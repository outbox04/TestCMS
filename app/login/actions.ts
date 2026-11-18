"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = String(formData.get("next") ?? "/admin/articles");

  if (!email || !password) {
    redirect("/login?error=" + encodeURIComponent("Vui lòng nhập đủ email và mật khẩu"));
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    redirect(
      "/login?error=" +
        encodeURIComponent(error?.message ?? "Đăng nhập không thành công")
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    redirect(
      "/login?error=" +
        encodeURIComponent("Tài khoản chưa được cấp quyền trong bảng profiles")
    );
  }

  const safeNext = nextPath.startsWith("/admin") ? nextPath : "/admin/articles";
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

