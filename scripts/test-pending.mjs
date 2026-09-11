/**
 * Checks the Pending Tasks snapshot builder against an .xlsx export of the
 * "Pending Tasks (Sales Overdue)" sheet.
 *   node scripts/test-pending.mjs --workbook pending.xlsx [--today 2026-09-09]
 */
import assert from 'node:assert/strict';
import { buildPendingSnapshot, pendingDate, pendingTeamTotals } from '../server/pending.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { arg } from './env.mjs';

const wb = arg('--workbook');
if (!wb) { console.error('Pass --workbook <pending.xlsx>'); process.exit(1); }
const today = arg('--today', '2026-09-09');
const { sheets } = sheetsFromWorkbook(wb, '__none__');

assert.equal(pendingDate(46274), '2026-09-09');
assert.equal(pendingDate('10/08/2026, 13:29'), '2026-08-10');
assert.equal(pendingDate('2026-09-09T00:00:00'), '2026-09-09');
assert.equal(pendingDate(''), null);

for (const mode of ['sheet', 'fallback']) {
  const snap = buildPendingSnapshot(sheets, { today, mode });
  assert.equal(snap.date, today);
  assert.ok(snap.rows.length > 0, `${mode}: rows produced`);
  assert.ok(snap.rows.every((r) => r.length === 7 && ['IC', 'LM'].includes(r[0]) && ['today', 'overdue', 'upcoming'].includes(r[4]) && ['owner', 'other', 'unknown', 'resigned'].includes(r[5]) && r[6] > 0), `${mode}: tuple shape`);
  const counted = snap.rows.reduce((s, r) => s + r[6], 0);
  assert.equal(counted, snap.stats.IC.counted + snap.stats.LM.counted, `${mode}: counts add up`);
  assert.ok(snap.subjects.includes('Follow Up'), `${mode}: subjects found`);
  const teams = pendingTeamTotals(snap);
  const tot = teams.reduce((a, t) => ({ ic_today: a.ic_today + t.ic_today, ic_overdue: a.ic_overdue + t.ic_overdue, lm_today: a.lm_today + t.lm_today, lm_overdue: a.lm_overdue + t.lm_overdue }), { ic_today: 0, ic_overdue: 0, lm_today: 0, lm_overdue: 0 });
  const own = teams.reduce((a, t) => a + t.ic_overdue_owner + t.lm_overdue_owner, 0);
  assert.ok(own <= tot.ic_overdue + tot.lm_overdue, `${mode}: owner-rule counts never exceed all-task counts`);
  console.log(`${mode} mode: ${snap.rows.length} tuples, ${teams.length} teams, all tasks IC ${tot.ic_today}/${tot.ic_overdue} LM ${tot.lm_today}/${tot.lm_overdue}, owner-rule overdue ${own}`);
  console.log('  ' + snap.notes.join('\n  '));
  if (mode === 'fallback') {
    for (const t of teams.sort((a, b) => (b.ic_today + b.ic_overdue + b.lm_today + b.lm_overdue) - (a.ic_today + a.ic_overdue + a.lm_today + a.lm_overdue)).slice(0, 14)) {
      console.log(`  ${t.team.padEnd(30)} all IC ${String(t.ic_today).padStart(4)} / ${String(t.ic_overdue).padStart(4)}  LM ${String(t.lm_today).padStart(4)} / ${String(t.lm_overdue).padStart(4)}   owner-rule IC ${String(t.ic_overdue_owner).padStart(4)} LM ${String(t.lm_overdue_owner).padStart(4)}   BDEs ${t.bdes}`);
    }
  }
}
// privacy: nothing but counts, teams, owner names and subjects in the output
const snap = buildPendingSnapshot(sheets, { today, mode: 'fallback' });
assert.ok(!JSON.stringify(snap).includes('LM-'), 'no lead ids in the snapshot');
console.log('pending OK');
