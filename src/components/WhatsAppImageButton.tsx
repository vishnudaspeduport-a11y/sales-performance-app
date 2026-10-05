import { Image as ImageIcon, MessageCircle, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { captureElementPng, copyToClipboard, isMobileDevice, openWhatsApp, shareElementAsImage } from '../lib/shareImage';
import { loadTargets, openTarget, parseTargets, saveTargetsShared, syncTargets, targetLabel, type NamedTarget } from '../lib/whatsappTargets';
import { useTheme } from '../state/ThemeContext';
import { Button } from './ui/Controls';

/**
 * "Send image on WhatsApp" for a table: a picture of the card goes to WhatsApp.
 *  - When WhatsApp groups are set for the table, the picture is copied, the first group opens, and
 *    a small panel lists every group with an Open button, so the same picture is pasted into each.
 *  - Without groups the device's share sheet opens (pick WhatsApp and the chats there); where that
 *    is not available the picture is copied and WhatsApp Web opened.
 * The groups are saved on the server, the same for every admin. Everything here is marked data-no-capture, so the
 * button and its panel never appear in the picture.
 */
export function WhatsAppImageButton({ targetRef, targetKey, filename, title }: {
  /** the element that becomes the picture */
  targetRef: RefObject<HTMLElement>;
  /** which saved list of groups belongs to this table */
  targetKey: string;
  filename: string;
  title: string;
}) {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<{ text: string; targets: NamedTarget[]; whatsapp?: boolean } | null>(null);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setPanel(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [panel]);

  const send = async () => {
    const el = targetRef.current;
    if (!el || busy) return;
    setBusy(true); setPanel(null);
    const paste = isMobileDevice() ? 'press and hold the message box and choose Paste' : 'press Ctrl+V';
    try {
      await syncTargets();
      const targets = parseTargets(loadTargets()[targetKey] ?? '');
      if (targets.length) {
        const copied = await copyToClipboard(await captureElementPng(el, theme === 'dark'));
        if (copied) {
          const opened = openTarget(targets[0].target);
          setPanel({ targets, text: `Picture copied${opened ? ' and the first group is opening' : ''}. In each group ${paste}, then send.` });
          return;
        }
      }
      const r = await shareElementAsImage(el, filename, title, theme === 'dark');
      if (r === 'copied') { openWhatsApp(); setPanel({ targets: [], whatsapp: true, text: `Picture copied. In WhatsApp pick the chat, ${paste}, then send.` }); }
      else if (r === 'shared') setPanel({ targets: [], text: 'Handed to WhatsApp.' });
      else if (r === 'downloaded') setPanel({ targets: [], text: `Picture saved as ${filename}. Attach it in WhatsApp.` });
      else if (r === 'blocked') setPanel({ targets: [], text: 'Could not copy or save the picture in this window.' });
    } catch { setPanel({ targets: [], text: 'Could not create the picture.' }); }
    finally { setBusy(false); }
  };

  return (
    <span ref={box} data-no-capture className="relative inline-flex">
      <Button size="sm" onClick={() => void send()} disabled={busy} title="Picture of this table for WhatsApp"><ImageIcon className="h-3.5 w-3.5" /> {busy ? 'Preparing…' : 'Send image on WhatsApp'}</Button>
      {panel && (
        <div role="status" className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-line bg-surface p-3 text-left shadow-lg dark:border-line-dark dark:bg-surface-dark">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-ink dark:text-ink-dark">{panel.text}</p>
            <button type="button" onClick={() => setPanel(null)} aria-label="Close" className="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink dark:hover:text-ink-dark"><X className="h-3.5 w-3.5" /></button>
          </div>
          {panel.targets.length > 0 && (
            <ul className="mt-2 space-y-1">
              {panel.targets.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-ink-secondary dark:text-ink-dark-secondary" title={t.name || targetLabel(t.target)}>{t.name || targetLabel(t.target)}</span>
                  <Button size="sm" onClick={() => openTarget(t.target)}><MessageCircle className="h-3.5 w-3.5 text-[#25d366]" /> Open</Button>
                </li>
              ))}
            </ul>
          )}
          {panel.whatsapp && <div className="mt-2"><Button size="sm" onClick={openWhatsApp}><MessageCircle className="h-3.5 w-3.5 text-[#25d366]" /> Open WhatsApp</Button></div>}
        </div>
      )}
    </span>
  );
}

/**
 * "WhatsApp groups": which groups each table's picture goes to. One box per table, one group per
 * line, optionally with a name in front ("Diary group: https://chat.whatsapp.com/…").
 */
export function WhatsAppGroupsButton({ rows }: { rows: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span data-no-capture>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Choose the WhatsApp groups for each table"><Settings2 className="h-3.5 w-3.5" /> WhatsApp groups</Button>
      {open && <WhatsAppGroupsDialog rows={rows} onClose={() => setOpen(false)} />}
    </span>
  );
}

function WhatsAppGroupsDialog({ rows, onClose }: { rows: { key: string; label: string }[]; onClose: () => void }) {
  const [map, setMap] = useState<Record<string, string>>(() => loadTargets());
  const [shared, setShared] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(false);
  // Fetch what the other admins saved; it replaces this browser's copy unless typing has started.
  useEffect(() => {
    let alive = true;
    void syncTargets(true).then((ok) => { if (!alive) return; setShared(ok); if (ok && !touched.current) setMap(loadTargets()); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const save = async () => {
    setSaving(true); setError(null);
    try { await saveTargetsShared(map); onClose(); }
    catch (e) { setError(`${(e as Error).message} The groups are saved in this browser only.`); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="wa-groups-title" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg dark:border-line-dark dark:bg-surface-dark" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3 dark:border-line-dark">
          <div>
            <h2 id="wa-groups-title" className="text-base font-semibold text-ink dark:text-ink-dark">WhatsApp groups for each table</h2>
            <p className="text-xs text-ink-muted">One group per line: the invite link (Group info → Invite link), with a name in front if you like, for example “Diary group: https://chat.whatsapp.com/…”. A number with country code works too. {shared === false ? 'Kept in this browser only.' : 'Saved for everyone who signs in as Admin.'}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-3">
          {rows.map((r) => {
            const raw = map[r.key] ?? '';
            const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const parsed = parseTargets(raw);
            const bad = lines.length - parsed.length;
            return (
              <div key={r.key}>
                <label htmlFor={`wa-${r.key}`} className="block text-sm font-medium text-ink dark:text-ink-dark">{r.label}</label>
                <textarea
                  id={`wa-${r.key}`}
                  rows={Math.min(6, Math.max(2, lines.length + 1))}
                  value={raw}
                  onChange={(e) => { touched.current = true; setMap((m) => ({ ...m, [r.key]: e.target.value })); }}
                  placeholder={'Sales heads: https://chat.whatsapp.com/…\nhttps://chat.whatsapp.com/…'}
                  className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
                />
                <span className={`block text-xs ${bad > 0 ? 'text-status-critical' : 'text-ink-muted'}`}>
                  {!lines.length ? 'No group set · the share sheet is used' : `${parsed.length} group${parsed.length === 1 ? '' : 's'}${parsed.length ? `: ${parsed.map((t) => t.name || targetLabel(t.target)).join(', ')}` : ''}${bad > 0 ? ` · ${bad} line${bad === 1 ? '' : 's'} not recognised` : ''}`}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 dark:border-line-dark">
          {error && <span className="mr-auto text-xs text-status-critical">{error}</span>}
          {!error && shared === null && <span className="mr-auto text-xs text-ink-muted">Loading the saved groups…</span>}
          <Button onClick={onClose}>{error ? 'Close' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </div>
  );
}
