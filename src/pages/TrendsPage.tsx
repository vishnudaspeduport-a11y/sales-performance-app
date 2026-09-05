import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DayOfWeekChart } from '../components/DayOfWeekChart';
import { PerformanceChart } from '../components/PerformanceChart';
import { TrendPanel } from '../components/TrendPanel';
import { Card } from '../components/ui/Card';
import { TooltipFrame } from '../components/ui/ChartTooltip';
import { EmptyState } from '../components/ui/States';
import { formatDateShort, formatRange } from '../lib/dates';
import { formatAxis, formatNumber } from '../lib/format';
import { groupByPeriod } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import type { Analytics } from '../state/useAnalytics';
import { PeriodEmpty } from './shared';

export function TrendsPage({ a }: { a: Analytics }) {
  const { chart } = useTheme();
  const weekly = useMemo(() => groupByPeriod(a.records, 'weekly', a.dataset.available, a.dataset.employeeById), [a]);
  const weeklyData = weekly.map((w) => ({ label: `Wk ${formatDateShort(w.from)}`, calls: w.metrics.totalCalls ?? 0, connected: w.metrics.connected ?? 0, point: w }));

  if (a.empty) return <PeriodEmpty a={a} />;

  return (
    <div className="space-y-4">
      <TrendPanel current={a.team.metrics} previous={a.prevTeam?.metrics ?? null} available={a.dataset.available} range={a.range} prevRange={a.prevRange} />
      <PerformanceChart title="Current vs Previous Period" records={a.records} prevRecords={a.prevRecords} available={a.dataset.available} employeeById={a.dataset.employeeById} range={a.range} showPreviousToggle />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Weekly Volume" subtitle={`Calls and connected calls per week (Mon–Sun) · ${formatRange(a.range.from, a.range.to)}`}>
          {weeklyData.length < 1 ? <EmptyState title="Not enough data" /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={10} barGap={2}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: chart.axis }} interval={weeklyData.length > 12 ? Math.ceil(weeklyData.length / 8) - 1 : 0} />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatAxis(v, 'count')} />
                  <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as (typeof weeklyData)[number];
                    return <TooltipFrame title={d.point.label} rows={[{ label: 'Calls', value: formatNumber(d.calls), color: chart.series[0] }, ...(a.has('connected') ? [{ label: 'Connected', value: formatNumber(d.connected), color: chart.series[2] }] : []), { label: 'Active executives', value: formatNumber(d.point.totals.employees) }]} />;
                  }} />
                  <Legend verticalAlign="top" height={24} iconType="circle" />
                  <Bar name="Calls" dataKey="calls" fill={chart.series[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  {a.has('connected') && <Bar name="Connected" dataKey="connected" fill={chart.series[2]} radius={[4, 4, 0, 0]} maxBarSize={28} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <DayOfWeekChart records={a.records} available={a.dataset.available} />
      </div>
    </div>
  );
}
