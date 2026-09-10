import { useMemo, useState } from 'react';
import { METRICS, type MetricKey } from '../config/metrics';
import { formatDate, formatRange } from '../lib/dates';
import { formatMetric, formatNumber } from '../lib/format';
import { rankBy } from '../lib/metrics';
import type { Analytics } from '../state/useAnalytics';
import { useRouter } from '../state/router';
import { Card } from './ui/Card';
import { Button, Segmented } from './ui/Controls';

/**
 * "Who made these?" — the people (or days) behind a KPI card, for the current period and filters.
 * Additive metrics show each executive's share of the card's total; rates and averages show
 * each executive's own value.
 */
export function KpiDrilldown({ a, metric, title, onClose }: { a: Analytics; metric: MetricKey; title: string; onClose: () => void }) {
  const { navigate } = useRouter();
  const def = METRICS[metric];
  const [view, setView] = useState<'executive' | 'day'>('executive');
  const [showAll, setShowAll] = useState(false);

  const total = metric === 'score' ? null : a.team.metrics[metric] ?? null;
  const byExecutive = useMemo(() => rankBy(a.stats.filter((s) => s.totals.activeDays > 0 && (metric === 'score' ? s.score != null : s.metrics[metric] != null)), metric), [a.stats, metric]);
  const byDay = useMemo(() => a.daily.map((d) => ({ date: d.key, value: d.metrics[metric] ?? null, top: d.topEmployee })).filter((d) => d.value != null), [a.daily, metric]);

  const rows = view === 'executive' ? byExecutive : byDay;
  const limit = showAll ? rows.length : 15;
  const max = Math.max(0, ...(view === 'executive' ? byExecutive.map((s) => (metric === 'score' ? s.score ?? 0 : s.metrics[metric] ?? 0)) : byDay.map((d) => d.value ?? 0)));
  const share = (v: number | null) => (def.additive && total && v != null ? `${Math.round((v / total) * 100)}%` : '');
  const bar = (v: number | null) => (max > 0 && v != null ? `${Math.max(2, (v / max) * 100)}%` : '0%');

  return (
    <Card
      title={<span>Who is behind <span className="text-accent dark:text-accent-dark">{title}</span></span>}
      subtitle={`${total != null ? `${formatMetric(total, def.format)} in total · ` : ''}${formatRange(a.range.from, a.range.to)} · ${formatNumber(byExecutive.length)} ${byExecutive.length === 1 ? 'executive' : 'executives'} with activity`}
      actions={
        <>
          <Segmented ariaLabel="Breakdown" value={view} onChange={setView} options={[{ value: 'executive', label: 'By executive' }, { value: 'day', label: 'By day' }]} />
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
      bodyClassName="!px-0 !py-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
              <th className="w-10 px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">{view === 'executive' ? 'Executive' : 'Day'}</th>
              <th className="px-3 py-2 font-medium">{view === 'executive' ? 'Manager' : 'Top executive that day'}</th>
              <th className="px-3 py-2 text-right font-medium">{def.shortLabel}</th>
              {def.additive && total ? <th className="px-3 py-2 text-right font-medium">Share</th> : null}
              <th className="w-40 px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {view === 'executive' && byExecutive.slice(0, limit).map((s, i) => {
              const v = metric === 'score' ? s.score ?? null : s.metrics[metric] ?? null;
              return (
                <tr key={s.employee.id} className="border-b border-line last:border-0 dark:border-line-dark">
                  <td className="px-3 py-1.5 text-ink-muted">{i + 1}</td>
                  <td className="px-3 py-1.5"><button type="button" className="text-left font-medium text-ink hover:underline dark:text-ink-dark" onClick={() => navigate('employee', s.employee.id)}>{s.employee.name}</button>{!s.employee.id.startsWith('NAME:') && s.employee.id !== s.employee.name && <span className="ml-1.5 text-[10px] text-ink-muted">{s.employee.id}</span>}</td>
                  <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{s.employee.manager || 'Unassigned'}</td>
                  <td className="tabular px-3 py-1.5 text-right font-medium text-ink dark:text-ink-dark">{formatMetric(v, def.format)}</td>
                  {def.additive && total ? <td className="tabular px-3 py-1.5 text-right text-ink-muted">{share(v)}</td> : null}
                  <td className="px-3 py-1.5"><div className="h-2 rounded-full bg-plane dark:bg-plane-dark"><div className="h-2 rounded-full bg-accent dark:bg-accent-dark" style={{ width: bar(v) }} /></div></td>
                </tr>
              );
            })}
            {view === 'day' && byDay.slice(0, limit).map((d, i) => (
              <tr key={d.date} className="border-b border-line last:border-0 dark:border-line-dark">
                <td className="px-3 py-1.5 text-ink-muted">{i + 1}</td>
                <td className="px-3 py-1.5 font-medium text-ink dark:text-ink-dark">{formatDate(d.date)}</td>
                <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{d.top ? `${d.top.employee.name} · ${formatNumber(d.top.calls)} calls` : '–'}</td>
                <td className="tabular px-3 py-1.5 text-right font-medium text-ink dark:text-ink-dark">{formatMetric(d.value, def.format)}</td>
                {def.additive && total ? <td className="tabular px-3 py-1.5 text-right text-ink-muted">{share(d.value)}</td> : null}
                <td className="px-3 py-1.5"><div className="h-2 rounded-full bg-plane dark:bg-plane-dark"><div className="h-2 rounded-full bg-accent dark:bg-accent-dark" style={{ width: bar(d.value) }} /></div></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-ink-muted">Nothing to show for this period.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > 15 && (
        <div className="border-t border-line px-4 py-2 text-xs dark:border-line-dark">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show top 15' : `Show all ${formatNumber(rows.length)}`}</Button>
        </div>
      )}
    </Card>
  );
}
