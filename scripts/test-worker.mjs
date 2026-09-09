/**
 * Exercises the Cloudflare worker's routes with a stubbed fetch (no network, no secrets):
 * data streaming + cache headers, health, refresh throttling + GitHub dispatch, archives,
 * archive download key check, CORS and 404s.
 *   node scripts/test-worker.mjs
 */
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import worker from '../worker/index.mjs';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', GITHUB_TOKEN: 'gh-token', GITHUB_REPO: 'owner/repo', SYNC_SECRET: 'sync-secret', DOWNLOAD_KEY: 'dl-key', CACHE_SECONDS: '300' };
const ctx = { waitUntil() {} };
const payload = { meta: { generatedAt: '2026-09-09T08:20:26.032Z', syncedAt: '2026-09-09T08:19:30.000Z' }, fields: [{ key: 'date' }], dims: [], employees: [], rows: [['2026-09-09', 'EP1', 1]] };
const calls = [];
let lastSyncRow = { id: 1, status: 'success', trigger: 'scheduled', started_at: new Date(Date.now() - 3600_000).toISOString(), finished_at: new Date().toISOString(), row_count: 10, date_to: '2026-09-09', error: null };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  if (u.includes('/rest/v1/rpc/latest_snapshot')) return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  if (u.includes('/rest/v1/sync_runs')) return new Response(JSON.stringify([lastSyncRow]), { headers: { 'content-type': 'application/json' } });
  if (u.includes('/rest/v1/dashboard_snapshots')) return new Response(JSON.stringify([{ created_at: '2026-09-09T08:20:28.000Z' }]), { headers: { 'content-type': 'application/json' } });
  if (u.includes('/rest/v1/call_log_archives')) return new Response(JSON.stringify([{ date: '2026-09-08', row_count: 5, bytes: 10, csv_bytes: 20, columns: ['a'], updated_at: 'x' }]), { headers: { 'content-type': 'application/json' } });
  if (u.includes('/storage/v1/object/call-log-archive/calls/2026-09-08.csv.gz')) return new Response(gzipSync(Buffer.from('a,b\n1,2\n')), { headers: { 'content-type': 'application/gzip' } });
  if (u.includes('/storage/v1/object/')) return new Response('{"error":"not found"}', { status: 404 });
  if (u.includes('api.github.com/repos/owner/repo/actions/workflows/sync.yml/dispatches')) return new Response(null, { status: 204 });
  return new Response('unexpected ' + u, { status: 500 });
};

const req = (path, init) => new Request(`https://eduportsales.example.workers.dev${path}`, init);
const run = (path, init) => worker.fetch(req(path, init), env, ctx);

// data: streamed through with the service key and edge cache headers
{
  const res = await run('/api/data');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /s-maxage=300/);
  const body = await res.json();
  assert.deepEqual(body, payload, 'payload passed through unchanged');
  const call = calls.find((c) => c.url.includes('rpc/latest_snapshot'));
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.apikey, 'service-key');
  const fresh = await run('/api/data?fresh=123');
  assert.equal(fresh.headers.get('cache-control'), 'no-store');
  console.log('data OK');
}

// health
{
  const h = await (await run('/api/health')).json();
  assert.equal(h.ok, true);
  assert.equal(h.lastSync.status, 'success');
  assert.equal(h.snapshotAt, '2026-09-09T08:20:28.000Z');
  console.log('health OK');
}

// refresh: dispatches the GitHub workflow; throttled when a sync just ran / is running
{
  const res = await run('/api/refresh', { method: 'POST' });
  const body = await res.json();
  assert.equal(res.status, 202);
  assert.equal(body.queued, true);
  assert.equal(body.snapshotAt, '2026-09-09T08:20:28.000Z');
  const gh = calls.find((c) => c.url.includes('api.github.com'));
  assert.ok(gh, 'GitHub dispatch called');
  assert.equal(gh.headers.authorization, 'Bearer gh-token');
  assert.deepEqual(JSON.parse(gh.body), { ref: 'main', inputs: { trigger: 'manual' } });

  lastSyncRow = { ...lastSyncRow, started_at: new Date().toISOString() };
  const throttled = await (await run('/api/refresh', { method: 'POST' })).json();
  assert.equal(throttled.queued, false);
  assert.match(throttled.reason, /try again/);
  lastSyncRow = { ...lastSyncRow, status: 'running' };
  const running = await (await run('/api/refresh', { method: 'POST' })).json();
  assert.match(running.reason, /already running/);
  lastSyncRow = { ...lastSyncRow, status: 'success', started_at: new Date(Date.now() - 3600_000).toISOString() };
  assert.equal((await run('/api/refresh')).status, 404, 'GET /api/refresh is not a route');
  console.log('refresh OK');
}

// sync with secret
{
  assert.equal((await run('/api/sync', { method: 'POST' })).status, 401);
  assert.equal((await run('/api/sync', { method: 'POST', headers: { 'x-sync-secret': 'sync-secret' } })).status, 202);
  console.log('sync OK');
}

// archives list + download
{
  const list = await (await run('/api/archives')).json();
  assert.equal(list.archives[0].date, '2026-09-08');
  assert.equal(list.archives[0].rows, 5);
  assert.equal((await run('/api/archives/2026-09-08.csv')).status, 401, 'download needs the key');
  assert.equal((await run('/api/archives/2026-09-08.csv?key=wrong')).status, 401);
  const ok = await run('/api/archives/2026-09-08.csv', { headers: { 'x-download-key': 'dl-key' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-encoding'), 'gzip');
  assert.match(ok.headers.get('content-disposition'), /call-log-2026-09-08\.csv/);
  assert.equal((await run('/api/archives/2026-09-01.csv?key=dl-key')).status, 404);
  assert.equal((await run('/api/archives/nope.csv?key=dl-key')).status, 400);
  console.log('archives OK');
}

// CORS preflight, unknown route, non-API path without assets binding
{
  assert.equal((await run('/api/data', { method: 'OPTIONS' })).status, 204);
  assert.equal((await run('/api/nothing')).status, 404);
  assert.equal((await run('/dashboard')).status, 404, 'no ASSETS binding in the test');
  // missing secrets surface as a JSON 500, not a crash
  const bad = await worker.fetch(req('/api/health'), {}, ctx);
  assert.equal(bad.status, 500);
  assert.match((await bad.json()).detail, /SUPABASE/);
  console.log('routing OK');
}
console.log('worker OK');
