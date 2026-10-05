/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/registry.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/registry: registry lists all required plugins', function (t) {
    var ids = P.list().map(function (p) { return p.id; });
    ['delimited', 'json', 'xlsx', 'jcamp', 'netcdf', 'mzml', 'agilent-ch', 'agilent-text', 'chromeleon', 'shimadzu', 'waters-arw', 'unicorn', 'biorad', 'unsupported', 'chromatopy', 'mocca2'].forEach(function (id) { t.ok(ids.indexOf(id) >= 0, 'plugin ' + id + ' registered'); });
    t.ok(P.list()[0].extensions.length > 0, 'extensions listed');
  });
  PK.test('parsers/registry: sniff dispatch picks the right plugin', function (t) {
    function top(head, fn, bin) { return P.rank(head, fn, bin)[0].id; }
    t.eq(top('##TITLE=x\n##JCAMP-DX=4.24\n', 'a.jdx', false), 'jcamp');
    t.eq(top('<?xml version="1.0"?>\n<mzML xmlns="x">', 'a.mzML', false), 'mzml');
    t.eq(top('{"x":[1,2],"y":[3,4]}', 'a.json', false), 'json');
    t.eq(top('Information:\nChromatogram Data:\nTime (min)\tStep (s)\tValue (mAU)\n', 'x.txt', false), 'chromeleon');
    t.eq(top('[Header]\nApplication Name\tLabSolutions\n[LC Chromatogram(Detector A-Ch1)]\n', 'x.txt', false), 'shimadzu');
    t.eq(top('"SampleName"\t"Channel"\n"A"\t"PDA 254nm"\n0\t1\n', 'x.arw', false), 'waters-arw');
    t.eq(top('UV\t\tCond\t\nml\tmAU\tml\tmS/cm\n0\t1\t0\t2\n', 'x.asc', false), 'unicorn');
    t.eq(top('ChromLab export\nVolume (ml),UV (mAU)\n', 'x.csv', false), 'biorad');
    t.eq(top('Time,Signal\n0,1\n1,2\n2,3\n', 'x.csv', false), 'delimited');
    t.eq(top('CDF\u0001\u0000\u0000\u0000\u0000', 'x.cdf', true), 'netcdf');
    t.eq(top('\u0003130\u0000', 'DAD1A.ch', true), 'agilent-ch');
  });
  PK.test('parsers/registry: isImage routes images and PDFs', function (t) {
    t.ok(P.isImage('chrom.PNG'), 'png'); t.ok(P.isImage({ name: 'scan.pdf' }), 'pdf'); t.ok(P.isImage({ name: 'x', type: 'image/jpeg' }), 'mime');
    t.ok(!P.isImage('run.csv'), 'csv is not an image'); t.ok(!P.isImage(null), 'null');
  });
  PK.test('parsers/registry: garbage → clear error; scrambled numbers → needsMapping', function (t) {
    var r = P.parseText('hello world\nthis is not data\nat all\n', { filename: 'notes.txt' });
    t.ok(!r.ok, 'not ok'); t.ok(!r.needsMapping, 'no mapping offered'); t.ok(/Couldn't find a table of numbers/.test(r.error), r.error);
    var m = P.parseText('5,1\n3,7\n9,2\n1,8\n7,3\n', { filename: 'x.csv' });
    t.ok(!m.ok && m.needsMapping, 'needsMapping'); t.ok(m.table && m.table.rows.length === 5, 'table attached'); t.ok(m.rawText.length > 0, 'rawText');
    t.ok(/time axis/.test(m.error), m.error);
    var e = P.parseText('   ', { filename: 'e.csv' }); t.ok(!e.ok && /empty/.test(e.error), 'empty file');
  });
  PK.test('parsers/registry: buildTraces converts units, sorts, drops NaN, dt mode', function (t) {
    var tb = { header: ['t', 'a', 'b'], rows: [[120, 1, 5], [60, 2, NaN], [0, 3, 7], [NaN, 9, 9]] };
    var tr = P.buildTraces(tb, { xCol: 0, yCols: [1, 2], xUnit: 'sec', yUnit: 'mAU', yScale: 2 });
    t.eq(tr.length, 2); t.eq(tr[0].x.join(','), '0,1,2'); t.eq(tr[0].y.join(','), '6,4,2'); t.eq(tr[1].x.length, 2, 'NaN dropped');
    t.eq(tr[0].yUnit, 'mAU'); t.eq(tr[0].xUnit, 'min');
    var ms = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'ms' }); t.near(ms[0].x[2], 120 / 60000, 1e-15);
    var h = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'h' }); t.eq(h[0].x[1], 3600);
    var dt = P.buildTraces({ rows: [[1], [2], [3]] }, { xCol: -1, yCols: [0], xUnit: 'sec', dt: 30 }); t.eq(dt[0].x.join(','), '0,0.5,1');
    var vol = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'mL' }); t.eq(vol[0].xUnit, 'mL'); t.ok(vol[0].meta.xIsVolume, 'volume flagged');
    var fl = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'mL', flow: 2 }); t.eq(fl[0].xUnit, 'min'); t.eq(fl[0].x[2], 60);
  });
  PK.test('parsers/registry: decodeBytes handles BOM-less UTF-16LE and UTF-8', function (t) {
    var s = 'Time,Value\n0,1\n', u = new Uint8Array(s.length * 2);
    for (var i = 0; i < s.length; i++) u[2 * i] = s.charCodeAt(i);
    var d = P._internal.decodeBytes(u); t.eq(d.encoding, 'utf-16le'); t.eq(d.text, s);
    var e = P._internal.decodeBytes(new Uint8Array([0xEF, 0xBB, 0xBF, 0x41, 0xC2, 0xB5])); t.eq(e.text, 'Aµ');
  });

  PK.test('parsers/registry: plugin order, shared helpers and _internal are exposed', function (t) {
    var ids = P.list().map(function (p) { return p.id; });
    t.eq(ids[0], 'delimited', 'generic reader listed first'); t.ok(ids.indexOf('json') < ids.indexOf('chromatopy'), 'built-ins before interop plugins');
    ['decodeBytes', 'parseNum', 'mkTrace', 'tableToResult', 'autoMap', 'normPeaks', 'parseJSONLoose', 'plugins'].forEach(function (k) { t.ok(typeof P._h[k] === 'function', '_h.' + k); });
    ['decodeAsdf', 'readNetCDF', 'b64decode', 'decodeBytes', 'parseNum', 'kvMeta'].forEach(function (k) { t.ok(typeof P._internal[k] === 'function', '_internal.' + k); });
    t.eq(P._h.convertX(30, 'sec'), 0.5); t.eq(P._h.convertX(3, 'mL', 2), 1.5); t.eq(P._h.convertX(3, 'mL'), 3);
    var pk = P._h.normPeaks([{ apex: 120, start: 150, end: 90, area: NaN }, { apex: 'x' }, { apex: 60 }], 'sec', 'test');
    t.eq(pk.length, 2, 'invalid apex dropped'); t.eq(pk[0].apex, 1, 'sorted, converted'); t.eq(pk[1].start, 1.5); t.eq(pk[1].end, 2.5, 'start/end swapped into order');
    t.ok(!('area' in pk[1]), 'non-finite area dropped'); t.eq(pk[0].source, 'test');
    t.eq(P._h.parseJSONLoose('{"a":NaN,"b":[Infinity,-Infinity],"c":"NaN"}').c, 'NaN', 'NaN inside strings untouched');
    t.eq(P._h.parseJSONLoose('[NaN]')[0], null);
  });

  PK.test('parsers/registry: register() validates, orders and replaces; unregister() removes', function (t) {
    var n = P.list().length;
    t.throws(function () { P.register({ id: 'x' }); }, 'needs sniff/parse');
    try {
      P.register({ id: 'zz-test', order: 5, name: 'ZZ', extensions: ['.ZZ'], sniff: function (h) { return /^ZZTEST/.test(h) ? 1 : 0; }, parse: function () { return { ok: true, traces: [{ name: 'z', x: [0, 1, 2], y: [1, 2, 3] }] }; } });
      t.eq(P.list()[0].id, 'zz-test', 'order respected'); t.eq(P.get('zz-test').extensions[0], 'zz', 'extension normalized'); t.eq(P.list().length, n + 1);
      var r = P.parseText('ZZTEST\n', { filename: 'a.zz' }); t.ok(r.ok && r.plugin === 'zz-test' && r.traces[0].xUnit === 'min', 'custom plugin used and finalized');
      P.register({ id: 'zz-test', order: 5, name: 'ZZ2', extensions: [], sniff: function () { return 0; }, parse: function () { return null; } });
      t.eq(P.list().length, n + 1, 'same id replaces'); t.eq(P.get('zz-test').name, 'ZZ2');
    } finally { t.ok(P.unregister('zz-test'), 'unregister'); }
    t.eq(P.list().length, n, 'registry restored'); t.ok(!P.unregister('zz-test'), 'unregister unknown id → false');
  });

  PK.test('parsers/registry: JSON text never falls back to the table reader', function (t) {
    var r = P.parseText('{\n "foo": [\n  1,\n  2,\n  3,\n  4\n ]\n}', { filename: 'x.json' });
    t.ok(!r.ok && !r.needsMapping, 'no mapper offered for JSON'); t.eq(r.plugin, 'json');
    var s = P.parseText('[Header]\nfoo\tbar\n0\t1\n1\t2\n2\t3\n', { filename: 'y.txt' });
    t.ok(s.ok, 'bracketed INI text still falls back: ' + s.error);
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
