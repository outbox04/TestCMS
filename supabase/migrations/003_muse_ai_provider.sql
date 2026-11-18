-- ============================================================
-- Content Agent module - migration 003 (AI Provider Manager & Muse AI Global Connector)
-- Bổ sung bảng ai_provider_connections (Global Scope, AES-256-GCM) và ai_provider_logs.
-- KHÔNG sửa đổi hay xóa bất kỳ bảng/hàm nào của 001 và 002.
-- ============================================================

-- 1. Bảng quản lý kết nối AI Provider dùng chung toàn hệ thống (scope = 'global')
create table if not exists public.ai_provider_connections (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null check (provider in ('muse', 'xingchi', 'gemini', 'openai', 'anthropic')),
  scope                 text not null default 'global' check (scope = 'global'),
  auth_type             text not null default 'api_token' check (auth_type in ('cookie', 'api_token', 'oauth')),
  encrypted_credentials text, -- Chuỗi mã hóa AES-256-GCM (v1:iv:tag:ciphertext), tuyệt đối không lưu plaintext
  status                text not null default 'disconnected' check (status in ('connected', 'disconnected', 'expired', 'error', 'unsupported')),
  error_code            text,
  error_message         text,
  last_verified_at      timestamptz,
  last_used_at          timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (provider, scope)
);

-- Đảm bảo chỉ có tối đa 1 kết nối Muse AI ở phạm vi global
create unique index if not exists idx_unique_global_muse_provider
  on public.ai_provider_connections (provider, scope)
  where provider = 'muse' and scope = 'global';

create trigger trg_touch_ai_provider_connections
  before update on public.ai_provider_connections
  for each row execute function public.touch_updated_at();

-- 2. Bảng nhật ký thực thi của AI Provider (Tuyệt đối không lưu cookie/token/secret)
create table if not exists public.ai_provider_logs (
  id          bigint generated always as identity primary key,
  provider    text not null,
  task_type   text not null,
  user_id     uuid references auth.users(id) on delete set null,
  status      text not null check (status in ('pending', 'running', 'completed', 'failed')),
  duration_ms int not null default 0 check (duration_ms >= 0),
  error_code  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_ai_provider_logs_provider_created
  on public.ai_provider_logs (provider, created_at desc);

-- 3. Phân quyền RLS nghiêm ngặt
alter table public.ai_provider_connections enable row level security;
alter table public.ai_provider_logs        enable row level security;

-- Thu hồi quyền đọc/ghi trực tiếp cột encrypted_credentials từ phía client authenticated/anon
revoke all on public.ai_provider_connections from public, anon, authenticated;
revoke all on public.ai_provider_logs from public, anon, authenticated;

-- Chỉ cấp quyền đọc các cột trạng thái an toàn (KHÔNG có encrypted_credentials) cho admin
grant select (
  id,
  provider,
  scope,
  auth_type,
  status,
  error_code,
  error_message,
  last_verified_at,
  last_used_at,
  created_by,
  updated_by,
  created_at,
  updated_at
) on public.ai_provider_connections to authenticated;

grant select on public.ai_provider_logs to authenticated;

create policy "admin xem trạng thái kết nối AI"
  on public.ai_provider_connections
  for select to authenticated
  using (public.is_admin());

create policy "admin xem nhật ký AI provider"
  on public.ai_provider_logs
  for select to authenticated
  using (public.is_admin());

-- Mọi thao tác đọc/ghi cột encrypted_credentials và ghi log chỉ thực hiện ở Server qua service_role.

-- ============================================================
-- HƯỚNG DẪN ROLLBACK (Khi cần hoàn tác migration 003):
-- drop policy if exists "admin xem nhật ký AI provider" on public.ai_provider_logs;
-- drop policy if exists "admin xem trạng thái kết nối AI" on public.ai_provider_connections;
-- drop table if exists public.ai_provider_logs;
-- drop trigger if exists trg_touch_ai_provider_connections on public.ai_provider_connections;
-- drop index if exists public.idx_unique_global_muse_provider;
-- drop table if exists public.ai_provider_connections;
-- ============================================================

