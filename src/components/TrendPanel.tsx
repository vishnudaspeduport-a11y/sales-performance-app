import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { METRICS, isMetricAvailable, type MetricKey } from '../config/metrics';
import { formatRange } from '../lib/dates';
import { formatDelta, formatMetric } from '../lib/format';
import { compareMetrics, type MetricValues } from '../lib/metrics';
import type { BaseMetricKey } from '../types';
import { Card } from './ui/Card';
import { EmptyState } from './ui/States';

const TREND_METRICS: MetricKey[] = ['totalCalls', 'connected', 'notConnected', 'talkTime', 'connectionRate', 'avgTalkTime', 'callsPerDay', 'activeDays'];

export function TrendPanel({ current, previous, available, range, prevRange, compact = false }: {
  current: MetricValues;
  previous: MetricValues | null;
  available: Set<BaseMetricKey>;
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  compact?: boolean;
}) {
  const keys = TREND_METRICS.filter((k) => isMetricAvailable(METRICS[k], available)).slice(0, compact ? 4 : undefined);
  const items = previous ? compareMetrics(current, previous, keys) : [];
  return (
    <Card title="Trend vs Previous Period" subtitle={`${formatRange(range.from, range.to)} compared with ${formatRange(prevRange.from, prevRange.to)}`}>
      {!previous || items.every((i) => i.previous == null) ? (
        <EmptyState title="No comparison available" message={`No activity was recorded in the preceding period (${formatRange(prevRange.from, prevRange.to)}).`} />
      ) : (
        <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
          {items.map((t) => {
            const def = METRICS[t.key];
            const Icon = t.improved == null ? Minus : t.deltaAbs! > 0 ? ArrowUpRight : ArrowDownRight;
            const tone = t.improved == null ? 'text-ink-muted' : t.improved ? 'text-[#006300] dark:text-[#5fd35f]' : 'text-[#8f1f1f] dark:text-[#f08c8c]';
            return (
              <div key={t.key} className="rounded-lg border border-line px-3 py-2.5 dark:border-line-dark">
                <div className="text-xs text-ink-muted">{def.label}</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-lg font-semibold text-ink dark:text-ink-dark">{formatMetric(t.current, def.format)}</span>
                  <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}><Icon className="h-3.5 w-3.5" aria-hidden />{formatDelta(t.deltaPct, t.isRate, t.deltaAbs)}</span>
                </div>
                <div className="text-[11px] text-ink-muted">Previous: {formatMetric(t.previous, def.format)}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
