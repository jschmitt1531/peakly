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
  /** noise(x, y, {range?:[t0,t1]}) → { sigma, p2p, method }.
      Default: σ = 1.4826·MAD(Δy)/√2 (robust to peaks and drift); p2p = 6σ.
      With range (a blank region): linear detrend, σ = residual SD, p2p = measured max−min (EP 2.2.46 style). */
  A.noise = function (x, y, opts) {
    opts = opts || {}; var n = y.length, i;
    if (opts.range && n > 3) {
      var i0 = U.bsearch(x, opts.range[0]), i1 = Math.min(n - 1, U.bsearch(x, opts.range[1]) + 1), m = i1 - i0 + 1;
      if (m >= 4) {
        var sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (i = i0; i <= i1; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
        var b1 = (m * sxy - sx * sy) / (m * sxx - sx * sx || 1), b0 = (sy - b1 * sx) / m, ss = 0, mn = Infinity, mx = -Infinity;
        for (i = i0; i <= i1; i++) { var r = y[i] - b0 - b1 * x[i]; ss += r * r; if (r < mn) mn = r; if (r > mx) mx = r; }
        return { sigma: Math.sqrt(ss / (m - 2)), p2p: mx - mn, method: 'p2p-range', range: [x[i0], x[i1]] };
      }
    }
    if (n < 3) return { sigma: 0, p2p: 0, method: 'mad-diff' };
    var d = new Float64Array(n - 1); for (i = 0; i < n - 1; i++) d[i] = y[i + 1] - y[i];
    var med = fmedian(d), mad = fmedian(d.map(function (v) { return Math.abs(v - med); })), sigma = 1.4826 * mad / Math.SQRT2;
    if (!(sigma > 0)) { // quantised/staircase data: fall back to non-robust SD of differences
      var s2 = 0; for (i = 0; i < d.length; i++) s2 += d[i] * d[i]; sigma = Math.sqrt(s2 / d.length) / Math.SQRT2;
    }
    return { sigma: sigma, p2p: 6 * sigma, method: 'mad-diff' };
  };

  /* ---------------- peak detection ---------------- */
  // Walk from apex i toward lim until the (smoothed) signal returns to near the lowest level in that range
  // (return-to-baseline), else stop at that minimum (valley).
  function sideBound(ys, i, lim, sig) {
    var step = lim < i ? -1 : 1; if (lim === i) return i;
    var mi = argminDir(ys, i + step, lim), mn = ys[mi];
    var level = mn + Math.max(0.005 * (ys[i] - mn), 2 * sig), rise = Math.max(3 * sig, 0.01 * (ys[i] - mn)), rm = i;
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
    var dx = (x[n - 1] - x[0]) / (n - 1), sig = A.noise(x, y).sigma || 0;
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
      for (k = c - 1; k >= 0 && ys[k] <= v; k--) if (ys[k] < lmin) lmin = ys[k];
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
      var d2 = A.savitzkyGolay(y, Math.min(odd(1.5 * w), n % 2 ? n : n - 1), 3, 2), s2 = robustSD(d2), sh = [];
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
    return mergeKeep(out, opts.keep);
  };
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
  function metricsOne(x, y, pk, nz, t0) {
    var s = Math.min(pk.start, pk.end), e = Math.max(pk.start, pk.end), n = x.length, i;
    var yS = U.interp1(x, y, s), yE = U.interp1(x, y, e), slope = e > s ? (yE - yS) / (e - s) : 0;
    var X = [s], Y = [0]; // signal above the straight drop-line baseline through the two bound points
    for (i = U.bsearch(x, s); i < n && x[i] < e; i++) if (x[i] > s) { X.push(x[i]); Y.push(y[i] - (yS + slope * (x[i] - s))); }
    X.push(e); Y.push(0);
    var m = X.length, area = 0; for (i = 0; i < m - 1; i++) area += 0.5 * (Y[i] + Y[i + 1]) * (X[i + 1] - X[i]);
    var f = {}, out = { id: pk.id, start: s, end: e, area: area, formulas: f };
    f.area = F('A = Σ ½[(yᵢ−bᵢ)+(yᵢ₊₁−bᵢ₊₁)]·(xᵢ₊₁−xᵢ), b = straight line through (t_start, y_start)–(t_end, y_end)',
      { t_start: s, t_end: e, y_start: yS, y_end: yE, nPoints: m }, area, 'Trapezoid integration above a drop-line baseline. Units: y-unit·min (×60 for y-unit·s).', 'y·min');
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
  /** peakMetrics(x, y, peaks, {voidTime?, noise?: σ number | {sigma,p2p,method}}) → Metric[] aligned with peaks. */
  A.peakMetrics = function (x, y, peaks, opts) {
    opts = opts || {}; peaks = peaks || [];
    var nz = opts.noise == null ? A.noise(x, y) : typeof opts.noise === 'number' ? { sigma: opts.noise, p2p: 6 * opts.noise, method: 'user σ' }
      : { sigma: opts.noise.sigma, p2p: opts.noise.p2p != null ? opts.noise.p2p : 6 * opts.noise.sigma, method: opts.noise.method || 'user' };
    var t0 = fin(opts.voidTime) && opts.voidTime > 0 ? opts.voidTime : null;
    var ms = peaks.map(function (p) { return metricsOne(x, y, p, nz, t0); });
    var tot = 0; ms.forEach(function (m) { tot += m.area; });
    ms.forEach(function (m) {
      m.areaPct = tot ? 100 * m.area / tot : null;
      m.formulas.areaPct = F('Area% = 100·Aᵢ / ΣA', { A_i: m.area, sumA: tot, nPeaks: ms.length }, m.areaPct, 'Relative to the sum of all integrated peaks (no response factors).', '%');
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
