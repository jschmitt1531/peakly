/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/json.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/json: JSON shapes and Peakly project detection', function (t) {
    var a = P.parseText('[{"x":0,"y":1},{"x":1,"y":3}]', { filename: 'a.json' }); t.ok(a.ok && a.traces[0].y[1] === 3, 'array of {x,y}');
    var b = P.parseText('[[0,1],[0.5,2],[1,4]]', { filename: 'b.json' }); t.ok(b.ok && b.traces[0].x.length === 3, '[[x,y]]');
    var c = P.parseText('{"name":"S1","x":[0,30,60],"y":[1,2,3],"xUnit":"s","yUnit":"mAU"}', { filename: 'c.json' });
    t.ok(c.ok, c.error); t.eq(c.traces[0].name, 'S1'); t.near(c.traces[0].x[2], 1, 1e-12); t.eq(c.traces[0].yUnit, 'mAU');
    var d = P.parseText('{"traces":[{"name":"A","x":[0,1],"y":[1,2]},{"name":"B","x":[0,1],"y":[3,4]}]}', { filename: 'd.json' });
    t.ok(d.ok && d.traces.length === 2 && d.traces[1].name === 'B', 'traces list');
    var proj = { version: 1, name: 'P', traces: [{ id: 'tr_1', name: 'T', x: [0, 1], y: [1, 2], xUnit: 'min', yUnit: 'mAU' }], method: {}, settings: {} };
    var e = P.parseText(JSON.stringify(proj), { filename: 'p.json' });
    t.ok(e.ok && e.project && e.project.name === 'P', 'project detected'); t.eq(e.format, 'Peakly project');
    var bad = P.parseText('{"x":[1,2,', { filename: 'bad.json' }); t.ok(!bad.ok && /could not be read/.test(bad.error), bad.error);
  });

  PK.test('parsers/json: peakly.traces export round-trip keeps meta and peaks', function (t) {
    var doc = { schema: { name: 'peakly-traces', version: 2 }, traces: [{ name: 'A', x: [0, 30, 60, 90], y: [0, 5, 1, 0], xUnit: 'sec', yUnit: 'mAU', meta: { wavelength: 280 },
      peaks: [{ id: 'pk_1', start: 15, apex: 30, end: 50, label: 'Lys', manual: true }] }] };
    var r = P.parseText(JSON.stringify(doc), { filename: 'export.json' });
    t.ok(r.ok, r.error); t.eq(r.format, 'Peakly traces'); var tr = r.traces[0];
    t.eq(tr.meta.wavelength, 280); t.near(tr.x[3], 1.5, 1e-12);
    t.eq(tr.peaks.length, 1); t.near(tr.peaks[0].apex, 0.5, 1e-12, 'peak converted to min with the trace'); t.eq(tr.peaks[0].label, 'Lys'); t.eq(tr.peaks[0].source, 'peakly'); t.ok(tr.peaks[0].manual, 'extra fields kept');
  });

  PK.test('parsers/json: peakly peak-table export (snake_case rows) attaches to data rows, or explains itself', function (t) {
    var rows = [{ schema_version: 2, trace_id: 'tr_1', trace_name: 'S1', peak_no: 1, name: 'BSA', rt: 1.0, start: 0.8, end: 1.3, area: 12.5, fit_area_se: 0.4, x_unit: 'min', y_unit: 'mAU' },
      { schema_version: 2, trace_id: 'tr_9', trace_name: 'Other', peak_no: 1, name: '', rt: 2, start: 1.9, end: 2.1, area: 1 }];
    var data = [0, 0.5, 1, 1.5, 2].map(function (x, i) { return { trace_id: 'tr_1', trace_name: 'S1', x: x, y: [0, 2, 9, 2, 0][i], y_processed: null, digitized: false }; });
    var r = P.parseText(JSON.stringify({ schema: { name: 'peakly-peaks', version: 2 }, rows: rows, data: data }), { filename: 'peaks.json' });
    t.ok(r.ok, r.error); t.eq(r.traces.length, 1); t.eq(r.traces[0].yUnit, 'mAU', 'unit from the peak rows');
    var pk = r.traces[0].peaks; t.eq(pk.length, 1); t.eq(pk[0].label, 'BSA'); t.eq(pk[0].area, 12.5); t.eq(pk[0].areaSE, 0.4); t.eq(pk[0].apex, 1);
    t.ok(r.warnings.some(function (w) { return /did not match/.test(w); }), 'unmatched row warned');
    var only = P.parseText(JSON.stringify({ schema: 'peakly.peaks', version: 2, peaks: rows }), { filename: 'p.json' });
    t.ok(!only.ok && /no chromatogram data/.test(only.error) && only.peakTable.length === 2, only.error);
    var long = P.parseText(JSON.stringify(data), { filename: 'data.json' }); t.ok(long.ok && long.format === 'Peakly data' && long.traces[0].y[2] === 9, 'long-format data rows');
  });

  PK.test('parsers/json: hands foreign JSON dialects to their plugin (sniffJSON) and accepts Python NaN', function (t) {
    var big = []; for (var i = 0; i < 1200; i++) big.push(+(i * 0.005).toFixed(3));
    var obj = { time: big, wavelength: [254], data: [big.map(function (x) { return Math.exp(-Math.pow((x - 3) / 0.1, 2)); })], peaks: [], name: 'm', __classname__: 'Chromatogram' };
    var txt = JSON.stringify(obj);
    t.eq(P.rank(txt.slice(0, 4096), 'run.json', false)[0].id, 'json', 'head alone looks like generic JSON');
    var r = P.parseText(txt, { filename: 'run.json' }); t.ok(r.ok, r.error); t.eq(r.plugin, 'mocca2', 'delegated'); t.eq(r.format, 'MOCCA2 JSON');
    var n = P.parseText('{"x":[0,1,2],"y":[1,NaN,3]}', { filename: 'n.json' }); t.ok(n.ok, n.error); t.eq(n.traces[0].x.join(','), '0,2', 'NaN point dropped');
  });

  PK.test('parsers/json: sample file samples/data/json.json (Peakly traces export)', function (t) {
    return F.withSample(t, 'json.json', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'json'); t.eq(r.format, 'Peakly traces'); var tr = r.traces[0];
      t.eq(tr.name, 'Std A 254 nm'); t.eq(tr.x.length, 241); t.eq(tr.meta.run.sampleName, 'Std A');
      t.eq(tr.peaks.length, 2); t.eq(tr.peaks[1].label, 'Toluene'); t.eq(tr.peaks[1].area, 13.1); t.near(tr.x[F.argmax(tr.y)], 5.5, 0.05);
    });
  });

  PK.test('parsers/json: the app traces export (schema {name:"peakly-traces"}) merges peakRows into peaks', function (t) {
    var doc = { schema: { name: 'peakly-traces', version: 2 }, app: 'Peakly', version: '1.1.0', exported: '2026-01-01T00:00:00Z',
      traceRows: [], peakRows: [{ schema_version: 2, trace_id: 'tr_a', trace_name: 'Run', peak_no: 1, peak_id: 'pk_1', name: 'Main', rt: 1.02, start: 0.9, end: 1.2, area: 33.3, fit_area_se: null }],
      traces: [{ id: 'tr_a', name: 'Run', xUnit: 'min', yUnit: 'mAU', source: { kind: 'file' }, digitized: { dxMin: 0.01, dy: 0.2, note: 'x' }, run: { sampleName: 'S9' },
        x: [0, 0.5, 1, 1.5], y: [0, 1, 9, 1], yProcessed: [0, 1, 9, 1], peaks: [{ id: 'pk_1', start: 0.9, apex: 1.0, end: 1.2, clip: 'drop' }] }], calibration: null };
    var r = P.parseText(JSON.stringify(doc), { filename: 'proj_traces.json' });
    t.ok(r.ok, r.error); t.eq(r.format, 'Peakly traces'); var tr = r.traces[0];
    t.eq(tr.meta.run.sampleName, 'S9'); t.eq(tr.meta.digitized.dxMin, 0.01, 'digitized uncertainty kept as metadata');
    t.eq(tr.peaks.length, 1); t.eq(tr.peaks[0].apex, 1.0, 'app peak wins over the row rt'); t.eq(tr.peaks[0].area, 33.3, 'area from peakRows'); t.eq(tr.peaks[0].label, 'Main'); t.eq(tr.peaks[0].clip, 'drop');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
