import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { colorForIndex } from '../lib/colors';
import { WEEKDAYS, WEEKDAYS_SHORT } from '../lib/dates';
import { formatAxis, formatDuration, formatNumber, formatPercent } from '../lib/format';
import { computeDayOfWeek } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import type { BaseMetricKey, DailyRecord } from '../types';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Segmented } from './ui/Controls';
import { EmptyState } from './ui/States';

type DowMetric = 'avgCalls' | 'avgConnected' | 'avgTalkTime' | 'connectionRate';

export function DayOfWeekChart({ records, available, title = 'Day-of-Week Analysis' }: { records: DailyRecord[]; available: Set<BaseMetricKey>; title?: string }) {
  const { chart, theme } = useTheme();
  const canConn = available.has('dialedConnected') || available.has('incomingConnected');
  const canTalk = available.has('talkTimeDialed') || available.has('talkTimeIncoming');
  const options = [
    { value: 'avgCalls' as DowMetric, label: 'Avg Calls' },
    ...(canConn ? [{ value: 'avgConnected' as DowMetric, label: 'Avg Connected' }] : []),
    ...(canTalk ? [{ value: 'avgTalkTime' as DowMetric, label: 'Avg Talk Time' }] : []),
    ...(canConn ? [{ value: 'connectionRate' as DowMetric, label: 'Connection Rate' }] : []),
  ];
  const [metric, setMetric] = useState<DowMetric>('avgCalls');
  // Monday-first ordering
  const data = useMemo(() => {
    const dow = computeDayOfWeek(records, available);
    return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ ...dow[d], label: WEEKDAYS_SHORT[d], value: dow[d][metric] ?? 0 }));
  }, [records, available, metric]);
  const best = data.reduce((a, b) => (b.days > 0 && (b.value ?? 0) > (a.value ?? 0) ? b : a), data[0]);
  const format = metric === 'avgTalkTime' ? 'seconds' : metric === 'connectionRate' ? 'percent' : 'decimal';

  if (!records.length) return <Card title={title}><EmptyState title="No activity in this period" /></Card>;

  return (
    <Card title={title} subtitle={`Team average per calendar day · best day: ${best.days ? WEEKDAYS[best.dow] : '–'}`} actions={<Segmented ariaLabel="Day-of-week metric" value={metric} onChange={setMetric} options={options} />}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={12}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatAxis(v, format)} domain={[0, format === 'percent' ? 1 : 'auto']} />
            <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              return <TooltipFrame title={WEEKDAYS[d.dow]} rows={[
                { label: 'Avg calls / day', value: formatNumber(d.avgCalls, 1), color: chart.series[0] },
                ...(canConn ? [{ label: 'Avg connected / day', value: formatNumber(d.avgConnected, 1) }] : []),
                ...(canTalk ? [{ label: 'Avg talk time / day', value: formatDuration(d.avgTalkTime) }] : []),
                ...(canConn ? [{ label: 'Connection rate', value: formatPercent(d.connectionRate) }] : []),
                { label: 'Days in period', value: String(d.days) },
              ]} />;
            }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
              {data.map((d, i) => <Cell key={d.dow} fill={colorForIndex(i, theme === 'dark')} fillOpacity={d.dow === best.dow && d.days ? 1 : 0.8} stroke={d.dow === best.dow && d.days ? chart.ink : 'none'} strokeWidth={1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 overflow-x-auto scroll-thin">
        <table className="w-full min-w-[520px] text-xs">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted"><th className="py-1 pr-2 font-medium">Day</th><th className="py-1 pr-2 text-right font-medium">Days</th><th className="py-1 pr-2 text-right font-medium">Avg calls</th>{canConn && <th className="py-1 pr-2 text-right font-medium">Avg connected</th>}{canTalk && <th className="py-1 pr-2 text-right font-medium">Avg talk time</th>}{canConn && <th className="py-1 text-right font-medium">Conn. rate</th>}</tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.dow} className={`border-t border-line dark:border-line-dark ${d.dow === best.dow && d.days ? 'font-medium text-ink dark:text-ink-dark' : 'text-ink-secondary dark:text-ink-dark-secondary'}`}>
                <td className="py-1 pr-2">{WEEKDAYS[d.dow]}</td>
                <td className="tabular py-1 pr-2 text-right">{d.days}</td>
                <td className="tabular py-1 pr-2 text-right">{d.days ? formatNumber(d.avgCalls, 1) : '–'}</td>
                {canConn && <td className="tabular py-1 pr-2 text-right">{d.days ? formatNumber(d.avgConnected, 1) : '–'}</td>}
                {canTalk && <td className="tabular py-1 pr-2 text-right">{d.days ? formatDuration(d.avgTalkTime) : '–'}</td>}
                {canConn && <td className="tabular py-1 text-right">{d.days ? formatPercent(d.connectionRate) : '–'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
