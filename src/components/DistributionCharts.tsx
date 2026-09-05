import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, type MetricKey } from '../config/metrics';
import { formatAxis, formatMetric } from '../lib/format';
import { rankBy, type EmployeeStats } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { useRouter } from '../state/router';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Segmented } from './ui/Controls';
import { EmptyState } from './ui/States';

const DIST_METRICS: MetricKey[] = ['totalCalls', 'connected', 'talkTime', 'connectionRate'];

function DistributionBar({ stats, metric, limit }: { stats: EmployeeStats[]; metric: MetricKey; limit: number }) {
  const { chart } = useTheme();
  const { navigate } = useRouter();
  const def = METRICS[metric];
  const data = useMemo(() => rankBy(stats.filter((s) => s.totals.activeDays > 0 && s.metrics[metric] != null), metric).slice(0, limit).map((s) => ({ id: s.employee.id, name: s.employee.name, value: s.metrics[metric] ?? 0, stat: s })), [stats, metric, limit]);
  const total = useMemo(() => (def.additive ? stats.reduce((sum, s) => sum + (s.metrics[metric] ?? 0), 0) : 0), [stats, metric, def.additive]);
  if (!data.length) return <EmptyState title="No data" />;
  return (
    <div style={{ height: Math.max(140, data.length * 26 + 20) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={4} onClick={(e) => { const p = (e as { activePayload?: { payload: { id: string } }[] })?.activePayload?.[0]?.payload; if (p) navigate('employee', p.id); }}>
          <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatAxis(v, def.format)} domain={def.format === 'percent' ? [0, 1] : [0, 'auto']} height={20} />
          <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fill: chart.ink, fontSize: 11 }} interval={0} />
          <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number];
            const rows = [{ label: def.label, value: formatMetric(d.value, def.format), color: chart.series[0] }];
            if (def.additive && total > 0) rows.push({ label: 'Share of team', value: `${((d.value / total) * 100).toFixed(1)}%`, color: undefined as unknown as string });
            return <TooltipFrame title={d.name} rows={rows.map((r) => ({ ...r, color: r.color || undefined }))} footer="Click to open profile" />;
          }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16} className="cursor-pointer">
            {data.map((d) => <Cell key={d.id} fill={chart.seq[3]} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionCharts({ stats, has }: { stats: EmployeeStats[]; has: (k: MetricKey) => boolean }) {
  const [limit, setLimit] = useState<'15' | '30' | 'all'>('15');
  const metrics = DIST_METRICS.filter(has);
  const n = limit === 'all' ? Number.MAX_SAFE_INTEGER : Number(limit);
  return (
    <Card title="Call Distribution" subtitle="How activity is spread across executives · sorted high to low" actions={<Segmented ariaLabel="Executives shown" value={limit} onChange={setLimit} options={[{ value: '15', label: 'Top 15' }, { value: '30', label: 'Top 30' }, { value: 'all', label: 'All' }]} />}>
      <div className="grid gap-6 lg:grid-cols-2">
        {metrics.map((m) => (
          <div key={m}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{METRICS[m].label} by Employee</h3>
            <DistributionBar stats={stats} metric={m} limit={n} />
          </div>
        ))}
      </div>
    </Card>
  );
}
