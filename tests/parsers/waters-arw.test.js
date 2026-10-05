/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/waters-arw.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/waters-arw: Waters Empower .arw', function (t) {
    var txt = '"SampleName"\t"Channel"\t"Date Acquired"\n"Std A"\t"2998 Ch1 254nm@1.2nm"\t"3/1/2024 10:00:00 AM"\n0.000000\t0.000100\n0.016667\t0.000200\n0.033333\t0.004000\n0.050000\t0.000300\n';
    var r = P.parseText(txt, { filename: 'stdA.arw' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'waters-arw'); var tr = r.traces[0];
    t.eq(tr.yUnit, 'AU'); t.eq(tr.meta.wavelength, 254); t.eq(tr.y[2], 0.004); t.eq(tr.x.length, 4); t.ok(/^Std A/.test(tr.name), tr.name);
  });

  PK.test('parsers/waters-arw: sample file samples/data/waters-arw.arw', function (t) {
    return F.withSample(t, 'waters-arw.arw', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'waters-arw'); var tr = r.traces[0];
      t.eq(tr.x.length, 451); t.eq(tr.yUnit, 'AU'); t.eq(tr.meta.wavelength, 254); t.eq(tr.meta.sampleName, 'Std B (synthetic)'); t.near(tr.x[F.argmax(tr.y)], 8.8, 0.04);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
