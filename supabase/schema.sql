-- JustVibe Supabase schema.
-- Run once in Supabase Studio → SQL Editor → paste → Run.
--
-- Single multi-tenant table: every generated app's rows live here,
-- partitioned by (app_id, table_name). row_data is freeform JSONB so each
-- app can use its own schema without us ALTERing.
--
-- Security is enforced at the JustVibe route layer (ownership check via
-- app_id → projects/apps). We connect from the server with the SERVICE
-- ROLE KEY which bypasses RLS — so DO NOT enable RLS here unless you also
-- swap the client to use anon key + per-user JWTs.

create table if not exists public.app_rows (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null,
  table_name  text not null default 'submissions',
  row_data    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Fast lookup for the dashboard "list submissions for app X" query.
create index if not exists app_rows_app_table_idx
  on public.app_rows (app_id, table_name, created_at desc);

-- For occasional cross-app sweeps + cleanups.
create index if not exists app_rows_created_idx
  on public.app_rows (created_at desc);

-- Auto-bump updated_at on UPDATE.
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_rows_touch on public.app_rows;
create trigger app_rows_touch
  before update on public.app_rows
  for each row execute procedure public.touch_updated_at();

-- Sanity check: should return 0 rows on a fresh DB.
-- select count(*) from public.app_rows;
