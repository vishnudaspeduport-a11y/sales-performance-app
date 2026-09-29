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

export interface AdminSession { admin: boolean; configured: boolean }

/** Whether this browser holds a valid admin cookie, and whether a password is set on the server. */
export async function adminSession(): Promise<AdminSession> {
  const res = await fetch(`${apiBase()}/admin/session`, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new ApiError('server', `Session check failed (${res.status}).`);
  const b = (await res.json()) as Partial<AdminSession>;
  return { admin: b.admin === true, configured: b.configured === true };
}

/** Enter the admin password; the server answers with a cookie when it matches. */
export async function adminLogin(password: string): Promise<AdminSession> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/admin/login`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  } catch { throw new ApiError('network', 'Could not reach the server.'); }
  const b = (await res.json().catch(() => ({}))) as Partial<AdminSession> & { error?: string };
  if (!res.ok) throw new ApiError('server', b.error || `Login failed (${res.status}).`);
  return { admin: b.admin === true, configured: b.configured === true };
}

export async function adminLogout(): Promise<void> {
  await fetch(`${apiBase()}/admin/logout`, { method: 'POST', credentials: 'same-origin' });
}

export async function fetchHealth(): Promise<Health> {
  const url = new URL(`${apiBase()}/health`, window.location.href);
  url.searchParams.set('t', String(Date.now()));
  const { res, body } = await fetchJson<Health>(url.toString(), { cache: 'no-store' }, 30000);
  if (!res.ok) throw new ApiError('server', `The health check responded with status ${res.status}.`);
  return body;
}

/* ---------------- WhatsApp: send a picture to chosen numbers (admin) ---------------- */
export interface WhatsAppRecipient { id: string; name: string; team: string; masked: string }
export interface WhatsAppSetup { configured: boolean; template: string; recipients: WhatsAppRecipient[] }
export interface WhatsAppSendResult { sent: number; failed: number; results: { id: string; name: string; ok: boolean; error?: string }[] }

/** The numbers the Send button can post to (names and masked numbers only) and whether sending is set up. */
export async function whatsappSetup(): Promise<WhatsAppSetup> {
  if (isSnapshotHost()) return { configured: false, template: '', recipients: [] };
  let res: Response;
  try { res = await fetch(`${apiBase()}/whatsapp/recipients`, { credentials: 'same-origin', cache: 'no-store' }); }
  catch { throw new ApiError('network', 'Could not reach the server.'); }
  const b = (await res.json().catch(() => ({}))) as Partial<WhatsAppSetup> & { error?: string };
  if (!res.ok) throw new ApiError('server', b.error || `Could not load the recipients (${res.status}).`);
  return { configured: b.configured === true, template: b.template || '', recipients: Array.isArray(b.recipients) ? b.recipients : [] };
}

/** Post the picture to the chosen recipient ids; the server talks to the WhatsApp Cloud API. */
export async function whatsappSendImage(image: Blob, to: string[], meta: { team: string; date: string; overdue: string; today: string; caption?: string }): Promise<WhatsAppSendResult> {
  const form = new FormData();
  form.append('image', image, 'pending-tasks.png');
  form.append('to', JSON.stringify(to));
  for (const [k, v] of Object.entries(meta)) if (v != null) form.append(k, v);
  let res: Response;
  try { res = await fetch(`${apiBase()}/whatsapp/send`, { method: 'POST', credentials: 'same-origin', body: form }); }
  catch { throw new ApiError('network', 'Could not reach the server.'); }
  const b = (await res.json().catch(() => ({}))) as Partial<WhatsAppSendResult> & { error?: string };
  if (!res.ok) throw new ApiError('server', b.error || `Sending failed (${res.status}).`);
  return { sent: b.sent || 0, failed: b.failed || 0, results: Array.isArray(b.results) ? b.results : [] };
}

/* ---------------- WhatsApp groups per table, shared between admins ---------------- */
export interface SharedGroups { groups: Record<string, string>; updatedAt: string | null }

/** The groups saved on the server; null when this visitor may not read them (not an admin) or there is no server. */
export async function whatsappGroupsGet(): Promise<SharedGroups | null> {
  if (isSnapshotHost()) return null;
  const res = await fetch(`${apiBase()}/whatsapp/groups`, { credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new ApiError('server', `Could not read the WhatsApp groups (${res.status}).`);
  const b = (await res.json()) as Partial<SharedGroups>;
  return { groups: b.groups && typeof b.groups === 'object' ? b.groups : {}, updatedAt: b.updatedAt ?? null };
}

/** Replace the groups saved on the server. */
export async function whatsappGroupsPut(groups: Record<string, string>): Promise<SharedGroups> {
  const res = await fetch(`${apiBase()}/whatsapp/groups`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups }) });
  const b = (await res.json().catch(() => ({}))) as Partial<SharedGroups> & { error?: string };
  if (!res.ok) throw new ApiError('server', res.status === 401 ? 'Sign in as Admin to save the groups for everyone.' : b.error || `Could not save the groups (${res.status}).`);
  return { groups: b.groups ?? groups, updatedAt: b.updatedAt ?? null };
}
