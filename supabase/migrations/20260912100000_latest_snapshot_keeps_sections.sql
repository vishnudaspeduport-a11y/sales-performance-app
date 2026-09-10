-- The old Netlify sync writes snapshots that lack the newer sections (pending tasks, HR directory).
-- Serve the newest snapshot but carry each missing section over from the latest snapshot that has it.
-- Run in Supabase → SQL Editor. Safe to run more than once.

create or replace function public.latest_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select payload from public.dashboard_snapshots order by created_at desc limit 1
  ),
  with_pending as (
    select payload->'pending' as v from public.dashboard_snapshots
    where jsonb_typeof(payload->'pending') = 'object' order by created_at desc limit 1
  ),
  with_directory as (
    select payload->'directory' as v from public.dashboard_snapshots
    where jsonb_typeof(payload->'directory') = 'object' order by created_at desc limit 1
  )
  select coalesce(
    (select payload
            || case when jsonb_typeof(payload->'pending') = 'object' then '{}'::jsonb
                    else coalesce(jsonb_build_object('pending', (select v from with_pending)), '{}'::jsonb) end
            || case when jsonb_typeof(payload->'directory') = 'object' then '{}'::jsonb
                    else coalesce(jsonb_build_object('directory', (select v from with_directory)), '{}'::jsonb) end
     from latest),
    jsonb_build_object(
      'meta', jsonb_build_object(
        'sourceMode', 'none', 'sourceSheets', '[]'::jsonb, 'generatedAt', now(), 'timezone', 'Asia/Kolkata',
        'rowCount', 0, 'employeeCount', 0, 'dateRange', null,
        'notes', jsonb_build_array('No sync has completed yet. Run the "Sync dashboard data" workflow or press Refresh Data.')
      ),
      'fields', '[]'::jsonb, 'dims', '[]'::jsonb, 'employees', '[]'::jsonb, 'rows', '[]'::jsonb
    )
  );
$$;

revoke all on function public.latest_snapshot() from public;
grant execute on function public.latest_snapshot() to service_role, anon, authenticated;
