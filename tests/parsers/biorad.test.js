/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/biorad.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/biorad: Bio-Rad ChromLab/NGC CSV', function (t) {
    var txt = 'Bio-Rad ChromLab Run Report\nRun Name:,IMAC run 1\nColumn:,Profinity 1 mL\n\nVolume (ml),UV (mAU),Conductivity (mS/cm),GP (%B)\n0.0,1.0,10.0,0\n0.5,1.5,10.5,5\n1.0,9.0,11.0,10\n1.5,2.0,11.5,15\n';
    var r = P.parseText(txt, { filename: 'ngc.csv' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'biorad'); t.eq(r.traces.length, 3);
    t.eq(r.traces[0].yUnit, 'mAU'); t.eq(r.traces[0].xUnit, 'mL'); t.eq(r.traces[0].meta.sampleName, 'IMAC run 1');
    t.ok(r.traces.some(function (x) { return x.meta.role === 'gradient' && x.yUnit === '%'; }), '%B trace');
    t.ok(r.traces.some(function (x) { return x.meta.role === 'conductivity'; }), 'conductivity trace');
  });

  PK.test('parsers/biorad: sample file samples/data/biorad.csv', function (t) {
    return F.withSample(t, 'biorad.csv', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'biorad'); t.eq(r.traces.length, 3); var uv = r.traces[0];
      t.eq(uv.yUnit, 'mAU'); t.eq(uv.xUnit, 'mL'); t.eq(uv.meta.sampleName, 'His-tag IMAC run 7 (synthetic)'); t.near(uv.x[F.argmax(uv.y)], 2.5, 0.15);
      t.ok(r.traces.some(function (x) { return x.meta.role === 'gradient' && x.yUnit === '%'; }), '%B trace');
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
