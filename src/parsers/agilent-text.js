/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly parser plugin "agilent-text": Agilent ChemStation / OpenLab CSV and TXT signal exports.
   Format: two columns time (min), signal (mAU) with no header, often UTF-16LE with BOM; sometimes a "DAD1 A, Sig=254,4
     Ref=off" signal description line.
   Sniff: ChemStation/OpenLab/Agilent or "DAD1 A, Sig=" text -> 0.8; file name starting DAD1/VWD1/FLD1... -> 0.7;
     UTF-16 encoded two-column numeric text -> 0.6.
   Variants: comma or tab separated, with/without header, "Export to CSV" from ChemStation Data Analysis.
   Format knowledge: observed ChemStation "Export Data to CSV" behaviour; units default to min / mAU.
   Sample: samples/data/agilent-text.csv (UTF-16LE with BOM) */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, trim = H.trim, wavelengthOf = H.wavelengthOf, tableToResult = H.tableToResult;

  // Agilent ChemStation / OpenLab CSV & TXT (often UTF-16LE, no header, minutes / mAU).
  P.register({
    id: 'agilent-text', order: 90, name: 'Agilent ChemStation/OpenLab export', extensions: ['csv', 'txt'], binary: false,
    sniff: function (head, fn, info) {
      if (/ChemStation|OpenLab|Agilent|\b(DAD|VWD|MWD|FLD|RID|ADC)\d?\s*[A-Z]?\s*,\s*Sig\s*=/i.test(head)) return 0.8;
      if (/^(DAD|VWD|MWD|FLD|RID|ADC)\d/i.test(baseName(fn))) return 0.7;
      if (info && /^utf-16/.test(info.encoding || '') && /^\s*[+-]?[\d.]+(E[+-]?\d+)?\s*[\t,]\s*[+-]?[\d.]/im.test(head)) return 0.6;
      return 0;
    },
    parse: function (text, opts) {
      var r = tableToResult(text, 'Agilent ChemStation/OpenLab export', opts || {}, { xUnit: 'min', xUnitTrusted: true, yUnit: 'mAU', quietY: true });
      var sig = /\b((?:DAD|VWD|MWD|FLD|RID|ADC)\d?\s*[A-Z]?\s*,\s*Sig\s*=\s*[\d.]+[^\r\n"]*)/i.exec(text) || /^((?:DAD|VWD|MWD|FLD|RID|ADC)\d[A-Z]?)/i.exec(baseName(opts && opts.filename));
      (r.traces || []).forEach(function (t) { if (sig) { t.meta.channel = t.meta.channel || trim(sig[1]); var wl = wavelengthOf(sig[1]); if (wl) t.meta.wavelength = wl; } });
      return r;
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
