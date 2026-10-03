/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "jcamp": JCAMP-DX 4.24 / 5.x chromatograms and spectra.
   Format: "##LABEL=value" records; data in ##XYDATA=(X++(Y..Y)) (AFFN or ASDF compressed: SQZ, DIF, DUP with the DIF
     Y-check value repeated at the start of the next line), ##XYPOINTS / ##PEAK TABLE=(XY..XY); XFACTOR/YFACTOR,
     FIRSTX/LASTX/NPOINTS, XUNITS/YUNITS. Multiple blocks (##TITLE) become multiple traces.
   Sniff: "##TITLE=" or "##JCAMP-DX=" in the head -> 0.95.
   Variants: "$$" comments, decimal comma in header numbers, '?' missing values. NTUPLES (2-D) are not supported.
   Format knowledge: McDonald & Wilks, Appl. Spectrosc. 42 (1988) 151; IUPAC JCAMP-DX recommendations.
   Sample: samples/data/jcamp.jdx */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, trim = H.trim, splitLines = H.splitLines, normXUnit = H.normXUnit, normYUnit = H.normYUnit, mkTrace = H.mkTrace, fail = H.fail, okRes = H.okRes;

  var SQZ = { '@': 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, a: -1, b: -2, c: -3, d: -4, e: -5, f: -6, g: -7, h: -8, i: -9 };
  var DIF = { '%': 0, J: 1, K: 2, L: 3, M: 4, N: 5, O: 6, P: 7, Q: 8, R: 9, j: -1, k: -2, l: -3, m: -4, n: -5, o: -6, p: -7, q: -8, r: -9 };
  var DUP = { S: 1, T: 2, U: 3, V: 4, W: 5, X: 6, Y: 7, Z: 8, s: 9 };
  var AFFN_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]\d+)?/;
  /** Decode one ASDF/AFFN data line → { vals, endsDif }. Exponents need an explicit sign (E is also SQZ 5). */
  function decodeAsdf(line) {
    var out = [], i = 0, L = line.length, lastDiff = 0, lastDif = false, endsDif = false;
    while (i < L) {
      var c = line.charAt(i), kind, lead;
      if (c === ' ' || c === ',' || c === '\t' || c === ';') { i++; continue; }
      if (c === '?') { out.push(NaN); lastDif = false; endsDif = false; i++; continue; }
      if (c in SQZ) { kind = 'sqz'; lead = SQZ[c]; } else if (c in DIF) { kind = 'dif'; lead = DIF[c]; } else if (c in DUP) { kind = 'dup'; lead = DUP[c]; }
      else if (/[0-9.+\-]/.test(c)) {
        var m = AFFN_RE.exec(line.slice(i)); if (!m) { i++; continue; }
        out.push(+m[0]); i += m[0].length; lastDif = false; endsDif = false; continue;
      } else { i++; continue; }
      var j = i + 1, ds = ''; while (j < L && /[0-9]/.test(line.charAt(j))) ds += line.charAt(j++);
      var v = (lead < 0 || (lead === 0 && c !== '@' && c !== '%') ? -1 : 1) * parseFloat(String(Math.abs(lead)) + ds);
      if (kind === 'sqz') { out.push(v); lastDif = false; endsDif = false; }
      else if (kind === 'dif') { var prev = out.length ? out[out.length - 1] : 0; out.push(prev + v); lastDiff = v; lastDif = true; endsDif = true; }
      else { for (var k = 1; k < v; k++) { var pv = out[out.length - 1]; out.push(lastDif ? pv + lastDiff : pv); } }
      i = j;
    }
    return { vals: out, endsDif: endsDif };
  }
  function jcampNum(s) { var v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : NaN; }
  function parseJcamp(text, opts) {
    var lines = splitLines(text), blocks = [], cur = null, mode = null, w = [];
    lines.forEach(function (raw) {
      var line = raw.replace(/\$\$.*$/, '');
      var m = /^\s*##([^=]*)=(.*)$/.exec(line);
      if (m) {
        var key = m[1].toUpperCase().replace(/[\s\-\/_]/g, ''), val = trim(m[2]);
        if (key === 'TITLE') { cur = { ldr: {}, data: [], dtype: null }; blocks.push(cur); }
        if (!cur) { cur = { ldr: {}, data: [], dtype: null }; blocks.push(cur); }
        if (key === 'END') { mode = null; return; }
        if (/^(XYDATA|PEAKTABLE|XYPOINTS|DATATABLE)$/.test(key)) { mode = key; cur.dtype = key + ' ' + val; return; }
        mode = null; cur.ldr[key] = val; return;
      }
      if (mode && cur && trim(line)) cur.data.push(line);
    });
    var traces = [];
    blocks.forEach(function (b, bi) {
      if (!b.data.length) return;
      var L = b.ldr, xf = jcampNum(L.XFACTOR) || 1, yf = jcampNum(L.YFACTOR) || 1, xs = [], ys = [];
      var xu = L.XUNITS || '', yu = L.YUNITS || '';
      if (/\(X\+\+\(Y\.\.Y\)\)/i.test(b.dtype.replace(/\s/g, ''))) {
        var raw = [], prevDif = false, firstXs = [];
        b.data.forEach(function (line) {
          var d = decodeAsdf(line); if (!d.vals.length) return;
          var yv = d.vals.slice(1);
          if (prevDif && raw.length && yv.length) {
            if (Math.abs(yv[0] - raw[raw.length - 1]) > 1e-6 * Math.max(1, Math.abs(yv[0]))) w.push('JCAMP Y-check mismatch near X=' + d.vals[0] + ' (data may be corrupted).');
            yv.shift();
          }
          firstXs.push(d.vals[0]);
          for (var k = 0; k < yv.length; k++) raw.push(yv[k]);
          prevDif = d.endsDif;
        });
        var n = raw.length, np = parseInt(L.NPOINTS, 10), fx = jcampNum(L.FIRSTX), lx = jcampNum(L.LASTX);
        if (np && np !== n) w.push('JCAMP NPOINTS=' + np + ' but ' + n + ' values were decoded.');
        if (!isFinite(fx)) fx = (firstXs[0] || 0) * xf;
        var dx = isFinite(lx) && n > 1 ? (lx - fx) / ((np || n) - 1) : (isFinite(jcampNum(L.DELTAX)) ? jcampNum(L.DELTAX) : 1);
        for (var i = 0; i < n; i++) { xs.push(fx + i * dx); ys.push(raw[i] * yf); }
      } else { // (XY..XY) pairs
        var nums = [];
        b.data.forEach(function (line) { var re = /[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|\?/g, m; while ((m = re.exec(line))) nums.push(m[0] === '?' ? NaN : +m[0]); });
        for (var j = 0; j + 1 < nums.length; j += 2) { xs.push(nums[j] * xf); ys.push(nums[j + 1] * yf); }
      }
      var unit = normXUnit(xu.replace(/^time\s*/i, '').replace(/[()]/g, '')) || (/min/i.test(xu) ? 'min' : /sec/i.test(xu) ? 'sec' : null);
      if (!unit) { if (xu) w.push('XUNITS is "' + xu + '", not a time unit; x values are used as-is.'); unit = 'min'; }
      var title = L.TITLE || baseName(opts.filename) || 'JCAMP ' + (bi + 1);
      var yUnit = normYUnit(yu) || (yu ? yu : 'a.u.');
      traces.push(mkTrace(title, xs, ys, unit, yUnit, { header: L, sampleName: L.TITLE, dataType: L.DATATYPE }));
    });
    if (!traces.length) return fail('JCAMP-DX', 'No ##XYDATA, ##XYPOINTS or ##PEAK TABLE block was found in this JCAMP-DX file (NTUPLES/multi-dimensional data are not supported).');
    return okRes('JCAMP-DX', traces, w);
  }
  P.register({
    id: 'jcamp', order: 40, name: 'JCAMP-DX', extensions: ['jdx', 'dx', 'jcamp', 'jcm'], binary: false,
    description: 'AFFN and ASDF (SQZ/DIF/DUP) compressed XYDATA, XYPOINTS, PEAK TABLE.',
    sniff: function (head) { return /##(TITLE|JCAMP-?DX)\s*=/i.test(head) ? 0.95 : 0; },
    parse: function (text, opts) { return parseJcamp(text, opts || {}); }
  });

  P._internal = P._internal || {}; P._internal.decodeAsdf = decodeAsdf;
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
