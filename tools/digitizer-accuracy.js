#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* Digitizer accuracy benchmark: node tools/digitizer-accuracy.js [--out docs/DIGITIZER_ACCURACY.md] [--quiet]
 *
 * Renders Peakly's synthetic sample chromatogram (PK.digitizer.makeSampleImage, pure raster path, no DOM)
 * at several plot widths, runs it back through the same digitizer pipeline the app uses
 * (calibrate -> colorMask -> extractTrace -> fillGaps -> resample, via PK.digitizer.runPipeline),
 * and compares the result with the known ground-truth curve.
 *
 * Reported per case: retention-time error (min and px), peak height error %, area error % and
 * area-% error per peak, RMS y error, and column coverage. Peak metrics for truth and digitized
 * curves come from the same PK.analysis.detectPeaks + peakMetrics call, so differences are due to
 * digitizing only. Zero dependencies; deterministic (no random numbers except a seeded PRNG). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
globalThis.PK = {};
for (const m of ['config', 'core', 'services', 'testkit', 'schema', 'parsers', 'analysis', 'digitizer']) {
  const f = path.join(root, 'src', m + '.js');
  if (fs.existsSync(f)) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
}
const D = PK.digitizer, A = PK.analysis;
if (!D || !D.makeSampleImage || !D.runPipeline) { console.error('PK.digitizer not available'); process.exit(1); }

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = path.join(root, outArg >= 0 ? args[outArg + 1] : 'docs/DIGITIZER_ACCURACY.md');
const QUIET = args.includes('--quiet');

/* ---------------- image degradations (implemented here, not in the app) ---------------- */
function clone(img) { return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }; }

// Bilinear resample to (w2,h2). Pixel centres map as (i+0.5)*s-0.5 (same convention as most image libs).
function resizeBilinear(img, w2, h2) {
  const w = img.width, h = img.height, s = img.data, out = new Uint8ClampedArray(w2 * h2 * 4);
  const sx = w / w2, sy = h / h2;
  for (let y = 0; y < h2; y++) {
    let fy = (y + 0.5) * sy - 0.5; if (fy < 0) fy = 0; if (fy > h - 1) fy = h - 1;
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w2; x++) {
      let fx = (x + 0.5) * sx - 0.5; if (fx < 0) fx = 0; if (fx > w - 1) fx = w - 1;
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c];
        out[(y * w2 + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return { width: w2, height: h2, data: out };
}

// Separable Gaussian blur (sigma in px) on RGB.
function blur(img, sigma) {
  const r = Math.ceil(3 * sigma), k = []; let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); ks += v; }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const w = img.width, h = img.height, src = img.data, tmp = new Float32Array(w * h * 3), out = clone(img);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let acc = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); acc += k[i + r] * src[(y * w + xx) * 4 + c]; }
    tmp[(y * w + x) * 3 + c] = acc;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let acc = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); acc += k[i + r] * tmp[(yy * w + x) * 3 + c]; }
    out.data[(y * w + x) * 4 + c] = acc;
  }
  return out;
}

// JPEG-like degradation: RGB -> YCbCr, 8x8 block DCT, quantize with the standard JPEG (Annex K)
// tables scaled to `quality`, inverse DCT. No chroma subsampling. Produces blockiness and ringing.
const QY = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const QC = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99].concat(new Array(32).fill(99));
function jpegLike(img, quality) {
  const sc = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  const q = t => t.map(v => Math.max(1, Math.min(255, Math.floor((v * sc + 50) / 100))));
  const qy = q(QY), qc = q(QC), w = img.width, h = img.height, d = img.data, out = clone(img);
  const cos = []; for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) cos[x * 8 + u] = Math.cos((2 * x + 1) * u * Math.PI / 16);
  const C = u => (u === 0 ? Math.SQRT1_2 : 1);
  const planes = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    planes[0][i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    planes[1][i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    planes[2][i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const blk = new Float64Array(64), F = new Float64Array(64);
  for (let p = 0; p < 3; p++) {
    const P = planes[p], Q = p === 0 ? qy : qc;
    for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = P[Math.min(h - 1, by + y) * w + Math.min(w - 1, bx + x)];
      for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
        let s = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += blk[y * 8 + x] * cos[x * 8 + u] * cos[y * 8 + v];
        const f = 0.25 * C(u) * C(v) * s, qq = Q[v * 8 + u]; F[v * 8 + u] = Math.round(f / qq) * qq;
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (by + y >= h || bx + x >= w) continue;
        let s = 0; for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) s += C(u) * C(v) * F[v * 8 + u] * cos[x * 8 + u] * cos[y * 8 + v];
        P[(by + y) * w + bx + x] = 0.25 * s;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const Y = planes[0][i] + 128, cb = planes[1][i], cr = planes[2][i];
    out.data[i * 4] = Y + 1.402 * cr; out.data[i * 4 + 1] = Y - 0.344136 * cb - 0.714136 * cr; out.data[i * 4 + 2] = Y + 1.772 * cb;
  }
  return out;
}

/* ---------------- benchmark ---------------- */
function scaleAxes(ax, f) {
  const s = p => ({ px: p.px * f, val: p.val });
  return { plot: { x: ax.plot.x * f, y: ax.plot.y * f, w: ax.plot.w * f, h: ax.plot.h * f }, x1: s(ax.x1), x2: s(ax.x2), y1: s(ax.y1), y2: s(ax.y2), xLog: false, yLog: false };
}
function scaleRect(r, f) { return { x: r.x * f, y: r.y * f, w: r.w * f, h: r.h * f }; }

// Truth peaks: detected once on the noise-free curve (fixed threshold), then frozen as manual windows.
function truthPeaksOf(x, y) {
  if (A && A.detectPeaks && A.peakMetrics) {
    const pk = A.detectPeaks(x, y, { threshold: 10, minWidth: 0.08 }).map(p => Object.assign({}, p, { manual: true }));
    const m = A.peakMetrics(x, y, pk, {});
    return m.map((q, i) => ({ rt: q.rt, height: q.height, area: q.area, areaPct: q.areaPct, win: pk[i] }));
  }
  return D._simplePeaks(x, y).map(p => Object.assign(p, { win: { id: 'p' + p.rt, start: p.start, apex: p.apex, end: p.end, manual: true } }));
}
// Digitized metrics measured with exactly the same integration windows as the truth.
function metricsInWindows(x, y, tps) {
  if (A && A.peakMetrics) return A.peakMetrics(x, y, tps.map(t => t.win), {}).map(q => ({ rt: q.rt, height: q.height, area: q.area, areaPct: q.areaPct }));
  const sp = D._simplePeaks(x, y);
  return tps.map(t => sp.reduce((b, q) => (Math.abs(q.rt - t.rt) < Math.abs(b.rt - t.rt) ? q : b), { rt: Infinity }));
}
// Same call the app makes for digitized traces: the pixel step (digitized.dy) is passed as the noise quantum.
function autoCount(x, y, quantum) {
  try { return A && A.detectPeaks ? A.detectPeaks(x, y, { threshold: 'auto', quantum: quantum }).length : D._simplePeaks(x, y).length; } catch (e) { return null; }
}

function runCase(c, truthPeaks, truth) {
  const img = c.img, ax = c.axes;
  const cal = D.calibrate(ax);
  const plot = ax.plot;
  const leg = c.legend;
  const res = D.runPipeline(img, cal, {
    rgb: [37, 99, 235], tol: c.tol || 80, include: { x: plot.x + 2, y: plot.y + 2, w: plot.w - 4, h: plot.h - 4 },
    exclude: [{ x: leg.x - 2, y: leg.y - 2, w: leg.w + 4, h: leg.h + 4 }], extract: 'centroid', maxGap: 15, nPoints: 4001
  });
  const n = res.x.length;
  // RMS y error on the overlapping x range (digitized resampled onto the truth grid)
  let se = 0, cnt = 0;
  const x0 = res.x[0], x1 = res.x[n - 1];
  for (let i = 0; i < truth.x.length; i++) {
    const t = truth.x[i]; if (t < x0 || t > x1) continue;
    const e = PK.util.interp1(res.x, res.y, t) - truth.y[i]; se += e * e; cnt++;
  }
  const rmsY = Math.sqrt(se / Math.max(1, cnt));
  const dig = metricsInWindows(res.x, res.y, truthPeaks);
  const per = truthPeaks.map((tp, i) => {
    const m = dig[i];
    if (!m || !isFinite(m.rt) || Math.abs(m.rt - tp.rt) > 0.3) return { rt: tp.rt, missed: true };
    return {
      rt: tp.rt, dRT: m.rt - tp.rt, dRTpx: (m.rt - tp.rt) / cal.dxPerPx,
      dH: 100 * (m.height - tp.height) / tp.height, dA: 100 * (m.area - tp.area) / tp.area, dAPct: m.areaPct - tp.areaPct
    };
  });
  const auto = autoCount(res.x, res.y, Math.abs(cal.dyPerPx) / 2);
  const ok = per.filter(p => !p.missed);
  const maxAbs = k => ok.reduce((s, p) => Math.max(s, Math.abs(p[k])), 0);
  const meanAbs = k => ok.reduce((s, p) => s + Math.abs(p[k]), 0) / Math.max(1, ok.length);
  return {
    name: c.name, plotW: Math.round(plot.w), plotH: Math.round(plot.h), imgW: img.width, imgH: img.height,
    dxPerPx: cal.dxPerPx, dyPerPx: cal.dyPerPx, coverage: res.coverage, rmsY, rmsYpx: rmsY / cal.dyPerPx,
    per, found: ok.length, auto,
    maxRT: maxAbs('dRT'), maxRTpx: maxAbs('dRTpx'), meanH: meanAbs('dH'), maxH: maxAbs('dH'), meanA: meanAbs('dA'), maxA: maxAbs('dA'), maxAPct: maxAbs('dAPct'),
    warnings: D.qualityWarnings(img, { plotWidthPx: plot.w, coverage: res.coverage, calibSepPx: cal.sepPx, isJpeg: !!c.jpeg })
  };
}

function build() {
  const cases = [];
  // 1. Native renders at several plot widths (same aspect ratio as the 900x560 default sample).
  for (const pw of [300, 450, 600, 900, 1400]) {
    const W = pw + 120, H = Math.round(140 + pw * 420 / 780);
    const s = D.makeSampleImage({ width: W, height: H, canvas: false });
    cases.push({ name: `native ${pw} px`, img: s.image, axes: s.axes, legend: s.legend, sample: s });
  }
  // 2. Default 900x560 sample downscaled (bilinear), as when a screenshot is shrunk.
  const base = D.makeSampleImage({ canvas: false });
  for (const f of [0.5, 0.35]) {
    const w2 = Math.round(base.width * f), h2 = Math.round(base.height * f), fx = w2 / base.width;
    cases.push({ name: `downscaled ×${f} (bilinear)`, img: resizeBilinear(base.image, w2, h2), axes: scaleAxes(base.axes, fx), legend: scaleRect(base.legend, fx), sample: base, tol: 110 });
  }
  // 3. JPEG-like degradation: blur (σ=0.8 px) + 8x8 DCT quantization, quality 75 and 40.
  for (const q of [75, 40]) {
    cases.push({ name: `blur σ0.8 + JPEG-like q${q}`, img: jpegLike(blur(base.image, 0.8), q), axes: base.axes, legend: base.legend, sample: base, tol: 110, jpeg: true });
  }
  // 4. Small + JPEG: 450 px plot, blur + q50.
  const small = cases[1];
  cases.push({ name: 'native 450 px + blur + JPEG-like q50', img: jpegLike(blur(small.img, 0.8), 50), axes: small.axes, legend: small.legend, sample: small.sample, tol: 110, jpeg: true });
  return cases;
}

const t0 = Date.now();
const cases = build();
const truthCache = new Map();
const results = cases.map(c => {
  const tr = c.sample.truth;
  if (!truthCache.has(tr)) truthCache.set(tr, truthPeaksOf(tr.x, tr.y));
  return runCase(c, truthCache.get(tr), tr);
});
const ms = Date.now() - t0;
const truthPeaks = truthCache.get(cases[3].sample.truth);

/* ---------------- report ---------------- */
const f = (v, d) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : v.toFixed(d)));
const sgn = (v, d) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + f(v, d));
let md = '';
md += '# Digitizer accuracy\n\n';
md += '<!-- Generated by `node tools/digitizer-accuracy.js` — do not edit by hand; re-run the tool instead. -->\n\n';
md += 'How close does a digitized trace get to the data that drew the picture? This report answers that for Peakly\'s own synthetic sample chromatogram, ';
md += 'where the ground truth is known exactly. The image is rendered by `PK.digitizer.makeSampleImage` (pure raster path, anti-aliased 2 px line, gridlines, ';
md += 'legend, a second overlapping orange trace), digitized with the same `PK.digitizer.runPipeline` the app uses (2-point calibration on the 2/18 min and 0/250 mAU ticks, ';
md += 'colour mask on the blue trace, legend excluded, centroid extraction, gaps ≤ 15 px interpolated, resampled to 4001 points), then compared with the truth.\n\n';
md += 'Peaks are detected once on the noise-free truth curve (`PK.analysis.detectPeaks`, threshold 10 mAU) and their integration windows are frozen. ';
md += 'The digitized curve is then measured with `PK.analysis.peakMetrics` over **exactly the same windows**, so the errors below are caused by digitizing alone, ';
md += 'not by the peak detector choosing different bounds. The "auto-detect count" column separately shows what `detectPeaks` with `threshold: \'auto\'` finds on the raw (unsmoothed) digitized curve, passing the half-pixel y step as the noise quantum exactly as the app does for digitized traces.\n\n';
md += '**Reproduce:** `node tools/digitizer-accuracy.js` (zero dependencies, deterministic, ~' + Math.max(1, Math.round(ms / 1000)) + ' s). Writes this file.\n\n';

md += '## Headline\n\n';
const nat = results.filter(r => r.name.startsWith('native') && !r.name.includes('JPEG'));
const r900 = results.find(r => r.name === 'native 900 px');
const r300 = results.find(r => r.name === 'native 300 px');
const worst = results.reduce((a, b) => (b.maxA > a.maxA ? b : a));
md += `- At a **900 px wide plot** (a typical screenshot): RT error ≤ ${f(r900.maxRT, 4)} min (${f(r900.maxRTpx, 2)} px), height error ≤ ${f(r900.maxH, 1)} %, area error ≤ ${f(r900.maxA, 1)} %, area-% error ≤ ${f(r900.maxAPct, 2)} points, RMS y error ${f(r900.rmsY, 2)} mAU (${f(r900.rmsYpx, 2)} px).\n`;
md += `- At a **300 px wide plot** (a thumbnail): RT error ≤ ${f(r300.maxRT, 4)} min (${f(r300.maxRTpx, 2)} px), height error ≤ ${f(r300.maxH, 1)} %, area error ≤ ${f(r300.maxA, 1)} %, area-% error ≤ ${f(r300.maxAPct, 2)} points. The worst peak here is one whose apex is hidden behind the legend box at this size (see Interpretation) — a realistic failure, not a pipeline error.\n`;
const clean = nat.filter(r => r.plotW >= 450);
md += `- Across clean native widths 450–1400 px, RT errors stay within ${f(Math.max.apply(null, clean.map(r => r.maxRTpx)), 2)} px (≈ half a pixel, as expected from centroid extraction of an anti-aliased line) and area-% errors within ${f(Math.max.apply(null, clean.map(r => r.maxAPct)), 2)} points.\n`;
md += `- Worst case in this run: **${worst.name}**, max area error ${f(worst.maxA, 1)} %, max area-% error ${f(worst.maxAPct, 2)} points.\n\n`;

md += '## Summary by case\n\n';
md += '| Case | Image (px) | Plot w × h (px) | min/px | mAU/px | Coverage | Peaks measured | Auto-detect count (raw, as in the app) | RMS y (mAU / px) | max \\|ΔRT\\| min (px) | mean / max \\|Δheight\\| % | mean / max \\|Δarea\\| % | max \\|Δarea%\\| (points) |\n';
md += '|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of results) {
  md += `| ${r.name} | ${r.imgW}×${r.imgH} | ${r.plotW}×${r.plotH} | ${f(r.dxPerPx, 4)} | ${f(r.dyPerPx, 3)} | ${f(100 * r.coverage, 1)} % | ${r.found}/${truthPeaks.length} | ${r.auto == null ? '—' : r.auto} | ${f(r.rmsY, 2)} / ${f(r.rmsYpx, 2)} | ${f(r.maxRT, 4)} (${f(r.maxRTpx, 2)}) | ${f(r.meanH, 2)} / ${f(r.maxH, 2)} | ${f(r.meanA, 2)} / ${f(r.maxA, 2)} | ${f(r.maxAPct, 2)} |\n`;
}
md += '\n';

md += '## Per-peak errors\n\n';
md += 'Ground truth (from `PK.analysis` on the noise-free 4001-point curve): ' + truthPeaks.map(p => `${f(p.rt, 3)} min (H ${f(p.height, 1)}, ${f(p.areaPct, 1)} %)`).join(', ') + '.\n\n';
md += 'Each cell: ΔRT min / Δheight % / Δarea % / Δarea-% points (digitized − truth).\n\n';
md += '| Case | ' + truthPeaks.map(p => f(p.rt, 2) + ' min').join(' | ') + ' |\n';
md += '|---|' + truthPeaks.map(() => '---').join('|') + '|\n';
for (const r of results) {
  md += `| ${r.name} | ` + r.per.map(p => (p.missed ? 'missed' : `${sgn(p.dRT, 4)} / ${sgn(p.dH, 1)} / ${sgn(p.dA, 1)} / ${sgn(p.dAPct, 2)}`)).join(' | ') + ' |\n';
}
md += '\n';

md += '## Quality warnings the app would show\n\n';
for (const r of results) md += `- **${r.name}:** ${r.warnings.length ? r.warnings.join(' ') : 'none'}\n`;
md += '\n';

md += '## Interpretation\n\n';
md += '- **Retention time** is the most robust number. Centroid extraction of an anti-aliased line locates the apex to a fraction of a pixel, so RT error scales with *minutes per pixel*: halve the plot width and the error roughly doubles. The app reports ± half a pixel (`digitized.dxMin`) as the RT uncertainty, which these results support.\n';
md += '- **Heights** are limited by line thickness and vertical resolution. The centroid of a 2 px line sits on the curve, but at a sharp apex the line\'s round cap and anti-aliasing pull the centroid slightly below the true maximum, so narrow peaks read a little low, more so at low resolution.\n';
md += '- **Areas** inherit both the height error and the integrator\'s bound placement on a slightly staircased curve. **Area %** (relative areas) cancels most of the common-mode error and is the most reliable quantitative output, which is why the README recommends digitized data for area % of resolved peaks and not for absolute quantitation.\n';
md += '- **Automatic peak detection on digitized traces.** A digitized curve is a staircase quantized to whole pixels. Peakly floors the noise estimate at the pixel step (the trace\'s ± y uncertainty), so `threshold: \'auto\'` ignores pixel steps; the auto-detect column shows the result (the truth has 5): clean renders at 450 px and up give 5 to 6, while blurred, JPEG-compressed or downscaled images still over-detect (8 to 14) because blur and compression add structure larger than one pixel. For those, turn on smoothing (Savitzky-Golay) or set a manual threshold of a few mAU/px before detecting, check the peak list against the image, and remember that peaks only a few pixels tall cannot be told apart from artefacts.\n';
md += '- **Fused peaks** (5.6 / 6.6 min here) carry the largest relative errors because the valley depth, and hence the split, is sensitive to a pixel or two.\n';
md += '- **JPEG-like compression and blur** widen and tint the line; with a wider colour tolerance the pipeline still recovers the trace, and the app\'s blockiness detector flags the image. Expect errors similar to a slightly smaller clean image.\n';
md += '- **Occlusion beats resolution.** The sample\'s legend box has a fixed size, so on the 300 px render it covers the apex of the 10.4 min peak. The pipeline bridges the hidden columns with a straight line, the apex is lost, and height/area errors jump (look for the large negative Δheight in that row). Excluding a region is correct, but nothing can recover data the image does not show. Check the Verify overlay for flattened apexes under legends, labels and annotations.\n';
md += '- **Quality warnings.** The "Low resolution" warning fires below 600 px and matches where errors grow. In this run the 8×8 blockiness heuristic also fired on some clean, never-compressed renders (anti-aliased gridlines that happen to fall on 8 px boundaries), so treat that warning as a prompt to check, not proof of JPEG damage.\n';
md += '- **Limits of this benchmark:** the test image is clean, synthetic and axis-aligned, with a known colour. Real screenshots add text overlapping the trace, clipped peaks, other traces of similar colour, and camera photos add perspective, lens distortion and uneven lighting (see `docs/tutorials/photo-of-screen.md`). Treat these numbers as a **best case**; real images will be worse. The calibration here uses exact tick positions; misplacing a calibration point by 1 px adds a systematic scale error of about 1/(calibration separation in px).\n\n';
md += '## Method details\n\n';
md += '- Native cases: `makeSampleImage({width: plotW + 120, height: 140 + plotW·420/780, canvas: false})`, so the plot area is exactly the stated width.\n';
md += '- Downscaled cases: the default 900×560 render resampled with a bilinear filter implemented in the tool; calibration pixels scaled by the same factor; colour tolerance 110.\n';
md += '- JPEG-like cases: separable Gaussian blur (σ = 0.8 px), then RGB→YCbCr, 8×8 block DCT, quantization with the standard JPEG Annex K tables scaled to the given quality, inverse DCT (no chroma subsampling); colour tolerance 110.\n';
md += '- Matching: truth integration windows are re-used on the digitized curve (a peak is "measured" if its digitized apex lies within 0.3 min of the truth apex). RT is the parabolic apex, height and area are relative to the straight line between the window bounds, as in `peakMetrics`.\n';
md += `- Generated ${new Date().toISOString().slice(0, 10)} with Peakly ${(PK.config && PK.config.version) || PK.version}; runtime ${ms} ms.\n`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);
if (!QUIET) {
  for (const r of results) console.log(`${r.name.padEnd(40)} cov ${f(100 * r.coverage, 1)}%  found ${r.found}/${truthPeaks.length} auto ${r.auto}  maxRT ${f(r.maxRT, 4)} min (${f(r.maxRTpx, 2)} px)  maxH ${f(r.maxH, 2)}%  maxA ${f(r.maxA, 2)}%  maxA% ${f(r.maxAPct, 2)}  rmsY ${f(r.rmsY, 2)}`);
  console.log('\nwritten:', path.relative(root, OUT), `(${ms} ms)`);
}
