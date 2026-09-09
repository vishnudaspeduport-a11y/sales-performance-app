-- Daily snapshots of the "Pending Tasks (Sales Overdue)" sheet: counts of pending CRM tasks
-- per team / executive / subject / due bucket, plus team totals for a day-over-day trend.
-- Counts only — no lead ids, comments or customer details. Run in Supabase → SQL Editor.

create table if not exists public.pending_tasks_daily (
  date     date    not null,
  source   text    not null,   -- 'IC' (Interested Course) or 'LM' (Lead Master)
  team     text    not null,   -- owner role in the CRM, e.g. "Executive-Team Aswanth"
  owner    text    not null,   -- executive (lead owner)
  subject  text    not null,   -- Follow Up, May Buy Later, Ready To Pay, Not Connected
  bucket   text    not null,   -- 'today', 'overdue' (till yesterday) or 'upcoming'
  count    integer not null default 0,
  primary key (date, source, team, owner, subject, bucket)
);
create index if not exists pending_tasks_daily_date_idx on public.pending_tasks_daily (date);

create table if not exists public.pending_team_daily (
  date        date    not null,
  team        text    not null,
  ic_today    integer not null default 0,
  ic_overdue  integer not null default 0,
  lm_today    integer not null default 0,
  lm_overdue  integer not null default 0,
  bdes        integer not null default 0,   -- executives with at least one pending task
  primary key (date, team)
);

alter table public.pending_tasks_daily enable row level security;
alter table public.pending_team_daily  enable row level security;
drop policy if exists "public read pending tasks" on public.pending_tasks_daily;
create policy "public read pending tasks" on public.pending_tasks_daily for select using (true);
drop policy if exists "public read pending teams" on public.pending_team_daily;
create policy "public read pending teams" on public.pending_team_daily for select using (true);
