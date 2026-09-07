-- Daily archive of the "Raw data" call log (one compressed CSV per date).
-- Run in Supabase → SQL Editor after the initial migration.

-- Private storage bucket for the files
insert into storage.buckets (id, name, public)
values ('call-log-archive', 'call-log-archive', false)
on conflict (id) do nothing;

-- Index of archived days (metadata only; the CSV lives in storage)
create table if not exists public.call_log_archives (
  date        date primary key,
  path        text not null,
  row_count   integer not null default 0,
  bytes       integer not null default 0,
  csv_bytes   integer not null default 0,
  columns     text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

alter table public.call_log_archives enable row level security;
drop policy if exists "public read archives index" on public.call_log_archives;
create policy "public read archives index" on public.call_log_archives for select using (true);

-- No storage policies for anon/authenticated: files are only reachable through
-- the API function (service role), which checks the download key.
