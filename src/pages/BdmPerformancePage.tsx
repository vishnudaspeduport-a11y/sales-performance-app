import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpDown, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../components/ui/Card';
import { TooltipFrame } from '../components/ui/ChartTooltip';
import { Badge, Select } from '../components/ui/Controls';
import { scoreBand, type MetricFormat } from '../config/metrics';
import { formatRange } from '../lib/dates';
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

type BdmKey = 'executives' | 'totalCalls' | 'connected' | 'connectionRate' | 'talkTime' | 'talkPerExecDay' | 'callsPerExecDay' | 'band4p' | 'effectiveRate' | 'score';

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
}

const COLUMNS: { key: BdmKey; label: string; format: MetricFormat; note: string; higherIsBetter: boolean }[] = [
  { key: 'executives', label: 'Executives', format: 'count', note: 'Executives with at least one call in the period', higherIsBetter: true },
  { key: 'totalCalls', label: 'Total Calls', format: 'count', note: 'Every call by the team', higherIsBetter: true },
  { key: 'connected', label: 'Total Connected', format: 'count', note: 'Calls with a duration above zero', higherIsBetter: true },
  { key: 'connectionRate', label: 'Connection Rate', format: 'percent', note: 'Connected ÷ total calls', higherIsBetter: true },
  { key: 'talkTime', label: 'Total Talk Time', format: 'seconds', note: 'Talk time of the whole team', higherIsBetter: true },
  { key: 'talkPerExecDay', label: 'Talk Time / Exec / Day', format: 'seconds', note: 'Total talk time ÷ executive-days worked; the target is 2 h 45 m', higherIsBetter: true },
  { key: 'callsPerExecDay', label: 'Calls / Exec / Day', format: 'decimal', note: 'Total calls ÷ executive-days worked', higherIsBetter: true },
  { key: 'band4p', label: 'Calls over 4 min', format: 'count', note: 'Connected calls longer than 4 minutes', higherIsBetter: true },
  { key: 'effectiveRate', label: 'Effective Calls %', format: 'percent', note: 'Calls over 4 minutes ÷ connected calls', higherIsBetter: true },
  { key: 'score', label: 'Performance Score', format: 'score', note: 'Average of the executives’ scores (talk time per active day against 2 h 45 m)', higherIsBetter: true },
];
const CHART_KEYS: BdmKey[] = ['talkPerExecDay', 'talkTime', 'totalCalls', 'connected', 'callsPerExecDay', 'connectionRate', 'effectiveRate', 'score'];

function valueOf(r: BdmRow, key: BdmKey): number | null {
  switch (key) {
    case 'executives': return r.executives;
    case 'talkPerExecDay': return r.talkPerExecDay;
    case 'callsPerExecDay': return r.callsPerExecDay;
    case 'score': return r.score;
    default: return r.metrics[key] ?? null;
  }
}

function avgScore(stats: EmployeeStats[]): number | null {
  const s = stats.map((x) => x.score).filter((x): x is number => x != null);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

function buildRows(a: Analytics): { rows: BdmRow[]; all: BdmRow } {
  const managerOf = (id: string) => a.dataset.employeeById.get(id)?.manager || UNASSIGNED;
  const group = <T,>(items: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of items) { const k = key(x); const arr = m.get(k); if (arr) arr.push(x); else m.set(k, [x]); } return m; };
  const recs = group<DailyRecord>(a.records, (r) => managerOf(r.empId));
  const prevRecs = group<DailyRecord>(a.prevRecords, (r) => managerOf(r.empId));
  const stats = group<EmployeeStats>(a.stats, (s) => s.employee.manager || UNASSIGNED);
  const prevStats = group<EmployeeStats>(a.prevStats, (s) => s.employee.manager || UNASSIGNED);
  const row = (manager: string, records: DailyRecord[], prevRecords: DailyRecord[], st: EmployeeStats[], pst: EmployeeStats[]): BdmRow => {
    const totals = sumRecords(records);
    const metrics = deriveMetrics(totals, a.dataset.available);
    const active = st.filter((s) => s.totals.activeDays > 0);
    const per = (v: number | null | undefined) => (v == null || !totals.records ? null : v / totals.records);
    return {
      manager, executives: active.length, headcount: st.filter((s) => s.totals.activeDays > 0 || a.recentIds.has(s.employee.id)).length, execDays: totals.records,
      metrics, prev: prevRecords.length ? deriveMetrics(sumRecords(prevRecords), a.dataset.available) : null,
      talkPerExecDay: per(metrics.talkTime), callsPerExecDay: per(metrics.totalCalls),
      score: avgScore(active), prevScore: avgScore(pst.filter((s) => s.totals.activeDays > 0)),
    };
  };
  const names = [...new Set([...recs.keys(), ...prevRecs.keys()])];
  const rows = names.map((m) => row(m, recs.get(m) ?? [], prevRecs.get(m) ?? [], stats.get(m) ?? [], prevStats.get(m) ?? [])).filter((r) => r.executives > 0 || r.prev);
  return { rows, all: row('All BDMs', a.records, a.prevRecords, a.stats, a.prevStats) };
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
function BdmCard({ r, has, onOpen }: { r: BdmRow; has: Analytics['has']; onOpen: () => void }) {
  const band = scoreBand(r.score);
  const figures: { key: BdmKey; label: string; format: MetricFormat }[] = [
    { key: 'totalCalls', label: 'Total Calls', format: 'count' },
    { key: 'connected', label: 'Connected', format: 'count' },
    { key: 'connectionRate', label: 'Conn. Rate', format: 'percent' },
    { key: 'talkTime', label: 'Talk Time', format: 'seconds' },
    { key: 'talkPerExecDay', label: 'Talk / Exec / Day', format: 'seconds' },
    { key: 'effectiveRate', label: 'Effective %', format: 'percent' },
  ];
  const prevOf = (key: BdmKey): number | null | undefined => (key === 'talkPerExecDay' || key === 'executives' || key === 'callsPerExecDay' || key === 'score' ? undefined : r.prev?.[key]);
  const shown = figures.filter((f) => f.key === 'talkPerExecDay' ? has('talkTime') : has(f.key as Parameters<Analytics['has']>[0]));
  return (
    <button type="button" onClick={onOpen} title={`Open ${r.manager}'s executives in Team Performance`} className="flex h-full flex-col rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-card transition hover:-translate-y-px hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink dark:text-ink-dark">{r.manager}</div>
          <div className="text-[11px] text-ink-muted">{formatNumber(r.executives)} of {formatNumber(Math.max(r.headcount, r.executives))} executives active</div>
        </div>
        {r.score != null && band && <span className="flex shrink-0 items-center gap-1.5"><span className="tabular text-sm font-semibold text-ink dark:text-ink-dark">{Math.round(r.score)}</span><Badge tone={band.tone}>{band.label}</Badge></span>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 border-t border-line pt-2.5 dark:border-line-dark">
        {shown.map((f) => (
          <div key={f.key} className="min-w-0 leading-tight">
            <div className="truncate text-[10px] uppercase tracking-wide text-ink-muted">{f.label}</div>
            <div className="tabular truncate text-sm font-semibold text-ink dark:text-ink-dark">{formatMetric(valueOf(r, f.key), f.format)}</div>
            <Delta cur={valueOf(r, f.key)} prev={prevOf(f.key)} format={f.format} />
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
  const [sort, setSort] = useState<{ key: BdmKey | 'manager'; dir: 'asc' | 'desc' }>({ key: 'talkPerExecDay', dir: 'desc' });
  const [chartKey, setChartKey] = useState<BdmKey>('talkPerExecDay');
  const { rows, all } = useMemo(() => buildRows(a), [a]);

  const available = (key: BdmKey) => key === 'executives' || (key === 'talkPerExecDay' ? a.has('talkTime') : key === 'callsPerExecDay' ? a.has('totalCalls') : a.has(key));
  const cols = COLUMNS.filter((c) => available(c.key));
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
  const toggle = (key: BdmKey | 'manager') => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'manager' ? 'asc' : 'desc' }));
  const chartKeys = CHART_KEYS.filter(available);
  const activeChartKey = chartKeys.includes(chartKey) ? chartKey : chartKeys[0];
  const chartCol = COLUMNS.find((c) => c.key === activeChartKey) ?? COLUMNS[0];
  const chartData = [...rows].map((r) => ({ manager: r.manager, value: valueOf(r, chartCol.key) })).filter((d) => d.value != null).sort((x, y) => (y.value as number) - (x.value as number));
  const best = (key: BdmKey) => { let b: BdmRow | null = null; for (const r of rows) { const v = valueOf(r, key); if (v == null) continue; if (!b || v > (valueOf(b, key) as number)) b = r; } return rows.length > 1 ? b?.manager : undefined; };
  const period = `${formatRange(a.range.from, a.range.to)}${a.prevTeam ? ` · change vs ${formatRange(a.prevRange.from, a.prevRange.to)}` : ''}`;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-ink-dark"><span aria-hidden className="h-3.5 w-1 rounded-full bg-accent dark:bg-accent-dark" />BDM overview</h2>
          <span className="text-xs text-ink-muted">{formatNumber(rows.length)} BDMs · {formatNumber(all.executives)} executives active · {period}</span>
        </div>
        <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((r) => <BdmCard key={r.manager} r={r} has={a.has} onOpen={() => open(r.manager)} />)}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-ink-muted">Each card is the total of the executives under that BDM. Click a card to open the team in Team Performance.</p>
      </div>

      <Card title="BDM comparison" subtitle="Totals of each BDM's executives · best value in each column in green · click a column to sort" bodyClassName="!px-0 !py-0">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                <th scope="col" className="w-10 px-2 py-1.5 text-right font-medium">#</th>
                <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-1.5 font-medium dark:bg-surface-dark">
                  <button type="button" onClick={() => toggle('manager')} className="inline-flex items-center gap-1 hover:text-ink dark:hover:text-ink-dark">BDM{sort.key === 'manager' ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}</button>
                </th>
                {cols.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-1.5 text-right font-medium" title={c.note}>
                    <button type="button" onClick={() => toggle(c.key)} className="inline-flex flex-row-reverse items-center gap-1 hover:text-ink dark:hover:text-ink-dark" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line bg-accent-soft/40 font-semibold dark:border-line-dark dark:bg-accent-soft-dark/30">
                <td className="px-2 py-1.5" />
                <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-2 py-1.5 text-ink dark:text-ink-dark">All BDMs</td>
                {cols.map((c) => <td key={c.key} className="tabular whitespace-nowrap px-2 py-1.5 text-right text-ink dark:text-ink-dark">{c.key === 'score' ? (all.score == null ? '–' : Math.round(all.score)) : formatMetric(valueOf(all, c.key), c.format)}</td>)}
              </tr>
              {sorted.map((r, i) => (
                <tr key={r.manager} className="border-b border-line last:border-0 hover:bg-plane/60 dark:border-line-dark dark:hover:bg-[#202020]">
                  <td className="tabular px-2 py-1.5 text-right text-ink-muted">{i + 1}</td>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1.5 dark:bg-surface-dark">
                    <button type="button" onClick={() => open(r.manager)} className="font-medium text-ink hover:text-accent hover:underline dark:text-ink-dark">{r.manager}</button>
                  </td>
                  {cols.map((c) => {
                    const v = valueOf(r, c.key);
                    const win = c.key !== 'executives' && best(c.key) === r.manager;
                    if (c.key === 'score') { const b = scoreBand(r.score); return <td key={c.key} className="whitespace-nowrap px-2 py-1.5 text-right">{r.score == null ? <span className="text-ink-muted">–</span> : <span className="inline-flex items-center gap-2"><span className="tabular font-medium">{Math.round(r.score)}</span>{b && <Badge tone={b.tone}>{b.label}</Badge>}</span>}</td>; }
                    return <td key={c.key} className={`tabular whitespace-nowrap px-2 py-1.5 text-right ${win ? 'font-semibold text-[#006300] dark:text-[#5fd35f]' : 'text-ink dark:text-ink-dark'}`}>{formatMetric(v, c.format)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-muted dark:border-line-dark">Teams differ in size, so compare BDMs on Talk Time / Exec / Day and the rates rather than on totals. An executive-day is one executive on one day with calls. Performance Score is the average of the executives' own scores.</p>
      </Card>

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
