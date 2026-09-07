/**
 * transform.mjs — pure data-shaping logic (sheet 2-D arrays → dashboard payload).
 * Runs in Netlify Functions and in local scripts. No I/O in this module.
 */

/* ------------------------------------------------------------------ */
/* Column concept mapping — edit this to adapt to a changed sheet.     */
/* Keys are internal concept names, values are header aliases          */
/* (compared case-insensitively, ignoring spaces/punctuation).         */
/* ------------------------------------------------------------------ */
var CONCEPT_ALIASES = {
  date:              ['date', 'call date', 'day', 'report date', 'activity date'],
  employeeId:        ['emp id', 'employee id', 'emp code', 'emp. code', 'employee code', 'ep id', 'empid'],
  employeeName:      ['name', 'employee name', 'employee', 'sales executive', 'executive', 'agent', 'bde'],
  dialed:            ['dialed', 'dialled', 'outgoing', 'outgoing calls', 'calls dialed', 'total dialed', 'total calls', 'calls'],
  dialedConnected:   ['dialed- connected', 'dialed connected', 'dialed - connected', 'outgoing connected', 'connected calls', 'connected', 'dialled connected'],
  talkTimeDialed:    ['talk time dialed', 'total talk time dialed', 'outgoing talk time', 'talk time', 'total talk time'],
  incoming:          ['incoming', 'incoming calls'],
  incomingConnected: ['incoming - connected', 'incoming connected', 'incoming- connected'],
  talkTimeIncoming:  ['talk time incoming', 'total talk time incoming', 'incoming talk time'],
  notConnected:      ['not connected', 'not connected calls', 'unanswered'],
  manager:           ['manager', 'reporting to', 'team leader', 'team lead', 'tl', 'bdm', 'reporting manager'],
  team:              ['team', 'department', 'batch', 'location', 'branch', 'attendance capture scheme', 'scheme', 'tags', 'emp. tags', 'emp tags'],
  status:            ['status', 'employee status', 'working status']
};

var METRIC_CONCEPTS = ['dialed', 'dialedConnected', 'talkTimeDialed', 'incoming', 'incomingConnected', 'talkTimeIncoming', 'notConnected'];

/* Sheets that may hold an employee directory (Emp Id + Name [+ Manager/Status]). */
var DEFAULT_DIRECTORY_SHEETS = ['Employee Data', 'Employees', 'Employee Master', 'Resigned', 'Sheet12', 'DB-BDMs'];
var TALK_TIME_CONCEPTS = { talkTimeDialed: true, talkTimeIncoming: true };

/* Helper - Raw metric labels (column B of that sheet) → concept */
var HELPER_METRIC_MAP = {
  'dialed': 'dialed',
  'dialed connected': 'dialedConnected',
  'total talk time dialed': 'talkTimeDialed',
  'talk time dialed': 'talkTimeDialed',
  'incoming': 'incoming',
  'incoming connected': 'incomingConnected',
  'total talk time incoming': 'talkTimeIncoming',
  'talk time incoming': 'talkTimeIncoming'
};

/* Raw call log (call-level) header aliases */
var RAW_LOG_ALIASES = {
  empId:    ['emp. code', 'emp code', 'employee code', 'emp id'],
  name:     ['employee name', 'name', 'agent'],
  tags:     ['emp. tags', 'emp tags', 'tags', 'bdm'],
  type:     ['call type', 'type', 'direction'],
  duration: ['duration', 'talk time', 'call duration'],
  date:     ['call date', 'date'],
  time:     ['call time', 'time'],
  uniqueId: ['uniqueid', 'unique id', 'call id', 'callid', 'id'],
  toNumber: ['to number', 'number', 'customer number', 'phone', 'phone number', 'mobile']
};

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */
function normKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-\.:/()]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function normHeader_(s) {
  return normKey_(s).replace(/ /g, '');
}
function isBlank_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}
function isErrorValue_(v) {
  var s = String(v == null ? '' : v).trim();
  return s.charAt(0) === '#' && /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!?)/i.test(s);
}
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Excel/Sheets serial (days since 1899-12-30) → 'YYYY-MM-DD' (calendar arithmetic, no timezone). */
function serialToIso_(serial) {
  var days = Math.floor(Number(serial));
  var ms = Date.UTC(1899, 11, 30) + days * 86400000;
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

var MONTHS_ = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

function monthIndex_(name) {
  var k = String(name || '').toLowerCase();
  if (MONTHS_[k.slice(0, 4)] != null) return MONTHS_[k.slice(0, 4)];
  if (MONTHS_[k.slice(0, 3)] != null) return MONTHS_[k.slice(0, 3)];
  return null;
}

/**
 * Parse any Google-Sheets-style date into 'YYYY-MM-DD'. Handles Date objects
 * (formatted in Asia/Kolkata), serial numbers, ISO strings, '1-Feb-26',
 * '04 Sep 2026', 'Feb 1, 2026', '01/02/2026' (D/M/Y). Returns '' when unparseable.
 */
function parseDateCell_(v, tz) {
  if (v === null || v === undefined || v === '') return '';
  if (isDate_(v)) {
    if (isNaN(v.getTime())) return '';
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      return Utilities.formatDate(v, tz || 'Asia/Kolkata', 'yyyy-MM-dd');
    }
    var ist = new Date(v.getTime() + 5.5 * 3600000);
    return ist.getUTCFullYear() + '-' + pad2_(ist.getUTCMonth() + 1) + '-' + pad2_(ist.getUTCDate());
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return serialToIso_(v);
    return '';
  }
  var s = String(v).trim();
  if (!s || isErrorValue_(s)) return '';
  var m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]);
  if (/^\d+(\.\d+)?$/.test(s)) { var n = Number(s); return n > 20000 && n < 80000 ? serialToIso_(n) : ''; }
  if ((m = /^(\d{1,2})[\s\-\/]+([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})$/.exec(s))) {
    var mo = monthIndex_(m[2]);
    if (mo == null) return '';
    var y = +m[3]; if (y < 100) y += 2000;
    return y + '-' + pad2_(mo + 1) + '-' + pad2_(+m[1]);
  }
  if ((m = /^([A-Za-z]{3,9})[\s\-\/]+(\d{1,2})(?:st|nd|rd|th)?[\s,\-\/]+(\d{2,4})$/.exec(s))) {
    var mo2 = monthIndex_(m[1]);
    if (mo2 == null) return '';
    var y2 = +m[3]; if (y2 < 100) y2 += 2000;
    return y2 + '-' + pad2_(mo2 + 1) + '-' + pad2_(+m[2]);
  }
  if ((m = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:\s.*)?$/.exec(s))) {
    var a = +m[1], b = +m[2], y3 = +m[3]; if (y3 < 100) y3 += 2000;
    var day = a, mon = b;
    if (a <= 12 && b > 12) { day = b; mon = a; }
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
    return y3 + '-' + pad2_(mon) + '-' + pad2_(day);
  }
  var t = Date.parse(s);
  if (!isNaN(t)) { var d2 = new Date(t); return d2.getFullYear() + '-' + pad2_(d2.getMonth() + 1) + '-' + pad2_(d2.getDate()); }
  return '';
}

/** Number stored as text, with commas, blanks, errors → number (0 when not numeric). */
function toNumber_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  var s = String(v).replace(/,/g, '').trim();
  if (!s || isErrorValue_(s)) return 0;
  var n = Number(s);
  return isFinite(n) ? n : 0;
}

/**
 * Talk time in any format → seconds.
 *  - Date object (Sheets duration cell)
 *  - 'HH:MM:SS' / 'MM:SS'
 *  - '1h 2m 3s' / '2m 5s' / '45s' / '1.5h' / '12m'
 *  - plain number interpreted by `unit`: 'hours' | 'minutes' | 'seconds' | 'dayfraction' | 'auto'
 *    ('auto': < 24 → hours, 24..1440 → minutes, otherwise seconds).
 */
function toSeconds_(v, unit) {
  if (v === null || v === undefined || v === '') return 0;
  if (isDate_(v)) {
    if (isNaN(v.getTime())) return 0;
    var secs = v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
    var ms = v.getTime() - Date.UTC(1899, 11, 30);
    if (ms > 86400000 * 2) secs += Math.floor(ms / 86400000) * 86400;
    return secs;
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) return 0;
    if (unit === 'hours') return Math.round(v * 3600);
    if (unit === 'minutes') return Math.round(v * 60);
    if (unit === 'seconds') return Math.round(v);
    if (unit === 'dayfraction') return Math.round(v * 86400);
    if (v < 24) return Math.round(v * 3600);
    if (v < 1440) return Math.round(v * 60);
    return Math.round(v);
  }
  var s = String(v).trim().toLowerCase();
  if (!s || isErrorValue_(s)) return 0;
  var m;
  if ((m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(s))) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return (+m[1]) * 60 + (+m[2]);
  if (/[hms]/.test(s) && /\d/.test(s)) {
    var total = 0, found = false;
    var re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g, mm;
    while ((mm = re.exec(s))) {
      found = true;
      var n = parseFloat(mm[1]), u = mm[2].charAt(0);
      total += u === 'h' ? n * 3600 : u === 'm' ? n * 60 : n;
    }
    if (found) return Math.round(total);
  }
  var num = Number(s.replace(/,/g, ''));
  if (isFinite(num)) return toSeconds_(num, unit);
  return 0;
}

function mapHeaders_(headers, aliasTable) {
  var map = {};
  var used = {};
  var normed = (headers || []).map(normHeader_);
  var keys = Object.keys(aliasTable);
  for (var k = 0; k < keys.length; k++) {
    var aliases = aliasTable[keys[k]];
    for (var i = 0; i < aliases.length; i++) {
      var idx = normed.indexOf(normHeader_(aliases[i]));
      if (idx >= 0 && !used[idx]) { map[keys[k]] = idx; used[idx] = true; break; }
    }
  }
  return map;
}

function titleCase_(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').split(' ').map(function (w) {
    if (!w) return w;
    if (/^[A-Z]{1,3}$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function normEmpId_(s) {
  return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
}

/* ------------------------------------------------------------------ */
/* Source detection                                                    */
/* ------------------------------------------------------------------ */

/** Locate a header row (first 15 rows) of a flat table with a date column, an employee column and a metric. */
function detectFlatHeader_(values) {
  var limit = Math.min(values.length, 15);
  for (var r = 0; r < limit; r++) {
    var row = values[r];
    var map = mapHeaders_(row, CONCEPT_ALIASES);
    var hasEmp = map.employeeId != null || map.employeeName != null;
    var hasMetric = METRIC_CONCEPTS.some(function (c) { return map[c] != null; });
    if (map.date != null && hasEmp && hasMetric) return { rowIndex: r, map: map, headers: row };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function newRecordStore_() {
  return { byKey: {}, order: [] };
}
function upsertRecord_(store, date, empId, patch) {
  var key = date + '|' + empId;
  var rec = store.byKey[key];
  if (!rec) {
    rec = { date: date, empId: empId, dialed: 0, dialedConnected: 0, talkTimeDialed: 0, incoming: 0, incomingConnected: 0, talkTimeIncoming: 0, notConnected: null, extra: {} };
    store.byKey[key] = rec; store.order.push(key);
  }
  for (var k in patch) if (patch.hasOwnProperty(k)) {
    if (k === 'extra') { for (var e in patch.extra) rec.extra[e] = patch.extra[e]; }
    else if (k === 'notConnected') { rec.notConnected = (rec.notConnected || 0) + patch[k]; }
    else if (k === 'uniqueNumbers') { if (!rec.uniqueNumbers) rec.uniqueNumbers = {}; for (var n in patch.uniqueNumbers) { var prev = rec.uniqueNumbers[n] || 0; rec.uniqueNumbers[n] = patch.uniqueNumbers[n] > prev ? patch.uniqueNumbers[n] : prev; } }
    else if (BAND_KEYS.indexOf(k) >= 0) { if (rec.band02 == null) { rec.band02 = 0; rec.band24 = 0; rec.band4p = 0; rec.ttBand02 = 0; rec.ttBand24 = 0; rec.ttBand4p = 0; } rec[k] += patch[k]; }
    else if (typeof patch[k] === 'number') rec[k] += patch[k];
    else rec[k] = patch[k];
  }
  return rec;
}

/* Call-duration bands (connected calls only): 0–2 min, 2–4 min, over 4 min. */
var BAND_KEYS = ['band02', 'band24', 'band4p', 'ttBand02', 'ttBand24', 'ttBand4p'];
/* Fields that exist only for call-log days (null on helper-only days). */
var UQ_BAND_KEYS = ['uqBand02', 'uqBand24', 'uqBand4p'];
var CALL_LOG_ONLY_KEYS = BAND_KEYS.concat(['uniqueConnected']).concat(UQ_BAND_KEYS);
var TT_BAND_OF = { band02: 'ttBand02', band24: 'ttBand24', band4p: 'ttBand4p' };
function bandKey_(secs) {
  if (secs <= 0) return null;
  if (secs <= 120) return 'band02';
  if (secs <= 240) return 'band24';
  return 'band4p';
}

/** Mode A: flat table on the DB sheet (Date, Emp, Dialed, …). */
function buildFromFlat_(values, det, tz, notes) {
  var store = newRecordStore_();
  var map = det.map, headers = det.headers;
  var names = {};
  var dimCols = [];
  ['manager', 'team', 'status'].forEach(function (c) { if (map[c] != null) dimCols.push({ key: c, label: String(headers[map[c]]).trim(), idx: map[c] }); });
  var seen = {};
  for (var r = det.rowIndex + 1; r < values.length; r++) {
    var row = values[r];
    if (!row || row.every(isBlank_)) continue;
    var date = parseDateCell_(row[map.date], tz);
    if (!date) continue;
    var id = map.employeeId != null ? normEmpId_(row[map.employeeId]) : '';
    var nm = map.employeeName != null ? String(row[map.employeeName] || '').trim() : '';
    if (isErrorValue_(id)) id = '';
    if (isErrorValue_(nm)) nm = '';
    if (!id && !nm) continue;
    if (!id) id = 'NAME:' + normKey_(nm);
    if (nm && !names[id]) names[id] = titleCase_(nm);
    var sig = row.join('');
    if (seen[sig]) continue;
    seen[sig] = 1;
    var patch = { extra: {} };
    METRIC_CONCEPTS.forEach(function (c) {
      if (map[c] == null) return;
      var v = row[map[c]];
      patch[c] = TALK_TIME_CONCEPTS[c] ? toSeconds_(v, 'auto') : toNumber_(v);
    });
    dimCols.forEach(function (d) { var v = row[d.idx]; if (!isBlank_(v) && !isErrorValue_(v)) patch.extra[d.key] = String(v).trim(); });
    upsertRecord_(store, date, id, patch);
  }
  return {
    store: store,
    names: names,
    dimCols: dimCols.map(function (d) { return { key: d.key, label: d.label }; }),
    available: METRIC_CONCEPTS.filter(function (c) { return map[c] != null; })
  };
}

/** Mode B: Helper - Raw pivot (rows = date × metric, columns = employee ids; talk time in decimal hours). */
function buildFromHelper_(values, tz, notes) {
  var store = newRecordStore_();
  var header = values[0] || [];
  var ids = [];
  for (var c = 2; c < header.length; c++) ids.push(normEmpId_(header[c]));
  var managerRow = null;
  for (var r = 1; r < Math.min(values.length, 4); r++) {
    if (normKey_(values[r][0]) === 'manager') managerRow = values[r];
  }
  var managers = {};
  if (managerRow) for (var c2 = 2; c2 < header.length; c2++) {
    var mv = managerRow[c2];
    if (ids[c2 - 2] && !isBlank_(mv) && !isErrorValue_(mv)) managers[ids[c2 - 2]] = String(mv).trim();
  }
  var available = {};
  var started = false;
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var metric = HELPER_METRIC_MAP[normKey_(row[1])];
    if (!metric) continue;
    var date = parseDateCell_(row[0], tz);
    if (!date) continue;
    started = true;
    available[metric] = true;
    var isTT = !!TALK_TIME_CONCEPTS[metric];
    for (var c3 = 2; c3 < row.length; c3++) {
      var id = ids[c3 - 2];
      if (!id) continue;
      var v = row[c3];
      if (isBlank_(v) || isErrorValue_(v)) continue;
      var num;
      if (isTT) num = (typeof v === 'number') ? Math.round(v * 3600) : toSeconds_(v, 'hours');
      else num = toNumber_(v);
      if (num === 0) continue;
      var patch = {}; patch[metric] = num;
      upsertRecord_(store, date, id, patch);
    }
  }
  if (!started) notes.push('Helper - Raw sheet did not contain recognisable date/metric rows.');
  return { store: store, managers: managers, available: Object.keys(available), ids: ids };
}

/** Mode C: call-level log → daily aggregates (Outgoing = dialed; Incoming; connected when duration > 0). */
function buildFromCallLog_(values, tz, notes) {
  var store = newRecordStore_();
  var names = {}, tags = {};
  var headerIdx = -1, map = null;
  for (var r = 0; r < Math.min(values.length, 10); r++) {
    var m = mapHeaders_(values[r], RAW_LOG_ALIASES);
    if (m.type != null && m.date != null && (m.empId != null || m.name != null)) { headerIdx = r; map = m; break; }
  }
  if (map == null) { notes.push('Raw data sheet: no header row with Call Type / Call Date found.'); return { store: store, names: names, tags: tags, dates: {}, available: [] }; }
  var dates = {};
  var seen = {};
  for (var i = headerIdx + 1; i < values.length; i++) {
    var row = values[i];
    var type = normKey_(row[map.type]);
    if (!type) continue;
    var date = parseDateCell_(row[map.date], tz);
    if (!date) continue;
    var id = map.empId != null ? normEmpId_(row[map.empId]) : '';
    var nm = map.name != null ? String(row[map.name] || '').trim() : '';
    if (!id && !nm) continue;
    if (!id) id = 'NAME:' + normKey_(nm);
    if (nm && !names[id]) names[id] = titleCase_(nm);
    if (map.tags != null) { var tg = String(row[map.tags] || '').trim(); if (tg && !tags[id]) tags[id] = tg; }
    var sig = row.join('');
    if (seen[sig]) continue;
    seen[sig] = 1;
    dates[date] = true;
    var secs = map.duration != null ? toSeconds_(row[map.duration], 'seconds') : 0;
    var patch = { band02: 0, band24: 0, band4p: 0, ttBand02: 0, ttBand24: 0, ttBand4p: 0 };
    if (type.indexOf('out') === 0 || type === 'dialed' || type === 'dialled') {
      patch.dialed = 1;
      if (secs > 0) { patch.dialedConnected = 1; patch.talkTimeDialed = secs; }
    } else if (type.indexOf('in') === 0) {
      patch.incoming = 1;
      if (secs > 0) { patch.incomingConnected = 1; patch.talkTimeIncoming = secs; }
    } else if (type === 'missed' || type === 'rejected' || type === 'not connected') {
      patch.incoming = 1;
    } else continue;
    var band = bandKey_(secs);
    if (band) { patch[band] = 1; patch[TT_BAND_OF[band]] = secs; }
    // Unique connected: distinct customer numbers with at least one connected call that day.
    // Only a count is kept; the numbers never leave this function.
    if (secs > 0 && map.toNumber != null) {
      var num = String(row[map.toNumber] == null ? '' : row[map.toNumber]).replace(/\D/g, '');
      if (num) { patch.uniqueNumbers = {}; patch.uniqueNumbers[num] = secs; }
    }
    upsertRecord_(store, date, id, patch);
  }
  // Collapse the per-day number sets into counts.
  store.order.forEach(function (k) {
    var rec = store.byKey[k];
    rec.uniqueConnected = 0; rec.uqBand02 = 0; rec.uqBand24 = 0; rec.uqBand4p = 0;
    if (rec.uniqueNumbers) {
      for (var un in rec.uniqueNumbers) {
        rec.uniqueConnected++;
        // a number is placed in the band of its longest connected call that day
        var ub = bandKey_(rec.uniqueNumbers[un]);
        if (ub === 'band02') rec.uqBand02++; else if (ub === 'band24') rec.uqBand24++; else if (ub === 'band4p') rec.uqBand4p++;
      }
    }
    delete rec.uniqueNumbers;
  });
  var avail = ['dialed', 'dialedConnected', 'talkTimeDialed', 'incoming', 'incomingConnected', 'talkTimeIncoming'].concat(BAND_KEYS);
  if (map.toNumber != null) { avail.push('uniqueConnected'); avail = avail.concat(UQ_BAND_KEYS); }
  return { store: store, names: names, tags: tags, dates: dates, available: avail };
}

/** Optional employee master: any other sheet with an Emp Id + Name header row. */
function buildEmployeeDirectory_(sheetsByName) {
  var dir = {};
  var order = DEFAULT_DIRECTORY_SHEETS;
  var names = Object.keys(sheetsByName);
  names.sort(function (a, b) { var ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  names.forEach(function (sn) {
    var values = sheetsByName[sn];
    if (!values || !values.length) return;
    for (var r = 0; r < Math.min(values.length, 10); r++) {
      var map = mapHeaders_(values[r], CONCEPT_ALIASES);
      if (map.employeeId == null || map.employeeName == null) continue;
      var isMaster = map.manager != null || map.status != null || map.team != null || /resign|employee|master/i.test(sn);
      for (var i = r + 1; i < values.length; i++) {
        var row = values[i];
        var id = normEmpId_(row[map.employeeId]);
        var nm = String(row[map.employeeName] || '').trim();
        if (!id || !nm || isErrorValue_(nm) || isErrorValue_(id)) continue;
        var e = dir[id] || (dir[id] = {});
        if (!e.name) e.name = titleCase_(nm);
        if (isMaster) {
          if (map.manager != null && !e.manager) { var mg = row[map.manager]; if (!isBlank_(mg) && !isErrorValue_(mg)) e.manager = String(mg).trim(); }
          if (map.team != null && !e.team) { var tm = row[map.team]; if (!isBlank_(tm) && !isErrorValue_(tm)) e.team = String(tm).trim(); }
          if (map.status != null && !e.status) { var st = row[map.status]; if (!isBlank_(st) && !isErrorValue_(st)) e.status = String(st).trim(); }
          if (/resign/i.test(sn) && !e.status) e.status = 'Resigned';
        }
      }
      break;
    }
  });
  return dir;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {Object} sheets  { DB: values[][], 'Helper - Raw': values[][], 'Raw data': values[][], ...others }
 * @param {Object} opts    { tz, dbSheetName, helperSheetName, rawSheetName }
 */
function buildPayload(sheets, opts) {
  opts = opts || {};
  var tz = opts.tz || 'Asia/Kolkata';
  var notes = [];
  var dbName = opts.dbSheetName || 'DB';
  var helperName = opts.helperSheetName || 'Helper - Raw';
  var rawName = opts.rawSheetName || 'Raw data';

  var store = null, sourceMode = '', sourceSheets = [], available = [];
  var names = {}, managers = {}, tags = {}, dimCols = [];
  // Dates for which the sheet is the complete record (flat DB / helper). Days that
  // only exist in the rotating call log are NOT authoritative: the database keeps
  // them after the log is overwritten with the next day's calls.
  var authoritativeDates = {};
  var callLogDates = {};

  var dbValues = sheets[dbName];
  var det = dbValues ? detectFlatHeader_(dbValues) : null;
  if (det) {
    var fa = buildFromFlat_(dbValues, det, tz, notes);
    store = fa.store; names = fa.names; dimCols = fa.dimCols; available = fa.available;
    sourceMode = 'db-flat'; sourceSheets.push(dbName);
    store.order.forEach(function (k) { authoritativeDates[k.split('|')[0]] = true; });
  } else {
    if (dbValues) notes.push('"' + dbName + '" is a parameterised report (no Date/Employee header row); daily data is read from "' + helperName + '" and "' + rawName + '".');
    var helper = sheets[helperName];
    if (helper && helper.length) {
      var fb = buildFromHelper_(helper, tz, notes);
      store = fb.store; managers = fb.managers; available = fb.available;
      sourceMode = 'helper-raw'; sourceSheets.push(helperName);
    }
    var raw = sheets[rawName];
    if (raw && raw.length) {
      var fc = buildFromCallLog_(raw, tz, notes);
      names = fc.names; tags = fc.tags;
      if (!store) {
        store = fc.store; sourceMode = 'raw-log'; available = fc.available; sourceSheets.push(rawName);
        store.order.forEach(function (k) { callLogDates[k.split('|')[0]] = true; });
      }
      else {
        var helperDates = {};
        store.order.forEach(function (k) { helperDates[k.split('|')[0]] = true; authoritativeDates[k.split('|')[0]] = true; });
        var merged = 0, enriched = 0, enrichedDates = {};
        fc.store.order.forEach(function (k) {
          var rec = fc.store.byKey[k];
          if (helperDates[rec.date]) {
            // Same day in both sources: the helper's totals stay authoritative, the call log
            // supplies the detail only it has (duration bands, talk time per band, unique numbers).
            var cur = store.byKey[k];
            if (!cur) return;
            CALL_LOG_ONLY_KEYS.forEach(function (f) { if (fc.available.indexOf(f) >= 0) cur[f] = rec[f] == null ? 0 : rec[f]; });
            enriched++; enrichedDates[rec.date] = true; callLogDates[rec.date] = true;
            return;
          }
          store.byKey[k] = rec; store.order.push(k); merged++; callLogDates[rec.date] = true;
        });
        if (merged || enriched) {
          sourceMode = 'helper-raw+raw-log'; sourceSheets.push(rawName);
          // call-log-only fields (duration bands) become available for the covered days
          fc.available.forEach(function (a) { if (available.indexOf(a) < 0) available.push(a); });
          if (merged) notes.push(merged + ' employee-days were aggregated from the call log for dates not yet present in ' + helperName + '.');
          if (enriched) notes.push('Call detail (duration bands, unique numbers) for ' + Object.keys(enrichedDates).sort().join(', ') + ' was taken from the call log; totals come from ' + helperName + '.');
        }
      }
    }
  }
  if (!store) {
    return { meta: { sourceMode: 'none', sourceSheets: [], generatedAt: new Date().toISOString(), timezone: tz, rowCount: 0, employeeCount: 0, dateRange: null, notes: notes.concat(['No readable data source found.']) }, fields: [], dims: [], employees: [], rows: [] };
  }

  var others = {};
  var dirNames = opts.directorySheets || DEFAULT_DIRECTORY_SHEETS;
  for (var sn in sheets) if (sheets.hasOwnProperty(sn) && dirNames.indexOf(sn) >= 0 && sn !== dbName && sn !== helperName && sn !== rawName) others[sn] = sheets[sn];
  var dir = buildEmployeeDirectory_(others);

  var empIds = {};
  store.order.forEach(function (k) { empIds[store.byKey[k].empId] = true; });
  var employees = [];
  var hasManager = false, hasTags = false, hasStatus = false, hasTeam = false;
  Object.keys(empIds).forEach(function (id) {
    var d = dir[id] || {};
    var name = d.name || names[id] || (id.indexOf('NAME:') === 0 ? titleCase_(id.slice(5)) : id);
    var mgr = d.manager || managers[id] || '';
    var tg = tags[id] ? tags[id].split(/;|,|\|/).map(function (t) { return t.trim(); }).filter(Boolean) : [];
    if (mgr) hasManager = true;
    if (tg.length) hasTags = true;
    if (d.status) hasStatus = true;
    if (d.team) hasTeam = true;
    employees.push({ id: id, name: name, manager: mgr, tags: tg, team: d.team || '', status: d.status || '' });
  });
  employees.sort(function (a, b) { return a.name.localeCompare(b.name); });

  var dims = [];
  if (hasManager) dims.push({ key: 'manager', label: 'Manager' });
  if (hasTeam) dims.push({ key: 'team', label: 'Team' });
  if (hasTags) dims.push({ key: 'tags', label: 'BDM / Tag', multi: true });
  if (hasStatus) dims.push({ key: 'status', label: 'Status' });
  dimCols.forEach(function (d) { if (!dims.some(function (x) { return x.key === d.key; })) dims.push({ key: d.key, label: d.label, perRow: true }); });

  var metricFields = [
    { key: 'dialed', label: 'Dialed', concept: 'dialed', kind: 'count' },
    { key: 'dialedConnected', label: 'Dialed - Connected', concept: 'dialedConnected', kind: 'count' },
    { key: 'talkTimeDialed', label: 'Talk Time Dialed', concept: 'talkTimeDialed', kind: 'seconds' },
    { key: 'incoming', label: 'Incoming', concept: 'incoming', kind: 'count' },
    { key: 'incomingConnected', label: 'Incoming - Connected', concept: 'incomingConnected', kind: 'count' },
    { key: 'talkTimeIncoming', label: 'Talk Time Incoming', concept: 'talkTimeIncoming', kind: 'seconds' },
    { key: 'notConnected', label: 'Not Connected', concept: 'notConnected', kind: 'count' },
    { key: 'band02', label: 'Calls 0-2 min', concept: 'band02', kind: 'count' },
    { key: 'band24', label: 'Calls 2-4 min', concept: 'band24', kind: 'count' },
    { key: 'band4p', label: 'Calls over 4 min', concept: 'band4p', kind: 'count' },
    { key: 'ttBand02', label: 'Talk time 0-2 min calls', concept: 'ttBand02', kind: 'seconds' },
    { key: 'ttBand24', label: 'Talk time 2-4 min calls', concept: 'ttBand24', kind: 'seconds' },
    { key: 'ttBand4p', label: 'Talk time over 4 min calls', concept: 'ttBand4p', kind: 'seconds' },
    { key: 'uniqueConnected', label: 'Unique Connected', concept: 'uniqueConnected', kind: 'count' },
    { key: 'uqBand02', label: 'Unique connected 0-2 min', concept: 'uqBand02', kind: 'count' },
    { key: 'uqBand24', label: 'Unique connected 2-4 min', concept: 'uqBand24', kind: 'count' },
    { key: 'uqBand4p', label: 'Unique connected over 4 min', concept: 'uqBand4p', kind: 'count' }
  ].filter(function (f) { return available.indexOf(f.key) >= 0; });
  var fields = [{ key: 'date', label: 'Date', concept: 'date', kind: 'date' }, { key: 'empId', label: 'Emp Id', concept: 'employeeId', kind: 'text' }].concat(metricFields);
  var perRowDims = dims.filter(function (d) { return d.perRow; });
  perRowDims.forEach(function (d) { fields.push({ key: d.key, label: d.label, concept: d.key, kind: 'text' }); });

  var rows = [];
  var minDate = null, maxDate = null;
  store.order.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  store.order.forEach(function (k) {
    var rec = store.byKey[k];
    var hasAny = metricFields.some(function (f) { return f.key === 'notConnected' ? !!rec.notConnected : rec[f.key] > 0; });
    if (!hasAny) return;
    if (!minDate || rec.date < minDate) minDate = rec.date;
    if (!maxDate || rec.date > maxDate) maxDate = rec.date;
    var out = [rec.date, rec.empId];
    // Band counts are null (unknown) for days that came from the helper, which has no call detail.
    metricFields.forEach(function (f) { out.push(f.key === 'notConnected' ? (rec.notConnected || 0) : CALL_LOG_ONLY_KEYS.indexOf(f.key) >= 0 ? (rec[f.key] == null ? null : rec[f.key]) : rec[f.key]); });
    perRowDims.forEach(function (d) { out.push(rec.extra[d.key] || ''); });
    rows.push(out);
  });

  return {
    meta: {
      sourceMode: sourceMode,
      sourceSheets: sourceSheets,
      generatedAt: new Date().toISOString(),
      timezone: tz,
      rowCount: rows.length,
      employeeCount: employees.length,
      dateRange: minDate ? { from: minDate, to: maxDate } : null,
      authoritativeDates: Object.keys(authoritativeDates).sort(),
      callLogDates: Object.keys(callLogDates).sort(),
      notes: notes
    },
    fields: fields,
    dims: dims,
    employees: employees,
    rows: rows
  };
}


export { buildPayload, buildFromCallLog_ as buildFromCallLog, parseDateCell_ as parseDateCell, toSeconds_ as toSeconds, toNumber_ as toNumber, mapHeaders_ as mapHeaders, RAW_LOG_ALIASES, CONCEPT_ALIASES, DEFAULT_DIRECTORY_SHEETS, BAND_KEYS, CALL_LOG_ONLY_KEYS };
