import type { AttendancePayload } from '../types';
import { addDays, isIsoDate } from './dates';

/**
 * Daily attendance of the sales department, read from icku by the sync. Served compactly as one
 * string per employee with one character per day (see server/attendance.mjs); unpacked here into
 * "who was present on which day".
 */
export interface Attendance {
  asOf: string;
  from: string;
  to: string;
  /** first day on which anyone has an attendance status; earlier days have no attendance data */
  firstDay: string | null;
  statuses: string[];
  /** date → employee numbers marked present that day */
  present: Map<string, Set<string>>;
}

/** Present, late and half day count as present; a blank status, absence, leave or an off day do not. */
export function countsAsPresent(status: string): boolean {
  const s = status.trim();
  return !!s && s !== '(blank)' && !/absent|leave|off|holiday|void/i.test(s);
}

export function parseAttendance(p: AttendancePayload | null | undefined): Attendance | null {
  if (!p || !isIsoDate(p.from) || !isIsoDate(p.to) || !Array.isArray(p.statuses) || !p.emp || typeof p.emp !== 'object') return null;
  const presentCode = p.statuses.map((s) => countsAsPresent(String(s)));
  const present = new Map<string, Set<string>>();
  const dates: string[] = [];
  for (let d = p.from; d <= p.to && dates.length < 2000; d = addDays(d, 1)) dates.push(d);
  let firstDay: string | null = null;
  for (const [empNo, e] of Object.entries(p.emp)) {
    const s = typeof e?.s === 'string' ? e.s : '';
    for (let i = 0; i < s.length && i < dates.length; i++) {
      const c = s[i];
      if (c === '-') continue;
      const idx = parseInt(c, 36);
      if (!presentCode[idx]) continue;
      const date = dates[i];
      let set = present.get(date);
      if (!set) { set = new Set(); present.set(date, set); }
      set.add(empNo);
      if (!firstDay || date < firstDay) firstDay = date;
    }
  }
  return { asOf: String(p.asOf ?? ''), from: p.from, to: p.to, firstDay, statuses: p.statuses.map(String), present };
}

/** True when attendance covers every day of the range (the range does not start before the first attendance day). */
export function attendanceCovers(a: Attendance | null, range: { from: string; to: string }): boolean {
  return !!a && !!a.firstDay && range.from >= a.firstDay && range.from <= a.to;
}
