import { BASE_METRIC_KEYS, CALL_LOG_ONLY_KEYS, type BaseMetricKey, type DailyRecord, type Dataset, type Employee, type Payload } from '../types';
import { isIsoDate } from './dates';

/** Defensive numeric parsing for values that may arrive as strings ("1,234", "", "#N/A"). */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s.startsWith('#')) return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

/** Talk time in seconds from seconds, "HH:MM:SS", "1h 2m 3s" or decimal numbers. */
export function toSeconds(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : 0;
  if (v == null) return 0;
  const s = String(v).trim().toLowerCase();
  if (!s || s.startsWith('#')) return 0;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):(\d{1,2}):(\d{1,2})/.exec(s))) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return +m[1] * 60 + +m[2];
  if (/[hms]/.test(s)) {
    let total = 0; let found = false;
    const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g; let mm: RegExpExecArray | null;
    while ((mm = re.exec(s))) { found = true; const n = parseFloat(mm[1]); total += mm[2] === 'h' ? n * 3600 : mm[2] === 'm' ? n * 60 : n; }
    if (found) return Math.round(total);
  }
  return Math.round(toNumber(s));
}

/** Convert the API payload into typed, validated records. Invalid rows are dropped, not thrown. */
export function toDataset(payload: Payload): Dataset {
  const fields = payload.fields ?? [];
  const idx = new Map(fields.map((f, i) => [f.key, i] as const));
  const dateIdx = idx.get('date');
  const empIdx = idx.get('empId');
  const available = new Set<BaseMetricKey>();
  for (const f of fields) if ((BASE_METRIC_KEYS as string[]).includes(f.key)) available.add(f.key as BaseMetricKey);
  const dimFields = fields.filter((f) => f.kind === 'text' && f.key !== 'empId');

  const employeeById = new Map<string, Employee>();
  for (const e of payload.employees ?? []) {
    if (!e || !e.id) continue;
    employeeById.set(e.id, { id: e.id, name: e.name || e.id, manager: e.manager || '', tags: Array.isArray(e.tags) ? e.tags : [], team: e.team || '', status: e.status || '' });
  }

  const records: DailyRecord[] = [];
  let min: string | null = null; let max: string | null = null;
  if (dateIdx != null && empIdx != null) {
    for (const row of payload.rows ?? []) {
      if (!Array.isArray(row)) continue;
      const date = row[dateIdx];
      const empId = String(row[empIdx] ?? '').trim();
      if (!isIsoDate(date) || !empId) continue;
      const rec: DailyRecord = {
        date, empId,
        dialed: 0, dialedConnected: 0, talkTimeDialed: 0, incoming: 0, incomingConnected: 0, talkTimeIncoming: 0, notConnected: 0,
        band02: null, band24: null, band4p: null, ttBand02: null, ttBand24: null, ttBand4p: null, uniqueConnected: null,
        dims: {},
      };
      for (const k of BASE_METRIC_KEYS) {
        const i = idx.get(k);
        if (i == null) continue;
        if (CALL_LOG_ONLY_KEYS.includes(k)) { const v = row[i]; (rec as unknown as Record<string, number | null>)[k] = v == null || v === '' ? null : (k.startsWith('ttBand') ? toSeconds(v) : toNumber(v)); continue; }
        (rec as unknown as Record<string, number>)[k] = k === 'talkTimeDialed' || k === 'talkTimeIncoming' ? toSeconds(row[i]) : toNumber(row[i]);
      }
      for (const f of dimFields) { const i = idx.get(f.key)!; const v = row[i]; if (v != null && String(v).trim()) rec.dims[f.key] = String(v).trim(); }
      if (!employeeById.has(empId)) employeeById.set(empId, { id: empId, name: empId, manager: '', tags: [], team: '', status: '' });
      records.push(rec);
      if (!min || date < min) min = date;
      if (!max || date > max) max = date;
    }
  }
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.empId.localeCompare(b.empId)));
  const employees = [...employeeById.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    meta: payload.meta,
    fields,
    dims: payload.dims ?? [],
    employees,
    employeeById,
    records,
    available,
    dateRange: min && max ? { from: min, to: max } : null,
  };
}
