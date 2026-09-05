/**
 * Date helpers. All dates are ISO calendar strings (YYYY-MM-DD) interpreted in
 * Asia/Kolkata. Arithmetic is done with UTC-midnight timestamps so no local
 * timezone conversion can shift a day.
 */
import type { DatePreset } from '../types';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const DAY_MS = 86400000;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toMs(s));
}

export function toMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today's calendar date in IST. */
export function todayIST(): string {
  return fromMs(Math.floor((Date.now() + IST_OFFSET_MS) / DAY_MS) * DAY_MS);
}

export function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * DAY_MS);
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso: string): number {
  return new Date(toMs(iso)).getUTCDay();
}

/** Monday of the ISO week containing the date. */
export function weekStart(iso: string): string {
  const wd = weekday(iso);
  const back = wd === 0 ? 6 : wd - 1;
  return addDays(iso, -back);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return fromMs(Date.UTC(y, m, 0));
}

export function clampRange(from: string, to: string, bounds: { from: string; to: string } | null) {
  if (!bounds) return { from, to };
  const f = from < bounds.from ? bounds.from : from;
  const t = to > bounds.to ? bounds.to : to;
  return { from: f, to: t };
}

/** Resolve a preset into an inclusive range. `today` defaults to IST today. */
export function presetRange(preset: DatePreset, dataRange: { from: string; to: string } | null, today = todayIST()): { from: string; to: string } {
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'last30': return { from: addDays(today, -29), to: today };
    case 'thisWeek': return { from: weekStart(today), to: today };
    case 'thisMonth': return { from: monthStart(today), to: today };
    case 'prevMonth': { const prevEnd = addDays(monthStart(today), -1); return { from: monthStart(prevEnd), to: prevEnd }; }
    case 'all': return dataRange ?? { from: today, to: today };
    default: return { from: today, to: today };
  }
}

/** The immediately preceding range of equal length. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo };
}

export const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 Days',
  last30: 'Last 30 Days',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  prevMonth: 'Previous Month',
  all: 'All Data',
  custom: 'Custom Range',
};

/** "5 Sep 2026" */
export function formatDate(iso: string, withYear = true): string {
  if (!isIsoDate(iso)) return iso ?? '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/** "5 Sep" for axes */
export function formatDateShort(iso: string): string {
  return formatDate(iso, false);
}

/** "Sep 2026" */
export function formatMonth(isoMonth: string): string {
  const [y, m] = isoMonth.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "10 Aug – 20 Aug 2026" */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatDate(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDate(from, !sameYear)} – ${formatDate(to)}`;
}

/** "05 Sep 2026, 14:05" in IST from an ISO timestamp. */
export function formatTimestampIST(iso: string | undefined): string {
  if (!iso) return '–';
  const t = Date.parse(iso);
  if (isNaN(t)) return '–';
  const d = new Date(t + IST_OFFSET_MS);
  return `${pad(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Enumerate every date in a range (inclusive). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const end = toMs(to);
  for (let t = toMs(from); t <= end; t += DAY_MS) out.push(fromMs(t));
  return out;
}
