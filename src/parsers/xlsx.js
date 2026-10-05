/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly parser plugin "xlsx": Excel / OpenDocument workbooks (.xlsx .xlsm .xls .ods) via the SheetJS CDN global XLSX.
   Format: the first sheet that contains a numeric table is converted to TSV and read with parseText (so vendor sniffers
     still apply to the sheet contents).
   Sniff: ZIP magic "PK\3\4" plus xl/ or [Content_Types] or ODS mimetype (or .xlsx/.xlsm/.ods name) -> 0.9; OLE2 compound
     file magic with .xls name -> 0.9.
   Variants: multiple sheets (first numeric one wins, warning names it); SheetJS absent -> friendly error.
   Format knowledge: ECMA-376 (OOXML) / OASIS ODF container magic only; cell decoding is SheetJS (Apache-2.0).
   Sample: samples/data/xlsx.xlsx (stored-ZIP OOXML written by tools/make-samples.js; parsed only when SheetJS is loaded) */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var glob = H.glob, extOf = H.extOf, assign = H.assign, fail = H.fail;

  P.register({
    id: 'xlsx', order: 30, name: 'Excel workbook', extensions: ['xlsx', 'xls', 'xlsm', 'ods'], binary: true,
    description: 'First sheet with a numeric table (needs the SheetJS library).',
    sniff: function (head, fn) {
      var ext = extOf(fn);
      if (head.slice(0, 4) === 'PK\u0003\u0004') return /xl\/|\[Content_Types\]|mimetypeapplication\/vnd\.oasis/.test(head) || /^(xlsx|xlsm|ods)$/.test(ext) ? 0.9 : 0.2;
      if (head.slice(0, 4) === 'ÐÏ\u0011à') return ext === 'xls' ? 0.9 : 0.1;
      return 0;
    },
    parse: function (buf, opts) {
      var X = glob('XLSX');
      if (!X) return fail('Excel', 'Reading Excel files needs the SheetJS library, which loads from a CDN and isn\'t available right now. Check your internet connection and reload, or save the sheet as CSV and open that.');
      var wb = X.read(new Uint8Array(buf), { type: 'array' }), first = null;
      for (var i = 0; i < wb.SheetNames.length; i++) {
        var sn = wb.SheetNames[i], aoa = X.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, blankrows: false, defval: '' });
        if (!aoa.length) continue;
        var tsv = aoa.map(function (r) { return r.map(function (v) { return v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n');
        var r = P.parseText(tsv, assign({}, opts, { sourceKind: 'file' }));
        if (r.ok) { r.sheetPlugin = r.plugin; r.plugin = 'xlsx'; r.format = 'Excel (' + r.format + ')'; if (wb.SheetNames.length > 1) r.warnings.push('Read sheet "' + sn + '" (first sheet with numeric data).'); return r; }
        if (!first) { first = r; first.sheetPlugin = r.plugin; first.plugin = 'xlsx'; }
      }
      return first || fail('Excel', 'The workbook has no sheet with numbers. Expected a sheet with a time column and at least one signal column.');
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
