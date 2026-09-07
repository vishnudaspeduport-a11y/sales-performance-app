import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, isMetricAvailable, type MetricKey } from '../config/metrics';
import { formatDate, formatRange, isIsoDate, previousRange } from '../lib/dates';
import { formatAxis, formatDelta, formatMetric, formatNumber } from '../lib/format';
import { compareMetrics, type EmployeeStats, type MetricValues, type TrendItem } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { computeRangeStats, type Analytics } from '../state/useAnalytics';
import { useRouter } from '../state/router';
import type { Employee } from '../types';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Button, MultiSelect, Segmented, Select } from './ui/Controls';
import { EmptyState } from './ui/States';

const COMPARE_METRICS: MetricKey[] = ['score', 'totalCalls', 'connected', 'uniqueConnected', 'notConnected', 'connectionRate', 'talkTime', 'avgTalkTime', 'callsPerDay', 'activeDays', 'band02', 'band24', 'band4p'];
const CHART_PANELS: MetricKey[] = ['totalCalls', 'connected', 'callsPerDay', 'connectionRate', 'talkTime', 'score'];
const PER_EXEC_METRICS: MetricKey[] = ['score', 'totalCalls', 'connected', 'uniqueConnected', 'connectionRate', 'talkTime', 'callsPerDay'];

interface Period { from: string; to: string }

function DateRangeInput({ label, value, onChange, bounds }: { label: string; value: Period; onChange: (p: Period) => void; bounds: Period | null }) {
  const set = (k: keyof Period, v: string) => { if (isIsoDate(v) && v >= '2000-01-01') onChange({ ...value, [k]: v }); };
  const cls = 'h-9 w-full min-w-[9.5rem] rounded-lg border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-muted">{label}</div>
      <div className="flex items-center gap-2">
        <input type="date" aria-label={`${label} from`} value={value.from} min={bounds?.from} max={bounds?.to} onChange={(e) => set('from', e.target.value)} className={cls} />
        <span className="text-xs text-ink-muted">to</span>
        <input type="date" aria-label={`${label} to`} value={value.to} min={bounds?.from} max={bounds?.to} onChange={(e) => set('to', e.target.value)} className={cls} />
      </div>
    </div>
  );
}

const metricValue = (s: EmployeeStats | undefined, key: MetricKey): number | null => (s ? (key === 'score' ? s.score : s.metrics[key]) ?? null : null);

/**
 * Compare the same scope across two date ranges: the whole team (under the
 * dashboard filters), one manager's team, or a single executive. With a manager
 * selected, every executive under that manager is also listed with their own
 * change. Scores are computed within each period, relative to that period's team.
 */
export function PeriodComparison({ a }: { a: Analytics }) {
  const { chart } = useTheme();
  const { navigate } = useRouter();
  const bounds = a.dataset.dateRange;
  const [periodA, setPeriodA] = useState<Period>(() => ({ from: a.range.from, to: a.range.to }));
  const [periodB, setPeriodB] = useState<Period>(() => previousRange(a.range.from, a.range.to));
  const [manager, setManager] = useState<string>('');
  const [scope, setScope] = useState<string[]>([]); // [] = whole (manager) team, [id] = one executive
  const [execMetric, setExecMetric] = useState<MetricKey>('score');

  const managers = useMemo(() => [...new Set(a.employees.map((e) => e.manager).filter(Boolean))].sort((x, y) => x.localeCompare(y)), [a.employees]);
  const teamEmployees = useMemo<Employee[]>(() => (manager ? a.employees.filter((e) => e.manager === manager) : a.employees), [a.employees, manager]);
  const options = useMemo(() => teamEmployees.map((e) => ({ value: e.id, label: e.name, hint: e.id.startsWith('NAME:') ? undefined : e.id })), [teamEmployees]);
  const invalid = periodA.from > periodA.to || periodB.from > periodB.to;
  const effectiveScope = scope.filter((id) => teamEmployees.some((e) => e.id === id));

  const result = useMemo(() => {
    if (invalid) return null;
    const rsA = computeRangeStats(a.dataset, a.filters, periodA, teamEmployees);
    const rsB = computeRangeStats(a.dataset, a.filters, periodB, teamEmployees);
    const pick = (rs: typeof rsA): { metrics: MetricValues; label: string; empty: boolean } => {
      if (effectiveScope.length === 1) {
        const s = rs.stats.find((x) => x.employee.id === effectiveScope[0]);
        const m: MetricValues = { ...(s?.metrics ?? {}) };
        if (s?.score != null) m.score = s.score;
        return { metrics: m, label: s?.employee.name ?? 'Executive', empty: !s || s.totals.activeDays === 0 };
      }
      const scored = rs.stats.filter((x) => x.score != null);
      const m: MetricValues = { ...rs.team.metrics };
      if (scored.length) m.score = scored.reduce((sum, x) => sum + (x.score ?? 0), 0) / scored.length;
      return { metrics: m, label: manager ? `${manager}'s team` : 'Team', empty: rs.records.length === 0 };
    };
    const A = pick(rsA); const B = pick(rsB);
    const keys = COMPARE_METRICS.filter((k) => isMetricAvailable(METRICS[k], a.dataset.available) && (A.metrics[k] != null || B.metrics[k] != null));
    const items = compareMetrics(A.metrics, B.metrics, keys);
    // Per-executive rows (manager view): everyone under the manager with activity in either period.
    const byId = new Map(rsB.stats.map((s) => [s.employee.id, s]));
    const execRows = rsA.stats
      .map((sa) => ({ employee: sa.employee, a: sa, b: byId.get(sa.employee.id) }))
      .filter((r) => r.a.totals.activeDays > 0 || (r.b && r.b.totals.activeDays > 0));
    return { A, B, items, execRows };
  }, [a, periodA, periodB, effectiveScope, teamEmployees, manager, invalid]);

  const execTable = useMemo(() => {
    if (!result || effectiveScope.length) return [];
    const def = METRICS[execMetric];
    return result.execRows.map((r) => {
      const va = metricValue(r.a, execMetric); const vb = metricValue(r.b, execMetric);
      const [item] = compareMetrics({ [execMetric]: va }, { [execMetric]: vb }, [execMetric]);
      return { id: r.employee.id, name: r.employee.name, va, vb, item, def };
    }).sort((x, y) => (y.va ?? -Infinity) - (x.va ?? -Infinity));
  }, [result, effectiveScope, execMetric]);

  const swap = () => { setPeriodA(periodB); setPeriodB(periodA); };
  const useCurrent = () => { setPeriodA({ from: a.range.from, to: a.range.to }); setPeriodB(previousRange(a.range.from, a.range.to)); };
  const panels = result ? CHART_PANELS.filter((k) => result.items.some((i) => i.key === k)) : [];
  const execMetricOptions = PER_EXEC_METRICS.filter((k) => isMetricAvailable(METRICS[k], a.dataset.available)).map((k) => ({ value: k, label: METRICS[k].shortLabel }));

  return (
    <div className="space-y-4">
      <Card title="Compare Periods" subtitle="Same team, manager's team or executive across two date ranges · change is Period A relative to Period B">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <DateRangeInput label="Period A" value={periodA} onChange={setPeriodA} bounds={bounds} />
          <DateRangeInput label="Period B (baseline)" value={periodB} onChange={setPeriodB} bounds={bounds} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={swap}>Swap</Button>
            <Button size="sm" variant="ghost" onClick={useCurrent}>Use dashboard period</Button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {managers.length > 0 && (
            <Select ariaLabel="Manager" value={manager} onChange={(v) => { setManager(v); setScope([]); }} options={[{ value: '', label: 'All managers' }, ...managers.map((m) => ({ value: m, label: m }))]} className="w-full sm:w-56" />
          )}
          <MultiSelect label="Executive" placeholder={manager ? `Everyone under ${manager}` : 'Whole team'} options={options} selected={effectiveScope} onChange={(v) => setScope(v.slice(-1))} max={1} className="w-full sm:w-72" />
          <span className="text-xs text-ink-muted">Choose a manager to compare their team and list each executive, or pick one executive.</span>
        </div>
        {invalid && <p className="mt-2 text-xs text-status-critical">Each period's From date must be on or before its To date.</p>}
      </Card>

      {!result ? null : result.A.empty && result.B.empty ? (
        <div className="rounded-xl border border-line bg-surface shadow-card dark:border-line-dark dark:bg-surface-dark"><EmptyState title="No activity in either period" message="Choose ranges that contain data (see the Data available note in the filters)." /></div>
      ) : (
        <>
          <Card title={`${result.A.label}: ${formatRange(periodA.from, periodA.to)} vs ${formatRange(periodB.from, periodB.to)}`} subtitle="Bars: Period A in blue, Period B in orange · each panel has its own scale">
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {panels.map((key) => {
                const def = METRICS[key];
                const item = result.items.find((i) => i.key === key)!;
                const data = [{ label: def.shortLabel, A: item.current ?? 0, B: item.previous ?? 0 }];
                return (
                  <div key={key}>
                    <h3 className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-muted"><span>{def.label}</span><DeltaBadge item={item} /></h3>
                    <div className="h-36">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={24} barGap={4}>
                          <CartesianGrid stroke={chart.grid} vertical={false} />
                          <XAxis dataKey="label" hide />
                          <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatAxis(v, def.format)} domain={[0, def.format === 'percent' ? 1 : def.format === 'score' ? 100 : 'auto']} />
                          <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => active && payload?.length ? <TooltipFrame title={def.label} rows={[{ label: `A · ${formatRange(periodA.from, periodA.to)}`, value: formatMetric(item.current, def.format), color: chart.series[0] }, { label: `B · ${formatRange(periodB.from, periodB.to)}`, value: formatMetric(item.previous, def.format), color: chart.series[1] }]} /> : null} />
                          <Legend verticalAlign="top" height={20} iconType="circle" formatter={(v: string) => (v === 'A' ? 'Period A' : 'Period B')} />
                          <Bar dataKey="A" name="A" fill={chart.series[0]} radius={[4, 4, 0, 0]} maxBarSize={44} />
                          <Bar dataKey="B" name="B" fill={chart.series[1]} radius={[4, 4, 0, 0]} maxBarSize={44} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Comparison Table" subtitle={`Change = Period A vs Period B${effectiveScope.length ? '' : ' · score is the average of executive scores in each period'}`} bodyClassName="!px-0 !py-0">
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                    <th className="px-4 py-2 font-medium">Metric</th>
                    <th className="px-3 py-2 text-right font-medium">A · {formatDate(periodA.from, false)} – {formatDate(periodA.to, false)}</th>
                    <th className="px-3 py-2 text-right font-medium">B · {formatDate(periodB.from, false)} – {formatDate(periodB.to, false)}</th>
                    <th className="px-3 py-2 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => {
                    const def = METRICS[item.key];
                    return (
                      <tr key={item.key} className="border-b border-line last:border-0 dark:border-line-dark">
                        <td className="px-4 py-2 text-ink-secondary dark:text-ink-dark-secondary">{def.label}{item.key === 'score' && <span className="ml-1 text-[10px] text-ink-muted">(calculated)</span>}{(item.key.startsWith('band') || item.key === 'uniqueConnected') && <span className="ml-1 text-[10px] text-ink-muted">(call-log days)</span>}</td>
                        <td className="tabular px-3 py-2 text-right font-medium text-ink dark:text-ink-dark">{formatMetric(item.current, def.format)}</td>
                        <td className="tabular px-3 py-2 text-right text-ink-secondary dark:text-ink-dark-secondary">{formatMetric(item.previous, def.format)}</td>
                        <td className="px-3 py-2 text-right"><DeltaBadge item={item} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {!effectiveScope.length && execTable.length > 0 && (
            <Card
              title={manager ? `Executives under ${manager}` : 'By executive'}
              subtitle={`${formatNumber(execTable.length)} executives with activity in either period · sorted by Period A`}
              actions={<Segmented ariaLabel="Per-executive metric" value={execMetric} onChange={setExecMetric} options={execMetricOptions} />}
              bodyClassName="!px-0 !py-0"
            >
              <div className="max-h-[32rem] overflow-auto scroll-thin">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 bg-surface dark:bg-surface-dark">
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                      <th className="px-4 py-2 font-medium">Executive</th>
                      <th className="px-3 py-2 text-right font-medium">{METRICS[execMetric].label} · A</th>
                      <th className="px-3 py-2 text-right font-medium">B</th>
                      <th className="px-3 py-2 text-right font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execTable.map((r) => (
                      <tr key={r.id} className="border-b border-line last:border-0 hover:bg-plane/60 dark:border-line-dark dark:hover:bg-[#202020]">
                        <td className="px-4 py-2"><button type="button" onClick={() => navigate('employee', r.id)} className="font-medium text-ink hover:text-accent hover:underline dark:text-ink-dark">{r.name}</button></td>
                        <td className="tabular px-3 py-2 text-right text-ink dark:text-ink-dark">{formatMetric(r.va, r.def.format)}</td>
                        <td className="tabular px-3 py-2 text-right text-ink-secondary dark:text-ink-dark-secondary">{formatMetric(r.vb, r.def.format)}</td>
                        <td className="px-3 py-2 text-right"><DeltaBadge item={r.item} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function DeltaBadge({ item }: { item: TrendItem }) {
  const def = METRICS[item.key];
  if (item.deltaAbs == null) return <span className="text-xs text-ink-muted">–</span>;
  const text = def.format === 'score' ? `${item.deltaAbs >= 0 ? '+' : '−'}${Math.abs(Math.round(item.deltaAbs))} pts` : formatDelta(item.deltaPct, item.isRate, item.deltaAbs);
  const Icon = item.improved == null ? Minus : item.deltaAbs > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = item.improved == null ? 'text-ink-muted' : item.improved ? 'text-[#006300] dark:text-[#5fd35f]' : 'text-[#8f1f1f] dark:text-[#f08c8c]';
  return <span className={`tabular inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium normal-case tracking-normal ${tone}`}><Icon className="h-3.5 w-3.5" aria-hidden />{text}</span>;
}
