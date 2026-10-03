/* SPDX-License-Identifier: MIT */
// Peakly integration & calibration validation on synthetic data with KNOWN answers.
// Usage: node tools/validate.js [--out docs/VALIDATION.md] [--quick]
// Zero dependencies; loads src/*.js through vm exactly like tests/run.js. Every random number comes from the
// seeded mulberry32 generator in PK.analysis.rng, so the report is byte-for-byte reproducible.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
globalThis.PK = {};
for (const m of ['config', 'core', 'analysis']) {
  const f = path.join(root, 'src', m + '.js');
  if (fs.existsSync(f)) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
}
const A = PK.analysis, U = PK.util, SQ2PI = Math.sqrt(2 * Math.PI);
const args = process.argv.slice(2), quick = args.includes('--quick');
const outArg = args.indexOf('--out'), OUT = outArg >= 0 ? path.resolve(args[outArg + 1]) : path.join(root, 'docs', 'VALIDATION.md');
const REPS = quick ? 5 : 20, CAL_SIMS = quick ? 200 : 1000;

/* ---------- helpers ---------- */
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); };
const pct = (v, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);
const f3 = v => (v == null || !isFinite(v)) ? '—' : (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(3));
function table(head, rows) {
  return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'].concat(rows.map(r => '| ' + r.join(' | ') + ' |')).join('\n');
}
// sum of EMG/Gaussian peaks (apex-height parameterised as in syntheticChromatogram) + drift + seeded noise
function chrom(peaks, o) {
  return A.syntheticChromatogram({ tMax: o.tMax || 20, n: o.n || 4001, peaks, drift: o.drift === undefined ? false : o.drift, noise: o.noise || 0, seed: o.seed || 1 });
}
const errPct = (meas, truth) => 100 * (meas / truth - 1);
// detected peaks nearest to the given apex times (null if not found within tol)
function match(pk, rts, tol) { return rts.map(rt => { let best = null; pk.forEach(p => { if (Math.abs(p.apex - rt) < tol && (!best || Math.abs(p.apex - rt) < Math.abs(best.apex - rt))) best = p; }); return best; }); }
function valleyBetween(x, y, t0, t1) { let bi = -1, bv = Infinity; for (let i = 0; i < x.length; i++) if (x[i] > t0 && x[i] < t1 && y[i] < bv) { bv = y[i]; bi = i; } return bi >= 0 ? x[bi] : (t0 + t1) / 2; }
const md = [];
const t0 = Date.now();
function log(s) { process.stdout.write(s + '\n'); }

/* ---------- 0. the built-in synthetic sample ---------- */
{
  const syn = A.syntheticChromatogram({ seed: 42 });
  const bl = A.alsBaseline(syn.y, { lambda: 1e8, p: 0.001, iter: 20 }), y = syn.y.map((v, i) => v - bl[i]);
  const pk = A.detectPeaks(syn.x, y, { threshold: 'auto' }), truth = syn.truth.peaks;
  const drop = A.integrate(syn.x, y, pk, { clip: 'drop' }), fit = A.integrate(syn.x, y, pk, { clip: 'fit', model: 'emg' });
  const ms = A.peakMetrics(syn.x, y, pk, { integration: drop });
  const rows = truth.map(tp => {
    const k = pk.findIndex(p => Math.abs(p.apex - tp.rt) < 0.03); if (k < 0) return [f3(tp.rt), f3(tp.area), 'not detected', '', '', '', ''];
    return [tp.rt.toFixed(3), f3(tp.area), f3(drop[k].area), pct(errPct(drop[k].area, tp.area)), f3(fit[k].area), pct(errPct(fit[k].area, tp.area)), pct(60 * (ms[k].rt - tp.rt), 2)];
  });
  md.push('## 0. Built-in synthetic sample', '',
    'The app\'s sample chromatogram (`syntheticChromatogram({seed: 42})`: 8 EMG peaks, curved drift, noise SD 0.05 mAU) after ALS baseline correction (λ = 1e8, p = 0.001), automatic peak detection and integration. True areas are A·σ·√(2π) of each generated component, in mAU·min.', '',
    table(['true t_R (min)', 'true area', 'drop area', 'drop error %', 'EMG-fit area', 'fit error %', 't_R error (s)'], rows), '',
    'The 7.35/7.62 min pair is one cluster; the other peaks are isolated. Drop errors on isolated peaks come mostly from the ALS baseline and the tails cut off at the detected bounds; the low 13.1 min peak (8 mAU) is the most sensitive to both.', '');
  log('0. sample done');
}

/* ---------- 1. noise ---------- */
{
  const H = 100, sig = 0.05, levels = [0, 0.1, 0.5, 1, 2, 5];
  const rows = levels.map(np => {
    const eD = [], eF = [], eRT = [], miss = [];
    for (let r = 0; r < REPS; r++) {
      const s = chrom([{ mu: 10, height: H, sigma: sig, tau: 0 }], { noise: H * np / 100, seed: 100 + r }), tp = s.truth.peaks[0];
      const pk = A.detectPeaks(s.x, s.y, {}), p = match(pk, [10], 0.1)[0]; if (!p) { miss.push(r); continue; }
      const d = A.integrate(s.x, s.y, [p], { clip: 'drop' })[0], f = A.integrate(s.x, s.y, [p], { clip: 'fit' })[0];
      const m = A.peakMetrics(s.x, s.y, [p], { integration: [d] })[0];
      eD.push(errPct(d.area, tp.area)); eF.push(errPct(f.area, tp.area)); eRT.push(60 * (m.rt - tp.rt));
    }
    return [np + ' %', (H / (H * np / 100 * 3 || Infinity)).toFixed(0) === 'Infinity' ? '∞' : (H / (3 * H * np / 100)).toFixed(0),
      pct(mean(eD)), sd(eD).toFixed(2), pct(mean(eF)), sd(eF).toFixed(2), sd(eRT).toFixed(3), miss.length ? miss.length + ' missed' : 'all'];
  });
  md.push('## 1. Noise', '',
    `Single Gaussian, height ${H}, σ = ${sig} min (≈ 10 points per σ), flat baseline, ${REPS} noise seeds per level. Bounds from \`detectPeaks\`, integration with the default clip (drop; for an isolated peak this is the straight line between the bounds). "fit" = Gaussian deconvolution.`, '',
    table(['noise SD (% of H)', 'S/N (H/3σ)', 'drop mean error %', 'drop SD %', 'fit mean error %', 'fit SD %', 't_R SD (s)', 'detected'], rows), '',
    'Interpretation: without noise the error (≈ −0.2 %) is the tail area outside the detected bounds, which sit where the signal returns to within 0.1 % of the peak height. With noise the bounds stop where the signal is within 2σ of the local minimum, so they move inwards: drop integration under-reads by ≈0.8 % at S/N ≈ 67, ≈2 % at S/N 17–33 and ≈6 % at S/N ≈ 7, with growing scatter. The Gaussian fit is only slightly better because it is fitted inside the same window above the same bound-to-bound line. For low-S/N peaks, widen the bounds manually (click-to-integrate) or quote the larger uncertainty.', '');
  log('1. noise done');
}

/* ---------- 2. baseline drift ---------- */
{
  const H = 50, sig = 0.06, drifts = [
    ['none', false], ['linear 0.5 mAU/min', t => 0.5 * t], ['linear 2 mAU/min', t => 2 * t],
    ['curved (sample drift)', t => 1.5 + 0.25 * t + 1.2 * Math.sin(Math.PI * t / 14)], ['steep curve', t => 0.02 * Math.pow(t - 4, 3) + 3 * Math.sin(t / 2)]];
  const rows = drifts.map(([name, fn]) => {
    const raw = [], als = [];
    for (let r = 0; r < REPS; r++) {
      const s = chrom([{ mu: 6, height: H, sigma: sig, tau: 0.02 }, { mu: 12, height: H, sigma: sig, tau: 0.02 }], { drift: fn, noise: 0.1, seed: 200 + r });
      const pk = match(A.detectPeaks(s.x, s.y, {}), [s.truth.peaks[0].rt, s.truth.peaks[1].rt], 0.1);
      if (pk.every(Boolean)) A.integrate(s.x, s.y, pk, { clip: 'drop' }).forEach((q, k) => raw.push(errPct(q.area, s.truth.peaks[k].area)));
      const b = A.alsBaseline(s.y, { lambda: 1e8, p: 0.001, iter: 20 }), y = s.y.map((v, i) => v - b[i]);
      const pk2 = match(A.detectPeaks(s.x, y, {}), [s.truth.peaks[0].rt, s.truth.peaks[1].rt], 0.1);
      if (pk2.every(Boolean)) A.integrate(s.x, y, pk2, { clip: 'drop' }).forEach((q, k) => als.push(errPct(q.area, s.truth.peaks[k].area)));
    }
    return [name, pct(mean(raw)), sd(raw).toFixed(2), pct(mean(als)), sd(als).toFixed(2)];
  });
  md.push('## 2. Baseline drift', '',
    `Two isolated slightly tailing peaks (height ${H}, σ = ${sig} min, τ = 0.02 min) at 6 and 12 min on different drifts, noise SD 0.1, ${REPS} seeds. "Raw" integrates the uncorrected signal (the straight line between the bounds absorbs the local drift); "ALS" subtracts an ALS baseline first.`, '',
    table(['drift', 'raw: mean error %', 'raw SD %', 'ALS: mean error %', 'ALS SD %'], rows), '',
    'Interpretation: integrating the uncorrected signal is unreliable — not because of the straight baseline under the peak, but because on a sloping baseline the detected bounds are placed asymmetrically (the return-to-baseline test is relative to the lowest point on each side), giving errors of a few percent with large scatter, and up to tens of percent on a steep curved drift. ALS baseline correction first makes every smooth drift behave like no drift; only the steep, strongly curved drift leaves ≈ −5 % because λ = 1e8 is too stiff to follow it (use a smaller λ there). Recommendation: always correct the baseline before integrating drifting data.', '');
  log('2. drift done');
}

/* ---------- 3. resolution of pairs ---------- */
const RS = [0.6, 0.8, 1.0, 1.25, 1.5, 2.0, 3.0];
{
  const sig = 0.06, modes = ['drop', 'valley', 'baseline', 'fit'];
  const blocks = [];
  [[1, 'equal heights (1 : 1)'], [0.25, 'second peak 4× smaller (1 : 0.25)']].forEach(([h2, label]) => {
    const rows = [];
    RS.forEach(rs => {
      const mu1 = 8, mu2 = mu1 + 4 * sig * rs, errs = {}, used = { det: 0 };
      modes.forEach(m => { errs[m] = [[], []]; });
      for (let r = 0; r < REPS; r++) {
        const s = chrom([{ mu: mu1, height: 100, sigma: sig, tau: 0 }, { mu: mu2, height: 100 * h2, sigma: sig, tau: 0 }], { noise: 0.2, seed: 300 + r });
        let pk = match(A.detectPeaks(s.x, s.y, {}), [mu1, mu2], 1.5 * sig);
        if (pk.every(Boolean) && pk[0] !== pk[1]) used.det++;
        else { // detection merged the pair: constructed bounds split at the valley (or midpoint)
          const v = valleyBetween(s.x, s.y, mu1, mu2);
          pk = [{ id: 'a', start: mu1 - 5 * sig, apex: mu1, end: v }, { id: 'b', start: v, apex: mu2, end: mu2 + 5 * sig }];
        }
        modes.forEach(m => A.integrate(s.x, s.y, pk, { clip: m, clusters: [[0, 1]] }).forEach((q, k) => errs[m][k].push(errPct(q.area, s.truth.peaks[k].area))));
      }
      rows.push([rs.toFixed(2)].concat(modes.map(m => pct(mean(errs[m][0]), 1) + ' / ' + pct(mean(errs[m][1]), 1))).concat([used.det + '/' + REPS]));
    });
    blocks.push('**' + label + '** — mean area error %, peak 1 / peak 2', '', table(['R_s', 'drop', 'valley', 'baseline', 'fit (Gaussian)', 'pair detected'], rows), '');
  });
  md.push('## 3. Resolution of peak pairs', '',
    `Two Gaussians (σ = ${sig} min) separated by Δt = 4σ·R_s, noise SD 0.2 (0.2 % of the larger peak), ${REPS} seeds per row. Bounds from \`detectPeaks\` when it resolves both peaks, otherwise constructed (outer bounds ±5σ, split at the valley). The pair is integrated as one cluster with each mode.`, '')
  md.push(...blocks);
  md.push('Interpretation: perpendicular drop is accurate for equal peaks at any resolution (what each peak loses across the drop line it regains from its neighbour). For unequal peaks it gives the larger peak part of the smaller one: the small peak reads −5 % at R_s = 1, −15 % at R_s = 0.8 and −43 % at R_s = 0.6, and only becomes accurate around R_s ≥ 1.25–1.5. Valley-to-valley removes the area under the raised valley and is only acceptable near baseline resolution (R_s ≥ 2). Baseline-to-baseline behaves like drop on a flat baseline. Gaussian deconvolution is nearly unbiased at every resolution here because the model is exactly right; on real, non-Gaussian peaks it is only as good as the model (see §4). At R_s = 0.6 with 4 : 1 heights the detector usually reports a single peak; the table then uses constructed bounds.', '');
  log('3. resolution done');
}

/* ---------- 4. tailing ---------- */
{
  const sig = 0.05, ratios = [0, 0.5, 1, 2, 3];
  const rows = ratios.map(q => {
    const tau = q * sig, eD = [], eG = [], eE = [], T = [];
    for (let r = 0; r < REPS; r++) {
      const s = chrom([{ mu: 8, height: 100, sigma: sig, tau: tau }], { noise: 0.2, seed: 400 + r }), tp = s.truth.peaks[0];
      const p = match(A.detectPeaks(s.x, s.y, {}), [tp.rt], 0.1)[0]; if (!p) continue;
      const d = A.integrate(s.x, s.y, [p], { clip: 'drop' })[0];
      eD.push(errPct(d.area, tp.area));
      eG.push(errPct(A.integrate(s.x, s.y, [p], { clip: 'fit', model: 'gaussian' })[0].area, tp.area));
      eE.push(errPct(A.integrate(s.x, s.y, [p], { clip: 'fit', model: 'emg' })[0].area, tp.area));
      T.push(A.peakMetrics(s.x, s.y, [p], { integration: [d] })[0].tailing);
    }
    return [q.toFixed(1), mean(T).toFixed(2), pct(mean(eD)), sd(eD).toFixed(2), pct(mean(eG)), pct(mean(eE)), sd(eE).toFixed(2)];
  });
  // tailing pair: second peak 8σ after the first
  const rows2 = ratios.map(q => {
    const tau = q * sig, e = { drop: [[], []], emg: [[], []] };
    for (let r = 0; r < REPS; r++) {
      const s = chrom([{ mu: 8, height: 100, sigma: sig, tau: tau }, { mu: 8 + 8 * sig + tau, height: 50, sigma: sig, tau: tau }], { noise: 0.2, seed: 450 + r });
      let pk = match(A.detectPeaks(s.x, s.y, {}), s.truth.peaks.map(p => p.rt), 0.1);
      if (!pk.every(Boolean) || pk[0] === pk[1]) { const v = valleyBetween(s.x, s.y, s.truth.peaks[0].rt, s.truth.peaks[1].rt); pk = [{ id: 'a', start: 7.7, apex: s.truth.peaks[0].rt, end: v }, { id: 'b', start: v, apex: s.truth.peaks[1].rt, end: 9.5 + 10 * tau }]; }
      A.integrate(s.x, s.y, pk, { clip: 'drop', clusters: [[0, 1]] }).forEach((x, k) => e.drop[k].push(errPct(x.area, s.truth.peaks[k].area)));
      A.integrate(s.x, s.y, pk, { clip: 'fit', model: 'emg', clusters: [[0, 1]] }).forEach((x, k) => e.emg[k].push(errPct(x.area, s.truth.peaks[k].area)));
    }
    return [q.toFixed(1), pct(mean(e.drop[0]), 1) + ' / ' + pct(mean(e.drop[1]), 1), pct(mean(e.emg[0]), 1) + ' / ' + pct(mean(e.emg[1]), 1)];
  });
  md.push('## 4. Tailing (EMG τ/σ from 0 to 3)', '',
    `Single EMG peak, σ = ${sig} min, apex height 100, noise SD 0.2, ${REPS} seeds. T = USP tailing factor measured by \`peakMetrics\`.`, '',
    table(['τ/σ', 'USP T', 'drop mean error %', 'drop SD %', 'Gaussian fit error %', 'EMG fit error %', 'EMG fit SD %'], rows), '',
    'Pair of identical tailing peaks (second at μ₁ + 8σ + τ, half height), integrated as one cluster — mean error %, peak 1 / peak 2:', '',
    table(['τ/σ', 'drop', 'EMG fit'], rows2), '',
    'Interpretation: for an isolated tailing peak, drop integration loses only the part of the exponential tail beyond the detected end bound (≈ −0.6 % at τ/σ = 2–3). Fitting a Gaussian to a tailing peak is badly biased (−7 % at τ/σ = 2, −10 % at 3: wrong model); the EMG model stays within −0.3 %. In a tailing pair, drop moves the first peak\'s tail into the second peak (−5.6 % / +9.5 % at τ/σ = 3) — the classic reason to use skimming or deconvolution.', '');
  log('4. tailing done');
}

/* ---------- 5. rider peaks ---------- */
{
  const ratios = [5, 10, 20, 50], modes = ['drop', 'valley', 'skim-tangent', 'skim-exp', 'fit'];
  const rows = [];
  ratios.forEach(ratio => {
    const e = {}, applied = {}; modes.forEach(m => { e[m] = [[], []]; applied[m] = {}; });
    let det = 0;
    for (let r = 0; r < REPS; r++) {
      // parent EMG (σ 0.1, τ 0.6) and a Gaussian rider (σ 0.05) 1.6 min later on its tail
      const s = chrom([{ mu: 6, height: 30, sigma: 0.1, tau: 0.6 }, { mu: 7.6, height: 30 / ratio, sigma: 0.05, tau: 0 }], { noise: 0.02, seed: 500 + r });
      const tp = s.truth.peaks;
      let pk = match(A.detectPeaks(s.x, s.y, {}), [tp[0].rt, tp[1].rt], 0.1);
      if (pk.every(Boolean) && pk[0] !== pk[1]) det++;
      else { const v = valleyBetween(s.x, s.y, 7, 7.6); pk = [{ id: 'P', start: 5.4, apex: tp[0].rt, end: v }, { id: 'R', start: v, apex: 7.6, end: 14 }]; }
      modes.forEach(m => A.integrate(s.x, s.y, pk, { clip: m, model: 'emg', clusters: [[0, 1]] }).forEach((q, k) => {
        e[m][k].push(errPct(q.area, tp[k].area)); if (k === 1) applied[m][q.clip] = (applied[m][q.clip] || 0) + 1;
      }));
    }
    const best = modes.slice().sort((a, b) => Math.abs(mean(e[a][1])) - Math.abs(mean(e[b][1])))[0];
    rows.push([String(ratio)].concat(modes.map(m => pct(mean(e[m][1]), 1) + ' / ' + pct(mean(e[m][0]), 1) + (applied[m][m] === REPS || m === 'drop' || m === 'valley' ? '' : ' (' + Object.keys(applied[m]).join(', ') + ')'))).concat([best, det + '/' + REPS]));
  });
  md.push('## 5. Rider peaks on a tail (parent/rider height 5–50)', '',
    `Parent: EMG, σ = 0.1 min, τ = 0.6 min (τ/σ = 6), apex 30 mAU at ≈6.2 min. Rider: Gaussian, σ = 0.05 min, at 7.6 min on the parent\'s tail, apex 30/ratio. Noise SD 0.02, ${REPS} seeds. Bounds from \`detectPeaks\` (constructed at the valley if the rider is not detected). Mean area error %, **rider / parent**; brackets show the mode actually applied when it differs (Dyson fallback, skimRatio = 10). Fit = joint EMG deconvolution of both peaks.`, '',
    table(['parent/rider height', 'drop', 'valley', 'skim-tangent', 'skim-exp', 'fit (EMG)', 'best for rider', 'rider detected'], rows), '',
    'Interpretation: drop gives the rider all of the parent\'s tail beneath it (rider errors of +190 % to +1400 %); valley-to-valley produces nonsense (negative rider areas). Tangent skim is far better but systematically under-reads a rider on a convex exponential tail (−9 % at ratio 10, −43 % at ratio 50) because the straight tangent lies above the true tail. Exponential skim models the tail and recovers the rider within −1 % (ratio 10), −3 % (20) and −6 % (50); the residual bias is the rider\'s own front lost before the valley and the small skim-end tolerance. The parent reads ≈ −5 % in every skim mode: the cluster ends at the rider\'s detected end bound, which cuts off the parent\'s long (τ/σ = 6) tail — extend that end bound when the parent tail matters. At parent/rider = 5 the Dyson criterion (skimRatio 10) declines to skim and applies drop, as the brackets show; there joint EMG deconvolution was best (−3 %), but for small riders (ratio ≥ 10) the fit often converged to a wrong split, so it is not a safe default.', '');
  log('5. riders done');
}

/* ---------- 6. calibration recovery ---------- */
{
  const R = A.rng(777), b0 = 1.0, b1 = 2.5, levels = [1, 2, 5, 10, 20, 50, 100], unknowns = [1.5, 25, 90];
  const noiseModels = [['constant SD (σ = 0.5)', () => 0.5], ['constant CV (2 %)', x => 0.02 * (b0 + b1 * x)]];
  const rows = [];
  noiseModels.forEach(([nname, nf]) => {
    ['none', '1/x', '1/x2'].forEach(w => {
      const slopes = [], ints = [], cov = unknowns.map(() => 0), rel = unknowns.map(() => []), lods = [];
      for (let s = 0; s < CAL_SIMS; s++) {
        const pts = levels.map(x => ({ x, y: b0 + b1 * x + nf(x) * R.normal() }));
        const f = A.calibrationFit(pts, { model: 'linear', weighting: w });
        slopes.push(f.coef[1]); ints.push(f.coef[0]); lods.push(f.lod);
        unknowns.forEach((x0, k) => { const y0 = b0 + b1 * x0 + nf(x0) * R.normal(), iv = f.inverse(y0); if (iv.lo <= x0 && x0 <= iv.hi) cov[k]++; rel[k].push(100 * Math.abs(iv.x / x0 - 1)); });
      }
      rows.push([nname, w, pct(errPct(mean(slopes), b1), 3), (100 * sd(slopes) / b1).toFixed(3), f3(mean(ints) - b0), f3(sd(ints))]
        .concat(cov.map(c => (100 * c / CAL_SIMS).toFixed(1))).concat(rel.map(r => mean(r).toFixed(2))).concat([f3(mean(lods))]));
    });
  });
  // quadratic model recovery
  const qrows = [];
  ['none', '1/x', '1/x2'].forEach(w => {
    const c2 = [], cov = [0, 0];
    for (let s = 0; s < CAL_SIMS; s++) {
      const fx = x => 0.5 + 3 * x - 0.01 * x * x, pts = levels.map(x => ({ x, y: fx(x) * (1 + 0.01 * R.normal()) }));
      const f = A.calibrationFit(pts, { model: 'quadratic', weighting: w }); c2.push(f.coef[2]);
      [3, 60].forEach((x0, k) => { const iv = f.inverse(fx(x0) * (1 + 0.01 * R.normal())); if (iv.lo <= x0 && x0 <= iv.hi) cov[k]++; });
    }
    qrows.push([w, pct(errPct(mean(c2), -0.01), 2), (100 * cov[0] / CAL_SIMS).toFixed(1), (100 * cov[1] / CAL_SIMS).toFixed(1)]);
  });
  md.push('## 6. Calibration recovery', '',
    `True line y = ${b0} + ${b1}·x, levels ${levels.join(', ')} (one injection each), ${CAL_SIMS} simulated calibrations per row; for each, unknowns at x = ${unknowns.join(', ')} are measured once and back-calculated with \`inverse()\`. Coverage = fraction of 95 % intervals containing the true x (target 95 %). Rel. error = mean |x̂/x − 1|.`, '',
    table(['noise', 'weighting', 'slope bias %', 'slope RSD %', 'intercept bias', 'intercept SD'].concat(unknowns.map(u => 'coverage % @' + u)).concat(unknowns.map(u => 'rel. error % @' + u)).concat(['mean LOD']), rows), '',
    `Quadratic model y = 0.5 + 3x − 0.01x², 1 % CV noise, ${CAL_SIMS} simulations: bias of b₂ and inverse-interval coverage at x = 3 and 60.`, '',
    table(['weighting', 'b₂ bias %', 'coverage % @3', 'coverage % @60'], qrows), '',
    'Interpretation: all weightings give unbiased slopes. When the noise SD is constant, unweighted regression is correct, gives ≈95 % coverage everywhere, and the LOD equals 3.3σ/b ≈ 0.66. When the noise is proportional to the response (constant CV — typical for chromatography over 2–3 decades), the unweighted fit is dominated by the top standards: its intervals are far too wide at the low end (coverage ≈ 100 %, large relative error) and too narrow at the top; 1/x² weighting restores ≈95 % coverage across the range and cuts the low-end error several-fold. 1/x is a compromise. With weighting, the reported LOD (from the average-weight s_y/x) is not meaningful for the low end — see docs/CALIBRATION.md.', '');
  log('6. calibration done');
}

/* ---------- write report ---------- */
const head = [
  '<!-- SPDX-License-Identifier: MIT -->',
  '# Peakly validation report',
  '',
  'Generated by `node tools/validate.js` (Peakly ' + (PK.config && PK.config.version || PK.version || '') + ', ' + (quick ? 'quick mode' : 'full mode') + ', ' + REPS + ' noise seeds per integration case, ' + CAL_SIMS + ' calibration simulations). Every chromatogram is synthetic with a known true area (A·σ·√(2π) of each generated Gaussian/EMG component) and is produced by `syntheticChromatogram` with a seeded mulberry32 generator, so re-running the script reproduces this file exactly.',
  '',
  'Areas are in y-unit·min. "Error %" = 100·(measured/true − 1); negative means under-reading. Unless stated otherwise peaks are detected with `detectPeaks` and integrated with `integrate`; nothing is tuned per case.',
  '',
  '## Summary',
  '',
  '- **Isolated peaks:** with automatic bounds, areas are within −0.2 % (noise-free) to −0.8 % (S/N ≈ 67); at S/N 17–33 they under-read by ≈2 % because noisy bounds move inwards, ≈6 % at S/N ≈ 7. Tailing up to τ/σ = 3 costs only ≈ −0.6 % with drop; a Gaussian fit to a tailing peak is biased by up to −10 %, an EMG fit is not. Drifting baselines must be ALS-corrected first (uncorrected: errors of several % to tens of %).',
  '- **Pairs:** perpendicular drop is accurate for equal heights at any resolution, but for a 4 : 1 pair it moves area from the small peak into the large one (small peak −5 % at R_s = 1, −15 % at 0.8) until R_s ≈ 1.25–1.5. Valley-to-valley is only acceptable near baseline resolution (R_s ≥ 2). Deconvolution is unbiased here because the model is exact.',
  '- **Riders (parent/rider 10–50):** drop is badly wrong for the rider (+190 % to +1400 %); tangent skim under-reads it by 9–43 %; exponential skim recovers it within −1 % to −6 %. At parent/rider = 5, the Dyson rule (skimRatio = 10) declines to skim and falls back to drop.',
  '- **Calibration:** slopes are unbiased under every weighting; the 95 % inverse-prediction intervals have ≈95 % coverage when the weighting matches the noise model (none for constant SD, 1/x² for constant CV), and are badly mis-sized when it does not.',
  '- **Limits of this report:** synthetic Gaussian/EMG peaks, white noise, and correct models flatter deconvolution; real peaks, correlated noise and wrong bounds will do worse. Treat these as best-case numbers that show *which* method is appropriate, not as validated accuracy claims (see the disclaimer in the README).',
  '',
  '## How to reproduce',
  '',
  '```',
  'node tools/validate.js            # full run, rewrites docs/VALIDATION.md',
  'node tools/validate.js --quick    # fewer seeds, for a fast check',
  'node tools/validate.js --out /tmp/report.md',
  '```',
  '',
  'Methods are documented in [INTEGRATION.md](INTEGRATION.md), [CALIBRATION.md](CALIBRATION.md) and [CALCULATIONS.md](CALCULATIONS.md).',
  ''
];
const tail = ['## Which clip mode is appropriate?', '',
  table(['situation', 'appropriate mode', 'evidence above'], [
    ['isolated peak', 'any (drop = valley = baseline)', '§1, §2'],
    ['partially resolved, similar heights', 'drop', '§3 (1 : 1)'],
    ['partially resolved, very different heights, R_s < 1.5', 'fit if the shape model is good; otherwise drop and report the bias', '§3 (1 : 0.25)'],
    ['small peak on the tail/front of a much larger one (ratio ≥ 10)', 'skim-exp (skim-tangent if the tail is short or not exponential)', '§5'],
    ['valley dips below the straight cluster baseline', 'baseline (lower-hull) or valley', 'tests: "baseline-to-baseline removes baseline penetration"'],
    ['baseline-resolved peaks on a drifting baseline', 'valley or drop (equivalent)', '§2']]), '',
  '_Run time: ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s is excluded from the reproducibility guarantee._', ''];
// keep the report byte-reproducible: drop the run-time line
tail.splice(tail.length - 2, 1);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, head.concat(md).concat(tail).join('\n'));
log('wrote ' + OUT + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
