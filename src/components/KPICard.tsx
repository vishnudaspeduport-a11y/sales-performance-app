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
  description?: string;
}

export function KPICard({ kpi }: { kpi: KPI }) {
  const d = kpi.delta;
  const tone = d?.improved == null ? 'text-ink-muted' : d.improved ? 'text-[#006300] dark:text-[#5fd35f]' : 'text-[#8f1f1f] dark:text-[#f08c8c]';
  const Icon = d?.improved == null ? Minus : d.improved ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card dark:border-line-dark dark:bg-surface-dark" title={kpi.description}>
      <div className="truncate text-xs font-medium text-ink-muted">{kpi.label}</div>
      <div className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink dark:text-ink-dark">{kpi.value}</div>
      <div className="mt-1 flex min-h-[1rem] items-center gap-2 text-xs">
        {d && (
          <span className={`inline-flex items-center gap-0.5 whitespace-nowrap font-medium ${tone}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {d.text}
          </span>
        )}
        {kpi.sub && <span className="truncate text-ink-muted">{kpi.sub}</span>}
      </div>
    </div>
  );
}

function delta(a: Analytics, key: MetricKey): KPI['delta'] | undefined {
  if (!a.prevTeam) return undefined;
  const [t] = compareMetrics(a.team.metrics, a.prevTeam.metrics, [key]);
  if (t.previous == null || t.current == null) return undefined;
  return { text: formatDelta(t.deltaPct, t.isRate, t.deltaAbs), improved: t.improved };
}

/** Build the KPI list for the current analytics. Metrics whose source columns are missing are simply not returned. */
export function buildKpis(a: Analytics): KPI[] {
  const m = a.team.metrics;
  const out: KPI[] = [];
  const vsPrev = a.prevTeam ? 'vs previous period' : undefined;
  if (a.has('totalCalls')) out.push({ key: 'totalCalls', label: 'Total Calls', value: formatNumber(m.totalCalls), delta: delta(a, 'totalCalls'), sub: vsPrev, description: METRICS.totalCalls.description });
  if (a.has('connected')) out.push({ key: 'connected', label: 'Connected Calls', value: formatNumber(m.connected), delta: delta(a, 'connected'), sub: vsPrev, description: METRICS.connected.description });
  if (a.has('notConnected')) out.push({ key: 'notConnected', label: 'Not Connected Calls', value: formatNumber(m.notConnected), delta: delta(a, 'notConnected'), sub: vsPrev, description: METRICS.notConnected.description });
  if (a.has('connectionRate')) out.push({ key: 'connectionRate', label: 'Connection Rate', value: formatMetric(m.connectionRate, 'percent'), delta: delta(a, 'connectionRate'), sub: vsPrev, description: METRICS.connectionRate.description });
  if (a.has('talkTime')) out.push({ key: 'talkTime', label: 'Total Talk Time', value: formatDuration(m.talkTime), delta: delta(a, 'talkTime'), sub: vsPrev, description: METRICS.talkTime.description });
  if (a.has('avgTalkTime')) out.push({ key: 'avgTalkTime', label: 'Average Talk Time', value: formatDuration(m.avgTalkTime), delta: delta(a, 'avgTalkTime'), sub: 'per connected call', description: METRICS.avgTalkTime.description });
  out.push({ key: 'activeExecs', label: 'Active Sales Executives', value: formatNumber(a.team.activeExecutives), sub: a.recentIds.size > a.team.activeExecutives ? `of ${formatNumber(a.recentIds.size)} active recently` : undefined, description: 'Executives with at least one call in the selected period. "Active recently" counts those with activity in this or the previous period.' });
  if (a.has('totalCalls')) out.push({ key: 'avgCallsPerExec', label: 'Avg Calls Per Executive', value: formatNumber(a.team.avgCallsPerExecutive, 1), sub: 'for the period', description: 'Total calls divided by active executives.' });
  if (a.has('totalCalls') && a.team.highest) out.push({ key: 'highest', label: 'Highest Calls by One Executive', value: formatNumber(a.team.highest.calls), sub: a.team.highest.employee.name, description: 'Executive with the most calls in the selected period.' });
  if (a.has('connected')) out.push({ key: 'avgConnected', label: 'Avg Connected Calls', value: formatNumber(a.team.avgConnectedPerExecutive, 1), sub: 'per executive', description: 'Connected calls divided by active executives.' });
  if (a.has('band02') && m.band02 != null) {
    const days = a.team.totals.bandDates;
    const sub = days.length === 1 ? `call log · ${days[0].slice(8)}/${days[0].slice(5, 7)}` : `call log · ${days.length} days`;
    out.push({ key: 'band02', label: 'Calls 0–2 min', value: formatNumber(m.band02), sub, description: METRICS.band02.description });
    out.push({ key: 'band24', label: 'Calls 2–4 min', value: formatNumber(m.band24), sub, description: METRICS.band24.description });
    out.push({ key: 'band4p', label: 'Calls over 4 min', value: formatNumber(m.band4p), sub, description: METRICS.band4p.description });
  }
  if (a.has('score')) {
    const scored = a.stats.filter((s) => s.score != null);
    if (scored.length) {
      const avg = scored.reduce((s, x) => s + (x.score ?? 0), 0) / scored.length;
      out.push({ key: 'score', label: 'Team Performance Score', value: `${Math.round(avg)}`, sub: 'calculated · 0–100', description: METRICS.score.description });
    }
  }
  return out;
}

export function KPIGrid({ kpis }: { kpis: KPI[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      {kpis.map((k) => <KPICard key={k.key} kpi={k} />)}
    </div>
  );
}
