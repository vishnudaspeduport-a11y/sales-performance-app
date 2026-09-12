/**
 * Checks the Salesforce pending-tasks builder without a Salesforce login: SOQL text, the
 * India-time day cut-off, and the snapshot built from a small set of task records shaped
 * like the query results.
 *   node scripts/test-salesforce.mjs
 */
import assert from 'node:assert/strict';
import { buildPendingFromSalesforce, dateInZone, nextDayStartUtc, normaliseTask, normaliseUser, pendingTaskSoql, salesforceConfig } from '../server/salesforce.mjs';
import { pendingTeamTotals } from '../server/pending.mjs';

// config
assert.equal(salesforceConfig({}), null);
const cfg = salesforceConfig({ SF_LOGIN_URL: 'https://x.my.salesforce.com/', SF_CLIENT_ID: 'id', SF_CLIENT_SECRET: 's', SF_IC_SUBJECTS: 'Follow Up, Ready To Pay' });
assert.equal(cfg.loginUrl, 'https://x.my.salesforce.com');
assert.deepEqual(cfg.icSubjects, ['Follow Up', 'Ready To Pay']);
assert.equal(cfg.lmSubjects.length, 4);

// dates: 2026-09-12 in India ends at 2026-09-12T18:30:00Z
assert.equal(nextDayStartUtc('2026-09-12', 'Asia/Kolkata'), '2026-09-12T18:30:00Z');
assert.equal(dateInZone('2026-09-12T18:29:59.000+0000', 'Asia/Kolkata'), '2026-09-12');
assert.equal(dateInZone('2026-09-12T18:30:00.000+0000', 'Asia/Kolkata'), '2026-09-13');
assert.equal(dateInZone('', 'Asia/Kolkata'), '');

// SOQL
const soql = pendingTaskSoql('Interested_Course__c', ['Follow Up', "O'Brien"], '2026-09-12T18:30:00Z');
assert.ok(soql.includes("What.Type = 'Interested_Course__c'") && soql.includes("IN ('Follow Up', 'O\\'Brien')") && soql.includes('< 2026-09-12T18:30:00Z'), 'soql shape');

// records as the REST API returns them
const rawUsers = [
  { Id: 'U1', Name: 'Aswathi A M', Alias: 'AAM', EmployeeNumber: 'EP155', IsActive: true, UserRole: { Name: 'Executive-Team Aswanth' } },
  { Id: 'U2', Name: 'Theertha Ajith', Alias: 'Theer', EmployeeNumber: null, IsActive: true, UserRole: { Name: 'Executive-Team Vishnu P' } },
  { Id: 'U3', Name: 'Old Exec', Alias: 'Old', EmployeeNumber: 'EP999', IsActive: true, UserRole: { Name: 'Executive-Team Fasil' } },
  { Id: 'U4', Name: 'Gone User', Alias: 'Gone', EmployeeNumber: null, IsActive: false, UserRole: { Name: 'Demo User' } },
];
const task = (id, source, subject, due, ownerId, assignedId = ownerId) => ({
  Id: id, Subject__c: subject, Eduport_Due_Date_and_TIme__c: due, OwnerId: assignedId, Owner: { Name: 'x', Alias: 'x' },
  What: { OwnerId: ownerId, Owner: { Name: rawUsers.find((u) => u.Id === ownerId)?.Name, Alias: 'a', UserRole: { Name: rawUsers.find((u) => u.Id === ownerId)?.UserRole.Name } } },
});
const rawTasks = [
  task('T1', 'IC', 'Follow Up', '2026-09-12T04:30:00.000+0000', 'U1'),               // today (10:00 IST), owner rule
  task('T2', 'IC', 'Follow Up', '2026-09-11T18:29:00.000+0000', 'U1'),               // 23:59 IST on the 11th → overdue
  task('T3', 'IC', 'Ready To Pay', '2026-09-10T05:00:00.000+0000', 'U1', 'U2'),      // assigned to someone else → other
  task('T4', 'LM', 'Not Connected', '2026-09-12T12:00:00.000+0000', 'U2'),           // Theertha: no employee number, matched in icku by name → working
  task('T5', 'LM', 'Not Connected', '2026-09-01T12:00:00.000+0000', 'U3'),           // EP999 exited in icku → resigned
  task('T6', 'IC', 'Follow Up', '2026-09-01T12:00:00.000+0000', 'U4'),               // not in icku, inactive in Salesforce → resigned
  task('T7', 'IC', 'Follow Up', null, 'U1'),                                          // no due date → dropped
];
const directory = {
  EP155: { empNo: 'EP155', name: 'Aswathi A M', isWorking: true },
  EP999: { empNo: 'EP999', name: 'Old Exec', isWorking: false },
  EP777: { empNo: 'EP777', name: 'Theertha Ajith', isWorking: true },
};
const snap = buildPendingFromSalesforce(
  { tasks: rawTasks.map((r, i) => normaliseTask(r, ['IC', 'IC', 'IC', 'LM', 'LM', 'IC', 'IC'][i])), users: rawUsers.map(normaliseUser), asOf: '2026-09-12T06:00:00Z' },
  { today: '2026-09-12', tz: 'Asia/Kolkata', directory },
);
assert.equal(snap.date, '2026-09-12');
assert.ok(snap.rows.every((r) => r.length === 7), 'seven-element tuples');
const find = (owner, bucket, kind) => snap.rows.filter((r) => r[2] === owner && r[4] === bucket && r[5] === kind).reduce((s, r) => s + r[6], 0);
assert.equal(find('Aswathi A M', 'today', 'owner'), 1);
assert.equal(find('Aswathi A M', 'overdue', 'owner'), 1);
assert.equal(find('Aswathi A M', 'overdue', 'other'), 1);
assert.equal(find('Theertha Ajith', 'today', 'owner'), 1);
assert.equal(find('Old Exec', 'overdue', 'resigned'), 1);
assert.equal(find('Gone User', 'overdue', 'resigned'), 1);
assert.equal(snap.stats.IC.noDate, 1);
assert.equal(snap.stats.IC.counted + snap.stats.LM.counted, 6);
assert.deepEqual(snap.subjects, ['Follow Up', 'Not Connected', 'Ready To Pay']);
assert.ok(snap.users.some((u) => u[0] === 'EP155' && u[2] === 'Executive-Team Aswanth'), 'user tuples carry employee number and role');
assert.ok(!snap.users.some((u) => u[1] === 'Gone User'), 'inactive users are not listed');
const teams = pendingTeamTotals(snap);
const aswanth = teams.find((t) => t.team === 'Executive-Team Aswanth');
assert.equal(aswanth.ic_today, 1); assert.equal(aswanth.ic_overdue, 2); assert.equal(aswanth.ic_overdue_owner, 1);
assert.ok(snap.notes.some((n) => /1 by name/.test(n)), 'note explains how the resigned status was found');
assert.ok(!JSON.stringify(snap).includes('T1'), 'no task ids in the snapshot');
console.log('salesforce OK —', snap.rows.length, 'tuples;', snap.notes.join(' | '));
