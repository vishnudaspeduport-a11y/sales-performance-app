import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { METRICS, type MetricKey } from '../config/metrics';
import { formatDelta, formatDuration, formatMetric, formatNumber } from '../lib/format';
import { compareMetrics } from '../lib/metrics';
import type { Analytics } from '../state/useAnalytics';

export interface KPI {
  key: string;
  label: string;
  value: string;
  sub?: ReactNode;
  delta?: { text: string; improved: boolean | null };
  /** previous-period value, shown beside the change */
  previous?: string;
  description?: string;
  /** compact breakdown shown under the value (e.g. duration split) */
  breakdown?: { items: { label: string; value: string; share?: string }[]; note?: string };
}

export function KPICard({ kpi }: { kpi: KPI }) {
  const d = kpi.delta;
  const tone = d?.improved == null ? 'text-ink-muted' : d.improved ? 'text-[#006300] dark:text-[#5fd35f]' : 'text-[#8f1f1f] dark:text-[#f08c8c]';
  const Icon = d?.improved == null ? Minus : d.improved ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-surface px-4 py-3 shadow-card dark:border-line-dark dark:bg-surface-dark" title={kpi.description}>
      <div className="truncate text-xs font-medium text-ink-muted">{kpi.label}</div>
      <div className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink dark:text-ink-dark">{kpi.value}</div>
      <div className="mt-1 flex min-h-[1rem] flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        {d && (
          <span className={`inline-flex items-center gap-0.5 whitespace-nowrap font-medium ${tone}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {d.text}
          </span>
        )}
        {kpi.previous && <span className="truncate text-ink-muted">prev {kpi.previous}</span>}
        {!kpi.previous && kpi.sub && <span className="truncate text-ink-muted">{kpi.sub}</span>}
      </div>
      {kpi.breakdown && (
        <div className="mt-auto border-t border-line pt-2 dark:border-line-dark" title={kpi.breakdown.note}>
          <div className="grid grid-cols-3 gap-2">
            {kpi.breakdown.items.map((b) => (
              <div key={b.label} className="min-w-0 leading-tight">
                <div className="truncate text-[10px] uppercase tracking-wide text-ink-muted">{b.label}</div>
                <div className="tabular text-sm font-semibold text-ink dark:text-ink-dark">{b.value} <span className="text-[10px] font-normal text-ink-muted">{b.share}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function trend(a: Analytics, key: MetricKey): Pick<KPI, 'delta' | 'previous'> {
  if (!a.prevTeam) return {};
  const [t] = compareMetrics(a.team.metrics, a.prevTeam.metrics, [key]);
  if (t.previous == null || t.current == null) return {};
  return { delta: { text: formatDelta(t.deltaPct, t.isRate, t.deltaAbs), improved: t.improved }, previous: formatMetric(t.previous, METRICS[key].format) };
}

/**
 * Build the KPI list for the current analytics. Each card carries its change
 * versus the previous period, so the cards double as the trend summary.
 * Metrics whose source columns are missing are simply not returned.
 */
export function buildKpis(a: Analytics): KPI[] {
  const m = a.team.metrics;
  const out: KPI[] = [];
  if (a.has('totalCalls')) out.push({ key: 'totalCalls', label: 'Total Calls', value: formatNumber(m.totalCalls), ...trend(a, 'totalCalls'), description: METRICS.totalCalls.description });
  if (a.has('connected')) {
    // Duration split (from the call log) lives inside the Connected Calls card.
    let breakdown: KPI['breakdown'];
    if (a.has('band02') && m.band02 != null) {
      const total = (m.band02 ?? 0) + (m.band24 ?? 0) + (m.band4p ?? 0);
      const pct = (n: number | null | undefined) => (total > 0 ? `${Math.round(((n ?? 0) / total) * 100)}%` : undefined);
      const days = a.team.totals.bandDates;
      breakdown = {
        items: [
          { label: '0–2 min', value: formatNumber(m.band02), share: pct(m.band02) },
          { label: '2–4 min', value: formatNumber(m.band24), share: pct(m.band24) },
          { label: '> 4 min', value: formatNumber(m.band4p), share: pct(m.band4p) },
        ],
        note: days.length === 1 ? `Duration split from the call log for ${days[0].slice(8)}/${days[0].slice(5, 7)}` : `Duration split from the call log · ${days.length} days`,
      };
    }
    out.push({ key: 'connected', label: 'Connected Calls', value: formatNumber(m.connected), ...trend(a, 'connected'), description: METRICS.connected.description, breakdown });
  }
  if (a.has('notConnected')) out.push({ key: 'notConnected', label: 'Not Connected Calls', value: formatNumber(m.notConnected), ...trend(a, 'notConnected'), description: METRICS.notConnected.description });
  if (a.has('connectionRate')) out.push({ key: 'connectionRate', label: 'Connection Rate', value: formatMetric(m.connectionRate, 'percent'), ...trend(a, 'connectionRate'), description: METRICS.connectionRate.description });
  if (a.has('talkTime')) out.push({ key: 'talkTime', label: 'Total Talk Time', value: formatDuration(m.talkTime), ...trend(a, 'talkTime'), description: METRICS.talkTime.description });
  if (a.has('avgTalkTime')) out.push({ key: 'avgTalkTime', label: 'Average Talk Time', value: formatDuration(m.avgTalkTime), ...trend(a, 'avgTalkTime'), sub: 'per connected call', description: METRICS.avgTalkTime.description });
  out.push({ key: 'activeExecs', label: 'Active Sales Executives', value: formatNumber(a.team.activeExecutives), previous: a.prevTeam ? formatNumber(a.prevTeam.activeExecutives) : undefined, sub: a.recentIds.size > a.team.activeExecutives ? `of ${formatNumber(a.recentIds.size)} active recently` : undefined, description: 'Executives with at least one call in the selected period.' });
  if (a.has('totalCalls')) out.push({ key: 'avgCallsPerExec', label: 'Avg Calls Per Executive', value: formatNumber(a.team.avgCallsPerExecutive, 1), previous: a.prevTeam?.avgCallsPerExecutive != null ? formatNumber(a.prevTeam.avgCallsPerExecutive, 1) : undefined, sub: 'for the period', description: 'Total calls divided by active executives.' });
  if (a.has('totalCalls') && a.team.highest) out.push({ key: 'highest', label: 'Highest Calls by One Executive', value: formatNumber(a.team.highest.calls), sub: a.team.highest.employee.name, description: 'Executive with the most calls in the selected period.' });
  if (a.has('score')) {
    const avgScore = (stats: Analytics['stats']) => { const s = stats.filter((x) => x.score != null); return s.length ? s.reduce((sum, x) => sum + (x.score ?? 0), 0) / s.length : null; };
    const cur = avgScore(a.stats); const prev = avgScore(a.prevStats);
    if (cur != null) out.push({ key: 'score', label: 'Team Performance Score', value: `${Math.round(cur)}`, previous: prev != null ? `${Math.round(prev)}` : undefined, delta: prev != null ? { text: `${cur - prev >= 0 ? '+' : '−'}${Math.abs(Math.round(cur - prev))} pts`, improved: cur === prev ? null : cur > prev } : undefined, sub: 'calculated · 0–100', description: METRICS.score.description });
  }
  return out;
}

/** Equal-height grid: 2 / 3 / 5 columns; ten cards fill exactly two rows on wide screens. */
export function KPIGrid({ kpis }: { kpis: KPI[] }) {
  return (
    <div className="grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {kpis.map((k) => <KPICard key={k.key} kpi={k} />)}
    </div>
  );
}
