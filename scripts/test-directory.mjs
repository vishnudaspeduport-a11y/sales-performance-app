/**
 * Checks the icku directory integration without a database: a fake directory is fed to the
 * transform and must override the sheet's manager, mark unmapped executives, and produce the
 * Team Mapping rows.
 *   node scripts/test-directory.mjs --workbook export.xlsx
 */
import assert from 'node:assert/strict';
import { buildDirectoryIndex, directoryTeamRows } from '../server/directory.mjs';
import { buildPayload } from '../server/transform.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const wb = arg('--workbook', process.env.WORKBOOK_PATH);
if (!wb) { console.error('Pass --workbook <export.xlsx>'); process.exit(1); }
const cfg = sheetConfig();
const { sheets } = sheetsFromWorkbook(wb);

const base = buildPayload(sheets, cfg);
const withSheetManager = base.employees.find((e) => e.manager && /^EP\d+$/.test(e.id));
assert.ok(withSheetManager, 'baseline has an executive with a sheet manager');
const other = base.employees.find((e) => e.manager && e.id !== withSheetManager.id && /^EP\d+$/.test(e.id));

// fake directory: the first executive reports to "Directory Manager", the second has no manager,
// a third person exists only in the directory (sales department, no calls)
const rows = [
  { empId: 'M1', empNo: 'EP9001', name: 'Directory Manager', title: 'Sales Manager', department: 'Sales Department', subDepartment: '', location: 'Kozhikode', managerEmpId: '', status: 'Working', isWorking: true, joinedOn: '2022-01-01', exitDate: '', terminationType: '', tenureDays: 1000 },
  { empId: 'E1', empNo: withSheetManager.id, name: withSheetManager.name, title: 'Business Development Executive', department: 'Sales Department', subDepartment: '', location: 'Kozhikode', managerEmpId: 'M1', status: 'Working', isWorking: true, joinedOn: '2025-01-15', exitDate: '', terminationType: '', tenureDays: 600 },
  { empId: 'E2', empNo: other.id, name: other.name, title: 'Business Development Executive', department: 'Sales Department', subDepartment: '', location: '', managerEmpId: '', status: 'Working', isWorking: true, joinedOn: '2025-03-01', exitDate: '', terminationType: '', tenureDays: 500 },
  { empId: 'E3', empNo: 'EP9002', name: 'Only In Directory', title: 'Business Development Executive', department: 'Sales Department', subDepartment: '', location: '', managerEmpId: 'M1', status: 'Working', isWorking: true, joinedOn: '2026-08-01', exitDate: '', terminationType: '', tenureDays: 40 },
  { empId: 'E4', empNo: 'EP9003', name: 'Left Company', title: 'Business Development Executive', department: 'Sales Department', subDepartment: '', location: '', managerEmpId: 'M1', status: 'Exited', isWorking: false, joinedOn: '2024-01-01', exitDate: '2026-07-31', terminationType: 'Resignation', tenureDays: 900 },
];
const index = buildDirectoryIndex(rows);
assert.equal(index[withSheetManager.id].managerName, 'Directory Manager');

const p = buildPayload(sheets, { ...cfg, directory: index });
const e1 = p.employees.find((e) => e.id === withSheetManager.id);
const e2 = p.employees.find((e) => e.id === other.id);
assert.equal(e1.manager, 'Directory Manager', 'directory manager overrides the sheet manager');
assert.equal(e1.mappingSource, 'directory');
assert.equal(e1.title, 'Business Development Executive');
assert.equal(e1.joinedOn, '2025-01-15');
assert.equal(e2.manager, '', 'directory row without a manager is unassigned even if the sheet had one');
assert.equal(e2.mappingSource, 'directory');
const sheetOnly = p.employees.find((e) => e.mappingSource === 'sheet');
assert.ok(sheetOnly, 'executives absent from the directory keep the sheet mapping and are marked as such');
assert.ok(p.meta.notes.some((n) => /icku directory/i.test(n)), 'note about the directory');

const team = directoryTeamRows(index, p.employees.map((e) => e.id));
const names = team.map((r) => r[1]);
assert.ok(names.includes('Only In Directory') && names.includes('Directory Manager') && names.includes('Left Company'));
const exited = team.find((r) => r[1] === 'Left Company');
assert.equal(exited[7], 'Exited');
console.log(`directory OK — ${p.employees.filter((e) => e.mappingSource === 'directory').length} from directory, ${p.employees.filter((e) => e.mappingSource === 'sheet').length} from sheet, ${p.employees.filter((e) => e.mappingSource === 'none').length} unmapped; team rows ${team.length}`);
