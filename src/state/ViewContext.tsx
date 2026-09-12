import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PageKey } from './router';

/**
 * Two ways of looking at the same data:
 *   admin   – every page.
 *   manager – Team Performance and Pending Tasks only, with a fixed set of columns.
 * The view comes from `?view=manager` in the address (shareable link), else the last choice
 * in this browser, else admin. This is a layout choice, not access control: the data behind
 * both views is the same public payload.
 */
export type View = 'admin' | 'manager';

export const MANAGER_PAGES: PageKey[] = ['team', 'pending'];

interface ViewState {
  view: View;
  setView: (v: View) => void;
  /** pages the current view offers */
  pages: PageKey[] | null;
  /** address that opens the dashboard in the current view */
  shareUrl: string;
}

const ViewContext = createContext<ViewState | null>(null);
const KEY = 'sales-dashboard-view';

function fromUrl(): View | null {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    return v === 'manager' ? 'manager' : v === 'admin' ? 'admin' : null;
  } catch { return null; }
}

function initial(): View {
  const u = fromUrl();
  if (u) return u;
  try { return localStorage.getItem(KEY) === 'manager' ? 'manager' : 'admin'; } catch { return 'admin'; }
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<View>(initial);
  useEffect(() => { try { localStorage.setItem(KEY, view); } catch { /* ignore */ } }, [view]);
  const setView = useCallback((v: View) => {
    setViewState(v);
    // keep the address in step so the page can be shared or bookmarked in this view
    try {
      const url = new URL(window.location.href);
      if (v === 'manager') url.searchParams.set('view', 'manager'); else url.searchParams.delete('view');
      window.history.replaceState(null, '', url.toString());
    } catch { /* sandboxed */ }
  }, []);
  const value = useMemo<ViewState>(() => {
    let shareUrl = '';
    try { const url = new URL(window.location.href); url.hash = ''; url.search = view === 'manager' ? '?view=manager' : ''; shareUrl = url.toString(); } catch { /* ignore */ }
    return { view, setView, pages: view === 'manager' ? MANAGER_PAGES : null, shareUrl };
  }, [view, setView]);
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView(): ViewState {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error('useView must be used inside ViewProvider');
  return ctx;
}
