import { BASE_METRIC_KEYS, CALL_LOG_ONLY_KEYS, type BaseMetricKey, type DailyRecord, type Dataset, type Employee, type Payload, type PendingPayload, type PendingSnapshot, type DirectoryEntry, type DirectoryPayload, type UniqueCounts, type UniquePayload, type CutoffPayload, type CutoffStats } from '../types';
import { parseAttendance } from './attendance';
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
    employeeById.set(e.id, { id: e.id, name: e.name || e.id, manager: e.manager || '', tags: Array.isArray(e.tags) ? e.tags : [], team: e.team || '', status: e.status || '', title: e.title || '', department: e.department || '', location: e.location || '', joinedOn: e.joinedOn || '', mappingSource: e.mappingSource === 'directory' || e.mappingSource === 'sheet' ? e.mappingSource : e.manager ? 'sheet' : 'none' });
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
        band02: null, band24: null, band4p: null, ttBand02: null, ttBand24: null, ttBand4p: null, uniqueConnected: null, uqBand02: null, uqBand24: null, uqBand4p: null, missed: null, rejected: null,
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
  const directory = parseDirectory(payload.directory);
  return {
    meta: { ...payload.meta, directoryAsOf: payload.directory?.asOf ?? payload.meta.directoryAsOf },
    fields,
    dims: payload.dims ?? [],
    employees,
    employeeById,
    records,
    available,
    dateRange: min && max ? { from: min, to: max } : null,
    pending: parsePending(payload.pending),
    directory,
    attendance: parseAttendance(payload.attendance),
    unique: parseUnique(payload.unique),
    cutoff: parseCutoff(payload.cutoff),
  };
}

function parseUnique(u: UniquePayload | null | undefined): UniqueCounts | null {
  if (!u || !Array.isArray(u.dates) || !Array.isArray(u.rows) || !u.dates.length) return null;
  const dates = u.dates.map(String).filter(isIsoDate);
  if (dates.length !== u.dates.length) return null;
  const counts = new Map<string, [number, number, number, number]>();
  for (const t of u.rows) {
    if (!Array.isArray(t) || t.length < 6) continue;
    const date = dates[Number(t[0])];
    if (!date || !t[1]) continue;
    counts.set(`${date}|${String(t[1])}`, [toNumber(t[2]), toNumber(t[3]), toNumber(t[4]), toNumber(t[5])]);
  }
  return { dates: new Set(dates), first: [...dates].sort()[0] ?? null, counts };
}

function parseCutoff(c: CutoffPayload | null | undefined): CutoffStats | null {
  if (!c || !Array.isArray(c.dates) || !Array.isArray(c.rows) || !c.dates.length) return null;
  const dates = c.dates.map(String);
  if (!dates.every(isIsoDate)) return null;
  const byKey = new Map<string, [number, number]>();
  for (const t of c.rows) {
    if (!Array.isArray(t) || t.length < 4) continue;
    const date = dates[Number(t[0])];
    if (!date || !t[1]) continue;
    byKey.set(`${date}|${String(t[1])}`, [toNumber(t[2]), toNumber(t[3])]);
  }
  return { at: String(c.at ?? '16:00'), longSeconds: toNumber(c.longSeconds) || 180, dates: new Set(dates), byKey };
}

function parseDirectory(d: DirectoryPayload | null | undefined): DirectoryEntry[] {
  if (!d || !Array.isArray(d.rows)) return [];
  return d.rows.flatMap((t) => {
    if (!Array.isArray(t) || t.length < 8) return [];
    const s = (v: unknown) => String(v ?? '');
    return [{ empNo: s(t[0]), name: s(t[1]), title: s(t[2]), department: s(t[3]), location: s(t[4]), managerEmpNo: s(t[5]), managerName: s(t[6]), status: s(t[7]), joinedOn: s(t[8]), exitDate: s(t[9]) }];
  });
}

/**
 * Salesforce roles that are not executive teams: the sales managers' own roles and the system
 * administrator. Their few tasks are left out of Pending Tasks; each manager's team is listed
 * under its own "Executive-Team" role.
 */
const NOT_A_TEAM = /^\s*(sales[\s_-]*manager\b|system[\s_-]*administrator\s*$)/i;

function parsePending(p: PendingPayload | null | undefined): PendingSnapshot | null {
  if (!p || !Array.isArray(p.rows) || !isIsoDate(p.date)) return null;
  let leftOut = 0;
  const rows = p.rows.flatMap((t) => {
    if (!Array.isArray(t) || t.length < 6) return [];
    // 7-tuple [source, team, owner, subject, bucket, kind, count]; older 6-tuples carry only rule-passing tasks
    const [source, team, owner, subject, bucket, kindOrCount, maybeCount] = t;
    const kind = t.length >= 7 ? String(kindOrCount) : 'owner';
    const count = t.length >= 7 ? maybeCount : kindOrCount;
    if (NOT_A_TEAM.test(String(team ?? ''))) { if (bucket !== 'upcoming') leftOut += toNumber(count); return []; }
    if ((source !== 'IC' && source !== 'LM') || !['today', 'overdue', 'upcoming'].includes(String(bucket)) || !['owner', 'other', 'unknown', 'resigned'].includes(kind)) return [];
    return [{ source: source as 'IC' | 'LM', team: String(team ?? ''), owner: String(owner ?? ''), subject: String(subject ?? ''), bucket: bucket as 'today' | 'overdue' | 'upcoming', kind: kind as 'owner' | 'other' | 'unknown' | 'resigned', count: toNumber(count) }];
  });
  const history = (p.history ?? []).filter((h) => h && isIsoDate(h.date) && !NOT_A_TEAM.test(String(h.team ?? ''))).map((h) => ({ date: String(h.date).slice(0, 10), team: String(h.team ?? ''), icToday: toNumber(h.ic_today), icOverdue: toNumber(h.ic_overdue), lmToday: toNumber(h.lm_today), lmOverdue: toNumber(h.lm_overdue), icTodayOwner: toNumber(h.ic_today_owner ?? h.ic_today), icOverdueOwner: toNumber(h.ic_overdue_owner ?? h.ic_overdue), lmTodayOwner: toNumber(h.lm_today_owner ?? h.lm_today), lmOverdueOwner: toNumber(h.lm_overdue_owner ?? h.lm_overdue), bdes: toNumber(h.bdes) }));
  const users = (Array.isArray(p.users) ? p.users : []).flatMap((u) => (Array.isArray(u) && u.length >= 3 ? [{ empNo: String(u[0] ?? ''), name: String(u[1] ?? ''), role: String(u[2] ?? '') }] : []));
  return { date: p.date, asOf: p.asOf ?? null, origin: p.origin === 'salesforce' ? 'salesforce' : 'sheet', subjects: Array.isArray(p.subjects) ? p.subjects.map(String) : [], rows, users, history, notes: [...(Array.isArray(p.notes) ? p.notes.map(String) : []), ...(leftOut ? [`${leftOut.toLocaleString('en-IN')} task(s) under the sales managers' own roles and the system administrator are left out; only the executive teams are listed.`] : [])] };
}
