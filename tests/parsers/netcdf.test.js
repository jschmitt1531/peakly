/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/netcdf.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/netcdf: AnDI netCDF values, units and metadata', function (t) {
    var y = []; for (var i = 0; i < 11; i++) y.push(i * i);
    var buf = F.buildNetCDF({ y: y, interval: 0.5, delay: 6, runLength: 5, attrs: { detector_unit: 'mAU', retention_unit: 'seconds', sample_name: 'Std mix', detector_name: 'UV 254nm' } });
    var nc = P._internal.readNetCDF(buf);
    t.eq(nc.version, 1); t.eq(nc.attrs.detector_unit, 'mAU'); t.eq(nc.get('ordered_derivative_values').length, 11);
    return P.parseArrayBuffer(buf, { filename: 'run.cdf' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'netcdf'); var tr = r.traces[0];
      t.near(tr.x[0], 0.1, 1e-9, 'delay 6 s'); t.near(tr.x[10], 11 / 60, 1e-9); t.eq(tr.y[10], 100); t.eq(tr.yUnit, 'mAU');
      t.eq(tr.meta.sampleName, 'Std mix'); t.eq(tr.meta.wavelength, 254); t.eq(tr.name, 'Std mix');
      return P.parseArrayBuffer(buf.slice(0, buf.byteLength - 20), { filename: 'trunc.cdf' });
    }).then(function (r) {
      t.ok(!r.ok && /truncated/.test(r.error), 'truncated file error: ' + r.error);
    });
  });

  PK.test('parsers/netcdf: sample file samples/data/netcdf.cdf', function (t) {
    return F.withSample(t, 'netcdf.cdf', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'netcdf'); var tr = r.traces[0];
      t.eq(tr.x.length, 600); t.near(tr.x[1] - tr.x[0], 0.5 / 60, 1e-9, '0.5 s sampling'); t.eq(tr.yUnit, 'mAU');
      t.eq(tr.meta.sampleName, 'AIA std mix'); t.eq(tr.meta.wavelength, 254); t.near(tr.x[F.argmax(tr.y)], 4.32, 0.03);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
