/**
 * Aggregation engine. Pure functions over DailyRecord[] — every page derives
 * its numbers from here so KPI cards, tables and charts always agree.
 */
import { METRICS, isMetricAvailable, talkTimeScore, type MetricKey } from '../config/metrics';
import type { BaseMetricKey, DailyRecord, Employee, Granularity } from '../types';
import { formatMonth, formatRange, monthStart, weekStart, weekday, addDays } from './dates';

export interface Totals {
  dialed: number;
  dialedConnected: number;
  talkTimeDialed: number;
  incoming: number;
  incomingConnected: number;
  talkTimeIncoming: number;
  notConnectedExplicit: number;
  activeDays: number;
  records: number;
  employees: number;
  /** duration bands, summed over records that have call-level data */
  band02: number;
  band24: number;
  band4p: number;
  /** number of records (employee-days) with band data, and the distinct dates covered */
  bandRecords: number;
  bandDates: string[];
  /** connected calls on those records (denominator for band shares) */
  bandConnected: number;
  /** talk time (seconds) inside each band */
  ttBand02: number;
  ttBand24: number;
  ttBand4p: number;
  /** unique connected numbers (per-day distinct, summed) and how many records carried it */
  uniqueConnected: number;
  uniqueRecords: number;
  uqBand02: number;
  uqBand24: number;
  uqBand4p: number;
  /** call-type counts over records with call-level data */
  logDialed: number;
  logIncoming: number;
  missed: number;
  rejected: number;
}

export type MetricValues = Partial<Record<MetricKey, number | null>>;

export function emptyTotals(): Totals {
  return { dialed: 0, dialedConnected: 0, talkTimeDialed: 0, incoming: 0, incomingConnected: 0, talkTimeIncoming: 0, notConnectedExplicit: 0, activeDays: 0, records: 0, employees: 0, band02: 0, band24: 0, band4p: 0, bandRecords: 0, bandDates: [], bandConnected: 0, ttBand02: 0, ttBand24: 0, ttBand4p: 0, uniqueConnected: 0, uniqueRecords: 0, uqBand02: 0, uqBand24: 0, uqBand4p: 0, logDialed: 0, logIncoming: 0, missed: 0, rejected: 0 };
}

export function sumRecords(records: Iterable<DailyRecord>): Totals {
  const t = emptyTotals();
  const days = new Set<string>();
  const emps = new Set<string>();
  const bandDays = new Set<string>();
  for (const r of records) {
    t.dialed += r.dialed;
    t.dialedConnected += r.dialedConnected;
    t.talkTimeDialed += r.talkTimeDialed;
    t.incoming += r.incoming;
    t.incomingConnected += r.incomingConnected;
    t.talkTimeIncoming += r.talkTimeIncoming;
    t.notConnectedExplicit += r.notConnected;
    if (r.band02 != null) {
      t.band02 += r.band02; t.band24 += r.band24 ?? 0; t.band4p += r.band4p ?? 0;
      t.bandRecords++; bandDays.add(r.date);
      t.bandConnected += r.dialedConnected + r.incomingConnected;
      t.ttBand02 += r.ttBand02 ?? 0; t.ttBand24 += r.ttBand24 ?? 0; t.ttBand4p += r.ttBand4p ?? 0;
      t.logDialed += r.dialed; t.logIncoming += r.incoming; t.missed += r.missed ?? 0; t.rejected += r.rejected ?? 0;
    }
    // Without call detail the helper's connected figure is already a distinct-number count, so it stands in.
    if (r.uniqueConnected != null) { t.uniqueConnected += r.uniqueConnected; t.uniqueRecords++; t.uqBand02 += r.uqBand02 ?? 0; t.uqBand24 += r.uqBand24 ?? 0; t.uqBand4p += r.uqBand4p ?? 0; }
    else t.uniqueConnected += r.dialedConnected + r.incomingConnected;
    t.records++;
    days.add(r.date);
    emps.add(r.empId);
  }
  t.activeDays = days.size;
  t.employees = emps.size;
  t.bandDates = [...bandDays].sort();
  return t;
}

function safeDiv(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

/** Derive every displayable metric from totals, honouring which base fields exist. */
export function deriveMetrics(t: Totals, available: Set<BaseMetricKey>): MetricValues {
  const has = (k: BaseMetricKey) => available.has(k);
  const totalCalls = (has('dialed') ? t.dialed : 0) + (has('incoming') ? t.incoming : 0);
  const connected = (has('dialedConnected') ? t.dialedConnected : 0) + (has('incomingConnected') ? t.incomingConnected : 0);
  const talkTime = (has('talkTimeDialed') ? t.talkTimeDialed : 0) + (has('talkTimeIncoming') ? t.talkTimeIncoming : 0);
  const canCalls = has('dialed') || has('incoming');
  const canConnected = has('dialedConnected') || has('incomingConnected');
  const canTalk = has('talkTimeDialed') || has('talkTimeIncoming');
  const notConnected = has('notConnected') && !canConnected ? t.notConnectedExplicit : canCalls && canConnected ? Math.max(0, totalCalls - connected) : null;
  const m: MetricValues = {};
  if (canCalls) m.totalCalls = totalCalls;
  if (has('dialed')) m.dialed = t.dialed;
  if (has('incoming')) m.incoming = t.incoming;
  if (canConnected) m.connected = connected;
  if (has('dialedConnected')) m.dialedConnected = t.dialedConnected;
  if (has('incomingConnected')) m.incomingConnected = t.incomingConnected;
  if (notConnected != null) m.notConnected = notConnected;
  if (canCalls && canConnected) m.connectionRate = safeDiv(connected, totalCalls);
  if (canTalk) m.talkTime = talkTime;
  if (canTalk && canConnected) m.avgTalkTime = safeDiv(talkTime, connected);
  if (canTalk) m.avgDailyTalkTime = safeDiv(talkTime, t.activeDays);
  if (canCalls) m.callsPerDay = safeDiv(totalCalls, t.activeDays);
  if (canCalls) m.activeDays = t.activeDays;
  // Call-log figures (duration bands, talk time per band, unique connected) are reported only when
  // EVERY employee-day in scope has call detail; partial coverage is shown as blank (null).
  const full = t.bandRecords > 0;
  const fullU = t.uniqueRecords > 0;
  if (has('band02')) { m.band02 = full ? t.band02 : null; m.band24 = full ? t.band24 : null; m.band4p = full ? t.band4p : null; }
  if (has('ttBand02')) { m.ttBand02 = full ? t.ttBand02 : null; m.ttBand24 = full ? t.ttBand24 : null; m.ttBand4p = full ? t.ttBand4p : null; }
  // Unique connected: distinct numbers per executive-day where call detail exists, the helper's
  // connected figure elsewhere (the UI notes the coverage); its split needs call detail.
  if (has('uniqueConnected') && canConnected) m.uniqueConnected = t.uniqueConnected;
  if (has('missed')) {
    m.outgoingCalls = full ? t.logDialed : null;
    m.incomingCalls = full ? Math.max(0, t.logIncoming - t.missed - t.rejected) : null;
    m.missed = full ? t.missed : null;
    m.rejected = full ? t.rejected : null;
  }
  if (has('uqBand02')) { m.uqBand02 = fullU ? t.uqBand02 : null; m.uqBand24 = fullU ? t.uqBand24 : null; m.uqBand4p = fullU ? t.uqBand4p : null; }
  return m;
}

/** Summary of the duration-band mix for a set of totals (null when no call-level day is in scope). */
export interface BandSummary {
  counts: { band02: number; band24: number; band4p: number };
  /** talk time per band (seconds) and its share of the banded talk time */
  talk: { band02: number; band24: number; band4p: number };
  talkTotal: number;
  talkShares: { band02: number; band24: number; band4p: number };
  total: number;
  shares: { band02: number; band24: number; band4p: number };
  days: string[];
  records: number;
}

export function bandSummary(t: Totals): BandSummary | null {
  if (!t.bandRecords) return null;
  const total = t.band02 + t.band24 + t.band4p;
  const share = (n: number) => (total > 0 ? n / total : 0);
  const talkTotal = t.ttBand02 + t.ttBand24 + t.ttBand4p;
  const tshare = (n: number) => (talkTotal > 0 ? n / talkTotal : 0);
  return {
    counts: { band02: t.band02, band24: t.band24, band4p: t.band4p },
    talk: { band02: t.ttBand02, band24: t.ttBand24, band4p: t.ttBand4p },
    talkTotal,
    talkShares: { band02: tshare(t.ttBand02), band24: tshare(t.ttBand24), band4p: tshare(t.ttBand4p) },
    total,
    shares: { band02: share(t.band02), band24: share(t.band24), band4p: share(t.band4p) },
    days: t.bandDates,
    records: t.bandRecords,
  };
}

/* ------------------------------------------------------------------ */
/* Per-employee statistics                                             */
/* ------------------------------------------------------------------ */

export interface DayPoint {
  date: string;
  totals: Totals;
  metrics: MetricValues;
}

export interface EmployeeStats {
  employee: Employee;
  totals: Totals;
  metrics: MetricValues;
  daily: DayPoint[];
  bestDay: DayPoint | null;
  lowestDay: DayPoint | null;
  /** 0-100, null when score cannot be computed */
  score: number | null;
  rank: number;
}

export function computeEmployeeStats(records: DailyRecord[], employees: Employee[], available: Set<BaseMetricKey>): EmployeeStats[] {
  const byEmp = new Map<string, DailyRecord[]>();
  for (const r of records) {
    let arr = byEmp.get(r.empId);
    if (!arr) { arr = []; byEmp.set(r.empId, arr); }
    arr.push(r);
  }
  const stats: EmployeeStats[] = employees.map((employee) => {
    const recs = byEmp.get(employee.id) ?? [];
    const totals = sumRecords(recs);
    const metrics = deriveMetrics(totals, available);
    const daily: DayPoint[] = recs.map((r) => {
      const t = sumRecords([r]);
      return { date: r.date, totals: t, metrics: deriveMetrics(t, available) };
    });
    let bestDay: DayPoint | null = null; let lowestDay: DayPoint | null = null;
    for (const d of daily) {
      const v = d.metrics.totalCalls ?? 0;
      if (!bestDay || v > (bestDay.metrics.totalCalls ?? 0)) bestDay = d;
      if (!lowestDay || v < (lowestDay.metrics.totalCalls ?? 0)) lowestDay = d;
    }
    return { employee, totals, metrics, daily, bestDay, lowestDay, score: null, rank: 0 };
  });
  assignScores(stats, available);
  return stats;
}

/**
 * Performance score (0-100): total talk time per active day as a share of the daily
 * target (2 h 45 m). 100 means the target is reached; the band is Excellent from there.
 * It depends only on the executive's own talk time, not on the rest of the team.
 */
export function assignScores(stats: EmployeeStats[], available: Set<BaseMetricKey>): void {
  if (!isMetricAvailable(METRICS.score, available)) { for (const s of stats) s.score = null; return; }
  for (const s of stats) {
    if (s.totals.activeDays === 0) { s.score = null; continue; }
    s.score = talkTimeScore(s.metrics.talkTime ?? 0, s.totals.activeDays);
    s.metrics.score = s.score;
  }
}

export function rankBy(stats: EmployeeStats[], key: MetricKey): EmployeeStats[] {
  const def = METRICS[key];
  const val = (s: EmployeeStats) => (key === 'score' ? s.score : s.metrics[key]) ?? null;
  const sorted = [...stats].sort((a, b) => {
    const va = val(a); const vb = val(b);
    if (va == null && vb == null) return a.employee.name.localeCompare(b.employee.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return def.higherIsBetter ? vb - va : va - vb;
  });
  sorted.forEach((s, i) => { s.rank = i + 1; });
  return sorted;
}

/* ------------------------------------------------------------------ */
/* Team-level statistics                                               */
/* ------------------------------------------------------------------ */

export interface TeamStats {
  totals: Totals;
  metrics: MetricValues;
  activeExecutives: number;
  avgCallsPerExecutive: number | null;
  avgConnectedPerExecutive: number | null;
  highest: { employee: Employee; calls: number } | null;
  /** team average per employee-day, for insights */
  avgCallsPerEmployeeDay: number | null;
}

export function computeTeamStats(records: DailyRecord[], stats: EmployeeStats[], available: Set<BaseMetricKey>): TeamStats {
  const totals = sumRecords(records);
  const metrics = deriveMetrics(totals, available);
  const active = stats.filter((s) => s.totals.activeDays > 0);
  let highest: TeamStats['highest'] = null;
  for (const s of active) {
    const v = s.metrics.totalCalls ?? 0;
    if (!highest || v > highest.calls) highest = { employee: s.employee, calls: v };
  }
  return {
    totals,
    metrics,
    activeExecutives: active.length,
    avgCallsPerExecutive: active.length ? (metrics.totalCalls ?? 0) / active.length : null,
    avgConnectedPerExecutive: active.length && metrics.connected != null ? metrics.connected / active.length : null,
    highest,
    avgCallsPerEmployeeDay: totals.records ? (metrics.totalCalls ?? 0) / totals.records : null,
  };
}

/* ------------------------------------------------------------------ */
/* Time series                                                         */
/* ------------------------------------------------------------------ */

export interface PeriodPoint {
  key: string;
  label: string;
  from: string;
  to: string;
  totals: Totals;
  metrics: MetricValues;
  topEmployee: { employee: Employee; calls: number } | null;
}

export function groupByPeriod(records: DailyRecord[], granularity: Granularity, available: Set<BaseMetricKey>, employeeById: Map<string, Employee>): PeriodPoint[] {
  const groups = new Map<string, DailyRecord[]>();
  for (const r of records) {
    const key = granularity === 'daily' ? r.date : granularity === 'weekly' ? weekStart(r.date) : monthStart(r.date);
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(r);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, recs]) => {
    const totals = sumRecords(recs);
    const metrics = deriveMetrics(totals, available);
    const perEmp = new Map<string, number>();
    for (const r of recs) perEmp.set(r.empId, (perEmp.get(r.empId) ?? 0) + r.dialed + r.incoming);
    let top: PeriodPoint['topEmployee'] = null;
    for (const [id, calls] of perEmp) if (!top || calls > top.calls) top = { employee: employeeById.get(id) ?? { id, name: id, manager: '', tags: [], team: '', status: '' }, calls };
    let from = key; let to = key; let label = key;
    if (granularity === 'weekly') { to = addDays(key, 6); label = `Wk of ${formatRange(from, to)}`; }
    else if (granularity === 'monthly') { to = recs.reduce((m, r) => (r.date > m ? r.date : m), key); label = formatMonth(key); }
    return { key, label, from, to, totals, metrics, topEmployee: top };
  });
}

/* ------------------------------------------------------------------ */
/* Day of week                                                         */
/* ------------------------------------------------------------------ */

export interface DowPoint {
  dow: number;
  days: number;
  totals: Totals;
  avgCalls: number | null;
  avgConnected: number | null;
  avgTalkTime: number | null;
  connectionRate: number | null;
}

export function computeDayOfWeek(records: DailyRecord[], available: Set<BaseMetricKey>): DowPoint[] {
  const buckets: DailyRecord[][] = [[], [], [], [], [], [], []];
  for (const r of records) buckets[weekday(r.date)].push(r);
  return buckets.map((recs, dow) => {
    const totals = sumRecords(recs);
    const m = deriveMetrics(totals, available);
    const days = totals.activeDays;
    return {
      dow, days, totals,
      avgCalls: days ? (m.totalCalls ?? 0) / days : null,
      avgConnected: days && m.connected != null ? m.connected / days : null,
      avgTalkTime: days && m.talkTime != null ? m.talkTime / days : null,
      connectionRate: m.connectionRate ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Period comparison                                                   */
/* ------------------------------------------------------------------ */

export interface TrendItem {
  key: MetricKey;
  current: number | null;
  previous: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  isRate: boolean;
  improved: boolean | null;
}

export function compareMetrics(cur: MetricValues, prev: MetricValues, keys: MetricKey[]): TrendItem[] {
  return keys.map((key) => {
    const def = METRICS[key];
    const c = cur[key] ?? null; const p = prev[key] ?? null;
    const isRate = def.format === 'percent';
    let deltaAbs: number | null = null; let deltaPct: number | null = null;
    if (c != null && p != null) {
      deltaAbs = c - p;
      deltaPct = p !== 0 ? (c - p) / Math.abs(p) : null;
    }
    const improved = deltaAbs == null || deltaAbs === 0 ? null : def.higherIsBetter ? deltaAbs > 0 : deltaAbs < 0;
    return { key, current: c, previous: p, deltaAbs, deltaPct, isRate, improved };
  });
}
