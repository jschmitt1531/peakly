/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/chromeleon.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/chromeleon: Thermo Chromeleon ASCII (decimal comma)', function (t) {
    var txt = 'Raw Data:\nInformation:\nSample Name\tBSA 1 mg/mL\nInjection Volume\t10,0\n\nChromatogram Data Information:\nTime Min.\t0,000\nData Points\t4\n' +
      'Signal Unit\tmAU\nChannel\tUV_VIS_1\n\nChromatogram Data:\nTime (min)\tStep (s)\tValue (mAU)\n0,000000\tn.a.\t0,100\n0,003333\t0,20\t0,250\n0,006667\t0,20\t5,500\n0,010000\t0,20\t0,300\n';
    var r = P.parseText(txt, { filename: 'bsa.txt' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'chromeleon'); t.eq(r.traces.length, 1, 'Step column skipped');
    var tr = r.traces[0]; t.eq(tr.yUnit, 'mAU'); t.near(tr.y[2], 5.5, 1e-12); t.near(tr.x[3], 0.01, 1e-12);
    t.eq(tr.meta.sampleName, 'BSA 1 mg/mL'); t.eq(tr.name, 'BSA 1 mg/mL UV_VIS_1');
  });

  PK.test('parsers/chromeleon: sample file samples/data/chromeleon.txt', function (t) {
    return F.withSample(t, 'chromeleon.txt', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'chromeleon'); t.eq(r.traces.length, 1, 'Step column skipped'); var tr = r.traces[0];
      t.eq(tr.x.length, 361); t.eq(tr.yUnit, 'mAU'); t.eq(tr.meta.sampleName, 'BSA digest (synthetic)'); t.near(tr.x[F.argmax(tr.y)], 7.25, 0.04);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
