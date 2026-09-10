/**
 * "Pending Tasks (Sales Overdue)" sheet → one daily snapshot of pending CRM tasks.
 *
 * The sheet's `ic` tab lists Interested Course tasks and `lm` lists Lead Master tasks, one
 * row per task with its due date, the lead's owner (executive), the owner's role (team) and
 * the alias the task is assigned to. Its DB tab (blocks 2 and 4) counts, per team and per
 * executive, tasks due today and tasks overdue ("till yesterday"), keeping a task only when
 *   - it is assigned to the lead's owner (Assigned Alias = owner's alias, sheet column N), and
 *   - the owner has not resigned (sheet column P = "Not Resigned").
 * This module reproduces that from the raw rows. When the sheet's helper columns N and P are
 * present they are used as they are, so the numbers match the sheet; otherwise (or when
 * `mode: 'fallback'`) the alias and resignation status are looked up from the Alias,
 * Users Reports and Resigned tabs.
 *
 * Only counts leave this module: no lead ids, comments, phone numbers or customer names.
 */

export const PENDING_TABS = { ic: 'ic', lm: 'lm', alias: 'Alias', users: 'Users Reports', resigned: 'Resigned' };
export const PENDING_SOURCES = ['IC', 'LM'];
export const PENDING_BUCKETS = ['today', 'overdue', 'upcoming'];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[ .]/g, '');
const clean = (s) => String(s ?? '').trim();

function serialToIso(n) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

/** Date part of a cell: serial number, ISO text, or dd/mm/yyyy[, time]. */
export function pendingDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) return serialToIso(Math.floor(v));
  const s = clean(v);
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Today's date in the given zone (IST by default), YYYY-MM-DD. */
export function todayInZone(tz = 'Asia/Kolkata', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function findHeader(values) {
  for (let r = 0; r < Math.min(values.length, 10); r++) {
    const row = (values[r] || []).map((h) => clean(h).toLowerCase());
    const subject = row.indexOf('subject');
    const owner = row.findIndex((h) => h.includes('owner name'));
    if (subject >= 0 && owner >= 0) {
      const dates = row.map((h, i) => (h === 'date' ? i : -1)).filter((i) => i >= 0);
      const timeIdx = row.indexOf('time');
      const empIdx = row.findIndex((h) => h.includes('employee number'));
      return {
        row: r,
        subject,
        owner,
        role: row.findIndex((h) => h.includes('owner role')),
        cls: row.indexOf('class'),
        alias: row.findIndex((h) => h.includes('assigned alias')),
        due: row.findIndex((h) => h.includes('due date')),
        date: dates.length ? dates[dates.length - 1] : 10,
        ownerAlias: timeIdx >= 0 ? timeIdx + 1 : 13,
        status: empIdx >= 0 ? empIdx + 1 : 15,
      };
    }
  }
  return null;
}

/** Lookups from the reference tabs, used when the helper columns are missing. */
export function pendingReferences(sheets) {
  const alias = {};
  for (const r of (sheets[PENDING_TABS.alias] || []).slice(1)) {
    for (const [a, b] of [[0, 1], [3, 4], [5, 6]]) if (r[a] && r[b] && !alias[norm(r[a])]) alias[norm(r[a])] = clean(r[b]);
  }
  const users = sheets[PENDING_TABS.users] || [];
  const uh = (users[0] || []).map((h) => clean(h).toLowerCase());
  const uName = uh.indexOf('full name'), uAlias = uh.indexOf('alias'), uEmp = uh.findIndex((h) => h.includes('employee number'));
  const empOf = {};
  for (const r of users.slice(1)) {
    if (uName < 0 || !r[uName]) continue;
    const k = norm(r[uName]);
    if (uEmp >= 0 && r[uEmp]) empOf[k] = clean(r[uEmp]);
    if (uAlias >= 0 && r[uAlias] && !alias[k]) alias[k] = clean(r[uAlias]);
  }
  const resigned = new Set((sheets[PENDING_TABS.resigned] || []).slice(1).map((r) => clean(r[0])).filter(Boolean));
  return {
    aliasOf: (owner) => alias[norm(owner)] || '',
    statusOf: (owner) => { const e = empOf[norm(owner)]; return e ? (resigned.has(e) ? 'Resigned' : 'Not Resigned') : ''; },
  };
}

/**
 * @param {Record<string, any[][]>} sheets  raw tab values (ic, lm, and optionally Alias / Users Reports / Resigned)
 * @param {{ today?: string, tz?: string, mode?: 'auto'|'sheet'|'fallback' }} [opts]
 * @returns {{ date: string, asOf: string, sources: string[], subjects: string[], rows: any[][], stats: object, notes: string[] }}
 *   rows are tuples [source, team, owner, subject, bucket, kind, count]; kind = owner | other | unknown
 */
export function buildPendingSnapshot(sheets, opts = {}) {
  const tz = opts.tz || 'Asia/Kolkata';
  const today = opts.today || todayInZone(tz);
  const refs = pendingReferences(sheets);
  const counts = new Map();
  const subjects = new Set();
  const notes = [];
  const stats = {};
  for (const source of PENDING_SOURCES) {
    const tab = source === 'IC' ? PENDING_TABS.ic : PENDING_TABS.lm;
    const values = sheets[tab];
    const st = { rows: 0, counted: 0, assignedElsewhere: 0, resigned: 0, noDate: 0, helperColumns: false };
    stats[source] = st;
    if (!values || !values.length) { notes.push(`Tab "${tab}" is missing or empty.`); continue; }
    const h = findHeader(values);
    if (!h) { notes.push(`Tab "${tab}": no header row with Subject and Owner Name found.`); continue; }
    const data = values.slice(h.row + 1).filter((r) => r && (clean(r[h.subject]) || clean(r[h.owner])));
    const helperFilled = data.filter((r) => clean(r[h.ownerAlias]) !== '').length;
    const useSheetColumns = opts.mode === 'sheet' || (opts.mode !== 'fallback' && helperFilled >= data.length * 0.5);
    st.helperColumns = useSheetColumns;
    for (const r of data) {
      st.rows++;
      const owner = clean(r[h.owner]);
      const team = clean(r[h.role]) || '(no team)';
      const subject = clean(r[h.subject]) || '(none)';
      const assigned = clean(r[h.alias]);
      const ownerAlias = useSheetColumns ? clean(r[h.ownerAlias]) : (clean(r[h.ownerAlias]) || refs.aliasOf(owner));
      const status = useSheetColumns ? clean(r[h.status]) : (clean(r[h.status]) || refs.statusOf(owner));
      // Every task is kept; `kind` records how it stands against the sheet's rule:
      //   owner   = assigned to the lead's owner and the owner has not resigned (the sheet's full rule)
      //   other   = assigned to someone other than the owner
      //   unknown = owner resigned, or not found in the sheet's user list
      let kind = 'owner';
      if (assigned !== ownerAlias) { kind = 'other'; st.assignedElsewhere++; }
      else if (useSheetColumns ? status !== 'Not Resigned' : status === 'Resigned') { kind = 'unknown'; st.resigned++; }
      const date = pendingDate(r[h.date]) || pendingDate(r[h.due]);
      if (!date) { st.noDate++; continue; }
      const bucket = date === today ? 'today' : date < today ? 'overdue' : 'upcoming';
      subjects.add(subject);
      const key = [source, team, owner || '(no owner)', subject, bucket, kind].join('');
      counts.set(key, (counts.get(key) || 0) + 1);
      st.counted++;
      if (kind === 'owner') st.ownerRule = (st.ownerRule || 0) + 1;
    }
    notes.push(`${source}: ${st.counted} tasks in the tab; ${st.ownerRule || 0} pass the sheet's rule (${st.assignedElsewhere} are assigned to someone other than the owner, ${st.resigned} have a resigned or unknown owner${st.noDate ? `, ${st.noDate} had no due date` : ''})${useSheetColumns ? '' : ' · alias and status looked up from the reference tabs'}.`);
  }
  const users = [];
  {
    const uv = sheets[PENDING_TABS.users] || [];
    const uh = (uv[0] || []).map((h) => clean(h).toLowerCase());
    const iName = uh.indexOf('full name'), iRole = uh.indexOf('role'), iActive = uh.indexOf('active'), iEmp = uh.findIndex((h) => h.includes('employee number'));
    for (const r of uv.slice(1)) {
      if (iName < 0 || !clean(r[iName])) continue;
      const active = iActive < 0 ? true : (r[iActive] === true || String(r[iActive]).toLowerCase() === 'true');
      if (!active) continue;
      users.push([iEmp >= 0 ? clean(r[iEmp]).toUpperCase().replace(/\s+/g, '') : '', clean(r[iName]), iRole >= 0 ? clean(r[iRole]) : '']);
    }
  }
  const rows = [...counts.entries()].map(([k, n]) => [...k.split(''), n]).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2].localeCompare(b[2])));
  return { date: today, asOf: new Date().toISOString(), sources: PENDING_SOURCES, subjects: [...subjects].sort(), rows, users, stats, notes };
}

/** Team-level totals for one snapshot (what the sheet's DB block 2 shows). */
export function pendingTeamTotals(snapshot) {
  const teams = new Map();
  for (const [source, team, owner, , bucket, kind, count] of snapshot.rows) {
    let t = teams.get(team);
    if (!t) { t = { date: snapshot.date, team, ic_today: 0, ic_overdue: 0, lm_today: 0, lm_overdue: 0, ic_today_owner: 0, ic_overdue_owner: 0, lm_today_owner: 0, lm_overdue_owner: 0, owners: new Set() }; teams.set(team, t); }
    t.owners.add(owner);
    if (bucket === 'upcoming') continue;
    const k = `${source.toLowerCase()}_${bucket}`;
    t[k] += count;                       // every task in the tab
    if (kind === 'owner') t[k + '_owner'] += count;   // the sheet's full rule
  }
  return [...teams.values()].map(({ owners, ...t }) => ({ ...t, bdes: owners.size }));
}
