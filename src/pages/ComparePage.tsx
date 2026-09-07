import { useEffect, useMemo, useState } from 'react';
import { ComparisonChart } from '../components/ComparisonChart';
import { PeriodComparison } from '../components/PeriodComparison';
import { Card } from '../components/ui/Card';
import { Button, MultiSelect, Segmented } from '../components/ui/Controls';
import { EmptyState } from '../components/ui/States';
import { formatNumber } from '../lib/format';
import type { Analytics } from '../state/useAnalytics';

const MAX = 5;

export function ComparePage({ a, initialId }: { a: Analytics; initialId?: string }) {
  const [mode, setMode] = useState<'employees' | 'periods'>('employees');
  const [selected, setSelected] = useState<string[]>(initialId ? [initialId] : []);
  useEffect(() => { if (initialId && !selected.includes(initialId)) setSelected((s) => [initialId, ...s].slice(0, MAX)); }, [initialId]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(() => a.ranked.map((s) => ({ value: s.employee.id, label: s.employee.name, hint: s.totals.activeDays ? `${formatNumber(s.metrics.totalCalls)} calls` : 'no activity' })), [a.ranked]);
  const stats = useMemo(() => selected.map((id) => a.stats.find((s) => s.employee.id === id)).filter((s): s is NonNullable<typeof s> => !!s), [selected, a.stats]);

  const quickTop = () => setSelected(a.ranked.filter((s) => s.totals.activeDays > 0).slice(0, 3).map((s) => s.employee.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Comparison mode" size="md" value={mode} onChange={setMode} options={[{ value: 'employees', label: 'Employees side by side' }, { value: 'periods', label: 'Same scope, two periods' }]} />
        <span className="text-xs text-ink-muted">{mode === 'employees' ? 'Compare up to five executives over the selected period.' : 'Compare the team or one executive across two date ranges.'}</span>
      </div>

      {mode === 'periods' ? (
        <PeriodComparison a={a} />
      ) : (
        <>
          <Card title="Compare Employees" subtitle={`Select 2 to ${MAX} sales executives · metrics use the selected period`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <MultiSelect label="Executives" placeholder="Choose executives" options={options} selected={selected} onChange={setSelected} max={MAX} className="w-full sm:w-80" />
              <Button size="sm" variant="ghost" onClick={quickTop}>Top 3 by calls</Button>
              {selected.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>}
            </div>
            {stats.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {stats.map((s) => (
                  <span key={s.employee.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-ink dark:border-line-dark dark:text-ink-dark">
                    {s.employee.name}
                    <button type="button" aria-label={`Remove ${s.employee.name}`} className="text-ink-muted hover:text-ink dark:hover:text-ink-dark" onClick={() => setSelected((sel) => sel.filter((x) => x !== s.employee.id))}>×</button>
                  </span>
                ))}
              </div>
            )}
          </Card>
          {stats.length < 2 ? (
            <div className="rounded-xl border border-line bg-surface shadow-card dark:border-line-dark dark:bg-surface-dark">
              <EmptyState title={stats.length === 0 ? 'Choose executives to compare' : 'Choose at least one more executive'} message="Pick between two and five sales executives from the list above." />
            </div>
          ) : (
            <ComparisonChart stats={stats} has={a.has} />
          )}
        </>
      )}
    </div>
  );
}
