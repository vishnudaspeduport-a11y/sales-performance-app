import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminLogin, adminLogout, adminSession, isSnapshotHost } from '../lib/api';
import type { PageKey } from './router';

/**
 * Who is looking at the dashboard, chosen on the login page:
 *   manager – Team Performance and Pending Tasks only, fixed columns; no password.
 *   admin   – every page; needs the admin password, which the server checks and remembers
 *             with a signed cookie for 30 days.
 * Until an ADMIN_PASSWORD secret is set on the server, the admin login accepts any password.
 * `?view=manager` in the address skips the login page and opens the manager view.
 */
export type View = 'admin' | 'manager';

export const MANAGER_PAGES: PageKey[] = ['team', 'pending'];

interface ViewState {
  /** null = not signed in yet (login page); 'checking' while the admin cookie is verified */
  view: View | null | 'checking';
  /** false when the server has no ADMIN_PASSWORD yet */
  configured: boolean;
  /** open the manager view (no password) */
  signInManager: () => void;
  /** open the admin view; throws with a message when the password is wrong */
  signInAdmin: (password: string) => Promise<void>;
  /** back to the login page (clears the admin cookie) */
  signOut: () => Promise<void>;
  /** pages the current view offers; null = all */
  pages: PageKey[] | null;
}

const ViewContext = createContext<ViewState | null>(null);
const KEY = 'sales-dashboard-role';

function fromUrl(): View | null {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    return v === 'manager' ? 'manager' : v === 'admin' ? 'admin' : null;
  } catch { return null; }
}

function stored(): View | null {
  try { const v = localStorage.getItem(KEY); return v === 'admin' || v === 'manager' ? v : null; } catch { return null; }
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const snapshot = isSnapshotHost();
  const [configured, setConfigured] = useState(false);
  const [view, setView] = useState<View | null | 'checking'>(() => {
    const start = fromUrl() ?? stored();
    if (start === 'admin') return snapshot ? 'admin' : 'checking';
    return start;
  });

  // A remembered admin is only let in if the server still accepts this browser's cookie.
  useEffect(() => {
    if (view !== 'checking') return;
    let alive = true;
    adminSession()
      .then((s) => { if (!alive) return; setConfigured(s.configured); setView(s.admin ? 'admin' : null); })
      .catch(() => { if (alive) { setConfigured(true); setView(null); } });
    return () => { alive = false; };
  }, [view]);

  useEffect(() => {
    try { if (view === 'admin' || view === 'manager') localStorage.setItem(KEY, view); else if (view === null) localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, [view]);

  const signInManager = useCallback(() => setView('manager'), []);
  const signInAdmin = useCallback(async (password: string) => {
    if (snapshot) { setView('admin'); return; }
    const r = await adminLogin(password);
    setConfigured(r.configured);
    if (!r.admin) throw new Error('That password is not correct.');
    setView('admin');
  }, [snapshot]);
  const signOut = useCallback(async () => {
    if (view === 'admin' && !snapshot) { try { await adminLogout(); } catch { /* still sign out locally */ } }
    try { const url = new URL(window.location.href); url.searchParams.delete('view'); window.history.replaceState(null, '', url.toString()); } catch { /* sandboxed */ }
    setView(null);
  }, [view, snapshot]);

  const value = useMemo<ViewState>(() => ({ view, configured, signInManager, signInAdmin, signOut, pages: view === 'manager' ? MANAGER_PAGES : null }), [view, configured, signInManager, signInAdmin, signOut]);
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView(): ViewState {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error('useView must be used inside ViewProvider');
  return ctx;
}
