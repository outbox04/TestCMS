import Link from "next/link";
import { redirect } from "next/navigation";
import { MuseAiConnectorCard } from "@/components/MuseAiConnectorCard";
import {
  getMuseConnectionStatus,
  getMuseProviderLogs,
} from "@/lib/ai/connector-manager";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MuseAiProviderPage() {
  const supabase = await createServerSupabaseClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    redirect("/admin/articles");
  }

  const initialStatus = await getMuseConnectionStatus();
  const initialLogs = await getMuseProviderLogs(25);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500 space-x-1">
            <Link href="/admin/articles" className="hover:underline">
              Admin
            </Link>
            <span>→</span>
            <Link href="/admin/settings/ai" className="hover:underline">
              Settings (AI Management)
            </Link>
            <span>→</span>
            <span className="font-semibold text-slate-900">
              AI Providers → Muse AI
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">
            AI Providers — Muse AI Global Connector
          </h1>
          <p className="text-sm text-slate-600">
            Quản lý tài khoản Muse AI dùng chung toàn hệ thống (Global Shared
            Account), mã hóa AES-256-GCM tại máy chủ.
          </p>
        </div>

        <Link
          href="/admin/settings/ai"
          className="rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
        >
          ← Quay lại Cài đặt AI & Gemini Vision
        </Link>
      </div>

      <MuseAiConnectorCard
        initialStatus={initialStatus}
        initialLogs={initialLogs}
      />
    </div>
  );
}

