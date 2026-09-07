import { useMemo } from 'react';
import { METRICS, isMetricAvailable, type MetricKey } from '../config/metrics';
import { previousRange } from '../lib/dates';
import { findNeedsAttention, type AttentionItem } from '../lib/insights';
import { computeEmployeeStats, computeTeamStats, groupByPeriod, rankBy, type EmployeeStats, type PeriodPoint, type TeamStats } from '../lib/metrics';
import type { AttentionConfig, DailyRecord, Dataset, Employee, Filters } from '../types';
import { useData } from './DataContext';
import { useFilters } from './FilterContext';

export interface Analytics {
  dataset: Dataset;
  filters: Filters;
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  /** employees passing the employee/dimension filters (including those with no activity) */
  employees: Employee[];
  records: DailyRecord[];
  prevRecords: DailyRecord[];
  stats: EmployeeStats[];
  prevStats: EmployeeStats[];
  ranked: EmployeeStats[];
  team: TeamStats;
  prevTeam: TeamStats | null;
  daily: PeriodPoint[];
  attention: AttentionItem[];
  /** ids of employees with activity in the current or previous period */
  recentIds: Set<string>;
  has: (key: MetricKey) => boolean;
  /** true when the whole dataset has no rows in range */
  empty: boolean;
}

function employeePasses(e: Employee, filters: Filters, dims: Dataset['dims']): boolean {
  if (filters.employees.length && !filters.employees.includes(e.id)) return false;
  for (const d of dims) {
    if (d.perRow) continue;
    const sel = filters.dims[d.key];
    if (!sel || !sel.length) continue;
    if (d.multi) {
      const vals = (e as unknown as Record<string, unknown>)[d.key];
      const arr = Array.isArray(vals) ? (vals as string[]) : [];
      if (!arr.some((v) => sel.includes(v))) return false;
    } else {
      const v = String((e as unknown as Record<string, unknown>)[d.key] ?? '');
      if (!sel.includes(v || '(Unassigned)')) return false;
    }
  }
  return true;
}

function rowPasses(r: DailyRecord, filters: Filters, dims: Dataset['dims']): boolean {
  for (const d of dims) {
    if (!d.perRow) continue;
    const sel = filters.dims[d.key];
    if (!sel || !sel.length) continue;
    if (!sel.includes(r.dims[d.key] || '(Unassigned)')) return false;
  }
  return true;
}

/** Employees in scope for the given filters (ignoring the date range). */
export function scopedEmployees(dataset: Dataset, filters: Filters): Employee[] {
  return dataset.employees.filter((e) => employeePasses(e, filters, dataset.dims));
}

/** Records of the scoped employees within a date range. */
export function scopedRecords(dataset: Dataset, filters: Filters, employees: Employee[], range: { from: string; to: string }): DailyRecord[] {
  const empSet = new Set(employees.map((e) => e.id));
  const out: DailyRecord[] = [];
  for (const r of dataset.records) {
    if (r.date < range.from || r.date > range.to) continue;
    if (empSet.has(r.empId) && rowPasses(r, filters, dataset.dims)) out.push(r);
  }
  return out;
}

export interface RangeStats {
  range: { from: string; to: string };
  records: DailyRecord[];
  stats: EmployeeStats[];
  team: TeamStats;
}

/** Full per-employee and team statistics for an arbitrary date range under the current filters. */
export function computeRangeStats(dataset: Dataset, filters: Filters, range: { from: string; to: string }, employees = scopedEmployees(dataset, filters)): RangeStats {
  const records = scopedRecords(dataset, filters, employees, range);
  const stats = computeEmployeeStats(records, employees, dataset.available);
  const team = computeTeamStats(records, stats, dataset.available);
  return { range, records, stats, team };
}

export function computeAnalytics(dataset: Dataset, filters: Filters, attention: AttentionConfig): Analytics {
  const range = { from: filters.from, to: filters.to };
  const prevRange = previousRange(range.from, range.to);
  const employees = scopedEmployees(dataset, filters);
  const cur = computeRangeStats(dataset, filters, range, employees);
  const prev = computeRangeStats(dataset, filters, prevRange, employees);
  const ranked = rankBy(cur.stats, 'totalCalls');
  const prevTeam = prev.records.length ? prev.team : null;
  const daily = groupByPeriod(cur.records, 'daily', dataset.available, dataset.employeeById);
  const attentionItems = findNeedsAttention({ stats: cur.stats, prevStats: prev.stats, team: cur.team, config: attention, range });
  const recentIds = new Set<string>();
  for (const s of cur.stats) if (s.totals.activeDays > 0) recentIds.add(s.employee.id);
  for (const s of prev.stats) if (s.totals.activeDays > 0) recentIds.add(s.employee.id);
  const has = (key: MetricKey) => isMetricAvailable(METRICS[key], dataset.available);
  return { dataset, filters, range, prevRange, employees, records: cur.records, prevRecords: prev.records, stats: cur.stats, prevStats: prev.stats, ranked, team: cur.team, prevTeam, daily, attention: attentionItems, recentIds, has, empty: cur.records.length === 0 };
}

export function useAnalytics(): Analytics | null {
  const { dataset } = useData();
  const { filters, attention } = useFilters();
  return useMemo(() => (dataset ? computeAnalytics(dataset, filters, attention) : null), [dataset, filters, attention]);
}
