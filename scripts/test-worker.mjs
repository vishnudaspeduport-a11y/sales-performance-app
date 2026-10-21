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

// admin view: no password configured → everyone is an admin
{
  const res = await run('/api/admin/session');
  assert.deepEqual(await res.json(), { admin: true, configured: false });
}
// admin view: with a password, the cookie decides
{
  const envA = { ...env, ADMIN_PASSWORD: 'open-sesame' };
  const runA = (path, init) => worker.fetch(req(path, init), envA, ctx);
  assert.deepEqual(await (await runA('/api/admin/session')).json(), { admin: false, configured: true });
  const bad = await runA('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }), headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 401);
  const ok = await runA('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'open-sesame' }), headers: { 'content-type': 'application/json' } });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^eds_admin=\d+\.[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
  const token = cookie.split(';')[0].split('=')[1];
  assert.deepEqual(await (await runA('/api/admin/session', { headers: { cookie: `eds_admin=${token}` } })).json(), { admin: true, configured: true });
  const forged = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  assert.deepEqual(await (await runA('/api/admin/session', { headers: { cookie: `eds_admin=${forged}` } })).json(), { admin: false, configured: true });
  const expired = `1.${token.split('.')[1]}`;
  assert.deepEqual(await (await runA('/api/admin/session', { headers: { cookie: `eds_admin=${expired}` } })).json(), { admin: false, configured: true });
  const out = await runA('/api/admin/logout', { method: 'POST' });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
}

// WhatsApp groups: saved once, read by every admin; admin only
{
  const realFetch = globalThis.fetch;
  let stored = null; const puts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/call-log-archive/stats/whatsapp-groups.json')) {
      if ((init.method || 'GET') === 'POST') { puts.push(init); stored = String(init.body); return new Response('{"Key":"x"}', { headers: { 'content-type': 'application/json' } }); }
      return stored == null ? new Response('{"error":"not found"}', { status: 400 }) : new Response(stored, { headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  assert.deepEqual(await (await run('/api/whatsapp/groups')).json(), { groups: {}, updatedAt: null });
  const put = await run('/api/whatsapp/groups', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: { 'bdm:averages': ' Sales heads: https://chat.whatsapp.com/AAAABBBBCCCCDDDDEEEEFF \r\nhttps://chat.whatsapp.com/GGGGHHHHIIIIJJJJKKKKLL', empty: '  ', bad: 42 } }) });
  assert.equal(put.status, 200);
  assert.equal(puts[0].headers['x-upsert'], 'true');
  const back = await (await run('/api/whatsapp/groups')).json();
  assert.deepEqual(back.groups, { 'bdm:averages': 'Sales heads: https://chat.whatsapp.com/AAAABBBBCCCCDDDDEEEEFF \nhttps://chat.whatsapp.com/GGGGHHHHIIIIJJJJKKKKLL' });
  assert.match(back.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const envP = { ...env, ADMIN_PASSWORD: 'pw' };
  assert.equal((await worker.fetch(req('/api/whatsapp/groups'), envP, ctx)).status, 401);
  assert.equal((await worker.fetch(req('/api/whatsapp/groups', { method: 'PUT', body: '{}' }), envP, ctx)).status, 401);
  globalThis.fetch = realFetch;
}

// WhatsApp send: admin only, recipients masked, media upload then one template message per number
{
  const envW = { ...env, WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_ID: '12345', WHATSAPP_RECIPIENTS: JSON.stringify([{ name: 'Aswanth', whatsapp: '+91 98765 43210', team: 'Team Aswanth' }, { name: 'Head', whatsapp: '919000000001' }, { name: 'Broken' }]) };
  const runW = (path, init) => worker.fetch(req(path, init), envW, ctx);
  const setup = await (await runW('/api/whatsapp/recipients')).json();
  assert.equal(setup.configured, true);
  assert.deepEqual(setup.recipients, [{ id: '0', name: 'Aswanth', team: 'Team Aswanth', masked: '91••••••3210' }, { id: '1', name: 'Head', team: '', masked: '91••••••0001' }]);
  assert.ok(!JSON.stringify(setup).includes('9876543210'), 'full numbers never leave the server');
  const noSetup = await (await run('/api/whatsapp/recipients')).json();
  assert.equal(noSetup.configured, false);
  const withPw = await worker.fetch(req('/api/whatsapp/recipients'), { ...envW, ADMIN_PASSWORD: 'pw' }, ctx);
  assert.equal(withPw.status, 401);

  const realFetch = globalThis.fetch;
  const graph = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://graph.facebook.com/v20.0/12345/media')) { graph.push({ u, form: init.body }); return new Response(JSON.stringify({ id: 'media-1' }), { headers: { 'content-type': 'application/json' } }); }
    if (u.startsWith('https://graph.facebook.com/v20.0/12345/messages')) {
      const body = JSON.parse(init.body); graph.push({ u, body });
      if (body.to === '919000000001') return new Response(JSON.stringify({ error: { message: 'Recipient not opted in' } }), { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'x.png');
  form.append('to', JSON.stringify(['0', '1', '9']));
  form.append('team', 'Team Aswanth'); form.append('date', '9 Sep 2026'); form.append('overdue', '1,048'); form.append('today', '648');
  const res = await runW('/api/whatsapp/send', { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.sent, 1); assert.equal(out.failed, 1);
  assert.deepEqual(out.results.map((r) => [r.name, r.ok]), [['Aswanth', true], ['Head', false]]);
  assert.match(out.results[1].error, /opted in/);
  assert.equal(graph[0].form.get('messaging_product'), 'whatsapp');
  assert.equal(graph[1].body.to, '919876543210');
  assert.equal(graph[1].body.template.name, 'pending_tasks_image');
  assert.deepEqual(graph[1].body.template.components[0], { type: 'header', parameters: [{ type: 'image', image: { id: 'media-1' } }] });
  assert.deepEqual(graph[1].body.template.components[1].parameters.map((p) => p.text), ['Team Aswanth', '9 Sep 2026', '1,048', '648']);
  const none = await runW('/api/whatsapp/send', { method: 'POST', body: (() => { const f = new FormData(); f.append('image', new Blob([1]), 'x.png'); f.append('to', '["7"]'); return f; })() });
  assert.equal(none.status, 400);
  const off = await run('/api/whatsapp/send', { method: 'POST', body: form });
  assert.equal(off.status, 503);
  globalThis.fetch = realFetch;
}

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
  assert.match(throttled.reason, /can start in/);
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
