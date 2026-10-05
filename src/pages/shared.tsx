import { EmptyState } from '../components/ui/States';
import { Button } from '../components/ui/Controls';
import { formatRange } from '../lib/dates';
import { useFilters } from '../state/FilterContext';
import type { Analytics } from '../state/useAnalytics';

/** Friendly empty state for a period with no rows, with shortcuts to a range that has data. */
export function PeriodEmpty({ a }: { a: Analytics }) {
  const { setPreset, setCustomRange, reset, isDefault } = useFilters();
  const dr = a.dataset.dateRange;
  const filtered = a.filters.employees.length > 0 || Object.values(a.filters.dims).some((v) => v.length);
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card dark:border-line-dark dark:bg-surface-dark">
      <EmptyState
        title={filtered ? 'No activity matches the current filters' : 'No activity recorded in this period'}
        message={
          <>
            {formatRange(a.range.from, a.range.to)} has no rows in the DB data{filtered ? ' for the selected executives or teams' : ''}.
            {dr && <> Data is available from {formatRange(dr.from, dr.to)}.</>}
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {dr && <Button variant="primary" size="sm" onClick={() => setCustomRange(dr.to, dr.to)}>Show latest day ({formatRange(dr.to, dr.to)})</Button>}
            {dr && <Button size="sm" onClick={() => setPreset('all')}>Show all data</Button>}
            {!isDefault && <Button size="sm" variant="ghost" onClick={reset}>Reset filters</Button>}
          </div>
        }
      />
    </div>
  );
}
