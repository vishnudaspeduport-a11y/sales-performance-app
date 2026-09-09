import type { Payload } from '../types';

declare global {
  interface Window {
    /** Override the API URL at runtime (optional). */
    __SALES_DASHBOARD_API__?: string;
    /** Embedded data snapshot (static exports). */
    __SALES_DASHBOARD_DATA__?: Payload;
  }
}

export class ApiError extends Error {
  kind: 'network' | 'server' | 'parse';
  constructor(kind: ApiError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Data endpoint: runtime override → build-time env → same-origin /api/data. */
export function apiUrl(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined) || '';
  return (typeof window !== 'undefined' && window.__SALES_DASHBOARD_API__) || env || '/api/data';
}

/** Base of the API (the data endpoint without its last path segment). */
function apiBase(): string {
  return apiUrl().replace(/\/[^/]*$/, '');
}

export function isSnapshotHost(): boolean {
  return typeof window !== 'undefined' && !!window.__SALES_DASHBOARD_DATA__;
}

export interface Health {
  ok: boolean;
  time: string;
  lastSync: { id: number; status: string; trigger: string; startedAt: string; finishedAt: string | null; rowCount: number | null; dateTo: string | null; error: string | null } | null;
  snapshotAt: string | null;
}

export interface RefreshResult {
  queued: boolean;
  reason?: string;
  /** snapshot time before the refresh, so a poll can tell when new data has landed */
  snapshotAt?: string | null;
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response; body: T }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    throw new ApiError('network', 'Could not reach the data service. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let body: T;
  try { body = (await res.json()) as T; }
  catch { throw new ApiError('parse', `The data service returned an unreadable response (status ${res.status}).`); }
  return { res, body };
}

/** Load the dashboard payload. `fresh` bypasses every cache (used after a sync has finished). */
export async function fetchPayload(fresh = false): Promise<Payload> {
  if (isSnapshotHost()) {
    const snap = window.__SALES_DASHBOARD_DATA__!;
    return { ...snap, meta: { ...snap.meta, snapshot: true } };
  }
  const url = new URL(apiUrl(), window.location.href);
  if (fresh) url.searchParams.set('fresh', String(Date.now()));
  const { res, body: payload } = await fetchJson<Payload>(url.toString(), { cache: fresh ? 'no-store' : 'default' }, 60000);
  if (!res.ok || payload.error) throw new ApiError('server', payload.error || `The data service responded with status ${res.status}.`);
  if (!Array.isArray(payload.rows) || !Array.isArray(payload.fields)) throw new ApiError('parse', 'The data service returned an incomplete payload.');
  return payload;
}

/** Ask the server to re-read the Google Sheet. The sync runs elsewhere; poll `fetchHealth` for completion. */
export async function requestRefresh(): Promise<RefreshResult> {
  const url = new URL(`${apiBase()}/refresh`, window.location.href);
  const { res, body } = await fetchJson<RefreshResult & { error?: string }>(url.toString(), { method: 'POST', cache: 'no-store' }, 30000);
  if (!res.ok && body.error) throw new ApiError('server', body.error);
  if (!res.ok) throw new ApiError('server', `The refresh request failed with status ${res.status}.`);
  return body;
}

export async function fetchHealth(): Promise<Health> {
  const url = new URL(`${apiBase()}/health`, window.location.href);
  url.searchParams.set('t', String(Date.now()));
  const { res, body } = await fetchJson<Health>(url.toString(), { cache: 'no-store' }, 30000);
  if (!res.ok) throw new ApiError('server', `The health check responded with status ${res.status}.`);
  return body;
}
