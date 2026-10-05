/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly parser plugin "chromeleon": Thermo Chromeleon ASCII export.
   Format: "Raw Data:" / "Information:" / "Chromatogram Data Information:" key<TAB>value blocks, then a
     "Chromatogram Data:" line followed by "Time (min)<TAB>Step (s)<TAB>Value (unit)" table. "n.a." marks missing cells.
   Sniff: a line "Chromatogram Data:" -> 0.95; "Chromatogram Data Information:" or "Raw Data:" -> 0.75.
   Variants: decimal comma locales; Signal Unit given in the header block only.
   Format knowledge: Chromeleon 6.8/7 "Export > ASCII" documentation and example exports.
   Sample: samples/data/chromeleon.txt */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var trim = H.trim, splitLines = H.splitLines, normYUnit = H.normYUnit, wavelengthOf = H.wavelengthOf, kvMeta = H.kvMeta, deriveMeta = H.deriveMeta, fail = H.fail, tableToResult = H.tableToResult;

  P.register({
    id: 'chromeleon', order: 100, name: 'Thermo Chromeleon ASCII', extensions: ['txt', 'csv'], binary: false,
    sniff: function (head) { return /^\s*Chromatogram Data:\s*$/im.test(head) ? 0.95 : (/Chromatogram Data Information:|^\s*Raw Data:\s*$/im.test(head) ? 0.75 : 0); },
    parse: function (text, opts) {
      opts = opts || {};
      var lines = splitLines(text), cut = -1;
      for (var i = 0; i < lines.length; i++) if (/^\s*Chromatogram Data:\s*$/i.test(lines[i])) { cut = i; break; }
      if (cut < 0) return fail('Thermo Chromeleon ASCII', 'Found a Chromeleon header but no "Chromatogram Data:" line followed by a data table. Re-export with "Raw data" / chromatogram data enabled.');
      var hdr = kvMeta(lines.slice(0, cut).filter(function (l) { return !/:\s*$/.test(trim(l)); }));
      var yu = hdr['Signal Unit'] || hdr['Signal Units'];
      var meta = deriveMeta(hdr);
      var r = tableToResult(lines.slice(cut + 1).join('\n'), 'Thermo Chromeleon ASCII', opts, { xUnit: 'min', yUnit: normYUnit(yu) || yu || null }, meta);
      (r.traces || []).forEach(function (t) {
        if (meta.sampleName && r.traces.length === 1) t.name = meta.sampleName + (meta.channel ? ' ' + meta.channel : '');
        if (meta.channel && !t.meta.wavelength) { var wl = wavelengthOf(meta.channel); if (wl) t.meta.wavelength = wl; }
      });
      return r;
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
