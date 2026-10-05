/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/agilent-text.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/agilent-text: Agilent CSV export in UTF-16LE', function (t) {
    var buf = F.utf16leWithBom('0.000000,1.50\r\n0.003333,1.60\r\n0.006667,2.40\r\n0.010000,1.70\r\n');
    return P.parseArrayBuffer(buf, { filename: 'DAD1A.CSV' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'agilent-text'); var tr = r.traces[0];
      t.eq(tr.yUnit, 'mAU'); t.near(tr.x[3], 0.01, 1e-12); t.eq(tr.y[2], 2.4); t.eq(r.warnings.length, 0, 'no unit warnings for known export');
      t.eq(tr.meta.channel, 'DAD1A');
    });
  });

  PK.test('parsers/agilent-text: sample file samples/data/agilent-text.csv (UTF-16LE)', function (t) {
    return F.withSample(t, 'agilent-text.csv', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'agilent-text'); var tr = r.traces[0];
      t.eq(tr.x.length, 301); t.eq(tr.yUnit, 'mAU'); t.eq(r.warnings.length, 0); t.near(tr.x[F.argmax(tr.y)], 4.8, 0.04);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
