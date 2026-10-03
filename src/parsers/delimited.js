/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "delimited": Generic delimited text (CSV / TSV / semicolon / whitespace / pipe).
   Format: one data point per line, two or more numeric columns; optional header row (units in brackets, e.g.
     "Time (min)", "Signal [mAU]"), optional two-line header (names row + units row), optional "Key: value" preamble.
   Sniff: >= 3 lines in the first 4 KB that start with "number <delimiter> number" -> 0.3, otherwise 0.1 (it is also the
     fallback reader when every other plugin fails).
   Variants: decimal comma (voted per file), thousands separators "1,234.5", UTF-8/UTF-16 with or without BOM, quoted
     cells, single numeric column (-> needsMapping with sampling interval), pasted Excel blocks.
   Format knowledge: RFC 4180 plus observed instrument exports; all logic lives in registry.js (parseDelimited, autoMap).
   Sample: samples/data/delimited.csv */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var splitLines = H.splitLines, tableToResult = H.tableToResult;

  P.register({
    id: 'delimited', order: 10, name: 'Delimited text (CSV/TSV)', extensions: ['csv', 'tsv', 'txt', 'dat', 'asc', 'text'], binary: false,
    description: 'Comma, tab, semicolon or space separated columns; decimal comma; optional header; metadata lines kept.',
    sniff: function (head) { var n = 0; splitLines(head).forEach(function (l) { if (/^\s*[+-]?[\d.,]+([eE][+-]?\d+)?\s*[\t,; |]\s*[+-]?[\d.,]/.test(l)) n++; }); return n >= 3 ? 0.3 : 0.1; },
    parse: function (text, opts) { return tableToResult(text, 'Delimited text', opts || {}, {}); }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
