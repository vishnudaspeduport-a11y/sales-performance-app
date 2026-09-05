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

/** API endpoint: runtime override → build-time env → same-origin Netlify function. */
export function apiUrl(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined) || '';
  return (typeof window !== 'undefined' && window.__SALES_DASHBOARD_API__) || env || '/api/data';
}

export function isSnapshotHost(): boolean {
  return typeof window !== 'undefined' && !!window.__SALES_DASHBOARD_DATA__;
}

/** Load the dashboard payload. `refresh` asks the server to re-read the Google Sheet. */
export async function fetchPayload(refresh = false): Promise<Payload> {
  if (isSnapshotHost()) {
    const snap = window.__SALES_DASHBOARD_DATA__!;
    return { ...snap, meta: { ...snap.meta, snapshot: true } };
  }
  const url = new URL(apiUrl(), window.location.href);
  if (refresh) url.searchParams.set('refresh', '1');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: ctrl.signal, cache: refresh ? 'no-store' : 'default' });
  } catch {
    throw new ApiError('network', 'Could not reach the data service. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let payload: Payload;
  try { payload = (await res.json()) as Payload; }
  catch { throw new ApiError('parse', `The data service returned an unreadable response (status ${res.status}).`); }
  if (!res.ok || payload.error) throw new ApiError('server', payload.error || `The data service responded with status ${res.status}.`);
  if (!Array.isArray(payload.rows) || !Array.isArray(payload.fields)) throw new ApiError('parse', 'The data service returned an incomplete payload.');
  return payload;
}
