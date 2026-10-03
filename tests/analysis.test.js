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
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
