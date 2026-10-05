/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly parser plugin "unicorn": Cytiva (GE) UNICORN curve export (.asc / .csv / .txt).
   Format: (x, y) column pairs per curve; a run-name row, a curve-name row (UV 1_280, Cond, Conc B, Fractions ...), and a
     units row ("ml", "mAU", "ml", "mS/cm", ...). x is elution VOLUME (mL) unless the units row says min.
     Text in a y cell (Fractions, Injection, Logbook) becomes an event.
   Sniff: units row starting "ml<sep>mAU|mS/cm|%|MPa|pH|C" -> 0.92; "UNICORN" or "Chrom.1" with "ml" -> 0.6.
   Variants: tab/semicolon/comma, decimal comma, ragged curves of different lengths; flow rate converts mL to min.
   Format knowledge: UNICORN 5/6/7 Evaluation "Export > Curves" documentation and example exports.
   Sample: samples/data/unicorn.asc */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, unquote = H.unquote, splitLines = H.splitLines, parseNum = H.parseNum, decideDC = H.decideDC, normXUnit = H.normXUnit, normYUnit = H.normYUnit, roleOf = H.roleOf, wavelengthOf = H.wavelengthOf, splitLine = H.splitLine, mkTrace = H.mkTrace, fail = H.fail, okRes = H.okRes;

  function unicornLayout(lines) {
    var d = null, best = 0;
    ['\t', ';', ','].forEach(function (c) { var n = 0; lines.slice(0, 10).forEach(function (l) { n += l.split(c).length - 1; }); if (n > best) { best = n; d = c; } });
    if (!d) return null;
    for (var i = 0; i < Math.min(lines.length, 40); i++) {
      var f = splitLine(lines[i], d).map(unquote), pairs = 0;
      for (var j = 0; j + 1 < f.length; j += 2) if (/^(ml|min|cv)$/i.test(f[j]) && f[j + 1] && isNaN(parseNum(f[j + 1]))) pairs++;
      if (pairs >= 1 && /^(ml|min|cv)$/i.test(f[0])) return { d: d, ui: i, units: f };
    }
    return null;
  }
  function parseUnicorn(text, opts) {
    var lines = splitLines(text), L = unicornLayout(lines);
    if (!L) return fail('Cytiva UNICORN export', 'Couldn\'t find the UNICORN units row (e.g. "ml, mAU, ml, mS/cm"). Re-export from UNICORN Evaluation as CSV/ASC with curve headers.');
    var names = L.ui > 0 ? splitLine(lines[L.ui - 1], L.d).map(unquote) : [], run = L.ui > 1 ? splitLine(lines[L.ui - 2], L.d).map(unquote) : [];
    var np = Math.ceil(L.units.length / 2), curves = [], toks = [];
    for (var k = L.ui + 1; k < lines.length && toks.length < 3000; k++) splitLine(lines[k], L.d).forEach(function (t) { toks.push(t); });
    var dc = L.d === ',' ? false : decideDC(toks);
    for (var j = 0; j < np; j++) curves.push({ name: names[2 * j] || names[2 * j + 1] || 'Curve ' + (j + 1), xu: L.units[2 * j], yu: L.units[2 * j + 1] || '', xs: [], ys: [], ev: [] });
    for (var i = L.ui + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var f = splitLine(lines[i], L.d);
      for (j = 0; j < np; j++) {
        var x = parseNum(f[2 * j] || '', dc); if (!isFinite(x)) continue;
        var ys = unquote(f[2 * j + 1] || ''), y = parseNum(ys, dc);
        if (isFinite(y)) { curves[j].xs.push(x); curves[j].ys.push(y); } else if (ys) curves[j].ev.push({ x: x, label: ys });
      }
    }
    var traces = [], events = [], w = [], flow = +opts.flow, vol = false;
    var base = baseName(opts.filename), runName = run.filter(Boolean)[0];
    curves.forEach(function (c) {
      var xu = normXUnit(c.xu) || 'mL';
      var conv = function (x) { return xu === 'mL' && flow > 0 ? x / flow : xu === 'sec' ? x / 60 : x; };
      c.ev.forEach(function (e) { events.push({ curve: c.name, x: conv(e.x), label: e.label }); });
      if (!c.xs.length) return;
      var yu = normYUnit(c.yu) || c.yu || 'a.u.', role = roleOf(c.name, yu), meta = { column: c.name };
      if (role !== 'signal') meta.role = role;
      if (role === 'gradient' && yu === 'a.u.') yu = '%';
      var wl = wavelengthOf(c.name); if (wl) meta.wavelength = wl;
      if (runName) meta.sampleName = runName;
      var tr = mkTrace((runName || base ? (runName || base) + ' · ' : '') + c.name, c.xs, c.ys, xu, yu, meta, flow);
      if (tr.meta.xIsVolume) vol = true;
      traces.push(tr);
    });
    traces.sort(function (a, b) { return (a.meta.role ? 1 : 0) - (b.meta.role ? 1 : 0); });
    if (events.length && traces[0]) traces[0].meta.events = events;
    if (vol) w.push('The x axis is elution volume (mL). Enter the flow rate to convert to minutes.');
    if (!traces.length) return fail('Cytiva UNICORN export', 'Found the UNICORN header but no numeric curve data under it.');
    return okRes('Cytiva UNICORN export', traces, w, { events: events });
  }
  P.register({
    id: 'unicorn', order: 130, name: 'Cytiva UNICORN export', extensions: ['asc', 'csv', 'txt'], binary: false,
    description: 'Multi-curve (x, y) column pairs; volume x kept as mL unless flow is given.',
    sniff: function (head) {
      if (/^\s*"?ml"?\s*[\t,;]\s*"?(mAU|mS\/cm|%|MPa|pH|°C|C)"?/im.test(head)) return 0.92;
      return /UNICORN|Chrom\.\d/i.test(head) && /\bml\b/i.test(head) ? 0.6 : 0;
    },
    parse: function (text, opts) { return parseUnicorn(text, opts || {}); }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
