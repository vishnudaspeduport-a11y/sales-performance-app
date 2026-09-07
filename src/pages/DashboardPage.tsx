import { useMemo } from 'react';
import { DurationBands } from '../components/DurationBands';
import { EmployeeLeaderboard } from '../components/EmployeeLeaderboard';
import { InsightsPanel } from '../components/InsightsPanel';
import { KPIGrid, buildKpis } from '../components/KPICard';
import { NeedsAttention } from '../components/NeedsAttention';
import { PerformanceChart } from '../components/PerformanceChart';
import { formatRange } from '../lib/dates';
import { teamInsights } from '../lib/insights';
import type { Analytics } from '../state/useAnalytics';
import { PeriodEmpty } from './shared';

export function DashboardPage({ a }: { a: Analytics }) {
  const kpis = useMemo(() => buildKpis(a), [a]);
  const insights = useMemo(() => teamInsights({
    records: a.records, stats: a.stats, team: a.team, prevTeam: a.prevTeam, daily: a.daily, available: a.dataset.available, range: a.range,
    attention: { belowAverage: a.attention.filter((x) => x.reasons.some((r) => r.label === 'Below Team Average')).map((x) => x.stat), noActivity: a.attention.filter((x) => x.stat.totals.activeDays === 0).map((x) => x.stat) },
  }), [a]);

  if (a.empty) return <PeriodEmpty a={a} />;

  return (
    <div className="space-y-4">
      {/* KPI cards double as the trend summary: value, change and previous-period value */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold text-ink dark:text-ink-dark">Period overview</h2>
          <span className="text-xs text-ink-muted">{formatRange(a.range.from, a.range.to)}{a.prevTeam ? ` · change vs ${formatRange(a.prevRange.from, a.prevRange.to)}` : ' · no previous-period data'}</span>
        </div>
        <KPIGrid kpis={kpis} />
      </div>
      <PerformanceChart records={a.records} prevRecords={a.prevRecords} available={a.dataset.available} employeeById={a.dataset.employeeById} range={a.range} showPreviousToggle employeeName={a.filters.employees.length === 1 ? a.dataset.employeeById.get(a.filters.employees[0])?.name : undefined} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><EmployeeLeaderboard stats={a.stats} available={a.dataset.available} /></div>
        <InsightsPanel insights={insights} />
      </div>
      {a.has('band02') && <DurationBands stats={a.stats} teamTotals={a.team.totals} />}
      <NeedsAttention items={a.attention} limit={9} />
    </div>
  );
}
