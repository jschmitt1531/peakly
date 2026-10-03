/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "waters-arw": Waters Empower .arw export.
   Format: alternating quoted key and value lines ("SampleName"<TAB>"Channel"... / "Std A"<TAB>"PDA 254nm"...), then
     two-column numeric data (minutes, AU or the unit named in the header).
   Sniff: first line starts with a quoted Empower field name (SampleName, Channel, Vial, Injection, ...) -> 0.9.
   Variants: comma or tab separated header lines; PDA/TUV channels -> AU; unit field when present.
   Format knowledge: Empower "Export ASCII" (arw) documentation and example exports.
   Sample: samples/data/waters-arw.arw */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, trim = H.trim, unquote = H.unquote, splitLines = H.splitLines, normYUnit = H.normYUnit, deriveMeta = H.deriveMeta, splitLine = H.splitLine, tableToResult = H.tableToResult;

  P.register({
    id: 'waters-arw', order: 120, name: 'Waters Empower .arw', extensions: ['arw'], binary: false,
    sniff: function (head) { return /^\s*"(SampleName|Sample Name|Channel|Channel Name|Injection|Vial|Sample Set Name|Result Id|Date Acquired)"/i.test(head) ? 0.9 : 0; },
    parse: function (text, opts) {
      opts = opts || {};
      var lines = splitLines(text), i = 0, q = [];
      while (i < lines.length && (/^\s*"/.test(lines[i]) || !trim(lines[i]))) { if (trim(lines[i])) q.push(lines[i]); i++; }
      var hdr = {};
      for (var k = 0; k + 1 < q.length; k += 2) {
        var d = q[k].indexOf('\t') >= 0 ? '\t' : ',', keys = splitLine(q[k], d).map(unquote), vals = splitLine(q[k + 1], d).map(unquote);
        keys.forEach(function (key, j) { if (key) hdr[key] = vals[j] != null ? vals[j] : ''; });
      }
      var meta = deriveMeta(hdr), unitKey = Object.keys(hdr).filter(function (k2) { return /unit/i.test(k2); })[0];
      var yu = (unitKey && (normYUnit(hdr[unitKey]) || hdr[unitKey])) || (meta.wavelength || /pda|uv|tuv|nm/i.test(meta.channel || '') ? 'AU' : null);
      var r = tableToResult(lines.slice(i).join('\n'), 'Waters Empower .arw', opts, { xUnit: 'min', xUnitTrusted: true, yUnit: yu || 'a.u.', quietY: true, parse: { noHeader: true } }, meta);
      if (r.ok && !yu) r.warnings.push('No unit in the Empower header; signal unit set to "a.u.".');
      (r.traces || []).forEach(function (t) { if (r.traces.length === 1) t.name = (meta.sampleName || baseName(opts.filename) || 'Empower') + (meta.channel ? ' ' + meta.channel : ''); });
      return r;
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
