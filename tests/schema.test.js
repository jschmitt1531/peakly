/* SPDX-License-Identifier: MIT */
/* Tests for src/schema.js: v1 → v2 migration, validation, export row shapes. */
(function (PK) {
  'use strict';
  function v1Project() {
    var x = [], y = [];
    for (var i = 0; i < 400; i++) { x.push(i * 0.01); y.push(80 * Math.exp(-Math.pow((i * 0.01 - 2) / 0.08, 2) / 2)); }
    return { version: 1, format: 'peakly-project', name: 'Old', settings: { normalization: 'none' }, method: { name: 'M' },
      traces: [{ id: 'tr_a', name: 'A', x: x, y: y, xUnit: 'min', yUnit: 'mAU', peaks: [{ id: 'p1', start: 1.7, apex: 2, end: 2.3, label: 'Caffeine' }], meta: { run: { sampleName: 'S1' } } },
        { id: 'tr_b', name: 'Conc B', x: [0, 1], y: [0, 1], meta: { role: 'gradient' }, peaks: [] }] };
  }
  PK.test('schema: migrate v1 → v2 keeps peaks (clip = valley) and adds calibration', function (t) {
    var S = PK.schema, src = v1Project(), r = S.migrate(src, { report: true }), p = r.project;
    t.eq(S.PROJECT_VERSION, 2, 'current version');
    t.eq(r.from, 1, 'from v1'); t.eq(r.to, 2, 'to v2');
    t.eq(p.version, 2, 'version bumped'); t.eq(p.schema.name, 'peakly-project', 'schema tag'); t.eq(p.schema.version, 2, 'schema version');
    t.eq(p.traces[0].peaks[0].clip, 'valley', 'v1 peaks keep valley-to-valley');
    t.eq(p.traces[0].peaks[0].label, 'Caffeine', 'label kept');
    t.eq(p.settings.clipDefault, 'drop', 'new default clip'); t.eq(p.settings.askClip, true, 'ask on');
    t.ok(p.calibration && Array.isArray(p.calibration.analytes) && p.calibration.analytes.length === 0, 'empty calibration');
    t.ok(r.changes.length >= 2, 'changes reported');
    t.eq(src.version, 1, 'input not mutated'); t.ok(!src.traces[0].peaks[0].clip, 'input peaks not mutated');
    var again = S.migrate(p); t.eq(JSON.stringify(again), JSON.stringify(p), 'idempotent on v2');
    var noVer = S.migrate({ traces: [] }); t.eq(noVer.version, 2, 'missing version treated as v1');
    var fut = S.migrate({ version: 9, traces: [] }); t.eq(fut.version, 9, 'future versions untouched');
    t.throws(function () { S.migrate(null); }, 'null rejected');
  });

  PK.test('schema: validateProject reports errors and warnings', function (t) {
    var V = PK.schema.validateProject;
    t.eq(V(null).ok, false, 'null invalid');
    t.eq(V([]).ok, false, 'array invalid');
    var ok = V(PK.schema.migrate(v1Project()));
    t.ok(ok.ok, 'migrated project valid: ' + ok.errors.join('; '));
    var w = V(v1Project()); t.ok(w.ok && w.warnings.some(function (s) { return /upgraded/.test(s); }), 'v1 valid with upgrade warning');
    t.ok(!V({ version: 3, traces: [] }).ok, 'newer version rejected');
    t.ok(!V({ traces: {} }).ok, 'traces must be array');
    var e = V({ version: 2, traces: [{ name: 'T', x: [0, 1, 2], y: [1, 2] }] });
    t.ok(!e.ok && /x has 3 values but y has 2/.test(e.errors.join()), 'length mismatch named');
    var e2 = V({ version: 2, traces: [{ name: 'T', x: [0, 2, 1], y: [1, NaN, 2], peaks: [{ start: 0, end: 1, clip: 'magic' }] }] });
    t.ok(/unknown clip "magic"/.test(e2.errors.join()), 'bad clip is an error');
    t.ok(/not ascending/.test(e2.warnings.join()) && /non-numeric/.test(e2.warnings.join()), 'unsorted/NaN are warnings');
    var e3 = V({ version: 2, traces: [], calibration: { analytes: [{ name: 'X', model: 'cubic', weighting: '1/y', levels: [{ conc: 'abc' }] }] } });
    t.eq(e3.errors.length, 3, 'calibration model, weighting and conc errors');
    t.ok(!V({ version: 2, traces: [], settings: { clipDefault: 'chop' } }).ok, 'bad clipDefault');
  });

  PK.test('schema: peakTableRows/traceRows have stable columns', function (t) {
    var S = PK.schema, p = S.migrate(v1Project());
    p.calibration.unit = 'µg/mL';
    p.calibration.analytes.push({ id: 'a1', name: 'Caffeine', peakMatch: { rt: 2, tol: 0.1 }, levels: [{ conc: 10, traceId: 'tr_a' }] });
    var rows = S.peakTableRows(p, { metrics: function () { return [{ rt: 2.0001, height: 80, area: 16.04, areaPct: 100, fwhm: 0.188, k: null }]; },
      integration: function () { return [{ clip: 'valley', baseline: { kind: 'line' }, math: { baselineArea: 0.1, grossArea: 16.14 } }]; },
      extra: function () { return { analyte: 'Caffeine', conc: 10.2, notAColumn: 5 }; } });
    t.eq(rows.length, 1, 'aux trace skipped');
    var keys = S.PEAK_COLUMNS.map(function (c) { return c.key; });
    t.eq(JSON.stringify(Object.keys(rows[0])), JSON.stringify(keys), 'row keys = PEAK_COLUMNS in order');
    ['schema_version', 'trace_id', 'peak_no', 'rt', 'area', 'clip', 'baseline_area', 'conc', 'digitized', 'manual'].forEach(function (k) { t.ok(keys.indexOf(k) >= 0, 'has ' + k); });
    var r = rows[0];
    t.eq(r.schema_version, 2, 'schema version'); t.eq(r.trace_id, 'tr_a', 'trace id'); t.eq(r.name, 'Caffeine', 'label');
    t.near(r.area, 16.04, 1e-12, 'area'); t.eq(r.clip, 'valley', 'clip'); t.eq(r.baseline_kind, 'line', 'baseline kind'); t.near(r.gross_area, 16.14, 1e-12, 'gross');
    t.eq(r.conc, 10.2, 'extra merged'); t.ok(!('notAColumn' in r), 'unknown extras dropped'); t.eq(r.digitized, false, 'boolean digitized');
    var cols = S.peakColumns(p.traces[0], { concUnit: 'µg/mL' });
    t.eq(cols.filter(function (c) { return c.key === 'area'; })[0].unit, 'mAU·min', 'area unit resolved');
    t.eq(cols.filter(function (c) { return c.key === 'conc'; })[0].unit, 'µg/mL', 'conc unit resolved');
    var tr = S.traceRows(p);
    t.eq(tr.length, 2, 'all traces in trace rows');
    t.eq(JSON.stringify(Object.keys(tr[0])), JSON.stringify(S.TRACE_COLUMNS.map(function (c) { return c.key; })), 'trace row keys');
    t.eq(tr[0].n_points, 400, 'n points'); t.eq(tr[1].role, 'gradient', 'role'); t.eq(tr[0].sample_name, 'S1', 'run info');
    t.ok(/Caffeine:10/.test(tr[0].calibration_level), 'calibration level listed');
    var csv = S.toCSV(cols, rows, { comments: ['hello'] }).split('\n');
    t.eq(csv[0], '# hello', 'comment'); t.ok(/^# units: schema_version=-, /.test(csv[1]), 'units line'); t.eq(csv[2], keys.join(','), 'header = keys');
    var d = S.dataRows(p.traces[0], null); t.eq(d.length, 400, 'data rows'); t.eq(JSON.stringify(Object.keys(d[0])), JSON.stringify(S.DATA_COLUMNS.map(function (c) { return c.key; })), 'data keys');
  });

  PK.test('schema: describe() exposes JSON-schema-like objects', function (t) {
    var D = PK.schema.describe();
    ['project', 'peakRow', 'traceRow', 'dataRow', 'calibrationRow'].forEach(function (k) { t.ok(D[k] && D[k].type === 'object' && D[k].properties, k + ' described'); });
    t.eq(D.project.properties.version.const, 2, 'project version const');
    t.ok(D.peakRow.properties.clip.enum.indexOf('skim-exp') >= 0, 'clip enum');
    t.ok(JSON.stringify(D).length > 2000, 'serializable');
    var n = PK.schema.normalizeCalibration({ unit: 'mM', analytes: [{ name: 'X', model: 'bogus', levels: [{ conc: '5', response: '12', include: false }, 'junk'] }] });
    t.eq(n.analytes[0].model, 'linear', 'bad model → linear'); t.eq(n.analytes[0].levels.length, 1, 'junk level dropped');
    t.eq(n.analytes[0].levels[0].conc, 5, 'conc number'); t.eq(n.analytes[0].levels[0].response, 12, 'response number'); t.eq(n.analytes[0].levels[0].include, false, 'include kept');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
