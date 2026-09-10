-- Pending tasks: keep every task in the tab and record how each stands against the sheet's rule
-- (kind = 'owner' passes it, 'other' is assigned to someone else, 'unknown' has a resigned or
-- unlisted owner). Team totals carry both counts. Run in Supabase → SQL Editor. Safe to re-run.

alter table public.pending_tasks_daily add column if not exists kind text not null default 'owner';
alter table public.pending_tasks_daily drop constraint if exists pending_tasks_daily_pkey;
alter table public.pending_tasks_daily add primary key (date, source, team, owner, subject, bucket, kind);

alter table public.pending_team_daily add column if not exists ic_today_owner   integer not null default 0;
alter table public.pending_team_daily add column if not exists ic_overdue_owner integer not null default 0;
alter table public.pending_team_daily add column if not exists lm_today_owner   integer not null default 0;
alter table public.pending_team_daily add column if not exists lm_overdue_owner integer not null default 0;
-- days stored before this change only held rule-passing tasks; copy them so the trend has no gap
update public.pending_team_daily set ic_today_owner = ic_today, ic_overdue_owner = ic_overdue, lm_today_owner = lm_today, lm_overdue_owner = lm_overdue
where ic_today_owner = 0 and ic_overdue_owner = 0 and lm_today_owner = 0 and lm_overdue_owner = 0;
