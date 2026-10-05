/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/mzml.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/mzml: mzML base64 float64 time (s) + float32 intensity', function (t) {
    var doc = F.mzmlDoc([F.mzChrom('TIC', 'MS:1000235', 'total ion current chromatogram', [0, 30, 60, 90, 120], 64, 'sec', [10, 20, 400, 30, 10], 32, null)]);
    var r = P.parseText(doc, { filename: 's.mzML' });
    t.ok(r.ok, r.error); t.eq(r.format, 'mzML'); var tr = r.traces[0];
    t.eq(tr.x.join(','), '0,0.5,1,1.5,2'); t.eq(tr.y[2], 400); t.eq(tr.yUnit, 'counts'); t.eq(tr.name, 's TIC');
  });
  PK.test('parsers/mzml: XML character references in ids are decoded (F-15)', function (t) {
    var doc = F.mzmlDoc([F.mzChrom('UV &quot;DAD1&quot; 254 nm &amp; &lt;ref&gt; &#955;&#x3bb;', 'MS:1000812', 'absorption chromatogram', [0, 1, 2], 64, 'min', [1, 5, 1], 32, null)]);
    var r = P.parseText(doc, { filename: 's.mzML' });
    t.ok(r.ok, r.error); var tr = r.traces[0];
    t.eq(tr.meta.chromatogramId, 'UV "DAD1" 254 nm & <ref> λλ', 'id decoded once');
    t.eq(tr.name, 's UV "DAD1" 254 nm & <ref> λλ', 'trace name decoded (escaped again only when displayed)');
    t.eq(tr.meta.wavelength, 254, 'wavelength still found in the decoded id');
  });
  PK.test('parsers/mzml: mzML zlib-compressed (pako or Node zlib; skipped otherwise)', function (t) {
    var z = F.zlibShim();
    if (!z) { t.ok(true, 'skipped: no zlib available'); return; }
    var doc = F.mzmlDoc([F.mzChrom('BPC', 'MS:1000628', 'basepeak chromatogram', [0, 0.25, 0.5], 64, 'min', [5, 50, 5], 64, z)]);
    var hadPako = typeof globalThis !== 'undefined' && !!globalThis.pako;
    if (!hadPako) {
      var none = P.parseText(doc, { filename: 'z.mzML' });
      t.ok(!none.ok && /pako|decompression/.test(none.error), 'clear error without pako: ' + none.error);
    }
    var restore = z.install();
    try {
      var r = P.parseText(doc, { filename: 'z.mzML' });
      t.ok(r.ok, r.error); t.eq(r.traces[0].x.join(','), '0,0.25,0.5'); t.eq(r.traces[0].y[1], 50);
    } finally { restore(); }
  });

  PK.test('parsers/mzml: sample file samples/data/mzml.mzML', function (t) {
    return F.withSample(t, 'mzml.mzML', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'mzml'); t.eq(r.traces.length, 2); t.ok(/TIC$/.test(r.traces[0].name), 'TIC first');
      var tr = r.traces[0]; t.eq(tr.x.length, 240); t.near(tr.x[239], 10, 1e-9, 'seconds converted'); t.eq(tr.yUnit, 'counts'); t.near(tr.x[F.argmax(tr.y)], 6.4, 0.05);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
