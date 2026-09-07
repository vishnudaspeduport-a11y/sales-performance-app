import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, scoreBand, type MetricKey } from '../config/metrics';
import { formatAxis, formatMetric } from '../lib/format';
import type { EmployeeStats } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { useRouter } from '../state/router';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Badge } from './ui/Controls';

const COMPARE_METRICS: MetricKey[] = ['totalCalls', 'connected', 'uniqueConnected', 'connectionRate', 'talkTime', 'avgTalkTime', 'callsPerDay', 'activeDays', 'score'];

/** Metrics shown as grouped bars; each gets its own panel so no two scales share an axis. */
const CHART_METRICS: MetricKey[] = ['totalCalls', 'connected', 'callsPerDay', 'connectionRate', 'talkTime', 'avgTalkTime'];

export function ComparisonChart({ stats, has }: { stats: EmployeeStats[]; has: (k: MetricKey) => boolean }) {
  const { chart } = useTheme();
  const { navigate } = useRouter();
  const metrics = COMPARE_METRICS.filter(has);
  const panels = CHART_METRICS.filter(has);

  const data = useMemo(() => panels.map((key) => ({
    key,
    def: METRICS[key],
    rows: stats.map((s) => ({ name: s.employee.name, value: (key === 'score' ? s.score : s.metrics[key]) ?? 0 })),
  })), [stats, panels]);

  const best = (key: MetricKey) => {
    const def = METRICS[key];
    let b: EmployeeStats | null = null;
    for (const s of stats) {
      const v = (key === 'score' ? s.score : s.metrics[key]) ?? null;
      if (v == null) continue;
      const bv = b ? ((key === 'score' ? b.score : b.metrics[key]) ?? null) : null;
      if (bv == null || (def.higherIsBetter ? v > bv : v < bv)) b = s;
    }
    return b?.employee.id;
  };

  return (
    <div className="space-y-4">
      <Card title="Side-by-side Comparison" subtitle="Each panel has its own scale · colours identify the executive consistently across panels">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <div key={p.key}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{p.def.label}</h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[{ label: p.def.shortLabel, ...Object.fromEntries(p.rows.map((r) => [r.name, r.value])) }]} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={20} barGap={2}>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="label" hide />
                    <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatAxis(v, p.def.format)} domain={[0, p.def.format === 'percent' ? 1 : 'auto']} />
                    <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => active && payload?.length ? <TooltipFrame title={p.def.label} rows={payload.map((x) => ({ label: String(x.name), value: formatMetric(x.value as number, p.def.format), color: x.color }))} /> : null} />
                    {p.rows.map((r, i) => <Bar key={r.name} dataKey={r.name} fill={chart.series[i % chart.series.length]} radius={[4, 4, 0, 0]} maxBarSize={40} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-secondary dark:text-ink-dark-secondary">
          {stats.map((s, i) => <span key={s.employee.id} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: chart.series[i % chart.series.length] }} />{s.employee.name}</span>)}
        </div>
      </Card>

      <Card title="Comparison Table" subtitle="Best value per row is highlighted" bodyClassName="!px-0 !py-0">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                <th className="sticky left-0 bg-surface px-3 py-2 font-medium dark:bg-surface-dark">Metric</th>
                {stats.map((s, i) => (
                  <th key={s.employee.id} className="px-3 py-2 text-right font-medium">
                    <button type="button" onClick={() => navigate('employee', s.employee.id)} className="inline-flex items-center gap-1.5 normal-case tracking-normal text-ink hover:text-accent hover:underline dark:text-ink-dark"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: chart.series[i % chart.series.length] }} />{s.employee.name}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((key) => {
                const def = METRICS[key];
                const b = best(key);
                return (
                  <tr key={key} className="border-b border-line last:border-0 dark:border-line-dark">
                    <td className="sticky left-0 bg-surface px-3 py-2 text-ink-secondary dark:bg-surface-dark dark:text-ink-dark-secondary">{def.label}{key === 'score' && <span className="ml-1 text-[10px] text-ink-muted">(calculated)</span>}</td>
                    {stats.map((s) => {
                      const v = (key === 'score' ? s.score : s.metrics[key]) ?? null;
                      const band = key === 'score' ? scoreBand(v) : null;
                      return (
                        <td key={s.employee.id} className={`tabular px-3 py-2 text-right ${b === s.employee.id ? 'font-semibold text-ink dark:text-ink-dark' : 'text-ink-secondary dark:text-ink-dark-secondary'}`}>
                          {formatMetric(v, def.format)}{band && <Badge tone={band.tone} className="ml-1.5">{band.label}</Badge>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
