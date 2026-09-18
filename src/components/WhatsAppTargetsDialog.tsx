import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ALL_TEAMS_KEY, loadTargets, parseTarget, saveTargets, targetLabel } from '../lib/whatsappTargets';
import { Button } from './ui/Controls';

/**
 * "WhatsApp chats": which group (or number) each team's picture goes to. One row per team plus
 * the all-teams table. Saved in this browser only.
 */
export function WhatsAppTargetsDialog({ teams, onClose }: { teams: { key: string; label: string }[]; onClose: () => void }) {
  const [map, setMap] = useState<Record<string, string>>(() => loadTargets());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows = [{ key: ALL_TEAMS_KEY, label: 'All teams (By BDM team table)' }, ...teams];
  const save = () => { saveTargets(map); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="wa-targets-title" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg dark:border-line-dark dark:bg-surface-dark" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3 dark:border-line-dark">
          <div>
            <h2 id="wa-targets-title" className="text-base font-semibold text-ink dark:text-ink-dark">WhatsApp chats for each team</h2>
            <p className="text-xs text-ink-muted">Paste the group's invite link (Group info → Invite link) or a number with country code. Kept in this browser only.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-muted"><th className="py-1 pr-3 font-medium">Team</th><th className="py-1 font-medium">Group link or number</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const raw = map[r.key] || '';
                const parsed = raw.trim() ? parseTarget(raw) : null;
                return (
                  <tr key={r.key} className="border-t border-line dark:border-line-dark">
                    <td className="whitespace-nowrap py-2 pr-3 font-medium text-ink dark:text-ink-dark">{r.label}</td>
                    <td className="py-2">
                      <input
                        type="text"
                        value={raw}
                        onChange={(e) => setMap((m) => ({ ...m, [r.key]: e.target.value }))}
                        placeholder="https://chat.whatsapp.com/… or 91XXXXXXXXXX"
                        className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
                        aria-label={`WhatsApp chat for ${r.label}`}
                      />
                      <span className={`block text-xs ${raw.trim() && !parsed ? 'text-status-critical' : 'text-ink-muted'}`}>{raw.trim() ? (parsed ? targetLabel(parsed) : 'Not a group link or a number') : 'not set · the share sheet is used'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 dark:border-line-dark">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );
}
