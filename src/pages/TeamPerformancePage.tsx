import { DayOfWeekChart } from '../components/DayOfWeekChart';
import { DistributionCharts } from '../components/DistributionCharts';
import { EmployeeTable } from '../components/EmployeeTable';
import { Heatmap } from '../components/Heatmap';
import { NeedsAttention } from '../components/NeedsAttention';
import type { Analytics } from '../state/useAnalytics';
import { PeriodEmpty } from './shared';

export function TeamPerformancePage({ a }: { a: Analytics }) {
  if (a.empty) return <PeriodEmpty a={a} />;
  return (
    <div className="space-y-4">
      <EmployeeTable stats={a.stats} team={a.team} has={a.has} recentIds={a.recentIds} />
      <DistributionCharts stats={a.stats} has={a.has} />
      <Heatmap records={a.records} stats={a.stats} available={a.dataset.available} range={a.range} has={a.has} />
      <div className="grid gap-4 xl:grid-cols-2">
        <DayOfWeekChart records={a.records} available={a.dataset.available} />
        <NeedsAttention items={a.attention} />
      </div>
    </div>
  );
}
