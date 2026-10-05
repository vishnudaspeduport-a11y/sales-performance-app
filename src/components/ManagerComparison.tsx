import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricKey } from '../config/metrics';
import { formatRange, isIsoDate, presetRange } from '../lib/dates';
import { formatAxis, formatDuration, formatMetric, formatNumber, formatPercent } from '../lib/format';
import { computeTeamStats, sumRecords, type EmployeeStats } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { computeRangeStats, type Analytics } from '../state/useAnalytics';
import type { DatePreset, Employee } from '../types';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Button, MultiSelect, Select } from './ui/Controls';
import { EmptyState } from './ui/States';

const MAX = 5;
type PeriodPreset = 'dashboard' | 'last7' | 'last30' | 'thisMonth' | 'prevMonth' | 'all' | 'custom';
const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: 'dashboard', label: 'Same as the filters above' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'prevMonth', label: 'Previous month' },
  { value: 'all', label: 'All data' },
  { value: 'custom', label: 'Custom dates' },
];

interface ManagerRow {
  manager: string;
  executives: number;
  activeDays: number;
  totalCalls: number | null;
  connected: number | null;
  uniqueConnected: number | null;
  talkTime: number | null;
  callsPerExec: number | null;
  callsPerExecDay: number | null;
  connectedPerExec: number | null;
  uniquePerExec: number | null;
  talkPerExec: number | null;
  connectionRate: number | null;
  avgTalkTime: number | null;
  avgScore: number | null;
}

type Fmt = 'count' | 'decimal' | 'percent' | 'seconds' | 'score';
const ROWS: { key: keyof ManagerRow; label: string; fmt: Fmt; higherIsBetter: boolean; note?: string; requires?: MetricKey }[] = [
  { key: 'executives', label: 'Active executives', fmt: 'count', higherIsBetter: true, note: 'with at least one call in the period' },
  { key: 'totalCalls', label: 'Total calls', fmt: 'count', higherIsBetter: true, note: 'whole team', requires: 'totalCalls' },
  { key: 'callsPerExec', label: 'Calls per executive', fmt: 'decimal', higherIsBetter: true, note: 'total calls ÷ active executives', requires: 'totalCalls' },
  { key: 'callsPerExecDay', label: 'Calls per executive per day', fmt: 'decimal', higherIsBetter: true, note: 'total calls ÷ executive-days worked', requires: 'totalCalls' },
  { key: 'connectedPerExec', label: 'Connected per executive', fmt: 'decimal', higherIsBetter: true, requires: 'connected' },
  { key: 'uniquePerExec', label: 'Unique connected per executive', fmt: 'decimal', higherIsBetter: true, requires: 'uniqueConnected' },
  { key: 'connectionRate', label: 'Connection rate', fmt: 'percent', higherIsBetter: true, note: 'connected ÷ total calls', requires: 'connectionRate' },
  { key: 'talkPerExec', label: 'Talk time per executive', fmt: 'seconds', higherIsBetter: true, requires: 'talkTime' },
  { key: 'avgTalkTime', label: 'Average talk time per call', fmt: 'seconds', higherIsBetter: true, requires: 'avgTalkTime' },
  { key: 'avgScore', label: 'Average performance score', fmt: 'score', higherIsBetter: true, note: 'scores computed across all selected teams together', requires: 'score' },
];
const PANELS: (keyof ManagerRow)[] = ['callsPerExec', 'connectedPerExec', 'uniquePerExec', 'connectionRate', 'talkPerExec', 'avgScore'];

function fmt(v: number | null, f: Fmt): string {
  if (v == null || !isFinite(v)) return '–';
  switch (f) {
    case 'decimal': return formatNumber(v, 1);
    case 'percent': return formatPercent(v);
    case 'seconds': return formatDuration(v);
    case 'score': return `${Math.round(v)}`;
    default: return formatNumber(v);
  }
}

/** Managers compared on per-executive averages, so team size does not decide the winner. */
export function ManagerComparison({ a }: { a: Analytics }) {
  const { chart } = useTheme();
  const [selected, setSelected] = useState<string[]>([]);
  const [preset, setPreset] = useState<PeriodPreset>('dashboard');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: a.range.from, to: a.range.to });
  const period = useMemo(() => {
    if (preset === 'dashboard') return a.range;
    if (preset === 'custom') return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
    return presetRange(preset as DatePreset, a.dataset.dateRange);
  }, [preset, custom, a.range, a.dataset.dateRange]);
  useEffect(() => { if (preset === 'dashboard') setCustom({ from: a.range.from, to: a.range.to }); }, [a.range.from, a.range.to, preset]);
  const setCustomDate = (k: 'from' | 'to', v: string) => { if (isIsoDate(v) && v >= '2000-01-01') { setCustom((c) => ({ ...c, [k]: v })); setPreset('custom'); } };
  const dateCls = 'h-9 w-40 shrink-0 rounded-lg border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';

  const managers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of a.dataset.employees) if (e.manager) counts.set(e.manager, (counts.get(e.manager) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([m, n]) => ({ value: m, label: m, hint: `${n} executives` }));
  }, [a.dataset.employees]);

  const rows = useMemo<ManagerRow[]>(() => {
    if (selected.length < 2) return [];
    const employees: Employee[] = a.dataset.employees.filter((e) => selected.includes(e.manager));
    // One computation over all selected teams so performance scores share the same scale.
    const union = computeRangeStats(a.dataset, { ...a.filters, employees: [], dims: {} }, period, employees);
    return selected.map((manager) => {
      const ids = new Set(employees.filter((e) => e.manager === manager).map((e) => e.id));
      const stats: EmployeeStats[] = union.stats.filter((s) => ids.has(s.employee.id));
      const records = union.records.filter((r) => ids.has(r.empId));
      const team = computeTeamStats(records, stats, a.dataset.available);
      const totals = sumRecords(records);
      const active = stats.filter((s) => s.totals.activeDays > 0);
      const n = active.length;
      const execDays = totals.records;
      const m = team.metrics;
      const scores = active.map((s) => s.score).filter((s): s is number => s != null);
      const per = (v: number | null | undefined) => (v == null || !n ? null : v / n);
      return {
        manager, executives: n, activeDays: totals.activeDays,
        totalCalls: m.totalCalls ?? null, connected: m.connected ?? null, uniqueConnected: m.uniqueConnected ?? null, talkTime: m.talkTime ?? null,
        callsPerExec: per(m.totalCalls), callsPerExecDay: m.totalCalls != null && execDays ? m.totalCalls / execDays : null,
        connectedPerExec: per(m.connected), uniquePerExec: per(m.uniqueConnected), talkPerExec: per(m.talkTime),
        connectionRate: m.connectionRate ?? null, avgTalkTime: m.avgTalkTime ?? null,
        avgScore: scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null,
      };
    });
  }, [selected, a.dataset, a.filters, period]);

  const visibleRows = ROWS.filter((r) => !r.requires || a.has(r.requires));
  const best = (key: keyof ManagerRow, higher: boolean) => {
    let b: ManagerRow | null = null;
    for (const r of rows) { const v = r[key] as number | null; if (v == null) continue; const bv = b ? (b[key] as number) : null; if (bv == null || (higher ? v > bv : v < bv)) b = r; }
    return b?.manager;
  };
  const quickTop = () => setSelected(managers.slice(0, 2).map((m) => m.value));

  return (
    <div className="space-y-4">
      <Card title="Compare Managers" subtitle={`Select 2 to ${MAX} managers · everyone under each manager, ${formatRange(period.from, period.to)} · averages per executive so team size does not matter`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-6">
          <div>
            <div className="mb-1 text-xs font-medium text-ink-muted">Managers</div>
            <div className="flex items-center gap-2">
              <MultiSelect label="Managers" placeholder="Choose managers" options={managers} selected={selected} onChange={setSelected} max={MAX} className="w-full sm:w-72" />
              {selected.length === 0 && managers.length >= 2 && <Button size="sm" variant="ghost" onClick={quickTop}>First two</Button>}
              {selected.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-muted">Period</div>
            <div className="flex flex-wrap items-center gap-2">
              <Select ariaLabel="Comparison period" value={preset} onChange={setPreset} options={PERIODS} className="w-52 shrink-0" />
              <div className="flex items-center gap-2">
                <input type="date" aria-label="Period from" value={period.from} onChange={(e) => setCustomDate('from', e.target.value)} className={dateCls} />
                <span className="text-xs text-ink-muted">to</span>
                <input type="date" aria-label="Period to" value={period.to} onChange={(e) => setCustomDate('to', e.target.value)} className={dateCls} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {rows.length < 2 ? (
        <div className="rounded-xl border border-line bg-surface shadow-card dark:border-line-dark dark:bg-surface-dark">
          <EmptyState title={selected.length === 0 ? 'Choose managers to compare' : 'Choose at least one more manager'} message="Pick between two and five managers. The Manager filter at the top does not limit this list." />
        </div>
      ) : (
        <>
          <Card title="Side-by-side" subtitle="Best value in each row is highlighted · per-executive figures divide by the executives who had at least one call" bodyClassName="!px-0 !py-0">
            <div className="overflow-x-auto">
              <table className="zebra w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                    <th className="px-4 py-2 font-medium">Metric</th>
                    {rows.map((r, i) => <th key={r.manager} className="px-4 py-2 text-right font-medium"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: chart.series[i % chart.series.length] }} />{r.manager}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const winner = best(row.key, row.higherIsBetter);
                    return (
                      <tr key={row.key} className="border-b border-line last:border-0 dark:border-line-dark">
                        <td className="px-4 py-2"><div className="text-ink dark:text-ink-dark">{row.label}</div>{row.note && <div className="text-[11px] text-ink-muted">{row.note}</div>}</td>
                        {rows.map((r) => (
                          <td key={r.manager} className={`tabular px-4 py-2 text-right ${r.manager === winner && rows.length > 1 ? 'font-semibold text-[#006300] dark:text-[#5fd35f]' : 'text-ink dark:text-ink-dark'}`}>{fmt(r[row.key] as number | null, row.fmt)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Per-executive averages" subtitle="Each panel has its own scale · colours identify the manager consistently">
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {PANELS.map((key) => ROWS.find((r) => r.key === key)!).filter((row) => !row.requires || a.has(row.requires)).map((row) => (
                <div key={row.key}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{row.label}</h3>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[{ label: row.label, ...Object.fromEntries(rows.map((r) => [r.manager, (r[row.key] as number | null) ?? 0])) }]} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={20} barGap={2}>
                        <CartesianGrid stroke={chart.grid} vertical={false} />
                        <XAxis dataKey="label" hide />
                        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatAxis(v, row.fmt === 'score' ? 'score' : row.fmt)} domain={[0, row.fmt === 'percent' ? 1 : 'auto']} />
                        <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => active && payload?.length ? <TooltipFrame title={row.label} rows={payload.map((x) => ({ label: String(x.name), value: row.fmt === 'score' ? formatMetric(x.value as number, 'score') : fmt(x.value as number, row.fmt), color: x.color }))} /> : null} />
                        {rows.map((r, i) => <Bar key={r.manager} dataKey={r.manager} fill={chart.series[i % chart.series.length]} radius={[4, 4, 0, 0]} maxBarSize={40} />)}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink-muted">Performance score: each executive's talk time per active day against the 2 h 45 m daily target (100 = target reached), averaged per manager.</p>
          </Card>
        </>
      )}
    </div>
  );
}
