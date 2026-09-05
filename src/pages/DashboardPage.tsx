import { useMemo } from 'react';
import { EmployeeLeaderboard } from '../components/EmployeeLeaderboard';
import { EmployeeTable } from '../components/EmployeeTable';
import { InsightsPanel } from '../components/InsightsPanel';
import { KPIGrid, buildKpis } from '../components/KPICard';
import { NeedsAttention } from '../components/NeedsAttention';
import { PerformanceChart } from '../components/PerformanceChart';
import { TrendPanel } from '../components/TrendPanel';
import { teamInsights } from '../lib/insights';
import { useRouter } from '../state/router';
import type { Analytics } from '../state/useAnalytics';
import { PeriodEmpty } from './shared';

export function DashboardPage({ a }: { a: Analytics }) {
  const { navigate } = useRouter();
  const kpis = useMemo(() => buildKpis(a), [a]);
  const insights = useMemo(() => teamInsights({
    records: a.records, stats: a.stats, team: a.team, prevTeam: a.prevTeam, daily: a.daily, available: a.dataset.available, range: a.range,
    attention: { belowAverage: a.attention.filter((x) => x.reasons.some((r) => r.label === 'Below Team Average')).map((x) => x.stat), noActivity: a.attention.filter((x) => x.stat.totals.activeDays === 0).map((x) => x.stat) },
  }), [a]);

  if (a.empty) return <PeriodEmpty a={a} />;

  return (
    <div className="space-y-4">
      <KPIGrid kpis={kpis} />
      <PerformanceChart records={a.records} prevRecords={a.prevRecords} available={a.dataset.available} employeeById={a.dataset.employeeById} range={a.range} showPreviousToggle employeeName={a.filters.employees.length === 1 ? a.dataset.employeeById.get(a.filters.employees[0])?.name : undefined} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><EmployeeLeaderboard stats={a.stats} available={a.dataset.available} /></div>
        <InsightsPanel insights={insights} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><TrendPanel current={a.team.metrics} previous={a.prevTeam?.metrics ?? null} available={a.dataset.available} range={a.range} prevRange={a.prevRange} /></div>
        <NeedsAttention items={a.attention} limit={5} />
      </div>
      <EmployeeTable stats={a.stats} team={a.team} has={a.has} compact onShowAll={() => navigate('team')} />
    </div>
  );
}
