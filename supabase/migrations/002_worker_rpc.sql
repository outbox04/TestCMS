-- ============================================================
-- Content Agent module - migration 002 (Worker RPCs cho pgmq)
-- Chỉ thêm hàm RPC cho worker, KHÔNG sửa 001_content_agent.sql
-- ============================================================

create or replace function public.agent_pop_job()
returns table (
  msg_id  bigint,
  message jsonb,
  read_ct int
)
language sql
security definer
set search_path = public, pgmq
as $$
  select msg_id, message, read_ct
    from pgmq.read('agent_jobs', 120, 1);
$$;

create or replace function public.agent_ack_job(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.archive('agent_jobs', p_msg_id);
$$;

create or replace function public.agent_enqueue(
  p_step text,
  p_article_id uuid,
  p_version int
)
returns bigint
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.send(
    'agent_jobs',
    jsonb_build_object(
      'step', p_step,
      'article_id', p_article_id,
      'version', p_version
    )
  );
$$;

revoke execute on function public.agent_pop_job() from public, anon, authenticated;
revoke execute on function public.agent_ack_job(bigint) from public, anon, authenticated;
revoke execute on function public.agent_enqueue(text, uuid, int) from public, anon, authenticated;

grant execute on function public.agent_pop_job() to service_role;
grant execute on function public.agent_ack_job(bigint) to service_role;
grant execute on function public.agent_enqueue(text, uuid, int) to service_role;

