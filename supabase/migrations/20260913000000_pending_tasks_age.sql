-- Pending tasks: record how long each overdue task has been overdue (age = 'd1_3', 'd4_7' or
-- 'd8p' days past the due date; '' for tasks due today or later). Run in Supabase → SQL Editor.
-- Safe to re-run. Earlier days keep age = '' and are shown without an ageing split.

alter table public.pending_tasks_daily add column if not exists age text not null default '';
alter table public.pending_tasks_daily drop constraint if exists pending_tasks_daily_pkey;
alter table public.pending_tasks_daily add primary key (date, source, team, owner, subject, bucket, kind, age);
