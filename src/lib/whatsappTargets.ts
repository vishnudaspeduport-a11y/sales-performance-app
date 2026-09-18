import { isMobileDevice } from './shareImage';

/**
 * Which WhatsApp chat a team's picture goes to: a group (its invite link) or one number.
 * Chosen by the person using the dashboard and kept in this browser only (localStorage),
 * so no phone number or group link is ever stored in the dashboard's data.
 *   key '*'  → the all-teams table; any other key → that team's executive table.
 */
export type WhatsAppTarget = { kind: 'group'; code: string } | { kind: 'number'; number: string };

const KEY = 'whatsapp.targets.v1';
export const ALL_TEAMS_KEY = '*';

/** A group invite link (chat.whatsapp.com/CODE or the bare code) or a phone number with country code. */
export function parseTarget(input: string): WhatsAppTarget | null {
  const s = input.trim();
  if (!s) return null;
  const group = /(?:chat\.whatsapp\.com\/(?:invite\/)?|web\.whatsapp\.com\/accept\?code=)([A-Za-z0-9_-]{6,})/i.exec(s);
  if (group) return { kind: 'group', code: group[1] };
  const numSrc = s.replace(/^.*?(wa\.me\/|phone=)/, '');
  if (/^\+?[\d\s()-]{8,}$/.test(numSrc)) { const digits = numSrc.replace(/\D/g, ''); if (digits.length >= 8) return { kind: 'number', number: digits }; }
  if (/^[A-Za-z0-9_-]{18,}$/.test(s)) return { kind: 'group', code: s };
  return null;
}

export function targetLabel(t: WhatsAppTarget): string {
  return t.kind === 'group' ? `group · ${t.code.slice(0, 4)}…${t.code.slice(-3)}` : `number · ${t.number.slice(0, 2)}••••${t.number.slice(-4)}`;
}

/** Address that opens the chat: WhatsApp Web on a computer, the app on a phone. */
export function targetUrl(t: WhatsAppTarget): string {
  const mobile = isMobileDevice();
  if (t.kind === 'group') return mobile ? `https://chat.whatsapp.com/${t.code}` : `https://web.whatsapp.com/accept?code=${t.code}`;
  return mobile ? `https://wa.me/${t.number}` : `https://web.whatsapp.com/send?phone=${t.number}`;
}

/** Opens the chat in a new tab; false when the browser blocked the pop-up. */
export function openTarget(t: WhatsAppTarget): boolean {
  const w = window.open(targetUrl(t), '_blank', 'noopener');
  return !!w;
}

export function loadTargets(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export function saveTargets(map: Record<string, string>): void {
  const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim()));
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* private window */ }
}

export function targetFor(teamKey: string): WhatsAppTarget | null {
  const raw = loadTargets()[teamKey];
  return raw ? parseTarget(raw) : null;
}
