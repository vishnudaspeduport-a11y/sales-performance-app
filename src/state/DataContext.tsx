import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, fetchHealth, fetchPayload, isSnapshotHost, requestRefresh } from '../lib/api';
import { toDataset } from '../lib/parse';
import { readCachedPayload, writeCachedPayload } from '../lib/payloadCache';
import type { Dataset } from '../types';

/** Client-side cache TTL — mirrors the server/CDN cache. */
const CLIENT_TTL_MS = 3 * 60 * 1000;
/** After a manual refresh the sync runs elsewhere (GitHub Actions); poll the health endpoint until a new snapshot lands. */
const REFRESH_POLL_MS = 8000;
const REFRESH_POLL_MAX_MS = 6 * 60 * 1000;

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

  const appliedStamp = useRef<string | null>(null);
  /** Builds the dataset from a payload. The same sync stamp as last time means nothing changed, so the page is left as it is. */
  const apply = useCallback((payload: Awaited<ReturnType<typeof fetchPayload>>, { fromCache = false } = {}) => {
    const stamp = payload.meta?.syncedAt || payload.meta?.generatedAt || '';
    loadedAt.current = Date.now();
    if (stamp && stamp === appliedStamp.current) return payload;
    appliedStamp.current = stamp || null;
    setDataset(toDataset(payload));
    setLastUpdated(stamp || new Date().toISOString());
    if (!fromCache && !isSnapshotHost()) void writeCachedPayload(payload);
    return payload;
  }, []);

  /** Wait for the queued sync to finish (a newer snapshot appears), then load the fresh payload. */
  const pollUntilSynced = useCallback((baseline: string | null) => {
    const startedAt = Date.now();
    setRefreshing(true);
    const poll = async () => {
      try {
        const h = await fetchHealth();
        if (h.snapshotAt && h.snapshotAt !== baseline) {
          apply(await fetchPayload(true));
          pollTimer.current = null; setRefreshing(false); setNotice('Data refreshed from the Google Sheet.');
          return;
        }
        const ls = h.lastSync;
        if (ls && ls.status === 'error' && Date.parse(ls.startedAt) > startedAt - 60000) {
          pollTimer.current = null; setRefreshing(false); setNotice(`The sync failed: ${ls.error ?? 'unknown error'}.`);
          return;
        }
      } catch { /* keep polling */ }
      if (Date.now() - startedAt < REFRESH_POLL_MAX_MS) pollTimer.current = window.setTimeout(poll, REFRESH_POLL_MS);
      else { pollTimer.current = null; setRefreshing(false); setNotice('The refresh is taking longer than expected; the data will appear on the next automatic sync.'); }
    };
    pollTimer.current = window.setTimeout(poll, REFRESH_POLL_MS);
  }, [apply]);

  const load = useCallback(async (refresh = false) => {
    if (inFlight.current) return inFlight.current;
    if (!refresh && dataset && Date.now() - loadedAt.current < CLIENT_TTL_MS) return;
    const run = (async () => {
      if (dataset) setRefreshing(true); else setLoading(true);
      setError(null); setNotice(null);
      try {
        if (refresh && !isSnapshotHost()) {
          const r = await requestRefresh();
          if (r.queued) { pollUntilSynced(r.snapshotAt ?? null); return; }
          if (r.reason) setNotice(r.reason);
          apply(await fetchPayload(true));
          return;
        }
        apply(await fetchPayload(refresh));
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
  }, [dataset, apply, pollUntilSynced]);

  useEffect(() => {
    // The copy kept in this browser shows at once; the fresh data follows and replaces it when newer.
    let alive = true;
    (async () => {
      if (!isSnapshotHost()) {
        const cached = await readCachedPayload();
        if (alive && cached && !appliedStamp.current) { apply(cached, { fromCache: true }); setLoading(false); setRefreshing(true); }
      }
      if (alive) { loadedAt.current = 0; void load(false); }
    })();
    return () => { alive = false; stopPolling(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
