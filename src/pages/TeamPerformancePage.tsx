import { DayOfWeekChart } from '../components/DayOfWeekChart';
import { DistributionCharts } from '../components/DistributionCharts';
import { DurationBands } from '../components/DurationBands';
import { EmployeeTable } from '../components/EmployeeTable';
import { NeedsAttention } from '../components/NeedsAttention';
import type { Analytics } from '../state/useAnalytics';
import { PeriodEmpty } from './shared';

export function TeamPerformancePage({ a }: { a: Analytics }) {
  if (a.empty) return <PeriodEmpty a={a} />;
  return (
    <div className="space-y-4">
      <EmployeeTable stats={a.stats} team={a.team} has={a.has} recentIds={a.recentIds} />
      <div className="grid gap-4 xl:grid-cols-2">
        {a.has('band02') && <DurationBands stats={a.stats} teamTotals={a.team.totals} compact />}
        <DistributionCharts stats={a.stats} has={a.has} fill />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <DayOfWeekChart records={a.records} available={a.dataset.available} />
        <NeedsAttention items={a.attention} />
      </div>
    </div>
  );
}
