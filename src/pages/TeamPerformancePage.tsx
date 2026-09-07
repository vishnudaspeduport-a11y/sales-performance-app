import { useMemo } from 'react';
import { DayOfWeekChart } from '../components/DayOfWeekChart';
import { DistributionCharts } from '../components/DistributionCharts';
import { DurationBands } from '../components/DurationBands';
import { EmployeeTable } from '../components/EmployeeTable';
import { Heatmap } from '../components/Heatmap';
import { NeedsAttention } from '../components/NeedsAttention';
import { LayoutToolbar, PageSections, usePageLayout, type PageSection } from '../components/layout/PageLayout';
import type { Analytics } from '../state/useAnalytics';
import { PeriodEmpty } from './shared';

export function TeamPerformancePage({ a }: { a: Analytics }) {
  const sections = useMemo<PageSection[]>(() => [
    { key: 'table', title: 'Sales Executive Performance table', render: () => <EmployeeTable stats={a.stats} team={a.team} has={a.has} recentIds={a.recentIds} /> },
    { key: 'bands', title: 'Call Duration Bands', unavailable: !a.has('band02'), render: () => <DurationBands stats={a.stats} teamTotals={a.team.totals} /> },
    { key: 'distribution', title: 'Call Distribution', render: () => <DistributionCharts stats={a.stats} has={a.has} /> },
    { key: 'heatmap', title: 'Daily Team Heatmap', render: () => <Heatmap records={a.records} stats={a.stats} available={a.dataset.available} range={a.range} has={a.has} /> },
    { key: 'dow', title: 'Day-of-Week Analysis', render: () => <DayOfWeekChart records={a.records} available={a.dataset.available} /> },
    { key: 'attention', title: 'Needs Attention', render: () => <NeedsAttention items={a.attention} /> },
  ], [a]);
  const layout = usePageLayout('team', sections);

  if (a.empty) return <PeriodEmpty a={a} />;

  return (
    <div className="space-y-4">
      <LayoutToolbar layout={layout} sectionCount={sections.filter((s) => !s.unavailable).length} />
      <PageSections layout={layout} sections={sections} />
    </div>
  );
}
