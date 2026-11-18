import Link from "next/link";

  export default function HomePage() {
    return (
              <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <div className="max-w-2xl w-full bg-white border border-slate-200 rounded-lg p-8 space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                      Content Agent Demo (Next.js + Supabase)
                    </h1>
                      <p className="text-sm text-slate-600 mt-1">
                        Quy trình 5 bước · 2 cổng duyệt con người · Chống bịa số liệu ·
                        Chuẩn SEO/GEO/AEO · Tiết kiệm token.
                      </p>
                  </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Link
                        href="/admin/articles"
                        className="block rounded border border-slate-900 bg-slate-900 p-4 text-white hover:bg-slate-800"
                      >
            <div className="font-bold text-base">Quản trị CMS (/admin)</div>
                      <div className="text-xs text-slate-200 mt-1">
                        Tạo bài viết, duyệt Cổng 1 & Cổng 2, quản lý thương hiệu và AI
                      </div>
                    </Link>

                    <Link
                      href="/blog"
                      className="block rounded border border-slate-300 bg-white p-4 text-slate-900 hover:bg-slate-50"
                    >
                    <div className="font-bold text-base">Trang Blog (/blog)</div>
                    <div className="text-xs text-slate-600 mt-1">
                      Trang công khai hiển thị bài đã đăng kèm JSON-LD Schema
                    </div>
                  </Link>
                </div>

          <div className="pt-4 border-t border-slate-200 flex flex-wrap gap-4 text-xs text-slate-600">
            <Link href="/login" className="underline hover:text-slate-900">
              Đăng nhập
            </Link>
            <Link href="/robots.txt" className="underline hover:text-slate-900">
              /robots.txt (R-39)
            </Link>
            <Link href="/llms.txt" className="underline hover:text-slate-900">
              /llms.txt (R-40)
            </Link>
          </div>
      </div>
    </main >
  );
  }
