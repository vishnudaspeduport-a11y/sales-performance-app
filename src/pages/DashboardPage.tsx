import { useMemo } from 'react';
import { DurationBands } from '../components/DurationBands';
import { EmployeeLeaderboard } from '../components/EmployeeLeaderboard';
import { EmployeeTable } from '../components/EmployeeTable';
import { InsightsPanel } from '../components/InsightsPanel';
import { KPIGrid, buildKpis } from '../components/KPICard';
import { NeedsAttention } from '../components/NeedsAttention';
import { PerformanceChart } from '../components/PerformanceChart';
import { TrendPanel } from '../components/TrendPanel';
import { LayoutToolbar, PageSections, usePageLayout, type PageSection } from '../components/layout/PageLayout';
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

  // Section registry: the default order for everyone; viewers can reorder/hide in their browser.
  const sections = useMemo<PageSection[]>(() => [
    { key: 'kpis', title: 'KPI cards', render: () => <KPIGrid kpis={kpis} /> },
    { key: 'chart', title: 'Daily Performance chart', render: () => <PerformanceChart records={a.records} prevRecords={a.prevRecords} available={a.dataset.available} employeeById={a.dataset.employeeById} range={a.range} showPreviousToggle employeeName={a.filters.employees.length === 1 ? a.dataset.employeeById.get(a.filters.employees[0])?.name : undefined} /> },
    { key: 'leaderboard', title: 'Top Performers and Team Insights', render: () => (
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><EmployeeLeaderboard stats={a.stats} available={a.dataset.available} /></div>
        <InsightsPanel insights={insights} />
      </div>
    ) },
    { key: 'trend', title: 'Trend vs Previous Period', render: () => <TrendPanel current={a.team.metrics} previous={a.prevTeam?.metrics ?? null} available={a.dataset.available} range={a.range} prevRange={a.prevRange} /> },
    { key: 'bands', title: 'Call Duration Bands', unavailable: !a.has('band02'), render: () => <DurationBands stats={a.stats} teamTotals={a.team.totals} /> },
    { key: 'attention', title: 'Needs Attention', render: () => <NeedsAttention items={a.attention} limit={9} /> },
    { key: 'table', title: 'Sales Executive Performance table', render: () => <EmployeeTable stats={a.stats} team={a.team} has={a.has} compact onShowAll={() => navigate('team')} /> },
  ], [a, kpis, insights, navigate]);
  const layout = usePageLayout('dashboard', sections);

  if (a.empty) return <PeriodEmpty a={a} />;

  return (
    <div className="space-y-4">
      <LayoutToolbar layout={layout} sectionCount={sections.filter((s) => !s.unavailable).length} />
      <PageSections layout={layout} sections={sections} />
    </div>
  );
}
