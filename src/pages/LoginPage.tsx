import { LockKeyhole, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EduportLogo } from '../components/layout/Logo';
import { Button } from '../components/ui/Controls';
import { useView } from '../state/ViewContext';

/** First screen: pick Manager (no password) or Admin (password checked by the server). */
export function LoginPage() {
  const { signInManager, signInAdmin, configured } = useView();
  const [mode, setMode] = useState<'choose' | 'admin'>('choose');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mode === 'admin') input.current?.focus(); }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password && configured) { setError('Enter the admin password.'); return; }
    setBusy(true); setError(null);
    try { await signInAdmin(password); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-plane px-4 py-10 dark:bg-plane-dark">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <EduportLogo size={44} />
          <div className="leading-tight">
            <div className="text-lg font-semibold text-ink dark:text-ink-dark">Eduport <span className="font-normal text-ink-secondary dark:text-ink-dark-secondary">Sales</span></div>
            <div className="text-xs text-ink-muted">Performance dashboard</div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card dark:border-line-dark dark:bg-surface-dark">
          {mode === 'choose' ? (
            <>
              <h1 className="text-sm font-semibold text-ink dark:text-ink-dark">Sign in as</h1>
              <p className="mt-1 text-xs text-ink-muted">Managers see Team Performance and Pending Tasks. Admins see every page.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={signInManager} className="group flex flex-col items-start gap-2 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-accent hover:bg-accent-soft/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:hover:bg-accent-soft-dark/30">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e6f5e6] text-[#006300] dark:bg-[#12331a] dark:text-[#5fd35f]"><Users className="h-5 w-5" /></span>
                  <span className="text-sm font-semibold text-ink dark:text-ink-dark">Manager login</span>
                  <span className="text-xs text-ink-muted">No password. Team Performance and Pending Tasks.</span>
                </button>
                <button type="button" onClick={() => setMode('admin')} className="group flex flex-col items-start gap-2 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-accent hover:bg-accent-soft/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:hover:bg-accent-soft-dark/30">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-[#184f95] dark:bg-accent-soft-dark dark:text-[#cde2fb]"><LockKeyhole className="h-5 w-5" /></span>
                  <span className="text-sm font-semibold text-ink dark:text-ink-dark">Admin login</span>
                  <span className="text-xs text-ink-muted">Password required. Every page of the dashboard.</span>
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <h1 className="text-sm font-semibold text-ink dark:text-ink-dark">Admin login</h1>
              <p className="mt-1 text-xs text-ink-muted">{configured ? 'Enter the admin password. This browser stays signed in for 30 days.' : 'No admin password is set on the server yet, so any password opens the Admin view.'}</p>
              <input ref={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Admin password" aria-label="Admin password" autoComplete="current-password" className="mt-3 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
              {error && <p className="mt-2 text-xs text-[#8f1f1f] dark:text-[#f08c8c]" role="alert">{error}</p>}
              <div className="mt-4 flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" type="button" onClick={() => { setMode('choose'); setError(null); }}>Back</Button>
                <Button size="sm" variant="primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</Button>
              </div>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-ink-muted">Read-only view · data from Callyzer, Salesforce and icku · Asia/Kolkata</p>
      </div>
    </div>
  );
}
