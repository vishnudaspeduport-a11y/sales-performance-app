import { DayOfWeekChart } from '../components/DayOfWeekChart';
import { DistributionCharts } from '../components/DistributionCharts';
import { DurationBands } from '../components/DurationBands';
import { EmployeeTable } from '../components/EmployeeTable';
import { NeedsAttention } from '../components/NeedsAttention';
import type { Analytics } from '../state/useAnalytics';
import { useView } from '../state/ViewContext';
import { PeriodEmpty } from './shared';

/** Columns the manager view shows in Sales Executive Performance, in this order (after Rank and the name). */
const MANAGER_COLUMNS = ['rank', 'talkTime', 'band02', 'band24', 'band4p', 'effectiveRate', 'activeDays', 'score'] as const;

export function TeamPerformancePage({ a }: { a: Analytics }) {
  const { view } = useView();
  if (a.empty) return <PeriodEmpty a={a} />;
  return (
    <div className="space-y-4">
      <EmployeeTable stats={a.stats} team={a.team} has={a.has} recentIds={a.recentIds} fixedColumns={view === 'manager' ? [...MANAGER_COLUMNS] : undefined} />
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
