import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BdmAverages } from '../components/BdmAverages';
import { TeamWiseReport } from '../components/TeamWiseReport';
import { Card } from '../components/ui/Card';
import { TooltipFrame } from '../components/ui/ChartTooltip';
import { Select } from '../components/ui/Controls';
import type { MetricFormat } from '../config/metrics';
import { attendanceCovers, type Attendance } from '../lib/attendance';
import { addDays, formatDate, formatRange } from '../lib/dates';
import { formatAxis, formatDelta, formatMetric, formatNumber } from '../lib/format';
import { deriveMetrics, sumRecords, type EmployeeStats, type MetricValues } from '../lib/metrics';
import { useFilters } from '../state/FilterContext';
import { useRouter } from '../state/router';
import { useTheme } from '../state/ThemeContext';
import type { Analytics } from '../state/useAnalytics';
import type { DailyRecord } from '../types';
import { PeriodEmpty } from './shared';

/**
 * BDM Performance: one line per manager, each the total of the executives reporting to them
 * in the selected period. Follows the filters at the top of the page (dates, status, manager).
 * Sizes differ between teams, so the per-executive-per-day figures sit beside the totals.
 */
const UNASSIGNED = '(Unassigned)';

type BdmKey = 'executives' | 'present' | 'avgCalls' | 'totalCalls' | 'connected' | 'connectionRate' | 'talkTime' | 'talkPerExecDay' | 'callsPerExecDay' | 'band02' | 'band24' | 'band4p' | 'effectiveRate' | 'score';

interface BdmRow {
  manager: string;
  /** executives with at least one call in the period, and everyone in scope under the manager */
  executives: number;
  headcount: number;
  /** executive-days worked (one per executive per day with calls) */
  execDays: number;
  metrics: MetricValues;
  prev: MetricValues | null;
  talkPerExecDay: number | null;
  callsPerExecDay: number | null;
  score: number | null;
  prevScore: number | null;
  /** executives marked present in icku attendance, counted per day and summed over the period; null without attendance */
  present: number | null;
  prevPresent: number | null;
  /** total calls ÷ present executives (per day when the period has several days) */
  avgCalls: number | null;
  prevAvgCalls: number | null;
}

const COLUMNS: { key: BdmKey; label: string; format: MetricFormat; note: string; higherIsBetter: boolean }[] = [
  { key: 'executives', label: 'Executives', format: 'count', note: 'Executives with at least one call in the period', higherIsBetter: true },
  { key: 'present', label: 'Present BDEs', format: 'count', note: 'Executives marked present, late or half day in icku attendance; counted per day and added up over the period', higherIsBetter: true },
  { key: 'totalCalls', label: 'Total Calls', format: 'count', note: 'Every call by the team', higherIsBetter: true },
  { key: 'avgCalls', label: 'Avg Calls / Present BDE', format: 'decimal', note: 'Total calls ÷ executives present that day (per day over a longer period)', higherIsBetter: true },
  { key: 'connected', label: 'Total Connected', format: 'count', note: 'Calls with a duration above zero', higherIsBetter: true },
  { key: 'connectionRate', label: 'Connection Rate', format: 'percent', note: 'Connected ÷ total calls', higherIsBetter: true },
  { key: 'talkTime', label: 'Total Talk Time', format: 'seconds', note: 'Talk time of the whole team', higherIsBetter: true },
  { key: 'talkPerExecDay', label: 'Talk Time / Exec / Day', format: 'seconds', note: 'Total talk time ÷ executive-days worked; the target is 2 h 45 m', higherIsBetter: true },
  { key: 'callsPerExecDay', label: 'Calls / Exec / Day', format: 'decimal', note: 'Total calls ÷ executive-days worked', higherIsBetter: true },
  { key: 'band02', label: 'Calls 0–2 min', format: 'count', note: 'Connected calls lasting up to 2 minutes', higherIsBetter: true },
  { key: 'band24', label: 'Calls 2–4 min', format: 'count', note: 'Connected calls lasting between 2 and 4 minutes', higherIsBetter: true },
  { key: 'band4p', label: 'Calls over 4 min', format: 'count', note: 'Connected calls longer than 4 minutes', higherIsBetter: true },
  { key: 'effectiveRate', label: 'Effective Calls %', format: 'percent', note: 'Calls over 4 minutes ÷ connected calls', higherIsBetter: true },
  { key: 'score', label: 'Performance Score', format: 'score', note: 'Average of the executives’ scores (talk time per active day against 2 h 45 m)', higherIsBetter: true },
];
const CHART_KEYS: BdmKey[] = ['avgCalls', 'talkPerExecDay', 'talkTime', 'totalCalls', 'connected', 'callsPerExecDay', 'connectionRate', 'effectiveRate', 'score'];

function valueOf(r: BdmRow, key: BdmKey): number | null {
  switch (key) {
    case 'executives': return r.executives;
    case 'present': return r.present;
    case 'avgCalls': return r.avgCalls;
    case 'talkPerExecDay': return r.talkPerExecDay;
    case 'callsPerExecDay': return r.callsPerExecDay;
    case 'score': return r.score;
    default: return r.metrics[key] ?? null;
  }
}

function prevValueOf(r: BdmRow, key: BdmKey): number | null | undefined {
  switch (key) {
    case 'present': return r.prevPresent;
    case 'avgCalls': return r.prevAvgCalls;
    case 'score': return r.prevScore;
    case 'executives': case 'talkPerExecDay': case 'callsPerExecDay': return undefined;
    default: return r.prev?.[key];
  }
}

/** Present executives per manager over a range: one for each executive on each day they were marked present. */
function presentByManager(a: Analytics, att: Attendance | null, range: { from: string; to: string }, managerOf: (id: string) => string): Map<string, number> | null {
  if (!att || !attendanceCovers(att, range)) return null;
  const scoped = new Set(a.employees.map((e) => e.id));
  const only = a.filters.employees.length ? new Set(a.filters.employees) : null;
  const out = new Map<string, number>();
  let guard = 0;
  for (let d = range.from; d <= range.to && guard < 1000; d = addDays(d, 1), guard++) {
    const ids = att.present.get(d);
    if (!ids) continue;
    for (const id of ids) {
      if (only && !only.has(id)) continue;
      // someone the filters above leave out (status, team) is left out here too
      if (a.dataset.employeeById.has(id) && !scoped.has(id)) continue;
      const m = managerOf(id);
      out.set(m, (out.get(m) ?? 0) + 1);
    }
  }
  return out;
}

function avgScore(stats: EmployeeStats[]): number | null {
  const s = stats.map((x) => x.score).filter((x): x is number => x != null);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

function buildRows(a: Analytics): { rows: BdmRow[]; all: BdmRow } {
  const dirManager = new Map(a.dataset.directory.map((d) => [d.empNo, d.managerName]));
  const managerOf = (id: string) => a.dataset.employeeById.get(id)?.manager || dirManager.get(id) || UNASSIGNED;
  const present = presentByManager(a, a.dataset.attendance, a.range, managerOf);
  const prevPresent = presentByManager(a, a.dataset.attendance, a.prevRange, managerOf);
  const group = <T,>(items: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of items) { const k = key(x); const arr = m.get(k); if (arr) arr.push(x); else m.set(k, [x]); } return m; };
  const recs = group<DailyRecord>(a.records, (r) => managerOf(r.empId));
  const prevRecs = group<DailyRecord>(a.prevRecords, (r) => managerOf(r.empId));
  const stats = group<EmployeeStats>(a.stats, (s) => s.employee.manager || UNASSIGNED);
  const prevStats = group<EmployeeStats>(a.prevStats, (s) => s.employee.manager || UNASSIGNED);
  const row = (manager: string, records: DailyRecord[], prevRecords: DailyRecord[], st: EmployeeStats[], pst: EmployeeStats[], pres: number | null, prevPres: number | null): BdmRow => {
    const totals = sumRecords(records);
    const metrics = deriveMetrics(totals, a.dataset.available);
    const prevMetrics = prevRecords.length ? deriveMetrics(sumRecords(prevRecords), a.dataset.available) : null;
    const avg = (calls: number | null | undefined, n: number | null) => (calls == null || !n ? null : calls / n);
    const active = st.filter((s) => s.totals.activeDays > 0);
    const per = (v: number | null | undefined) => (v == null || !totals.records ? null : v / totals.records);
    return {
      manager, executives: active.length, headcount: st.filter((s) => s.totals.activeDays > 0 || a.recentIds.has(s.employee.id)).length, execDays: totals.records,
      metrics, prev: prevMetrics,
      present: pres, prevPresent: prevPres, avgCalls: avg(metrics.totalCalls, pres), prevAvgCalls: avg(prevMetrics?.totalCalls, prevPres),
      talkPerExecDay: per(metrics.talkTime), callsPerExecDay: per(metrics.totalCalls),
      score: avgScore(active), prevScore: avgScore(pst.filter((s) => s.totals.activeDays > 0)),
    };
  };
  const names = [...new Set([...recs.keys(), ...prevRecs.keys()])];
  const rows = names.map((m) => row(m, recs.get(m) ?? [], prevRecs.get(m) ?? [], stats.get(m) ?? [], prevStats.get(m) ?? [], present ? present.get(m) ?? 0 : null, prevPresent ? prevPresent.get(m) ?? 0 : null)).filter((r) => r.executives > 0 || r.prev);
  // The total counts the present executives of the BDMs listed, so it matches the rows under it.
  const sum = (k: 'present' | 'prevPresent') => (rows.some((r) => r[k] != null) ? rows.reduce((n, r) => n + (r[k] ?? 0), 0) : null);
  return { rows, all: row('All BDMs', a.records, a.prevRecords, a.stats, a.prevStats, sum('present'), sum('prevPresent')) };
}

function Delta({ cur, prev, format, higherIsBetter = true }: { cur: number | null | undefined; prev: number | null | undefined; format: MetricFormat; higherIsBetter?: boolean }) {
  if (cur == null || prev == null) return null;
  const abs = cur - prev;
  if (abs === 0) return null;
  const pct = prev !== 0 ? abs / Math.abs(prev) : null;
  const improved = higherIsBetter ? abs > 0 : abs < 0;
  const Icon = abs > 0 ? ArrowUpRight : ArrowDownRight;
  const text = format === 'score' ? `${abs > 0 ? '+' : '−'}${Math.abs(Math.round(abs))} pts` : formatDelta(pct, format === 'percent', abs);
  return <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[10px] font-medium ${improved ? 'text-[#006300] dark:text-[#5fd35f]' : 'text-[#8f1f1f] dark:text-[#f08c8c]'}`}><Icon className="h-3 w-3" aria-hidden />{text}</span>;
}

/** One manager as a card: the headline figures with their change against the previous period. */
function BdmCard({ r, has, onOpen, multiDay, attendanceFrom }: { r: BdmRow; has: Analytics['has']; onOpen: () => void; multiDay: boolean; attendanceFrom: string | null }) {
  const figures: { key: BdmKey; label: string; format: MetricFormat }[] = [
    { key: 'present', label: multiDay ? 'Present BDE-days' : 'Present BDEs', format: 'count' },
    { key: 'totalCalls', label: 'Total Calls', format: 'count' },
    { key: 'avgCalls', label: multiDay ? 'Avg Calls / BDE / Day' : 'Avg Calls / BDE', format: 'decimal' },
    { key: 'connected', label: 'Connected', format: 'count' },
    { key: 'connectionRate', label: 'Conn. Rate', format: 'percent' },
    { key: 'talkTime', label: 'Talk Time', format: 'seconds' },
    { key: 'talkPerExecDay', label: 'Talk / Exec / Day', format: 'seconds' },
    { key: 'effectiveRate', label: 'Effective %', format: 'percent' },
  ];
  const shown = figures.filter((f) => f.key === 'present' ? true : f.key === 'avgCalls' ? has('totalCalls') : f.key === 'talkPerExecDay' ? has('talkTime') : has(f.key as Parameters<Analytics['has']>[0]));
  const sub = r.present == null
    ? `${formatNumber(r.executives)} executives made calls · attendance ${attendanceFrom ? `starts ${formatDate(attendanceFrom)}` : 'not connected'}`
    : multiDay ? `${formatNumber(r.executives)} executives made calls` : `${formatNumber(r.present)} present · ${formatNumber(r.executives)} made calls`;
  return (
    <button type="button" onClick={onOpen} title={`Open ${r.manager}'s executives in Team Performance`} className="flex h-full flex-col rounded-2xl border border-line/70 bg-surface px-4 py-3 text-left shadow-card transition hover:-translate-y-px hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink dark:text-ink-dark">{r.manager}</div>
          <div className="truncate text-[11px] text-ink-muted">{sub}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-line pt-2.5 min-[420px]:grid-cols-4 dark:border-line-dark">
        {shown.map((f) => (
          <div key={f.key} className="min-w-0 leading-tight">
            <div className="truncate text-[10px] uppercase tracking-wide text-ink-muted" title={f.label}>{f.label}</div>
            <div className="tabular truncate text-sm font-semibold text-ink dark:text-ink-dark">{formatMetric(valueOf(r, f.key), f.format)}</div>
            <Delta cur={valueOf(r, f.key)} prev={prevValueOf(r, f.key)} format={f.format} />
          </div>
        ))}
      </div>
    </button>
  );
}

export function BdmPerformancePage({ a }: { a: Analytics }) {
  const { chart } = useTheme();
  const { setDim } = useFilters();
  const { navigate } = useRouter();
  // The cards are ordered by talk time per executive per day, the figure the score follows.
  const sort: { key: BdmKey | 'manager'; dir: 'asc' | 'desc' } = { key: 'talkPerExecDay', dir: 'desc' };
  const [chartKey, setChartKey] = useState<BdmKey>('talkPerExecDay');
  const { rows, all } = useMemo(() => buildRows(a), [a]);

  const att = a.dataset.attendance;
  const multiDay = a.range.from !== a.range.to;
  const available = (key: BdmKey) => key === 'executives' || (key === 'present' ? !!att : key === 'avgCalls' ? !!att && a.has('totalCalls') : key === 'talkPerExecDay' ? a.has('talkTime') : key === 'callsPerExecDay' ? a.has('totalCalls') : a.has(key));
  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((x, y) => {
      if (sort.key === 'manager') return sort.dir === 'asc' ? x.manager.localeCompare(y.manager) : y.manager.localeCompare(x.manager);
      const vx = valueOf(x, sort.key); const vy = valueOf(y, sort.key);
      if (vx == null && vy == null) return x.manager.localeCompare(y.manager);
      if (vx == null) return 1;
      if (vy == null) return -1;
      return sort.dir === 'asc' ? vx - vy : vy - vx;
    });
    return list;
  }, [rows, sort]);

  if (a.empty) return <PeriodEmpty a={a} />;

  const open = (manager: string) => { if (manager !== UNASSIGNED) setDim('manager', [manager]); navigate('team'); };
  const chartKeys = CHART_KEYS.filter(available);
  const activeChartKey = chartKeys.includes(chartKey) ? chartKey : chartKeys[0];
  const chartCol = COLUMNS.find((c) => c.key === activeChartKey) ?? COLUMNS[0];
  const chartData = [...rows].map((r) => ({ manager: r.manager, value: valueOf(r, chartCol.key) })).filter((d) => d.value != null).sort((x, y) => (y.value as number) - (x.value as number));
  const period = `${formatRange(a.range.from, a.range.to)}${a.prevTeam ? ` · change vs ${formatRange(a.prevRange.from, a.prevRange.to)}` : ''}`;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-ink-dark"><span aria-hidden className="h-3.5 w-1 rounded-full bg-accent dark:bg-accent-dark" />BDM overview</h2>
          <span className="text-xs text-ink-muted">{formatNumber(rows.length)} BDMs · {formatNumber(all.executives)} executives active · {period}</span>
        </div>
        <div className="grid auto-rows-fr gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {sorted.map((r) => <BdmCard key={r.manager} r={r} has={a.has} onOpen={() => open(r.manager)} multiDay={multiDay} attendanceFrom={att?.firstDay ?? null} />)}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-ink-muted">Each card is the total of the executives under that BDM. Average calls is total calls divided by the executives marked present in icku attendance (present, late or half day){multiDay ? ', counted per day' : ''}.{att && !attendanceCovers(att, a.range) && att.firstDay ? ` Attendance starts ${formatDate(att.firstDay)}, so periods from before that show no average.` : ''} Click a card to open the team in Team Performance.</p>
      </div>

      <BdmAverages a={a} onOpen={open} />

      <TeamWiseReport a={a} />

      {chartData.length > 0 && (
        <Card title={`${chartCol.label} by BDM`} subtitle={`${chartCol.note} · ${formatRange(a.range.from, a.range.to)}`} actions={<Select ariaLabel="Figure to chart" value={activeChartKey} onChange={setChartKey} options={chartKeys.map((k) => ({ value: k, label: COLUMNS.find((c) => c.key === k)?.label ?? k }))} className="w-56" />}>
          <div style={{ height: Math.max(160, chartData.length * 34 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 72, left: 8, bottom: 0 }} barCategoryGap={8}>
                <CartesianGrid stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: chart.inkMuted, fontSize: 11 }} tickFormatter={(v: number) => formatAxis(v, chartCol.format)} domain={[0, chartCol.format === 'score' ? 100 : 'auto']} />
                <YAxis type="category" dataKey="manager" tickLine={false} axisLine={{ stroke: chart.axis }} width={150} tick={{ fill: chart.ink, fontSize: 12 }} />
                <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => active && payload?.length ? <TooltipFrame title={String(payload[0].payload.manager)} rows={[{ label: chartCol.label, value: formatMetric(payload[0].value as number, chartCol.format), color: chart.series[0] }]} /> : null} />
                <Bar dataKey="value" fill={chart.series[0]} radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList dataKey="value" position="right" formatter={(v: number) => formatMetric(v, chartCol.format)} style={{ fill: chart.ink, fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
