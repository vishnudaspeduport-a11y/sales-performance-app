-- Sales Team Performance dashboard — initial schema.
-- Run in Supabase → SQL Editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- Employee directory (names/managers/tags as resolved from the sheet)
create table if not exists public.employees (
  id          text primary key,
  name        text not null,
  manager     text,
  tags        text[] not null default '{}',
  team        text,
  status      text,
  updated_at  timestamptz not null default now()
);

-- One row per employee per day (talk time in seconds, dates are IST calendar dates)
create table if not exists public.daily_activity (
  date                date not null,
  emp_id              text not null references public.employees(id) on delete cascade,
  dialed              integer not null default 0,
  dialed_connected    integer not null default 0,
  talk_time_dialed    integer not null default 0,
  incoming            integer not null default 0,
  incoming_connected  integer not null default 0,
  talk_time_incoming  integer not null default 0,
  not_connected       integer,
  dims                jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now(),
  primary key (date, emp_id)
);
create index if not exists daily_activity_date_idx on public.daily_activity (date);
create index if not exists daily_activity_emp_idx  on public.daily_activity (emp_id);
create index if not exists daily_activity_synced_idx on public.daily_activity (synced_at);

-- Audit trail of every sync
create table if not exists public.sync_runs (
  id              bigserial primary key,
  trigger         text not null,
  status          text not null check (status in ('running','success','error')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  source_mode     text,
  source_sheets   text[],
  row_count       integer,
  employee_count  integer,
  date_from       date,
  date_to         date,
  notes           text[],
  error           text,
  duration_ms     integer
);
create index if not exists sync_runs_started_idx on public.sync_runs (started_at desc);

-- Prebuilt dashboard payload (what /api/data serves); the last few are kept
create table if not exists public.dashboard_snapshots (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  generated_at  timestamptz,
  payload       jsonb not null
);
create index if not exists dashboard_snapshots_created_idx on public.dashboard_snapshots (created_at desc);

-- Convenience view for SQL / BI tools
create or replace view public.daily_activity_named as
select a.date, a.emp_id, e.name, e.manager, e.tags, e.status,
       a.dialed, a.dialed_connected, a.talk_time_dialed,
       a.incoming, a.incoming_connected, a.talk_time_incoming,
       a.dialed + a.incoming as total_calls,
       a.dialed_connected + a.incoming_connected as connected_calls,
       a.talk_time_dialed + a.talk_time_incoming as talk_time_seconds
from public.daily_activity a
join public.employees e on e.id = a.emp_id;

-- Read-only public access; all writes go through the service role used by the sync.
alter table public.employees           enable row level security;
alter table public.daily_activity      enable row level security;
alter table public.sync_runs           enable row level security;
alter table public.dashboard_snapshots enable row level security;

drop policy if exists "public read employees" on public.employees;
create policy "public read employees" on public.employees for select using (true);
drop policy if exists "public read activity" on public.daily_activity;
create policy "public read activity" on public.daily_activity for select using (true);
drop policy if exists "public read sync runs" on public.sync_runs;
create policy "public read sync runs" on public.sync_runs for select using (true);
drop policy if exists "public read snapshots" on public.dashboard_snapshots;
create policy "public read snapshots" on public.dashboard_snapshots for select using (true);
