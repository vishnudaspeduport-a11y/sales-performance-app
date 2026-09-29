/**
 * Cloudflare Worker: serves the built dashboard (static assets) and the small API
 * the page needs. Nothing heavy runs here — the Google Sheet sync runs in a GitHub
 * Actions workflow, which this worker only triggers. Every handler streams data
 * through without parsing the (large) dashboard payload, so it fits the free plan.
 *
 *   GET  /api/data                 latest dashboard payload (edge-cached CACHE_SECONDS)
 *   GET  /api/data?fresh=<n>       same, bypassing the cache
 *   GET  /api/health               last sync + snapshot time
 *   POST /api/refresh              queue a sync (throttled); returns {queued, reason, snapshotAt}
 *   POST /api/sync                 same, requires header x-sync-secret
 *   GET  /api/archives             archived call-log days
 *   GET  /api/archives/:date.csv   one day's call log, requires the download key
 *   POST /api/admin/login          {password} → sets the admin cookie (30 days) when it matches ADMIN_PASSWORD
 *   GET  /api/admin/session        {admin, configured} for the cookie sent
 *   POST /api/admin/logout         clears the cookie
 *   GET  /api/whatsapp/recipients  admin: the numbers the Send button can post to (names, masked numbers)
 *   GET  /api/whatsapp/groups      admin: the WhatsApp groups saved for each table, shared by every admin
 *   PUT  /api/whatsapp/groups      admin: {groups: {key: "one link per line"}} replaces the saved list
 *   POST /api/whatsapp/send        admin: multipart {image, to: [ids], team, date, overdue, today} → WhatsApp Cloud API
 *
 * Secrets (Workers → Settings → Variables and Secrets): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * GITHUB_TOKEN (fine-grained, Actions: read & write on the repo), DOWNLOAD_KEY, SYNC_SECRET,
 * ADMIN_PASSWORD (unlocks the Admin view; until it is set every visitor may use the Admin view),
 * WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (WhatsApp Cloud API sender), WHATSAPP_RECIPIENTS (JSON list of
 * {name, whatsapp, team?}; the page only ever sees names and masked numbers).
 * Optional vars: WHATSAPP_IMAGE_TEMPLATE (approved template with an IMAGE header and four body
 * parameters team, date, overdue, due today; default pending_tasks_image; "none" sends a plain image,
 * delivered only inside the 24-hour window), WHATSAPP_TEMPLATE_LANG (default en).
 * Plain vars (wrangler.toml): GITHUB_REPO, GITHUB_BRANCH, SYNC_WORKFLOW, CACHE_SECONDS.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };
const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'content-type, x-sync-secret, x-download-key' };
const MIN_REFRESH_INTERVAL_S = 60;
const STALE_RUN_MINUTES = 15;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, 'cache-control': 'no-store', ...headers } });
}

function cacheSeconds(env) {
  const n = Number(env.CACHE_SECONDS);
  return Number.isFinite(n) && n >= 0 ? n : 300;
}

function need(env, name) {
  const v = env[name];
  if (v == null || String(v).trim() === '') throw new Error(`Missing secret ${name}`);
  return String(v);
}

/** Supabase REST / Storage call with the service role key. */
function supabase(env, path, init = {}) {
  const key = need(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const url = need(env, 'SUPABASE_URL').replace(/\/$/, '') + path;
  return fetch(url, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, ...(init.headers || {}) } });
}

async function lastSync(env) {
  const res = await supabase(env, '/rest/v1/sync_runs?select=id,status,trigger,started_at,finished_at,row_count,date_to,error&order=started_at.desc&limit=1');
  if (!res.ok) throw new Error(`Supabase sync_runs responded ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function snapshotAt(env) {
  const res = await supabase(env, '/rest/v1/dashboard_snapshots?select=created_at&order=created_at.desc&limit=1');
  if (!res.ok) throw new Error(`Supabase dashboard_snapshots responded ${res.status}`);
  const rows = await res.json();
  return rows[0]?.created_at ?? null;
}

/** Ask GitHub Actions to run the sync workflow (throttled like the old Netlify queue). */
async function queueSync(env, trigger) {
  const last = await lastSync(env);
  if (last) {
    const ageS = (Date.now() - Date.parse(last.started_at)) / 1000;
    if (last.status === 'running' && ageS < STALE_RUN_MINUTES * 60) return { queued: false, reason: 'A sync is already running.' };
    if (trigger === 'manual' && ageS < MIN_REFRESH_INTERVAL_S) return { queued: false, reason: `Last sync was ${Math.round(ageS)}s ago; try again in a minute.` };
  }
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return { queued: false, reason: 'The sync trigger is not configured (GITHUB_TOKEN / GITHUB_REPO).' };
  const workflow = env.SYNC_WORKFLOW || 'sync.yml';
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'eduport-sales-dashboard', 'content-type': 'application/json' },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH || 'main', inputs: { trigger } }),
  });
  if (res.status === 204) return { queued: true };
  const detail = (await res.text()).slice(0, 200);
  return { queued: false, reason: `GitHub responded ${res.status}${detail ? `: ${detail}` : ''}` };
}

/* ---- Admin view: a signed, HttpOnly cookie issued after the ADMIN_PASSWORD is entered ---- */
const ADMIN_COOKIE = 'eds_admin';
const ADMIN_DAYS = 30;

async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(req, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(req.headers.get('cookie') || '');
  return m ? decodeURIComponent(m[1]) : '';
}

function sameString(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length && a === b;
}

/** True when the request carries a valid admin cookie. Without ADMIN_PASSWORD everyone is an admin. */
async function isAdmin(req, env) {
  if (!env.ADMIN_PASSWORD) return true;
  const [exp, sig] = readCookie(req, ADMIN_COOKIE).split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return sameString(sig, await hmacHex('eds-admin|' + env.ADMIN_PASSWORD, exp));
}

function cookieHeader(value, maxAge) {
  return { 'set-cookie': `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax` };
}

async function handleAdminLogin(req, env) {
  if (!env.ADMIN_PASSWORD) return json({ admin: true, configured: false });
  let body = {};
  try { body = await req.json(); } catch { /* no body */ }
  const given = String(body?.password ?? '');
  if (!sameString(given, String(env.ADMIN_PASSWORD))) return json({ error: 'That password is not correct.' }, 401);
  const exp = String(Date.now() + ADMIN_DAYS * 86400000);
  const token = `${exp}.${await hmacHex('eds-admin|' + env.ADMIN_PASSWORD, exp)}`;
  return json({ admin: true, configured: true, expiresAt: new Date(Number(exp)).toISOString() }, 200, cookieHeader(token, ADMIN_DAYS * 86400));
}

async function handleAdminSession(req, env) {
  return json({ admin: await isAdmin(req, env), configured: !!env.ADMIN_PASSWORD });
}

function handleAdminLogout() {
  return json({ admin: false }, 200, cookieHeader('', 0));
}

/* ---------------- WhatsApp: send a picture to chosen numbers ---------------- */
const GRAPH = 'https://graph.facebook.com/v20.0';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** WHATSAPP_RECIPIENTS parsed: [{ id, name, team, number }] (numbers digits only, entries without a number dropped). */
function whatsappRecipients(env) {
  let list = [];
  try { list = JSON.parse(env.WHATSAPP_RECIPIENTS || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  return list.map((r, i) => ({
    id: String(i),
    name: String(r?.name || r?.team || `Recipient ${i + 1}`).trim(),
    team: r?.team ? String(r.team).trim() : '',
    number: String(r?.whatsapp || r?.number || r?.phone || '').replace(/\D/g, ''),
  })).filter((r) => r.number.length >= 8);
}
const maskNumber = (n) => `${n.slice(0, 2)}${'•'.repeat(Math.max(2, n.length - 6))}${n.slice(-4)}`;
const whatsappConfigured = (env) => !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);

async function graphPost(env, path, body, headers = {}) {
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, ...headers }, body });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp API ${res.status}`);
  return data;
}

async function handleWhatsAppRecipients(req, env) {
  if (!(await isAdmin(req, env))) return json({ error: 'Admin only.' }, 401);
  const recipients = whatsappRecipients(env).map(({ id, name, team, number }) => ({ id, name, team, masked: maskNumber(number) }));
  return json({ configured: whatsappConfigured(env), template: (env.WHATSAPP_IMAGE_TEMPLATE || 'pending_tasks_image').trim(), recipients });
}

async function handleWhatsAppSend(req, env) {
  if (!(await isAdmin(req, env))) return json({ error: 'Admin only.' }, 401);
  if (!whatsappConfigured(env)) return json({ error: 'WhatsApp sending is not set up yet (WHATSAPP_TOKEN and WHATSAPP_PHONE_ID).' }, 503);
  let form;
  try { form = await req.formData(); } catch { return json({ error: 'Expected a multipart form.' }, 400); }
  const image = form.get('image');
  if (!(image instanceof Blob) || !image.size) return json({ error: 'No image was sent.' }, 400);
  if (image.size > MAX_IMAGE_BYTES) return json({ error: 'The image is over 5 MB.' }, 413);
  let ids = [];
  try { ids = JSON.parse(String(form.get('to') || '[]')); } catch { ids = []; }
  if (!Array.isArray(ids)) ids = [];
  const targets = whatsappRecipients(env).filter((r) => ids.includes(r.id));
  if (!targets.length) return json({ error: 'Pick at least one number.' }, 400);
  const params = ['team', 'date', 'overdue', 'today'].map((k) => String(form.get(k) ?? '').replace(/\s+/g, ' ').trim().slice(0, 200));
  const caption = String(form.get('caption') || `${params[0]} · pending tasks · ${params[1]}`).slice(0, 1024);

  const upload = new FormData();
  upload.append('messaging_product', 'whatsapp');
  upload.append('type', 'image/png');
  upload.append('file', image, 'pending-tasks.png');
  let mediaId;
  try { ({ id: mediaId } = await graphPost(env, 'media', upload)); }
  catch (err) { return json({ error: `Could not upload the image to WhatsApp: ${err.message}` }, 502); }
  if (!mediaId) return json({ error: 'WhatsApp did not return a media id.' }, 502);

  const template = (env.WHATSAPP_IMAGE_TEMPLATE || 'pending_tasks_image').trim();
  const lang = env.WHATSAPP_TEMPLATE_LANG || 'en';
  const results = [];
  for (const r of targets) {
    const body = template.toLowerCase() === 'none'
      ? { messaging_product: 'whatsapp', to: r.number, type: 'image', image: { id: mediaId, caption } }
      : { messaging_product: 'whatsapp', to: r.number, type: 'template', template: { name: template, language: { code: lang }, components: [
          { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
          { type: 'body', parameters: params.map((p) => ({ type: 'text', text: p || '-' })) },
        ] } };
    try { await graphPost(env, 'messages', JSON.stringify(body), { 'content-type': 'application/json' }); results.push({ id: r.id, name: r.name, ok: true }); }
    catch (err) { results.push({ id: r.id, name: r.name, ok: false, error: String(err.message || err) }); }
  }
  return json({ sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results });
}

/* ---------------- WhatsApp groups per table, shared between admins ---------------- */
const GROUPS_OBJECT = '/storage/v1/object/call-log-archive/stats/whatsapp-groups.json';
const GROUPS_MAX_BYTES = 60000;

/** Keeps only text entries of a sensible size: { key: "one link per line" }. */
function cleanGroups(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input)) {
    const key = String(k).trim().slice(0, 200);
    const val = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, 4000) : '';
    if (key && val) out[key] = val;
  }
  return out;
}

async function readGroups(env) {
  const res = await supabase(env, GROUPS_OBJECT, { headers: { 'cache-control': 'no-cache' } });
  if (res.status === 404 || res.status === 400) return { groups: {}, updatedAt: null };
  if (!res.ok) throw new Error(`Supabase responded ${res.status}`);
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  return { groups: cleanGroups(data.groups), updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null };
}

async function handleGroupsGet(req, env) {
  if (!(await isAdmin(req, env))) return json({ error: 'Admin only.' }, 401);
  return json(await readGroups(env));
}

async function handleGroupsPut(req, env) {
  if (!(await isAdmin(req, env))) return json({ error: 'Admin only.' }, 401);
  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'Expected JSON.' }, 400); }
  const record = { groups: cleanGroups(body?.groups), updatedAt: new Date().toISOString() };
  const text = JSON.stringify(record);
  if (text.length > GROUPS_MAX_BYTES) return json({ error: 'The list of groups is too long.' }, 413);
  const res = await supabase(env, GROUPS_OBJECT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }, body: text });
  if (!res.ok) return json({ error: 'Could not save the groups.', detail: `Supabase responded ${res.status}` }, 502);
  return json(record);
}

function secretOk(req, url, secret, header, param) {
  if (!secret) return false;
  const given = req.headers.get(header) || url.searchParams.get(param) || '';
  return given.length === secret.length && given === secret;
}

async function handleData(req, env, ctx, url) {
  const legacyRefresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';
  const bypass = legacyRefresh || url.searchParams.has('fresh');
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`${url.origin}/api/data`, { method: 'GET' });
  if (!bypass && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) { const h = new Headers(hit.headers); h.set('x-cache', 'HIT'); return new Response(hit.body, { status: hit.status, headers: h }); }
  }
  let refreshHeaders = {};
  if (legacyRefresh) {
    const q = await queueSync(env, 'manual');
    refreshHeaders = { 'x-refresh-queued': String(q.queued), ...(q.reason ? { 'x-refresh-note': q.reason } : {}) };
  }
  // The RPC returns the payload JSON itself (or an empty payload), so the body is streamed as is.
  const upstream = await supabase(env, '/rest/v1/rpc/latest_snapshot', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' });
  if (!upstream.ok) return json({ error: 'The data service could not read the database.', detail: `Supabase responded ${upstream.status}` }, 500);
  const cs = cacheSeconds(env);
  const res = new Response(upstream.body, {
    status: 200,
    headers: { ...JSON_HEADERS, 'cache-control': bypass ? 'no-store' : `public, max-age=60, s-maxage=${cs}, stale-while-revalidate=60`, 'x-cache': 'MISS', ...refreshHeaders },
  });
  if (!bypass && cache && cs > 0) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function handleHealth(env) {
  const [last, snap] = await Promise.all([lastSync(env), snapshotAt(env)]);
  return json({
    ok: true,
    time: new Date().toISOString(),
    lastSync: last ? { id: last.id, status: last.status, trigger: last.trigger, startedAt: last.started_at, finishedAt: last.finished_at, rowCount: last.row_count, dateTo: last.date_to, error: last.error ?? null } : null,
    snapshotAt: snap,
    host: 'cloudflare',
  });
}

async function handleRefresh(req, env, url, trigger) {
  const q = await queueSync(env, trigger);
  return json({ ...q, snapshotAt: await snapshotAt(env) }, q.queued ? 202 : 200);
}

async function handleArchives(env) {
  const res = await supabase(env, '/rest/v1/call_log_archives?select=date,row_count,bytes,csv_bytes,columns,updated_at&order=date.desc');
  if (!res.ok) return json({ error: 'Could not list archives.', detail: `Supabase responded ${res.status}` }, 500);
  const list = await res.json();
  return json({ archives: list.map((a) => ({ date: String(a.date).slice(0, 10), rows: a.row_count, bytes: a.bytes, csvBytes: a.csv_bytes, columns: a.columns ?? [], updatedAt: a.updated_at })), keyRequired: true });
}

async function handleArchiveFile(req, env, url, date) {
  const key = env.DOWNLOAD_KEY || env.SYNC_SECRET;
  if (!secretOk(req, url, key, 'x-download-key', 'key')) return json({ error: 'A valid download key is required.' }, 401);
  const day = String(date || '').replace(/\.csv$/i, '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'Date must be YYYY-MM-DD.' }, 400);
  const obj = await supabase(env, `/storage/v1/object/call-log-archive/calls/${day}.csv.gz`);
  if (obj.status === 404 || obj.status === 400) return json({ error: `No archive for ${day}.` }, 404);
  if (!obj.ok) return json({ error: 'Could not read the archive.', detail: `Supabase responded ${obj.status}` }, 500);
  // The stored file is gzip; hand it to the browser as a gzip-encoded CSV without touching the bytes.
  return new Response(obj.body, {
    status: 200,
    encodeBody: 'manual',
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-encoding': 'gzip',
      'content-disposition': `attachment; filename="call-log-${day}.csv"`,
      'cache-control': 'private, no-store',
      'access-control-allow-origin': '*',
    },
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      if (path === '/api/data' && req.method === 'GET') return await handleData(req, env, ctx, url);
      if (path === '/api/health' && req.method === 'GET') return await handleHealth(env);
      if (path === '/api/refresh' && req.method === 'POST') return await handleRefresh(req, env, url, 'manual');
      if (path === '/api/sync') {
        if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
        if (!secretOk(req, url, env.SYNC_SECRET, 'x-sync-secret', 'secret')) return json({ error: 'Unauthorized.' }, 401);
        return await handleRefresh(req, env, url, 'manual');
      }
      if (path === '/api/admin/login' && req.method === 'POST') return await handleAdminLogin(req, env);
      if (path === '/api/admin/session' && req.method === 'GET') return await handleAdminSession(req, env);
      if (path === '/api/admin/logout' && req.method === 'POST') return handleAdminLogout();
      if (path === '/api/whatsapp/recipients' && req.method === 'GET') return await handleWhatsAppRecipients(req, env);
      if (path === '/api/whatsapp/send' && req.method === 'POST') return await handleWhatsAppSend(req, env);
      if (path === '/api/whatsapp/groups' && req.method === 'GET') return await handleGroupsGet(req, env);
      if (path === '/api/whatsapp/groups' && req.method === 'PUT') return await handleGroupsPut(req, env);
      if (path === '/api/archives' && req.method === 'GET') return await handleArchives(env);
      const m = /^\/api\/archives\/([^/]+)$/.exec(path);
      if (m && req.method === 'GET') return await handleArchiveFile(req, env, url, decodeURIComponent(m[1]));
      return json({ error: 'Not found.' }, 404);
    } catch (err) {
      return json({ error: 'The data service hit an error.', detail: String(err?.message || err) }, 500);
    }
  },
};
