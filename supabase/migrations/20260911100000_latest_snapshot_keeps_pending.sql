-- If the newest dashboard snapshot was written by a sync that does not know about the
-- Pending Tasks sheet (for example the old Netlify function), keep serving the most recent
-- pending-tasks section from an earlier snapshot instead of dropping it.
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
    select payload->'pending' as pending
    from public.dashboard_snapshots
    where payload ? 'pending' and payload->'pending' is not null and jsonb_typeof(payload->'pending') = 'object'
    order by created_at desc limit 1
  )
  select coalesce(
    (select case
              when payload ? 'pending' and jsonb_typeof(payload->'pending') = 'object' then payload
              else payload || jsonb_build_object('pending', (select pending from with_pending))
            end
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
