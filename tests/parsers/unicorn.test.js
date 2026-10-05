/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/unicorn.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/unicorn: Cytiva UNICORN multi-curve (volume x, fractions)', function (t) {
    var txt = 'Chrom.1\t\tChrom.1\t\tChrom.1\t\tChrom.1\t\nUV 1_280\t\tCond\t\tConc B\t\tFractions\t\nml\tmAU\tml\tmS/cm\tml\t%\tml\t\n' +
      '0.00\t1.0\t0.00\t5.0\t0.00\t0\t0.50\tA1\n0.10\t2.0\t0.10\t5.5\t1.00\t50\t1.50\tA2\n0.20\t3.0\t0.20\t6.0\t\t\t2.50\tWaste\n';
    var r = P.parseText(txt, { filename: 'imac.asc' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'unicorn'); t.eq(r.traces.length, 3);
    var uv = r.traces[0]; t.eq(uv.xUnit, 'mL'); t.ok(uv.meta.xIsVolume, 'xIsVolume'); t.eq(uv.yUnit, 'mAU'); t.eq(uv.meta.wavelength, 280);
    var cond = r.traces.filter(function (x) { return x.meta.role === 'conductivity'; })[0]; t.ok(cond && cond.yUnit === 'mS/cm', 'cond');
    var grad = r.traces.filter(function (x) { return x.meta.role === 'gradient'; })[0]; t.ok(grad && grad.y[1] === 50 && grad.x.length === 2, 'conc B');
    t.eq(r.events.length, 3); t.eq(r.events[2].label, 'Waste'); t.ok(r.warnings.some(function (w) { return /flow rate/.test(w); }), 'volume warning');
    var f = P.parseText(txt, { filename: 'imac.asc', flow: 0.5 });
    t.eq(f.traces[0].xUnit, 'min'); t.near(f.traces[0].x[2], 0.4, 1e-12, 'mL / flow');
  });

  PK.test('parsers/unicorn: sample file samples/data/unicorn.asc (volume axis, fractions, flow)', function (t) {
    return F.withSample(t, 'unicorn.asc', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'unicorn'); t.eq(r.traces.length, 3); t.eq(r.events.length, 13); t.eq(r.events[12].label, 'Waste');
      var uv = r.traces[0]; t.eq(uv.xUnit, 'mL'); t.eq(uv.meta.wavelength, 280); t.near(uv.x[F.argmax(uv.y)], 3.0, 0.15);
      t.ok(r.traces.some(function (x) { return x.meta.role === 'conductivity' && x.yUnit === 'mS/cm'; }), 'conductivity');
      return F.withSample(t, 'unicorn.asc', function (f) { t.eq(f.traces[0].xUnit, 'min'); t.near(f.traces[0].x[300], 30 / 0.5, 1e-9, 'mL / flow'); }, { flow: 0.5 });
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
