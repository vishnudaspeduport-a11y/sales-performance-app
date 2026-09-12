/**
 * Pending CRM tasks straight from Salesforce, replacing the "Pending Tasks (Sales Overdue)" sheet.
 *
 * The sheet's ic / lm tabs were exports of the reports "Till Today IC Tasks-MIS" and
 * "Till Today LM Tasks-MIS": open Task records on an Interested Course (IC) or a Lead Master
 * (LM) with an Eduport due date up to today. This module queries those tasks directly:
 *   - subject, due date/time, assigned user (Task owner) and the IC / LM owner with their role
 *   - the sheet's helper columns are derived here: due date in India time (column K), the
 *     owner's alias (column N) and the resigned status (column P) from the icku directory
 *     through the Salesforce user's Employee Number, by name when the number is missing, and
 *     lastly the Salesforce "active" flag.
 *
 * Connection (GitHub Actions secrets / local .env):
 *   SF_LOGIN_URL       https://<my-domain>.my.salesforce.com
 *   SF_CLIENT_ID + SF_CLIENT_SECRET                   connected app, OAuth client credentials flow
 *   SF_USERNAME + SF_PASSWORD + SF_SECURITY_TOKEN     fallback: OAuth username-password flow
 *   SF_API_VERSION     default v62.0
 *   SF_IC_SUBJECTS / SF_LM_SUBJECTS   comma-separated subjects to keep (the reports' subject filter)
 *   SF_IC_REPORT_ID / SF_LM_REPORT_ID  the MIS reports the sheet was exported from; their filter
 *                                      definitions are read and written into the sync notes
 *
 * Only counts, team names and executive names leave this module; no lead ids or comments.
 */
import { normEmpNo } from './directory.mjs';

export const DEFAULT_IC_SUBJECTS = ['Follow Up', 'May Buy Later', 'Ready To Pay', 'Not Connected'];
export const DEFAULT_LM_SUBJECTS = ['Follow Up', 'May Buy Later', 'Ready To Pay', 'Not Connected'];

const clean = (s) => String(s ?? '').trim();
const nameKey = (s) => clean(s).toLowerCase().replace(/[^a-z]/g, '');
const list = (v, dflt) => { const a = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean); return a.length ? a : dflt; };

/** Connection settings from the environment; null when Salesforce is not configured. */
export function salesforceConfig(env = process.env) {
  const loginUrl = clean(env.SF_LOGIN_URL).replace(/\/+$/, '');
  if (!loginUrl) return null;
  return {
    loginUrl,
    clientId: clean(env.SF_CLIENT_ID), clientSecret: clean(env.SF_CLIENT_SECRET),
    username: clean(env.SF_USERNAME), password: clean(env.SF_PASSWORD), securityToken: clean(env.SF_SECURITY_TOKEN),
    apiVersion: clean(env.SF_API_VERSION) || 'v62.0',
    icSubjects: list(env.SF_IC_SUBJECTS, DEFAULT_IC_SUBJECTS),
    lmSubjects: list(env.SF_LM_SUBJECTS, DEFAULT_LM_SUBJECTS),
    icReportId: clean(env.SF_IC_REPORT_ID) || '00Ofv000001bxVBEAY',
    lmReportId: clean(env.SF_LM_REPORT_ID) || '00Ofv000001bxYPEAY',
  };
}

async function tokenRequest(cfg, params) {
  const res = await fetch(`${cfg.loginUrl}/services/oauth2/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`${body.error || res.status}: ${body.error_description || 'no access token'}`);
  return { accessToken: body.access_token, instanceUrl: String(body.instance_url || cfg.loginUrl).replace(/\/+$/, '') };
}

/** Log in with the client-credentials flow, else the username-password flow. */
export async function salesforceLogin(cfg) {
  const errors = [];
  if (cfg.clientId && cfg.clientSecret) {
    try { return { ...(await tokenRequest(cfg, { grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret })), flow: 'client_credentials' }; }
    catch (e) { errors.push(`client credentials: ${e.message}`); }
  }
  if (cfg.clientId && cfg.clientSecret && cfg.username && cfg.password) {
    try { return { ...(await tokenRequest(cfg, { grant_type: 'password', client_id: cfg.clientId, client_secret: cfg.clientSecret, username: cfg.username, password: cfg.password + cfg.securityToken })), flow: 'password' }; }
    catch (e) { errors.push(`username-password: ${e.message}`); }
  }
  throw new Error(`Salesforce login failed (${errors.join('; ') || 'SF_CLIENT_ID / SF_CLIENT_SECRET not set'})`);
}

/** Run a SOQL query and follow nextRecordsUrl until every record is in. */
export async function salesforceQueryAll(session, apiVersion, soql) {
  const out = [];
  let url = `${session.instanceUrl}/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`;
  for (let page = 0; url && page < 500; page++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${session.accessToken}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Salesforce query failed: ${res.status} ${Array.isArray(body) ? body.map((b) => b.message).join('; ') : JSON.stringify(body).slice(0, 200)}`);
    out.push(...(body.records || []));
    url = body.done ? null : `${session.instanceUrl}${body.nextRecordsUrl}`;
  }
  return out;
}

/** Filter definition of a report (Reports REST API describe), summarised as text for the sync notes. */
export async function describeReportFilters(session, apiVersion, reportId) {
  const res = await fetch(`${session.instanceUrl}/services/data/${apiVersion}/analytics/reports/${reportId}/describe`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`report ${reportId}: ${res.status} ${Array.isArray(body) ? body.map((b) => b.message).join('; ') : ''}`);
  const md = body.reportMetadata || {};
  const ext = body.reportExtendedMetadata || {};
  const label = (col) => ext.detailColumnInfo?.[col]?.label || col;
  const filters = (md.reportFilters || []).map((f, i) => `${i + 1}. ${label(f.column)} ${f.operator} "${f.value}"`);
  const sd = md.standardDateFilter;
  const parts = [];
  if (md.reportType?.label || md.reportType?.type) parts.push(`type ${md.reportType.label || md.reportType.type}`);
  if (md.scope) parts.push(`scope ${md.scope}`);
  if (sd && sd.durationValue && sd.durationValue !== 'CUSTOM') parts.push(`${label(sd.column)} = ${sd.durationValue}`);
  else if (sd && (sd.startDate || sd.endDate)) parts.push(`${label(sd.column)} from ${sd.startDate || '…'} to ${sd.endDate || '…'}`);
  if (filters.length) parts.push(`filters: ${filters.join('; ')}${md.reportBooleanFilter ? ` (logic ${md.reportBooleanFilter})` : ''}`);
  parts.push(`columns: ${(md.detailColumns || []).map(label).join(', ')}`);
  return `Report "${md.name || reportId}": ${parts.join(' · ')}`;
}

const soqlList = (values) => values.map((v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ');

/** Open tasks on an IC or LM, due up to the end of `today` (India time), with the parent's owner and role. */
export function pendingTaskSoql(whatType, subjects, dueBeforeUtcIso) {
  return `SELECT Id, Subject__c, Eduport_Due_Date_and_TIme__c, OwnerId, Owner.Name, Owner.Alias, `
    + `TYPEOF What WHEN ${whatType} THEN OwnerId, Owner.Name, Owner.Alias, Owner.UserRole.Name END `
    + `FROM Task WHERE What.Type = '${whatType}' AND IsClosed = false `
    + `AND Subject__c IN (${soqlList(subjects)}) AND Eduport_Due_Date_and_TIme__c < ${dueBeforeUtcIso} `
    + `ORDER BY Eduport_Due_Date_and_TIme__c`;
}

export const USER_SOQL = 'SELECT Id, Name, Alias, EmployeeNumber, IsActive, UserRole.Name FROM User WHERE UserType = \'Standard\'';

/** YYYY-MM-DD of an ISO timestamp in a time zone. */
export function dateInZone(iso, tz = 'Asia/Kolkata') {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** UTC instant at which the next day starts in `tz` (the "due up to today" cut-off). */
export function nextDayStartUtc(todayIso, tz = 'Asia/Kolkata') {
  // Offset of the zone at midnight: compare the wall-clock date of a UTC guess with the target date.
  const target = new Date(`${todayIso}T00:00:00Z`).getTime() + 86400000; // next day, as if UTC
  for (const offsetMin of [330, 0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, -60, -120, -180, -240, -300, -360, -420, -480]) {
    const guess = new Date(target - offsetMin * 60000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(guess);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const hour = get('hour') === '24' ? '00' : get('hour');
    if (`${get('year')}-${get('month')}-${get('day')}` === new Date(target).toISOString().slice(0, 10) && hour === '00') return guess.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return new Date(target - 330 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Flatten a Task record from the query above. */
export function normaliseTask(rec, source) {
  const what = rec.What || {};
  return {
    source,
    subject: clean(rec.Subject__c) || '(none)',
    due: rec.Eduport_Due_Date_and_TIme__c || null,
    assignedId: rec.OwnerId || '', assignedAlias: clean(rec.Owner?.Alias), assignedName: clean(rec.Owner?.Name),
    ownerId: what.OwnerId || '', ownerName: clean(what.Owner?.Name), ownerAlias: clean(what.Owner?.Alias),
    role: clean(what.Owner?.UserRole?.Name),
  };
}

export function normaliseUser(rec) {
  return { id: rec.Id, name: clean(rec.Name), alias: clean(rec.Alias), empNo: normEmpNo(rec.EmployeeNumber), active: rec.IsActive === true, role: clean(rec.UserRole?.Name) };
}

/**
 * Read the open IC and LM tasks and the users from Salesforce.
 * @returns {Promise<{ tasks: object[], users: object[], asOf: string, flow: string, soql: string[] }>}
 */
export async function fetchPendingFromSalesforce(cfg, { today, tz = 'Asia/Kolkata' } = {}) {
  const session = await salesforceLogin(cfg);
  const cutOff = nextDayStartUtc(today || dateInZone(new Date().toISOString(), tz), tz);
  const icSoql = pendingTaskSoql('Interested_Course__c', cfg.icSubjects, cutOff);
  const lmSoql = pendingTaskSoql('Lead_Master__c', cfg.lmSubjects, cutOff);
  const [ic, lm, users] = await Promise.all([
    salesforceQueryAll(session, cfg.apiVersion, icSoql),
    salesforceQueryAll(session, cfg.apiVersion, lmSoql),
    salesforceQueryAll(session, cfg.apiVersion, USER_SOQL),
  ]);
  const reportNotes = [];
  for (const id of [cfg.icReportId, cfg.lmReportId]) {
    if (!id) continue;
    try { reportNotes.push(await describeReportFilters(session, cfg.apiVersion, id)); } catch (e) { reportNotes.push(`Report ${id} could not be described: ${e.message}`); }
  }
  return { tasks: [...ic.map((r) => normaliseTask(r, 'IC')), ...lm.map((r) => normaliseTask(r, 'LM'))], users: users.map(normaliseUser), asOf: new Date().toISOString(), flow: session.flow, soql: [icSoql, lmSoql], reportNotes };
}

/**
 * Turn Salesforce tasks into the same snapshot the sheet produced (see pending.mjs):
 * rows [source, team, owner, subject, bucket, kind, count]; kind = owner | other | unknown | resigned.
 * `directory` is the icku index (by employee number) used for the resigned status.
 */
export function buildPendingFromSalesforce({ tasks, users, asOf }, { today, tz = 'Asia/Kolkata', directory = null, subjects = null } = {}) {
  const date = today || dateInZone(new Date().toISOString(), tz);
  const userById = new Map(users.map((u) => [u.id, u]));
  const dirByName = new Map();
  for (const e of Object.values(directory || {})) if (e && e.name) dirByName.set(nameKey(e.name), e);
  const statusCache = new Map();
  const statusOf = (user) => {
    if (!user) return { status: '', via: 'none' };
    if (statusCache.has(user.id)) return statusCache.get(user.id);
    let out;
    const byNo = directory && user.empNo ? directory[user.empNo] : null;
    const byName = !byNo && directory ? dirByName.get(nameKey(user.name)) : null;
    const hit = byNo || byName;
    if (hit) out = { status: hit.isWorking ? 'Not Resigned' : 'Resigned', via: byNo ? 'icku number' : 'icku name' };
    else out = { status: user.active ? 'Not Resigned' : 'Resigned', via: 'salesforce active flag' };
    statusCache.set(user.id, out);
    return out;
  };

  const counts = new Map();
  const subjectSet = new Set();
  const stats = { IC: { rows: 0, counted: 0, assignedElsewhere: 0, resigned: 0, unknown: 0, noDate: 0, ownerRule: 0 }, LM: { rows: 0, counted: 0, assignedElsewhere: 0, resigned: 0, unknown: 0, noDate: 0, ownerRule: 0 } };
  const via = { 'icku number': 0, 'icku name': 0, 'salesforce active flag': 0 };
  const seenOwner = new Set();
  for (const t of tasks) {
    const st = stats[t.source]; if (!st) continue;
    st.rows++;
    const owner = userById.get(t.ownerId) || null;
    const ownerName = t.ownerName || (owner ? owner.name : '') || '(no owner)';
    const team = t.role || (owner ? owner.role : '') || '(no team)';
    const { status, via: how } = statusOf(owner);
    if (owner && !seenOwner.has(owner.id)) { seenOwner.add(owner.id); via[how] = (via[how] || 0) + 1; }
    let kind = 'owner';
    if (status === 'Resigned') { kind = 'resigned'; st.resigned++; }
    else if (t.assignedId !== t.ownerId) { kind = 'other'; st.assignedElsewhere++; }
    else if (!owner) { kind = 'unknown'; st.unknown++; }
    const dueDate = dateInZone(t.due, tz);
    if (!dueDate) { st.noDate++; continue; }
    const bucket = dueDate === date ? 'today' : dueDate < date ? 'overdue' : 'upcoming';
    subjectSet.add(t.subject);
    const key = [t.source, team, ownerName, t.subject, bucket, kind].join('');
    counts.set(key, (counts.get(key) || 0) + 1);
    st.counted++;
    if (kind === 'owner') st.ownerRule++;
  }
  const notes = [];
  for (const source of ['IC', 'LM']) {
    const st = stats[source];
    notes.push(`${source}: ${st.counted} open tasks read from Salesforce; ${st.ownerRule} pass the team rule (${st.assignedElsewhere} assigned to someone other than the owner, ${st.unknown} with an owner missing from the user list, ${st.resigned} with a resigned owner${st.noDate ? `, ${st.noDate} without a due date` : ''}).`);
  }
  notes.push(`Resigned status: ${via['icku number']} owners matched in icku by employee number, ${via['icku name']} by name, ${via['salesforce active flag']} by the Salesforce active flag only. Assigned-to-owner is compared by user id, not alias.`);
  const rows = [...counts.entries()].map(([k, n]) => [...k.split(''), n]).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2].localeCompare(b[2])));
  const userRows = users.filter((u) => u.active && u.name).map((u) => [u.empNo, u.name, u.role]);
  return { date, asOf: asOf || new Date().toISOString(), sources: ['IC', 'LM'], subjects: [...(subjects || subjectSet)].sort(), rows, users: userRows, stats, notes, origin: 'salesforce' };
}
