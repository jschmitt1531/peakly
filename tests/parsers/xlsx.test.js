/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/xlsx.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/xlsx: xlsx needs SheetJS (graceful) or parses when present', function (t) {
    var X = typeof globalThis !== 'undefined' ? globalThis.XLSX : null;
    if (!X) {
      return P.parseArrayBuffer(F.asciiBuf('PK\u0003\u0004[Content_Types].xml xl/workbook.xml'), { filename: 'run.xlsx' }).then(function (r) {
        t.ok(!r.ok && /SheetJS/.test(r.error), r.error); t.eq(r.plugin, 'xlsx');
      });
    }
    var ws = X.utils.aoa_to_sheet([['Time (min)', 'UV (mAU)'], [0, 1], [0.5, 4], [1, 2]]), wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Data');
    var out = X.write(wb, { type: 'array', bookType: 'xlsx' });
    return P.parseArrayBuffer(out, { filename: 'run.xlsx' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.traces[0].y[1], 4); t.eq(r.traces[0].yUnit, 'mAU');
    });
  });

  PK.test('parsers/xlsx: sample file samples/data/xlsx.xlsx (parsed when SheetJS is loaded)', function (t) {
    return F.withSample(t, 'xlsx.xlsx', function (r) {
      t.eq(r.plugin, 'xlsx', 'routed to the Excel plugin');
      var X = typeof globalThis !== 'undefined' ? globalThis.XLSX : null;
      if (!X) { t.ok(!r.ok && /SheetJS/.test(r.error), 'graceful without SheetJS: ' + r.error); return; }
      t.ok(r.ok, r.error); var tr = r.traces[0]; t.eq(tr.x.length, 121); t.eq(tr.yUnit, 'mAU'); t.near(tr.x[F.argmax(tr.y)], 3.9, 0.06);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
