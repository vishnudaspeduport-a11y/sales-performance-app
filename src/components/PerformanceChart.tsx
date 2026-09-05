import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_METRICS, METRICS, isMetricAvailable, type MetricKey } from '../config/metrics';
import { formatDate, formatDateShort, formatMonth, formatRange, daysBetween, addDays } from '../lib/dates';
import { formatAxis, formatDuration, formatMetric, formatNumber } from '../lib/format';
import { groupByPeriod, type PeriodPoint } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import type { BaseMetricKey, DailyRecord, Employee, Granularity } from '../types';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Segmented, Select } from './ui/Controls';
import { EmptyState } from './ui/States';

interface Point {
  key: string;
  label: string;
  value: number | null;
  prevValue?: number | null;
  prevLabel?: string;
  point: PeriodPoint;
  prevPoint?: PeriodPoint;
}

export function PerformanceChart({ records, prevRecords, available, employeeById, employeeName, title = 'Daily Performance', range, showPreviousToggle = false, defaultMetric = 'totalCalls' }: {
  records: DailyRecord[];
  prevRecords?: DailyRecord[];
  available: Set<BaseMetricKey>;
  employeeById: Map<string, Employee>;
  /** when the series belongs to one employee, show their name in the tooltip */
  employeeName?: string;
  title?: string;
  range: { from: string; to: string };
  showPreviousToggle?: boolean;
  defaultMetric?: MetricKey;
}) {
  const { chart } = useTheme();
  const metricOptions = useMemo(() => CHART_METRICS.filter((k) => isMetricAvailable(METRICS[k], available)).map((k) => ({ value: k, label: METRICS[k].label })), [available]);
  const [metric, setMetric] = useState<MetricKey>(metricOptions.some((o) => o.value === defaultMetric) ? defaultMetric : (metricOptions[0]?.value ?? 'totalCalls'));
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [showPrev, setShowPrev] = useState(false);
  const def = METRICS[metric];

  const data = useMemo<Point[]>(() => {
    const cur = groupByPeriod(records, granularity, available, employeeById);
    const offset = daysBetween(range.from, range.to);
    const prevMap = new Map<string, PeriodPoint>();
    if (showPrev && prevRecords && granularity === 'daily') {
      // shift previous-period days forward so they align with the current period by position
      const shifted = prevRecords.map((r) => ({ ...r, date: addDays(r.date, offset) }));
      for (const p of groupByPeriod(shifted, 'daily', available, employeeById)) prevMap.set(p.key, p);
    }
    const keys = new Set(cur.map((p) => p.key));
    if (showPrev) for (const k of prevMap.keys()) keys.add(k);
    const curMap = new Map(cur.map((p) => [p.key, p]));
    return [...keys].sort().map((key) => {
      const point = curMap.get(key);
      const prevPoint = prevMap.get(key);
      const label = granularity === 'daily' ? formatDateShort(key) : granularity === 'weekly' ? formatDateShort(key) : formatMonth(key);
      return {
        key, label,
        value: point?.metrics[metric] ?? (point ? 0 : null),
        prevValue: prevPoint ? prevPoint.metrics[metric] ?? 0 : undefined,
        prevLabel: prevPoint ? formatDate(addDays(key, -offset)) : undefined,
        point: point ?? prevPoint!,
        prevPoint,
      };
    });
  }, [records, prevRecords, granularity, metric, available, employeeById, showPrev, range]);

  const tickInterval = data.length > 40 ? Math.ceil(data.length / 12) - 1 : data.length > 14 ? Math.ceil(data.length / 8) - 1 : 0;

  return (
    <Card
      title={title}
      subtitle={`${def.label} · ${granularity === 'daily' ? 'per day' : granularity === 'weekly' ? 'per week (Mon–Sun)' : 'per month'} · ${formatRange(range.from, range.to)}`}
      actions={
        <>
          <Select ariaLabel="Chart metric" value={metric} onChange={setMetric} options={metricOptions} className="w-44" />
          <Segmented ariaLabel="Granularity" value={granularity} onChange={setGranularity} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />
          {showPreviousToggle && granularity === 'daily' && (
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary dark:text-ink-dark-secondary">
              <input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} className="accent-accent" /> Previous period
            </label>
          )}
        </>
      }
    >
      {data.length === 0 ? (
        <EmptyState title="No activity in this period" message="Try a wider date range or fewer filters." />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chart.series[0]} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={chart.series[0]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: chart.axis }} interval={tickInterval} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatAxis(v, def.format)} domain={def.format === 'percent' ? [0, 1] : [0, 'auto']} />
              <Tooltip
                cursor={{ stroke: chart.axis }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as Point;
                  const pt = p.point;
                  const rows: { label: string; value: string; color?: string }[] = [];
                  if (employeeName) rows.push({ label: 'Employee', value: employeeName });
                  rows.push({ label: def.label, value: formatMetric(p.value, def.format), color: chart.series[0] });
                  if (p.prevValue != null) rows.push({ label: `Previous (${p.prevLabel})`, value: formatMetric(p.prevValue, def.format), color: chart.series[1] });
                  if (pt && metric !== 'totalCalls' && pt.metrics.totalCalls != null) rows.push({ label: 'Calls', value: formatNumber(pt.metrics.totalCalls) });
                  if (pt && metric !== 'connected' && pt.metrics.connected != null) rows.push({ label: 'Connected', value: formatNumber(pt.metrics.connected) });
                  if (pt && metric !== 'talkTime' && pt.metrics.talkTime != null) rows.push({ label: 'Talk time', value: formatDuration(pt.metrics.talkTime) });
                  if (pt && metric !== 'connectionRate' && pt.metrics.connectionRate != null) rows.push({ label: 'Connection rate', value: formatMetric(pt.metrics.connectionRate, 'percent') });
                  if (pt && !employeeName) rows.push({ label: 'Active executives', value: formatNumber(pt.totals.employees) });
                  const title = granularity === 'daily' ? formatDate(p.key) : pt?.label ?? p.label;
                  const footer = !employeeName && pt?.topEmployee ? `Top: ${pt.topEmployee.employee.name} (${formatNumber(pt.topEmployee.calls)} calls)` : undefined;
                  return <TooltipFrame title={title} rows={rows} footer={footer} />;
                }}
              />
              {showPrev && <Legend verticalAlign="top" height={24} iconType="plainline" />}
              <Area type="monotone" name={def.label} dataKey="value" stroke={chart.series[0]} strokeWidth={2} fill="url(#perfFill)" dot={data.length <= 31 ? { r: 3, strokeWidth: 2, fill: chart.surface } : false} activeDot={{ r: 5, strokeWidth: 2, fill: chart.surface }} connectNulls={false} />
              {showPrev && <Line type="monotone" name="Previous period" dataKey="prevValue" stroke={chart.series[1]} strokeWidth={2} strokeDasharray="4 3" dot={false} activeDot={{ r: 4, fill: chart.surface }} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
