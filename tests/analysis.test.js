/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/analysis.js */
(function (PK) {
  'use strict';
  var A = PK.analysis, U = PK.util, SQ2PI = Math.sqrt(2 * Math.PI);
  function gaussTrace(peaks, opts) { // peaks: [{A,mu,sigma,tau?}], uniform grid, optional seeded noise
    opts = opts || {}; var x = U.linspace(opts.t0 || 0, opts.t1 || 10, opts.n || 2001), R = A.rng(opts.seed || 7);
    var y = x.map(function (t) {
      var v = 0; peaks.forEach(function (p) { v += p.tau ? A.emg(t, p.A, p.mu, p.sigma, p.tau) : A.gaussian(t, p.A, p.mu, p.sigma); });
      return v + (opts.noise ? opts.noise * R.normal() : 0);
    });
    return { x: x, y: y };
  }
  function sd(a) { var m = 0, s = 0; a.forEach(function (v) { m += v; }); m /= a.length; a.forEach(function (v) { s += (v - m) * (v - m); }); return Math.sqrt(s / (a.length - 1)); }
  var gp = { mu: 5, sigma: 0.1 }; // single Gaussian peak, ±6σ bounds
  function onePeak(x) { return { id: 'p1', start: 5 - 0.6, apex: 5, end: 5 + 0.6 }; }

  PK.test('analysis: erfcx accuracy and EMG area', function (t) {
    t.near(A.erfcx(1) * Math.exp(-1), 0.15729920705028513, 1e-14, 'erfc(1)');
    t.near(A.erfcx(3) * Math.exp(-9) / 2.209049699858544e-05, 1, 1e-12, 'erfc(3) rel');
    t.near(A.erfcx(10), 0.05614099274382259, 1e-14, 'erfcx(10)');
    t.ok(isFinite(A.emg(5, 1, 5, 0.1, 1e-6)) && Math.abs(A.emg(5, 1, 5, 0.1, 1e-6) - 1) < 1e-4, 'EMG → Gaussian as τ→0, no overflow');
    var s = 0, dx = 1e-3; for (var x = 0; x < 30; x += dx) s += A.emg(x, 2, 5, 0.1, 0.5) * dx;
    t.near(s / (2 * 0.1 * SQ2PI), 1, 1e-6, 'EMG area = A·σ·√2π');
  });

  PK.test('analysis: SG preserves polynomials (incl. edges) and derivatives', function (t) {
    var x = U.linspace(-1, 2, 301), dx = x[1] - x[0], y = x.map(function (v) { return 2 - v + 0.5 * v * v - 0.3 * v * v * v; });
    var s = A.savitzkyGolay(y, 15, 3), e = 0; s.forEach(function (v, i) { e = Math.max(e, Math.abs(v - y[i])); });
    t.ok(e < 1e-9, 'cubic preserved by order-3 filter everywhere, max err ' + e);
    var d = A.savitzkyGolay(y, 11, 3, 1, dx), ed = 0; d.forEach(function (v, i) { ed = Math.max(ed, Math.abs(v - (-1 + x[i] - 0.9 * x[i] * x[i]))); });
    t.ok(ed < 1e-7, 'first derivative exact for cubic, max err ' + ed);
    var d2 = A.savitzkyGolay(y, 9, 3, 2, dx); t.near(d2[0], 1 - 1.8 * x[0], 1e-6, 'second derivative at left edge');
    t.eq(A.savitzkyGolay([1, 2], 5, 2).length, 2, 'short input ok');
    t.eq(A.savitzkyGolay(new Float64Array([1, 2, 3, 4, 5, 6, 7]), 5, 2)[3], 4, 'typed array input');
  });

  PK.test('analysis: SG reduces noise', function (t) {
    var R = A.rng(3), x = U.linspace(0, 10, 2000), clean = x.map(function (v) { return Math.sin(v); }), y = clean.map(function (v) { return v + 0.1 * R.normal(); });
    var s = A.savitzkyGolay(y, 31, 2), rIn = sd(y.map(function (v, i) { return v - clean[i]; })), rOut = sd(s.map(function (v, i) { return v - clean[i]; }));
    t.ok(rOut < 0.4 * rIn, 'residual SD ' + rIn.toFixed(4) + ' → ' + rOut.toFixed(4));
  });

  PK.test('analysis: ALS recovers baseline under peaks', function (t) {
    var syn = A.syntheticChromatogram({ seed: 11 });
    var bl = A.alsBaseline(syn.y, { lambda: 1e8, p: 0.001, iter: 20 }), r = 0, drift = 0;
    for (var i = 0; i < bl.length; i++) { r += Math.pow(bl[i] - syn.truth.baseline[i], 2); drift = Math.max(drift, syn.truth.baseline[i]); }
    r = Math.sqrt(r / bl.length);
    t.ok(r < 0.15, 'baseline RMS error ' + r.toFixed(3) + ' (drift up to ' + drift.toFixed(1) + ', largest peak 200 mAU)');
    var flat = A.alsBaseline([3, 3, 3, 3, 3, 3]); t.near(flat[2], 3, 0.05, 'constant passes through (weights 1−p)');
  });

  PK.test('analysis: ALS banded solve is O(n) fast', function (t) {
    var y20 = A.syntheticChromatogram({ n: 20001 }).y, t0 = Date.now();
    A.alsBaseline(y20, { lambda: 1e9, p: 0.001, iter: 10 });
    var ms = Date.now() - t0; t.ok(ms < 300, '20k points × 10 iterations took ' + ms + ' ms');
    var y100 = A.syntheticChromatogram({ n: 100001 }).y; t0 = Date.now();
    var b = A.alsBaseline(y100, { lambda: 1e10, p: 0.001, iter: 10 }); ms = Date.now() - t0;
    t.ok(ms < 1000 && b.length === 100001 && isFinite(b[50000]), '100k points took ' + ms + ' ms');
  });

  PK.test('analysis: process applies smoothing then baseline', function (t) {
    var syn = A.syntheticChromatogram();
    var tr = { x: syn.x, y: syn.y, proc: { smooth: { on: true, window: 7, order: 2 }, baseline: { on: true, lambda: 1e8, p: 0.001, iter: 10 } } };
    var r = A.process(tr);
    t.eq(r.y.length, syn.x.length, 'length'); t.ok(r.yRaw[10] === syn.y[10], 'raw kept');
    t.near(r.y[100] + r.baseline[100], r.ySmooth[100], 1e-9, 'y = smooth − baseline');
    var off = A.process({ x: [0, 1, 2], y: [1, 2, 3] }); t.eq(off.y[1], 2, 'no proc = passthrough');
  });

  PK.test('analysis: noise estimate', function (t) {
    var R = A.rng(5), x = U.linspace(0, 10, 5000), y = x.map(function (v) { return 0.2 * v + 0.1 * R.normal() + A.gaussian(v, 50, 5, 0.1); });
    var nz = A.noise(x, y); t.near(nz.sigma, 0.1, 0.008, 'MAD-diff σ'); t.near(nz.p2p, 6 * nz.sigma, 1e-12, 'p2p = 6σ');
    var nr = A.noise(x, y, { range: [7, 9] }); t.eq(nr.method, 'p2p-range', 'range method'); t.near(nr.sigma, 0.1, 0.01, 'range σ after detrend');
    t.ok(nr.p2p > 4 * 0.1 && nr.p2p < 9 * 0.1, 'measured p2p ' + nr.p2p);
  });

  PK.test('analysis: detectPeaks finds synthetic peaks', function (t) {
    var syn = A.syntheticChromatogram({ seed: 2 }), bl = A.alsBaseline(syn.y, { lambda: 1e8, p: 0.001, iter: 20 });
    var y = syn.y.map(function (v, i) { return v - bl[i]; }), pk = A.detectPeaks(syn.x, y, { threshold: 'auto' });
    t.eq(pk.length, syn.truth.peaks.length, 'peak count');
    syn.truth.peaks.forEach(function (tp) {
      var hit = pk.filter(function (p) { return Math.abs(p.apex - tp.rt) < 0.02; })[0];
      t.ok(hit && hit.start < tp.rt && hit.end > tp.rt, 'found peak at ' + tp.rt.toFixed(3));
    });
    var crit = pk.filter(function (p) { return p.apex > 7 && p.apex < 8; });
    t.ok(crit.length === 2 && crit[0].end <= crit[1].start + 1e-9, 'critical pair split at valley');
    t.eq(A.detectPeaks(syn.x, y, { threshold: 50 }).length, 4, 'threshold in y units (prominence)');
    t.eq(A.detectPeaks(syn.x, y, { minDist: 0.5 }).filter(function (p) { return p.apex > 7 && p.apex < 8; }).length, 1, 'minDist suppresses smaller neighbour');
    t.eq(A.detectPeaks(syn.x, y, { minWidth: 0.2 }).length, 0, 'minWidth filters narrow peaks');
  });

  PK.test('analysis: detectPeaks flags a shoulder', function (t) {
    var d = gaussTrace([{ A: 100, mu: 5, sigma: 0.1 }, { A: 25, mu: 5.25, sigma: 0.08 }], { noise: 0.05 });
    var pk = A.detectPeaks(d.x, d.y, {});
    t.eq(pk.length, 2, 'main + shoulder'); var sh = pk.filter(function (p) { return p.shoulder; })[0];
    t.ok(sh && Math.abs(sh.apex - 5.25) < 0.06, 'shoulder near 5.25: ' + (sh && sh.apex));
    t.ok(pk[0].end === pk[1].start, 'perpendicular drop between main and shoulder');
  });

  PK.test('analysis: detectPeaks keeps manual peaks and drops overlapping auto peaks', function (t) {
    var d = gaussTrace([{ A: 10, mu: 3, sigma: 0.1 }, { A: 10, mu: 6, sigma: 0.1 }], { noise: 0.02 });
    var man = { id: 'man1', start: 2.9, apex: 3, end: 3.05, manual: true };
    var pk = A.detectPeaks(d.x, d.y, { keep: [man] });
    t.eq(pk.length, 2, 'one kept + one auto'); t.eq(pk[0].id, 'man1', 'manual kept'); t.eq(pk[0].start, 2.9, 'exact start'); t.eq(pk[0].end, 3.05, 'exact end');
    t.ok(Math.abs(pk[1].apex - 6) < 0.02, 'non-overlapping auto peak retained');
    var r = A.refineBounds(d.x, d.y, man); t.eq(r.start, 2.9, 'refineBounds leaves manual start'); t.eq(r.end, 3.05, 'refineBounds leaves manual end');
  });

  PK.test('analysis: peakAt and refineBounds', function (t) {
    var d = gaussTrace([{ A: 10, mu: 3, sigma: 0.1 }, { A: 8, mu: 3.5, sigma: 0.1 }], { noise: 0.02 });
    var p = A.peakAt(d.x, d.y, 3.04); t.ok(p.manual && Math.abs(p.apex - 3) < 0.02, 'apex near click: ' + p.apex);
    t.ok(p.start < 2.75 && p.end > 3.15 && p.end < 3.4, 'bounds ' + p.start.toFixed(3) + '–' + p.end.toFixed(3));
    var rb = A.refineBounds(d.x, d.y, { id: 'q', start: 2.6, apex: 3.0, end: 3.32 });
    t.ok(Math.abs(rb.end - 3.25) < 0.05, 'end snapped toward valley: ' + rb.end); t.eq(rb.id, 'q', 'id kept');
  });

  PK.test('analysis: area, height, fwhm, rt of a Gaussian', function (t) {
    var d = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }]);
    var m = A.peakMetrics(d.x, d.y, [onePeak()], { noise: 0.01 })[0];
    var exact = 10 * 0.1 * SQ2PI;
    t.ok(Math.abs(m.area / exact - 1) < 0.005, 'area ' + m.area + ' vs ' + exact);
    t.near(m.fwhm, 2.35482 * 0.1, 0.002 * 0.235, 'fwhm = 2.3548σ');
    t.near(m.rt, 5, 1e-4, 'rt'); t.near(m.height, 10, 0.01, 'height'); t.near(m.areaPct, 100, 1e-9, 'area% single');
    t.near(m.w5, 2 * Math.sqrt(2 * Math.log(20)) * 0.1, 0.002, 'w5');
    ['rt', 'height', 'area', 'areaPct', 'fwhm', 'w5', 'tailing', 'asymmetry', 'plates', 'platesUSP', 'resolution', 'k', 'sn'].forEach(function (k) {
      var f = m.formulas[k]; t.ok(f && typeof f.expr === 'string' && f.inputs && 'value' in f && typeof f.note === 'string', 'formula entry ' + k);
      t.ok(PK.analysis.FORMULAS[k], 'FORMULAS.' + k);
    });
    t.eq(m.formulas.area.value, m.area, 'formula value matches');
  });

  PK.test('analysis: integrateWindow of Gaussian ±4σ', function (t) {
    var d = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }], { n: 2001 }), p = A.integrateWindow(d.x, d.y, 4.6, 5.4);
    t.ok(p.manual && p.start === 4.6 && p.end === 5.4, 'exact bounds, manual');
    var m = A.peakMetrics(d.x, d.y, [p], { noise: 0.01 })[0], exact = 10 * 0.1 * SQ2PI;
    t.ok(Math.abs(m.area / exact - 1) < 0.005, 'area ' + m.area.toFixed(5) + ' vs analytic ' + exact.toFixed(5));
    t.near(m.rt, 5, 1e-4, 'parabolic apex');
    var off = A.integrateWindow(d.x, d.y, 4.7013, 5.3021); // off-grid bounds use interpolated endpoints
    t.eq(A.peakMetrics(d.x, d.y, [off])[0].start, 4.7013, 'off-grid start kept');
  });

  PK.test('analysis: plates, tailing, asymmetry', function (t) {
    var d = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }]), m = A.peakMetrics(d.x, d.y, [onePeak()], { noise: 0.01 })[0];
    t.near(m.plates, 5.54 * Math.pow(m.rt / m.fwhm, 2), 1e-6, 'N = 5.54(tR/W½)²');
    t.near(m.plates, 5.54 / 5.5452 * 2500, 10, 'N ≈ (tR/σ)² for Gaussian');
    t.near(m.platesUSP, 2500, 40, 'tangent N = 16(tR/4σ)²');
    t.near(m.tailing, 1, 0.01, 'Gaussian tailing ≈ 1'); t.near(m.asymmetry, 1, 0.01, 'Gaussian As ≈ 1');
    var e = gaussTrace([{ A: 10, mu: 5, sigma: 0.1, tau: 0.1 }]), me = A.peakMetrics(e.x, e.y, [{ id: 'e', start: 4.4, end: 6.5 }], { noise: 0.01 })[0];
    t.ok(me.tailing > 1.2 && me.asymmetry > me.tailing, 'EMG tails: T=' + me.tailing.toFixed(3) + ' As=' + me.asymmetry.toFixed(3));
  });

  PK.test('analysis: resolution, k, S/N', function (t) {
    var d = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }, { A: 10, mu: 5.8, sigma: 0.1 }]);
    var ms = A.peakMetrics(d.x, d.y, [{ id: 'b', start: 5.4, end: 6.4 }, { id: 'a', start: 4.4, end: 5.4 }], { voidTime: 1, noise: 0.01 });
    t.eq(ms[0].id, 'b', 'aligned with input order'); t.eq(ms[1].resolution, null, 'first eluting has no Rs');
    t.near(ms[0].resolution, 1.18 * 0.8 / (2 * 2.35482 * 0.1), 0.01, 'Rs');
    t.near(ms[1].k, 4, 1e-3, "k' = (tR−t0)/t0"); t.near(ms[0].areaPct + ms[1].areaPct, 100, 1e-9, 'area% sums');
    var n = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }], { noise: 0.1, n: 4001, seed: 9 }), mn = A.peakMetrics(n.x, n.y, [onePeak()])[0];
    t.ok(Math.abs(mn.sn / (2 * 10 / 0.6) - 1) < 0.12, 'S/N ≈ 2H/(6σ) = 33.3: ' + mn.sn.toFixed(1));
    t.near(A.peakMetrics(n.x, n.y, [onePeak()], { noise: { sigma: 0.1, p2p: 0.5 } })[0].sn, 2 * mn.height / 0.5, 1e-9, 'user p2p');
  });

  PK.test('analysis: gradientAt linear/step/hold/isocratic', function (t) {
    var m = A.sampleMethod();
    t.eq(A.gradientAt(m, -1).B, 5, 'hold before'); t.near(A.gradientAt(m, 10).B, 50, 1e-9, 'linear midpoint');
    t.eq(A.gradientAt(m, 22).B, 95, 'hold'); t.eq(A.gradientAt(m, 22.999).B, 95, 'before step'); t.eq(A.gradientAt(m, 23).B, 5, 'step at t');
    t.eq(A.gradientAt(m, 99).B, 5, 'hold after'); t.eq(A.gradientAt(m, 5).flow, 1, 'flow');
    var s = { gradient: [{ t: 0, B: 10 }, { t: 5, B: 50 }], mode: 'step', flow: 2 };
    t.eq(A.gradientAt(s, 4.9).B, 10, 'step mode holds'); t.eq(A.gradientAt(s, 5).B, 50, 'step mode switches'); t.eq(A.gradientAt(s, 1).flow, 2, 'method flow');
    t.eq(A.gradientAt({ gradient: [{ t: 0, B: 30 }, { t: 10, B: 90 }], gradientType: 'isocratic', flow: 1 }, 7).B, 30, 'isocratic type');
    t.eq(A.gradientAt({ gradient: [{ t: 0, B: 40 }], flow: 1 }, 7).B, 40, 'single row isocratic');
    var f = A.sampleFPLCMethod(); var g = A.gradientAt(f, 25);
    t.near(g.B, 55, 1e-9, 'FPLC linear'); t.near(g.conc, 275, 1e-9, 'imidazole mM'); t.eq(g.unit, 'mM', 'unit');
    t.eq(A.gradientAt(f, 12).conc, 50, 'wash step 50 mM');
  });

  PK.test('analysis: dwell, void, Bat, gradientCurve', function (t) {
    var m = A.sampleMethod();
    t.near(A.dwellTime(m), 1.1, 1e-12, 'dwell 1.1 mL / 1 mL/min');
    var v0 = 0.65 * Math.PI * 2.3 * 2.3 * 150 / 1000; t.near(A.voidVolume(m), v0, 1e-12, 'V0 mL'); t.near(A.voidTime(m), 1.6203, 1e-4, 't0 ≈ 1.62 min');
    t.eq(A.voidTime({ voidTime_min: 1.3, column: m.column, flow: 1 }), 1.3, 'override');
    t.near(A.Bat(m, 10), 5 + 90 * (10 - 1.1 - v0) / 20, 1e-9, 'Bat');
    t.eq(A.Bat(m, 1), 5, 'Bat clamps before start'); t.ok(A.elution(m, 10).formula.expr.length > 0, 'elution formula');
    var c = A.gradientCurve(m, 30, 301);
    t.near(U.interp1(c.t, c.B, 11.1), 50, 1e-6, 'curve shifted by dwell');
    var i = c.t.indexOf(24.1); t.ok(i > 0 && c.B[i] === 5 && c.B[i - 1] === 95, 'exact step in curve');
    var cf = A.gradientCurve(A.sampleFPLCMethod(), 45, 100); t.ok(cf.conc && cf.conc.length === cf.t.length && cf.unit === 'mM', 'conc array');
    t.ok(A.gradientCurve(m, 30, 50, { includeVoid: true }).delay > 2.7, 'includeVoid delay');
  });

  PK.test('analysis: normalize, align, difference', function (t) {
    var x = [0, 1, 2, 3, 4], y = [0, 2, 4, 2, 0];
    t.eq(A.normalize({ x: x, y: y }, 'max').y[2], 1, 'max');
    t.near(A.normalize({ x: x, y: y }, 'area').factor, 1 / 8, 1e-12, 'area');
    t.eq(A.normalize({ x: x, y: y }, 'max', { range: [2.5, 4] }).y[2], 2, 'max within range');
    t.eq(A.normalize({ x: x, y: y }, 'none').y[2], 4, 'none');
    t.eq(A.align(x, 0.5)[0], 0.5, 'align');
    var d = A.difference({ x: x, y: y }, { x: [0.5, 1.5, 2.5, 3.5], y: [1, 1, 3, 3] });
    t.ok(isNaN(d.y[0]) && d.y[1] === 1 && d.y[2] === 2, 'difference resamples B onto A, NaN outside');
  });

  PK.test('analysis: fitPeaks two overlapping Gaussians', function (t) {
    var tr = [{ A: 10, mu: 5, sigma: 0.08 }, { A: 6, mu: 5.25, sigma: 0.1 }], d = gaussTrace(tr, { noise: 0.05, seed: 21 });
    var pk = [{ id: 'a', start: 4.6, apex: 5, end: 5.12 }, { id: 'b', start: 5.12, apex: 5.25, end: 5.7 }];
    var r = A.fitPeaks(d.x, d.y, pk, { model: 'gaussian' });
    t.ok(r.converged, 'converged in ' + r.iterations); t.ok(r.r2 > 0.99, 'r2 ' + r.r2); t.eq(r.dof, r.curve.x.length - 6, 'dof');
    r.components.forEach(function (c, i) {
      var tp = tr[i], area = tp.A * tp.sigma * SQ2PI;
      t.near(c.params.mu, tp.mu, 0.005, c.id + ' mu'); t.near(c.params.sigma, tp.sigma, 0.005, c.id + ' sigma');
      t.ok(c.areaSE > 0 && c.areaSE < 0.05 * area, c.id + ' areaSE ' + c.areaSE);
      t.ok(Math.abs(c.area - area) < 3 * c.areaSE, c.id + ' true area within 3 SE: ' + c.area.toFixed(4) + '±' + c.areaSE.toFixed(4) + ' vs ' + area.toFixed(4));
      t.near(c.fwhm, 2.35482 * c.params.sigma, 1e-5, 'fwhm');
    });
    t.eq(r.curve.perComponent.length, 2, 'per-component curves'); t.ok(r.cov && r.cov.length === 6, 'covariance 6×6');
  });

  PK.test('analysis: fitPeaks EMG recovers tau and area', function (t) {
    var tp = { A: 10, mu: 5, sigma: 0.06, tau: 0.12 }, d = gaussTrace([tp], { noise: 0.03, seed: 4 });
    var pk = A.detectPeaks(d.x, d.y, {}); t.eq(pk.length, 1, 'detected');
    var r = A.fitPeaks(d.x, d.y, pk, { model: 'emg' }), c = r.components[0], area = tp.A * tp.sigma * SQ2PI;
    t.ok(r.converged, 'converged in ' + r.iterations); t.ok(r.r2 > 0.999, 'r2 ' + r.r2);
    t.near(c.params.tau, tp.tau, 0.01, 'tau'); t.near(c.params.sigma, tp.sigma, 0.005, 'sigma'); t.near(c.params.mu, tp.mu, 0.01, 'mu');
    t.ok(Math.abs(c.area - area) < 3 * c.areaSE && c.areaSE < 0.02 * area, 'area ' + c.area.toFixed(4) + '±' + c.areaSE.toFixed(4) + ' vs ' + area.toFixed(4));
    t.ok(c.rt > tp.mu && c.rt < tp.mu + tp.tau, 'apex shifted right of mu: ' + c.rt);
    var lb = A.fitPeaks(d.x, d.y.map(function (v, i) { return v + 1 + 0.2 * d.x[i]; }), pk, { model: 'emg', baseline: 'linear' });
    t.ok(lb.converged && Math.abs(lb.components[0].area / area - 1) < 0.03, 'with linear local baseline: area ' + lb.components[0].area.toFixed(4));
  });

  PK.test('analysis: synthetic chromatogram & sample methods', function (t) {
    var a = A.syntheticChromatogram({ seed: 5 }), b = A.syntheticChromatogram({ seed: 5 });
    t.eq(a.y[1234], b.y[1234], 'deterministic'); t.eq(a.x.length, 4001, 'default n');
    t.ok(a.truth.peaks.length === 8 && a.truth.peaks.every(function (p) { return p.area > 0 && p.rt >= p.mu; }), 'truth peaks');
    t.near(a.truth.peaks[4].height, 200, 1e-6, 'apex height honoured for EMG');
    var m = A.sampleMethod(); t.eq(m.column.length_mm, 150, 'C18 150 mm'); t.eq(m.wavelength_nm, 254, '254 nm');
    var f = A.sampleFPLCMethod(); t.eq(f.bMaxConc, 500, 'bMaxConc'); t.eq(f.gradientType, 'imidazole', 'imidazole');
    t.eq(A.sampleTrace().source.kind, 'sample', 'sample trace');
  });

  /* ---------------- Round 4: integration modes ---------------- */
  // two Gaussians σ = 0.1, Rs = Δμ/(4σ); bounds at ±4σ outside and split at the valley
  function pairCase(h2, rs, noise) {
    var s = 0.1, mu2 = 5 + 4 * s * rs, d = gaussTrace([{ A: 10, mu: 5, sigma: s }, { A: h2, mu: mu2, sigma: s }], { noise: noise || 0, seed: 13 });
    var vi = 0, best = Infinity; d.x.forEach(function (t, i) { if (t > 5 && t < mu2 && d.y[i] < best) { best = d.y[i]; vi = i; } });
    return { d: d, truth: [10 * s * SQ2PI, h2 * s * SQ2PI], peaks: [{ id: 'a', start: 4.4, apex: 5, end: d.x[vi] }, { id: 'b', start: d.x[vi], apex: mu2, end: mu2 + 0.6 }] };
  }
  // EMG parent with a long exponential tail and a Gaussian rider; ratio = parent apex height / rider height
  function riderCase(ratio, opts) {
    opts = opts || {}; var x = U.linspace(0, 12, 4001), par = { A: 100, mu: 3, sigma: 0.1, tau: 0.6 }, R = A.rng(opts.seed || 5);
    var hp = 0; x.forEach(function (t) { hp = Math.max(hp, A.emg(t, par.A, par.mu, par.sigma, par.tau)); });
    var rid = { A: hp / ratio, mu: opts.mu || 4.6, sigma: 0.05 }, mirror = !!opts.front;
    var y = x.map(function (t) { var tt = mirror ? 12 - t : t; return A.emg(tt, par.A, par.mu, par.sigma, par.tau) + A.gaussian(tt, rid.A, rid.mu, rid.sigma) + (opts.noise ? opts.noise * R.normal() : 0); });
    var lo = mirror ? 12 - rid.mu : 3.6, hi = mirror ? 12 - 3.6 : rid.mu, vi = 0, best = Infinity;
    x.forEach(function (t, i) { if (t > lo && t < hi && y[i] < best) { best = y[i]; vi = i; } });
    var pk = mirror ? [{ id: 'R', start: 0.5, apex: 12 - rid.mu, end: x[vi] }, { id: 'P', start: x[vi], apex: 12 - 3.15, end: 9.6 }]
      : [{ id: 'P', start: 2.4, apex: 3.15, end: x[vi] }, { id: 'R', start: x[vi], apex: rid.mu, end: 11.5 }];
    return { x: x, y: y, peaks: pk, rider: rid.A * rid.sigma * SQ2PI, parent: par.A * par.sigma * SQ2PI, riderH: rid.A };
  }
  function byId(rs, id) { return rs.filter(function (r) { return r.id === id; })[0]; }

  PK.test('analysis: clusters() groups fused peaks only', function (t) {
    var c = pairCase(10, 1.0);
    t.eq(JSON.stringify(A.clusters(c.d.x, c.d.y, c.peaks)), '[[0,1]]', 'Rs = 1 pair is one cluster');
    var far = gaussTrace([{ A: 10, mu: 3, sigma: 0.1 }, { A: 10, mu: 6, sigma: 0.1 }]);
    t.eq(JSON.stringify(A.clusters(far.x, far.y, [{ id: 'q', start: 4.5, apex: 6, end: 6.6 }, { id: 'p', start: 2.4, apex: 3, end: 4.5 }])), '[[1],[0]]', 'touching but baseline-resolved peaks stay separate, time order');
    var gap = A.clusters(c.d.x, c.d.y, [{ id: 'a', start: 4.4, apex: 5, end: 5.19 }, { id: 'b', start: 5.21, apex: 5.4, end: 6 }]);
    t.eq(gap.length, 1, 'small gap between bounds with a raised valley is still fused');
    var syn = A.syntheticChromatogram({ seed: 2 }), bl = A.alsBaseline(syn.y, { lambda: 1e8, p: 0.001, iter: 20 }), y = syn.y.map(function (v, i) { return v - bl[i]; });
    var pk = A.detectPeaks(syn.x, y), cl = A.clusters(syn.x, y, pk);
    t.eq(cl.length, pk.length - 1, 'synthetic sample: only the 7.35/7.62 pair is fused (' + JSON.stringify(cl) + ')');
  });

  PK.test('analysis: integrate drop vs fit vs valley on a Rs = 1 pair', function (t) {
    var c = pairCase(10, 1.0), drop = A.integrate(c.d.x, c.d.y, c.peaks, { clip: 'drop' });
    t.ok(drop.every(function (r) { return r.clip === 'drop' && Math.abs(r.area / c.truth[r.index] - 1) < 0.015; }), 'equal pair: drop within 1.5 % ' + drop.map(function (r) { return (r.area / c.truth[r.index]).toFixed(4); }));
    var fit = A.integrate(c.d.x, c.d.y, c.peaks, { clip: 'fit' });
    t.ok(fit.every(function (r) { return r.clip === 'fit' && Math.abs(r.area / c.truth[r.index] - 1) < 0.015; }), 'equal pair: fit within 1.5 %');
    var valley = A.integrate(c.d.x, c.d.y, c.peaks, { clip: 'valley' });
    t.ok(valley[0].area < 0.8 * drop[0].area, 'valley-to-valley cuts the fused pair: ' + valley[0].area.toFixed(3) + ' vs ' + drop[0].area.toFixed(3));
    var u = pairCase(2.5, 1.0, 0.01), ud = A.integrate(u.d.x, u.d.y, u.peaks, { clip: 'drop' }), uf = A.integrate(u.d.x, u.d.y, u.peaks, { clip: 'fit' });
    var eD = Math.abs(ud[1].area / u.truth[1] - 1), eF = Math.abs(uf[1].area / u.truth[1] - 1);
    t.ok(eF < 0.03 && eF < eD, '4:1 pair, small peak: fit error ' + (100 * eF).toFixed(2) + ' % < drop error ' + (100 * eD).toFixed(2) + ' %');
    t.ok(uf[0].fit && uf[0].fit.areaSE > 0 && uf[0].fit.model === 'gaussian', 'fit details exposed');
    t.near(ud[0].area + ud[1].area, A.integrate(u.d.x, u.d.y, [{ id: 'all', start: 4.4, apex: 5, end: u.peaks[1].end }], { clip: 'drop' })[0].area, 1e-9, 'drop conserves the cluster total');
  });

  PK.test('analysis: baseline-to-baseline removes baseline penetration', function (t) {
    var d = gaussTrace([{ A: 10, mu: 4.6, sigma: 0.08 }, { A: 8, mu: 5.4, sigma: 0.08 }]);
    var y = d.y.map(function (v, i) { return v + 3 * Math.pow(d.x[i] - 5, 2); }); // U-shaped baseline: the chord lies above the signal in the middle
    var pk = [{ id: 'a', start: 4.1, apex: 4.6, end: 5 }, { id: 'b', start: 5, apex: 5.4, end: 5.9 }];
    t.eq(A.clusters(d.x, y, pk, { valleyFrac: -1 }).length, 1, 'forced into one cluster');
    var dr = A.integrate(d.x, y, pk, { clip: 'drop', clusters: [[0, 1]] }), bb = A.integrate(d.x, y, pk, { clip: 'baseline', clusters: [[0, 1]] });
    t.ok(dr[0].math.notes.some(function (s) { return /penetration/.test(s); }), 'drop flags penetration');
    var ok = bb.every(function (r) { var s = r.segments[0]; return s.lower.every(function (lv, i) { return lv <= s.upper[i] + 1e-9; }); });
    t.ok(ok, 'hull baseline never above the signal'); t.ok(bb[0].baseline.kind === 'polyline' && bb[0].baseline.points.length >= 2, 'polyline baseline');
    t.ok(bb[0].area > dr[0].area && bb[1].area > dr[1].area, 'baseline mode recovers area lost below the chord');
  });

  PK.test('analysis: skim-exp recovers a rider on an exponential tail', function (t) {
    [10, 20, 50].forEach(function (ratio) {
      var c = riderCase(ratio), r = A.integrate(c.x, c.y, c.peaks, { clip: 'skim-exp' }), R = byId(r, 'R'), P = byId(r, 'P');
      t.eq(R.clip, 'skim-exp', 'ratio ' + ratio + ': exponential skim applied'); t.eq(R.host, 'P', 'host id'); t.eq(P.riders[0], 'R', 'riders on parent');
      t.ok(Math.abs(R.area / c.rider - 1) < 0.03, 'ratio ' + ratio + ': rider area ' + R.area.toFixed(4) + ' vs ' + c.rider.toFixed(4));
      t.ok(Math.abs(P.area / c.parent - 1) < 0.02, 'ratio ' + ratio + ': parent area ' + P.area.toFixed(3) + ' vs ' + c.parent.toFixed(3));
      var tg = A.integrate(c.x, c.y, c.peaks, { clip: 'skim-tangent' }), dr = A.integrate(c.x, c.y, c.peaks, { clip: 'drop' });
      t.near(byId(tg, 'R').area + byId(tg, 'P').area, dr[0].area + dr[1].area, 1e-6 * c.parent, 'tangent skim conserves the total');
      t.near(R.area + P.area, dr[0].area + dr[1].area, 1e-6 * c.parent, 'exp skim conserves the total');
      t.ok(byId(tg, 'R').area < R.area, 'tangent skim underestimates a rider on a convex tail');
      t.ok(R.baseline.kind === 'exponential' && R.baseline.points.length > 10 && R.baseline.params.tau > 0.55 && R.baseline.params.tau < 0.65, 'sampled skim curve, τ ≈ 0.6: ' + R.baseline.params.tau);
    });
    var n = riderCase(20, { noise: 0.02 }), rn = byId(A.integrate(n.x, n.y, n.peaks, { clip: 'skim-exp' }), 'R');
    t.ok(Math.abs(rn.area / n.rider - 1) < 0.05, 'with noise: ' + rn.area.toFixed(4) + ' vs ' + n.rider.toFixed(4));
    var f = riderCase(20, { front: true }), rf = A.integrate(f.x, f.y, f.peaks, { clip: 'skim-exp' }), RF = byId(rf, 'R');
    t.ok(RF.host === 'P' && Math.abs(RF.area / f.rider - 1) < 0.03, 'front rider: ' + RF.area.toFixed(4) + ' vs ' + f.rider.toFixed(4));
  });

  PK.test('analysis: Dyson skim criterion falls back to drop', function (t) {
    var c = riderCase(5), r = A.integrate(c.x, c.y, c.peaks, { clip: 'skim-tangent' }), R = byId(r, 'R');
    t.eq(R.clip, 'drop', 'ratio 5 < 10 → drop'); t.eq(R.requested, 'skim-tangent', 'requested kept');
    t.ok(R.math.notes.some(function (s) { return /Dyson/.test(s) && /skimRatio 10/.test(s); }), 'explained in notes');
    t.eq(byId(A.integrate(c.x, c.y, c.peaks, { clip: 'skim-tangent', skimRatio: 4 }), 'R').clip, 'skim-tangent', 'skimRatio option');
    var single = A.integrate(c.x, c.y, [c.peaks[0]], { clip: 'skim-exp' })[0];
    t.ok(single.clip === 'drop' && /no neighbouring parent/.test(single.math.notes.join(' ')), 'single peak cannot be skimmed');
  });

  PK.test('analysis: integrate math object is complete and consistent', function (t) {
    var c = riderCase(20), p = pairCase(4, 1.2);
    A.CLIP_MODES.forEach(function (mode) {
      [[c.x, c.y, c.peaks], [p.d.x, p.d.y, p.peaks]].forEach(function (cs, which) {
        A.integrate(cs[0], cs[1], cs[2], { clip: mode, model: which ? 'gaussian' : 'emg' }).forEach(function (r) {
          var m = r.math, tag = mode + '/' + r.id + ': ';
          ['method', 'formula', 'steps', 'n', 'dt', 'tStart', 'tEnd', 'yStart', 'yEnd', 'grossArea', 'baselineArea', 'netArea', 'notes'].forEach(function (k) { t.ok(m[k] != null, tag + 'math.' + k); });
          t.near(m.grossArea - m.baselineArea, m.netArea, 1e-9 * Math.max(1, Math.abs(m.grossArea)), tag + 'gross − baseline = net');
          t.eq(r.area, m.netArea, tag + 'area = net');
          var st = {}; m.steps.forEach(function (s) { t.ok(typeof s.label === 'string' && typeof s.expr === 'string' && 'value' in s, tag + 'step shape'); st[s.label] = s.value; });
          t.ok(st['Gross area'] === m.grossArea && st['Baseline area'] === m.baselineArea && (st['Net area'] === m.netArea || st['Net area (model)'] === m.netArea), tag + 'steps carry the areas');
          t.eq(st['Number of points'], m.n, tag + 'n step'); t.eq(m.n, r.segments[0].x.length, tag + 'n = nodes');
          t.ok(/^(Rider area: area|Area|Model area: area) under the/.test(m.notes[0]) && m.notes[0].indexOf(' min, minus the area under ') > 0, tag + 'plain-language note: ' + m.notes[0].slice(0, 60));
          t.ok(r.baseline && r.baseline.points.length >= 2, tag + 'baseline points');
        });
      });
    });
    var v = A.integrate(p.d.x, p.d.y, [{ id: 'w', start: 4.7, apex: 5, end: 5.3 }], { clip: 'valley' })[0];
    t.near(v.math.yStart, U.interp1(p.d.x, p.d.y, 4.7), 1e-12, 'valley baseline anchored at y(start)');
    t.ok(new RegExp('between 4.7 and 5.3 min, minus the area under a straight baseline from \\(4.7, ').test(v.math.notes[0]), 'note: ' + v.math.notes[0]);
  });

  PK.test('analysis: manual peaks default to valley, peak.clip overrides', function (t) {
    var c = pairCase(10, 1.0), man = A.integrateWindow(c.d.x, c.d.y, 4.62, 5.15);
    var r = A.integrate(c.d.x, c.d.y, [man, c.peaks[1]], { clip: 'drop' });
    t.eq(r[0].clip, 'valley', 'manual → valley'); t.eq(r[0].start, 4.62, 'exact start'); t.eq(r[0].end, 5.15, 'exact end'); t.eq(r[0].math.tStart, 4.62, 'math tStart');
    var o = A.integrate(c.d.x, c.d.y, [{ id: 'a', start: 4.4, apex: 5, end: c.peaks[0].end, clip: 'valley' }, c.peaks[1]], { clip: 'drop' });
    t.eq(o[0].clip, 'valley', 'peak.clip override'); t.eq(o[1].clip, 'drop', 'default for the other');
  });

  PK.test('analysis: clipOptions preview', function (t) {
    var c = riderCase(20), co = A.clipOptions(c.x, c.y, c.peaks, 0);
    t.eq(co.options.length, 6, 'six modes'); t.eq(co.ids.join(','), 'P,R', 'ids');
    co.options.forEach(function (o) {
      t.ok(A.CLIP_MODES.indexOf(o.clip) >= 0 && typeof o.label === 'string' && typeof o.applicable === 'boolean' && fin(o.total) && o.peaks.length === 2, 'option ' + o.clip);
      t.ok(o.peaks.every(function (q) { return q.id && fin(q.area) && q.baseline && q.segments.length === 1; }), 'per-peak preview ' + o.clip);
    });
    t.eq(co.recommended, 'skim-exp', 'rider → exponential skim'); t.ok(co.reason.length > 10, 'reason');
    var p = pairCase(10, 1.0), cp = A.clipOptions(p.d.x, p.d.y, p.peaks, [0, 1]);
    t.ok(!cp.options[3].applicable && !cp.options[4].applicable, 'skim not applicable for equal pair'); t.ok(cp.recommended === 'drop' || cp.recommended === 'fit', 'pair → ' + cp.recommended);
    function fin(v) { return typeof v === 'number' && isFinite(v); }
  });

  PK.test('analysis: peakMetrics uses the applied baseline', function (t) {
    var c = riderCase(20), integ = A.integrate(c.x, c.y, c.peaks, { clip: 'skim-exp', noise: 0.01 });
    var m = A.peakMetrics(c.x, c.y, c.peaks, { integration: integ, noise: 0.01 }), R = m[1];
    t.eq(R.area, integ[1].area, 'area from integration'); t.eq(R.clip, 'skim-exp', 'clip carried'); t.ok(R.math === integ[1].math, 'math carried');
    t.ok(Math.abs(R.height / c.riderH - 1) < 0.02, 'rider height above the skim curve ' + R.height.toFixed(3) + ' vs ' + c.riderH.toFixed(3));
    t.ok(Math.abs(R.fwhm / (2.35482 * 0.05) - 1) < 0.03, 'rider FWHM ' + R.fwhm);
    var old = A.peakMetrics(c.x, c.y, c.peaks, { noise: 0.01 })[1];
    t.ok(Math.abs(old.height / c.riderH - 1) > 0.2, 'legacy valley line misstates the rider height: ' + old.height.toFixed(2));
    var viaClip = A.peakMetrics(c.x, c.y, c.peaks, { clip: 'skim-exp', noise: 0.01 })[1]; t.near(viaClip.area, R.area, 1e-12, 'opts.clip runs integrate');
    var viaRes = A.peakMetrics(c.x, c.y, integ, { noise: 0.01 })[1]; t.near(viaRes.area, R.area, 1e-12, 'integration results accepted as peaks');
    var bl = {}; bl.R = integ[1].baseline.points;
    var viaBl = A.peakMetrics(c.x, c.y, [{ id: 'R', start: integ[1].start, end: integ[1].end, apex: 4.6 }], { baselines: bl, noise: 0.01 })[0];
    t.ok(Math.abs(viaBl.height / c.riderH - 1) < 0.03 && viaBl.clip === 'custom', '{baselines} option: height ' + viaBl.height.toFixed(3));
    var g = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }]), a1 = A.peakMetrics(g.x, g.y, [onePeak()], { noise: 0.01 })[0], a2 = A.peakMetrics(g.x, g.y, [onePeak()], { noise: 0.01, clip: 'drop' })[0];
    t.near(a2.area, a1.area, 1e-12, 'isolated peak: drop = legacy valley line'); t.near(a2.height, a1.height, 1e-12, 'same height');
  });

  /* ---------------- Round 4: calibration ---------------- */
  PK.test('analysis: t distribution', function (t) {
    t.near(A.tQuantile(0.975, 1), 12.7062047, 1e-6, 't(0.975,1)'); t.near(A.tQuantile(0.975, 4), 2.7764451, 1e-6, 't(0.975,4)');
    t.near(A.tQuantile(0.975, 10), 2.2281389, 1e-6, 't(0.975,10)'); t.near(A.tQuantile(0.95, 1000), 1.6463794, 1e-5, 't(0.95,1000)');
    t.near(A.tCdf(0, 7), 0.5, 1e-14, 'symmetric'); t.near(A.tQuantile(0.025, 4), -2.7764451, 1e-6, 'lower tail');
  });

  PK.test('analysis: calibrationFit exact recovery, all models and weights', function (t) {
    var xs = [0.5, 1, 2, 5, 10, 20, 50];
    var truth = { linear: [0.7, 3.2], linear0: [3.2], quadratic: [0.7, 3.2, -0.012] };
    Object.keys(truth).forEach(function (model) {
      ['none', '1/x', '1/x2'].forEach(function (w) {
        var b = truth[model], f = A.calibrationFit(xs.map(function (x) { return { x: x, y: model === 'linear0' ? b[0] * x : b[0] + b[1] * x + (b[2] || 0) * x * x }; }), { model: model, weighting: w });
        var tag = model + ' ' + w + ': ';
        b.forEach(function (v, i) { t.near(f.coef[i], v, 1e-9 * Math.max(1, Math.abs(v)), tag + f.names[i]); });
        t.ok(f.syx < 1e-9 && f.r2 > 1 - 1e-12, tag + 'perfect fit'); t.eq(f.dof, xs.length - f.p, tag + 'dof');
        t.near(f.inverse(f.predict(7.5)).x, 7.5, 1e-9, tag + 'inverse(predict(x)) = x');
        t.near(f.points.reduce(function (s, p) { return s + p.w; }, 0), xs.length, 1e-9, tag + 'weights normalised to n');
      });
    });
    t.throws(function () { A.calibrationFit([{ x: 1, y: 2 }, { x: 2, y: 4 }], { model: 'linear' }); }, 'needs n ≥ p + 1');
  });

  PK.test('analysis: calibration statistics, LOD/LOQ and inverse prediction', function (t) {
    // textbook-style data set; reference values computed with the classic unweighted formulas
    var X = [0, 2, 4, 6, 8, 10, 12], Y = [2.1, 5.0, 9.0, 12.6, 17.3, 21.0, 24.7], n = 7, i;
    var f = A.calibrationFit(X.map(function (x, k) { return { x: x, y: Y[k] }; }), { model: 'linear' });
    var mx = 0, my = 0; for (i = 0; i < n; i++) { mx += X[i] / n; my += Y[i] / n; }
    var sxx = 0, sxy = 0; for (i = 0; i < n; i++) { sxx += (X[i] - mx) * (X[i] - mx); sxy += (X[i] - mx) * (Y[i] - my); }
    var b = sxy / sxx, a = my - b * mx, sse = 0; for (i = 0; i < n; i++) sse += Math.pow(Y[i] - a - b * X[i], 2);
    var s = Math.sqrt(sse / (n - 2));
    t.near(f.coef[1], b, 1e-12, 'slope'); t.near(f.coef[0], a, 1e-12, 'intercept'); t.near(f.syx, s, 1e-12, 's_y/x');
    t.near(f.se[1], s / Math.sqrt(sxx), 1e-12, 'SE slope'); t.near(f.se[0], s * Math.sqrt(1 / n + mx * mx / sxx), 1e-12, 'SE intercept');
    t.near(f.lod, 3.3 * s / b, 1e-12, 'LOD = 3.3 s/b'); t.near(f.loq, 10 * s / b, 1e-12, 'LOQ = 10 s/b');
    t.near(f.coef[1], 1.93, 0.005, 'b ≈ 1.93'); t.near(f.syx, 0.4328, 1e-4, 's_y/x ≈ 0.433');
    var y0 = 13.5, iv = f.inverse(y0), x0 = (y0 - a) / b, sx0 = s / b * Math.sqrt(1 + 1 / n + Math.pow(y0 - my, 2) / (b * b * sxx));
    t.near(iv.x, x0, 1e-12, 'x0'); t.near(iv.se, sx0, 1e-12, 'classic s_x0 (m = 1)'); t.near(iv.x, 6.21, 0.01, 'x0 ≈ 6.21');
    var iv6 = f.inverse(y0, { m: 6 }); t.near(iv6.se, s / b * Math.sqrt(1 / 6 + 1 / n + Math.pow(y0 - my, 2) / (b * b * sxx)), 1e-12, 'classic s_x0 (m = 6)');
    t.near(iv.hi - iv.x, A.tQuantile(0.975, 5) * iv.se, 1e-12, '95 % t-interval');
    t.ok(iv.flags.length === 0, 'in range, above LOQ'); t.ok(f.inverse(40).flags.indexOf('extrapolated') >= 0, 'extrapolation flag');
    t.ok(f.inverse(2.6).flags.indexOf('belowLOD') >= 0, 'below LOD flag'); t.ok(f.inverse(a + b * 1.5).flags.indexOf('belowLOQ') >= 0, 'below LOQ flag');
    ['model', 'weighting', 'se', 'syx', 'r2', 'adjR2', 'lod', 'loq', 'inverse'].forEach(function (k) { t.ok(f.formulas[k] && typeof f.formulas[k].expr === 'string' && 'value' in f.formulas[k], 'formulas.' + k); });
    t.ok(iv.formula && /delta/i.test(iv.formula.note), 'inverse formula audit');
    var q = A.calibrationFit([{ x: 1, y: 2.9 }, { x: 2, y: 5.6 }, { x: 4, y: 10.1 }, { x: 8, y: 17.0 }, { x: 16, y: 26.5 }], { model: 'quadratic' });
    var qi = q.inverse(q.predict(6)); t.near(qi.x, 6, 1e-9, 'quadratic picks the in-range root'); t.ok(qi.se > 0, 'quadratic SE');
    var qa = A.quantify({ model: 'linear', weighting: 'none', unit: 'µg/mL', levels: X.map(function (x, k) { return { conc: x, response: Y[k], include: true }; }).concat([{ conc: 99, response: 1, include: false }]) }, 13.5);
    t.near(qa.conc, x0, 1e-12, 'quantify from an analyte object'); t.eq(qa.unit, 'µg/mL', 'unit'); t.eq(qa.fit.n, 7, 'excluded level ignored');
    t.near(A.quantify(f, 13.5).conc, x0, 1e-12, 'quantify from a fit');
  });

  PK.test('analysis: inverse-prediction interval coverage ≈ 95 %', function (t) {
    var R = A.rng(2024), xs = [1, 2, 4, 6, 8, 10], N = 400;
    function cover(weighting, noiseFn, x0) {
      var hit = 0;
      for (var s = 0; s < N; s++) {
        var pts = xs.map(function (x) { return { x: x, y: 0.5 + 2 * x + noiseFn(x) * R.normal() }; });
        var f = A.calibrationFit(pts, { model: 'linear', weighting: weighting }), y0 = 0.5 + 2 * x0 + noiseFn(x0) * R.normal(), iv = f.inverse(y0);
        if (iv.lo <= x0 && x0 <= iv.hi) hit++;
      }
      return hit / N;
    }
    var c1 = cover('none', function () { return 0.3; }, 5), c2 = cover('1/x2', function (x) { return 0.03 * x; }, 3), c3 = cover('1/x', function (x) { return 0.1 * Math.sqrt(x); }, 7);
    t.ok(c1 >= 0.9 && c1 <= 0.99, 'unweighted, constant SD: ' + c1);
    t.ok(c2 >= 0.9 && c2 <= 0.99, '1/x² weighting, constant CV: ' + c2);
    t.ok(c3 >= 0.9 && c3 <= 0.99, '1/x weighting, Poisson-like SD: ' + c3);
  });
  /* ---------------- quantized / digitized traces ---------------- */
  function steppedTrace(n, q, jitter) {
    var x = U.linspace(0, 20, n), R = A.rng(3), pk = [[2.85, 55, 0.1], [5.62, 185, 0.12], [6.55, 92, 0.12], [10.41, 228, 0.15], [14.18, 48, 0.17]];
    return { x: x, rts: pk.map(function (p) { return p[0]; }), y: x.map(function (t) {
      var v = 6 + 0.3 * t; pk.forEach(function (p) { v += A.gaussian(t, p[1], p[0], p[2]); }); v += (jitter || 0) * q * R.normal(); return Math.round(v / q) * q; }) };
  }
  PK.test('analysis: noise() is robust to quantized (stepped) data', function (t) {
    var s = steppedTrace(4001, 0.714), nz = A.noise(s.x, s.y);
    t.ok(nz.quantum > 0 && /quantum/.test(nz.method), 'step detected: q = ' + nz.quantum + ', ' + nz.method);
    t.near(nz.sigma, 0.714 / Math.sqrt(12), 1e-9, 'σ floored at q/√12');
    t.near(A.noise(s.x, s.y, { quantum: 1 }).sigma, 1 / Math.sqrt(12), 1e-12, 'explicit {quantum}');
    var R = A.rng(8), g = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }], { noise: 0.1 }), ng = A.noise(g.x, g.y);
    t.ok(!ng.quantum && ng.method === 'mad-diff', 'continuous noisy data unaffected'); t.ok(R && Math.abs(ng.sigma / 0.1 - 1) < 0.1, 'σ ≈ 0.1');
  });
  PK.test('analysis: detectPeaks finds the true peaks on stepped traces, never non-positive ones', function (t) {
    [[775, 0.714, 0], [4001, 0.714, 0], [2000, 2, 0], [8001, 0.5, 1]].forEach(function (c) {
      var s = steppedTrace(c[0], c[1], c[2]), tag = 'n=' + c[0] + ' q=' + c[1] + ': ';
      ['auto', 10].forEach(function (th) {
        var pk = A.detectPeaks(s.x, s.y, { threshold: th }), ms = A.peakMetrics(s.x, s.y, pk);
        t.eq(pk.length, 5, tag + 'threshold ' + th + ' → 5 peaks (' + pk.map(function (p) { return p.apex.toFixed(2); }).join(',') + ')');
        t.ok(ms.every(function (m) { return m.valid && m.height > 0 && m.area > 0; }), tag + 'all heights and areas positive');
      });
      t.ok(match5(A.detectPeaks(s.x, s.y, { quantum: c[1] }), s.rts), tag + 'apexes match truth');
    });
    function match5(pk, rts) { return pk.length === 5 && rts.every(function (rt) { return pk.some(function (p) { return Math.abs(p.apex - rt) < 0.05; }); }); }
    var g = gaussTrace([{ A: 10, mu: 5, sigma: 0.1 }]), bad = A.peakMetrics(g.x, g.y, [onePeak(), { id: 'neg', start: 5.05, apex: 5.1, end: 5.3 }], { noise: 0.01 });
    t.ok(bad[1].valid === false && bad[1].flags.indexOf('nonPositiveArea') >= 0 && bad[1].areaPct === null, 'convex segment flagged, excluded from Area%');
    t.near(bad[0].areaPct, 100, 1e-9, 'valid peak carries 100 %');
    var ib = A.integrate(g.x, g.y, [{ id: 'neg', start: 5.05, apex: 5.1, end: 5.3 }], { clip: 'valley' })[0];
    t.ok(!ib.valid && ib.flags[0] === 'nonPositiveArea', 'integrate flags it too');
  });
  PK.test('analysis: digitized sample raster gives the 5 true peaks (if digitizer loaded)', function (t) {
    var D = PK.digitizer;
    if (!D || !D.makeSampleImage || !D.runPipeline || !D.calibrate) { t.ok(true, 'digitizer not loaded: skipped'); return; }
    var s = D.makeSampleImage({ canvas: false }), ax = s.axes, cal = D.calibrate({ x1: ax.x1, x2: ax.x2, y1: ax.y1, y2: ax.y2 });
    var res = D.runPipeline(s.image, cal, { rgb: s.truth.traces[0].rgb, tol: 90, include: ax.plot, exclude: [s.legend], maxGap: 15, xRange: [ax.plot.x + 3, ax.plot.x + ax.plot.w - 3] });
    ['auto', 10].forEach(function (th) {
      var pk = A.detectPeaks(res.x, res.y, { threshold: th, quantum: cal.dyPerPx / 2 }), ms = A.peakMetrics(res.x, res.y, pk);
      t.eq(pk.length, 5, 'threshold ' + th + ': 5 peaks (' + pk.map(function (p) { return p.apex.toFixed(2); }).join(',') + ')');
      t.ok([2.85, 5.62, 6.55, 10.41, 14.18].every(function (rt) { return pk.some(function (p) { return Math.abs(p.apex - rt) < 0.08; }); }), 'apexes match the raster truth');
      t.ok(ms.every(function (m) { return m.valid; }), 'no zero-height / negative-area peaks');
    });
    t.eq(A.detectPeaks(res.x, res.y, {}).length, 5, 'also without an explicit quantum');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
