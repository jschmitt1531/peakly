/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "mocca2": interop with MOCCA2 (Bayer AG, MIT; github.com/bayer-group/MOCCA) JSON serialization.
   Format: json.dump of MOCCA2's to_dict() (numpy arrays become lists; "__classname__" tags each object):
     Data2D      { time:[min], wavelength:[nm], data:[[absorbance per time] per wavelength], __classname__:'Data2D' }
     Chromatogram = Data2D + { peaks:[Peak|DeconvolvedPeak], name, sample_path, blank_path, __classname__:'Chromatogram' }
     Peak        { left, right, maximum (time indices), height, prominence, all_maxima:[...], __classname__:'Peak' }
     DeconvolvedPeak = Peak + { components:[Component], residual_mse, r2, resolved }
     Component   { concentration:[profile from index left], spectrum:[per wavelength, mean 1], compound_id|null,
                   elution_time (index), integral (sum of concentration), peak_fraction }
     MoccaDataset { chromatograms:{id: Chromatogram}, _raw_2d_data:{id: Data2D}, compounds:{id: {name, elution_time,
                   spectrum, concentration_factor...}}, compound_references, istd_*, settings, __classname__:'MoccaDataset' }
   Output: one trace per chromatogram at one wavelength: opts.wavelength (nm, or 'sum' for the sum over wavelengths),
     else 254 nm when present (±0.5 nm), else the wavelength with the highest absorbance. traces[i].peaks: one entry per
     deconvolved component (label = compound name from the dataset, else "Compound <id>") with
     area = integral · spectrum[selected wavelength] · Δt (absorbance·min; Δt = median time step), or one entry per plain
     Peak with area = trapezoid of the selected trace between left and right (no baseline subtraction). source:'mocca2'.
   Sniff: "__classname__":"Chromatogram|MoccaDataset|Data2D" in the head -> 0.97; {"chromatograms": -> 0.9; "time" and
     "wavelength" arrays in the head -> 0.92. JSON already parsed by the json plugin reaches this plugin through sniffJSON().
   Variants (tolerated): data transposed [time][wavelength]; 1-D data with a scalar wavelength; per-wavelength traces as
     {traces|signals: {"254": [...]}}; time_unit key ('min' default). Unknown shapes -> error listing the keys found.
   Format knowledge: MOCCA2 public documentation and the to_dict()/from_dict() field names in its source (MIT); no MOCCA2
     code is used.
   Sample: samples/data/mocca2.json (a MoccaDataset with one deconvolved chromatogram) */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, normXUnit = H.normXUnit, mkTrace = H.mkTrace, normPeaks = H.normPeaks, fail = H.fail, okRes = H.okRes;
  var FORMAT = 'MOCCA2 JSON';

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function isNumArr(a) { return Array.isArray(a) && a.length > 0 && typeof a[0] === 'number'; }
  function is2D(a) { return Array.isArray(a) && a.length > 0 && Array.isArray(a[0]); }
  function cls(o) { return isObj(o) ? String(o.__classname__ || '') : ''; }
  function describe(o) {
    if (!isObj(o)) return Array.isArray(o) ? 'an array of ' + o.length : typeof o;
    return Object.keys(o).slice(0, 15).map(function (k) { var v = o[k]; return k + ' (' + (is2D(v) ? 'array[' + v.length + '][' + v[0].length + ']' : Array.isArray(v) ? 'array[' + v.length + ']' : v === null ? 'null' : typeof v) + ')'; }).join(', ');
  }
  function median(a) { var b = a.slice().sort(function (p, q) { return p - q; }); var m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN; }
  function looksChrom(o) { return isObj(o) && isNumArr(o.time) && (Array.isArray(o.data) || isObj(o.traces) || isObj(o.signals)); }

  // -> { rows:[[y per time] per channel], wl:[nm per channel] } or { error }
  function matrix(c) {
    var n = c.time.length, wl = c.wavelength, d = c.data;
    if (isObj(c.traces) || isObj(c.signals)) {
      var m = c.traces || c.signals, keys = Object.keys(m).filter(function (k) { return isNumArr(m[k]); });
      return { rows: keys.map(function (k) { return m[k]; }), wl: keys.map(function (k) { return parseFloat(k); }) };
    }
    if (isNumArr(d)) return { rows: [d], wl: [typeof wl === 'number' ? wl : isNumArr(wl) && wl.length === 1 ? wl[0] : NaN] };
    if (!is2D(d)) return { error: '"data" is neither a 1-D nor a 2-D array' };
    var nw = isNumArr(wl) ? wl.length : typeof wl === 'number' ? 1 : 0;
    if (d.length === nw && d[0].length === n) return { rows: d, wl: isNumArr(wl) ? wl : [wl] };
    if (d.length === n && (d[0].length === nw || !nw)) {
      var cols = d[0].length, rows = [];
      for (var j = 0; j < cols; j++) { var r = new Array(n); for (var i = 0; i < n; i++) r[i] = d[i][j]; rows.push(r); }
      return { rows: rows, wl: nw ? (isNumArr(wl) ? wl : [wl]) : rows.map(function () { return NaN; }) };
    }
    if (d[0].length === n) return { rows: d, wl: d.map(function (_, k) { return isNumArr(wl) && wl[k] != null ? wl[k] : NaN; }) };
    return { error: '"data" is ' + d.length + '×' + d[0].length + ' but there are ' + n + ' time points and ' + nw + ' wavelengths' };
  }

  function pickChannel(M, want, w) {
    var k;
    if (want === 'sum') return -1;
    if (isFinite(+want) && want !== null && want !== '') {
      for (k = 0; k < M.wl.length; k++) if (Math.abs(M.wl[k] - want) <= 0.5) return k;
      w.push('Wavelength ' + want + ' nm is not in this file; using the default choice.');
    }
    for (k = 0; k < M.wl.length; k++) if (Math.abs(M.wl[k] - 254) <= 0.5) return k;
    var best = 0, bv = -Infinity;
    M.rows.forEach(function (r, i) { for (var j = 0; j < r.length; j++) if (r[j] > bv) { bv = r[j]; best = i; } });
    return best;
  }

  function trapz(x, y, a, b) { var s = 0; for (var i = a; i < b; i++) s += (x[i + 1] - x[i]) * (y[i] + y[i + 1]) / 2; return s; }

  function parseChrom(c, hint, compounds, opts, w) {
    if (!looksChrom(c)) return { error: 'expected "time" (array) and "data" (2-D array) — found ' + describe(c) };
    var M = matrix(c); if (M.error) return { error: M.error };
    var n = c.time.length, k = pickChannel(M, opts.wavelength, w), y;
    if (k < 0) { y = new Array(n); for (var i = 0; i < n; i++) { var s = 0; for (var r = 0; r < M.rows.length; r++) s += +M.rows[r][i] || 0; y[i] = s; } }
    else y = M.rows[k];
    var xu = normXUnit(c.time_unit || c.timeUnit) || 'min', wl = k >= 0 ? M.wl[k] : NaN;
    var label = c.name || (c.sample_path ? baseName(c.sample_path) : '') || hint;
    var meta = { sampleName: c.name || undefined, samplePath: c.sample_path || undefined, blankPath: c.blank_path || undefined,
      mocca: { nWavelengths: M.rows.length, selected: k < 0 ? 'sum' : wl } };
    if (isFinite(wl)) meta.wavelength = wl;
    if (M.rows.length > 1 && M.wl.length <= 2000 && M.wl.every(isFinite)) meta.wavelengths = M.wl.slice();
    Object.keys(meta).forEach(function (q) { if (meta[q] === undefined) delete meta[q]; });
    var tr = mkTrace(label + (k < 0 ? ' (sum of ' + M.rows.length + ' λ)' : isFinite(wl) ? ' ' + wl + ' nm' : ''), c.time, y, xu, 'AU', meta);
    if (M.rows.length > 1 && !opts.wavelength) w.push('"' + label + '" has ' + M.rows.length + ' wavelengths; showing ' + (isFinite(wl) ? wl + ' nm' : 'channel ' + (k + 1)) + (Math.abs(wl - 254) <= 0.5 ? ' (254 nm default).' : ' (highest absorbance).'));
    // peaks (indices into the time axis)
    var t = c.time, dt = median(t.slice(1).map(function (v, q) { return v - t[q]; })), list = [];
    function at(idx) { idx = Math.max(0, Math.min(n - 1, Math.round(+idx))); return t[idx]; }
    (Array.isArray(c.peaks) ? c.peaks : []).forEach(function (p) {
      if (!isObj(p) || !isFinite(+p.left) || !isFinite(+p.right)) return;
      var L = Math.max(0, +p.left), R = Math.min(n - 1, +p.right), comps = Array.isArray(p.components) ? p.components : [];
      if (comps.length) {
        comps.forEach(function (cp) {
          var spec = Array.isArray(cp.spectrum) ? cp.spectrum : [], f = k < 0 ? spec.reduce(function (a, b) { return a + b; }, 0) : spec[k];
          var cid = cp.compound_id, cmp = cid != null && compounds ? compounds[cid] || compounds[String(cid)] : null;
          var q = { start: at(L), apex: at(cp.elution_time != null ? cp.elution_time : p.maximum), end: at(R), source: 'mocca2',
            compoundId: cid != null ? cid : undefined, peakFraction: cp.peak_fraction, r2: p.r2, resolved: p.resolved };
          var nm = cmp && cmp.name ? cmp.name : cid != null ? 'Compound ' + cid : undefined; if (nm) q.label = String(nm);
          if (isFinite(+cp.integral) && isFinite(+f)) q.area = +cp.integral * +f * dt;
          Object.keys(q).forEach(function (z) { if (q[z] === undefined) delete q[z]; });
          list.push(q);
        });
      } else {
        list.push({ start: at(L), apex: at(p.maximum != null ? p.maximum : (L + R) / 2), end: at(R), area: trapz(t, y, L, R),
          height: +p.height, prominence: +p.prominence, source: 'mocca2' });
      }
    });
    var pk = normPeaks(list, xu, 'mocca2');
    if (pk.length) tr.peaks = pk;
    return { trace: tr };
  }

  function parseObj(obj, opts) {
    opts = opts || {};
    var w = [], traces = [], errs = [], base = baseName(opts.filename) || 'MOCCA2';
    function add(c, hint, compounds) { var r = parseChrom(c, hint, compounds, opts, w); if (r.trace && r.trace.x.length) traces.push(r.trace); else errs.push(hint + ': ' + (r.error || 'no data points')); }
    if (cls(obj) === 'MoccaDataset' || isObj(obj.chromatograms)) {
      var ch = isObj(obj.chromatograms) ? obj.chromatograms : {}, ids = Object.keys(ch), comps = isObj(obj.compounds) ? obj.compounds : null;
      ids.forEach(function (id) { add(ch[id], base + ' #' + id, comps); });
      if (!ids.length && isObj(obj._raw_2d_data)) Object.keys(obj._raw_2d_data).forEach(function (id) { add(obj._raw_2d_data[id], base + ' raw #' + id, null); });
      if (!ids.length && !traces.length) errs.push('the dataset has no "chromatograms" (found ' + describe(obj) + ')');
    } else if (Array.isArray(obj)) obj.forEach(function (c, i) { add(c, base + ' ' + (i + 1), null); });
    else add(obj, base, null);
    if (!traces.length) return fail(FORMAT, 'Could not find MOCCA2 chromatogram data: ' + errs.join('; ') + '. Expected a MOCCA2 Chromatogram/Data2D (time, wavelength, data) or MoccaDataset (chromatograms, compounds) saved with to_dict() and json.dump.');
    if (errs.length) w.push('Skipped: ' + errs.join('; ') + '.');
    return okRes(FORMAT, traces, w);
  }

  P.register({
    id: 'mocca2', order: 160, name: FORMAT, extensions: ['json'], binary: false,
    description: 'MOCCA2 Chromatogram / Data2D / MoccaDataset JSON: DAD data at 254 nm (or max), deconvolved peaks with compound names.',
    sniff: function (head) {
      if (/"__classname__"\s*:\s*"(Chromatogram|MoccaDataset|Data2D)"/.test(head)) return 0.97;
      if (/^\s*\{\s*"chromatograms"\s*:/.test(head)) return 0.9;
      return /^\s*\{\s*"time"\s*:\s*\[/.test(head) && /"wavelength"\s*:/.test(head) ? 0.92 : 0;
    },
    sniffJSON: function (obj) {
      var c = cls(obj);
      if (c === 'Chromatogram' || c === 'MoccaDataset' || c === 'Data2D') return 0.99;
      if (isObj(obj) && isObj(obj.chromatograms) && Object.keys(obj.chromatograms).some(function (k) { return looksChrom(obj.chromatograms[k]); })) return 0.95;
      if (looksChrom(obj) && (obj.wavelength != null || is2D(obj.data))) return 0.9;
      if (looksChrom(obj) && Array.isArray(obj.peaks) && obj.peaks.some(function (p) { return isObj(p) && 'left' in p && 'right' in p; })) return 0.8;
      return 0;
    },
    parseJSON: function (obj, opts) { return parseObj(obj, opts); },
    parse: function (text, opts) {
      var obj;
      try { obj = H.parseJSONLoose(text); } catch (e) { return fail(FORMAT, 'This looks like MOCCA2 JSON but could not be read (' + e.message + '). MOCCA2 objects are saved with json.dump(obj.to_dict()).'); }
      return parseObj(obj, opts);
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
