import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createLocalDemoSupabaseClient,
  isSupabaseConfigured,
} from "./local-demo-store";

/**
 * Admin Supabase client sử dụng SUPABASE_SERVICE_ROLE_KEY.
 * Chỉ được phép chạy ở phía server (đã khóa bằng server-only) — R-42.
 * Khi chưa cấu hình .env.local, tự động dùng Local Demo Store để test ngay trên localhost.
 */
export function createAdminSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isSupabaseConfigured() || !url || !serviceRoleKey) {
    return createLocalDemoSupabaseClient(true);
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
