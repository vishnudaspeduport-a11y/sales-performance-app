-- Call-log days are complete records built from the Raw data tab (every call row counts).
-- `source` says how each employee-day was built; `missed` / `rejected` are call-type counts.
-- Run in Supabase → SQL Editor. Safe to run more than once.

alter table public.daily_activity add column if not exists source   text;
alter table public.daily_activity add column if not exists missed   integer;
alter table public.daily_activity add column if not exists rejected integer;

-- Everything written before this migration came from the helper's summary (or was a helper
-- row with call detail attached). Marking it 'helper' makes the next syncs rebuild every
-- archived day from its call-log CSV.
update public.daily_activity set source = 'helper' where source is null;

create index if not exists daily_activity_source_date_idx on public.daily_activity (source, date);

-- Dates whose rows were built from the call log (read by the sync on every run).
create or replace view public.call_log_dates as
select distinct date from public.daily_activity where source = 'call-log';

create or replace view public.daily_activity_named as
select a.date, a.emp_id, e.name, e.manager, e.tags, e.status, a.source,
       a.dialed, a.dialed_connected, a.talk_time_dialed,
       a.incoming, a.incoming_connected, a.talk_time_incoming,
       a.dialed + a.incoming as total_calls,
       a.dialed_connected + a.incoming_connected as connected_calls,
       a.talk_time_dialed + a.talk_time_incoming as talk_time_seconds,
       a.band_0_2, a.band_2_4, a.band_4_plus,
       a.tt_band_0_2, a.tt_band_2_4, a.tt_band_4_plus,
       a.unique_connected, a.uq_band_0_2, a.uq_band_2_4, a.uq_band_4_plus,
       a.missed, a.rejected
from public.daily_activity a
join public.employees e on e.id = a.emp_id;
