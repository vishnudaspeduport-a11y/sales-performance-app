import { Check, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { whatsappSendImage, whatsappSetup, type WhatsAppRecipient, type WhatsAppSendResult } from '../lib/api';
import { Button } from './ui/Controls';

/**
 * "Send to WhatsApp numbers": shows the picture that was just captured, lists the numbers the
 * server knows (names and masked numbers only), and posts the picture to the ticked ones through
 * the WhatsApp Cloud API. The numbers themselves stay on the server.
 */
export interface WhatsAppSendMeta { team: string; date: string; overdue: string; today: string }

const norm = (s: string) => s.toLowerCase().replace(/^executive[\s_-]*/, '').replace(/[^a-z0-9*]/g, '');
/** Does a recipient's team setting match the table's team ("Team Aswanth", "Aswanth", the full role, or "*")? */
export function recipientMatchesTeam(setting: string, team: string): boolean {
  const s = norm(setting);
  if (!s) return false;
  if (s === '*') return team === '*';
  const t = norm(team);
  return s === t || s === t.replace(/^team/, '') || 'team' + s === t;
}

export function WhatsAppSendDialog({ image, meta, teamKey, onClose }: { image: Blob; meta: WhatsAppSendMeta; teamKey: string; onClose: () => void }) {
  const [setup, setSetup] = useState<{ configured: boolean; recipients: WhatsAppRecipient[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<WhatsAppSendResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const preview = useMemo(() => URL.createObjectURL(image), [image]);
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);

  useEffect(() => {
    let alive = true;
    whatsappSetup()
      .then((s) => {
        if (!alive) return;
        setSetup(s);
        // pre-tick the recipients set up for this team (or the all-teams ones for the team table)
        setPicked(new Set(s.recipients.filter((r) => recipientMatchesTeam(r.team, teamKey)).map((r) => r.id)));
      })
      .catch((e: Error) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, [teamKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = setup?.recipients ?? [];
  const allPicked = all.length > 0 && all.every((r) => picked.has(r.id));

  const send = async () => {
    if (!picked.size) return;
    setSending(true); setSendError(null); setResult(null);
    try { setResult(await whatsappSendImage(image, [...picked], meta)); }
    catch (e) { setSendError((e as Error).message); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="wa-send-title" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-[20px] border border-transparent bg-surface shadow-lg dark:border-line-dark dark:bg-surface-dark" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3 dark:border-line-dark">
          <div>
            <h2 id="wa-send-title" className="text-base font-semibold text-ink dark:text-ink-dark">Send to WhatsApp numbers</h2>
            <p className="text-xs text-ink-muted">{meta.team} · {meta.date} · {meta.overdue} overdue, {meta.today} due today</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 md:grid-cols-[1fr_260px]">
          <div className="min-w-0 overflow-auto rounded-lg border border-line bg-plane p-2 dark:border-line-dark dark:bg-plane-dark">
            <img src={preview} alt="The table that will be sent" className="mx-auto max-h-[60vh] w-auto max-w-full" />
          </div>
          <div className="min-w-0 space-y-3">
            {loadError && <p className="text-sm text-status-critical">{loadError}</p>}
            {setup && !setup.configured && (
              <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-ink dark:text-ink-dark">
                Sending is not switched on yet. The WhatsApp Cloud API token, phone number ID and the recipient list have to be added to the site's settings first.
              </p>
            )}
            {setup && setup.configured && all.length === 0 && (
              <p className="text-sm text-ink-muted">No numbers set up yet. Add them to the recipient list in the site's settings.</p>
            )}
            {all.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Send to</span>
                  <button type="button" className="text-xs text-accent hover:underline dark:text-accent-dark" onClick={() => setPicked(allPicked ? new Set() : new Set(all.map((r) => r.id)))}>{allPicked ? 'Clear all' : 'Select all'}</button>
                </div>
                <ul className="max-h-64 space-y-1 overflow-auto">
                  {all.map((r) => {
                    const done = result?.results.find((x) => x.id === r.id);
                    return (
                      <li key={r.id}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-plane dark:hover:bg-plane-dark">
                          <input type="checkbox" className="mt-0.5 accent-[#25d366]" checked={picked.has(r.id)} onChange={() => toggle(r.id)} disabled={sending} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink dark:text-ink-dark">{r.name}</span>
                            <span className="block truncate text-xs text-ink-muted">{r.team ? `${r.team} · ` : ''}{r.masked}</span>
                            {done && (done.ok ? <span className="flex items-center gap-1 text-xs text-status-good"><Check className="h-3 w-3" /> Sent</span> : <span className="text-xs text-status-critical">Failed: {done.error}</span>)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {!setup && !loadError && <p className="text-sm text-ink-muted">Loading numbers…</p>}
            {sendError && <p className="text-sm text-status-critical">{sendError}</p>}
            {result && <p className="text-sm text-ink dark:text-ink-dark">{result.sent} sent{result.failed ? `, ${result.failed} failed` : ''}.</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 dark:border-line-dark">
          <Button onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void send()} disabled={sending || !picked.size || !setup?.configured} title={!setup?.configured ? 'Sending is not set up yet' : ''}>
            <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : `Send to ${picked.size} number${picked.size === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
