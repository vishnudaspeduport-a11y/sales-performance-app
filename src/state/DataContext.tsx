import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, fetchPayload } from '../lib/api';
import { toDataset } from '../lib/parse';
import type { Dataset } from '../types';

/** Client-side cache TTL — mirrors the server/CDN cache. */
const CLIENT_TTL_MS = 3 * 60 * 1000;
/** After a manual refresh the server re-reads the sheet in the background; poll until new data lands. */
const REFRESH_POLL_MS = 8000;
const REFRESH_POLL_MAX_MS = 3 * 60 * 1000;

interface DataState {
  dataset: Dataset | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  notice: string | null;
  lastUpdated: string | null;
  load: (refresh?: boolean) => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const loadedAt = useRef(0);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = () => { if (pollTimer.current) { window.clearTimeout(pollTimer.current); pollTimer.current = null; } };

  const apply = useCallback((payload: Awaited<ReturnType<typeof fetchPayload>>) => {
    setDataset(toDataset(payload));
    setLastUpdated(payload.meta?.syncedAt || payload.meta?.generatedAt || new Date().toISOString());
    loadedAt.current = Date.now();
    return payload;
  }, []);

  const load = useCallback(async (refresh = false) => {
    if (inFlight.current) return inFlight.current;
    if (!refresh && dataset && Date.now() - loadedAt.current < CLIENT_TTL_MS) return;
    const run = (async () => {
      if (dataset) setRefreshing(true); else setLoading(true);
      setError(null); setNotice(null);
      try {
        const payload = apply(await fetchPayload(refresh));
        if (refresh) {
          if (payload.meta.refreshQueued) {
            // Poll until the background sync produces a newer payload.
            const startedAt = Date.now();
            const before = payload.meta.generatedAt;
            setRefreshing(true);
            const poll = async () => {
              try {
                const next = await fetchPayload(true);
                if (next.meta.generatedAt !== before) { apply(next); setRefreshing(false); setNotice('Data refreshed from the Google Sheet.'); return; }
              } catch { /* keep polling */ }
              if (Date.now() - startedAt < REFRESH_POLL_MAX_MS) pollTimer.current = window.setTimeout(poll, REFRESH_POLL_MS);
              else { setRefreshing(false); setNotice('The refresh is taking longer than expected; the data will appear on the next automatic sync.'); }
            };
            pollTimer.current = window.setTimeout(poll, REFRESH_POLL_MS);
            return;
          }
          if (payload.meta.refreshNote) setNotice(payload.meta.refreshNote);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Something went wrong while loading the data.');
      } finally {
        setLoading(false);
        if (!pollTimer.current) setRefreshing(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [dataset, apply]);

  useEffect(() => { void load(false); return stopPolling; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the dashboard in sync while the tab stays open.
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load(false); }, CLIENT_TTL_MS + 5000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(null), 8000); return () => window.clearTimeout(id); }, [notice]);

  const value = useMemo(() => ({ dataset, loading, refreshing, error, notice, lastUpdated, load }), [dataset, loading, refreshing, error, notice, lastUpdated, load]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
