import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { PRESET_LABELS, formatRange, isIsoDate, previousRange } from '../lib/dates';
import { useData } from '../state/DataContext';
import { useFilters } from '../state/FilterContext';
import type { DatePreset } from '../types';
import { Button, MultiSelect, Select } from './ui/Controls';

const PRESETS: DatePreset[] = ['today', 'yesterday', 'last7', 'last30', 'thisWeek', 'thisMonth', 'prevMonth', 'all', 'custom'];

export function DashboardFilters() {
  const { dataset } = useData();
  const { filters, setPreset, setCustomRange, setEmployees, setDim, reset, isDefault } = useFilters();

  const employeeOptions = useMemo(() => (dataset?.employees ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.id.startsWith('NAME:') ? undefined : e.id })), [dataset]);

  const dimOptions = useMemo(() => {
    if (!dataset) return [];
    return dataset.dims.map((d) => {
      const values = new Set<string>();
      if (d.perRow) for (const r of dataset.records) values.add(r.dims[d.key] || '(Unassigned)');
      else for (const e of dataset.employees) {
        const v = (e as unknown as Record<string, unknown>)[d.key];
        if (Array.isArray(v)) { if (!v.length) values.add('(Unassigned)'); v.forEach((x) => values.add(String(x))); }
        else values.add(String(v || '') || '(Unassigned)');
      }
      const opts = [...values].sort((a, b) => (a === '(Unassigned)' ? 1 : b === '(Unassigned)' ? -1 : a.localeCompare(b))).map((v) => ({ value: v, label: v }));
      return { dim: d, options: opts };
    }).filter((x) => x.options.length > 1);
  }, [dataset]);

  const range = dataset?.dateRange ?? null;
  const onDate = (value: string, apply: (v: string) => void) => { if (isIsoDate(value) && value >= '2000-01-01') apply(value); };
  const invalid = !isIsoDate(filters.from) || !isIsoDate(filters.to) || filters.from > filters.to;
  const prev = !invalid ? previousRange(filters.from, filters.to) : null;

  return (
    <section aria-label="Filters" className="rounded-xl border border-line bg-surface p-3 shadow-card dark:border-line-dark dark:bg-surface-dark sm:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select ariaLabel="Date range preset" value={filters.preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))} className="w-full sm:w-44" />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="from-date">From date</label>
          <input id="from-date" type="date" value={filters.from} min={range?.from} max={range?.to} onChange={(e) => onDate(e.target.value, (v) => setCustomRange(v, filters.to))} className="h-9 w-full min-w-[9.5rem] rounded-lg border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
          <span className="text-xs text-ink-muted">to</span>
          <label className="sr-only" htmlFor="to-date">To date</label>
          <input id="to-date" type="date" value={filters.to} min={range?.from} max={range?.to} onChange={(e) => onDate(e.target.value, (v) => setCustomRange(filters.from, v))} className="h-9 w-full min-w-[9.5rem] rounded-lg border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
        </div>
        <MultiSelect label="Sales Executive" placeholder="All Sales Executives" options={employeeOptions} selected={filters.employees} onChange={setEmployees} className="w-full sm:w-64" />
        {dimOptions.map(({ dim, options }) => (
          <MultiSelect key={dim.key} label={dim.label} placeholder="All" options={options} selected={filters.dims[dim.key] ?? []} onChange={(v) => setDim(dim.key, v)} className="w-full sm:w-48" />
        ))}
        <div className="flex w-full items-center justify-end sm:ml-auto sm:w-auto">
          <Button onClick={reset} disabled={isDefault} className="w-full sm:w-auto"><RotateCcw className="h-3.5 w-3.5" /> Reset Filters</Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        {invalid ? (
          <span className="text-status-critical">Invalid date range: the From date must be on or before the To date.</span>
        ) : (
          <>
            <span>Period: <span className="font-medium text-ink-secondary dark:text-ink-dark-secondary">{formatRange(filters.from, filters.to)}</span></span>
            {prev && <span>Compared with: {formatRange(prev.from, prev.to)}</span>}
            {range && <span>Data available: {formatRange(range.from, range.to)}</span>}
          </>
        )}
      </div>
    </section>
  );
}
