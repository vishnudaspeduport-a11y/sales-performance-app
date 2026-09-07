-- Call-duration bands per employee-day (connected calls only), computed from the
-- call log. NULL means "no call-level data for that day" (helper-only days).
-- Run in Supabase → SQL Editor.

alter table public.daily_activity add column if not exists band_0_2    integer;
alter table public.daily_activity add column if not exists band_2_4    integer;
alter table public.daily_activity add column if not exists band_4_plus integer;

create or replace view public.daily_activity_named as
select a.date, a.emp_id, e.name, e.manager, e.tags, e.status,
       a.dialed, a.dialed_connected, a.talk_time_dialed,
       a.incoming, a.incoming_connected, a.talk_time_incoming,
       a.dialed + a.incoming as total_calls,
       a.dialed_connected + a.incoming_connected as connected_calls,
       a.talk_time_dialed + a.talk_time_incoming as talk_time_seconds,
       a.band_0_2, a.band_2_4, a.band_4_plus
from public.daily_activity a
join public.employees e on e.id = a.emp_id;
