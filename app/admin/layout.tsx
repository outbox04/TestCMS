import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";
import { logoutAction } from "@/app/login/actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileData as ProfileRow | null;
  if (!profile || (profile.role !== "admin" && profile.role !== "editor")) {
    redirect("/login?error=no_profile");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link
              href="/admin/articles"
              className="font-bold text-base text-slate-900"
            >
              Content Agent CMS
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/admin/articles"
                className="text-slate-700 hover:text-slate-900 font-medium"
              >
                Bài viết
              </Link>
              <Link
                href="/admin/brand"
                className="text-slate-700 hover:text-slate-900 font-medium"
              >
                Hồ sơ thương hiệu
              </Link>
              {profile.role === "admin" ? (
                <>
                  <Link
                    href="/admin/settings/ai"
                    className="text-slate-700 hover:text-slate-900 font-medium"
                  >
                    Cài đặt AI
                  </Link>
                  <Link
                    href="/admin/settings/ai/providers/muse"
                    className="text-amber-700 hover:text-amber-900 font-semibold"
                  >
                    Muse AI Connector
                  </Link>
                </>
              ) : null}
              <Link
                href="/blog"
                className="text-slate-600 hover:text-slate-900"
              >
                Blog công khai ↗
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>
              {user.email} (<strong>{profile.role}</strong>)
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

