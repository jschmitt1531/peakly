/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/agilent-ch.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/agilent-ch: Agilent .ch type 130 delta encoding', function (t) {
    return P.parseArrayBuffer(F.build130(), { filename: 'DAD1A.ch' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'agilent-ch'); var tr = r.traces[0];
      t.eq(tr.y.join(','), '500,501,502.5,450,449.5', 'delta-decoded and scaled');
      t.near(tr.x[4], 0.4, 1e-12); t.near(tr.x[1], 0.1, 1e-12); t.eq(tr.yUnit, 'mAU');
      t.eq(tr.meta.wavelength, 254); t.eq(tr.meta.sampleName, 'Caffeine std'); t.eq(tr.meta.chVersion, 130);
    });
  });
  PK.test('parsers/agilent-ch: Agilent .ch type 179 doubles and 181 double-delta', function (t) {
    return P.parseArrayBuffer(F.build179(), { filename: 'FID1A.ch' }).then(function (r) {
      t.ok(r.ok, r.error); var tr = r.traces[0];
      t.eq(tr.y.join(','), '3,5,20,6'); t.near(tr.x[0], 2, 1e-9); t.near(tr.x[3], 2.05, 1e-9); t.eq(tr.yUnit, 'pA');
      return P.parseArrayBuffer(F.build181(), { filename: 'FID1A.ch' });
    }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.traces[0].y.join(','), '1000,1003,1008,1010'); t.near(r.traces[0].x[3], 0.05, 1e-9);
    });
  });

  PK.test('parsers/agilent-ch: sample file samples/data/agilent-ch.ch (type 130)', function (t) {
    return F.withSample(t, 'agilent-ch.ch', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'agilent-ch'); var tr = r.traces[0];
      t.eq(tr.x.length, 1200); t.near(tr.x[1199], 10, 1e-9); t.eq(tr.yUnit, 'mAU'); t.eq(tr.meta.chVersion, 130); t.eq(tr.meta.wavelength, 273);
      t.eq(tr.meta.sampleName, 'Xanthine std (synthetic)'); t.near(tr.x[F.argmax(tr.y)], 4.8, 0.02); t.near(Math.max.apply(null, tr.y), 121, 2);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
