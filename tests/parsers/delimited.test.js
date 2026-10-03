/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/delimited.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/delimited: CSV with header units (min, mAU)', function (t) {
    var r = P.parseText('Time (min),Absorbance (mAU)\n0,0.1\n0.1,0.5\n0.2,2.0\n0.3,0.4\n', { filename: 'run1.csv' });
    t.ok(r.ok, r.error); t.eq(r.traces.length, 1); var tr = r.traces[0];
    t.eq(tr.yUnit, 'mAU'); t.eq(tr.xUnit, 'min'); t.eq(tr.name, 'run1'); t.near(tr.x[3], 0.3, 1e-12); t.near(tr.y[2], 2.0, 1e-12);
    t.eq(tr.source.kind, 'file'); t.eq(tr.source.filename, 'run1.csv'); t.eq(r.warnings.length, 0, 'no warnings');
  });
  PK.test('parsers/delimited: semicolon + decimal comma + preamble + seconds', function (t) {
    var txt = 'Sample: Lysozyme\nDetector: UV 280 nm\n\nTime [s];Signal [mAU]\n0,0;1,25\n0,5;2,50\n1,0;3,75\n1,5;5,00\n';
    var tb = P.parseDelimited(txt);
    t.eq(tb.delimiter, ';'); t.ok(tb.decimalComma, 'decimal comma detected'); t.eq(tb.preamble.length, 2, 'preamble kept');
    t.eq(tb.header[0], 'Time [s]'); t.eq(tb.rows.length, 4); t.near(tb.rows[3][1], 5, 1e-12);
    var r = P.parseText(txt, { filename: 'lyz.csv' });
    t.ok(r.ok, r.error); var tr = r.traces[0];
    t.near(tr.x[1], 0.5 / 60, 1e-12, 'seconds → minutes'); t.near(tr.y[0], 1.25, 1e-12); t.eq(tr.yUnit, 'mAU');
    t.eq(tr.meta.sampleName, 'Lysozyme'); t.eq(tr.meta.header.Detector, 'UV 280 nm'); t.eq(tr.name, 'Lysozyme');
  });
  PK.test('parsers/delimited: pasted Excel block (tab, no header)', function (t) {
    var r = P.parseText('0\t1.2\n0.01\t1.3\n0.02\t1.9\n0.03\t1.4\n');
    t.ok(r.ok, r.error); t.eq(r.traces[0].source.kind, 'paste'); t.eq(r.traces[0].x.length, 4);
    t.ok(r.warnings.some(function (w) { return /assumed/.test(w); }), 'assumption warned');
    var c = P.parseText('# Sample: X\n# Detector: RI\n0.0 1\n0.1 2\n0.2 3\n', { filename: 'c.txt' });
    t.ok(c.ok && c.table.header === null, 'comment lines are not taken as header'); t.eq(c.traces[0].meta.header.Detector, 'RI');
  });
  PK.test('parsers/delimited: whitespace columns with spaced header, thousands separators', function (t) {
    var r = P.parseText('Time (min)   Signal (mV)\n0.0   1.0\n0.5   2.0\n1.0   1.5\n', { filename: 'a.txt' });
    t.ok(r.ok, r.error); t.eq(r.traces[0].yUnit, 'mV'); t.near(r.traces[0].x[2], 1, 1e-12);
    var tb = P.parseDelimited('t\tA\n0\t1,234.5\n1\t2,000.25\n2\t3.5\n');
    t.near(tb.rows[0][1], 1234.5, 1e-9, 'thousands comma'); t.near(tb.rows[1][1], 2000.25, 1e-9);
  });
  PK.test('parsers/delimited: multi-column FPLC table → roles and units', function (t) {
    var r = P.parseText('Time (min),UV 280 (mAU),Cond (mS/cm),%B\n0,1,10,0\n1,5,12,10\n2,3,14,20\n3,2,16,30\n', { filename: 'fplc.csv' });
    t.ok(r.ok, r.error); t.eq(r.traces.length, 3);
    var cond = r.traces.filter(function (x) { return x.meta.role === 'conductivity'; })[0], grad = r.traces.filter(function (x) { return x.meta.role === 'gradient'; })[0];
    t.ok(cond && cond.yUnit === 'mS/cm', 'conductivity trace'); t.ok(grad && grad.yUnit === '%', 'gradient trace');
    t.eq(r.traces[0].meta.wavelength, 280); t.ok(!r.traces[0].meta.role, 'UV has no role');
  });

  PK.test('parsers/delimited: sample file samples/data/delimited.csv', function (t) {
    return F.withSample(t, 'delimited.csv', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'delimited'); t.eq(r.traces.length, 1);
      var tr = r.traces[0]; t.eq(tr.x.length, 501); t.eq(tr.xUnit, 'min'); t.eq(tr.yUnit, 'mAU');
      t.near(tr.x[F.argmax(tr.y)], 4.8, 0.03, 'tallest peak at 4.8 min');
      t.eq(tr.meta.sampleName, 'Xanthine std mix 50 ug/mL'); t.eq(tr.meta.wavelength, 273); t.eq(tr.source.filename, 'delimited.csv');
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
