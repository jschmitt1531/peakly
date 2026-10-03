/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/jcamp.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/jcamp: JCAMP ASDF decoder (SQZ/DIF/DUP)', function (t) {
    var d = P._internal.decodeAsdf('0 A00KL%Tk');
    t.eq(d.vals.join(','), '0,100,102,105,105,105,103'); t.ok(d.endsDif, 'ends in DIF');
    t.eq(P._internal.decodeAsdf('5 @T a2').vals.join(','), '5,0,0,-12');
    t.eq(P._internal.decodeAsdf('1.5E+02 -3').vals.join(','), '150,-3');
  });
  PK.test('parsers/jcamp: JCAMP compressed XYDATA with Y-check across lines', function (t) {
    var txt = '##TITLE=Test chrom\n##JCAMP-DX=4.24\n##DATA TYPE=CHROMATOGRAM\n##XUNITS=MINUTES\n##YUNITS=MAU\n' +
      '##FIRSTX=0\n##LASTX=0.4\n##NPOINTS=5\n##XFACTOR=1\n##YFACTOR=0.1\n##XYDATA=(X++(Y..Y))\n0 A00KL\n0.3 A05%k\n##END=\n';
    var r = P.parseText(txt, { filename: 't.jdx' });
    t.ok(r.ok, r.error); t.eq(r.format, 'JCAMP-DX'); var tr = r.traces[0];
    t.eq(tr.y.length, 5); [10, 10.2, 10.5, 10.5, 10.3].forEach(function (v, i) { t.near(tr.y[i], v, 1e-9, 'y' + i); });
    t.near(tr.x[4], 0.4, 1e-12); t.eq(tr.yUnit, 'mAU'); t.eq(tr.name, 'Test chrom'); t.eq(r.warnings.length, 0, 'no y-check warnings');
  });
  PK.test('parsers/jcamp: JCAMP AFFN seconds and XYPOINTS', function (t) {
    var r = P.parseText('##TITLE=affn\n##XUNITS=SECONDS\n##YUNITS=COUNTS\n##FIRSTX=0\n##LASTX=50\n##NPOINTS=6\n##XYDATA=(X++(Y..Y))\n0 1.5 2.5 3.5\n30 4.5 5.5 -6.5\n##END=', { filename: 'a.dx' });
    t.ok(r.ok, r.error); t.near(r.traces[0].x[5], 50 / 60, 1e-12); t.eq(r.traces[0].y[5], -6.5); t.eq(r.traces[0].yUnit, 'counts');
    var p = P.parseText('##TITLE=pts\n##XUNITS=MINUTES\n##XYPOINTS=(XY..XY)\n0.0, 1.0; 0.5, 2.0\n1.0, 3.0\n##END=', { filename: 'p.jdx' });
    t.ok(p.ok, p.error); t.eq(p.traces[0].x.join(','), '0,0.5,1'); t.eq(p.traces[0].y.join(','), '1,2,3');
  });

  PK.test('parsers/jcamp: sample file samples/data/jcamp.jdx (DIFDUP + Y-check)', function (t) {
    return F.withSample(t, 'jcamp.jdx', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'jcamp'); t.eq(r.warnings.length, 0, 'NPOINTS and Y-checks consistent: ' + r.warnings.join(' | '));
      var tr = r.traces[0]; t.eq(tr.x.length, 401); t.eq(tr.yUnit, 'mAU'); t.near(tr.x[400], 8, 1e-9); t.near(tr.x[F.argmax(tr.y)], 3.3, 0.04);
      t.eq(tr.meta.dataType, 'CHROMATOGRAM');
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
