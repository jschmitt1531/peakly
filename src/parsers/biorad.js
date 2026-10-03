/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "biorad": Bio-Rad ChromLab / NGC CSV export.
   Format: free-text report lines and "Key:,Value" metadata, then a multi-column table: Volume (ml) or Time (min), UV
     (mAU), Conductivity (mS/cm), GP (%B), pH, pressure ...
   Sniff: "ChromLab", "NGC" or "Bio-Rad" in the head -> 0.85; Volume (ml) + Conductivity + UV headers -> 0.55.
   Variants: volume or time x axis (volume kept as mL unless a flow rate is given).
   Format knowledge: ChromLab "Export run data to CSV" documentation and example exports.
   Sample: samples/data/biorad.csv */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var tableToResult = H.tableToResult;

  P.register({
    id: 'biorad', order: 140, name: 'Bio-Rad ChromLab/NGC export', extensions: ['csv', 'txt'], binary: false,
    sniff: function (head) {
      if (/ChromLab|NGC|Bio-?Rad/i.test(head)) return 0.85;
      return /Volume\s*\(ml\)/i.test(head) && /Conductivity/i.test(head) && /UV/i.test(head) ? 0.55 : 0;
    },
    parse: function (text, opts) {
      opts = opts || {};
      var r = tableToResult(text, 'Bio-Rad ChromLab/NGC export', opts, { xUnit: 'min' });
      if (r.ok && r.traces.some(function (t) { return t.meta.xIsVolume; })) r.warnings.push('The x axis is elution volume (mL). Enter the flow rate to convert to minutes.');
      if (r.ok) r.traces.sort(function (a, b) { return (a.meta.role ? 1 : 0) - (b.meta.role ? 1 : 0); });
      return r;
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
