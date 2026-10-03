/* SPDX-License-Identifier: MIT */
/* Peakly analysis: smoothing, baseline, peak detection & integration, figures of merit,
   gradient/method math, normalization, and Levenberg–Marquardt peak fitting.
   Pure functions; x always in minutes; plain or typed arrays accepted, plain arrays returned.
   All algorithms written from the published literature (see docs/CALCULATIONS.md). */
(function (PK) {
  'use strict';
  var A = PK.analysis = PK.analysis || {};
  var U = PK.util;
  var SQ2PI = Math.sqrt(2 * Math.PI), SQRTPI = Math.sqrt(Math.PI), FWHM_SIG = 2 * Math.sqrt(2 * Math.LN2); // 2.35482

  /* ---------------- small helpers ---------------- */
  function toArr(a) { return Array.prototype.slice.call(a || []); }
  function odd(w) { w = Math.max(1, Math.round(w)); return w % 2 ? w : w + 1; }
  function zeros(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = 0; return a; }
  function idxNear(x, t) { // nearest sample index to t (x ascending)
    var i = U.bsearch(x, t); return (i < x.length - 1 && Math.abs(x[i + 1] - t) < Math.abs(x[i] - t)) ? i + 1 : i;
  }
  function argmax(a, i0, i1) { var k = i0; for (var i = i0 + 1; i <= i1; i++) if (a[i] > a[k]) k = i; return k; }
  function argmin(a, i0, i1) { var k = i0; for (var i = i0 + 1; i <= i1; i++) if (a[i] < a[k]) k = i; return k; }
  function fmedian(a) { // fast median via typed-array sort (NaN-free input assumed)
    var b = Float64Array.from(a).sort(), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN;
  }
  function F(expr, inputs, value, note, unit) { var o = { expr: expr, inputs: inputs, value: value, note: note || '' }; if (unit) o.unit = unit; return o; }
  function fin(v) { return typeof v === 'number' && isFinite(v); }

  // Gauss–Jordan inverse with partial pivoting, after symmetric Jacobi scaling (D^-½ M D^-½)
  // so that badly-scaled normal matrices (amplitudes vs widths) stay well conditioned.
  function invert(M) {
    var n = M.length, i, j, r, c, d = new Array(n);
    for (i = 0; i < n; i++) d[i] = M[i][i] > 0 ? 1 / Math.sqrt(M[i][i]) : 1;
    var a = [];
    for (i = 0; i < n; i++) { a.push(new Array(2 * n)); for (j = 0; j < n; j++) { a[i][j] = M[i][j] * d[i] * d[j]; a[i][n + j] = i === j ? 1 : 0; } }
    for (c = 0; c < n; c++) {
      var p = c; for (r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (!(Math.abs(a[p][c]) > 1e-13)) return null;
      var tmp = a[c]; a[c] = a[p]; a[p] = tmp;
      var piv = a[c][c]; for (j = 0; j < 2 * n; j++) a[c][j] /= piv;
      for (r = 0; r < n; r++) if (r !== c) { var f = a[r][c]; if (f) for (j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]; }
    }
    var out = []; for (i = 0; i < n; i++) { out.push(new Array(n)); for (j = 0; j < n; j++) out[i][j] = a[i][n + j] * d[i] * d[j]; }
    return out;
  }
  // Cholesky solve of a small SPD system; returns null if not positive definite.
  function cholSolve(M, b) {
    var n = b.length, L = [], i, j, k, s;
    for (i = 0; i < n; i++) {
      L.push(new Float64Array(n));
      for (j = 0; j <= i; j++) {
        s = M[i][j]; for (k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
      }
    }
    var z = new Float64Array(n), x = new Array(n);
    for (i = 0; i < n; i++) { s = b[i]; for (k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
    for (i = n - 1; i >= 0; i--) { s = z[i]; for (k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }

  /* ---------------- Savitzky–Golay ---------------- */
  // Coefficient table for window m: row s gives the weights that evaluate the deriv-th derivative of the
  // least-squares polynomial (fitted over the m points) at window position s. Row (m-1)/2 is the classic
  // central filter; rows < h / > h are used at the edges (fitted-polynomial edge handling).
  var sgCache = {};
  function sgCoeffs(m, order, d) {
    var key = m + ',' + order + ',' + d; if (sgCache[key]) return sgCache[key];
    var h = (m - 1) / 2, P = order + 1, V = [], k, p, q, s, sum;
    for (k = 0; k < m; k++) { var z = (k - h) / h, row = []; for (p = 0; p < P; p++) row.push(Math.pow(z, p)); V.push(row); } // z∈[-1,1] for conditioning
    var G = []; for (p = 0; p < P; p++) { G.push([]); for (q = 0; q < P; q++) { sum = 0; for (k = 0; k < m; k++) sum += V[k][p] * V[k][q]; G[p].push(sum); } }
    var Gi = invert(G), Mx = []; // Mx = (VᵀV)⁻¹Vᵀ maps data → polynomial coefficients
    for (p = 0; p < P; p++) { Mx.push(new Float64Array(m)); for (k = 0; k < m; k++) { sum = 0; for (q = 0; q < P; q++) sum += Gi[p][q] * V[k][q]; Mx[p][k] = sum; } }
    var rows = [], scale = Math.pow(h, -d); // undo z = (k-h)/h scaling for derivatives
    for (s = 0; s < m; s++) {
      var z0 = (s - h) / h, e = new Float64Array(P);
      for (p = d; p < P; p++) { var f = 1; for (var r = 0; r < d; r++) f *= (p - r); e[p] = f * Math.pow(z0, p - d); }
      var c = new Float64Array(m); for (k = 0; k < m; k++) { sum = 0; for (p = d; p < P; p++) sum += e[p] * Mx[p][k]; c[k] = sum * scale; }
      rows.push(c);
    }
    return (sgCache[key] = rows);
  }
  /** savitzkyGolay(y, window, order=2, deriv=0, delta?) → array. Derivatives are per sample unless delta (x spacing) is given. */
  A.savitzkyGolay = function (y, window, order, deriv, delta) {
    var n = y.length, i, k, sum; deriv = deriv | 0; order = order == null ? 2 : order | 0;
    var m = odd(window || 5); if (m > n) m = n % 2 ? n : n - 1;
    if (order >= m) order = m - 1;
    if (n < 3 || m < 3) return deriv ? zeros(n) : toArr(y);
    if (deriv > order) return zeros(n);
    var C = sgCoeffs(m, order, deriv), h = (m - 1) / 2, c = C[h], out = new Array(n);
    for (i = h; i < n - h; i++) { sum = 0; for (k = 0; k < m; k++) sum += c[k] * y[i - h + k]; out[i] = sum; }
    for (i = 0; i < h; i++) { c = C[i]; sum = 0; for (k = 0; k < m; k++) sum += c[k] * y[k]; out[i] = sum; }
    for (i = n - h; i < n; i++) { c = C[i - (n - m)]; sum = 0; for (k = 0; k < m; k++) sum += c[k] * y[n - m + k]; out[i] = sum; }
    if (deriv && delta) { var sc = Math.pow(delta, -deriv); for (i = 0; i < n; i++) out[i] *= sc; }
    return out;
  };

  /* ---------------- ALS baseline (Eilers & Boelens 2005) ---------------- */
  // Solve the symmetric pentadiagonal system (a: diag, b: 1st off-diag, c: 2nd off-diag) by banded LDLᵀ, O(n).
  function solvePenta(a, b, c, r) {
    var n = a.length, d = new Float64Array(n), l1 = new Float64Array(n), l2 = new Float64Array(n), z = new Float64Array(n), i;
    for (i = 0; i < n; i++) {
      var di = a[i];
      if (i > 0) di -= l1[i - 1] * l1[i - 1] * d[i - 1];
      if (i > 1) di -= l2[i - 2] * l2[i - 2] * d[i - 2];
      d[i] = di;
      if (i < n - 1) l1[i] = (b[i] - (i > 0 ? l2[i - 1] * l1[i - 1] * d[i - 1] : 0)) / di;
      if (i < n - 2) l2[i] = c[i] / di;
    }
    for (i = 0; i < n; i++) z[i] = r[i] - (i > 0 ? l1[i - 1] * z[i - 1] : 0) - (i > 1 ? l2[i - 2] * z[i - 2] : 0); // L u = r
    for (i = 0; i < n; i++) z[i] /= d[i];                                                                      // D v = u
    for (i = n - 1; i >= 0; i--) z[i] -= (i < n - 1 ? l1[i] * z[i + 1] : 0) + (i < n - 2 ? l2[i] * z[i + 2] : 0); // Lᵀ z = v
    return z;
  }
  /** alsBaseline(y, {lambda=1e5, p=0.01, iter=10}) → baseline array.
      Minimises Σ wᵢ(yᵢ−zᵢ)² + λ Σ(Δ²zᵢ)²; wᵢ = p if yᵢ > zᵢ else 1−p, iterated. */
  A.alsBaseline = function (y, opts) {
    opts = opts || {};
    var n = y.length, lambda = opts.lambda == null ? 1e5 : +opts.lambda, p = opts.p == null ? 0.01 : +opts.p, iter = opts.iter == null ? 10 : opts.iter | 0, i, r;
    if (n < 3) return toArr(y);
    var D0 = new Float64Array(n), D1 = new Float64Array(n - 1), D2 = new Float64Array(n - 2);
    for (r = 0; r < n - 2; r++) { // accumulate λ·DᵀD from rows (1,−2,1) of the 2nd-difference matrix D
      D0[r] += lambda; D0[r + 1] += 4 * lambda; D0[r + 2] += lambda;
      D1[r] -= 2 * lambda; D1[r + 1] -= 2 * lambda; D2[r] += lambda;
    }
    var w = new Float64Array(n).fill(1), a = new Float64Array(n), rhs = new Float64Array(n), z;
    for (var it = 0; it < Math.max(1, iter); it++) {
      for (i = 0; i < n; i++) { a[i] = D0[i] + w[i]; rhs[i] = w[i] * y[i]; }
      z = solvePenta(a, D1, D2, rhs);
      var changed = 0;
      for (i = 0; i < n; i++) { var wn = y[i] > z[i] ? p : 1 - p; if (wn !== w[i]) { changed++; w[i] = wn; } }
      if (!changed) break;
    }
    return Array.prototype.slice.call(z);
  };

  /** process(trace) → { x, y, yRaw, ySmooth, baseline } — applies trace.proc: smoothing, then baseline subtraction. */
  A.process = function (trace) {
    var proc = trace.proc || {}, s = proc.smooth || {}, b = proc.baseline || {};
    var x = toArr(trace.x), yRaw = toArr(trace.y), y = yRaw.slice();
    if (s.on) y = A.savitzkyGolay(y, s.window || 11, s.order == null ? 2 : s.order);
    var ySmooth = y, baseline = zeros(y.length);
    if (b.on) { baseline = A.alsBaseline(y, { lambda: b.lambda, p: b.p, iter: b.iter }); y = y.map(function (v, i) { return v - baseline[i]; }); }
    return { x: x, y: y, yRaw: yRaw, ySmooth: ySmooth, baseline: baseline };
  };

  /* ---------------- noise ---------------- */
  /** noise(x, y, {range?:[t0,t1], quantum?}) → { sigma, p2p, method, quantum? }.
      Default: σ = 1.4826·MAD(Δy)/√2 (robust to peaks and drift); p2p = 6σ.
      With range (a blank region): linear detrend, σ = residual SD, p2p = measured max−min (EP 2.2.46 style).
      Quantized / stepped data (digitized traces, low-resolution ADCs): when opts.quantum (the y step, e.g. digitized.dy)
      is given, or ≥ 20 % of first differences are exactly zero, σ is floored at q/√12 (the SD of uniform rounding error),
      q = opts.quantum or the 10th percentile of the non-zero |Δy|. */
  A.noise = function (x, y, opts) {
    opts = opts || {}; var n = y.length, i, q = +opts.quantum > 0 ? +opts.quantum : 0;
    if (opts.range && n > 3) {
      var i0 = U.bsearch(x, opts.range[0]), i1 = Math.min(n - 1, U.bsearch(x, opts.range[1]) + 1), m = i1 - i0 + 1;
      if (m >= 4) {
        var sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (i = i0; i <= i1; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
        var b1 = (m * sxy - sx * sy) / (m * sxx - sx * sx || 1), b0 = (sy - b1 * sx) / m, ss = 0, mn = Infinity, mx = -Infinity;
        for (i = i0; i <= i1; i++) { var r = y[i] - b0 - b1 * x[i]; ss += r * r; if (r < mn) mn = r; if (r > mx) mx = r; }
        var sg = Math.sqrt(ss / (m - 2)), out = { sigma: sg, p2p: mx - mn, method: 'p2p-range', range: [x[i0], x[i1]] };
        if (q && sg < q / Math.sqrt(12)) { out.sigma = q / Math.sqrt(12); out.p2p = Math.max(out.p2p, q); out.method = 'p2p-range+quantum'; out.quantum = q; }
        return out;
      }
    }
    if (n < 3) return { sigma: q ? q / Math.sqrt(12) : 0, p2p: q ? Math.sqrt(3) * q : 0, method: 'mad-diff' };
    var d = new Float64Array(n - 1), zero = 0, span = 0;
    for (i = 0; i < n - 1; i++) { d[i] = y[i + 1] - y[i]; span = Math.max(span, Math.abs(y[i])); }
    var eps = 1e-12 * (span || 1);
    for (i = 0; i < n - 1; i++) if (Math.abs(d[i]) <= eps) zero++;
    var stepped = zero >= 0.2 * (n - 1);
    if (!q && stepped) { // estimate the step from the non-zero differences
      var nzd = []; for (i = 0; i < n - 1; i++) if (Math.abs(d[i]) > eps) nzd.push(Math.abs(d[i]));
      if (nzd.length) { var srt = Float64Array.from(nzd).sort(); q = srt[Math.floor(0.1 * (srt.length - 1))]; }
    }
    var med = fmedian(d), mad = fmedian(d.map(function (v) { return Math.abs(v - med); })), sigma = 1.4826 * mad / Math.SQRT2, method = 'mad-diff';
    if (q) {
      if (!(sigma >= q / Math.sqrt(12))) { sigma = q / Math.sqrt(12); method = 'mad-diff+quantum'; }
      return { sigma: sigma, p2p: 6 * sigma, method: method, quantum: q };
    }
    if (!(sigma > 0)) { // degenerate data: fall back to non-robust SD of differences
      var s2 = 0; for (i = 0; i < d.length; i++) s2 += d[i] * d[i]; sigma = Math.sqrt(s2 / d.length) / Math.SQRT2;
    }
    return { sigma: sigma, p2p: 6 * sigma, method: method };
  };

  /* ---------------- peak detection ---------------- */
  // Walk from apex i toward lim until the (smoothed) signal returns to near the lowest level in that range
  // (return-to-baseline), else stop at that minimum (valley).
  function sideBound(ys, i, lim, sig) {
    var step = lim < i ? -1 : 1; if (lim === i) return i;
    var mi = argminDir(ys, i + step, lim), mn = ys[mi];
    var level = mn + Math.max(0.001 * (ys[i] - mn), 2 * sig), rise = Math.max(3 * sig, 0.01 * (ys[i] - mn)), rm = i;
    for (var j = i + step; j !== mi; j += step) {
      if (ys[j] <= level) return j;
      if (ys[j] < ys[rm]) rm = j; else if (ys[j] > ys[rm] + rise) return rm; // signal rises again: valley
    }
    return mi;
  }
  function argminDir(a, from, to) { return from <= to ? argmin(a, from, to) : argmin(a, to, from); }
  function autoWindow(n, dx, minWidth) {
    return minWidth > 0 ? Math.min(51, Math.max(5, odd(0.5 * minWidth / dx))) : Math.min(25, Math.max(5, odd(n / 500)));
  }
  function robustSD(a) { var med = fmedian(a); return 1.4826 * fmedian(Float64Array.from(a, function (v) { return Math.abs(v - med); })); }

  /** detectPeaks(x, y, {threshold:'auto'|number, minDist=0, minWidth=0, smooth?:pts, shoulders=true}) → Peak[]
      threshold = minimum prominence in y units; 'auto' = 9σ (S/N = 3 with h = 6σ). */
  A.detectPeaks = function (x, y, opts) {
    opts = opts || {};
    var n = y.length, i, j; if (n < 7) return mergeKeep([], opts.keep);
    var dx = (x[n - 1] - x[0]) / (n - 1), nz0 = A.noise(x, y, { quantum: opts.quantum }), sig = nz0.sigma || 0;
    var ymin = Infinity, ymax = -Infinity; for (i = 0; i < n; i++) { if (y[i] < ymin) ymin = y[i]; if (y[i] > ymax) ymax = y[i]; }
    var thr = (opts.threshold == null || opts.threshold === 'auto') ? Math.max(9 * sig, 1e-4 * (ymax - ymin)) : +opts.threshold;
    var minDist = +opts.minDist || 0, minWidth = +opts.minWidth || 0;
    var w = opts.smooth ? odd(opts.smooth) : autoWindow(n, dx, minWidth);
    var ys = n > w ? A.savitzkyGolay(y, w, 3) : toArr(y);

    // 1. local maxima of the smoothed signal (plateaus → centre)
    var cand = [];
    for (i = 1; i < n - 1; i++) {
      if (ys[i] > ys[i - 1]) { j = i; while (j < n - 1 && ys[j + 1] === ys[i]) j++; if (j < n - 1 && ys[j + 1] < ys[i]) cand.push((i + j) >> 1); i = j; }
    }
    // 2. topographic prominence and width at half prominence
    var found = [];
    cand.forEach(function (c) {
      var v = ys[c], lmin = v, rmin = v, k;
      for (k = c - 1; k >= 0 && ys[k] < v; k--) if (ys[k] < lmin) lmin = ys[k]; // ties (quantized data): an equal maximum to the left counts as higher
      for (k = c + 1; k < n && ys[k] <= v; k++) if (ys[k] < rmin) rmin = ys[k];
      var prom = v - Math.max(lmin, rmin); if (!(prom >= thr) || prom <= 0) return;
      var lev = v - prom / 2, l = c, r = c;
      while (l > 0 && ys[l] > lev) l--; while (r < n - 1 && ys[r] > lev) r++;
      if (x[r] - x[l] < minWidth) return;
      found.push({ i: c, prom: prom, hw: Math.max(1, (r - l) / 2) });
    });
    // 3. minimum distance: keep most prominent first
    if (minDist > 0) {
      found.sort(function (a, b) { return b.prom - a.prom; });
      var kept = [];
      found.forEach(function (f) { if (kept.every(function (k) { return Math.abs(x[k.i] - x[f.i]) >= minDist; })) kept.push(f); });
      found = kept;
    }
    found.sort(function (a, b) { return a.i - b.i; });

    // 4. shoulders: significant local minima of d²y with no local maximum, whose curvature lobe is separated
    //    from neighbouring apexes (d²y recovers at least half-way toward 0 in between).
    if (opts.shoulders !== false && found.length && n > 2 * w) {
      var w2 = Math.min(odd(1.5 * w), n % 2 ? n : n - 1), d2 = A.savitzkyGolay(y, w2, 3, 2), s2 = robustSD(d2), sh = [];
      // floor: the d²y scatter that white noise of SD σ alone produces (robust SD collapses on stepped/quantized data)
      var cc = sgCoeffs(w2, 3, 2)[(w2 - 1) / 2], g2 = 0; for (var kk = 0; kk < cc.length; kk++) g2 += cc[kk] * cc[kk];
      s2 = Math.max(s2, (nz0.quantum ? 1 : 0.5) * sig * Math.sqrt(g2));
      for (i = 2; i < n - 2; i++) {
        if (!(d2[i] < d2[i - 1] && d2[i] <= d2[i + 1] && d2[i] < -6 * s2)) continue;
        var near = false, okSep = true;
        for (j = 0; j < found.length; j++) {
          var a = found[j].i; if (Math.abs(a - i) <= w) { near = true; break; }
        }
        if (near) continue;
        var left = null, right = null;
        for (j = 0; j < found.length; j++) { if (found[j].i < i) left = found[j].i; else if (right === null) right = found[j].i; }
        [left, right].forEach(function (a) {
          if (a === null) return; var lo = Math.min(a, i) + 1, hi = Math.max(a, i) - 1, mx = -Infinity;
          for (var k = lo; k <= hi; k++) if (d2[k] > mx) mx = d2[k];
          if (!(mx > 0.5 * d2[i])) okSep = false;
        });
        if (!okSep) continue;
        var L = Math.max(0, i - 4 * w), R = Math.min(n - 1, i + 4 * w), floor = ys[argmin(ys, L, R)];
        if (ys[i] - floor < thr) continue;
        sh.push({ i: i, prom: ys[i] - floor, hw: w, shoulder: true });
      }
      // one shoulder per curvature lobe: keep the most negative d²y within ±2w
      sh.sort(function (a, b) { return d2[a.i] - d2[b.i]; });
      sh = sh.filter(function (c, k) { for (var q = 0; q < k; q++) if (Math.abs(sh[q].i - c.i) <= 2 * w && sh[q].keep !== false) { c.keep = false; return false; } return true; });
      found = found.concat(sh).sort(function (a, b) { return a.i - b.i; });
      if (minDist > 0) found = found.filter(function (f, k) { return !f.shoulder || ((k === 0 || x[f.i] - x[found[k - 1].i] >= minDist) && (k === found.length - 1 || x[found[k + 1].i] - x[f.i] >= minDist)); });
    }
    if (!found.length) return mergeKeep([], opts.keep);

    // 5. split points between consecutive apexes: valley (min of ys) or, if there is no valley (shoulder), the
    //    point of maximum d²y (perpendicular drop at the inflection region).
    var d2s = null, splits = [];
    for (j = 0; j < found.length - 1; j++) {
      var a0 = found[j].i, b0 = found[j + 1].i, vi = a0 + 1 < b0 ? argmin(ys, a0 + 1, b0 - 1) : a0;
      if (ys[vi] < Math.min(ys[a0], ys[b0]) && vi > a0 + 1 && vi < b0 - 1) splits.push({ i: vi, valley: true });
      else { d2s = d2s || A.savitzkyGolay(y, w, 3, 2); splits.push({ i: a0 + 1 < b0 ? argmax(d2s, a0 + 1, b0 - 1) : a0, valley: false }); }
    }
    // 6. bounds
    var out = found.map(function (f, k) {
      var cap = Math.max(3 * w, Math.round(20 * f.hw)), s, e;
      if (k > 0 && !splits[k - 1].valley) s = splits[k - 1].i;
      else s = sideBound(ys, f.i, k > 0 ? splits[k - 1].i : Math.max(0, f.i - cap), sig);
      if (k < found.length - 1 && !splits[k].valley) e = splits[k].i;
      else e = sideBound(ys, f.i, k < found.length - 1 ? splits[k].i : Math.min(n - 1, f.i + cap), sig);
      var pk = { id: PK.uid('pk'), start: x[s], apex: x[f.i], end: x[e], manual: false };
      if (f.shoulder) pk.shoulder = true;
      return pk;
    }).filter(function (p) { return p.end > p.start; });
    // never emit zero-height / negative-area peaks: a peak is kept if it is positive above its own bound-to-bound line
    // or above the common line of its group of (nearly) touching peaks — what drop integration uses — so shoulders and
    // riders on a tail are kept
    var g0 = 0;
    for (j = 0; j <= out.length; j++) {
      if (j < out.length && j > g0 && out[j].start > out[j - 1].end + Math.max(2 * dx, 0.5 * Math.min(out[j].end - out[j].start, out[j - 1].end - out[j - 1].start))) { markGroup(g0, j - 1); g0 = j; }
      if (j === out.length && out.length) markGroup(g0, j - 1);
    }
    function markGroup(a, b) { for (var q = a; q <= b; q++) out[q]._ok = netAbove(x, y, out[q]) > 0 || netAbove(x, y, out[q], out[a].start, out[b].end) > 0; }
    out = out.filter(function (p) { var ok = p._ok; delete p._ok; return ok; });
    return mergeKeep(out, opts.keep);
  };
  // Net height and area of y above the straight line joining the bounds; returns min(height, area) sign-wise (≤ 0 → reject).
  function netAbove(x, y, p, s0, e0) {
    var s = p.start, e = p.end; s0 = s0 == null ? s : s0; e0 = e0 == null ? e : e0;
    var y0 = U.interp1(x, y, s0), sl = (U.interp1(x, y, e0) - y0) / ((e0 - s0) || 1), yS = y0 + sl * (s - s0), h = -Infinity, ar = 0, px = s;
    var pv = U.interp1(x, y, s) - yS;
    for (var i = U.bsearch(x, s); i < x.length && x[i] <= e; i++) if (x[i] > s && x[i] < e) {
      var v = y[i] - (yS + sl * (x[i] - s)); if (v > h) h = v; ar += 0.5 * (v + pv) * (x[i] - px); px = x[i]; pv = v;
    }
    ar += 0.5 * (pv + U.interp1(x, y, e) - (yS + sl * (e - s))) * (e - px);
    return h > 0 && ar > 0 ? Math.min(h, ar) : 0;
  }
  // Preserve user/manual peaks unchanged; drop auto peaks whose [start,end] overlaps any kept peak.
  function mergeKeep(auto, keep) {
    if (!keep || !keep.length) return auto;
    var kept = keep.map(function (k) { var o = {}; for (var key in k) o[key] = k[key]; return o; });
    return kept.concat(auto.filter(function (a) {
      return kept.every(function (k) { return a.end <= Math.min(k.start, k.end) || a.start >= Math.max(k.start, k.end); });
    })).sort(function (a, b) { return a.apex - b.apex; });
  }

  /** peakAt(x, y, t, {window?, peaks?}) → Peak (manual) around the highest point within t ± window.
      peaks (optional existing peaks) limit the bounds at neighbouring apexes. */
  A.peakAt = function (x, y, t, opts) {
    opts = opts || {}; var n = y.length; if (n < 3) return null;
    var dx = (x[n - 1] - x[0]) / (n - 1), win = opts.window || Math.max(10 * dx, 0.01 * (x[n - 1] - x[0]));
    var ys = n > 7 ? A.savitzkyGolay(y, 5, 2) : toArr(y), sig = A.noise(x, y).sigma;
    var i0 = U.bsearch(x, t - win), i1 = Math.min(n - 1, U.bsearch(x, t + win) + 1), ap = argmax(ys, i0, i1);
    var limL = 0, limR = n - 1;
    (opts.peaks || []).forEach(function (p) { var ai = idxNear(x, p.apex); if (ai < ap && ai > limL) limL = ai; if (ai > ap && ai < limR) limR = ai; });
    var l = ap, r = ap, half = ys[ap] - (ys[ap] - Math.min(ys[limL], ys[limR])) / 2;
    while (l > limL && ys[l] > half) l--; while (r < limR && ys[r] > half) r++;
    var cap = Math.max(25, 20 * (r - l) / 2);
    var s = sideBound(ys, ap, Math.max(limL, Math.round(ap - cap)), sig), e = sideBound(ys, ap, Math.min(limR, Math.round(ap + cap)), sig);
    return { id: PK.uid('pk'), start: x[s], apex: x[ap], end: x[e], manual: true };
  };

  /** integrateWindow(x, y, start, end) → Peak {manual:true} with the exact user bounds; apex = sample max within
      [start,end] (peakMetrics refines it parabolically and integrates above the drop-line between y(start), y(end)). */
  A.integrateWindow = function (x, y, start, end) {
    var s = Math.min(start, end), e = Math.max(start, end), n = x.length, best = -Infinity, ap = (s + e) / 2;
    var yS = U.interp1(x, y, s), yE = U.interp1(x, y, e), sl = e > s ? (yE - yS) / (e - s) : 0;
    for (var i = U.bsearch(x, s); i < n && x[i] <= e; i++) if (x[i] >= s) { var v = y[i] - (yS + sl * (x[i] - s)); if (v > best) { best = v; ap = x[i]; } }
    return { id: PK.uid('pk'), start: s, apex: ap, end: e, manual: true };
  };

  /** refineBounds(x, y, peak, {window?}) → copy of peak (manual peaks returned unchanged) with start/end snapped to the local minimum of the
      lightly smoothed signal within ±window (default 15% of peak width) and apex re-located. */
  A.refineBounds = function (x, y, peak, opts) {
    opts = opts || {}; var k0, cp = {};
    if (peak.manual) { for (k0 in peak) cp[k0] = peak[k0]; return cp; } // user-set bounds are never moved
    var n = y.length, ys = n > 7 ? A.savitzkyGolay(y, 5, 2) : toArr(y);
    var s = idxNear(x, peak.start), e = idxNear(x, peak.end), ap = idxNear(x, peak.apex);
    var dx = (x[n - 1] - x[0]) / (n - 1), wp = Math.max(2, Math.round((opts.window || 0.15 * (peak.end - peak.start)) / dx));
    if (!(ap > s && ap < e)) ap = argmax(ys, s, e);
    s = argmin(ys, Math.max(0, s - wp), Math.max(Math.max(0, s - wp), Math.min(s + wp, ap - 1)));
    e = argmin(ys, Math.min(n - 1, Math.max(e - wp, ap + 1)), Math.min(n - 1, e + wp));
    ap = argmax(ys, s, e);
    var out = {}; for (var k in peak) out[k] = peak[k];
    out.start = x[s]; out.end = x[e]; out.apex = x[ap];
    return out;
  };

  /* ---------------- peak metrics ---------------- */
  // Interpolated crossing of level walking from index k in direction dir; null if not reached.
  function crossing(X, Y, k, level, dir) {
    for (var j = k; j + dir >= 0 && j + dir < X.length; j += dir) {
      var a = Y[j], b = Y[j + dir];
      if (b <= level) return X[j] + (X[j + dir] - X[j]) * (a - level) / ((a - b) || 1);
    }
    return null;
  }
  function metricsOne(x, y, pk, nz, t0, reg) {
    var s = Math.min(pk.start, pk.end), e = Math.max(pk.start, pk.end), n = x.length, i, X, Y, m, area, f = {}, out;
    if (reg) { // region from integrate(): signal (or fitted component) above the applied baseline
      X = reg.X; Y = reg.Y; m = X.length; area = reg.area;
      out = { id: pk.id, start: s, end: e, area: area, formulas: f, clip: reg.clip, math: reg.math };
      var mt = reg.math || {};
      f.area = F(mt.formula || 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·Δtᵢ', { clip: reg.clip, t_start: mt.tStart, t_end: mt.tEnd, y_start: mt.yStart, y_end: mt.yEnd,
        nPoints: mt.n, grossArea: mt.grossArea, baselineArea: mt.baselineArea }, area, (mt.method ? mt.method + '. ' : '') + ((mt.notes || [])[0] || '') + ' Units: y-unit·min (×60 for y-unit·s).', 'y·min');
    } else {
      var yS = U.interp1(x, y, s), yE = U.interp1(x, y, e), slope = e > s ? (yE - yS) / (e - s) : 0;
      X = [s]; Y = [0]; // signal above the straight drop-line baseline through the two bound points
      for (i = U.bsearch(x, s); i < n && x[i] < e; i++) if (x[i] > s) { X.push(x[i]); Y.push(y[i] - (yS + slope * (x[i] - s))); }
      X.push(e); Y.push(0);
      m = X.length; area = 0; for (i = 0; i < m - 1; i++) area += 0.5 * (Y[i] + Y[i + 1]) * (X[i + 1] - X[i]);
      out = { id: pk.id, start: s, end: e, area: area, formulas: f };
      f.area = F('A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·(xᵢ₊₁−xᵢ), b = straight line through (t_start, y_start)–(t_end, y_end)',
        { t_start: s, t_end: e, y_start: yS, y_end: yE, nPoints: m }, area, 'Trapezoid integration above a drop-line baseline. Units: y-unit·min (×60 for y-unit·s).', 'y·min');
    }
    // apex by 3-point parabolic interpolation (non-uniform spacing aware)
    var k = argmax(Y, 0, m - 1), rt = X[k], H = Y[k], pa = null;
    if (k > 0 && k < m - 1) {
      var u0 = X[k - 1] - X[k], u2 = X[k + 1] - X[k], d0 = Y[k - 1] - Y[k], d2 = Y[k + 1] - Y[k], det = u0 * u2 * (u0 - u2);
      var qa = (d0 * u2 - d2 * u0) / det, qb = (u0 * u0 * d2 - u2 * u2 * d0) / det;
      if (qa < 0) { var us = -qb / (2 * qa); if (us >= u0 && us <= u2) { rt = X[k] + us; H = Y[k] - qb * qb / (4 * qa); pa = { a: qa, b: qb }; } }
    }
    out.rt = rt; out.height = H;
    f.rt = F('t_R = x_k − b/(2a), parabola y = a·u² + b·u + y_k through the apex sample and its neighbours',
      { x_k: X[k], y_k: Y[k], a: pa ? pa.a : null, b: pa ? pa.b : null }, rt, pa ? 'Parabolic interpolation of the apex.' : 'Apex at sample maximum (no parabolic refinement possible).', 'min');
    f.height = F('H = y(t_R) − b(t_R)', { t_R: rt, apexSample: Y[k] }, H, 'Height above the drop-line baseline at the interpolated apex.', 'y');
    // widths at fractions of height
    function W(fr) { var l = crossing(X, Y, k, fr * H, -1), r = crossing(X, Y, k, fr * H, 1); return { l: l, r: r, w: l != null && r != null ? r - l : null }; }
    var w50 = W(0.5), w10 = W(0.1), w05 = W(0.05);
    out.fwhm = w50.w; out.w10 = w10.w; out.w5 = w05.w;
    var nr = ' Null if the level is not reached inside the integration bounds.';
    f.fwhm = F('W½ = t_right(H/2) − t_left(H/2), linear interpolation between samples', { H: H, t_left: w50.l, t_right: w50.r }, w50.w, 'Full width at half maximum.' + nr, 'min');
    f.w5 = F('W₀.₀₅ = t_right(0.05H) − t_left(0.05H)', { H: H, t_left: w05.l, t_right: w05.r }, w05.w, 'Width at 5% height (USP tailing).' + nr, 'min');
    var fr5 = w05.l != null ? rt - w05.l : null;
    out.tailing = w05.w != null && fr5 > 0 ? w05.w / (2 * fr5) : null;
    f.tailing = F('T = W₀.₀₅ / (2f), f = t_R − t_left(0.05H)', { W005: w05.w, f: fr5 }, out.tailing, 'USP <621> tailing factor (= Ph. Eur. symmetry factor). 1 = symmetric, >1 tailing.');
    var aa = w10.l != null ? rt - w10.l : null, bb = w10.r != null ? w10.r - rt : null;
    out.asymmetry = aa > 0 && bb != null ? bb / aa : null;
    f.asymmetry = F('A_s = b/a at 10% height; a = t_R − t_left, b = t_right − t_R', { a: aa, b: bb }, out.asymmetry, 'Asymmetry factor at 10% height.');
    out.plates = w50.w > 0 ? 5.54 * Math.pow(rt / w50.w, 2) : null;
    f.plates = F('N = 5.54·(t_R / W½)²', { t_R: rt, W_half: w50.w }, out.plates, 'Half-height method (USP/Ph. Eur.; 5.54 ≈ 8·ln2). Assumes a Gaussian peak; t_R measured from injection.');
    // USP tangent method: tangents at the inflection points (max |slope|), intercepts with baseline
    out.platesUSP = null; var tw = null, tl = null, tr = null;
    if (m >= 7 && w50.w > 0) {
      var dxl = (X[m - 2] - X[1]) / Math.max(1, m - 3), fp = Math.max(5, Math.min(odd(w50.w / dxl / 4), m % 2 ? m : m - 1));
      var Ys = A.savitzkyGolay(Y, fp, 3), dY = A.savitzkyGolay(Y, fp, 4, 1, dxl), iL = argmax(dY, 0, k), iR = argmin(dY, k, m - 1);
      if (dY[iL] > 0 && dY[iR] < 0) {
        tl = X[iL] - Ys[iL] / dY[iL]; tr = X[iR] - Ys[iR] / dY[iR]; tw = tr - tl;
        if (tw > 0) out.platesUSP = 16 * Math.pow(rt / tw, 2);
      }
    }
    out.tangentWidth = tw;
    f.platesUSP = F('N = 16·(t_R / W)², W = baseline intercepts of tangents at the inflection points', { t_R: rt, W: tw, t_left: tl, t_right: tr }, out.platesUSP, 'USP tangent method; slopes from a Savitzky–Golay derivative of the baseline-corrected peak.');
    out.k = t0 > 0 ? (rt - t0) / t0 : null;
    f.k = F("k = (t_R − t₀) / t₀", { t_R: rt, t0: t0 || null }, out.k, t0 > 0 ? 'Retention factor.' : 'Requires a void time t₀.');
    out.sn = nz.p2p > 0 ? 2 * H / nz.p2p : null;
    f.sn = F('S/N = 2H / h', { H: H, h: nz.p2p, sigma: nz.sigma, noiseMethod: nz.method }, out.sn,
      nz.method === 'p2p-range' ? 'Ph. Eur. 2.2.46: h = measured peak-to-peak noise in the chosen blank range.' : 'Ph. Eur. 2.2.46 / USP form with h = 6σ (σ = robust noise SD), i.e. S/N = H/(3σ).');
    out.resolution = null; out.areaPct = null;
    return out;
  }
  /** peakMetrics(x, y, peaks, {voidTime?, noise?: σ number | {sigma,p2p,method}, integration?, baselines?, clip?, skimRatio?, model?})
      → Metric[] aligned with peaks.
      Baseline used for area/height/widths (first that applies):
        opts.integration — the array returned by integrate() (matched by id, else by index);
        peaks themselves being integrate() results (objects carrying .math and .segments);
        opts.baselines — { [peakId]: [[t,y],...] } or an array aligned with peaks: polyline baseline per peak;
        opts.clip — integrate(x, y, peaks, {clip, skimRatio, model}) is run internally;
        otherwise the original behaviour: straight line between y(start) and y(end) of each peak. */
  A.peakMetrics = function (x, y, peaks, opts) {
    opts = opts || {}; peaks = peaks || [];
    var nz = opts.noise == null ? A.noise(x, y) : typeof opts.noise === 'number' ? { sigma: opts.noise, p2p: 6 * opts.noise, method: 'user σ' }
      : { sigma: opts.noise.sigma, p2p: opts.noise.p2p != null ? opts.noise.p2p : 6 * opts.noise.sigma, method: opts.noise.method || 'user' };
    var t0 = fin(opts.voidTime) && opts.voidTime > 0 ? opts.voidTime : null;
    var integ = opts.integration || null;
    if (!integ && peaks.length && peaks.every(function (p) { return p && p.math && p.segments; })) integ = peaks;
    if (!integ && !opts.baselines && opts.clip) integ = A.integrate(x, y, peaks, { clip: opts.clip, skimRatio: opts.skimRatio, model: opts.model, noise: nz });
    var byId = {}; if (integ) integ.forEach(function (r) { if (r && r.id != null) byId[r.id] = r; });
    var ms = peaks.map(function (p, i) {
      var reg = null;
      if (integ) { var r = byId[p.id] || integ[i]; if (r && r.segments && r.segments[0]) reg = regionOf(r); }
      else if (opts.baselines) { var bp = Array.isArray(opts.baselines) ? opts.baselines[i] : opts.baselines[p.id]; if (bp && bp.length) reg = regionFromBaseline(x, y, p, bp); }
      if (p.math && p.segments && (p.start == null || p.end == null)) p = { id: p.id, start: p.math.tStart, end: p.math.tEnd, apex: p.apex };
      return metricsOne(x, y, p, nz, t0, reg);
    });
    ms.forEach(function (m) { // flag (never silently drop: output stays aligned with the input peaks)
      m.flags = [];
      if (!(m.height > 0)) m.flags.push('nonPositiveHeight');
      if (!(m.area > 0)) m.flags.push('nonPositiveArea');
      m.valid = !m.flags.length;
      if (!m.valid) m.warning = 'Peak has ' + (m.height > 0 ? 'a non-positive net area' : 'no height above its baseline') + ': check bounds/baseline; excluded from Area%.';
    });
    var tot = 0; ms.forEach(function (m) { if (m.valid) tot += m.area; });
    ms.forEach(function (m) {
      m.areaPct = tot && m.valid ? 100 * m.area / tot : null;
      m.formulas.areaPct = F('Area% = 100·Aᵢ / ΣA', { A_i: m.area, sumA: tot, nPeaks: ms.length }, m.areaPct, 'Relative to the sum of all integrated peaks with positive height and area (no response factors).', '%');
    });
    var order = ms.map(function (m, i) { return i; }).sort(function (a, b) { return ms[a].rt - ms[b].rt; });
    order.forEach(function (idx, j) {
      var m = ms[idx];
      if (!j) { m.formulas.resolution = F('R_s = 1.18·(t_R2 − t_R1)/(W½,1 + W½,2)', {}, null, 'First peak: no preceding peak.'); return; }
      var p = ms[order[j - 1]], ok = m.fwhm > 0 && p.fwhm > 0;
      m.resolution = ok ? 1.18 * (m.rt - p.rt) / (m.fwhm + p.fwhm) : null;
      m.formulas.resolution = F('R_s = 1.18·(t_R2 − t_R1)/(W½,1 + W½,2)', { t_R1: p.rt, t_R2: m.rt, W_half1: p.fwhm, W_half2: m.fwhm, previousId: p.id }, m.resolution,
        'Half-height resolution vs the preceding peak in retention order (USP/Ph. Eur.; 1.18 ≈ 2√(2ln2)/2). Assumes Gaussian peaks.');
    });
    return ms;
  };

  /* ---------------- integration modes ("peak clipping") ---------------- */
  // Definitions follow the usual chromatography-data-system vocabulary (Dyson, "Chromatographic Integration
  // Methods", RSC). Every result carries an auditable `math` object; see docs/INTEGRATION.md.
  var CLIP_MODES = ['drop', 'valley', 'baseline', 'skim-tangent', 'skim-exp', 'fit'];
  var CLIP_LABELS = {
    drop: 'Perpendicular drop to a common baseline', valley: 'Valley-to-valley', baseline: 'Baseline-to-baseline (common baseline, no penetration)',
    'skim-tangent': 'Tangent skim', 'skim-exp': 'Exponential skim', fit: 'Deconvolution (peak fit)'
  };
  A.CLIP_MODES = CLIP_MODES.slice();
  A.CLIP_LABELS = CLIP_LABELS;

  function lineFn(t0, y0, t1, y1) { var s = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0; return function (t) { return y0 + s * (t - t0); }; }
  function polyFn(pts) {
    var xs = pts.map(function (p) { return +p[0]; }), ys = pts.map(function (p) { return +p[1]; });
    return function (t) { return xs.length === 1 ? ys[0] : U.interp1(xs, ys, t); };
  }
  // integration nodes: exact (possibly off-grid) bounds plus every sample strictly inside
  function gridNodes(x, s, e, extra) {
    var X = [s], n = x.length, i;
    for (i = U.bsearch(x, s); i < n && x[i] < e; i++) if (x[i] > s) X.push(+x[i]);
    if (e > s) X.push(e);
    if (extra && extra.length) {
      extra.forEach(function (t) { if (t > s && t < e) X.push(t); });
      X.sort(function (a, b) { return a - b; });
      X = X.filter(function (t, k) { return !k || t > X[k - 1]; });
    }
    return X;
  }
  function trapz(X, Y) { var a = 0; for (var i = 0; i < X.length - 1; i++) a += 0.5 * (Y[i] + Y[i + 1]) * (X[i + 1] - X[i]); return a; }
  function f4(v) { return U.fmt ? U.fmt(v, 4) : String(v); }
  function pt(t, v) { return '(' + f4(t) + ', ' + f4(v) + ')'; }
  // monotone-chain lower convex hull of (T[i], Y[i]), T ascending → [[t,y],...]
  function lowerHull(T, Y) {
    var h = [];
    for (var i = 0; i < T.length; i++) {
      while (h.length >= 2) {
        var a = h[h.length - 2], b = h[h.length - 1];
        if ((T[b] - T[a]) * (Y[i] - Y[a]) - (Y[b] - Y[a]) * (T[i] - T[a]) <= 0) h.pop(); else break;
      }
      h.push(i);
    }
    return h.map(function (k) { return [T[k], Y[k]]; });
  }
  function makeCtx(x, y, opts) {
    var n = x.length, w = opts.smooth ? odd(opts.smooth) : Math.min(15, Math.max(5, odd(n / 800)));
    var ys = n > w + 2 ? A.savitzkyGolay(y, w, 2) : toArr(y);
    var nz = opts.noise == null ? (n > 3 ? A.noise(x, y) : { sigma: 0 }) : typeof opts.noise === 'number' ? { sigma: opts.noise } : opts.noise;
    return { x: x, y: y, ys: ys, n: n, sig: nz.sigma || 0, dt: n > 1 ? (x[n - 1] - x[0]) / (n - 1) : 0, opts: opts, smoothW: w };
  }
  function yAt(c, t) { return U.interp1(c.x, c.y, t); }
  function ysAt(c, t) { return U.interp1(c.x, c.ys, t); }
  function boundsOf(p) { return [Math.min(p.start, p.end), Math.max(p.start, p.end)]; }
  // max of (smoothed signal − baseline fn) over [s,e] → { h, t }
  function heightAbove(c, s, e, fn) {
    var best = -Infinity, at = (s + e) / 2, x = c.x;
    for (var j = U.bsearch(x, s); j < c.n && x[j] <= e; j++) if (x[j] >= s) { var v = c.ys[j] - fn(x[j]); if (v > best) { best = v; at = x[j]; } }
    if (best === -Infinity) { best = ysAt(c, at) - fn(at); }
    return { h: Math.max(0, best), t: at };
  }
  // time of the minimum of the smoothed signal within [t0, t1] (t0 if the interval holds no sample)
  function valleyT(c, t0, t1) {
    var lo = Math.min(t0, t1), hi = Math.max(t0, t1), best = lo, bv = ysAt(c, lo), x = c.x;
    for (var j = U.bsearch(x, lo); j < c.n && x[j] <= hi; j++) if (x[j] >= lo && c.ys[j] < bv) { bv = c.ys[j]; best = x[j]; }
    if (ysAt(c, hi) < bv) best = hi;
    return best;
  }
  function modeOf(p, opts) {
    var m = opts.force ? opts.clip : (p.clip || (p.manual ? 'valley' : (opts.clip || 'drop')));
    return CLIP_MODES.indexOf(m) >= 0 ? m : 'drop';
  }

  function clustersCtx(c, peaks, opts) {
    var frac = opts.valleyFrac == null ? 0.02 : +opts.valleyFrac, tol = (opts.gapTol == null ? 1.5 : +opts.gapTol) * c.dt;
    var ord = peaks.map(function (p, i) { return i; }).filter(function (i) { var b = boundsOf(peaks[i]); return fin(b[0]) && fin(b[1]); })
      .sort(function (a, b) { return boundsOf(peaks[a])[0] - boundsOf(peaks[b])[0] || peaks[a].apex - peaks[b].apex; });
    var out = [], cur = null, curEnd = -Infinity;
    ord.forEach(function (i) {
      var b = boundsOf(peaks[i]);
      if (cur) {
        var j = cur[cur.length - 1], a = boundsOf(peaks[j]), fused = false;
        if (b[0] < curEnd - tol) fused = true; // overlapping bounds
        else if (b[0] <= curEnd + Math.max(tol, 0.5 * Math.min(a[1] - a[0], b[1] - b[0]))) {
          // touching (or nearly touching) bounds: fused only if the signal between them stays above the common line
          var L = lineFn(a[0], yAt(c, a[0]), b[1], yAt(c, b[1])), tv = valleyT(c, curEnd, b[0]);
          var hv = ysAt(c, tv) - L(tv), ha = heightAbove(c, a[0], a[1], L).h, hb = heightAbove(c, b[0], b[1], L).h;
          fused = hv > frac * Math.min(ha, hb);
        }
        if (fused) { cur.push(i); curEnd = Math.max(curEnd, b[1]); return; }
      }
      cur = [i]; out.push(cur); curEnd = b[1];
    });
    return out;
  }
  /** clusters(x, y, peaks, {valleyFrac=0.02, gapTol=1.5 samples}) → [[peakIdx, ...], ...] in time order (singletons included).
      Two neighbouring peaks are fused when their bounds overlap, or when they touch (gap ≤ gapTol·Δt) and the signal at
      the shared bound lies above the straight line from the first start to the second end by more than
      valleyFrac × the smaller peak height. */
  A.clusters = function (x, y, peaks, opts) { opts = opts || {}; return clustersCtx(makeCtx(x, y, opts), peaks || [], opts); };

  // ---- skim geometry ----
  // Tangent from the valley (t_v, y_v) to the parent's tail (dir=+1) or front (dir=−1): the supporting line through the
  // valley with min (tail) / max (front) slope over the samples between the rider apex and `limit`.
  function skimTangent(c, v, dir, apexT, limitT) {
    var yv = ysAt(c, v), x = c.x, lo = Math.min(apexT, limitT), hi = Math.max(apexT, limitT), best = null, bt = limitT, by = ysAt(c, limitT);
    function consider(t, val) { var m = (val - yv) / (t - v); if (best === null || (dir > 0 ? m < best : m > best)) { best = m; bt = t; by = val; } }
    for (var j = U.bsearch(x, lo); j < c.n && x[j] <= hi; j++) if (x[j] > lo && x[j] < hi) consider(x[j], c.ys[j]);
    consider(limitT, ysAt(c, limitT));
    var m = best, fn = function (t) { return yv + m * (t - v); };
    return {
      kind: 'tangent', fn: fn, t0: dir > 0 ? v : bt, t1: dir > 0 ? bt : v, params: { valley: [v, yv], touch: [bt, by], slope: m },
      steps: [{ label: 'Valley point (t_v, y_v)', expr: 'y_v = ỹ(t_v), ỹ = smoothed signal', value: yv },
        { label: 'Tangent point t*', expr: dir > 0 ? 't* = argmin_j (ỹ_j − y_v)/(t_j − t_v), t_j after rider apex' : 't* = argmax_j (ỹ_j − y_v)/(t_j − t_v), t_j before rider apex', value: bt },
        { label: 'Tangent slope m', expr: 'm = (ỹ(t*) − y_v)/(t* − t_v)', value: m }],
      formula: 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·Δtᵢ,  b(t) = y_v + m·(t − t_v) (tangent from the valley to the parent ' + (dir > 0 ? 'tail' : 'front') + ')',
      describe: 'a straight tangent line from the valley ' + pt(v, yv) + ' to the point where it touches the parent ' + (dir > 0 ? 'tail' : 'front') + ' at ' + pt(bt, by)
    };
  }
  // Exponential skim: ln(ỹ − c) fitted (weights z²) on the parent side of the valley, extrapolated under the rider.
  function skimExp(c, v, dir, hostApexT, hostH, riderApexT, riderH, limitT, CL) {
    var x = c.x, j;
    // rider σ from its far flank (away from the parent): half-height crossing of ỹ above a line through the valley
    // (reference = the tangent-skim line, which follows the parent tail closely around the rider)
    var yv = ysAt(c, v), hwT = null, ka = idxNear(x, riderApexT), Lr = skimTangent(c, v, dir, riderApexT, limitT).fn, lvl = (c.ys[ka] - Lr(x[ka])) / 2;
    for (j = ka; j >= 0 && j < c.n; j += dir) { if ((dir > 0 ? x[j] > limitT : x[j] < limitT)) break; if (c.ys[j] - Lr(x[j]) <= lvl) { hwT = Math.abs(x[j] - riderApexT); break; } }
    var sr = Math.max(hwT != null ? hwT / 1.1774 : Math.abs(riderApexT - v) / 2.5, 2 * c.dt);
    // fit window: parent tail/front ending 4σ_r before the rider apex (or at the valley, whichever is nearer the parent),
    // spanning (expFitSpan=16)·σ_r towards the parent apex
    var bEnd = dir > 0 ? Math.min(v, riderApexT - 4 * sr) : Math.max(v, riderApexT + 4 * sr), span = (c.opts.expFitSpan || 16) * sr;
    var a = dir > 0 ? Math.max(hostApexT, bEnd - span) : bEnd, b = dir > 0 ? bEnd : Math.min(hostApexT, bEnd + span);
    var floor = Math.max(3 * c.sig, 1e-3 * hostH), S0 = 0, S1 = 0, S2 = 0, T0 = 0, T1 = 0, used = 0, ta = Infinity, tb = -Infinity, FU = [], FZ = [];
    for (j = U.bsearch(x, Math.min(a, b)); j < c.n && x[j] <= Math.max(a, b); j++) {
      if (x[j] < Math.min(a, b)) continue;
      var z = c.ys[j] - CL(x[j]); if (!(z > floor && z <= 0.5 * hostH)) continue;
      var w = z * z, u = x[j] - v, l = Math.log(z);
      S0 += w; S1 += w * u; S2 += w * u * u; T0 += w * l; T1 += w * u * l; used++; ta = Math.min(ta, x[j]); tb = Math.max(tb, x[j]);
      FU.push(u); FZ.push(z);
    }
    var det = S0 * S2 - S1 * S1; if (used < 4 || !(det > 0)) return null;
    var beta = (S0 * T1 - S1 * T0) / det, alpha = (T0 - beta * S1) / S0;
    if (!(beta * dir < 0)) return null; // must decay away from the parent
    // refine: z ≈ z₀·exp(β u) + c₀ by separable least squares (linear in z₀, c₀; golden-section search on ln τ).
    // The constant c₀ absorbs a common baseline that ends on the parent's tail instead of at the true baseline.
    function sepLS(bt) {
      var s11 = 0, s12 = 0, s22 = FU.length, r1 = 0, r2 = 0, q, e;
      for (q = 0; q < FU.length; q++) { e = Math.exp(bt * FU[q]); s11 += e * e; s12 += e; r1 += e * FZ[q]; r2 += FZ[q]; }
      var dd = s11 * s22 - s12 * s12; if (!(dd > 0)) return null;
      var zz = (r1 * s22 - r2 * s12) / dd, cc = (s11 * r2 - s12 * r1) / dd, rss = 0;
      for (q = 0; q < FU.length; q++) { e = FZ[q] - zz * Math.exp(bt * FU[q]) - cc; rss += e * e; }
      return { z0: zz, c0: cc, rss: rss };
    }
    var tau0 = -1 / (beta * dir), lo = Math.log(tau0 / 5), hi = Math.log(tau0 * 5), gr = (Math.sqrt(5) - 1) / 2, c0 = 0, z0 = Math.exp(alpha), tau = tau0;
    var ev = function (lt) { var r = sepLS(-dir / Math.exp(lt)); return r && r.z0 > 0 ? r.rss : Infinity; };
    if (c.opts.expOffset !== false && used >= 8) {
      var g1 = hi - gr * (hi - lo), g2 = lo + gr * (hi - lo), f1 = ev(g1), f2 = ev(g2);
      for (var it = 0; it < 80 && hi - lo > 1e-7; it++) { if (f1 < f2) { hi = g2; g2 = g1; f2 = f1; g1 = hi - gr * (hi - lo); f1 = ev(g1); } else { lo = g1; g1 = g2; f1 = f2; g2 = lo + gr * (hi - lo); f2 = ev(g2); } }
      var lt = (lo + hi) / 2, best = sepLS(-dir / Math.exp(lt));
      if (best && best.z0 > 0 && isFinite(ev(lt))) { tau = Math.exp(lt); beta = -dir / tau; z0 = best.z0; c0 = best.c0; }
    }
    var fn = function (t) { return CL(t) + z0 * Math.exp(beta * (t - v)) + c0; };
    var tol = Math.max(0.5 * c.sig, 0.002 * riderH);
    // rider end: first sample past the apex (away from the parent) where ỹ meets the curve; start: walk from the apex
    // towards the parent until ỹ meets the curve (not beyond the fit window)
    function meet(from, to, d) {
      for (var k = U.bsearch(x, from); k >= 0 && k < c.n; k += d) {
        if (d > 0 ? x[k] <= from : x[k] >= from) continue;
        if (d > 0 ? x[k] >= to : x[k] <= to) return to;
        if (c.ys[k] - fn(x[k]) <= tol) return x[k];
      }
      return to;
    }
    var te = meet(riderApexT, limitT, dir), ts = meet(riderApexT, bEnd, -dir);
    return {
      kind: 'exponential', fn: fn, t0: dir > 0 ? ts : te, t1: dir > 0 ? te : ts,
      params: { valley: [v, yv], tau: tau, z0: z0, c0: c0, fitRange: [ta, tb], fitPoints: used, start: ts, end: te, riderSigma: sr },
      steps: [{ label: 'Rider σ estimate', expr: 'σ_r = half-width at half height on the far flank / 1.1774', value: sr },
        { label: 'Tail fit points', expr: 'parent ' + (dir > 0 ? 'tail' : 'front') + ' samples ending 4σ_r before the rider apex, spanning 16σ_r, with 3σ < ỹ − c ≤ H_parent/2', value: used },
        { label: 'Fit range start', expr: 't_a', value: ta }, { label: 'Fit range end', expr: 't_b', value: tb },
        { label: 'Decay constant τ', expr: 'ỹ − c = z₀·exp(∓(t − t_v)/τ) + c₀ by least squares (start: log-linear fit), τ = 1/|β|', value: tau },
        { label: 'Parent excess at valley', expr: 'z₀ (fitted, not forced through the valley)', value: z0 },
        { label: 'Offset c₀', expr: 'constant absorbing a common baseline that ends on the parent tail', value: c0 },
        { label: 'Skim start', expr: 'where ỹ − b ≤ max(σ/2, 0.2 % H_rider) walking from the rider apex towards the parent', value: dir > 0 ? ts : te },
        { label: 'Skim end', expr: 'where ỹ − b ≤ max(σ/2, 0.2 % H_rider) walking away from the parent', value: dir > 0 ? te : ts }],
      formula: 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·Δtᵢ,  b(t) = c(t) + z₀·exp(' + (dir > 0 ? '−' : '+') + '(t − t_v)/τ) + c₀, c = common baseline',
      describe: 'an exponential curve (τ = ' + f4(tau) + ' min) fitted to the parent ' + (dir > 0 ? 'tail' : 'front') + ' between ' + f4(ta) + ' and ' + f4(tb) + ' min and extrapolated under the rider'
    };
  }

  function buildMath(c, clip, X, Up, Lo, info) {
    var gross = trapz(X, Up), base = trapz(X, Lo), net = gross - base, m = X.length;
    if (info.netOverride != null) { net = info.netOverride; gross = base + net; }
    var steps = [
      { label: 'Integration start', expr: 't_start', value: X[0] },
      { label: 'Integration end', expr: 't_end', value: X[m - 1] },
      { label: 'Number of points', expr: 'n (samples inside + the two exact bounds)', value: m },
      { label: 'Sampling interval', expr: 'Δt = (t_last − t_first)/(N − 1) of the trace', value: c.dt },
      { label: 'Baseline at start', expr: 'b(t_start)', value: Lo[0] },
      { label: 'Baseline at end', expr: 'b(t_end)', value: Lo[m - 1] }
    ].concat(info.steps || []).concat(info.netOverride != null ? [
      { label: 'Baseline area', expr: 'B = Σ ½(bᵢ + bᵢ₊₁)·Δtᵢ', value: base },
      { label: 'Net area (model)', expr: 'A = A_fit·σ·√(2π)', value: net },
      { label: 'Gross area', expr: 'G = B + A (model-based; G − B = A)', value: gross }
    ] : [
      { label: 'Gross area', expr: 'G = Σ ½(yᵢ + yᵢ₊₁)·Δtᵢ' + (info.upperNote ? ' (' + info.upperNote + ')' : ''), value: gross },
      { label: 'Baseline area', expr: 'B = Σ ½(bᵢ + bᵢ₊₁)·Δtᵢ', value: base },
      { label: 'Net area', expr: 'A = G − B', value: net }
    ]);
    var notes = [(info.lead || 'Area under the curve') + ' between ' + f4(X[0]) + ' and ' + f4(X[m - 1]) + ' min, minus the area under ' + info.describe + '.']
      .concat(['Trapezoid rule over ' + m + ' points (Δt ≈ ' + f4(c.dt) + ' min): gross ' + f4(gross) + ' − baseline ' + f4(base) + ' = net ' + f4(net) + ' y-unit·min (×60 for y-unit·s).'])
      .concat(info.notes || []);
    return {
      method: CLIP_LABELS[clip] + (info.methodSuffix || ''), clip: clip, formula: info.formula, steps: steps, n: m, dt: c.dt,
      tStart: X[0], tEnd: X[m - 1], yStart: Lo[0], yEnd: Lo[m - 1], signalStart: Up[0], signalEnd: Up[m - 1],
      grossArea: gross, baselineArea: base, netArea: net, notes: notes
    };
  }
  function sampleCurve(X, fn) { return X.map(function (t) { return [t, fn(t)]; }); }

  // Integrate one cluster (indices into peaks) and write results into res[].
  function integrateCluster(c, peaks, idxs, ci, res) {
    var o = c.opts, R = o.skimRatio == null ? 10 : +o.skimRatio, x = c.x;
    var P = idxs.slice().sort(function (a, b) { return (peaks[a].apex != null ? peaks[a].apex : boundsOf(peaks[a])[0]) - (peaks[b].apex != null ? peaks[b].apex : boundsOf(peaks[b])[0]); });
    var K = P.length, S = [], E = [], k, j;
    P.forEach(function (i, q) { var b = boundsOf(peaks[i]); S[q] = b[0]; E[q] = b[1]; });
    var joinNotes = P.map(function () { return []; });
    for (k = 0; k < K - 1; k++) { // gap between neighbouring automatic peaks inside a cluster: join both bounds at the valley
      if (E[k] < S[k + 1] && !peaks[P[k]].manual && !peaks[P[k + 1]].manual) {
        var tj = valleyT(c, E[k], S[k + 1]);
        joinNotes[k].push('End bound moved from ' + f4(E[k]) + ' to the valley at ' + f4(tj) + ' min to meet the next peak of the cluster.');
        joinNotes[k + 1].push('Start bound moved from ' + f4(S[k + 1]) + ' to the valley at ' + f4(tj) + ' min to meet the previous peak of the cluster.');
        E[k] = tj; S[k + 1] = tj;
      }
    }
    var cs = Math.min.apply(null, S), ce = Math.max.apply(null, E), ycs = yAt(c, cs), yce = yAt(c, ce), CL = lineFn(cs, ycs, ce, yce);
    var H = [], AP = [], Hown = [];
    for (k = 0; k < K; k++) {
      var ha = heightAbove(c, S[k], E[k], CL), ho = heightAbove(c, S[k], E[k], lineFn(S[k], ysAt(c, S[k]), E[k], ysAt(c, E[k]))), pa = peaks[P[k]].apex;
      H[k] = ha.h; Hown[k] = ho.h;
      // apex: the peak's own apex if inside its bounds, else the maximum above its own valley line (on a sloping tail the
      // maximum above the common line can sit at the rider's start)
      AP[k] = fin(pa) && pa > S[k] && pa < E[k] ? +pa : ho.t;
    }
    var modes = P.map(function (i) { return modeOf(peaks[i], o); }), notes = joinNotes, applied = modes.slice();
    var clDesc = 'the common cluster baseline from ' + pt(cs, ycs) + ' to ' + pt(ce, yce);

    // 1. riders (Dyson criterion: skim only if H_parent / H_rider ≥ skimRatio)
    var host = []; for (k = 0; k < K; k++) host.push(-1);
    for (k = 0; k < K; k++) {
      if (modes[k] !== 'skim-tangent' && modes[k] !== 'skim-exp') continue;
      var best = -1, bestD = Infinity, hr = Math.max(Hown[k], 1e-300), tallest = -1;
      for (j = 0; j < K; j++) {
        if (j === k) continue; if (tallest < 0 || H[j] > H[tallest]) tallest = j;
        if (H[j] >= R * hr) { var d = Math.abs(j - k); if (d < bestD || (d === bestD && H[j] > H[best])) { best = j; bestD = d; } }
      }
      if (best >= 0) host[k] = best;
      else {
        applied[k] = 'drop';
        notes[k].push(K === 1 ? 'Skim requested but there is no neighbouring parent peak in this cluster; perpendicular drop used.'
          : 'Skim not applied: parent/rider height ratio ' + f4(H[tallest] / hr) + ' < skimRatio ' + R + ' (Dyson criterion); perpendicular drop used instead.');
      }
    }
    for (k = 0; k < K; k++) { var guard = 0; while (host[k] >= 0 && host[host[k]] >= 0 && guard++ < K) host[k] = host[host[k]]; }
    for (k = 0; k < K; k++) if (host[k] >= 0 && host[host[k]] >= 0) { host[k] = -1; applied[k] = 'drop'; }

    // 2. skim geometry for each rider
    var skim = [], hostOf = {};
    for (k = 0; k < K; k++) {
      if (host[k] < 0) continue;
      var h = host[k], dir = k > h ? 1 : -1, v = dir > 0 ? S[k] : E[k], limit;
      if (dir > 0) limit = (k + 1 < K && host[k + 1] === h) ? S[k + 1] : E[k];
      else limit = (k - 1 >= 0 && host[k - 1] === h) ? E[k - 1] : S[k];
      var sk = null;
      if (modes[k] === 'skim-exp') {
        sk = skimExp(c, v, dir, AP[h], H[h], AP[k], Hown[k], limit, CL);
        if (!sk) notes[k].push('Exponential fit of the parent ' + (dir > 0 ? 'tail' : 'front') + ' failed (too few points or no decay); tangent skim used instead.');
      }
      if (!sk) { sk = skimTangent(c, v, dir, AP[k], limit); applied[k] = 'skim-tangent'; }
      sk.dir = dir; sk.host = h; skim[k] = sk; (hostOf[h] = hostOf[h] || []).push(k);
      notes[k].push('Rider on the ' + (dir > 0 ? 'tail' : 'front') + ' of ' + (peaks[P[h]].id || 'peak ' + P[h]) + ': parent height ' + f4(H[h]) + ' / rider height ' + f4(Hown[k]) + ' = ' + f4(H[h] / Math.max(Hown[k], 1e-300)) + ' ≥ skimRatio ' + R + '.');
    }
    function skimLower(sk) { return function (t) { return Math.max(sk.fn(t), CL(t)); }; }

    // 3. deconvolution for fit-mode peaks (joint fit of the whole cluster above the common line)
    var fit = null;
    if (applied.some(function (m, q) { return m === 'fit' && host[q] < 0 && !hostOf[q]; })) {
      try {
        var yc = new Array(c.n); for (j = 0; j < c.n; j++) yc[j] = c.y[j] - CL(x[j]);
        fit = A.fitPeaks(x, yc, P.map(function (i, q) { return { id: peaks[i].id, start: S[q], end: E[q], apex: AP[q] }; }), { model: o.model || 'gaussian', maxIter: o.maxIter || 200 });
      } catch (err) {
        fit = null;
        for (k = 0; k < K; k++) if (applied[k] === 'fit') { applied[k] = 'drop'; notes[k].push('Peak fit failed (' + err.message + '); perpendicular drop used instead.'); }
      }
    }

    // hull for baseline-to-baseline
    var hull = null;
    if (applied.indexOf('baseline') >= 0) {
      var HX = gridNodes(x, cs, ce), HY = HX.map(function (t) { return yAt(c, t); }); hull = lowerHull(HX, HY);
    }

    // 4. per-peak results
    for (k = 0; k < K; k++) {
      var i = P[k], p = peaks[i], mode = applied[k], X, Up, Lo, info, bl, extraRes = {};
      var sigAt = function (t) { return yAt(c, t); };
      if (hostOf[k]) { // parent of skimmed rider(s): common baseline over its domain with rider regions removed
        var rs = hostOf[k], d0 = S[k], d1 = E[k], cuts = [];
        rs.forEach(function (q) { d0 = Math.min(d0, S[q], skim[q].t0); d1 = Math.max(d1, E[q], skim[q].t1); cuts.push(skim[q].t0, skim[q].t1); });
        // upper boundary = signal, except inside rider regions where it is the skim curve; at a region boundary the
        // node is duplicated (left value, right value) so that parent + riders add up exactly to the drop total
        var X0 = gridNodes(x, d0, d1, cuts); X = []; Up = [];
        var side = function (t, left) {
          for (var r = 0; r < rs.length; r++) { var s2 = skim[rs[r]]; if (left ? (t > s2.t0 && t <= s2.t1) : (t >= s2.t0 && t < s2.t1)) return skimLower(s2)(t); }
          return sigAt(t);
        };
        X0.forEach(function (t, q) {
          var lv = q ? side(t, true) : side(t, false), rv = q < X0.length - 1 ? side(t, false) : lv;
          X.push(t); Up.push(lv); if (rv !== lv) { X.push(t); Up.push(rv); }
        });
        Lo = X.map(CL);
        var riderIds = rs.map(function (q) { return peaks[P[q]].id; });
        if (['drop', 'skim-tangent', 'skim-exp'].indexOf(modes[k]) < 0) notes[k].push('Requested "' + modes[k] + '" overridden: a parent of skimmed riders is integrated above the common baseline.');
        mode = modes[k] === 'skim-exp' || modes[k] === 'skim-tangent' ? modes[k] : 'drop';
        info = {
          formula: 'A = Σ ½[(uᵢ−bᵢ)+(uᵢ₊₁−bᵢ₊₁)]·Δtᵢ,  b = common cluster baseline, u = signal except under riders where u = skim curve',
          describe: clDesc + ', excluding the rider area' + (rs.length > 1 ? 's' : '') + ' above the skim curve' + (rs.length > 1 ? 's' : '') + ' (' + riderIds.join(', ') + ')',
          upperNote: 'skim curve replaces the signal under riders', methodSuffix: ' — parent of skimmed rider(s)',
          steps: rs.map(function (q) { return { label: 'Rider ' + peaks[P[q]].id + ' skim region', expr: 't from ' + f4(skim[q].t0) + ' to ' + f4(skim[q].t1), value: skim[q].t1 - skim[q].t0 }; })
        };
        bl = { kind: 'line', points: [[d0, CL(d0)], [d1, CL(d1)]] };
        extraRes.riders = riderIds;
      } else if (host[k] >= 0) { // rider
        var sk2 = skim[k], low = skimLower(sk2);
        X = gridNodes(x, sk2.t0, sk2.t1); Up = X.map(sigAt); Lo = X.map(low);
        info = { formula: sk2.formula, describe: sk2.describe, steps: [{ label: 'Parent height (above common baseline)', expr: 'H_parent', value: H[sk2.host] },
          { label: 'Rider height (above own valley line)', expr: 'H_rider', value: Hown[k] }, { label: 'Height ratio', expr: 'H_parent / H_rider ≥ skimRatio', value: H[sk2.host] / Math.max(Hown[k], 1e-300) }].concat(sk2.steps),
          lead: 'Rider area: area under the curve' };
        bl = { kind: sk2.kind, points: sampleCurve(X, low), params: sk2.params };
        extraRes.host = peaks[P[sk2.host]].id;
      } else if (mode === 'fit' && fit) {
        var comp = fit.components[k], pr = comp.params, model = comp.model;
        X = gridNodes(x, cs, ce); Lo = X.map(CL);
        var cf = model === 'emg' ? function (t) { return A.emg(t, pr.A, pr.mu, pr.sigma, pr.tau); } : function (t) { return A.gaussian(t, pr.A, pr.mu, pr.sigma); };
        Up = X.map(function (t) { return CL(t) + cf(t); });
        var inWin = trapz(X, X.map(cf));
        info = {
          formula: 'A = A_fit·σ·√(2π)  (' + (model === 'emg' ? 'EMG' : 'Gaussian') + ' component fitted jointly to the cluster above the common baseline)',
          describe: clDesc + '; the peak is the fitted ' + (model === 'emg' ? 'EMG' : 'Gaussian') + ' component', lead: 'Model area: area under the fitted component',
          netOverride: comp.area,
          steps: [{ label: 'Model', expr: model, value: K + ' component(s)' }, { label: 'Amplitude A', expr: 'A', value: pr.A }, { label: 'Centre μ', expr: 'μ', value: pr.mu },
            { label: 'Width σ', expr: 'σ', value: pr.sigma }].concat(model === 'emg' ? [{ label: 'Tail τ', expr: 'τ', value: pr.tau }] : []).concat([
            { label: 'Area SE', expr: 'delta method from s²(JᵀJ)⁻¹', value: comp.areaSE }, { label: 'Fit R²', expr: '1 − RSS/TSS', value: fit.r2 },
            { label: 'Component area inside window', expr: 'Σ trapezoid(component) over the cluster window', value: inWin }]),
          notes: ['Reported area is the analytic component area (includes tails beyond the window); fit converged: ' + fit.converged + ', R² = ' + f4(fit.r2) + '.']
        };
        bl = { kind: 'line', points: [[cs, ycs], [ce, yce]] };
        extraRes.fit = { model: model, params: pr, areaSE: comp.areaSE, r2: fit.r2, converged: fit.converged, rt: comp.rt };
      } else {
        var s0 = S[k], e0 = E[k];
        X = gridNodes(x, s0, e0); Up = X.map(sigAt);
        if (mode === 'valley') {
          var Lv = lineFn(s0, yAt(c, s0), e0, yAt(c, e0)); Lo = X.map(Lv);
          info = { formula: 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·Δtᵢ,  b(t) = y(t_s) + (y(t_e) − y(t_s))·(t − t_s)/(t_e − t_s)',
            describe: 'a straight baseline from ' + pt(s0, Lo[0]) + ' to ' + pt(e0, Lo[Lo.length - 1]) };
          bl = { kind: 'line', points: [[s0, Lo[0]], [e0, Lo[Lo.length - 1]]] };
        } else if (mode === 'baseline') {
          var hf = polyFn(hull); Lo = X.map(hf);
          var verts = [[s0, hf(s0)]].concat(hull.filter(function (q) { return q[0] > s0 && q[0] < e0; })).concat([[e0, hf(e0)]]);
          info = { formula: 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·Δtᵢ,  b = lower convex hull of the signal over the cluster [T_s, T_e] (never above the signal)',
            describe: 'the baseline-to-baseline line (lower convex hull of the signal from ' + pt(cs, ycs) + ' to ' + pt(ce, yce) + ', ' + hull.length + ' vertices), with vertical drops at ' + f4(s0) + ' and ' + f4(e0) + ' min',
            steps: [{ label: 'Hull vertices', expr: 'points where the baseline touches the signal', value: hull.length }] };
          bl = { kind: 'polyline', points: verts };
        } else { // drop
          Lo = X.map(CL);
          info = { formula: 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·Δtᵢ,  b(t) = y(T_s) + (y(T_e) − y(T_s))·(t − T_s)/(T_e − T_s), T_s/T_e = cluster start/end',
            describe: K > 1 ? clDesc + ' with vertical drop lines at ' + f4(s0) + ' and ' + f4(e0) + ' min' : 'a straight baseline from ' + pt(s0, Lo[0]) + ' to ' + pt(e0, Lo[Lo.length - 1]),
            steps: K > 1 ? [{ label: 'Cluster start T_s', expr: 'T_s', value: cs }, { label: 'Cluster end T_e', expr: 'T_e', value: ce }] : [] };
          bl = { kind: 'line', points: [[s0, Lo[0]], [e0, Lo[Lo.length - 1]]] };
          var below = 0; for (j = 0; j < X.length; j++) if (Up[j] < Lo[j] - 3 * c.sig) below++;
          if (below > 2) notes[k].push('The signal dips below the common baseline at ' + below + ' points (baseline penetration); consider "baseline" or "valley".');
        }
        if (modes[k] === 'fit' && !fit) mode = applied[k];
      }
      info.notes = (info.notes || []).concat(notes[k]);
      var math = buildMath(c, mode, X, Up, Lo, info);
      var r0 = { id: p.id, index: i, cluster: ci, clusterSize: K, clip: mode, requested: modes[k], start: S[k], end: E[k], apex: AP[k], area: math.netArea,
        baseline: bl, segments: [{ x: X, upper: Up, lower: Lo }], math: math };
      for (var key in extraRes) r0[key] = extraRes[key];
      r0.flags = []; if (!(r0.area > 0)) { r0.flags.push('nonPositiveArea'); math.notes.push('Net area is not positive: the baseline lies above the signal here; check the bounds or choose another clip mode.'); }
      r0.valid = !r0.flags.length;
      res[i] = r0;
    }
  }

  /** integrate(x, y, peaks, {clip='drop', skimRatio=10, model='gaussian', valleyFrac, smooth, noise, force}) → result[] aligned with peaks:
      { id, index, cluster, clusterSize, clip (applied), requested, start, end, apex, area, host?, riders?, fit?,
        baseline:{ kind:'line'|'polyline'|'tangent'|'exponential', points:[[t,y],...], params? },
        segments:[{ x[], upper[], lower[] }]   // shade between upper and lower
        math:{ method, clip, formula, steps:[{label, expr, value}], n, dt, tStart, tEnd, yStart, yEnd, signalStart, signalEnd,
               grossArea, baselineArea, netArea, notes[] } }
      Effective mode per peak: opts.force ? opts.clip : peak.clip || (peak.manual ? 'valley' : opts.clip || 'drop'). */
  A.integrate = function (x, y, peaks, opts) {
    opts = opts || {}; peaks = peaks || [];
    var c = makeCtx(x, y, opts), cl = opts.clusters || clustersCtx(c, peaks, opts), res = new Array(peaks.length);
    cl.forEach(function (idxs, ci) { integrateCluster(c, peaks, idxs, ci, res); });
    for (var i = 0; i < res.length; i++) if (!res[i]) res[i] = { id: peaks[i] && peaks[i].id, index: i, clip: null, area: null, baseline: null, segments: [], math: null, error: 'invalid bounds' };
    return res;
  };

  /** clipOptions(x, y, peaks, clusterIdx, opts) → preview of every clip mode for one cluster.
      clusterIdx: index into clusters(x, y, peaks) or an explicit array of peak indices.
      → { indices[], ids[], recommended, reason, options:[{ clip, label, applicable, note, total,
           peaks:[{ id, clip (as applied), area, baseline, segments, notes[] }] }] } */
  A.clipOptions = function (x, y, peaks, clusterIdx, opts) {
    opts = opts || {}; peaks = peaks || [];
    var c = makeCtx(x, y, opts), idxs = Array.isArray(clusterIdx) ? clusterIdx.slice() : (clustersCtx(c, peaks, opts)[clusterIdx | 0] || []);
    var sub = idxs.map(function (i) { return peaks[i]; });
    var options = CLIP_MODES.map(function (mode) {
      var o2 = {}; for (var key in opts) o2[key] = opts[key]; o2.clip = mode; o2.force = true; o2.clusters = [sub.map(function (p, q) { return q; })];
      var r = A.integrate(x, y, sub, o2), tot = 0, applicable = true, note = '';
      r.forEach(function (q) { tot += q.area || 0; });
      if (mode.indexOf('skim') === 0) {
        applicable = r.some(function (q) { return q.host != null; });
        note = applicable ? 'Rider(s): ' + r.filter(function (q) { return q.host != null; }).map(function (q) { return q.id; }).join(', ') : (sub.length < 2 ? 'Needs at least two fused peaks.' : 'No peak meets the skim criterion (parent/rider height ≥ ' + (opts.skimRatio || 10) + ').');
      } else if (mode === 'fit') { applicable = r.every(function (q) { return q.clip === 'fit'; }); note = applicable ? 'R² = ' + f4(r[0].fit.r2) : 'Fit failed; falls back to drop.'; }
      else if (sub.length < 2 && mode !== 'valley') note = 'Single peak: identical to valley-to-valley.';
      return { clip: mode, label: CLIP_LABELS[mode], applicable: applicable, note: note, total: tot,
        peaks: r.map(function (q) { return { id: q.id, clip: q.clip, area: q.area, baseline: q.baseline, segments: q.segments, notes: q.math ? q.math.notes : [], host: q.host, math: q.math }; }) };
    });
    // recommendation
    var rec = 'valley', reason = 'Single, isolated peak: all modes agree.';
    if (sub.length > 1) {
      var sk = options[CLIP_MODES.indexOf('skim-exp')];
      if (sk.applicable) {
        var tailRider = sk.peaks.some(function (q) { return q.host != null && q.clip === 'skim-exp'; });
        rec = tailRider ? 'skim-exp' : 'skim-tangent';
        reason = 'A small peak rides on a much larger one (height ratio ≥ ' + (opts.skimRatio || 10) + '): skimming assigns the parent\'s ' + (tailRider ? 'tail' : 'front') + ' to the parent.';
      } else {
        var cs = Infinity, ce = -Infinity; sub.forEach(function (p) { var b = boundsOf(p); cs = Math.min(cs, b[0]); ce = Math.max(ce, b[1]); });
        var CL = lineFn(cs, yAt(c, cs), ce, yAt(c, ce)), worst = 0;
        var srt = sub.slice().sort(function (a, b) { return boundsOf(a)[0] - boundsOf(b)[0]; });
        for (var q = 0; q < srt.length - 1; q++) {
          var tv = (boundsOf(srt[q])[1] + boundsOf(srt[q + 1])[0]) / 2, hv = ysAt(c, tv) - CL(tv);
          var hm = Math.min(heightAbove(c, boundsOf(srt[q])[0], boundsOf(srt[q])[1], CL).h, heightAbove(c, boundsOf(srt[q + 1])[0], boundsOf(srt[q + 1])[1], CL).h);
          if (hm > 0) worst = Math.max(worst, hv / hm);
        }
        var fo = options[CLIP_MODES.indexOf('fit')];
        if (worst > 0.5 && fo.applicable && fo.peaks.every(function (p) { return p.area > 0; })) { rec = 'fit'; reason = 'Deep overlap (valley at ' + Math.round(100 * worst) + '% of the smaller peak): perpendicular drop mis-assigns area; deconvolution is less biased if the peak shape model fits.'; }
        else { rec = 'drop'; reason = 'Partially resolved peaks (valley at ' + Math.round(100 * worst) + '% of the smaller peak): perpendicular drop to a common baseline is the standard choice.'; }
      }
    }
    return { indices: idxs, ids: sub.map(function (p) { return p.id; }), recommended: rec, reason: reason, options: options };
  };

  // peakMetrics helpers
  function regionOf(r) {
    var s = r.segments[0];
    return { X: s.x, Y: s.upper.map(function (u, i) { return u - s.lower[i]; }), area: r.area, math: r.math, clip: r.clip };
  }
  function regionFromBaseline(x, y, p, pts) {
    var b = boundsOf(p), X = gridNodes(x, b[0], b[1]), fn = polyFn(pts), Up = X.map(function (t) { return U.interp1(x, y, t); }), Lo = X.map(fn);
    var c = { dt: x.length > 1 ? (x[x.length - 1] - x[0]) / (x.length - 1) : 0 };
    var math = buildMath(c, 'valley', X, Up, Lo, { formula: 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·Δtᵢ, b = user-supplied baseline polyline', describe: 'the supplied baseline polyline (' + pts.length + ' points)' });
    math.method = 'User-supplied baseline';
    return { X: X, Y: Up.map(function (u, i) { return u - Lo[i]; }), area: math.netArea, math: math, clip: 'custom' };
  }

  /* ---------------- gradient / method ---------------- */
  function rowsOf(method) {
    return ((method && method.gradient) || []).map(function (r, i) { return { t: +r.t, B: +r.B, flow: r.flow != null && r.flow !== '' ? +r.flow : null, i: i }; })
      .filter(function (r) { return fin(r.t) && fin(r.B); }).sort(function (a, b) { return a.t - b.t || a.i - b.i; });
  }
  function baseFlow(method, rows) {
    if (method && +method.flow > 0) return +method.flow;
    for (var i = 0; i < rows.length; i++) if (rows[i].flow > 0) return rows[i].flow;
    return 1;
  }
  /** concAt(method, B) → concentration of the eluent component for salt/imidazole gradients, else null.
      c = c_A + (bMaxConc − c_A)·B/100 (c_A = method.aConc, default 0). */
  A.concAt = function (method, B) {
    if (!method || !(method.gradientType === 'salt' || method.gradientType === 'imidazole') || !fin(+method.bMaxConc)) return null;
    var ca = fin(+method.aConc) ? +method.aConc : 0;
    return ca + (+method.bMaxConc - ca) * B / 100;
  };
  /** gradientAt(method, t) → { B, flow, conc? } at program time t (pump time; no dwell). Linear between rows,
      two rows with equal t = step (the later row applies from t on), holds before first / after last row,
      'step' mode holds each row until the next, isocratic if single row or gradientType 'isocratic'. */
  A.gradientAt = function (method, t) {
    var rows = rowsOf(method), F0 = baseFlow(method, rows), out;
    function fl(r) { return r.flow > 0 ? r.flow : F0; }
    if (!rows.length) out = { B: 0, flow: F0 };
    else if (method.gradientType === 'isocratic' || rows.length === 1 || t < rows[0].t) out = { B: rows[0].B, flow: fl(rows[0]) };
    else {
      var j = 0; while (j < rows.length - 1 && rows[j + 1].t <= t) j++;
      if (j === rows.length - 1) out = { B: rows[j].B, flow: fl(rows[j]) };
      else {
        var a = rows[j], b = rows[j + 1];
        if (method.mode === 'step') out = { B: a.B, flow: fl(a) };
        else { var fr = (t - a.t) / (b.t - a.t); out = { B: a.B + fr * (b.B - a.B), flow: fl(a) + fr * (fl(b) - fl(a)) }; }
      }
    }
    var c = A.concAt(method, out.B); if (c != null) { out.conc = c; out.unit = method.bConcUnit || 'mM'; }
    return out;
  };
  /** dwellTime(method) = V_D / F (min). */
  A.dwellTime = function (method) { var f = baseFlow(method, rowsOf(method)); return (+(method && method.dwellVolume_mL) || 0) / f; };
  /** voidVolume(method) = ε·π·(d/2)²·L in mL (mm³ / 1000), or null. */
  A.voidVolume = function (method) {
    var c = method && method.column; if (!c || !(c.length_mm > 0) || !(c.id_mm > 0)) return null;
    var eps = c.porosity > 0 ? +c.porosity : 0.65;
    return eps * Math.PI * Math.pow(c.id_mm / 2, 2) * c.length_mm / 1000;
  };
  /** voidTime(method) = override voidTime_min, else voidVolume/flow (min), or null. */
  A.voidTime = function (method) {
    if (method && +method.voidTime_min > 0) return +method.voidTime_min;
    var v = A.voidVolume(method); return v == null ? null : v / baseFlow(method, rowsOf(method));
  };
  /** gradientCurve(method, tMax, n=500, {includeVoid}) → { t[], B[], conc?[], unit?, flow[], delay }
      Composition reaching the column inlet: B(t) = program(t − t_D). With includeVoid, also delayed by t₀
      (≈ column outlet). Exact breakpoints (incl. both sides of steps) are merged into the uniform grid. */
  A.gradientCurve = function (method, tMax, n, opts) {
    opts = opts || {}; n = Math.max(2, n || 500);
    var rows = rowsOf(method), tD = A.dwellTime(method), t0 = opts.includeVoid ? (A.voidTime(method) || 0) : 0, delay = tD + t0;
    var ts = U.linspace(0, tMax, n), eps = 1e-9 * Math.max(1, tMax);
    if (method.gradientType !== 'isocratic') rows.forEach(function (r) { var tb = r.t + delay; if (tb > 0 && tb < tMax) { ts.push(tb - eps); ts.push(tb); } });
    ts.sort(function (a, b) { return a - b; });
    var out = { t: [], B: [], flow: [], delay: delay }, hasC = A.concAt(method, 0) != null;
    if (hasC) { out.conc = []; out.unit = method.bConcUnit || 'mM'; }
    ts.forEach(function (t, i) {
      if (i && t === ts[i - 1]) return;
      var g = A.gradientAt(method, t - delay); out.t.push(t); out.B.push(g.B); out.flow.push(g.flow); if (hasC) out.conc.push(g.conc);
    });
    return out;
  };
  /** elution(method, rt) → { B, conc?, unit?, tProgram, dwell, void, formula } — composition at elution. */
  A.elution = function (method, rt) {
    var tD = A.dwellTime(method), t0 = A.voidTime(method) || 0, tp = Math.max(0, rt - tD - t0), g = A.gradientAt(method, tp);
    var o = { B: g.B, tProgram: tp, dwell: tD, void: t0, formula: F('%B_elution = B_program(max(0, t_R − t_D − t₀))', { t_R: rt, t_D: tD, t0: t0 }, g.B, 'Composition that left the mixer t_D + t₀ before the peak reached the detector.', '%') };
    if (g.conc != null) { o.conc = g.conc; o.unit = g.unit; }
    return o;
  };
  /** Bat(method, rt) → %B at elution = gradientAt(method, max(0, rt − dwell − void)).B */
  A.Bat = function (method, rt) { return A.elution(method, rt).B; };

  /* ---------------- normalization / alignment / difference ---------------- */
  /** normalize({x,y}, 'none'|'max'|'area', {range?:[t0,t1]}) → { x, y, factor, mode }.
      'max': max within range = 1; 'area': trapezoid area within range = 1 (y·min). */
  A.normalize = function (xy, mode, opts) {
    opts = opts || {}; var x = toArr(xy.x), y = toArr(xy.y), n = x.length, i0 = 0, i1 = n - 1, f = 1, i;
    if (opts.range) { i0 = U.bsearch(x, opts.range[0]); if (x[i0] < opts.range[0] && i0 < n - 1) i0++; i1 = U.bsearch(x, opts.range[1]); }
    if (mode === 'max') { var mx = -Infinity; for (i = i0; i <= i1; i++) if (y[i] > mx) mx = y[i]; if (mx > 0) f = 1 / mx; }
    else if (mode === 'area') { var ar = 0; for (i = i0; i < i1; i++) ar += 0.5 * (y[i] + y[i + 1]) * (x[i + 1] - x[i]); if (ar > 0) f = 1 / ar; }
    return { x: x, y: y.map(function (v) { return v * f; }), factor: f, mode: mode || 'none' };
  };
  /** align(x, shift) → x + shift. */
  A.align = function (x, shift) { shift = +shift || 0; return Array.prototype.map.call(x, function (v) { return v + shift; }); };
  /** difference(traceA, traceB) → { x: A.x, y: A.y − B(A.x) } with B linearly resampled; NaN outside B's x range. */
  A.difference = function (ta, tb) {
    var bx = tb.x, by = tb.y, lo = bx[0], hi = bx[bx.length - 1];
    var y = Array.prototype.map.call(ta.x, function (t, i) { return t < lo || t > hi ? NaN : ta.y[i] - U.interp1(bx, by, t); });
    return { x: toArr(ta.x), y: y };
  };

  /* ---------------- peak models ---------------- */
  /** erfcx(z) = exp(z²)·erfc(z). Series for erf on |z|<2, continued fraction for z≥2; reflection for z<0. ~1e-14 rel. */
  function erfcx(z) {
    if (z < 0) return 2 * Math.exp(z * z) - erfcx(-z);
    if (z < 2) {
      var z2 = z * z, term = z, sum = z;
      for (var k = 1; k < 80; k++) { term *= -z2 / k; var add = term / (2 * k + 1); sum += add; if (Math.abs(add) < 1e-17 * Math.abs(sum)) break; }
      return Math.exp(z2) * (1 - 2 / SQRTPI * sum);
    }
    var K = z < 4 ? 90 : z < 10 ? 40 : 12, fr = z; // erfc(z)=e^{-z²}/√π · 1/(z+ ½/(z+ 1/(z+ 3/2/(z+ …))))
    for (var j = K; j >= 1; j--) fr = z + (j / 2) / fr;
    return 1 / (SQRTPI * fr);
  }
  A.erfcx = erfcx;
  /** gaussian(t, A, mu, sigma) = A·exp(−(t−μ)²/(2σ²)); area A·σ·√(2π). */
  A.gaussian = function (t, a, mu, s) { var u = (t - mu) / s; return a * Math.exp(-0.5 * u * u); };
  /** emg(t, A, mu, sigma, tau): Gaussian (amplitude A) convolved with a unit-area exponential (τ); area A·σ·√(2π).
      f = A·(σ/τ)·√(π/2)·exp(−u²/2)·erfcx(z), u=(t−μ)/σ, z=(σ/τ−u)/√2; for z<0 the reflection is applied with the
      exponents combined (z² − u²/2 = r²/2 − r·u, r=σ/τ) so nothing overflows for any τ. */
  A.emg = function (t, a, mu, s, tau) {
    var u = (t - mu) / s, r = s / tau, z = (r - u) / Math.SQRT2, k = a * r * Math.sqrt(Math.PI / 2);
    if (z >= 0) return k * Math.exp(-0.5 * u * u) * erfcx(z);
    return k * (2 * Math.exp(0.5 * r * r - r * u) - Math.exp(-0.5 * u * u) * erfcx(-z));
  };
  function evalComp(model, p, o, t) { return model === 'emg' ? A.emg(t, p[o], p[o + 1], p[o + 2], p[o + 3]) : A.gaussian(t, p[o], p[o + 1], p[o + 2]); }
  // apex & FWHM of a unimodal model curve (golden-section max, bisection for half-height crossings)
  function shapeOf(fn, mu, s, tau) {
    var g = (Math.sqrt(5) - 1) / 2, a = mu - s, b = mu + s + (tau || 0), c, d, it;
    for (it = 0; it < 100 && b - a > 1e-12 * (1 + Math.abs(mu)); it++) { c = b - g * (b - a); d = a + g * (b - a); if (fn(c) > fn(d)) b = d; else a = c; }
    var rt = (a + b) / 2, H = fn(rt);
    function bis(lo, hi, rising) { for (var k = 0; k < 100; k++) { var mid = (lo + hi) / 2; if ((fn(mid) < H / 2) === rising) lo = mid; else hi = mid; } return (lo + hi) / 2; }
    var l = bis(rt - 20 * s - (tau || 0), rt, true), r = bis(rt, rt + 20 * s + 50 * (tau || 0), false);
    return { rt: rt, height: H, fwhm: r - l };
  }

  /* ---------------- fitting (Levenberg–Marquardt) ---------------- */
  /** fitPeaks(x, y, peaks, {model:'gaussian'|'emg', maxIter=200, baseline:false|'linear', range?:[t0,t1]})
      Joint least-squares fit of one component per peak over the union of their windows. y should be baseline-corrected
      unless baseline:'linear' is requested. Returns { components, curve, rss, r2, dof, converged, cov, iterations, paramNames, window }. */
  A.fitPeaks = function (x, y, peaks, opts) {
    opts = opts || {};
    if (!peaks || !peaks.length) throw new Error('fitPeaks: no peaks');
    var model = opts.model === 'emg' ? 'emg' : 'gaussian', np = model === 'emg' ? 4 : 3, maxIter = opts.maxIter || 200, useBl = !!opts.baseline;
    var lo = Infinity, hi = -Infinity;
    peaks.forEach(function (p) { lo = Math.min(lo, p.start, p.end); hi = Math.max(hi, p.start, p.end); });
    if (opts.range) { lo = opts.range[0]; hi = opts.range[1]; }
    var xs = [], yv = [], i, j, k;
    for (i = 0; i < x.length; i++) if (x[i] >= lo && x[i] <= hi) { xs.push(+x[i]); yv.push(+y[i]); }
    var m = xs.length, N = peaks.length, P = N * np + (useBl ? 2 : 0);
    if (m < P + 1) throw new Error('fitPeaks: too few points (' + m + ') for ' + P + ' parameters');
    var dx = (xs[m - 1] - xs[0]) / (m - 1), span = xs[m - 1] - xs[0], xc = (xs[0] + xs[m - 1]) / 2;
    var b0 = 0, b1 = 0; if (useBl) { b1 = (yv[m - 1] - yv[0]) / (span || 1); b0 = (yv[0] + yv[m - 1]) / 2; }

    // initial guesses from the data inside each peak's bounds
    var p = [], scale = [], names = [];
    peaks.forEach(function (pk) {
      var s = 0, e = m - 1;
      while (s < m - 1 && xs[s] < Math.min(pk.start, pk.end)) s++;
      while (e > 0 && xs[e] > Math.max(pk.start, pk.end)) e--;
      if (e <= s) { s = 0; e = m - 1; }
      var ia = fin(pk.apex) && pk.apex > xs[s] && pk.apex < xs[e] ? argmax(yv, Math.max(s, idxNear(xs, pk.apex) - 3), Math.min(e, idxNear(xs, pk.apex) + 3)) : argmax(yv, s, e);
      var bl = useBl ? b0 + b1 * (xs[ia] - xc) : 0, Ap = Math.max(yv[ia] - bl, 1e-12), l = ia, r = ia;
      while (l > s && yv[l] - bl > Ap / 2) l--; while (r < e && yv[r] - bl > Ap / 2) r++;
      var hl = Math.max(dx, xs[ia] - xs[l]), hr = Math.max(dx, xs[r] - xs[ia]);
      if (model === 'gaussian') { p.push(Ap, xs[ia], (hl + hr) / FWHM_SIG); scale.push(Ap, (hl + hr) / 2, (hl + hr) / 2); }
      else {
        var sg = hl / 1.1774, tau = Math.max(0.2 * sg, hr - hl);
        p.push(Ap * (1 + tau / sg * 0.5), xs[ia] - 0.3 * Math.min(tau, sg), sg, tau); scale.push(Ap, sg, sg, sg);
      }
      names.push('A', 'mu', 'sigma'); if (model === 'emg') names.push('tau');
    });
    if (useBl) { var ys0 = Math.max(1e-12, Math.abs(b0) + Math.abs(b1) * span); p.push(b0, b1); scale.push(ys0, ys0 / (span || 1)); names.push('b0', 'b1'); }

    function clampP(q) { // parameter bounds by projection: A≥0, μ inside window, σ,τ > 0
      for (var c = 0; c < N; c++) {
        var o = c * np;
        q[o] = Math.max(0, q[o]); q[o + 1] = U.clamp(q[o + 1], xs[0], xs[m - 1]);
        q[o + 2] = U.clamp(q[o + 2], dx / 20, 2 * span);
        if (np === 4) q[o + 3] = U.clamp(q[o + 3], dx / 100, 10 * span);
      }
      return q;
    }
    function comps(q) { var out = []; for (var c = 0; c < N; c++) { var a = new Float64Array(m); for (var ii = 0; ii < m; ii++) a[ii] = evalComp(model, q, c * np, xs[ii]); out.push(a); } return out; }
    function resid(q, cs) {
      var r = new Float64Array(m), s2 = 0;
      for (var ii = 0; ii < m; ii++) { var f = useBl ? q[N * np] + q[N * np + 1] * (xs[ii] - xc) : 0; for (var c = 0; c < N; c++) f += cs[c][ii]; r[ii] = yv[ii] - f; s2 += r[ii] * r[ii]; }
      return { r: r, rss: s2 };
    }
    // Jacobian columns: central differences, only the perturbed component is re-evaluated; baseline analytic.
    function jac(q) {
      var J = [];
      for (var c = 0; c < N; c++) for (var jj = 0; jj < np; jj++) {
        var idx = c * np + jj, h = 1e-6 * Math.max(Math.abs(q[idx]) * (jj === 1 ? 0 : 1), scale[idx]), qp = q.slice(), qm = q.slice(), col = new Float64Array(m);
        if (jj >= 2) h = Math.min(h, 0.5 * q[idx]); // keep σ, τ positive
        qp[idx] += h; qm[idx] -= h;
        for (var ii = 0; ii < m; ii++) col[ii] = (evalComp(model, qp, c * np, xs[ii]) - evalComp(model, qm, c * np, xs[ii])) / (2 * h);
        J.push(col);
      }
      if (useBl) { var c0 = new Float64Array(m).fill(1), c1 = new Float64Array(m); for (var t = 0; t < m; t++) c1[t] = xs[t] - xc; J.push(c0, c1); }
      return J;
    }
    function normal(J, r) {
      var JtJ = [], Jtr = new Array(P);
      for (var a = 0; a < P; a++) {
        JtJ.push(new Array(P)); var s = 0; for (var ii = 0; ii < m; ii++) s += J[a][ii] * r[ii]; Jtr[a] = s;
        for (var b = 0; b <= a; b++) { s = 0; for (ii = 0; ii < m; ii++) s += J[a][ii] * J[b][ii]; JtJ[a][b] = s; }
      }
      for (a = 0; a < P; a++) for (b = a + 1; b < P; b++) JtJ[a][b] = JtJ[b][a];
      return { JtJ: JtJ, Jtr: Jtr };
    }

    p = clampP(p);
    var cs = comps(p), R = resid(p, cs), lambda = 1e-3, converged = false, it = 0;
    for (it = 0; it < maxIter && !converged; it++) {
      var ne = normal(jac(p), R.r), accepted = false;
      while (!accepted) {
        var M = ne.JtJ.map(function (row, a) { var rr = row.slice(); rr[a] += lambda * Math.max(row[a], 1e-12); return rr; });
        var delta = cholSolve(M, ne.Jtr);
        if (delta) {
          var pn = clampP(p.map(function (v, a) { return v + delta[a]; })), csn = comps(pn), Rn = resid(pn, csn);
          if (Rn.rss < R.rss) {
            var drop = (R.rss - Rn.rss) / (R.rss || 1), stepRel = 0;
            for (k = 0; k < P; k++) stepRel = Math.max(stepRel, Math.abs(pn[k] - p[k]) / scale[k]);
            p = pn; cs = csn; R = Rn; lambda = Math.max(lambda / 3, 1e-12); accepted = true;
            if (drop < 1e-8 || stepRel < 1e-6) converged = true; // relative RSS change / step negligible
            break;
          }
        }
        lambda *= 4;
        if (lambda > 1e14) { converged = true; break; } // no downhill step exists: at a (local) minimum to numerical precision
      }
    }

    // statistics: cov = s²(JᵀJ)⁻¹, s² = RSS/dof
    var dof = m - P, s2 = dof > 0 ? R.rss / dof : NaN, ne2 = normal(jac(p), R.r), inv = dof > 0 ? invert(ne2.JtJ) : null;
    var cov = inv ? inv.map(function (row) { return row.map(function (v) { return v * s2; }); }) : null;
    var ym = 0; for (i = 0; i < m; i++) ym += yv[i]; ym /= m;
    var tss = 0; for (i = 0; i < m; i++) tss += (yv[i] - ym) * (yv[i] - ym);
    var yFit = new Array(m), blArr = useBl ? new Array(m) : null, tot = 0;
    for (i = 0; i < m; i++) { var f0 = useBl ? p[N * np] + p[N * np + 1] * (xs[i] - xc) : 0; if (blArr) blArr[i] = f0; for (j = 0; j < N; j++) f0 += cs[j][i]; yFit[i] = f0; }

    var components = peaks.map(function (pk, c) {
      var o = c * np, a = p[o], mu = p[o + 1], sg = p[o + 2], tau = np === 4 ? p[o + 3] : null;
      var area = a * sg * SQ2PI, gA = sg * SQ2PI, gS = a * SQ2PI, areaSE = NaN, se = {};
      if (cov) { // delta method: Var(area) = gᵀ C g with g = ∂area/∂(A, σ), including the A–σ covariance
        areaSE = Math.sqrt(Math.max(0, gA * gA * cov[o][o] + gS * gS * cov[o + 2][o + 2] + 2 * gA * gS * cov[o][o + 2]));
        ['A', 'mu', 'sigma', 'tau'].slice(0, np).forEach(function (nm, jj) { se[nm] = Math.sqrt(Math.max(0, cov[o + jj][o + jj])); });
      }
      var shp = np === 4 ? shapeOf(function (t) { return A.emg(t, a, mu, sg, tau); }, mu, sg, tau) : { rt: mu, height: a, fwhm: FWHM_SIG * sg };
      var params = { A: a, mu: mu, sigma: sg }; if (np === 4) params.tau = tau;
      tot += area;
      return {
        id: pk.id, model: model, params: params, paramSE: se, area: area, areaSE: areaSE, rt: shp.rt, height: shp.height, fwhm: shp.fwhm,
        formulas: {
          area: F('Area = A·σ·√(2π); SE² = (σ√2π)²·Var(A) + (A√2π)²·Var(σ) + 2(σ√2π)(A√2π)·Cov(A,σ)',
            { A: a, sigma: sg, varA: cov ? cov[o][o] : null, varSigma: cov ? cov[o + 2][o + 2] : null, covASigma: cov ? cov[o][o + 2] : null }, area,
            (np === 4 ? 'EMG with Gaussian-amplitude parameterisation: the exponential kernel has unit area, so area = A·σ·√(2π) independent of τ. ' : '') + 'Units: y·min. SE by delta method from cov = s²(JᵀJ)⁻¹.', 'y·min')
        }
      };
    });
    components.forEach(function (c) { c.areaPct = tot ? 100 * c.area / tot : null; });
    var per = cs.map(function (a) { return Array.prototype.slice.call(a); });
    var curve = { x: xs, yFit: yFit, perComponent: per, residuals: Array.prototype.slice.call(R.r) }; if (blArr) curve.baseline = blArr;
    var res = { components: components, curve: curve, rss: R.rss, r2: tss > 0 ? 1 - R.rss / tss : null, dof: dof, converged: converged && it <= maxIter, cov: cov, iterations: it, paramNames: names, window: [xs[0], xs[m - 1]], model: model };
    if (useBl) res.baselineParams = { b0: p[N * np], b1: p[N * np + 1], xc: xc };
    return res;
  };

  /* ---------------- Student t distribution ---------------- */
  // ln Γ(z) by the Lanczos approximation (g = 7, 9 terms; ~1e-15 relative for z > 0.5).
  var LZ = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lgamma(1 - z);
    z -= 1; var a = LZ[0], t = z + 7.5;
    for (var i = 1; i < 9; i++) a += LZ[i] / (z + i);
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
  }
  // Regularized incomplete beta I_x(a,b): continued fraction (modified Lentz) on the faster-converging side.
  function betacf(a, b, x) {
    var tiny = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap, m, m2, aa, del, h;
    if (Math.abs(d) < tiny) d = tiny; d = 1 / d; h = d;
    for (m = 1; m <= 300; m++) {
      m2 = 2 * m; aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var lb = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? lb * betacf(a, b, x) / a : 1 - lb * betacf(b, a, 1 - x) / b;
  }
  /** tCdf(t, df) → P(T ≤ t) for Student's t with df degrees of freedom. */
  A.tCdf = function (t, df) { var p = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5); return t >= 0 ? 1 - p : p; };
  /** tQuantile(p, df) → t such that P(T ≤ t) = p (bisection on tCdf; |error| < 1e-10). */
  A.tQuantile = function (p, df) {
    if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
    if (p === 0.5) return 0; if (p < 0.5) return -A.tQuantile(1 - p, df);
    var lo = 0, hi = 1; while (A.tCdf(hi, df) < p && hi < 1e8) hi *= 2;
    for (var i = 0; i < 200 && hi - lo > 1e-12 * Math.max(1, hi); i++) { var mid = (lo + hi) / 2; if (A.tCdf(mid, df) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };

  /* ---------------- calibration curve ---------------- */
  var CAL_MODELS = { linear: 'y = b₀ + b₁·x', linear0: 'y = b₁·x', quadratic: 'y = b₀ + b₁·x + b₂·x²' };
  /** calibrationFit(points [{x: conc, y: response, w?, include?}], {model:'linear'|'linear0'|'quadratic', weighting:'none'|'1/x'|'1/x2', alpha=0.05})
      Weighted least squares. Weights wᵢ = (pt.w ?? 1)·{1, 1/xᵢ, 1/xᵢ²}, normalised to Σw = n so s_y/x stays in response units.
      → { model, weighting, n, p, dof, coef[], se[], cov[][], names[], r2, adjR2, syx, tCrit, xRange, xMean, yMean, Sxx,
          points:[{x,y,w,fitted,residual,stdResidual}], residuals[], slope, lod, loq, lodIntercept, notes[], formulas{},
          predict(x), predictBand(x,{m}), inverse(y,{m}) } */
  A.calibrationFit = function (points, opts) {
    opts = opts || {};
    var model = CAL_MODELS[opts.model] ? opts.model : 'linear', wt = opts.weighting === '1/x' || opts.weighting === '1/x2' ? opts.weighting : 'none';
    var alpha = opts.alpha > 0 && opts.alpha < 1 ? opts.alpha : 0.05, notes = [];
    var pts = (points || []).filter(function (q) { return q && q.include !== false && fin(+q.x) && fin(+q.y); })
      .map(function (q) { return { x: +q.x, y: +q.y, w0: fin(+q.w) && +q.w > 0 ? +q.w : 1 }; });
    var p = model === 'linear0' ? 1 : model === 'linear' ? 2 : 3, n = pts.length, i, j, k;
    if (n < p + 1) throw new Error('calibrationFit: need at least ' + (p + 1) + ' points for a ' + model + ' model (have ' + n + ')');
    var xPos = Infinity; pts.forEach(function (q) { if (q.x > 0 && q.x < xPos) xPos = q.x; });
    function wFn(xv) { // relative weight model (before normalisation)
      if (wt === 'none') return 1;
      var xe = xv > 0 ? xv : xPos; if (!fin(xe)) return 1;
      return wt === '1/x' ? 1 / xe : 1 / (xe * xe);
    }
    if (wt !== 'none' && pts.some(function (q) { return !(q.x > 0); })) notes.push('Weighting ' + wt + ' is undefined at x ≤ 0; those points use the weight of the lowest positive level (' + xPos + ').');
    var raw = pts.map(function (q) { return q.w0 * wFn(q.x); }), sw = raw.reduce(function (s, v) { return s + v; }, 0), cn = n / sw;
    pts.forEach(function (q, ii) { q.w = raw[ii] * cn; });
    function row(xv) { return model === 'linear0' ? [xv] : model === 'linear' ? [1, xv] : [1, xv, xv * xv]; }
    var M = [], r = []; for (i = 0; i < p; i++) { M.push(new Array(p).fill(0)); r.push(0); }
    pts.forEach(function (q) { var f = row(q.x); for (i = 0; i < p; i++) { r[i] += q.w * f[i] * q.y; for (j = 0; j < p; j++) M[i][j] += q.w * f[i] * f[j]; } });
    var Mi = invert(M); if (!Mi) throw new Error('calibrationFit: singular design (need distinct concentration levels)');
    var b = Mi.map(function (rw) { var s = 0; for (k = 0; k < p; k++) s += rw[k] * r[k]; return s; });
    function predict(xv) { var f = row(+xv), s = 0; for (var q = 0; q < p; q++) s += b[q] * f[q]; return s; }
    var sse = 0, swy = 0, sww = 0, swx = 0;
    pts.forEach(function (q) { q.fitted = predict(q.x); q.residual = q.y - q.fitted; sse += q.w * q.residual * q.residual; swy += q.w * q.y; swx += q.w * q.x; sww += q.w; });
    var dof = n - p, s2 = sse / dof, syx = Math.sqrt(s2), yMean = swy / sww, xMean = swx / sww, sst = 0, Sxx = 0;
    pts.forEach(function (q) { sst += model === 'linear0' ? q.w * q.y * q.y : q.w * (q.y - yMean) * (q.y - yMean); Sxx += q.w * (q.x - xMean) * (q.x - xMean); q.stdResidual = syx > 0 ? q.residual * Math.sqrt(q.w) / syx : 0; });
    var cov = Mi.map(function (rw) { return rw.map(function (v) { return v * s2; }); }), se = cov.map(function (rw, q) { return Math.sqrt(Math.max(0, rw[q])); });
    var r2 = sst > 0 ? 1 - sse / sst : 1, k0 = model === 'linear0' ? 0 : 1, adjR2 = dof > 0 ? 1 - (1 - r2) * (n - k0) / dof : null;
    var tCrit = A.tQuantile(1 - alpha / 2, dof), xs = pts.map(function (q) { return q.x; }), xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var names = model === 'linear0' ? ['b1'] : model === 'linear' ? ['b0', 'b1'] : ['b0', 'b1', 'b2'];
    var b0 = model === 'linear0' ? 0 : b[0], b1 = model === 'linear0' ? b[0] : b[1], b2 = model === 'quadratic' ? b[2] : 0;
    var xLow = fin(xPos) ? xPos : xmin, slope = model === 'quadratic' ? b1 + 2 * b2 * xLow : b1;
    var lod = slope !== 0 ? 3.3 * syx / Math.abs(slope) : null, loq = slope !== 0 ? 10 * syx / Math.abs(slope) : null;
    var lodIntercept = model === 'linear0' || slope === 0 ? null : 3.3 * se[0] / Math.abs(slope);
    if (wt !== 'none') notes.push('Weighted fit: s_y/x is the residual SD at unit (average) weight; the SD at the low end of the range is smaller, so LOD/LOQ from s_y/x are conservative there.');
    if (model === 'quadratic') notes.push('Quadratic model: slope for LOD/LOQ is the tangent slope at the lowest positive level (' + f4(xLow) + ').');
    if (n < 5) notes.push('Fewer than 5 calibration levels: ICH Q2 recommends a minimum of 5 for linearity.');
    pts.forEach(function (q) { if (Math.abs(q.stdResidual) > 3) notes.push('Point x = ' + q.x + ' has a standardised residual of ' + f4(q.stdResidual) + ' (|e/s| > 3): check for an outlier.'); });

    function relW(xv) { return wFn(xv) * cn; }
    function gradAt(xv) { return row(xv); }
    function varMean(xv) { var g = gradAt(xv), s = 0; for (var a = 0; a < p; a++) for (var c = 0; c < p; c++) s += g[a] * cov[a][c] * g[c]; return Math.max(0, s); }
    function dfdx(xv) { return b1 + 2 * b2 * xv; }
    /** confidence (mean) and prediction band at x */
    function predictBand(xv, o) {
      o = o || {}; var m = o.m > 0 ? o.m : 1, yv = predict(xv), vm = varMean(xv), vp = vm + s2 / (m * relW(xv));
      return { x: xv, y: yv, seMean: Math.sqrt(vm), sePred: Math.sqrt(vp), loMean: yv - tCrit * Math.sqrt(vm), hiMean: yv + tCrit * Math.sqrt(vm), lo: yv - tCrit * Math.sqrt(vp), hi: yv + tCrit * Math.sqrt(vp) };
    }
    function solveX(y0) {
      if (model !== 'quadratic' || Math.abs(b2) < 1e-15 * Math.max(1, Math.abs(b1))) return b1 !== 0 ? (y0 - b0) / b1 : null;
      var disc = b1 * b1 - 4 * b2 * (b0 - y0); if (disc < 0) return null;
      var sq = Math.sqrt(disc), qq = -0.5 * (b1 + (b1 >= 0 ? sq : -sq)), r1 = qq / b2, r2_ = qq !== 0 ? (b0 - y0) / qq : r1;
      var trend = predict(xmax) - predict(xmin), mid = (xmin + xmax) / 2;
      var cands = [r1, r2_].filter(fin).sort(function (u, w) {
        var ou = dfdx(u) * trend > 0 ? 0 : 1, ow = dfdx(w) * trend > 0 ? 0 : 1; // prefer the root on the monotonic branch
        return ou - ow || Math.abs(u - mid) - Math.abs(w - mid);
      });
      return cands.length ? cands[0] : null;
    }
    /** inverse(y0, {m=1}) → concentration for a response that is the mean of m replicate injections */
    function inverse(y0, o) {
      o = o || {}; var m = o.m > 0 ? o.m : 1, x0 = solveX(+y0), out = { y: +y0, m: m, x: x0, se: null, lo: null, hi: null, tCrit: tCrit, dof: dof, level: 1 - alpha, flags: [], notes: [] };
      if (x0 == null || !fin(x0)) { out.flags.push('noSolution'); out.notes.push('The response is outside the range the model can reach (no real root).'); return out; }
      var d = dfdx(x0), w0 = relW(x0), vy = s2 / (m * w0), vf = varMean(x0), v = (vy + vf) / (d * d);
      out.se = Math.sqrt(v); out.lo = x0 - tCrit * out.se; out.hi = x0 + tCrit * out.se; out.slopeAtX = d; out.weightAtX = w0;
      if (x0 < xmin || x0 > xmax) { out.flags.push('extrapolated'); out.notes.push('Outside the calibrated range [' + f4(xmin) + ', ' + f4(xmax) + ']: extrapolated.'); }
      if (lod != null && x0 < lod) { out.flags.push('belowLOD'); out.notes.push('Below the LOD (' + f4(lod) + '): report as "not detected" / < LOD.'); }
      else if (loq != null && x0 < loq) { out.flags.push('belowLOQ'); out.notes.push('Below the LOQ (' + f4(loq) + '): detected but not quantifiable with the stated precision.'); }
      out.formula = F('x̂₀ = solve f(x₀) = ȳ₀;  s(x̂₀)² = [s²/(m·w(x₀)) + gᵀ·Cov(b)·g] / f′(x₀)²,  g = ∂f/∂b at x₀;  x̂₀ ± t(' + (1 - alpha / 2) + ', ' + dof + ')·s(x̂₀)',
        { y0: +y0, m: m, s: syx, w_x0: w0, varFitAtX0: vf, fprime: d, t: tCrit }, x0,
        'Delta-method inverse prediction. For an unweighted straight line this equals the classic s_x0 = (s_y/x/b)·√(1/m + 1/n + (ȳ₀ − ȳ)²/(b²·Σ(xᵢ − x̄)²)).');
      return out;
    }
    var formulas = {
      model: F(CAL_MODELS[model], { names: names, coef: b }, b, 'Weighted least squares: b = (XᵀWX)⁻¹XᵀWy.'),
      weighting: F(wt === 'none' ? 'wᵢ = 1' : wt === '1/x' ? 'wᵢ ∝ 1/xᵢ' : 'wᵢ ∝ 1/xᵢ²', { normalisation: 'Σw = n' }, wt, 'Weights are normalised to sum to n so that s_y/x is in response units.'),
      se: F('SE(b) = √diag(s²·(XᵀWX)⁻¹)', { s2: s2 }, se, 'Standard errors of the coefficients.'),
      syx: F('s_y/x = √(Σ wᵢ(yᵢ − ŷᵢ)² / (n − p))', { SSE: sse, n: n, p: p }, syx, 'Residual standard deviation (standard error of the estimate).'),
      r2: F(model === 'linear0' ? 'R² = 1 − Σw(y − ŷ)² / Σw·y² (uncentred, through-origin)' : 'R² = 1 − Σw(y − ŷ)² / Σw(y − ȳ_w)²', { SSE: sse, SST: sst }, r2, 'R² alone does not demonstrate linearity; inspect the residual plot.'),
      adjR2: F('R²_adj = 1 − (1 − R²)(n − ' + k0 + ')/(n − p)', { n: n, p: p }, adjR2, ''),
      lod: F('LOD = 3.3·s_y/x / slope', { syx: syx, slope: slope }, lod, 'ICH Q2 approach based on the residual SD of the calibration line; assumes homoscedastic, normally distributed errors near the limit. Verify experimentally with spiked samples.'),
      loq: F('LOQ = 10·s_y/x / slope', { syx: syx, slope: slope }, loq, 'ICH Q2 approach; as for LOD.'),
      inverse: F('x̂₀ = f⁻¹(ȳ₀), s(x̂₀) by delta method, interval x̂₀ ± t·s(x̂₀)', { tCrit: tCrit, dof: dof }, null, 'See inverse(y).formula for the values used for a specific response.')
    };
    return {
      model: model, weighting: wt, n: n, p: p, dof: dof, coef: b, se: se, cov: cov, names: names, r2: r2, adjR2: adjR2, syx: syx, s2: s2, tCrit: tCrit, alpha: alpha,
      xRange: [xmin, xmax], xMean: xMean, yMean: yMean, Sxx: Sxx, slope: slope, intercept: b0, lod: lod, loq: loq, lodIntercept: lodIntercept,
      points: pts.map(function (q) { return { x: q.x, y: q.y, w: q.w, fitted: q.fitted, residual: q.residual, stdResidual: q.stdResidual }; }),
      residuals: pts.map(function (q) { return q.residual; }), notes: notes, formulas: formulas, equation: CAL_MODELS[model],
      predict: predict, predictBand: predictBand, inverse: inverse
    };
  };
  /** quantify(cal, response, {m, responses?}) → inverse(response) plus { conc, unit, fit }.
      cal: a calibrationFit() result, or an analyte { model, weighting, unit?, levels:[{ conc, response?, traceId?, include }] }
      (levels without a numeric response are looked up in opts.responses[traceId], else skipped). */
  A.quantify = function (cal, response, opts) {
    opts = opts || {}; var fit = cal, unit = null, skipped = 0;
    if (!cal || typeof cal.inverse !== 'function') {
      var lv = (cal && cal.levels) || [];
      var pts = lv.filter(function (l) { return l && l.include !== false; }).map(function (l) {
        var r = fin(+l.response) && l.response !== '' && l.response != null ? +l.response : (opts.responses && l.traceId != null ? +opts.responses[l.traceId] : NaN);
        if (!fin(r)) skipped++; if (!unit && l.unit) unit = l.unit;
        return { x: +l.conc, y: r };
      });
      fit = A.calibrationFit(pts, { model: cal && cal.model, weighting: cal && cal.weighting });
      unit = (cal && cal.unit) || unit;
    }
    var out = fit.inverse(response, opts); out.conc = out.x; out.unit = unit; out.fit = fit;
    if (skipped) out.notes.push(skipped + ' calibration level(s) had no response and were skipped.');
    return out;
  };

  /* ---------------- synthetic data & sample methods ---------------- */
  // mulberry32 PRNG + Box–Muller normals (deterministic, seedable)
  A.rng = function (seed) {
    var s = (seed == null ? 42 : seed) >>> 0, spare = null;
    function u() { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    return {
      uniform: u,
      normal: function () {
        if (spare !== null) { var v = spare; spare = null; return v; }
        var a = u() || 1e-12, b = u(), r = Math.sqrt(-2 * Math.log(a)); spare = r * Math.sin(2 * Math.PI * b); return r * Math.cos(2 * Math.PI * b);
      }
    };
  };
  A.DEFAULT_SYNTH_PEAKS = [ // mu (min), height (mAU at apex), sigma, tau (min)
    { mu: 2.10, height: 35, sigma: 0.030, tau: 0.010 }, { mu: 4.80, height: 120, sigma: 0.045, tau: 0.020 },
    { mu: 7.35, height: 60, sigma: 0.050, tau: 0.015 }, { mu: 7.62, height: 45, sigma: 0.050, tau: 0.020 },
    { mu: 10.20, height: 200, sigma: 0.055, tau: 0.060 }, { mu: 13.10, height: 8, sigma: 0.060, tau: 0.010 },
    { mu: 15.70, height: 90, sigma: 0.060, tau: 0.030 }, { mu: 18.20, height: 40, sigma: 0.070, tau: 0.040 }
  ];
  /** syntheticChromatogram({tMax=20, n=4001, peaks, drift=true|false|fn(t), noise=0.05, seed=42})
      → { x, y, truth:{ peaks:[{rt (apex), mu, area, height, sigma, tau, A}], baseline[], noise } }.
      Peaks: {mu|rt, height|A, sigma, tau(0 = Gaussian)}; height = apex height (A solved for). */
  A.syntheticChromatogram = function (opts) {
    opts = opts || {};
    var tMax = opts.tMax || 20, n = opts.n || 4001, x = U.linspace(0, tMax, n), sd = opts.noise == null ? 0.05 : opts.noise, R = A.rng(opts.seed == null ? 42 : opts.seed);
    var drift = opts.drift === false ? function () { return 0; } : typeof opts.drift === 'function' ? opts.drift
      : function (t) { return 1.5 + 0.25 * t + 1.2 * Math.sin(Math.PI * t / 14); };
    var specs = (opts.peaks || A.DEFAULT_SYNTH_PEAKS).map(function (q) {
      var mu = q.mu != null ? q.mu : q.rt, sg = q.sigma || 0.05, tau = q.tau > 0 ? q.tau : 0;
      var fn = tau ? function (t, a) { return A.emg(t, a, mu, sg, tau); } : function (t, a) { return A.gaussian(t, a, mu, sg); };
      var shp = tau ? shapeOf(function (t) { return fn(t, 1); }, mu, sg, tau) : { rt: mu, height: 1 };
      var a = q.A != null ? q.A : (q.height != null ? q.height : 10) / shp.height;
      return { fn: fn, A: a, truth: { rt: shp.rt, mu: mu, area: a * sg * SQ2PI, height: a * shp.height, sigma: sg, tau: tau, A: a } };
    });
    var base = new Array(n), y = new Array(n);
    for (var i = 0; i < n; i++) {
      var v = drift(x[i]); base[i] = v;
      for (var k = 0; k < specs.length; k++) v += specs[k].fn(x[i], specs[k].A);
      y[i] = v + sd * R.normal();
    }
    return { x: x, y: y, truth: { peaks: specs.map(function (s) { return s.truth; }), baseline: base, noise: sd } };
  };
  /** sampleTrace() → Trace partial for the app's built-in sample dataset. */
  A.sampleTrace = function () {
    var s = A.syntheticChromatogram();
    return { name: 'Sample (synthetic) 254 nm', x: s.x, y: s.y, xUnit: 'min', yUnit: 'mAU', source: { kind: 'sample' }, meta: { wavelength: 254, synthetic: true, sampleName: 'Synthetic test mix' } };
  };
  /** Realistic reversed-phase HPLC method (C18 150×4.6 mm, 5 µm; 5→95 %B in 20 min, hold, step back, re-equilibrate). */
  A.sampleMethod = function () {
    return {
      name: 'RP-HPLC generic gradient (C18)',
      gradient: [{ t: 0, B: 5, flow: 1 }, { t: 20, B: 95, flow: 1 }, { t: 23, B: 95, flow: 1 }, { t: 23, B: 5, flow: 1 }, { t: 30, B: 5, flow: 1 }],
      mode: 'linear', solventA: 'Water + 0.1% formic acid', solventB: 'Acetonitrile + 0.1% formic acid', bufferPH: 2.7,
      gradientType: 'organic', bConcUnit: '%',
      column: { name: 'C18', length_mm: 150, id_mm: 4.6, particle_um: 5, porosity: 0.65 },
      flow: 1.0, dwellVolume_mL: 1.1, wavelength_nm: 254, temperature_C: 30,
      notes: '5→95 %B linear over 20 min, 3 min hold at 95 %B, step to 5 %B at 23 min, 7 min re-equilibration.'
    };
  };
  /** IMAC (His-tag) FPLC method: imidazole wash step then linear elution gradient; 100 %B = 500 mM imidazole. */
  A.sampleFPLCMethod = function () {
    return {
      name: 'IMAC His-tag purification (1 mL Ni column)',
      gradient: [{ t: 0, B: 0, flow: 1 }, { t: 10, B: 0, flow: 1 }, { t: 10, B: 10, flow: 1 }, { t: 15, B: 10, flow: 1 },
        { t: 35, B: 100, flow: 1 }, { t: 40, B: 100, flow: 1 }, { t: 40, B: 0, flow: 1 }, { t: 45, B: 0, flow: 1 }],
      mode: 'linear', solventA: '20 mM sodium phosphate, 500 mM NaCl, pH 7.4', solventB: 'A + 500 mM imidazole', bufferPH: 7.4,
      gradientType: 'imidazole', bMaxConc: 500, bConcUnit: 'mM',
      column: { name: 'Ni Sepharose 1 mL', length_mm: 25, id_mm: 7, particle_um: 34, porosity: 0.35 },
      flow: 1.0, dwellVolume_mL: 0.6, wavelength_nm: 280, temperature_C: 4,
      notes: 'Load/wash 10 min at 0 %B; step to 10 %B (50 mM imidazole) 10–15 min; linear 10→100 %B 15–35 min; hold; strip back to 0 %B. Porosity 0.35 ≈ interstitial fraction for pore-excluded proteins.'
    };
  };

  /* ---------------- formula catalogue ---------------- */
  A.FORMULAS = {
    rt: { name: 'Retention time', expr: 't_R = x_k − b/(2a) (3-point parabola at apex)', unit: 'min', description: 'Apex time from parabolic interpolation through the highest sample and its two neighbours of the baseline-corrected signal.', ref: 'Standard parabolic peak interpolation' },
    height: { name: 'Height', expr: 'H = y(t_R) − b(t_R)', unit: 'y', description: 'Apex height above the straight drop-line baseline drawn between the integration bounds.', ref: 'USP <621>' },
    area: { name: 'Area', expr: 'A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]Δxᵢ', unit: 'y·min', description: 'Trapezoid integration between start and end above a straight baseline joining the signal at the two bounds (valley-to-valley / drop-line). Multiply by 60 for y·s (ChemStation mAU·s).', ref: 'Trapezoidal rule' },
    areaPct: { name: 'Area %', expr: '100·Aᵢ/ΣA', unit: '%', description: 'Share of the summed area of all integrated peaks; no response factors.', ref: '' },
    fwhm: { name: 'Width at half height', expr: 'W½ = t_r(H/2) − t_l(H/2)', unit: 'min', description: 'Linear interpolation between samples at 50% height. Gaussian: W½ = 2√(2ln2)·σ ≈ 2.3548σ.', ref: 'USP <621>; Ph. Eur. 2.2.46' },
    w5: { name: 'Width at 5% height', expr: 'W₀.₀₅ = t_r(0.05H) − t_l(0.05H)', unit: 'min', description: 'Used for the USP tailing factor.', ref: 'USP <621>' },
    tailing: { name: 'Tailing factor (USP)', expr: 'T = W₀.₀₅/(2f)', unit: '', description: 'f = distance from the leading edge at 5% height to the apex. 1.0 for a symmetric peak; >1 tailing, <1 fronting. Identical to the Ph. Eur. symmetry factor.', ref: 'USP <621>; Ph. Eur. 2.2.46' },
    asymmetry: { name: 'Asymmetry factor', expr: 'A_s = b/a (10% height)', unit: '', description: 'a, b = front and back half-widths at 10% height.', ref: 'Foley & Dorsey, Anal. Chem. 1983, 55, 730' },
    plates: { name: 'Plate number (half height)', expr: 'N = 5.54·(t_R/W½)²', unit: '', description: 'Column efficiency assuming a Gaussian peak; t_R measured from injection.', ref: 'USP <621>; Ph. Eur. 2.2.46' },
    platesUSP: { name: 'Plate number (tangent)', expr: 'N = 16·(t_R/W)²', unit: '', description: 'W = distance between baseline intercepts of tangents through the inflection points (max |slope|). Gaussian: W = 4σ.', ref: 'USP <621>' },
    resolution: { name: 'Resolution', expr: 'R_s = 1.18·(t_R2 − t_R1)/(W½,1 + W½,2)', unit: '', description: 'Versus the preceding peak in retention order. 1.18 = 2√(2ln2)/2. Baseline separation ≈ R_s ≥ 1.5.', ref: 'USP <621>; Ph. Eur. 2.2.46' },
    k: { name: 'Retention factor', expr: 'k = (t_R − t₀)/t₀', unit: '', description: 'Requires a void time t₀ (method override or estimated from column geometry).', ref: 'USP <621>' },
    sn: { name: 'Signal-to-noise', expr: 'S/N = 2H/h', unit: '', description: 'h = peak-to-peak baseline noise. Default h = 6σ with σ = 1.4826·MAD(Δy)/√2 (i.e. S/N = H/3σ); with a chosen blank range, h is the measured max−min of the detrended blank.', ref: 'Ph. Eur. 2.2.46; USP <621>' },
    dwellTime: { name: 'Dwell time', expr: 't_D = V_D/F', unit: 'min', description: 'Delay between the pump mixer and the column inlet; constant flow assumed.', ref: 'Snyder & Dolan, High-Performance Gradient Elution (2007)' },
    voidTime: { name: 'Void time', expr: 't₀ = ε·π·(d/2)²·L/1000/F', unit: 'min', description: 'Column volume from geometry (mm³ → mL ÷1000) times total porosity ε (≈0.65 for fully porous silica).', ref: 'Snyder, Kirkland & Dolan, Introduction to Modern LC (2010)' },
    Bat: { name: '%B at elution', expr: 'B_elution = B_program(max(0, t_R − t_D − t₀))', unit: '%', description: 'Mobile phase composition that left the mixer t_D + t₀ before the peak reached the detector.', ref: 'Snyder & Dolan (2007)' },
    conc: { name: 'Eluent concentration', expr: 'c = c_A + (c_B,max − c_A)·B/100', unit: 'mM', description: 'Salt/imidazole concentration assuming linear volumetric mixing; c_A = method.aConc (default 0).', ref: '' },
    fitArea: { name: 'Fitted area', expr: 'Area = A·σ·√(2π)', unit: 'y·min', description: 'Gaussian or EMG (Gaussian-amplitude parameterisation) component area; SE by delta method from s²(JᵀJ)⁻¹.', ref: 'Marquardt 1963; Grushka 1972; Kalambet et al. 2011' }
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
