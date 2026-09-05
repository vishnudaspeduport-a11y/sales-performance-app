/**
 * HTTP handlers shared by the Netlify functions and the local dev API.
 * Each takes a standard Request and returns a Response.
 */
import { MIN_REFRESH_INTERVAL_S, cacheSeconds, env } from './config.mjs';
import { emptyPayload } from './sync.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };

export function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** True when the caller presented the shared sync secret (header or query). */
export function authorized(req) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const given = req.headers.get('x-sync-secret') || url.searchParams.get('secret') || '';
  return given.length === secret.length && given === secret;
}

/**
 * Ask the site to run a sync in the background. Throttled so the Refresh
 * button cannot hammer the Google API. `runInline` lets the local dev server
 * run the sync directly instead of calling itself over HTTP.
 */
export async function queueSync({ repo, req, trigger, runInline }) {
  const last = await repo.getLastSync();
  if (last) {
    const ageS = (Date.now() - Date.parse(last.started_at)) / 1000;
    if (last.status === 'running' && ageS < 15 * 60) return { queued: false, reason: 'A sync is already running.' };
    if (trigger === 'manual' && ageS < MIN_REFRESH_INTERVAL_S) return { queued: false, reason: `Last sync was ${Math.round(ageS)}s ago; try again in a minute.` };
  }
  if (runInline) { runInline().catch((e) => console.error('sync failed', e)); return { queued: true }; }
  const origin = process.env.URL || new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/.netlify/functions/sync-background`, { method: 'POST', headers: { 'x-sync-secret': env('SYNC_SECRET'), 'content-type': 'application/json' }, body: JSON.stringify({ trigger }) });
    return { queued: res.status === 202 || res.ok, status: res.status };
  } catch (e) {
    return { queued: false, reason: String(e?.message || e) };
  }
}

export async function handleData({ repo, req, runInline }) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';
  const snap = await repo.getLatestSnapshot();
  const payload = snap?.payload ?? emptyPayload(['No sync has completed yet. Run a sync (scheduled every 5 minutes, or POST /api/sync with the secret).']);
  payload.meta.cacheHit = !refresh;
  payload.meta.cachedAt = snap?.created_at ?? payload.meta.generatedAt;
  payload.meta.cacheSeconds = cacheSeconds();
  if (refresh) {
    const q = await queueSync({ repo, req, trigger: 'manual', runInline });
    payload.meta.refreshQueued = q.queued;
    if (!q.queued && q.reason) payload.meta.refreshNote = q.reason;
  }
  const cs = cacheSeconds();
  return json(payload, { headers: { 'cache-control': refresh ? 'no-store' : `public, max-age=${cs}, s-maxage=${cs}, stale-while-revalidate=60` } });
}

export async function handleHealth({ repo }) {
  const last = await repo.getLastSync();
  const snap = await repo.getLatestSnapshot();
  return json({ ok: true, time: new Date().toISOString(), lastSync: last ? { id: last.id, status: last.status, trigger: last.trigger, startedAt: last.started_at, finishedAt: last.finished_at, rowCount: last.row_count, dateTo: last.date_to, error: last.error ?? null } : null, snapshotAt: snap?.created_at ?? null }, { headers: { 'cache-control': 'no-store' } });
}
