-- Talk time per duration band (seconds) and unique connected numbers per
-- employee-day, both computed from the call log. NULL = no call-level data.
-- Run in Supabase → SQL Editor.

alter table public.daily_activity add column if not exists tt_band_0_2      integer;
alter table public.daily_activity add column if not exists tt_band_2_4      integer;
alter table public.daily_activity add column if not exists tt_band_4_plus   integer;
alter table public.daily_activity add column if not exists unique_connected integer;

create or replace view public.daily_activity_named as
select a.date, a.emp_id, e.name, e.manager, e.tags, e.status,
       a.dialed, a.dialed_connected, a.talk_time_dialed,
       a.incoming, a.incoming_connected, a.talk_time_incoming,
       a.dialed + a.incoming as total_calls,
       a.dialed_connected + a.incoming_connected as connected_calls,
       a.talk_time_dialed + a.talk_time_incoming as talk_time_seconds,
       a.band_0_2, a.band_2_4, a.band_4_plus,
       a.tt_band_0_2, a.tt_band_2_4, a.tt_band_4_plus,
       a.unique_connected
from public.daily_activity a
join public.employees e on e.id = a.emp_id;

-- Make the sync recompute call-log metrics for archived days that predate these columns.
update public.daily_activity set band_0_2 = null, band_2_4 = null, band_4_plus = null where tt_band_0_2 is null;
