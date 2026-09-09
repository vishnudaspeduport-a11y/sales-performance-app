-- The Cloudflare worker reads the latest dashboard payload through this function so the
-- JSON is returned as-is (no wrapping array) and can be streamed to the browser untouched.
-- Run in Supabase → SQL Editor. Safe to run more than once.

create or replace function public.latest_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select payload from public.dashboard_snapshots order by created_at desc limit 1),
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
