import Link from "next/link";
import { loginAction } from "./actions";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorMsg = params.error;
  const nextPath = params.next ?? "/admin/articles";

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 mb-1">
          Đăng nhập Quản trị Content Agent
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          Sử dụng tài khoản nhân viên (`admin@demo.test` hoặc `editor@demo.test`).
        </p>

        {errorMsg ? (
          <div
            role="alert"
            className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
          >
            {errorMsg === "no_profile"
              ? "Tài khoản không có quyền truy cập quản trị (thiếu dòng trong profiles)."
              : errorMsg === "missing_env"
                ? "Chưa cấu hình biến môi trường Supabase trong .env.local."
                : errorMsg}
          </div>
        ) : null}

        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="admin@demo.test"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Mật khẩu
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Đăng nhập
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-200 text-xs text-slate-500 flex justify-between">
          <Link href="/blog" className="underline hover:text-slate-800">
            Xem trang Blog công khai
          </Link>
          <span>Quy trình 5 bước · 2 cổng duyệt</span>
        </div>
      </div>
    </main>
  );
}

