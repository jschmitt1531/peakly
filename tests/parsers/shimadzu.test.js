/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/shimadzu.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/shimadzu: Shimadzu LabSolutions ASCII with Multiplier', function (t) {
    var txt = '[Header]\nApplication Name\tLabSolutions\nVersion\t5.97\n[Sample Information]\nSample Name\tDigest\n' +
      '[LC Chromatogram(Detector A-Ch1)]\nInterval(msec)\t500\n# of Points\t4\nStart Time(min)\t0.000\nIntensity Units\tmV\nIntensity Multiplier\t0.001\nWavelength(nm)\t214\n' +
      'R.Time (min)\tIntensity\n0.00000\t1000\n0.00833\t2000\n0.01667\t53000\n0.02500\t1500\n' +
      '[Peak Table(Detector A-Ch1)]\n# of Peaks\t1\nPeak#\tR.Time\tArea\n1\t0.017\t12345\n';
    var r = P.parseText(txt, { filename: 'run.txt' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'shimadzu'); t.eq(r.traces.length, 1, 'peak table ignored');
    var tr = r.traces[0]; t.eq(tr.yUnit, 'mV'); t.near(tr.y[2], 53, 1e-9, 'multiplier applied'); t.eq(tr.meta.wavelength, 214);
    t.eq(tr.meta.sampleName, 'Digest'); t.eq(tr.meta.channel, 'Detector A-Ch1');
  });

  PK.test('parsers/shimadzu: sample file samples/data/shimadzu.txt', function (t) {
    return F.withSample(t, 'shimadzu.txt', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'shimadzu'); t.eq(r.traces.length, 1, 'peak table ignored'); var tr = r.traces[0];
      t.eq(tr.x.length, 481); t.eq(tr.yUnit, 'mV'); t.eq(tr.meta.wavelength, 214); t.eq(tr.meta.multiplier, 0.001);
      t.near(Math.max.apply(null, tr.y), 70.5, 1, 'multiplier applied'); t.near(tr.x[F.argmax(tr.y)], 2.2, 0.02); t.eq(tr.meta.sampleName, 'Tryptic digest (synthetic)');
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
