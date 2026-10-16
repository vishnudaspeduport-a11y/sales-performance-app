import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_ATTENTION } from '../config/metrics';
import { presetRange, todayIST } from '../lib/dates';
import type { AttentionConfig, DatePreset, Filters } from '../types';
import { useData } from './DataContext';

const DEFAULT_PRESET: DatePreset = 'today';

interface FilterState {
  filters: Filters;
  setPreset: (p: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
  setEmployees: (ids: string[]) => void;
  setDim: (key: string, values: string[]) => void;
  reset: () => void;
  attention: AttentionConfig;
  setAttention: (c: AttentionConfig) => void;
  isDefault: boolean;
}

const FilterContext = createContext<FilterState | null>(null);

function initialFilters(dataRange: { from: string; to: string } | null): Filters {
  const r = presetRange(DEFAULT_PRESET, dataRange);
  return { preset: DEFAULT_PRESET, from: r.from, to: r.to, employees: [], dims: {} };
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const { dataset } = useData();
  const dataRange = dataset?.dateRange ?? null;
  const [filters, setFilters] = useState<Filters>(() => initialFilters(null));
  const [attention, setAttention] = useState<AttentionConfig>(DEFAULT_ATTENTION);

  // Re-resolve relative presets when the day changes (IST) — keep it cheap.
  useEffect(() => {
    const id = setInterval(() => {
      setFilters((f) => {
        if (f.preset === 'custom') return f;
        const r = presetRange(f.preset, dataRange, todayIST());
        return r.from === f.from && r.to === f.to ? f : { ...f, ...r };
      });
    }, 60000);
    return () => clearInterval(id);
  }, [dataRange]);

  // When data arrives and the preset is "all", resolve it against the real range.
  useEffect(() => {
    setFilters((f) => (f.preset === 'all' ? { ...f, ...presetRange('all', dataRange) } : f));
  }, [dataRange]);

  const setPreset = useCallback((preset: DatePreset) => {
    startTransition(() => setFilters((f) => (preset === 'custom' ? { ...f, preset } : { ...f, preset, ...presetRange(preset, dataRange) })));
  }, [dataRange]);
  const setCustomRange = useCallback((from: string, to: string) => {
    startTransition(() => setFilters((f) => ({ ...f, preset: 'custom', from, to })));
  }, []);
  const setEmployees = useCallback((employees: string[]) => startTransition(() => setFilters((f) => ({ ...f, employees }))), []);
  const setDim = useCallback((key: string, values: string[]) => startTransition(() => setFilters((f) => ({ ...f, dims: { ...f.dims, [key]: values } }))), []);
  const reset = useCallback(() => { setFilters(initialFilters(dataRange)); setAttention(DEFAULT_ATTENTION); }, [dataRange]);

  const isDefault = filters.preset === DEFAULT_PRESET && filters.employees.length === 0 && Object.values(filters.dims).every((v) => v.length === 0);

  const value = useMemo(() => ({ filters, setPreset, setCustomRange, setEmployees, setDim, reset, attention, setAttention, isDefault }), [filters, setPreset, setCustomRange, setEmployees, setDim, reset, attention, isDefault]);
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterState {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used inside FilterProvider');
  return ctx;
}
