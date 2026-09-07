import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, RANKING_METRICS, isMetricAvailable, type MetricKey } from '../config/metrics';
import { formatAxis, formatMetric } from '../lib/format';
import { colorForKey } from '../lib/colors';
import { rankBy, type EmployeeStats } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { useRouter } from '../state/router';
import type { BaseMetricKey } from '../types';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Segmented, Select } from './ui/Controls';
import { EmptyState } from './ui/States';

export function EmployeeLeaderboard({ stats, available }: { stats: EmployeeStats[]; available: Set<BaseMetricKey> }) {
  const { chart, theme } = useTheme();
  const { navigate } = useRouter();
  const options = useMemo(() => RANKING_METRICS.filter((k) => isMetricAvailable(METRICS[k], available)).map((k) => ({ value: k, label: METRICS[k].label })), [available]);
  const [metric, setMetric] = useState<MetricKey>('totalCalls');
  const [top, setTop] = useState<'5' | '10'>('10');
  const def = METRICS[metric];

  const data = useMemo(() => {
    const active = stats.filter((s) => s.totals.activeDays > 0 && (metric === 'score' ? s.score != null : s.metrics[metric] != null));
    return rankBy(active, metric).slice(0, Number(top)).map((s) => ({ id: s.employee.id, name: s.employee.name, value: (metric === 'score' ? s.score : s.metrics[metric]) ?? 0, stat: s }));
  }, [stats, metric, top]);

  const height = Math.max(160, data.length * 34 + 24);

  return (
    <Card
      title="Top Performers"
      subtitle={`Ranked by ${def.label.toLowerCase()}${metric === 'score' ? ' (calculated)' : ''}`}
      actions={
        <>
          <Select ariaLabel="Ranking metric" value={metric} onChange={setMetric} options={options} className="w-44" />
          <Segmented ariaLabel="Top count" value={top} onChange={setTop} options={[{ value: '5', label: 'Top 5' }, { value: '10', label: 'Top 10' }]} />
        </>
      }
    >
      {data.length === 0 ? (
        <EmptyState title="No ranked executives" message="No activity was recorded in the selected period." />
      ) : (
        <div style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={6} onClick={(e) => { const p = (e as { activePayload?: { payload: { id: string } }[] })?.activePayload?.[0]?.payload; if (p) navigate('employee', p.id); }}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="name" width={140} tickLine={false} axisLine={false} tick={{ fill: chart.ink, fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: chart.grid, opacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof data)[number];
                  const s = d.stat;
                  return (
                    <TooltipFrame
                      title={`#${s.rank} ${d.name}`}
                      rows={[
                        { label: def.label, value: formatMetric(d.value, def.format), color: chart.series[0] },
                        ...(metric !== 'totalCalls' && s.metrics.totalCalls != null ? [{ label: 'Calls', value: formatMetric(s.metrics.totalCalls, 'count') }] : []),
                        ...(metric !== 'connected' && s.metrics.connected != null ? [{ label: 'Connected', value: formatMetric(s.metrics.connected, 'count') }] : []),
                        ...(metric !== 'talkTime' && s.metrics.talkTime != null ? [{ label: 'Talk time', value: formatMetric(s.metrics.talkTime, 'seconds') }] : []),
                        { label: 'Active days', value: String(s.totals.activeDays) },
                      ]}
                      footer="Click to open profile"
                    />
                  );
                }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} className="cursor-pointer">
                {data.map((d) => <Cell key={d.id} fill={colorForKey(d.id, theme === 'dark')} />)}
                <LabelList dataKey="value" position="right" formatter={(v: number) => formatAxis(v, def.format)} style={{ fill: chart.inkMuted, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
