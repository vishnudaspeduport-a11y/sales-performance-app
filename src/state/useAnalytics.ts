import { useMemo } from 'react';
import { METRICS, isMetricAvailable, type MetricKey } from '../config/metrics';
import { previousRange } from '../lib/dates';
import { findNeedsAttention, type AttentionItem } from '../lib/insights';
import { computeEmployeeStats, computeTeamStats, groupByPeriod, rankBy, type EmployeeStats, type PeriodPoint, type TeamStats } from '../lib/metrics';
import type { DailyRecord, Dataset, Employee, Filters } from '../types';
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

export function useAnalytics(): Analytics | null {
  const { dataset } = useData();
  const { filters, attention } = useFilters();
  return useMemo(() => {
    if (!dataset) return null;
    const range = { from: filters.from, to: filters.to };
    const prevRange = previousRange(range.from, range.to);
    const employees = dataset.employees.filter((e) => employeePasses(e, filters, dataset.dims));
    const empSet = new Set(employees.map((e) => e.id));
    const inScope = (r: DailyRecord) => empSet.has(r.empId) && rowPasses(r, filters, dataset.dims);
    const records: DailyRecord[] = []; const prevRecords: DailyRecord[] = [];
    for (const r of dataset.records) {
      if (r.date >= range.from && r.date <= range.to) { if (inScope(r)) records.push(r); }
      else if (r.date >= prevRange.from && r.date <= prevRange.to) { if (inScope(r)) prevRecords.push(r); }
    }
    const stats = computeEmployeeStats(records, employees, dataset.available);
    const prevStats = computeEmployeeStats(prevRecords, employees, dataset.available);
    const ranked = rankBy(stats, 'totalCalls');
    const team = computeTeamStats(records, stats, dataset.available);
    const prevTeam = prevRecords.length ? computeTeamStats(prevRecords, prevStats, dataset.available) : null;
    const daily = groupByPeriod(records, 'daily', dataset.available, dataset.employeeById);
    const attentionItems = findNeedsAttention({ stats, prevStats, team, config: attention, range });
    const recentIds = new Set<string>();
    for (const s of stats) if (s.totals.activeDays > 0) recentIds.add(s.employee.id);
    for (const s of prevStats) if (s.totals.activeDays > 0) recentIds.add(s.employee.id);
    const has = (key: MetricKey) => isMetricAvailable(METRICS[key], dataset.available);
    return { dataset, filters, range, prevRange, employees, records, prevRecords, stats, prevStats, ranked, team, prevTeam, daily, attention: attentionItems, recentIds, has, empty: records.length === 0 };
  }, [dataset, filters, attention]);
}
