import { useMemo, useState } from 'react';
import { HEATMAP_METRICS, METRICS, type MetricKey } from '../config/metrics';
import { WEEKDAYS_SHORT, eachDay, formatDate, formatDateShort, weekStart, weekday } from '../lib/dates';
import { formatMetric } from '../lib/format';
import { rankBy, type EmployeeStats } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { useRouter } from '../state/router';
import type { BaseMetricKey, DailyRecord } from '../types';
import { Card } from './ui/Card';
import { Segmented, Select } from './ui/Controls';
import { EmptyState } from './ui/States';

function metricOfRecord(r: DailyRecord, m: MetricKey, available: Set<BaseMetricKey>): number {
  const has = (k: BaseMetricKey) => available.has(k);
  switch (m) {
    case 'connected': return (has('dialedConnected') ? r.dialedConnected : 0) + (has('incomingConnected') ? r.incomingConnected : 0);
    case 'talkTime': return (has('talkTimeDialed') ? r.talkTimeDialed : 0) + (has('talkTimeIncoming') ? r.talkTimeIncoming : 0);
    default: return (has('dialed') ? r.dialed : 0) + (has('incoming') ? r.incoming : 0);
  }
}

export function Heatmap({ records, stats, available, range, has }: { records: DailyRecord[]; stats: EmployeeStats[]; available: Set<BaseMetricKey>; range: { from: string; to: string }; has: (k: MetricKey) => boolean }) {
  const { chart } = useTheme();
  const { navigate } = useRouter();
  const options = HEATMAP_METRICS.filter(has).map((k) => ({ value: k, label: METRICS[k].label }));
  const [metric, setMetric] = useState<MetricKey>(options[0]?.value ?? 'totalCalls');
  const [limit, setLimit] = useState<'20' | '50' | 'all'>('20');
  const def = METRICS[metric];

  const days = useMemo(() => eachDay(range.from, range.to), [range]);
  const weekly = days.length > 70;
  const columns = useMemo(() => {
    if (!weekly) return days.map((d) => ({ key: d, label: formatDateShort(d), sub: WEEKDAYS_SHORT[weekday(d)] }));
    const weeks = new Map<string, string>();
    for (const d of days) { const w = weekStart(d); if (!weeks.has(w)) weeks.set(w, w); }
    return [...weeks.keys()].map((w) => ({ key: w, label: formatDateShort(w), sub: 'week' }));
  }, [days, weekly]);

  const rows = useMemo(() => {
    const colKey = (d: string) => (weekly ? weekStart(d) : d);
    const byEmp = new Map<string, Map<string, number>>();
    for (const r of records) {
      let m = byEmp.get(r.empId);
      if (!m) { m = new Map(); byEmp.set(r.empId, m); }
      const k = colKey(r.date);
      m.set(k, (m.get(k) ?? 0) + metricOfRecord(r, metric, available));
    }
    const ordered = rankBy(stats.filter((s) => s.totals.activeDays > 0), metric === 'connected' ? 'connected' : metric === 'talkTime' ? 'talkTime' : 'totalCalls');
    const n = limit === 'all' ? ordered.length : Number(limit);
    let max = 0;
    const out = ordered.slice(0, n).map((s) => {
      const cells = byEmp.get(s.employee.id) ?? new Map<string, number>();
      for (const v of cells.values()) if (v > max) max = v;
      return { id: s.employee.id, name: s.employee.name, cells };
    });
    return { out, max };
  }, [records, stats, metric, available, limit, weekly]);

  const color = (v: number | undefined) => {
    if (v == null || v <= 0) return 'transparent';
    const t = rows.max > 0 ? v / rows.max : 0;
    const idx = Math.min(chart.seq.length - 1, Math.max(0, Math.round(t * (chart.seq.length - 1))));
    return chart.seq[idx];
  };
  const textColor = (v: number | undefined) => {
    if (v == null || v <= 0) return chart.inkMuted;
    const t = rows.max > 0 ? v / rows.max : 0;
    return t > 0.55 ? '#ffffff' : chart.ink;
  };

  return (
    <Card
      title="Daily Team Heatmap"
      subtitle={`${def.label} per executive per ${weekly ? 'week' : 'day'} · darker = higher · blank = no activity recorded`}
      actions={
        <>
          <Select ariaLabel="Heatmap metric" value={metric} onChange={setMetric} options={options} className="w-40" />
          <Segmented ariaLabel="Rows" value={limit} onChange={setLimit} options={[{ value: '20', label: 'Top 20' }, { value: '50', label: 'Top 50' }, { value: 'all', label: 'All' }]} />
        </>
      }
      bodyClassName="!px-0 !py-0"
    >
      {rows.out.length === 0 ? (
        <EmptyState title="No activity to map" />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium text-ink-muted dark:bg-surface-dark">Executive</th>
                {columns.map((c) => (
                  <th key={c.key} className="px-0.5 py-1 text-center font-normal text-ink-muted" style={{ minWidth: 34 }}>
                    <div>{c.label}</div>
                    <div className="text-[10px] opacity-70">{c.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.out.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="sticky left-0 z-10 max-w-[160px] truncate bg-surface px-3 py-0.5 text-left font-medium text-ink dark:bg-surface-dark dark:text-ink-dark">
                    <button type="button" className="truncate hover:text-accent hover:underline" onClick={() => navigate('employee', r.id)}>{r.name}</button>
                  </th>
                  {columns.map((c) => {
                    const v = r.cells.get(c.key);
                    return (
                      <td key={c.key} className="p-0.5">
                        <div
                          className="flex h-7 items-center justify-center rounded-sm border border-line/60 tabular dark:border-line-dark/60"
                          style={{ background: color(v), color: textColor(v) }}
                          title={`${r.name} · ${weekly ? `Week of ${formatDate(c.key)}` : formatDate(c.key)} · ${def.label}: ${v ? formatMetric(v, def.format) : 'No activity recorded'}`}
                        >
                          {v ? (def.format === 'seconds' ? Math.round(v / 60) : v) : ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {def.format === 'seconds' && <p className="px-3 py-2 text-[11px] text-ink-muted">Cell values show talk time in minutes.</p>}
        </div>
      )}
    </Card>
  );
}
