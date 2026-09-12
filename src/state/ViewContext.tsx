import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminLogin, adminLogout, adminSession, isSnapshotHost } from '../lib/api';
import type { PageKey } from './router';

/**
 * Two ways of looking at the same data:
 *   manager – Team Performance and Pending Tasks only, with a fixed set of columns (everyone).
 *   admin   – every page; unlocked with the admin password, which the server checks and
 *             remembers with a signed cookie for 30 days.
 * Until an ADMIN_PASSWORD secret is set on the server, every visitor may use the Admin view.
 * `?view=manager` in the address opens the manager view even for an admin (shareable link).
 */
export type View = 'admin' | 'manager';

export const MANAGER_PAGES: PageKey[] = ['team', 'pending'];

interface ViewState {
  view: View;
  /** null while the session is being checked */
  admin: boolean | null;
  /** false when the server has no ADMIN_PASSWORD yet (Admin view open to everyone) */
  configured: boolean;
  /** switch views; switching to admin needs `admin === true` */
  setView: (v: View) => void;
  /** enter the admin password; resolves when the Admin view is unlocked, throws with a message otherwise */
  unlock: (password: string) => Promise<void>;
  /** lock the Admin view again (clears the cookie) */
  lock: () => Promise<void>;
  /** pages the current view offers; null = all */
  pages: PageKey[] | null;
}

const ViewContext = createContext<ViewState | null>(null);
const KEY = 'sales-dashboard-view';

function fromUrl(): View | null {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    return v === 'manager' ? 'manager' : v === 'admin' ? 'admin' : null;
  } catch { return null; }
}

function preferred(): View {
  const u = fromUrl();
  if (u) return u;
  try { return localStorage.getItem(KEY) === 'admin' ? 'admin' : 'manager'; } catch { return 'manager'; }
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const snapshot = isSnapshotHost();
  const [admin, setAdmin] = useState<boolean | null>(snapshot ? true : null);
  const [configured, setConfigured] = useState(false);
  const [pref, setPref] = useState<View>(preferred);

  useEffect(() => {
    if (snapshot) return;
    let alive = true;
    adminSession()
      .then((s) => { if (!alive) return; setAdmin(s.admin); setConfigured(s.configured); })
      .catch(() => { if (alive) { setAdmin(false); setConfigured(true); } });
    return () => { alive = false; };
  }, [snapshot]);

  useEffect(() => { try { localStorage.setItem(KEY, pref); } catch { /* ignore */ } }, [pref]);

  const setView = useCallback((v: View) => {
    setPref(v);
    try {
      const url = new URL(window.location.href);
      if (v === 'manager') url.searchParams.set('view', 'manager'); else url.searchParams.delete('view');
      window.history.replaceState(null, '', url.toString());
    } catch { /* sandboxed */ }
  }, []);

  const unlock = useCallback(async (password: string) => {
    const r = await adminLogin(password);
    setAdmin(r.admin); setConfigured(r.configured);
    if (r.admin) setView('admin');
  }, [setView]);

  const lock = useCallback(async () => {
    try { await adminLogout(); } catch { /* still lock locally */ }
    setAdmin(false); setView('manager');
  }, [setView]);

  // The Admin view is only shown to a verified admin; everyone else gets the manager view.
  const view: View = admin === true && pref === 'admin' ? 'admin' : 'manager';
  const value = useMemo<ViewState>(() => ({ view, admin, configured, setView, unlock, lock, pages: view === 'manager' ? MANAGER_PAGES : null }), [view, admin, configured, setView, unlock, lock]);
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView(): ViewState {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error('useView must be used inside ViewProvider');
  return ctx;
}
