import { Check, Copy, Download, MessageCircle, Settings2, Share2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { copyToClipboard, download, isMobileDevice, openWhatsApp } from '../lib/shareImage';
import { openTarget, targetLabel, type WhatsAppTarget } from '../lib/whatsappTargets';
import { Button } from './ui/Controls';

export interface TeamPicture { team: string; label: string; blob: Blob; filename: string }

type ShareNav = Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };

/**
 * "Send all teams": one picture per team, all for the same WhatsApp chat. A web page cannot put
 * pictures into a chat by itself, so the dialog offers the shortest ways the device allows:
 *  - the share sheet with every picture at once (phones, and computers with WhatsApp installed);
 *  - saving every picture, to attach them together in the chat;
 *  - copying one picture at a time, to paste into the chat.
 */
export function WhatsAppAllTeamsDialog({ items, target, title, onChooseChat, onClose }: { items: TeamPicture[]; target: WhatsAppTarget | null; title: string; onChooseChat: () => void; onClose: () => void }) {
  const files = useMemo(() => items.map((i) => new File([i.blob], i.filename, { type: 'image/png' })), [items]);
  const canShareAll = useMemo(() => { const nav = navigator as ShareNav; try { return !!nav.canShare && !!nav.share && nav.canShare({ files }); } catch { return false; } }, [files]);
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const mobile = isMobileDevice();
  const paste = mobile ? 'press and hold the message box and choose Paste' : 'press Ctrl+V';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openChat = () => { if (target) openTarget(target); else openWhatsApp(); };
  const shareAll = async () => {
    try { await (navigator as ShareNav).share?.({ files, title }); setNote('Handed to the share sheet. Pick WhatsApp, then the chat.'); }
    catch (e) { if ((e as Error)?.name !== 'AbortError') setNote('The share sheet could not take the pictures. Save them and attach them in the chat instead.'); }
  };
  const saveAll = async () => {
    for (const i of items) { download(i.blob, i.filename); await new Promise((r) => setTimeout(r, 250)); }
    setNote(`${items.length} pictures saved to your Downloads folder. In the chat, press the attach button, choose Photos and select them all.`);
  };
  const copyOne = async (i: TeamPicture) => {
    if (await copyToClipboard(i.blob)) { setCopied((s) => new Set(s).add(i.team)); setNote(`${i.label} copied. In the chat ${paste}, then send.`); }
    else setNote('This browser could not copy the picture. Save the pictures instead.');
  };
  const next = items.find((i) => !copied.has(i.team));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="wa-all-title" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg dark:border-line-dark dark:bg-surface-dark" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3 dark:border-line-dark">
          <div className="min-w-0">
            <h2 id="wa-all-title" className="text-base font-semibold text-ink dark:text-ink-dark">Send all teams · {items.length} pictures ready</h2>
            <p className="text-xs text-ink-muted">
              {target ? <>Going to one chat: {targetLabel(target)}.</> : <>No chat is chosen yet, so WhatsApp opens and you pick the chat there.</>}{' '}
              <button type="button" onClick={onChooseChat} className="inline-flex items-center gap-1 font-medium text-accent hover:underline dark:text-accent-dark"><Settings2 className="h-3 w-3" />{target ? 'Change chat' : 'Choose the chat'}</button>
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 dark:border-line-dark">
          {canShareAll && <Button variant="primary" size="sm" onClick={() => void shareAll()} title="Every picture at once through the share sheet"><Share2 className="h-3.5 w-3.5" /> Share all pictures</Button>}
          <Button variant={canShareAll ? 'secondary' : 'primary'} size="sm" onClick={() => void saveAll()} title="Save every picture, then attach them together in the chat"><Download className="h-3.5 w-3.5" /> Save all pictures</Button>
          <Button size="sm" onClick={openChat} title="Open the chat in a new tab"><MessageCircle className="h-3.5 w-3.5 text-[#25d366]" /> Open chat</Button>
          {next && <Button size="sm" onClick={() => void copyOne(next)} title={`Copy ${next.label}, then paste it in the chat`}><Copy className="h-3.5 w-3.5" /> Copy next: {next.label}</Button>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-2">
          <ul className="divide-y divide-line text-sm dark:divide-line-dark">
            {items.map((i, n) => (
              <li key={i.team} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-ink dark:text-ink-dark"><span className="tabular mr-2 text-xs text-ink-muted">{n + 1}</span>{i.label}</span>
                <Button size="sm" variant="ghost" onClick={() => void copyOne(i)} aria-label={`Copy the picture of ${i.label}`}>{copied.has(i.team) ? <><Check className="h-3.5 w-3.5 text-[#1baf7a]" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}</Button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-line px-5 py-3 text-xs text-ink-muted dark:border-line-dark">
          {note ?? (canShareAll
            ? 'Share all pictures sends them in one go: pick WhatsApp, then the chat.'
            : `Quickest: Save all pictures, Open chat, then attach them together. Or copy one at a time and ${paste} in the chat.`)}
        </div>
      </div>
    </div>
  );
}
