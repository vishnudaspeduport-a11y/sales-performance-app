import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { PRESET_LABELS, formatRange, isIsoDate, previousRange } from '../lib/dates';
import { useData } from '../state/DataContext';
import { useFilters } from '../state/FilterContext';
import type { DatePreset, Employee } from '../types';
import { Button, MultiSelect, Select } from './ui/Controls';

const PRESETS: DatePreset[] = ['today', 'yesterday', 'last7', 'last30', 'thisWeek', 'thisMonth', 'prevMonth', 'all', 'custom'];

/** Manager and BDM/Tag describe the same thing; show only Manager when it exists. */
function visibleDims<T extends { key: string }>(dims: T[]): T[] {
  const hasManager = dims.some((d) => d.key === 'manager');
  return dims.filter((d) => !(hasManager && d.key === 'tags'));
}

function employeeValue(e: Employee, key: string): string[] {
  const v = (e as unknown as Record<string, unknown>)[key];
  if (Array.isArray(v)) return v.length ? v.map(String) : ['(Unassigned)'];
  return [String(v || '') || '(Unassigned)'];
}

export function DashboardFilters() {
  const { dataset } = useData();
  const { filters, setPreset, setCustomRange, setEmployees, setDim, reset, isDefault } = useFilters();
  const dims = useMemo(() => (dataset ? visibleDims(dataset.dims) : []), [dataset]);

  // Executives offered in the picker: only those matching the selected manager / other dimension filters.
  const scopedEmployees = useMemo(() => {
    if (!dataset) return [];
    return dataset.employees.filter((e) => dims.every((d) => {
      if ((d as { perRow?: boolean }).perRow) return true;
      const sel = filters.dims[d.key];
      if (!sel || !sel.length) return true;
      return employeeValue(e, d.key).some((v) => sel.includes(v));
    }));
  }, [dataset, dims, filters.dims]);
  const employeeOptions = useMemo(() => scopedEmployees.map((e) => ({ value: e.id, label: e.name, hint: e.id.startsWith('NAME:') ? undefined : e.id })), [scopedEmployees]);

  // Drop selected executives that fall outside the chosen manager.
  useEffect(() => {
    if (!filters.employees.length) return;
    const allowed = new Set(scopedEmployees.map((e) => e.id));
    const kept = filters.employees.filter((id) => allowed.has(id));
    if (kept.length !== filters.employees.length) setEmployees(kept);
  }, [scopedEmployees, filters.employees, setEmployees]);

  const dimOptions = useMemo(() => {
    if (!dataset) return [];
    return dims.map((d) => {
      const values = new Set<string>();
      if ((d as { perRow?: boolean }).perRow) for (const r of dataset.records) values.add(r.dims[d.key] || '(Unassigned)');
      else for (const e of dataset.employees) employeeValue(e, d.key).forEach((v) => values.add(v));
      const opts = [...values].sort((a, b) => (a === '(Unassigned)' ? 1 : b === '(Unassigned)' ? -1 : a.localeCompare(b))).map((v) => ({ value: v, label: v }));
      return { dim: d, options: opts };
    }).filter((x) => x.options.length > 1);
  }, [dataset, dims]);

  const range = dataset?.dateRange ?? null;
  const onDate = (value: string, apply: (v: string) => void) => { if (isIsoDate(value) && value >= '2000-01-01') apply(value); };
  const invalid = !isIsoDate(filters.from) || !isIsoDate(filters.to) || filters.from > filters.to;
  const prev = !invalid ? previousRange(filters.from, filters.to) : null;
  const managerSel = filters.dims.manager ?? [];

  return (
    <section aria-label="Filters" className="rounded-2xl border border-line/70 bg-surface p-3 shadow-card dark:border-line-dark dark:bg-surface-dark sm:p-4">
      <div className="flex flex-wrap items-center gap-2 2xl:flex-nowrap">
        <Select ariaLabel="Date range preset" value={filters.preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))} className="w-full shrink-0 sm:w-40" />
        <div className="flex w-full shrink-0 items-center gap-1.5 sm:w-auto">
          <label className="sr-only" htmlFor="from-date">From date</label>
          <input id="from-date" type="date" value={filters.from} onChange={(e) => onDate(e.target.value, (v) => setCustomRange(v, filters.to))} className="h-9 w-full min-w-[8.5rem] rounded-xl border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
          <span className="text-xs text-ink-muted">to</span>
          <label className="sr-only" htmlFor="to-date">To date</label>
          <input id="to-date" type="date" value={filters.to} onChange={(e) => onDate(e.target.value, (v) => setCustomRange(filters.from, v))} className="h-9 w-full min-w-[8.5rem] rounded-xl border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
        </div>
        {dimOptions.map(({ dim, options }) => (
          <MultiSelect key={dim.key} label={dim.key === 'manager' ? 'Manager' : dim.label} placeholder="All" options={options} selected={filters.dims[dim.key] ?? []} onChange={(v) => setDim(dim.key, v)} className="w-full shrink-0 sm:w-44" />
        ))}
        <MultiSelect label="Sales Executive" placeholder={managerSel.length ? `All under ${managerSel.length === 1 ? managerSel[0] : `${managerSel.length} managers`}` : 'All Sales Executives'} options={employeeOptions} selected={filters.employees} onChange={setEmployees} className="w-full min-w-0 sm:w-56 2xl:flex-1" />
        <div className="flex w-full shrink-0 items-center justify-end sm:ml-auto sm:w-auto">
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
            {managerSel.length > 0 && <span>{employeeOptions.length} executive(s) under the selected manager(s)</span>}
          </>
        )}
      </div>
    </section>
  );
}
