-- ============================================================
-- Content Agent module - migration 001 (Supabase / Postgres)
-- Bật trước trong Dashboard > Database > Extensions:
--   supabase_vault, pgmq, pg_cron, pg_net
-- Khóa service_role chỉ dùng ở server (Server Action, Edge Function),
-- tuyệt đối không đặt trong biến NEXT_PUBLIC_*.
-- Nên chạy thử trên project nháp trước khi chạy production.
-- ============================================================

-- ---------- 1. Kiểu dữ liệu và người dùng ----------
create type public.article_status as enum (
  'outline_draft',     -- Agent đang lập ý chính
  'outline_review',    -- Chờ nhân viên duyệt ý chính (cổng 1)
  'awaiting_images',   -- Chờ nhân viên upload ảnh
  'analyzing_images',  -- Agent phân tích ảnh
  'writing',           -- Agent viết bài
  'draft_ready',       -- Bản nháp xong, chờ kiểm tra tự động
  'preview_review',    -- Chờ nhân viên duyệt xem trước (cổng 2)
  'scheduled',         -- Đã lên lịch
  'published'          -- Đã đăng
);

create table public.profiles (
  id   uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'editor'))
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'));
$$;

-- ---------- 2. Cài đặt AI (1 dòng duy nhất) ----------
create table public.ai_settings (
  id                   boolean primary key default true check (id),
  provider             text,
  model_writer         text,   -- model viết bài (chọn trong cài đặt, không cố định trong code)
  model_vision         text,   -- model rẻ hơn cho phân tích ảnh
  api_key_secret_id    uuid,   -- trỏ tới vault.secrets, KHÔNG lưu key ở đây
  api_key_last4        text,
  monthly_token_budget bigint not null default 2000000,
  updated_by           uuid references auth.users(id),
  updated_at           timestamptz not null default now()
);
insert into public.ai_settings default values on conflict do nothing;

-- Lưu key vào Vault. Chỉ service_role gọi được (Server Action đã kiểm tra quyền admin).
create or replace function public.set_ai_api_key(p_key text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select api_key_secret_id into v_id from public.ai_settings where id;
  if v_id is null then
    v_id := vault.create_secret(p_key, 'ai_api_key', 'API key nhà cung cấp AI');
  else
    perform vault.update_secret(v_id, p_key);
  end if;
  update public.ai_settings
     set api_key_secret_id = v_id, api_key_last4 = right(p_key, 4),
         updated_by = p_actor, updated_at = now()
   where id;
end $$;

create or replace function public.get_ai_api_key() returns text
language sql security definer set search_path = public as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets ds
    join public.ai_settings s on s.api_key_secret_id = ds.id
   where s.id;
$$;

revoke execute on function public.set_ai_api_key(text, uuid) from public, anon, authenticated;
revoke execute on function public.get_ai_api_key() from public, anon, authenticated;
grant  execute on function public.set_ai_api_key(text, uuid) to service_role;
grant  execute on function public.get_ai_api_key() to service_role;

-- ---------- 3. Hồ sơ thương hiệu (nguồn sự thật, 1 dòng duy nhất) ----------
create table public.brand_profile (
  id               boolean primary key default true check (id),
  brand_name       text,
  description      text,
  products         jsonb not null default '[]',   -- [{name, description, price, specs...}]
  voice            text,                          -- giọng văn
  facts            jsonb not null default '[]',   -- thông tin được phép nói
  forbidden_claims text[] not null default '{}',  -- điều không được nói
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);
insert into public.brand_profile default values on conflict do nothing;

create or replace function public.brand_profile_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    length(trim(coalesce(brand_name, ''))) > 0
    and jsonb_array_length(products) > 0
    and length(trim(coalesce(voice, ''))) > 0, false)
  from public.brand_profile where id;
$$;

-- ---------- 4. Bài viết và dữ liệu liên quan ----------
create table public.articles (
  id                 uuid primary key default gen_random_uuid(),
  topic              text not null,
  slug               text unique,
  planned_publish_at timestamptz,
  status             public.article_status not null default 'outline_draft',
  version            int not null default 1,
  primary_keyword    text,
  secondary_keywords text[] not null default '{}',
  faq_questions      text[] not null default '{}',
  outline            jsonb,
  content_blocks     jsonb,        -- nội dung dạng block, KHÔNG lưu HTML
  seo                jsonb,        -- title, description, dữ liệu dựng schema
  checks_passed      boolean not null default false,
  check_report       jsonb,
  scheduled_at       timestamptz,
  published_at       timestamptz,
  last_error         text,
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on public.articles (status);
create index on public.articles (scheduled_at) where status = 'scheduled';

create table public.article_assets (
  id           uuid primary key default gen_random_uuid(),
  article_id   uuid not null references public.articles(id) on delete cascade,
  storage_path text not null,       -- bản gốc trong bucket article-images
  analysis_path text,               -- bản đã resize nhỏ, dùng cho phân tích
  sha256       text not null,
  width        int,
  height       int,
  alt_text     text,
  analysis     jsonb,               -- kết quả phân tích (cache, không phân tích lại)
  analyzed_at  timestamptz,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (article_id, sha256)
);

create table public.article_versions (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid not null references public.articles(id) on delete cascade,
  version        int not null,
  outline        jsonb,
  content_blocks jsonb,
  seo            jsonb,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create table public.article_events (
  id          bigint generated always as identity primary key,
  article_id  uuid not null references public.articles(id) on delete cascade,
  from_status public.article_status,
  to_status   public.article_status not null,
  actor       uuid,
  actor_kind  text not null,       -- editor | agent | system
  note        text,
  created_at  timestamptz not null default now()
);

create table public.keyword_cache (
  keyword    text not null,
  source     text not null,        -- autocomplete | paa | dataforseo ...
  lang       text not null default 'vi',
  country    text not null default 'vn',
  results    jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (keyword, source, lang, country)
);

create table public.ai_runs (
  id            bigint generated always as identity primary key,
  article_id    uuid references public.articles(id) on delete set null,
  step          text not null,
  model         text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_usd      numeric(12, 6),
  created_at    timestamptz not null default now()
);

create or replace function public.ai_tokens_used_this_month() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
    from public.ai_runs where created_at >= date_trunc('month', now());
$$;
revoke execute on function public.ai_tokens_used_this_month() from public, anon;
grant  execute on function public.ai_tokens_used_this_month() to authenticated, service_role;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger trg_touch before update on public.articles
  for each row execute function public.touch_updated_at();

-- ---------- 5. Máy trạng thái: ai được chuyển từ đâu sang đâu ----------
create table public.article_transitions (
  from_status public.article_status not null,
  to_status   public.article_status not null,
  actor_kind  text not null check (actor_kind in ('editor', 'agent', 'system')),
  primary key (from_status, to_status, actor_kind)
);

insert into public.article_transitions values
  ('outline_draft',    'outline_review',   'agent'),
  ('outline_review',   'outline_draft',    'editor'),  -- yêu cầu lập lại ý chính
  ('outline_review',   'awaiting_images',  'editor'),  -- CỔNG 1: duyệt ý chính
  ('awaiting_images',  'analyzing_images', 'editor'),  -- xác nhận đã upload xong ảnh
  ('analyzing_images', 'writing',          'agent'),
  ('writing',          'draft_ready',      'agent'),
  ('draft_ready',      'preview_review',   'agent'),   -- chỉ khi kiểm tra tự động đạt
  ('preview_review',   'writing',          'editor'),  -- yêu cầu sửa, quay lại bước viết
  ('preview_review',   'published',        'editor'),  -- CỔNG 2: đăng ngay
  ('preview_review',   'scheduled',        'editor'),  -- CỔNG 2: lên lịch
  ('scheduled',        'preview_review',   'editor'),  -- hủy lịch
  ('scheduled',        'published',        'system');  -- cron đăng theo lịch

-- Chặn mọi cách đổi trạng thái ngoài transition_article(), kể cả service_role
create or replace function public.guard_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.via_transition', true), '') <> 'on' then
    raise exception 'Chỉ được đổi trạng thái qua transition_article()';
  end if;
  return new;
end $$;
create trigger trg_guard_status before update of status on public.articles
  for each row execute function public.guard_status_change();

create or replace function public.transition_article(
  p_article_id uuid,
  p_to public.article_status,
  p_expected_version int,
  p_actor_kind text default 'agent',
  p_note text default null
) returns public.articles
language plpgsql security definer set search_path = public as $$
declare
  a public.articles;
  v_kind text;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_kind := p_actor_kind;
    if v_kind not in ('agent', 'system') then
      raise exception 'service_role chỉ được hành động với vai trò agent hoặc system';
    end if;
  elsif public.is_editor() then
    v_kind := 'editor';
  else
    raise exception 'Không có quyền';
  end if;

  select * into a from public.articles where id = p_article_id for update;
  if not found then raise exception 'Không tìm thấy bài viết'; end if;
  if a.version <> p_expected_version then
    raise exception 'Xung đột phiên bản: bài đã được thay đổi';
  end if;

  if not exists (
    select 1 from public.article_transitions t
     where t.from_status = a.status and t.to_status = p_to and t.actor_kind = v_kind
  ) then
    raise exception 'Không được chuyển % -> % với vai trò %', a.status, p_to, v_kind;
  end if;

  if p_to = 'analyzing_images'
     and not exists (select 1 from public.article_assets where article_id = a.id) then
    raise exception 'Cần upload ít nhất một ảnh';
  end if;
  if p_to = 'writing' and v_kind = 'agent'
     and exists (select 1 from public.article_assets where article_id = a.id and analyzed_at is null) then
    raise exception 'Còn ảnh chưa được phân tích';
  end if;
  if p_to = 'preview_review' and v_kind = 'agent' and not a.checks_passed then
    raise exception 'Kiểm tra tự động chưa đạt';
  end if;
  if p_to = 'scheduled' and (a.scheduled_at is null or a.scheduled_at <= now()) then
    raise exception 'Thời điểm lên lịch phải ở tương lai';
  end if;

  perform set_config('app.via_transition', 'on', true);

  update public.articles
     set status = p_to,
         version = version + 1,
         checks_passed = case when p_to = 'writing' then false else checks_passed end,
         published_at = case when p_to = 'published' then now() else published_at end
   where id = a.id
   returning * into a;

  if p_to in ('outline_review', 'preview_review') then
    insert into public.article_versions (article_id, version, outline, content_blocks, seo, created_by)
    values (a.id, a.version, a.outline, a.content_blocks, a.seo, auth.uid());
  end if;

  insert into public.article_events (article_id, from_status, to_status, actor, actor_kind, note)
  values (a.id, null, p_to, auth.uid(), v_kind, p_note);

  return a;
end $$;

revoke execute on function public.transition_article(uuid, public.article_status, int, text, text) from public, anon;
grant  execute on function public.transition_article(uuid, public.article_status, int, text, text) to authenticated, service_role;

-- Đăng bài đến hạn (chạy bởi pg_cron, không cần JWT)
create or replace function public.publish_due_articles() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('app.via_transition', 'on', true);
  with due as (
    update public.articles
       set status = 'published', published_at = now(), version = version + 1
     where status = 'scheduled' and scheduled_at <= now()
     returning id
  ), ev as (
    insert into public.article_events (article_id, from_status, to_status, actor_kind, note)
    select id, 'scheduled', 'published', 'system', 'Đăng theo lịch' from due
    returning 1
  )
  select count(*) into n from ev;
  return n;
end $$;
revoke execute on function public.publish_due_articles() from public, anon, authenticated;
grant  execute on function public.publish_due_articles() to service_role;

-- ---------- 6. Hàng đợi tác vụ cho Agent (pgmq) ----------
select pgmq.create('agent_jobs');
alter table pgmq.q_agent_jobs enable row level security;
alter table pgmq.a_agent_jobs enable row level security;

create or replace function public.enqueue_agent_job() returns trigger
language plpgsql security definer set search_path = public, pgmq as $$
declare v_step text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;

  v_step := case new.status
    when 'outline_draft'    then 'plan_outline'
    when 'analyzing_images' then 'analyze_images'
    when 'writing'          then 'write_article'
    when 'published'        then 'revalidate'   -- làm mới trang Next.js
    else null end;
  if v_step is null then return new; end if;

  if v_step <> 'revalidate' and not public.brand_profile_ready() then
    raise exception 'Hồ sơ thương hiệu chưa đủ thông tin (tên, sản phẩm, giọng văn)';
  end if;

  perform pgmq.send('agent_jobs',
    jsonb_build_object('step', v_step, 'article_id', new.id, 'version', new.version));
  return new;
end $$;

create trigger trg_enqueue_job after insert or update of status on public.articles
  for each row execute function public.enqueue_agent_job();

-- ---------- 7. Phân quyền (RLS) ----------
alter table public.profiles         enable row level security;
alter table public.ai_settings      enable row level security;
alter table public.brand_profile    enable row level security;
alter table public.articles         enable row level security;
alter table public.article_assets   enable row level security;
alter table public.article_versions enable row level security;
alter table public.article_events   enable row level security;
alter table public.keyword_cache    enable row level security;
alter table public.ai_runs          enable row level security;
alter table public.article_transitions enable row level security;

create policy "đọc hồ sơ của mình" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "admin quản lý hồ sơ" on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ai_settings: admin xem và sửa (trừ cột key, chỉ đổi qua set_ai_api_key)
create policy "admin xem cài đặt AI" on public.ai_settings for select to authenticated
  using (public.is_admin());
create policy "admin sửa cài đặt AI" on public.ai_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke update on public.ai_settings from authenticated;
grant  update (provider, model_writer, model_vision, monthly_token_budget)
  on public.ai_settings to authenticated;

create policy "nhân viên xem hồ sơ thương hiệu" on public.brand_profile for select to authenticated
  using (public.is_editor());
create policy "admin sửa hồ sơ thương hiệu" on public.brand_profile for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- articles: nhân viên không được sửa status/version/checks (chỉ qua hàm)
create policy "nhân viên xem bài" on public.articles for select to authenticated
  using (public.is_editor());
create policy "nhân viên tạo bài" on public.articles for insert to authenticated
  with check (public.is_editor());
create policy "nhân viên sửa bài ở bước duyệt" on public.articles for update to authenticated
  using (public.is_editor() and status in ('outline_review', 'awaiting_images', 'preview_review', 'scheduled'))
  with check (public.is_editor());
revoke insert, update on public.articles from authenticated;
grant insert (topic, planned_publish_at, primary_keyword, secondary_keywords, faq_questions)
  on public.articles to authenticated;
grant update (topic, slug, planned_publish_at, primary_keyword, secondary_keywords,
              faq_questions, outline, content_blocks, seo, scheduled_at)
  on public.articles to authenticated;

create policy "nhân viên quản lý ảnh" on public.article_assets for all to authenticated
  using (public.is_editor()) with check (public.is_editor());
revoke insert, update on public.article_assets from authenticated;
grant insert (article_id, storage_path, analysis_path, sha256, width, height)
  on public.article_assets to authenticated;
grant update (alt_text) on public.article_assets to authenticated;

create policy "nhân viên xem phiên bản" on public.article_versions for select to authenticated
  using (public.is_editor());
create policy "nhân viên xem lịch sử" on public.article_events for select to authenticated
  using (public.is_editor());
create policy "nhân viên xem từ khóa" on public.keyword_cache for select to authenticated
  using (public.is_editor());
create policy "admin xem chi phí AI" on public.ai_runs for select to authenticated
  using (public.is_admin());
create policy "nhân viên xem quy tắc chuyển trạng thái" on public.article_transitions
  for select to authenticated using (public.is_editor());
-- keyword_cache, ai_runs, article_versions, article_events: ghi bởi service_role/hàm (bỏ qua RLS)

-- ---------- 8. Storage cho ảnh ----------
insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', false)
on conflict (id) do nothing;

create policy "nhân viên quản lý ảnh bài viết" on storage.objects for all to authenticated
  using (bucket_id = 'article-images' and public.is_editor())
  with check (bucket_id = 'article-images' and public.is_editor());

-- ---------- 9. Lịch chạy (điền <project-ref> và bỏ comment sau khi deploy worker) ----------
-- select cron.schedule('publish-due-articles', '* * * * *', $$ select public.publish_due_articles(); $$);
--
-- select cron.schedule('agent-worker', '30 seconds', $$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/agent-worker',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret')
--     ),
--     body := '{}'::jsonb
--   );
-- $$);
