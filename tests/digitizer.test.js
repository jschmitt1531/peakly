/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Digitizer tests: pure raster path only (no DOM). */
(function (PK) {
  'use strict';
  var D = PK.digitizer;

  function blank(w, h) { return D._makeImage(w, h); }
  function setPx(img, x, y, rgb) { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; var k = (y * img.width + x) * 4; img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2]; }
  function distToPolyline(px, py, poly, i0, i1) {
    var best = Infinity;
    for (var i = Math.max(0, i0); i < Math.min(poly.length - 1, i1); i++) {
      var a = poly[i], b = poly[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      var d = Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py); if (d < best) best = d;
    }
    return best;
  }
  function truthApexes(x, y) {
    var out = [];
    for (var i = 2; i < y.length - 2; i++) if (y[i] > y[i - 1] && y[i] >= y[i + 1] && y[i] > y[i - 2] && y[i] >= y[i + 2]) {
      var lo = Infinity; for (var j = Math.max(0, i - 200); j < Math.min(y.length, i + 200); j++) lo = Math.min(lo, y[j]);
      if (y[i] - lo > 10) out.push(x[i]);
    }
    return out;
  }
  // shared sample (built once, raster path)
  var _sample = null;
  function sample() { return _sample || (_sample = D.makeSampleImage({ canvas: false })); }

  PK.test('digitizer: calibrate linear round-trip', function (t) {
    var c = D.calibrate({ x1: { px: 100, val: 2 }, x2: { px: 900, val: 18 }, y1: { px: 500, val: 0 }, y2: { px: 100, val: 250 } });
    var d = c.toData(500, 300); t.near(d[0], 10, 1e-9, 'x mid'); t.near(d[1], 125, 1e-9, 'y mid (y grows down)');
    var p = c.toPixel(d[0], d[1]); t.near(p[0], 500, 1e-9, 'px back'); t.near(p[1], 300, 1e-9, 'py back');
    t.near(c.dxPerPx, 16 / 800, 1e-12, 'dx/px'); t.near(c.dyPerPx, 250 / 400, 1e-12, 'dy/px');
    t.throws(function () { D.calibrate({ x1: { px: 5, val: 1 }, x2: { px: 5, val: 2 }, y1: { px: 0, val: 0 }, y2: { px: 1, val: 1 } }); }, 'same px throws');
  });

  PK.test('digitizer: calibrate log round-trip', function (t) {
    var c = D.calibrate({ x1: { px: 0, val: 1 }, x2: { px: 300, val: 1000 }, y1: { px: 400, val: 0.1 }, y2: { px: 0, val: 100 }, xLog: true, yLog: true });
    var d = c.toData(100, 200); t.near(d[0], 10, 1e-9, 'log x decade'); t.near(d[1], Math.sqrt(1000) / 10, 1e-9, 'log y mid = 10^0.5');
    [[37, 211], [250.5, 3.2], [0, 400]].forEach(function (pp) { var q = c.toPixel.apply(null, c.toData(pp[0], pp[1])); t.near(q[0], pp[0], 1e-8, 'rt px'); t.near(q[1], pp[1], 1e-8, 'rt py'); });
    t.near(c.dxAt(100), Math.LN10 * 10 / 100, 1e-9, 'local dx/px on log axis');
    t.throws(function () { D.calibrate({ x1: { px: 0, val: 0 }, x2: { px: 1, val: 10 }, y1: { px: 0, val: 0 }, y2: { px: 1, val: 1 }, xLog: true }); }, 'log of 0 throws');
  });

  PK.test('digitizer: homography maps 4 points exactly; warp rectifies a quadrilateral', function (t) {
    var src = [[20, 10], [80, 25], [85, 90], [15, 70]], dst = [[0, 0], [59, 0], [59, 59], [0, 59]];
    var H = D.homography(src, dst);
    src.forEach(function (p, i) { var q = D.applyH(H, p[0], p[1]); t.near(q[0], dst[i][0], 1e-7, 'u' + i); t.near(q[1], dst[i][1], 1e-7, 'v' + i); });
    var Hi = D.invert3(H), q = D.applyH(Hi, 30, 30), r = D.applyH(H, q[0], q[1]); t.near(r[0], 30, 1e-8, 'inverse x'); t.near(r[1], 30, 1e-8, 'inverse y');
    // black image with white filled quadrilateral and a red dot at a known interior point
    var img = blank(100, 100), black = [0, 0, 0], white = [255, 255, 255];
    function inside(x, y) { // convex polygon test (consistent winding)
      var s = 0; for (var i = 0; i < 4; i++) { var a = src[i], b = src[(i + 1) % 4], cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (cr < 0) return false; } return true;
    }
    for (var y = 0; y < 100; y++) for (var x = 0; x < 100; x++) setPx(img, x, y, inside(x, y) ? white : black);
    var out = D.warp(img, H, 60, 60), bad = 0;
    for (var yy = 2; yy < 58; yy++) for (var xx = 2; xx < 58; xx++) if (out.data[(yy * 60 + xx) * 4] < 200) bad++;
    t.eq(bad, 0, 'all interior pixels of the rectified quad are white');
    t.eq(out.width, 60, 'out width'); t.eq(out.height, 60, 'out height');
  });

  PK.test('digitizer: colorMask with tolerance, include and exclude', function (t) {
    var img = blank(20, 10);
    setPx(img, 2, 2, [37, 99, 235]); setPx(img, 3, 2, [60, 120, 240]); setPx(img, 4, 2, [200, 40, 40]); setPx(img, 15, 5, [37, 99, 235]);
    var m = D.colorMask(img, [37, 99, 235], 40);
    t.eq(m[2 * 20 + 2], 1, 'exact match'); t.eq(m[2 * 20 + 3], 1, 'near match within tol'); t.eq(m[2 * 20 + 4], 0, 'red rejected'); t.eq(m[0], 0, 'white rejected');
    var m2 = D.colorMask(img, [37, 99, 235], 10); t.eq(m2[2 * 20 + 3], 0, 'tight tol rejects near colour');
    var m3 = D.colorMask(img, [37, 99, 235], 40, { exclude: [{ x: 14, y: 4, w: 3, h: 3 }] }); t.eq(m3[5 * 20 + 15], 0, 'excluded rect');
    var m4 = D.colorMask(img, [37, 99, 235], 40, { include: { x: 10, y: 0, w: 10, h: 10 } }); t.eq(m4[2 * 20 + 2], 0, 'outside include'); t.eq(m4[5 * 20 + 15], 1, 'inside include');
    var img2 = blank(4, 1); setPx(img2, 0, 0, [10, 10, 10]); setPx(img2, 1, 0, [120, 120, 120]); setPx(img2, 2, 0, [20, 20, 200]);
    var md = D.colorMask(img2, null, 100, { mode: 'dark' }); t.eq(Array.from(md).join(''), '1000', 'dark mode: only near-black, low-chroma');
  });

  PK.test('digitizer: removeLines removes grid/axes but keeps the trace', function (t) {
    var w = 200, h = 100, m = new Uint8Array(w * h), trace = [];
    for (var x = 0; x < w; x++) { m[50 * w + x] = 1; m[99 * w + x] = 1; }          // gridline + bottom axis
    for (var y = 0; y < h; y++) { m[y * w + 100] = 1; m[y * w + 0] = 1; }          // vertical gridline + left axis
    for (var x2 = 0; x2 < w; x2++) { var yy = Math.round(10 + 0.35 * x2); for (var k = 0; k < 2; k++) { m[(yy + k) * w + x2] = 1; trace.push((yy + k) * w + x2); } }
    var out = D.removeLines(m, w, h, { minRun: 80 });
    var kept = trace.filter(function (i) { return out[i]; }).length;
    t.ok(kept / trace.length > 0.97, 'trace kept (' + kept + '/' + trace.length + ')');
    var gridLeft = 0; for (var x3 = 0; x3 < w; x3++) if (out[50 * w + x3] && trace.indexOf(50 * w + x3) < 0) gridLeft++;
    t.ok(gridLeft <= 10, 'horizontal gridline removed except next to the crossing (left ' + gridLeft + ')');
    var vLeft = 0; for (var y3 = 0; y3 < h; y3++) if (out[y3 * w + 100] && trace.indexOf(y3 * w + 100) < 0) vLeft++;
    t.ok(vLeft <= 4, 'vertical gridline removed (left ' + vLeft + ')');
    var axisLeft = 0; for (var x4 = 0; x4 < w; x4++) if (out[99 * w + x4]) axisLeft++;
    t.ok(axisLeft <= 3, 'bottom axis removed');
    var ex = D.extractTrace(out, w, h, { mode: 'centroid', xRange: [5, 195] }), err = 0, n = 0;
    for (var c = 5; c <= 195; c++) if (isFinite(ex[c])) { err = Math.max(err, Math.abs(ex[c] - (Math.round(10 + 0.35 * c) + 0.5))); n++; }
    t.ok(n > 185 && err <= 1, 'trace still extractable after line removal (max err ' + err + ')');
  });

  PK.test('digitizer: extractTrace centroid vs top on a 2-px thick line', function (t) {
    var w = 50, h = 30, m = new Uint8Array(w * h);
    for (var x = 0; x < w; x++) { m[10 * w + x] = 1; m[11 * w + x] = 1; }
    m[25 * w + 20] = 1; m[26 * w + 20] = 1; m[27 * w + 20] = 1; // noise blob below in one column
    var c = D.extractTrace(m, w, h, { mode: 'centroid' }), tp = D.extractTrace(m, w, h, { mode: 'top' });
    t.near(c[5], 10.5, 1e-12, 'centroid = line centre'); t.near(tp[5], 10, 1e-12, 'top = upper edge');
    t.near(c[20], 10.5, 1e-12, 'centroid tracks continuity, ignores blob');
    var r = D.extractTrace(m, w, h, { xRange: [10, 30] }); t.ok(isNaN(r[5]) && isFinite(r[15]), 'xRange respected');
    t.eq(c.length, w, 'one value per column');
  });

  PK.test('digitizer: fillGaps interpolates short interior gaps only', function (t) {
    var a = [NaN, 1, NaN, NaN, 4, NaN, NaN, NaN, NaN, NaN, 10, NaN];
    var f = D.fillGaps(a, 3);
    t.ok(isNaN(f[0]) && isNaN(f[11]), 'edges untouched'); t.near(f[2], 2, 1e-12, 'gap fill 1'); t.near(f[3], 3, 1e-12, 'gap fill 2');
    t.ok(isNaN(f[6]), 'gap > maxGap stays NaN');
    var g = D.fillGaps(a, 10); t.near(g[7], 7, 1e-12, 'long gap filled when allowed');
  });

  PK.test('digitizer: full pipeline on sample raster (blue trace)', function (t) {
    var s = sample(), img = s.image, ax = s.axes;
    t.eq(img.width, 900, 'raster width'); t.ok(img.data instanceof Uint8ClampedArray, 'ImageData-like');
    var cal = D.calibrate({ x1: ax.x1, x2: ax.x2, y1: ax.y1, y2: ax.y2 });
    var blue = s.truth.traces[0];
    var res = D.runPipeline(img, cal, { rgb: blue.rgb, tol: 90, include: ax.plot, exclude: [s.legend], maxGap: 15, xRange: [ax.plot.x + 3, ax.plot.x + ax.plot.w - 3] });
    t.ok(res.coverage > 0.97, 'coverage ' + res.coverage.toFixed(3));
    var poly = blue.x.map(function (x, i) { return cal.toPixel(x, blue.y[i]); });
    var sum = 0, n = 0, perPx = (poly.length - 1) / (poly[poly.length - 1][0] - poly[0][0]);
    res.pts.forEach(function (p) {
      var i0 = Math.round((p[0] - poly[0][0]) * perPx);
      var d = distToPolyline(p[0], p[1], poly, i0 - 40, i0 + 40); sum += d * d; n++;
    });
    var rms = Math.sqrt(sum / n);
    t.ok(rms < 1.5, 'RMS px-equivalent error ' + rms.toFixed(3) + ' < 1.5');
    var dxMin = 0.5 * cal.dxPerPx, apexTruth = truthApexes(blue.x, blue.y), found = D._simplePeaks(res.x, res.y);
    t.eq(found.length, apexTruth.length, 'same number of peaks (' + found.map(function (p) { return p.rt.toFixed(3); }).join(',') + ')');
    apexTruth.forEach(function (rt) {
      var best = found.reduce(function (b, p) { return Math.abs(p.rt - rt) < Math.abs(b.rt - rt) ? p : b; }, { rt: Infinity });
      t.ok(Math.abs(best.rt - rt) <= 2 * dxMin, 'apex ' + rt.toFixed(3) + ' found at ' + best.rt.toFixed(4) + ' (tol ' + (2 * dxMin).toFixed(4) + ')');
    });
    // computed vs printed comparison should agree on RT for the sample
    var cmp = D.comparePrinted(found, s.printedPeaks, { dxMin: dxMin, area: 3 });
    t.ok(cmp.every(function (r) { return r.computed && Math.abs(r.dRt) <= Math.max(2 * dxMin, 0.02); }), 'printed RTs match digitized RTs');
  });

  PK.test('digitizer: orange trace (partly occluded) and dark-mode monochrome pipeline', function (t) {
    var s = sample(), ax = s.axes, cal = D.calibrate({ x1: ax.x1, x2: ax.x2, y1: ax.y1, y2: ax.y2 });
    var or = s.truth.traces[1];
    var r = D.runPipeline(s.image, cal, { rgb: or.rgb, tol: 90, include: ax.plot, exclude: [s.legend], maxGap: 30 });
    var err = 0; r.rawX.forEach(function (x, i) { err = Math.max(err, Math.abs(r.rawY[i] - PK.util.interp1(or.x, or.y, x))); });
    t.ok(r.coverage > 0.8, 'orange coverage ' + r.coverage.toFixed(2));
    t.ok(err < 12, 'orange max abs error ' + err.toFixed(2) + ' mAU (occluded where traces overlap)');
    var m = D.makeSampleImage({ canvas: false, mono: true }), mt = m.truth.traces[0];
    var rd = D.runPipeline(m.image, cal, { mode: 'dark', tol: 110, include: ax.plot, exclude: [m.legend], removeGrid: true, maxGap: 15 });
    var poly = mt.x.map(function (x, i) { return cal.toPixel(x, mt.y[i]); }), perPx = (poly.length - 1) / (poly[poly.length - 1][0] - poly[0][0]), sum = 0;
    rd.pts.forEach(function (p) { var i0 = Math.round((p[0] - poly[0][0]) * perPx), d = distToPolyline(p[0], p[1], poly, i0 - 40, i0 + 40); sum += d * d; });
    var rms = Math.sqrt(sum / rd.pts.length);
    t.ok(rd.coverage > 0.95, 'dark-mode coverage ' + rd.coverage.toFixed(3));
    t.ok(rms < 2, 'dark-mode RMS ' + rms.toFixed(3) + ' px (gridlines + axes removed)');
  });

  PK.test('digitizer: detectColors finds the two trace colours; estimateSkew; rotate/crop ops', function (t) {
    var s = sample(), cands = D.detectColors(s.image, { include: s.axes.plot });
    t.ok(cands.length >= 2, 'at least 2 candidates');
    s.truth.traces.forEach(function (tr) {
      var best = Math.min.apply(null, cands.slice(0, 3).map(function (c) { return Math.hypot(c.rgb[0] - tr.rgb[0], c.rgb[1] - tr.rgb[1], c.rgb[2] - tr.rgb[2]); }));
      t.ok(best < 60, tr.name + ' colour found (dist ' + best.toFixed(1) + ')');
    });
    var img = blank(300, 200), ang = 3 * Math.PI / 180;
    [40, 90, 140].forEach(function (y0) { for (var x = 20; x < 280; x++) { var y = Math.round(y0 + (x - 150) * Math.tan(ang)); setPx(img, x, y, [0, 0, 0]); setPx(img, x, y + 1, [0, 0, 0]); } });
    var sk = D.estimateSkew(img); t.near(sk, 3, 0.2, 'skew estimate');
    var fixed = D.rotateImage(img, -sk); t.near(D.estimateSkew(fixed), 0, 0.2, 'deskewed');
    var cr = D.applyOps(img, [{ type: 'crop', rect: { x: 10, y: 20, w: 50, h: 30 } }, { type: 'rot90', k: 1 }]);
    t.eq(cr.width, 30, 'crop+rot90 width'); t.eq(cr.height, 50, 'crop+rot90 height');
    var back = D.rot90(D.rot90(cr, 1), -1); t.eq(Array.from(back.data).join(','), Array.from(cr.data).join(','), 'rot90 cw then ccw is identity');
    var adj = D.adjustImage(s.image, { threshold: 128 }); t.ok(adj.data[0] === 255 && adj.data[1] === 255, 'threshold keeps white');
  });

  PK.test('digitizer: qualityWarnings flags tiny/low-res and JPEG blockiness', function (t) {
    var tiny = blank(200, 150);
    var w = D.qualityWarnings(tiny, { calibSepPx: { x: 60, y: 40 }, coverage: 0.5 });
    t.ok(w.some(function (s) { return /low resolution/i.test(s); }), 'low-res flagged');
    t.ok(w.some(function (s) { return /small image/i.test(s); }), 'tiny flagged');
    t.ok(w.some(function (s) { return /X calibration points/i.test(s); }), 'calibration separation flagged');
    t.ok(w.some(function (s) { return /50%/.test(s); }), 'coverage flagged');
    var blk = blank(256, 256);
    for (var y = 0; y < 256; y++) for (var x = 0; x < 256; x++) { var v = 120 + ((((x >> 3) * 7 + (y >> 3) * 13) % 9) - 4) * 6; setPx(blk, x, y, [v, v, v]); }
    t.ok(D.qualityWarnings(blk, { plotWidthPx: 900 }).some(function (s) { return /JPEG/.test(s); }), 'blockiness flagged');
    var s = sample(); var ok = D.qualityWarnings(s.image, { plotWidthPx: s.axes.plot.w, calibSepPx: { x: 600, y: 350 }, coverage: 0.99 });
    t.eq(ok.length, 0, 'clean sample has no warnings: ' + ok.join(' | '));
  });

  PK.test('digitizer: comparePrinted flags injected mismatch', function (t) {
    var computed = [{ rt: 2.851, areaPct: 10.1 }, { rt: 5.62, areaPct: 40 }, { rt: 10.4, areaPct: 49.9 }];
    var printed = [{ rt: 2.85, areaPct: 10, label: 'a' }, { rt: 5.70, areaPct: 40, label: 'b' }, { rt: 10.41, areaPct: 45, label: 'c' }, { rt: 17.0, label: 'd' }];
    var r = D.comparePrinted(computed, printed, { dxMin: 0.0128 });
    t.eq(r.length, 4, 'one row per printed peak');
    t.ok(!r[0].mismatch, 'a matches'); t.ok(r[1].mismatch, 'b RT mismatch (0.08 min)'); t.ok(r[2].mismatch, 'c area mismatch (4.9 points)'); t.ok(r[3].mismatch && !r[3].computed, 'd unmatched');
    t.near(r[0].rtTol, 0.0256, 1e-9, 'rt tol = max(2·dxMin, 0.02)');
    t.near(D.comparePrinted(computed, printed, { dxMin: 0.001 })[0].rtTol, 0.02, 1e-12, 'rt tol floor 0.02 min');
  });

  PK.test('digitizer: Claude JSON parser handles fences, prose and truncation', function (t) {
    var obj = { title: 'Run 1', xAxis: { unit: 'min', ticks: [{ value: 0, px: 50 }, { value: 10, px: 450 }] }, peaks: [{ rt: 3.2, areaPct: 12.5, label: 'A' }] };
    var js = JSON.stringify(obj);
    t.eq(D._parseClaudeJSON(js).title, 'Run 1', 'plain JSON');
    t.eq(D._parseClaudeJSON('```json\n' + js + '\n```').xAxis.ticks[1].px, 450, 'fenced JSON');
    t.eq(D._parseClaudeJSON('Sure! Here is the data:\n' + js + '\nLet me know.').peaks[0].rt, 3.2, 'prose around JSON');
    t.eq(D._parseClaudeJSON('{"a":[1,2,],"b":{"c":"x",},}').a.length, 2, 'trailing commas');
    var cut = js.slice(0, js.indexOf('"peaks"') + 25); // truncated mid-array
    var p = D._parseClaudeJSON(cut);
    t.ok(p && p.title === 'Run 1' && p.xAxis.ticks.length === 2, 'truncated JSON recovers complete parts');
    var p2 = D._parseClaudeJSON('```json\n{"title":"T","xAxis":{"label":"Time (mi');
    t.ok(p2 && p2.title === 'T', 'truncated inside a string');
    t.eq(D._parseClaudeJSON('no json here'), null, 'no JSON -> null');
    var n = D._normalizeClaude({ imageSize: { w: 1000, h: 500 }, xAxis: { scale: 'linear', ticks: [{ value: 0, px: 100 }, { value: '20', px: 900 }] }, yAxis: { ticks: [{ value: 0, py: 400 }] }, plotBox: { left: 100, top: 50, right: 900, bottom: 400 }, traces: [{ color: '#00f' }], peaks: [{ rt: '5.5' }, { rt: null }] }, 1000, 500, 2000, 1000);
    t.near(n.xAxis.ticks[1].px, 1800, 1e-9, 'tick px rescaled to full image'); t.near(n.xAxis.ticks[1].approxPxFrac, 0.9, 1e-9, 'approxPxFrac');
    t.near(n.plotBox.bottom, 800, 1e-9, 'plot box rescaled'); t.eq(n.traces[0].color, '#0000ff', 'colour normalised'); t.eq(n.peaks.length, 1, 'invalid peaks dropped');
  });

  PK.test('digitizer: askClaude builds the documented request and maps HTTP errors', function (t) {
    var calls = [];
    function fakeFetch(status, body) {
      return function (url, init) { calls.push({ url: url, init: init }); return Promise.resolve({ ok: status < 300, status: status, statusText: '', text: function () { return Promise.resolve(body); } }); };
    }
    var url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='; // valid 1x1 PNG (decodable in browsers)
    return D.askClaude('k-123', url, 'claude-haiku-4-5-20251001', { fetch: fakeFetch(200, JSON.stringify({ content: [{ type: 'text', text: '```json\n{"title":"X","xAxis":{"ticks":[]},"yAxis":{"ticks":[]}}\n```' }] })), sentW: 800, sentH: 600 })
      .then(function (r) {
        var c = calls[0], h = c.init.headers, b = JSON.parse(c.init.body);
        t.eq(c.url, 'https://api.anthropic.com/v1/messages', 'endpoint');
        t.eq(h['x-api-key'], 'k-123', 'key header'); t.eq(h['anthropic-version'], '2023-06-01', 'version header');
        t.eq(h['anthropic-dangerous-direct-browser-access'], 'true', 'browser access header'); t.eq(h['content-type'], 'application/json', 'content type');
        t.eq(b.model, 'claude-haiku-4-5-20251001', 'model'); t.eq(b.max_tokens, 2000, 'max_tokens');
        t.ok(/^image\/(jpeg|png)$/.test(b.messages[0].content[0].source.media_type), 'image block'); t.ok(/STRICT JSON/.test(b.messages[0].content[1].text), 'prompt');
        t.eq(r.title, 'X', 'parsed result');
        return D.askClaude('bad', url, null, { fetch: fakeFetch(401, '{"error":{"message":"invalid x-api-key"}}') }).then(function () { t.ok(false, '401 should reject'); }, function (e) { t.ok(/401/.test(e.message), '401 message: ' + e.message); });
      }).then(function () {
        return D.askClaude('k', url, null, { fetch: fakeFetch(429, '{"error":{"message":"rate"}}') }).then(function () { t.ok(false); }, function (e) { t.ok(/Rate limited/.test(e.message), '429 message'); });
      }).then(function () {
        return D.askClaude('k', url, null, { fetch: function () { return Promise.reject(new TypeError('Failed to fetch')); } }).then(function () { t.ok(false); }, function (e) { t.ok(/CORS/.test(e.message), 'network/CORS message'); });
      });
  });

  PK.test('digitizer: JPEG blockiness warns on 8x8 block artifacts but not on clean renders', function (t) {
    var img = D.makeSampleImage({ canvas: false }).image;
    var jpg = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }, seed = 7;
    function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var by = 0; by < img.height; by += 8) for (var bx = 0; bx < img.width; bx += 8) {
      var off = (r() - 0.5) * 8;
      for (var y = by; y < Math.min(by + 8, img.height); y++) for (var x = bx; x < Math.min(bx + 8, img.width); x++) for (var c = 0; c < 3; c++) { var i = (y * img.width + x) * 4 + c; jpg.data[i] = Math.round((jpg.data[i] + off) / 4) * 4; }
    }
    var has = function (im) { return D.qualityWarnings(im, { plotWidthPx: 9999 }).some(function (w) { return /JPEG/.test(w); }); };
    t.eq(has(img), false, 'clean render: no JPEG warning');
    t.eq(has(jpg), true, 'blocky image: JPEG warning');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
