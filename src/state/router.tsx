import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Minimal hash router. Works inside the Apps Script sandbox iframe (where
 * history APIs are restricted) and on any static host.
 */
export type PageKey = 'dashboard' | 'team' | 'bdm' | 'employee' | 'compare' | 'trends' | 'raw' | 'pending' | 'mapping';

export interface Route {
  page: PageKey;
  /** optional parameter, e.g. employee id */
  param?: string;
}

interface RouterState {
  route: Route;
  navigate: (page: PageKey, param?: string) => void;
}

const RouterContext = createContext<RouterState | null>(null);

const PAGES: PageKey[] = ['dashboard', 'team', 'bdm', 'employee', 'compare', 'trends', 'raw', 'pending', 'mapping'];

function parseHash(): Route {
  try {
    const raw = window.location.hash.replace(/^#\/?/, '');
    const [page, param] = raw.split('/');
    if (PAGES.includes(page as PageKey)) return { page: page as PageKey, param: param ? decodeURIComponent(param) : undefined };
  } catch { /* ignore */ }
  // Opening the site without a page in the address lands on Pending Tasks.
  return { page: 'pending' };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((page: PageKey, param?: string) => {
    const next: Route = { page, param };
    setRoute(next);
    try {
      const hash = `#/${page}${param ? `/${encodeURIComponent(param)}` : ''}`;
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch { /* sandboxed: in-memory route only */ }
    try { window.scrollTo({ top: 0 }); } catch { /* ignore */ }
  }, []);
  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterState {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}
