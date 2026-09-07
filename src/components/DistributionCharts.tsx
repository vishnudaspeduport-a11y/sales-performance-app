import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, type MetricKey } from '../config/metrics';
import { colorForKey } from '../lib/colors';
import { formatAxis, formatMetric, formatNumber } from '../lib/format';
import { rankBy, type EmployeeStats } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { useRouter } from '../state/router';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Segmented } from './ui/Controls';
import { EmptyState } from './ui/States';

const DIST_METRICS: MetricKey[] = ['totalCalls', 'connected', 'talkTime', 'connectionRate'];

/** One compact ranked bar chart with a metric switcher (replaces four stacked charts). */
export function DistributionCharts({ stats, has, fill = false }: { stats: EmployeeStats[]; has: (k: MetricKey) => boolean; fill?: boolean }) {
  const { chart, theme } = useTheme();
  const { navigate } = useRouter();
  const metrics = DIST_METRICS.filter(has);
  const [metric, setMetric] = useState<MetricKey>(metrics[0] ?? 'totalCalls');
  const [limit, setLimit] = useState<'10' | '20' | 'all'>('10');
  const def = METRICS[metric];
  const n = limit === 'all' ? Number.MAX_SAFE_INTEGER : Number(limit);

  const data = useMemo(() => rankBy(stats.filter((s) => s.totals.activeDays > 0 && s.metrics[metric] != null), metric).slice(0, n).map((s) => ({ id: s.employee.id, name: s.employee.name, value: s.metrics[metric] ?? 0, stat: s })), [stats, metric, n]);
  const total = useMemo(() => (def.additive ? stats.reduce((sum, s) => sum + (s.metrics[metric] ?? 0), 0) : 0), [stats, metric, def.additive]);
  const teamAvg = useMemo(() => { const active = stats.filter((s) => s.totals.activeDays > 0 && s.metrics[metric] != null); return active.length ? active.reduce((sum, s) => sum + (s.metrics[metric] ?? 0), 0) / active.length : null; }, [stats, metric]);

  return (
    <Card
      className={fill ? 'flex h-full flex-col' : ''}
      title="Call Distribution"
      subtitle={`${def.label} by executive · sorted high to low${teamAvg != null ? ` · team average ${formatMetric(teamAvg, def.format)}` : ''}`}
      actions={
        <>
          <Segmented ariaLabel="Distribution metric" value={metric} onChange={setMetric} options={metrics.map((m) => ({ value: m, label: METRICS[m].shortLabel }))} />
          <Segmented ariaLabel="Executives shown" value={limit} onChange={setLimit} options={[{ value: '10', label: 'Top 10' }, { value: '20', label: 'Top 20' }, { value: 'all', label: 'All' }]} />
        </>
      }
    >
      {!data.length ? (
        <EmptyState title="No data" />
      ) : (
        <div style={{ height: Math.max(150, data.length * 24 + 28) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={4} onClick={(e) => { const p = (e as { activePayload?: { payload: { id: string } }[] })?.activePayload?.[0]?.payload; if (p) navigate('employee', p.id); }}>
              <XAxis type="number" hide domain={def.format === 'percent' ? [0, 1] : [0, 'dataMax']} />
              {teamAvg != null && <ReferenceLine x={teamAvg} stroke={chart.inkMuted} strokeDasharray="4 3" />}
              <YAxis type="category" dataKey="name" width={140} tickLine={false} axisLine={false} tick={{ fill: chart.ink, fontSize: 11 }} interval={0} />
              <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                const rows = [{ label: def.label, value: formatMetric(d.value, def.format), color: chart.series[0] }];
                if (def.additive && total > 0) rows.push({ label: 'Share of team', value: `${((d.value / total) * 100).toFixed(1)}%`, color: '' });
                if (teamAvg != null && teamAvg > 0 && def.format !== 'percent') rows.push({ label: 'vs team average', value: `${d.value >= teamAvg ? '+' : '−'}${Math.abs(((d.value - teamAvg) / teamAvg) * 100).toFixed(0)}%`, color: '' });
                if (d.stat.metrics.totalCalls != null && metric !== 'totalCalls') rows.push({ label: 'Calls', value: formatNumber(d.stat.metrics.totalCalls), color: '' });
                return <TooltipFrame title={d.name} rows={rows.map((r) => ({ ...r, color: r.color || undefined }))} footer="Click to open profile" />;
              }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={14} className="cursor-pointer">
                {data.map((d) => <Cell key={d.id} fill={colorForKey(d.id, theme === 'dark')} />)}
                <LabelList dataKey="value" position="right" formatter={(v: number) => formatAxis(v, def.format)} style={{ fill: chart.inkMuted, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {teamAvg != null && <p className="mt-1 text-[11px] text-ink-muted">Dashed line marks the team average. Each executive keeps the same colour across charts.</p>}
    </Card>
  );
}
