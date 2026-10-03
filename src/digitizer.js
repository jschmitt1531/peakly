/* SPDX-License-Identifier: MIT */
/* Peakly digitizer: image -> chromatogram.
 * Pure raster functions (Node-testable with ImageData-like {width,height,data:Uint8ClampedArray})
 * plus the interactive stepper UI (Prep -> Calibrate -> Extract -> Verify -> Send) rendered into #digitizer-root.
 * Concepts (2-point axis calibration, colour-distance masks, per-column extraction, homography) are the
 * standard plot-digitizing ideas popularised by WebPlotDigitizer (AGPL); this is an independent
 * implementation written from scratch, no code copied. */
(function (PK) {
  'use strict';
  var D = PK.digitizer = PK.digitizer || {};
  var HAS_DOM = function () { return typeof document !== 'undefined'; };

  /* ======================================================================
   * Small helpers
   * ==================================================================== */
  function makeImage(w, h, rgb) {
    var d = new Uint8ClampedArray(w * h * 4), r = rgb ? rgb[0] : 255, g = rgb ? rgb[1] : 255, b = rgb ? rgb[2] : 255;
    for (var i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    return { width: w, height: h, data: d };
  }
  D._makeImage = makeImage;
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null;
    var s = m[1]; if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  function rgbToHex(c) { return '#' + c.slice(0, 3).map(function (v) { var s = Math.round(Math.max(0, Math.min(255, v))).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  D.hexToRgb = hexToRgb; D.rgbToHex = rgbToHex;
  function normRect(r, w, h) {
    var x0 = Math.min(r.x, r.x + r.w), y0 = Math.min(r.y, r.y + r.h), x1 = Math.max(r.x, r.x + r.w), y1 = Math.max(r.y, r.y + r.h);
    if (w != null) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  D._normRect = normRect;
  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  /* ======================================================================
   * Calibration (2 points per axis, linear or log10)
   * c = {x1:{px,val}, x2:{px,val}, y1:{px,val}, y2:{px,val}, xLog, yLog}
   * x*.px = horizontal pixel coordinate; y*.px = vertical pixel coordinate (y grows downward).
   * ==================================================================== */
  D.calibrate = function (c) {
    function axis(p1, p2, log, name) {
      if (!p1 || !p2) throw new Error(name + ' calibration needs two points');
      var a = +p1.px, b = +p2.px, va = +p1.val, vb = +p2.val;
      if (!isFinite(a) || !isFinite(b) || !isFinite(va) || !isFinite(vb)) throw new Error(name + ' calibration points/values must be numbers');
      if (Math.abs(b - a) < 1e-9) throw new Error(name + ' calibration points must be at different pixel positions');
      if (log && (va <= 0 || vb <= 0)) throw new Error(name + ' log axis values must be > 0');
      var ua = log ? Math.log10(va) : va, ub = log ? Math.log10(vb) : vb;
      if (ua === ub) throw new Error(name + ' calibration values must differ');
      var s = (ub - ua) / (b - a);
      return {
        toVal: function (p) { var u = ua + (p - a) * s; return log ? Math.pow(10, u) : u; },
        toPx: function (v) { var u = log ? Math.log10(v) : v; return a + (u - ua) / s; },
        perPxAt: function (p) { return log ? Math.LN10 * Math.pow(10, ua + (p - a) * s) * Math.abs(s) : Math.abs(s); },
        mid: (a + b) / 2, sepPx: Math.abs(b - a)
      };
    }
    var X = axis(c.x1, c.x2, !!c.xLog, 'X'), Y = axis(c.y1, c.y2, !!c.yLog, 'Y');
    return {
      toData: function (px, py) { return [X.toVal(px), Y.toVal(py)]; },
      toPixel: function (x, y) { return [X.toPx(x), Y.toPx(y)]; },
      dxPerPx: X.perPxAt(X.mid), dyPerPx: Y.perPxAt(Y.mid),
      dxAt: X.perPxAt, dyAt: Y.perPxAt,
      sepPx: { x: X.sepPx, y: Y.sepPx }, xLog: !!c.xLog, yLog: !!c.yLog
    };
  };

  /* ======================================================================
   * Masks
   * ==================================================================== */
  // Colour-distance mask. rgb=[r,g,b]; tol = Euclidean RGB distance (0..441).
  // opts.mode==='dark' (or rgb==null): matches dark, low-saturation pixels with luminance <= tol (0..255).
  // opts.include = {x,y,w,h} restricts to a rectangle; opts.exclude = [{x,y,w,h}] removes rectangles.
  D.colorMask = function (img, rgb, tol, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, d = img.data, mask = new Uint8Array(w * h);
    var dark = opts.mode === 'dark' || !rgb;
    var x0 = 0, y0 = 0, x1 = w, y1 = h;
    if (opts.include) { var r = normRect(opts.include, w, h); x0 = Math.round(r.x); y0 = Math.round(r.y); x1 = Math.round(r.x + r.w); y1 = Math.round(r.y + r.h); }
    var ex = null;
    if (opts.exclude && opts.exclude.length) {
      ex = new Uint8Array(w * h);
      opts.exclude.forEach(function (e) {
        var q = normRect(e, w, h), qx0 = Math.floor(q.x), qy0 = Math.floor(q.y), qx1 = Math.ceil(q.x + q.w), qy1 = Math.ceil(q.y + q.h);
        for (var yy = qy0; yy < qy1; yy++) for (var xx = qx0; xx < qx1; xx++) ex[yy * w + xx] = 1;
      });
    }
    var tol2 = tol * tol, maxSat = opts.maxChroma == null ? 70 : opts.maxChroma;
    var R = dark ? 0 : rgb[0], G = dark ? 0 : rgb[1], B = dark ? 0 : rgb[2];
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var i = y * w + x; if (ex && ex[i]) continue;
        var k = i * 4, r0 = d[k], g0 = d[k + 1], b0 = d[k + 2];
        if (d[k + 3] < 16) continue;
        if (dark) {
          var mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0);
          if (lum(r0, g0, b0) <= tol && mx - mn <= maxSat) mask[i] = 1;
        } else {
          var dr = r0 - R, dg = g0 - G, db = b0 - B;
          if (dr * dr + dg * dg + db * db <= tol2) mask[i] = 1;
        }
      }
    }
    return mask;
  };

  // Remove long horizontal/vertical runs (gridlines, axes). A line pixel is kept when the
  // mask continues beyond the line's thickness (i.e. a trace crosses it), so traces survive.
  // opts: {minRun (both), minRunH, minRunV, maxThickness:4, horizontal:true, vertical:true}
  D.removeLines = function (mask, w, h, opts) {
    opts = opts || {};
    var minH = opts.minRunH || opts.minRun || Math.max(20, Math.round(w * 0.5));
    var minV = opts.minRunV || opts.minRun || Math.max(20, Math.round(h * 0.5));
    var maxT = opts.maxThickness || 4;
    var out = new Uint8Array(mask);
    function pass(horizontal) {
      var L = horizontal ? h : w, N = horizontal ? w : h, minRun = horizontal ? minH : minV;
      var line = new Uint8Array(w * h), any = false;
      var idx = horizontal ? function (row, k) { return row * w + k; } : function (col, k) { return k * w + col; };
      for (var a = 0; a < L; a++) {
        var k = 0;
        while (k < N) {
          if (!mask[idx(a, k)]) { k++; continue; }
          var s = k; while (k < N && mask[idx(a, k)]) k++;
          if (k - s >= minRun) { any = true; for (var q = s; q < k; q++) line[idx(a, q)] = 1; }
        }
      }
      if (!any) return;
      // perpendicular scan: thin bands of line-pixels with nothing beyond them are removed
      for (var p = 0; p < N; p++) {
        var j = 0;
        while (j < L) {
          var id = horizontal ? j * w + p : p * w + j;
          if (!line[id]) { j++; continue; }
          var s2 = j; while (j < L && line[horizontal ? j * w + p : p * w + j]) j++;
          var e2 = j - 1, thick = j - s2;
          var before = s2 - 1 >= 0 && mask[horizontal ? (s2 - 1) * w + p : p * w + s2 - 1];
          var after = j < L && mask[horizontal ? j * w + p : p * w + j];
          if (thick <= maxT && !before && !after) for (var q2 = s2; q2 <= e2; q2++) out[horizontal ? q2 * w + p : p * w + q2] = 0;
        }
      }
    }
    if (opts.horizontal !== false) pass(true);
    if (opts.vertical !== false) pass(false);
    return out;
  };

  /* ======================================================================
   * Per-column extraction
   * opts: {mode:'centroid'|'top'|'bottom', xRange:[px0,px1], yRange:[py0,py1], track:true}
   * Returns Float64Array(w) of pixel y per column (NaN where nothing found / outside xRange).
   * Centroid mode follows continuity: picks the run nearest the previous column's value.
   * ==================================================================== */
  D.extractTrace = function (mask, w, h, opts) {
    opts = opts || {};
    var mode = opts.mode || 'centroid', out = new Float64Array(w);
    for (var i = 0; i < w; i++) out[i] = NaN;
    var xr = opts.xRange || [0, w - 1], yr = opts.yRange || [0, h - 1];
    var c0 = Math.max(0, Math.round(Math.min(xr[0], xr[1]))), c1 = Math.min(w - 1, Math.round(Math.max(xr[0], xr[1])));
    var r0 = Math.max(0, Math.round(Math.min(yr[0], yr[1]))), r1 = Math.min(h - 1, Math.round(Math.max(yr[0], yr[1])));
    var prev = NaN, sinceValid = 0, track = opts.track !== false;
    for (var x = c0; x <= c1; x++) {
      var segs = [], y = r0;
      while (y <= r1) {
        if (!mask[y * w + x]) { y++; continue; }
        var s = y; while (y <= r1 && mask[y * w + x]) y++;
        segs.push([s, y - 1]);
      }
      if (!segs.length) { sinceValid++; continue; }
      var v;
      if (mode === 'top') v = segs[0][0];
      else if (mode === 'bottom') v = segs[segs.length - 1][1];
      else {
        var best = segs[0];
        if (track && isFinite(prev) && sinceValid < 25) {
          var bd = Infinity;
          segs.forEach(function (sg) {
            var dd = prev < sg[0] ? sg[0] - prev : prev > sg[1] ? prev - sg[1] : 0;
            if (dd < bd || (dd === bd && sg[1] - sg[0] > best[1] - best[0])) { bd = dd; best = sg; }
          });
        } else {
          segs.forEach(function (sg) { if (sg[1] - sg[0] > best[1] - best[0]) best = sg; });
        }
        v = (best[0] + best[1]) / 2;
      }
      out[x] = v; prev = v; sinceValid = 0;
    }
    return out;
  };

  // Linear interpolation across interior NaN runs of length <= maxGap. Leading/trailing NaN stay.
  D.fillGaps = function (arr, maxGap) {
    var n = arr.length, out = new Float64Array(n);
    for (var i = 0; i < n; i++) out[i] = arr[i];
    if (maxGap == null) maxGap = Infinity;
    var i2 = 0;
    while (i2 < n) {
      if (isFinite(out[i2])) { i2++; continue; }
      var s = i2; while (i2 < n && !isFinite(out[i2])) i2++;
      var L = i2 - s;
      if (s > 0 && i2 < n && L <= maxGap) {
        var a = out[s - 1], b = out[i2];
        for (var k = s; k < i2; k++) out[k] = a + (b - a) * (k - s + 1) / (L + 1);
      }
    }
    return out;
  };

  /* ======================================================================
   * Homography (DLT, h33 = 1) and warping
   * ==================================================================== */
  function solve(A, b) { // Gaussian elimination with partial pivoting; A n×n (copied)
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) throw new Error('Singular system (degenerate points)');
      var t = M[c]; M[c] = M[p]; M[p] = t;
      for (var r2 = c + 1; r2 < n; r2++) { var f = M[r2][c] / M[c][c]; if (!f) continue; for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k]; }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) { var s = M[i][n]; for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }
  D._solve = solve;
  // src4, dst4: [[x,y] x4]. Returns 3×3 H with dst ~ H·src.
  D.homography = function (src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solve(A, b);
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  };
  D.applyH = function (H, x, y) {
    var w = H[2][0] * x + H[2][1] * y + H[2][2];
    return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
  };
  D.invert3 = function (m) {
    var a = m[0][0], b = m[0][1], c = m[0][2], d = m[1][0], e = m[1][1], f = m[1][2], g = m[2][0], h = m[2][1], i = m[2][2];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-15) throw new Error('Matrix not invertible');
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  };
  // Warp img with H (maps SOURCE pixel coords -> OUTPUT pixel coords) into a w×h image.
  // Bilinear sampling; outside pixels are white. Pixel i has coordinate i (centre convention).
  D.warp = function (img, H, w, h, bg) {
    var Hi = D.invert3(H), out = makeImage(w, h, bg || [255, 255, 255]), od = out.data, sd = img.data, sw = img.width, sh = img.height;
    var a = Hi[0][0], b = Hi[0][1], c = Hi[0][2], d = Hi[1][0], e = Hi[1][1], f = Hi[1][2], g = Hi[2][0], hh = Hi[2][1], ii = Hi[2][2];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var W = g * x + hh * y + ii, sx = (a * x + b * y + c) / W, sy = (d * x + e * y + f) / W;
        if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue;
        var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        var xa = x0 < 0 ? 0 : x0, ya = y0 < 0 ? 0 : y0, xb = x0 + 1 >= sw ? sw - 1 : x0 + 1, yb = y0 + 1 >= sh ? sh - 1 : y0 + 1;
        if (xa >= sw) xa = sw - 1; if (ya >= sh) ya = sh - 1;
        var p00 = (ya * sw + xa) * 4, p10 = (ya * sw + xb) * 4, p01 = (yb * sw + xa) * 4, p11 = (yb * sw + xb) * 4, o = (y * w + x) * 4;
        for (var ch = 0; ch < 4; ch++) {
          var top = sd[p00 + ch] + (sd[p10 + ch] - sd[p00 + ch]) * fx, bot = sd[p01 + ch] + (sd[p11 + ch] - sd[p01 + ch]) * fx;
          od[o + ch] = top + (bot - top) * fy;
        }
      }
    }
    return out;
  };

  /* ======================================================================
   * Prep operations (pure): rotate, rot90, crop, perspective; adjustImage
   * ==================================================================== */
  D.rotateImage = function (img, deg) { // positive = clockwise on screen
    if (!deg) return img;
    var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), w = img.width, h = img.height;
    var W = Math.round(Math.abs(w * c) + Math.abs(h * s)), Hh = Math.round(Math.abs(w * s) + Math.abs(h * c));
    var cx = (w - 1) / 2, cy = (h - 1) / 2, CX = (W - 1) / 2, CY = (Hh - 1) / 2;
    var H = [[c, -s, CX - c * cx + s * cy], [s, c, CY - s * cx - c * cy], [0, 0, 1]];
    return D.warp(img, H, W, Hh);
  };
  D.rot90 = function (img, k) { // k=1 clockwise, k=-1 counter-clockwise
    var w = img.width, h = img.height, out = makeImage(h, w), sd = img.data, od = out.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var nx = k > 0 ? h - 1 - y : y, ny = k > 0 ? x : w - 1 - x, si = (y * w + x) * 4, oi = (ny * h + nx) * 4;
      od[oi] = sd[si]; od[oi + 1] = sd[si + 1]; od[oi + 2] = sd[si + 2]; od[oi + 3] = sd[si + 3];
    }
    return out;
  };
  D.cropImage = function (img, rect) {
    var r = normRect(rect, img.width, img.height), x0 = Math.round(r.x), y0 = Math.round(r.y), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
    w = Math.min(w, img.width - x0); h = Math.min(h, img.height - y0);
    var out = makeImage(w, h);
    for (var y = 0; y < h; y++) out.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
    return out;
  };
  // pts in order TL, TR, BR, BL (image coords). Output size from the longest opposite sides.
  D.perspectiveSize = function (pts) {
    function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
    return { w: Math.max(2, Math.round(Math.max(dist(pts[0], pts[1]), dist(pts[3], pts[2])))), h: Math.max(2, Math.round(Math.max(dist(pts[0], pts[3]), dist(pts[1], pts[2])))) };
  };
  D.perspectiveImage = function (img, pts, w, h) {
    if (!w || !h) { var sz = D.perspectiveSize(pts); w = sz.w; h = sz.h; }
    var H = D.homography(pts, [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]);
    return D.warp(img, H, w, h);
  };
  D.applyOps = function (img, ops) {
    var cur = img;
    (ops || []).forEach(function (op) {
      if (op.type === 'rotate') cur = D.rotateImage(cur, op.deg);
      else if (op.type === 'rot90') cur = D.rot90(cur, op.k);
      else if (op.type === 'crop') cur = D.cropImage(cur, op.rect);
      else if (op.type === 'perspective') cur = D.perspectiveImage(cur, op.pts, op.w, op.h);
      else if (op.type === 'adjust') cur = D.adjustImage(cur, op);
    });
    return cur;
  };
  // brightness, contrast in -100..100; threshold 0 (off) .. 255; gray bool
  D.adjustImage = function (img, p) {
    p = p || {};
    var b = (+p.brightness || 0) * 2.55, f = Math.pow(((+p.contrast || 0) + 100) / 100, 2), t = +p.threshold || 0, gray = !!p.gray;
    if (!b && f === 1 && !t && !gray) return img;
    var out = makeImage(img.width, img.height), s = img.data, o = out.data;
    for (var i = 0; i < s.length; i += 4) {
      var r = (s[i] - 128) * f + 128 + b, g = (s[i + 1] - 128) * f + 128 + b, bl = (s[i + 2] - 128) * f + 128 + b;
      if (gray || t) { var L = lum(r, g, bl); if (t) L = L >= t ? 255 : 0; r = g = bl = L; }
      o[i] = r; o[i + 1] = g; o[i + 2] = bl; o[i + 3] = s[i + 3];
    }
    return out;
  };

  // Skew estimate (degrees, clockwise-positive) from the dark-pixel mask: the angle that makes
  // row/column projection profiles of dark pixels sharpest (dominant long lines: axes, grid, frame).
  // Rotate by -estimateSkew(img) to deskew.
  D.estimateSkew = function (img, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, d = img.data, maxDeg = opts.maxDeg || 15, thr = opts.threshold || 140;
    var xs = [], ys = [], total = 0;
    for (var i = 0; i < w * h; i++) { var k = i * 4; if (lum(d[k], d[k + 1], d[k + 2]) < thr) total++; }
    if (total < 10) return 0;
    var step = Math.max(1, Math.floor(total / 40000)), cnt = 0;
    for (var j = 0; j < w * h; j++) { var q = j * 4; if (lum(d[q], d[q + 1], d[q + 2]) < thr) { if (cnt++ % step === 0) { xs.push(j % w); ys.push((j / w) | 0); } } }
    var cx = w / 2, cy = h / 2, diag = Math.ceil(Math.hypot(w, h)) + 2, n = xs.length;
    var bins1 = new Float64Array(2 * diag + 1), bins2 = new Float64Array(2 * diag + 1);
    function score(deg) {
      var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      bins1.fill(0); bins2.fill(0);
      for (var p = 0; p < n; p++) {
        var X = xs[p] - cx, Y = ys[p] - cy;
        bins1[Math.round(-X * s + Y * c) + diag]++; bins2[Math.round(X * c + Y * s) + diag]++;
      }
      var sc = 0; for (var b = 0; b < bins1.length; b++) sc += bins1[b] * bins1[b] + bins2[b] * bins2[b];
      return sc;
    }
    var best = 0, bs = -1;
    for (var a = -maxDeg; a <= maxDeg + 1e-9; a += 0.5) { var v = score(a); if (v > bs) { bs = v; best = a; } }
    var b0 = best;
    for (var a2 = b0 - 0.5; a2 <= b0 + 0.5 + 1e-9; a2 += 0.05) { var v2 = score(a2); if (v2 > bs) { bs = v2; best = a2; } }
    return Math.round(best * 100) / 100;
  };

  // Candidate trace colours: saturated, non-gray pixels clustered by hue/value.
  D.detectColors = function (img, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, d = img.data, minSat = opts.minSat || 0.35, minVal = opts.minVal || 0.2;
    var r = opts.include ? normRect(opts.include, w, h) : { x: 0, y: 0, w: w, h: h };
    var x0 = Math.round(r.x), y0 = Math.round(r.y), x1 = Math.round(r.x + r.w), y1 = Math.round(r.y + r.h);
    var stride = Math.max(1, Math.round(Math.sqrt((x1 - x0) * (y1 - y0) / 400000)));
    var bins = {};
    for (var y = y0; y < y1; y += stride) for (var x = x0; x < x1; x += stride) {
      var k = (y * w + x) * 4, R = d[k], G = d[k + 1], B = d[k + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      var v = mx / 255, s = mx ? (mx - mn) / mx : 0;
      if (s < minSat || v < minVal) continue;
      var hue; if (mx === R) hue = ((G - B) / (mx - mn) + 6) % 6; else if (mx === G) hue = (B - R) / (mx - mn) + 2; else hue = (R - G) / (mx - mn) + 4;
      var key = Math.floor(hue * 4) + ':' + (v < 0.55 ? 0 : 1), wgt = s * s;
      var bn = bins[key] || (bins[key] = { n: 0, w: 0, r: 0, g: 0, b: 0 });
      bn.n++; bn.w += wgt; bn.r += R * wgt; bn.g += G * wgt; bn.b += B * wgt;
    }
    var list = Object.keys(bins).map(function (k) { var b = bins[k]; return { rgb: [b.r / b.w, b.g / b.w, b.b / b.w].map(Math.round), count: b.n * stride * stride }; })
      .sort(function (a, b) { return b.count - a.count; });
    var out = [], minCount = opts.minCount || 30;
    list.forEach(function (c) {
      if (c.count < minCount) return;
      var near = out.filter(function (o) { return Math.hypot(o.rgb[0] - c.rgb[0], o.rgb[1] - c.rgb[1], o.rgb[2] - c.rgb[2]) < 70; })[0];
      if (near) near.count += c.count; else out.push(c);
    });
    out.sort(function (a, b) { return b.count - a.count; });
    var tot = out.reduce(function (s, c) { return s + c.count; }, 0) || 1;
    return out.slice(0, opts.max || 6).map(function (c) { return { rgb: c.rgb, hex: rgbToHex(c.rgb), count: c.count, frac: c.count / tot }; });
  };

  /* ======================================================================
   * Full extraction pipeline (pure). Used by UI and tests.
   * o: {rgb, mode:'color'|'dark', tol, include, exclude, removeGrid, minRunFrac, extract:'centroid'|'top',
   *     xRange, maxGap, nPoints, xScale (multiply x, e.g. 1/60 for seconds->minutes)}
   * ==================================================================== */
  D.runPipeline = function (img, cal, o) {
    o = o || {};
    var w = img.width, h = img.height, dark = o.mode === 'dark';
    var inc = o.include ? normRect(o.include, w, h) : null;
    if (inc && dark) { var ins = o.inset == null ? 3 : o.inset; inc = { x: inc.x + ins, y: inc.y + ins, w: inc.w - 2 * ins, h: inc.h - 2 * ins }; }
    var mask = D.colorMask(img, dark ? null : o.rgb, o.tol == null ? (dark ? 110 : 80) : o.tol, { mode: dark ? 'dark' : 'color', include: inc, exclude: o.exclude });
    if (o.removeGrid) {
      var fr = o.minRunFrac || 0.5, pw = inc ? inc.w : w, ph = inc ? inc.h : h;
      mask = D.removeLines(mask, w, h, { minRunH: Math.max(15, Math.round(pw * fr)), minRunV: Math.max(15, Math.round(ph * fr)) });
    }
    var xr = o.xRange || (inc ? [inc.x, inc.x + inc.w - 1] : [0, w - 1]);
    var cols = D.extractTrace(mask, w, h, { mode: o.extract || 'centroid', xRange: xr });
    var c0 = Math.max(0, Math.round(Math.min(xr[0], xr[1]))), c1 = Math.min(w - 1, Math.round(Math.max(xr[0], xr[1])));
    var found = 0, first = -1, last = -1;
    for (var c = c0; c <= c1; c++) if (isFinite(cols[c])) { found++; if (first < 0) first = c; last = c; }
    var filled = D.fillGaps(cols, o.maxGap == null ? 15 : o.maxGap);
    var bridged = 0, gapsOver = 0;
    // bridge remaining interior gaps (> maxGap) so the trace is continuous; reported as warning
    var inGap = false;
    for (var c2 = first; c2 >= 0 && c2 <= last; c2++) {
      if (!isFinite(filled[c2])) { bridged++; if (!inGap) { gapsOver++; inGap = true; } } else inGap = false;
    }
    if (bridged) filled = D.fillGaps(filled, Infinity);
    var xs = [], ys = [], pts = [], sx = o.xScale || 1;
    for (var c3 = c0; c3 <= c1; c3++) if (isFinite(filled[c3])) {
      var dv = cal.toData(c3, filled[c3]); xs.push(dv[0] * sx); ys.push(dv[1]); pts.push([c3, filled[c3]]);
    }
    var order = xs.map(function (_, i) { return i; }).sort(function (a, b) { return xs[a] - xs[b]; });
    var X = order.map(function (i) { return xs[i]; }), Y = order.map(function (i) { return ys[i]; });
    // dedupe equal x (keep mean)
    var ux = [], uy = [];
    for (var i = 0; i < X.length; i++) { if (ux.length && X[i] === ux[ux.length - 1]) { uy[uy.length - 1] = (uy[uy.length - 1] + Y[i]) / 2; } else { ux.push(X[i]); uy.push(Y[i]); } }
    var gx = ux, gy = uy;
    if (ux.length >= 2 && o.nPoints && o.nPoints >= 2) {
      gx = PK.util.linspace(ux[0], ux[ux.length - 1], Math.round(o.nPoints));
      gy = PK.util.resample(ux, uy, gx);
    }
    var colsTotal = c1 - c0 + 1;
    return { mask: mask, cols: cols, filled: filled, pts: pts, x: gx, y: gy, rawX: ux, rawY: uy,
      coverage: colsTotal > 0 ? found / colsTotal : 0, found: found, bridgedPx: bridged, bigGaps: gapsOver, xRange: [c0, c1] };
  };

  /* ======================================================================
   * Simple peak finder fallback (used if PK.analysis is absent) — local maxima with prominence,
   * parabolic apex refinement, valley bounds, straight-line-baseline trapezoid area.
   * ==================================================================== */
  D._simplePeaks = function (x, y, opts) {
    opts = opts || {};
    var n = y.length; if (n < 5) return [];
    var mn = Infinity, mx = -Infinity; for (var i = 0; i < n; i++) { if (y[i] < mn) mn = y[i]; if (y[i] > mx) mx = y[i]; }
    var range = mx - mn || 1, minProm = (opts.minProm == null ? 0.03 : opts.minProm) * range, hw = Math.max(1, Math.round(n / 800));
    var peaks = [];
    for (var j = hw; j < n - hw; j++) {
      var ok = true; for (var q = j - hw; q <= j + hw; q++) if (y[q] > y[j] || (q < j && y[q] === y[j])) { ok = false; break; }
      if (!ok) continue;
      // prominence
      var lmin = y[j], a = j; while (a > 0 && y[a - 1] <= y[j]) { a--; if (y[a] < lmin) lmin = y[a]; }
      var rmin = y[j], b = j; while (b < n - 1 && y[b + 1] <= y[j]) { b++; if (y[b] < rmin) rmin = y[b]; }
      if (y[j] - Math.max(lmin, rmin) < minProm) continue;
      peaks.push(j);
    }
    var res = peaks.map(function (j, k) {
      var rt = x[j];
      if (j > 0 && j < n - 1) { var y0 = y[j - 1], y1 = y[j], y2 = y[j + 1], den = y0 - 2 * y1 + y2; if (den < 0) { var off = 0.5 * (y0 - y2) / den; rt = x[j] + off * (x[j + 1] - x[j - 1]) / 2; } }
      var lim0 = k > 0 ? peaks[k - 1] : 0, lim1 = k < peaks.length - 1 ? peaks[k + 1] : n - 1;
      var s = j; while (s > lim0 && y[s - 1] < y[s]) s--;
      var e = j; while (e < lim1 && y[e + 1] < y[e]) e++;
      var area = 0, bs = y[s], be = y[e];
      for (var t = s; t < e; t++) {
        var l0 = bs + (be - bs) * (x[t] - x[s]) / ((x[e] - x[s]) || 1), l1 = bs + (be - bs) * (x[t + 1] - x[s]) / ((x[e] - x[s]) || 1);
        area += 0.5 * ((y[t] - l0) + (y[t + 1] - l1)) * (x[t + 1] - x[t]);
      }
      return { rt: rt, height: y[j] - Math.min(bs, be), area: area, start: x[s], end: x[e], apex: x[j] };
    });
    var tot = res.reduce(function (s, p) { return s + Math.max(0, p.area); }, 0) || 1;
    res.forEach(function (p) { p.areaPct = 100 * Math.max(0, p.area) / tot; });
    return res;
  };
  // Computed peaks for comparison: PK.analysis if available, else fallback
  D.computePeaks = function (x, y) {
    var A = PK.analysis;
    if (A && typeof A.detectPeaks === 'function' && typeof A.peakMetrics === 'function') {
      try {
        var pk = A.detectPeaks(x, y, { threshold: 'auto' });
        var m = A.peakMetrics(x, y, pk, {});
        if (m && m.length) return m.map(function (q) { return { rt: q.rt, areaPct: q.areaPct, height: q.height, source: 'analysis' }; });
      } catch (e) { /* fall back */ }
    }
    return D._simplePeaks(x, y).map(function (p) { p.source = 'fallback'; return p; });
  };

  /* ======================================================================
   * Quality warnings and printed-value comparison
   * ==================================================================== */
  // JPEG 8x8 blockiness. Only small luminance steps are counted (real lines/edges are excluded), gradients are
  // binned by pixel phase (x mod 8, y mod 8), and blockiness requires the block-boundary phase to stand out against
  // the median of the other 7 phases in BOTH directions. Clean renders whose gridlines fall on multiples of 8 no
  // longer trigger it because their large edges are capped out and they do not repeat every 8 px in both axes.
  D._blockiness = function (img) {
    var w = img.width, h = img.height, d = img.data, CAP = 40;
    if (w < 32 || h < 32) return { ratio: 1, boundary: 0, interior: 0, ratioX: 1, ratioY: 1 };
    var hx = [0, 0, 0, 0, 0, 0, 0, 0], nx = [0, 0, 0, 0, 0, 0, 0, 0], hy = hx.slice(), ny = nx.slice();
    var ys = Math.max(1, Math.floor(h / 300)), xs = Math.max(1, Math.floor(w / 300));
    for (var y = 0; y < h; y += ys) for (var x = 0; x < w - 1; x++) {
      var k = (y * w + x) * 4, g = Math.abs(lum(d[k], d[k + 1], d[k + 2]) - lum(d[k + 4], d[k + 5], d[k + 6]));
      if (g > 0 && g < CAP) { hx[x & 7] += g; nx[x & 7]++; }
    }
    for (var x2 = 0; x2 < w; x2 += xs) for (var y2 = 0; y2 < h - 1; y2++) {
      var k2 = (y2 * w + x2) * 4, k3 = k2 + w * 4, g2 = Math.abs(lum(d[k2], d[k2 + 1], d[k2 + 2]) - lum(d[k3], d[k3 + 1], d[k3 + 2]));
      if (g2 > 0 && g2 < CAP) { hy[y2 & 7] += g2; ny[y2 & 7]++; }
    }
    function phaseRatio(sum, cnt) {
      var tot = 0, n = 0; for (var i = 0; i < 8; i++) { tot += sum[i]; n += cnt[i]; }
      if (n < 200) return { r: 1, b: 0, med: 0 };
      // per-phase activity = summed small gradients / number of samples in that phase (≈ equal sample counts)
      var per = sum.map(function (v) { return v / Math.max(1, n / 8); });
      var others = per.slice(0, 7).sort(function (a, b) { return a - b; }), med = others[3];
      return { r: med > 1e-9 ? per[7] / med : (per[7] > 0 ? 99 : 1), b: per[7], med: med };
    }
    var rx = phaseRatio(hx, nx), ry = phaseRatio(hy, ny);
    return { ratio: Math.min(rx.r, ry.r), ratioX: rx.r, ratioY: ry.r, boundary: (rx.b + ry.b) / 2, interior: (rx.med + ry.med) / 2 };
  };
  // meta: {plotWidthPx, plotHeightPx, calibSepPx:{x,y}, coverage (0..1), isJpeg}
  D.qualityWarnings = function (img, meta) {
    meta = meta || {}; var W = [];
    var pw = meta.plotWidthPx || img.width;
    if (pw < 600) W.push('Low resolution: plot area is only ' + Math.round(pw) + ' px wide (< 600 px). Retention-time precision is limited to about one pixel.');
    if (img.width * img.height < 150000) W.push('Very small image (' + img.width + '×' + img.height + ' px). Use a larger export or screenshot if you can.');
    var bl = D._blockiness(img);
    if ((bl.ratio > 1.5 && bl.boundary > 0.3) || (meta.isJpeg && bl.ratio > 1.25 && bl.boundary > 0.2)) W.push('JPEG compression artifacts (8×8 blockiness) detected. Colour masks may pick up noise, so tighten the tolerance or use a PNG.');
    if (meta.calibSepPx) {
      if (meta.calibSepPx.x < 150) W.push('X calibration points are only ' + Math.round(meta.calibSepPx.x) + ' px apart. Place them farther apart for accuracy.');
      if (meta.calibSepPx.y < 100) W.push('Y calibration points are only ' + Math.round(meta.calibSepPx.y) + ' px apart. Place them farther apart for accuracy.');
    }
    if (meta.coverage != null && meta.coverage < 0.85) W.push('Only ' + Math.round(meta.coverage * 100) + '% of plot columns contained the trace. Gaps were interpolated, so check the colour, tolerance and masks.');
    if (meta.bigGaps) W.push(meta.bigGaps + ' gap(s) longer than max-gap were bridged by straight lines.');
    return W;
  };
  // tol: number (RT tol) or {rt, area, dxMin}. Default RT tol = max(2·dxMin, 0.02 min); area tol 2 points.
  D.comparePrinted = function (computed, printed, tol) {
    if (typeof tol === 'number') tol = { rt: tol };
    tol = tol || {};
    var rtTol = tol.rt != null ? tol.rt : Math.max(2 * (tol.dxMin || 0), 0.02), areaTol = tol.area != null ? tol.area : 2;
    var used = {};
    return (printed || []).map(function (p) {
      var best = -1, bd = Infinity;
      (computed || []).forEach(function (c, i) { var dd = Math.abs(c.rt - p.rt); if (!used[i] && dd < bd) { bd = dd; best = i; } });
      var c = best >= 0 && bd <= Math.max(10 * rtTol, 0.5) ? computed[best] : null;
      if (c) used[best] = true;
      var dRt = c ? c.rt - p.rt : null, dArea = c && p.areaPct != null && c.areaPct != null ? c.areaPct - p.areaPct : null;
      var mismatch = !c || Math.abs(dRt) > rtTol || (dArea != null && Math.abs(dArea) > areaTol);
      return { rt: p.rt, printed: p, computed: c, dRt: dRt, dArea: dArea, mismatch: mismatch, rtTol: rtTol, areaTol: areaTol };
    });
  };

  /* ======================================================================
   * Claude vision assist
   * ==================================================================== */
  D.CLAUDE_MODELS = [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (default)' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
  ];
  function claudePrompt(w, h) {
    return [
      'You are reading a chromatogram figure (HPLC/FPLC/LC). The attached image is ' + w + ' x ' + h + ' pixels; pixel origin is the top-left corner, x grows right, y grows down.',
      'Return STRICT JSON only (no prose, no markdown fences) with exactly this shape:',
      '{"imageSize":{"w":' + w + ',"h":' + h + '},',
      ' "title": string|null,',
      ' "plotBox": {"left":px,"top":px,"right":px,"bottom":px},',
      ' "xAxis": {"label": string|null, "unit": string|null, "scale": "linear"|"log", "ticks": [{"value": number, "px": number}]},',
      ' "yAxis": {"label": string|null, "unit": string|null, "scale": "linear"|"log", "ticks": [{"value": number, "py": number}]},',
      ' "traces": [{"label": string|null, "color": "#rrggbb"}],',
      ' "peaks": [{"rt": number, "areaPct": number|null, "label": string|null, "name": string|null}]}',
      'Rules:',
      '- plotBox is the inner plotting frame (the axes rectangle), in pixels of THIS image.',
      '- ticks: list every labelled tick you can read (at least the first and the last), value as printed, and the pixel position of the tick mark itself (xAxis: x pixel "px"; yAxis: y pixel "py"), measured as precisely as possible in THIS image\'s pixel coordinates.',
      '- unit: the axis unit as printed, e.g. "min", "s", "mAU", "AU", "mS/cm", "%". Use null if not shown.',
      '- traces: one entry per distinct plotted line, with its dominant drawn colour (black lines as "#000000") and legend label if any.',
      '- peaks: ONLY values actually printed in the figure (retention-time labels, area % tables, peak names). Do not estimate values from the curve. Empty array if none are printed.',
      '- Use null for anything you cannot read. Output the JSON object and nothing else.'
    ].join('\n');
  }
  D._claudePrompt = claudePrompt;

  // Robust JSON extraction: handles ```json fences, leading/trailing prose, trailing commas, and truncated output.
  D._parseClaudeJSON = function (text) {
    if (text == null) return null;
    var t = String(text);
    var fence = /```(?:json|JSON)?\s*([\s\S]*?)(?:```|$)/.exec(t);
    if (fence && fence[1].indexOf('{') >= 0) t = fence[1];
    var st = t.indexOf('{'); if (st < 0) return null;
    t = t.slice(st);
    function tryParse(s) { try { return JSON.parse(s); } catch (e) { try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch (e2) { return undefined; } } }
    function scan(s) { // returns {end, stack, inStr}
      var stack = [], inStr = false, esc = false;
      for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{' || c === '[') stack.push(c);
        else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) return { end: i, stack: [], inStr: false }; }
      }
      return { end: -1, stack: stack, inStr: inStr };
    }
    var sc = scan(t);
    if (sc.end >= 0) { var v = tryParse(t.slice(0, sc.end + 1)); if (v !== undefined) return v; }
    // truncated / malformed: repair by closing open structures, trimming back to the last complete element
    var s = sc.end >= 0 ? t.slice(0, sc.end + 1) : t;
    for (var attempt = 0; attempt < 400 && s.length; attempt++) {
      var info = scan(s), cand = s;
      if (info.end >= 0) cand = s.slice(0, info.end + 1);
      else {
        if (info.inStr) cand += '"';
        cand = cand.replace(/\s+$/, '').replace(/,$/, '').replace(/,?\s*"[^"]*"\s*:\s*$/, '').replace(/:\s*$/, ': null');
        var st2 = scan(cand).stack;
        for (var k = st2.length - 1; k >= 0; k--) cand += st2[k] === '{' ? '}' : ']';
      }
      var v2 = tryParse(cand); if (v2 !== undefined && v2 !== null && typeof v2 === 'object') return v2;
      var cut = Math.max(s.lastIndexOf(','), s.lastIndexOf('{', s.length - 2), s.lastIndexOf('[', s.length - 2));
      if (cut <= 0) break;
      s = s.slice(0, s.charAt(cut) === ',' ? cut : cut + 1);
    }
    return null;
  };

  function numOrNull(v) { var n = typeof v === 'string' ? parseFloat(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; }
  // Normalise Claude's JSON; rescale pixel coords from the sent image (sentW×sentH) to the full image (fullW×fullH).
  D._normalizeClaude = function (obj, sentW, sentH, fullW, fullH) {
    obj = obj || {};
    var iw = obj.imageSize && numOrNull(obj.imageSize.w) || sentW, ih = obj.imageSize && numOrNull(obj.imageSize.h) || sentH;
    var kx = (fullW || iw) / (iw || 1), ky = (fullH || ih) / (ih || 1);
    function ax(a, key, k, dim) {
      a = a || {};
      var ticks = (Array.isArray(a.ticks) ? a.ticks : []).map(function (t) {
        var v = numOrNull(t.value), p = numOrNull(t[key] != null ? t[key] : (t.px != null ? t.px : t.py));
        if (v == null || p == null) return null;
        var r = { value: v, approxPxFrac: p / (dim || 1) }; r[key] = p * k; return r;
      }).filter(Boolean);
      return { label: a.label || null, unit: a.unit || null, scale: /log/i.test(a.scale || '') ? 'log' : 'linear', ticks: ticks };
    }
    var pb = obj.plotBox || obj.plotFrame || null, plotBox = null;
    if (pb && [pb.left, pb.top, pb.right, pb.bottom].every(function (v) { return numOrNull(v) != null; }))
      plotBox = { left: pb.left * kx, top: pb.top * ky, right: pb.right * kx, bottom: pb.bottom * ky };
    return {
      title: obj.title || null, plotBox: plotBox,
      xAxis: ax(obj.xAxis, 'px', kx, iw), yAxis: ax(obj.yAxis, 'py', ky, ih),
      traces: (Array.isArray(obj.traces) ? obj.traces : []).map(function (t) { return { label: t && t.label || null, color: t && hexToRgb(t.color) ? rgbToHex(hexToRgb(t.color)) : null }; }),
      peaks: (Array.isArray(obj.peaks) ? obj.peaks : []).map(function (p) { var rt = numOrNull(p && p.rt); return rt == null ? null : { rt: rt, areaPct: numOrNull(p.areaPct), label: p.label || p.name || null }; }).filter(Boolean),
      sentSize: { w: iw, h: ih }, scale: { x: kx, y: ky }
    };
  };

  function downscaleDataURL(dataURL, maxEdge) {
    return new Promise(function (res, rej) {
      if (!HAS_DOM()) { res({ dataURL: dataURL, w: 0, h: 0, fullW: 0, fullH: 0 }); return; }
      var im = new Image();
      im.onload = function () {
        var W = im.naturalWidth, H = im.naturalHeight, k = Math.min(1, maxEdge / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.imageSmoothingQuality = 'high'; cx.drawImage(im, 0, 0, w, h);
        res({ dataURL: cv.toDataURL('image/jpeg', 0.9), w: w, h: h, fullW: W, fullH: H });
      };
      im.onerror = function () { rej(new Error('Could not decode image for Claude')); };
      im.src = dataURL;
    });
  }
  // Returns Promise<normalised result> (pixel coords are in the ORIGINAL dataURL image's pixels).
  D.askClaude = function (apiKey, dataURL, model, opts) {
    opts = opts || {};
    if (!apiKey) return Promise.reject(new Error('No API key entered.'));
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) return Promise.reject(new Error('fetch() is not available in this environment.'));
    return downscaleDataURL(dataURL, 1568).then(function (img) {
      var m = /^data:([^;]+);base64,(.*)$/.exec(img.dataURL);
      if (!m) throw new Error('Image must be a base64 data URL');
      var w = img.w || opts.sentW || 0, h = img.h || opts.sentH || 0;
      var body = {
        model: model || 'claude-sonnet-5-5', max_tokens: 2000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: claudePrompt(w, h) }] }]
      };
      return fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(function (err) {
        throw new Error('Network/CORS error: the browser could not reach api.anthropic.com (' + (err && err.message || err) + '). Check your connection, ad-blockers, or a corporate proxy. If you opened Peakly from file:// in a restrictive browser, try another browser.');
      }).then(function (res) {
        return res.text().then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) { /* ignore */ }
          if (!res.ok) {
            var msg = j && j.error && j.error.message || txt.slice(0, 300) || res.statusText;
            var hint = res.status === 401 ? 'Invalid or revoked API key (401).' : res.status === 403 ? 'Permission denied (403). The key may not have access to this model.' :
              res.status === 429 ? 'Rate limited (429). Wait a moment and try again.' : (res.status === 529 || res.status === 503) ? 'Anthropic API is overloaded (' + res.status + '). Try again shortly.' :
                res.status === 404 ? 'Model not found (404). Pick another model.' : res.status === 400 ? 'Bad request (400).' : 'API error ' + res.status + '.';
            var e = new Error(hint + ' ' + msg); e.status = res.status; throw e;
          }
          var text = (j && j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('\n');
          var parsed = D._parseClaudeJSON(text);
          if (!parsed) { var e2 = new Error('Could not parse JSON from Claude response.'); e2.raw = text; throw e2; }
          var out = D._normalizeClaude(parsed, w, h, img.fullW || w, img.fullH || h);
          out.raw = text; out.model = body.model;
          return out;
        });
      });
    });
  };

  /* ======================================================================
   * Sample figure: a scene of primitives rendered either by a tiny pure rasterizer (Node/tests)
   * or the Canvas 2D API (browser, adds text).
   * ==================================================================== */
  function biGauss(x, p) { var s = x < p.rt ? p.sl : p.sr, z = (x - p.rt) / s; return p.h * Math.exp(-0.5 * z * z); }
  D.makeSampleImage = function (opts) {
    opts = opts || {};
    var mono = !!opts.mono, W = opts.width || 900, H = opts.height || 560;
    var plot = { x0: 80, y0: 60, x1: W - 40, y1: H - 80 };
    var xMin = 0, xMax = 20, yMin = -10, yMax = 290;
    function px(x) { return plot.x0 + (x - xMin) / (xMax - xMin) * (plot.x1 - plot.x0); }
    function py(y) { return plot.y1 - (y - yMin) / (yMax - yMin) * (plot.y1 - plot.y0); }
    var bluePeaks = [
      { rt: 2.85, h: 55, sl: 0.07, sr: 0.12 }, { rt: 5.62, h: 185, sl: 0.09, sr: 0.16 }, { rt: 6.55, h: 92, sl: 0.09, sr: 0.15 },
      { rt: 10.41, h: 228, sl: 0.11, sr: 0.20 }, { rt: 14.18, h: 48, sl: 0.13, sr: 0.22 }];
    var orScale = [0.45, 0.22, 0.75, 0.32, 0.95];
    var specs = [{ name: 'Sample 254 nm', rgb: mono ? [0, 0, 0] : [37, 99, 235], base: function (x) { return 6 + 0.3 * x; }, peaks: bluePeaks }];
    if (!mono) specs.push({ name: 'Sample 280 nm', rgb: [234, 88, 12], base: function (x) { return 22 + 0.15 * x; }, peaks: bluePeaks.map(function (p, i) { return { rt: p.rt, h: p.h * orScale[i], sl: p.sl, sr: p.sr }; }) });
    var N = 4001, xs = PK.util.linspace(xMin, xMax, N);
    var traces = specs.map(function (s) {
      return { name: s.name, rgb: s.rgb, hex: rgbToHex(s.rgb), x: xs.slice(), y: xs.map(function (x) { var v = s.base(x); s.peaks.forEach(function (p) { v += biGauss(x, p); }); return v; }) };
    });
    // "printed" values as an instrument would report them: integrate the true curve (valley/drop baseline)
    var integ = D._simplePeaks(traces[0].x, traces[0].y);
    var printedPeaks = bluePeaks.map(function (p) {
      var m = integ.reduce(function (b, q) { return Math.abs(q.rt - p.rt) < Math.abs(b.rt - p.rt) ? q : b; }, { rt: Infinity, areaPct: null });
      return { rt: p.rt, areaPct: m.areaPct == null ? null : Math.round(10 * m.areaPct) / 10, label: p.rt.toFixed(2) };
    });
    // scene
    var sc = [], gridC = mono ? [110, 110, 110] : [222, 222, 222];
    for (var gx = 2; gx < xMax; gx += 2) sc.push({ t: 'line', pts: [[px(gx), plot.y0], [px(gx), plot.y1]], w: 1, c: gridC });
    for (var gy = 50; gy < yMax; gy += 50) sc.push({ t: 'line', pts: [[plot.x0, py(gy)], [plot.x1, py(gy)]], w: 1, c: gridC });
    sc.push({ t: 'line', pts: [[plot.x0, py(0)], [plot.x1, py(0)]], w: 1, c: gridC });
    sc.push({ t: 'line', pts: [[plot.x0, plot.y0], [plot.x1, plot.y0], [plot.x1, plot.y1]], w: 1, c: [160, 160, 160] });
    sc.push({ t: 'line', pts: [[plot.x0, plot.y0], [plot.x0, plot.y1], [plot.x1, plot.y1]], w: 2, c: [0, 0, 0] });
    var tickLabels = [];
    for (var tx = 0; tx <= xMax; tx += 2) { sc.push({ t: 'line', pts: [[px(tx), plot.y1], [px(tx), plot.y1 + 7]], w: 1.5, c: [0, 0, 0] }); tickLabels.push({ t: 'text', s: String(tx), x: px(tx), y: plot.y1 + 22, align: 'center' }); }
    for (var ty = 0; ty <= 250; ty += 50) { sc.push({ t: 'line', pts: [[plot.x0 - 7, py(ty)], [plot.x0, py(ty)]], w: 1.5, c: [0, 0, 0] }); tickLabels.push({ t: 'text', s: String(ty), x: plot.x0 - 11, y: py(ty) + 4, align: 'right' }); }
    // traces (draw secondary first so the primary is on top)
    for (var ti = traces.length - 1; ti >= 0; ti--) sc.push({ t: 'line', pts: traces[ti].x.map(function (x, i) { return [px(x), py(traces[ti].y[i])]; }), w: 2, c: traces[ti].rgb });
    // legend
    var legend = { x: plot.x1 - 190, y: plot.y0 + 12, w: 175, h: 16 + 20 * traces.length };
    sc.push({ t: 'rect', x: legend.x, y: legend.y, w: legend.w, h: legend.h, fill: [255, 255, 255], stroke: [150, 150, 150] });
    traces.forEach(function (tr, i) {
      var ly = legend.y + 18 + 20 * i;
      sc.push({ t: 'line', pts: [[legend.x + 10, ly], [legend.x + 40, ly]], w: 2, c: tr.rgb });
      sc.push({ t: 'text', s: tr.name, x: legend.x + 48, y: ly + 4, align: 'left' });
    });
    printedPeaks.forEach(function (p) {
      var ymax = -Infinity; traces[0].x.forEach(function (x, i) { if (Math.abs(x - p.rt) < 0.05 && traces[0].y[i] > ymax) ymax = traces[0].y[i]; });
      sc.push({ t: 'text', s: p.label, x: px(p.rt), y: py(ymax) - 8, align: 'center', size: 11 });
    });
    sc = sc.concat(tickLabels);
    sc.push({ t: 'text', s: 'Peakly sample — reversed-phase C18, 5–95% B in 20 min', x: (plot.x0 + plot.x1) / 2, y: 32, align: 'center', size: 15, bold: true });
    sc.push({ t: 'text', s: 'Time (min)', x: (plot.x0 + plot.x1) / 2, y: H - 30, align: 'center', size: 13 });
    sc.push({ t: 'text', s: 'Absorbance (mAU)', x: 22, y: (plot.y0 + plot.y1) / 2, align: 'center', size: 13, rot: -Math.PI / 2 });
    var axes = {
      plot: { x: plot.x0, y: plot.y0, w: plot.x1 - plot.x0, h: plot.y1 - plot.y0 },
      x1: { px: px(2), val: 2 }, x2: { px: px(18), val: 18 }, y1: { px: py(0), val: 0 }, y2: { px: py(250), val: 250 },
      xLog: false, yLog: false, xUnit: 'min', yUnit: 'mAU'
    };
    var out = { width: W, height: H, truth: { x: traces[0].x, y: traces[0].y, traces: traces }, printedPeaks: printedPeaks, axes: axes, legend: legend, title: 'Peakly sample', scene: sc };
    var wantCanvas = opts.canvas !== false && HAS_DOM();
    if (wantCanvas) { out.canvas = renderSceneCanvas(sc, W, H); out.image = out.canvas.getContext('2d').getImageData(0, 0, W, H); }
    else out.image = renderSceneRaster(sc, W, H);
    return out;
  };
  function renderSceneRaster(sc, W, H) {
    var img = makeImage(W, H), d = img.data, dist = new Float32Array(W * H);
    function drawPolyline(pts, width, c) {
      var r = width / 2; dist.fill(1e9);
      var minX = W, minY = H, maxX = -1, maxY = -1;
      for (var i = 0; i < pts.length - 1; i++) {
        var ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
        var x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r + 1));
        var y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r + 1));
        if (x0 < minX) minX = x0; if (y0 < minY) minY = y0; if (x1 > maxX) maxX = x1; if (y1 > maxY) maxY = y1;
        var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
          var t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          var ex = ax + t * dx - x, ey = ay + t * dy - y, dd = Math.sqrt(ex * ex + ey * ey), id = y * W + x;
          if (dd < dist[id]) dist[id] = dd;
        }
      }
      for (var yy = minY; yy <= maxY; yy++) for (var xx = minX; xx <= maxX; xx++) {
        var a = r + 0.5 - dist[yy * W + xx]; if (a <= 0) continue; if (a > 1) a = 1;
        var k = (yy * W + xx) * 4; d[k] += (c[0] - d[k]) * a; d[k + 1] += (c[1] - d[k + 1]) * a; d[k + 2] += (c[2] - d[k + 2]) * a;
      }
    }
    sc.forEach(function (p) {
      if (p.t === 'line') drawPolyline(p.pts, p.w, p.c);
      else if (p.t === 'rect') {
        if (p.fill) for (var y = Math.round(p.y); y < Math.round(p.y + p.h); y++) for (var x = Math.round(p.x); x < Math.round(p.x + p.w); x++) { var k = (y * W + x) * 4; d[k] = p.fill[0]; d[k + 1] = p.fill[1]; d[k + 2] = p.fill[2]; }
        if (p.stroke) drawPolyline([[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h], [p.x, p.y]], 1, p.stroke);
      }
      // text is skipped by the pure rasterizer
    });
    return img;
  }
  function renderSceneCanvas(sc, W, H) {
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    function col(a) { return 'rgb(' + a.join(',') + ')'; }
    // the pure rasterizer treats pixel i's centre as coordinate i; canvas centres are at i+0.5
    c.translate(0.5, 0.5);
    sc.forEach(function (p) {
      if (p.t === 'line') { c.strokeStyle = col(p.c); c.lineWidth = p.w; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); p.pts.forEach(function (q, i) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.stroke(); }
      else if (p.t === 'rect') { if (p.fill) { c.fillStyle = col(p.fill); c.fillRect(p.x, p.y, p.w, p.h); } if (p.stroke) { c.strokeStyle = col(p.stroke); c.lineWidth = 1; c.strokeRect(p.x, p.y, p.w, p.h); } }
      else if (p.t === 'text') {
        c.save(); c.fillStyle = '#111'; c.font = (p.bold ? '600 ' : '') + (p.size || 12) + 'px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        c.textAlign = p.align || 'left'; c.translate(p.x, p.y); if (p.rot) c.rotate(p.rot); c.fillText(p.s, 0, 0); c.restore();
      }
    });
    return cv;
  }
  D.sampleImageDataURL = function () { if (!HAS_DOM()) return null; return D.makeSampleImage().canvas.toDataURL('image/png'); };

  /* ======================================================================
   * ============================  UI  ====================================
   * ==================================================================== */
  var apiKey = ''; // module-scoped only; never persisted
  var S = null;    // UI state while open
  var STEPS = [['prep', 'Prep'], ['calibrate', 'Calibrate'], ['extract', 'Extract'], ['verify', 'Verify'], ['send', 'Send']];
  var MARKERS = ['x1', 'x2', 'y1', 'y2'];

  var CSS = [
    '.pkd{display:flex;flex-direction:column;height:100%;flex:1;min-height:0;background:var(--bg);color:var(--text);font-size:13px}',
    '.pkd *{box-sizing:border-box}',
    '.pkd-head{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel);flex-wrap:wrap}',
    '.pkd-title{font-weight:600;font-size:15px;display:flex;align-items:center;gap:6px;white-space:nowrap}',
    '.pkd .badge.digitized{font-size:10px;padding:2px 6px;border-radius:999px;background:var(--digitized-bg,var(--warn));color:var(--digitized,#000);border:1px solid var(--digitized,var(--warn));font-weight:600;text-transform:uppercase;letter-spacing:.04em}',
    '.pkd-steps{display:flex;gap:4px;list-style:none;margin:0;padding:0;flex:1;flex-wrap:wrap}',
    '.pkd-steps li{padding:4px 10px;border-radius:999px;border:1px solid var(--border);color:var(--muted);cursor:pointer;white-space:nowrap;user-select:none}',
    '.pkd-steps li.on{background:var(--accent);border-color:var(--accent);color:#fff}',
    '.pkd-steps li.done{color:var(--text)}',
    '.pkd-steps li.locked{opacity:.45;cursor:not-allowed}',
    '.pkd-main{flex:1;display:flex;min-height:0}',
    '.pkd-stagewrap{position:relative;flex:1;min-width:0;background:var(--panel-2);overflow:hidden;touch-action:none}',
    '.pkd-stage{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}',
    '.pkd-loupe{position:absolute;width:150px;height:150px;border:2px solid var(--accent);border-radius:50%;pointer-events:none;display:none;box-shadow:0 4px 16px rgba(0,0,0,.35);background:#fff}',
    '.pkd-zoom{position:absolute;right:8px;bottom:8px;display:flex;gap:4px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:3px}',
    '.pkd-zoom .btn.on{background:var(--accent);color:#fff;border-color:var(--accent)}',
    '.pkd-hint{position:absolute;left:8px;bottom:8px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:4px 8px;color:var(--muted);max-width:70%;pointer-events:none;font-size:12px}',
    '.pkd-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px}',
    '.pkd-dropcard{border:2px dashed var(--border);border-radius:calc(var(--radius) * 2);padding:28px;max-width:520px;text-align:center;background:var(--panel)}',
    '.pkd-dropcard h3{margin:0 0 6px}',
    '.pkd-dropcard .row{justify-content:center;margin-top:12px}',
    '.pkd-dragover .pkd-stagewrap{outline:3px dashed var(--accent);outline-offset:-6px}',
    '.pkd-side{width:340px;max-width:42vw;border-left:1px solid var(--border);background:var(--panel);overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}',
    '.pkd-sec{border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;background:var(--panel-2)}',
    '.pkd-sec>h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}',
    '.pkd .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}',
    '.pkd label{display:flex;gap:6px;align-items:center}',
    '.pkd input[type=number],.pkd input[type=text],.pkd input[type=password],.pkd select,.pkd textarea{background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:calc(var(--radius) * .6);padding:4px 6px;font:inherit;min-width:0}',
    '.pkd input[type=number]{width:84px}',
    '.pkd input[type=range]{flex:1;min-width:100px}',
    '.pkd textarea{width:100%;min-height:70px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}',
    '.pkd .btn.on{background:var(--accent);color:#fff;border-color:var(--accent)}',
    '.pkd .muted{color:var(--muted)}',
    '.pkd .small{font-size:11px}',
    '.pkd .warn{color:var(--warn)}',
    '.pkd .err{color:var(--error)}',
    '.pkd .okc{color:var(--ok)}',
    '.pkd-sw{display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid var(--border);vertical-align:middle;cursor:pointer;flex:none}',
    '.pkd-mk{display:grid;grid-template-columns:52px 1fr 70px;gap:6px;align-items:center;margin:3px 0}',
    '.pkd-mk input{width:100%}',
    '.pkd-suggest{border:2px solid var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent);border-radius:var(--radius);padding:8px}',
    '.pkd-notice{border-left:3px solid var(--warn);padding:4px 8px;font-size:12px;background:color-mix(in srgb,var(--warn) 10%,transparent)}',
    '.pkd-tr{display:grid;grid-template-columns:22px 1fr 82px 24px;gap:5px;align-items:center;padding:3px;border-radius:6px;margin:2px 0}',
    '.pkd-tr.on{background:color-mix(in srgb,var(--accent) 18%,transparent)}',
    '.pkd-tr input{width:100%}',
    '.pkd-ops{margin:4px 0;padding-left:18px}',
    '.pkd-ops li{margin:2px 0}',
    '.pkd table{border-collapse:collapse;width:100%;font-size:12px}',
    '.pkd th,.pkd td{border-bottom:1px solid var(--border);padding:3px 4px;text-align:right}',
    '.pkd th:first-child,.pkd td:first-child{text-align:left}',
    '.pkd tr.mm td{color:var(--error);font-weight:600}',
    '.pkd-foot{display:flex;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid var(--border);background:var(--panel)}',
    '.pkd-foot .status{flex:1;color:var(--muted);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.pkd-mini{height:190px;margin-top:6px}',
    '.pkd-cands{display:flex;gap:6px;flex-wrap:wrap}',
    '.pkd-cands button{display:flex;align-items:center;gap:4px}',
    '@media (max-width:760px){.pkd-main{flex-direction:column}.pkd-stagewrap{flex:none;height:52vh}.pkd-side{width:auto;max-width:none;border-left:0;border-top:1px solid var(--border);flex:1}.pkd-steps li{padding:3px 7px}}'
  ].join('\n');

  function $(sel, root) { return (root || (S && S.root) || document).querySelector(sel); }
  function esc(s) { return PK.util.escapeHtml(s); }
  function fmt(v, d) { return PK.util.fmt(v, d); }
  function toast(m, k) { if (PK.toast) PK.toast(m, k); }

  function toCanvas(img) {
    var cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    var cx = cv.getContext('2d');
    var id = (typeof ImageData !== 'undefined' && img instanceof ImageData) ? img : new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height);
    cx.putImageData(id, 0, 0); return cv;
  }
  function canvasToImage(cv) { return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); }

  function newState() {
    return {
      root: null, step: 'prep', srcImg: null, srcName: '', srcDataURL: '', isJpeg: false, pdf: null,
      ops: [], adjust: { brightness: 0, contrast: 0, threshold: 0, gray: false }, pendingRot: 0,
      geomImg: null, geomCanvas: null, prepImg: null, prepCanvas: null,
      view: { s: 1, tx: 0, ty: 0 }, tool: 'pan', cropRect: null, persp: null,
      cal: { x1: { px: null, py: null, val: '' }, x2: { px: null, py: null, val: '' }, y1: { px: null, py: null, val: '' }, y2: { px: null, py: null, val: '' },
        xLog: false, yLog: false, xUnit: 'min', yUnit: 'mAU', suggested: false, confirmed: false },
      activeMarker: null, plotRect: null,
      ai: { model: 'claude-sonnet-5-5', busy: false, error: '', result: null },
      traces: [], active: 0, excludes: [], removeGrid: false, minRunFrac: 0.5, restrict: true, maxGap: 15, nPoints: 0, showMask: true,
      colorCands: [], overlayOn: true, overlayOpacity: 0.9, title: '', printedText: '', printedFor: 0, loupe: null,
      listeners: [], drag: null, ptrs: {}, space: false, rafPending: false, extractTimer: 0
    };
  }

  /* ---------------- open / close ---------------- */
  D.open = function (arg) {
    if (!HAS_DOM()) return Promise.resolve();
    arg = arg || {};
    PK.injectCSS('pk-digitizer-css', CSS);
    if (S) teardown(false);
    S = newState();
    var root = document.getElementById('digitizer-root');
    if (!root) { root = document.createElement('div'); root.id = 'digitizer-root'; root.setAttribute('data-pkd-own', '1'); root.style.cssText = 'position:fixed;inset:0;z-index:1000;background:var(--bg,#fff)'; document.body.appendChild(root); }
    S.root = root;
    buildShell();
    if (PK.bus) PK.bus.emit('digitizer:open', {});
    var p;
    if (arg.file) p = loadFile(arg.file);
    else if (arg.blob) p = loadFile(arg.blob);
    else if (arg.dataURL) p = loadDataURL(arg.dataURL, arg.name || 'image');
    else p = Promise.resolve();
    return p.catch(function (e) { toast('Could not load image: ' + e.message, 'error'); });
  };
  function teardown(emit) {
    if (!S) return;
    S.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    if (S.ro) S.ro.disconnect();
    clearTimeout(S.extractTimer);
    var root = S.root;
    if (root) { root.innerHTML = ''; if (root.getAttribute('data-pkd-own')) root.remove(); }
    S = null;
    if (emit && PK.bus) PK.bus.emit('digitizer:close', {});
  }
  D.close = function () { teardown(true); };
  D._state = function () { return S; };

  function listen(target, ev, fn, opt) { target.addEventListener(ev, fn, opt); S.listeners.push([target, ev, fn, opt]); }

  function buildShell() {
    var r = S.root;
    r.innerHTML = '<div class="pk-modal-body pkd" tabindex="-1">' +
      '<header class="pkd-head"><div class="pkd-title">Image digitizer <span class="badge digitized">digitized</span></div>' +
      '<ol class="pkd-steps"></ol>' +
      '<button class="btn ghost sm" data-act="close" title="Close digitizer">Close</button></header>' +
      '<div class="pkd-main"><div class="pkd-stagewrap"><canvas class="pkd-stage"></canvas><canvas class="pkd-loupe" width="150" height="150"></canvas>' +
      '<div class="pkd-hint" style="display:none"></div>' +
      '<div class="pkd-zoom"><button class="btn sm" data-act="zoomout" title="Zoom out">−</button><button class="btn sm" data-act="fit" title="Fit to view">Fit</button><button class="btn sm" data-act="zoomin" title="Zoom in">+</button><button class="btn sm" data-act="pantool" title="Pan tool (or hold Space / middle mouse / two fingers)">✋</button></div>' +
      '<div class="pkd-empty"></div></div>' +
      '<aside class="pkd-side"></aside></div>' +
      '<footer class="pkd-foot"><button class="btn" data-act="back">Back</button><div class="status"></div><button class="btn primary" data-act="next">Next</button></footer>' +
      '<input type="file" class="pkd-file" accept="image/*,application/pdf" hidden>' +
      '<input type="file" class="pkd-cam" accept="image/*" capture="environment" hidden></div>';
    S.el = { body: $('.pkd'), stage: $('.pkd-stage'), wrap: $('.pkd-stagewrap'), loupe: $('.pkd-loupe'), side: $('.pkd-side'), empty: $('.pkd-empty'), steps: $('.pkd-steps'), status: $('.pkd-foot .status'), hint: $('.pkd-hint') };
    var body = S.el.body;
    listen(body, 'click', onClick);
    listen(body, 'input', onInput);
    listen(body, 'change', onChange);
    [$('.pkd-file'), $('.pkd-cam')].forEach(function (inp) { listen(inp, 'change', function () { if (inp.files && inp.files[0]) loadFile(inp.files[0]).catch(function (e) { toast(e.message, 'error'); }); inp.value = ''; }); });
    // drag & drop
    listen(body, 'dragover', function (e) { e.preventDefault(); body.classList.add('pkd-dragover'); });
    listen(body, 'dragleave', function (e) { if (e.target === body || !body.contains(e.relatedTarget)) body.classList.remove('pkd-dragover'); });
    listen(body, 'drop', function (e) { e.preventDefault(); body.classList.remove('pkd-dragover'); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f).catch(function (er) { toast(er.message, 'error'); }); });
    listen(document, 'paste', onPaste);
    listen(window, 'keydown', onKey);
    listen(window, 'keyup', function (e) { if (e.code === 'Space') { S.space = false; updateCursor(); } });
    // stage pointer events
    var st = S.el.stage;
    listen(st, 'pointerdown', onPtrDown);
    listen(st, 'pointermove', onPtrMove);
    listen(st, 'pointerup', onPtrUp);
    listen(st, 'pointercancel', onPtrUp);
    listen(st, 'pointerleave', function () { if (!S.drag && S.loupe) { S.loupe = null; drawLoupe(); } });
    listen(st, 'wheel', onWheel, { passive: false });
    listen(st, 'contextmenu', function (e) { e.preventDefault(); });
    listen(st, 'auxclick', function (e) { e.preventDefault(); });
    if (typeof ResizeObserver !== 'undefined') { S.ro = new ResizeObserver(function () { resizeStage(); }); S.ro.observe(S.el.wrap); }
    else listen(window, 'resize', resizeStage);
    resizeStage();
    renderAll();
  }

  /* ---------------- loading ---------------- */
  function loadFile(file) {
    var name = file.name || 'image';
    var isPdf = /pdf$/i.test(file.type || '') || /\.pdf$/i.test(name);
    if (isPdf) return PK.util.readFileAs(file, 'arraybuffer').then(function (buf) { return loadPdf(buf, name); });
    return PK.util.readFileAs(file, 'dataurl').then(function (url) { return loadDataURL(url, name); });
  }
  function loadDataURL(url, name) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var W = im.naturalWidth, H = im.naturalHeight, maxE = 3200, k = Math.min(1, maxE / Math.max(W, H));
        var cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
        if (k < 1) toast('Large image downscaled to ' + cv.width + '×' + cv.height + ' px for processing.', 'info');
        setSource(cv, name, url, /^data:image\/jpe?g/i.test(url) || /\.jpe?g$/i.test(name));
        if (!S.pdf || S.pdf.name !== name) S.pdf = null;
        res();
      };
      im.onerror = function () { rej(new Error('Unsupported or corrupt image (' + name + '). Try PNG/JPEG, or a PDF.')); };
      im.src = url;
    });
  }
  function loadPdf(buf, name) {
    if (typeof pdfjsLib === 'undefined') return Promise.reject(new Error('PDF support (pdf.js) is not loaded. Export the figure as PNG/JPEG instead.'));
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch (e) { /* ignore */ }
    return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise.then(function (doc) {
      S.pdf = { doc: doc, page: 1, pages: doc.numPages, name: name };
      return renderPdfPage(1);
    });
  }
  function renderPdfPage(n) {
    var pdf = S.pdf;
    return pdf.doc.getPage(n).then(function (page) {
      var vp0 = page.getViewport({ scale: 1 }), scale = Math.min(4, 2400 / Math.max(vp0.width, vp0.height)), vp = page.getViewport({ scale: scale });
      var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
        pdf.page = n;
        setSource(cv, pdf.name + ' (page ' + n + ')', null, false);
      });
    });
  }
  function setSource(cv, name, dataURL, isJpeg) {
    S.srcImg = canvasToImage(cv); S.srcName = name; S.srcDataURL = dataURL || cv.toDataURL('image/png'); S.isJpeg = !!isJpeg;
    S.ops = []; S.pendingRot = 0; S.cropRect = null; S.persp = null; S.tool = 'pan';
    S.adjust = { brightness: 0, contrast: 0, threshold: 0, gray: false };
    var keepAi = S.ai; var model = keepAi.model;
    var fresh = newState(); ['cal', 'plotRect', 'traces', 'excludes', 'colorCands', 'printedText', 'title'].forEach(function (k) { S[k] = fresh[k]; });
    S.ai = { model: model, busy: false, error: '', result: null };
    S.active = 0; S.step = 'prep';
    recomputeGeom(); fitView(); renderAll();
  }
  function onPaste(e) {
    if (!S) return;
    var t = e.target; if (t && /input|textarea/i.test(t.tagName) && t.type !== 'file') return;
    var items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (var i = 0; i < items.length; i++) if (/^image\//.test(items[i].type)) {
      var f = items[i].getAsFile(); if (f) { e.preventDefault(); loadFile(f).then(function () { toast('Image pasted from clipboard.', 'ok'); }, function (er) { toast(er.message, 'error'); }); return; }
    }
  }
  function loadSample() {
    var s = D.makeSampleImage();
    var url = s.canvas.toDataURL('image/png');
    return loadDataURL(url, 'peakly-sample.png').then(function () {
      var a = s.axes;
      S.cal.x1 = { px: a.x1.px, py: a.plot.y + a.plot.h, val: String(a.x1.val) }; S.cal.x2 = { px: a.x2.px, py: a.plot.y + a.plot.h, val: String(a.x2.val) };
      S.cal.y1 = { px: a.plot.x, py: a.y1.px, val: String(a.y1.val) }; S.cal.y2 = { px: a.plot.x, py: a.y2.px, val: String(a.y2.val) };
      S.cal.suggested = true; S.cal.confirmed = false; S.cal.yUnit = 'mAU';
      S.plotRect = { x: a.plot.x, y: a.plot.y, w: a.plot.w, h: a.plot.h };
      S.excludes = [{ x: s.legend.x - 2, y: s.legend.y - 2, w: s.legend.w + 4, h: s.legend.h + 4 }];
      S.printedText = s.printedPeaks.map(function (p) { return p.rt + ', ' + p.areaPct + ', ' + p.label; }).join('\n');
      S.title = 'Peakly sample';
      S.sampleColors = s.truth.traces.map(function (t) { return { name: t.name, hex: t.hex }; });
      toast('Sample loaded. Calibration markers are pre-filled from the known axes; confirm them in step 2.', 'info');
      renderAll();
    });
  }

  /* ---------------- image pipeline (prep) ---------------- */
  function recomputeGeom() {
    if (!S.srcImg) return;
    try { S.geomImg = D.applyOps(S.srcImg, S.ops); }
    catch (e) { toast('Prep operation failed: ' + e.message, 'error'); S.ops.pop(); S.geomImg = D.applyOps(S.srcImg, S.ops); }
    S.geomCanvas = toCanvas(S.geomImg);
    recomputeAdjust();
  }
  function recomputeAdjust() {
    var a = S.adjust;
    S.prepImg = (a.brightness || a.contrast || a.threshold || a.gray) ? D.adjustImage(S.geomImg, a) : S.geomImg;
    S.prepCanvas = S.prepImg === S.geomImg ? S.geomCanvas : toCanvas(S.prepImg);
    S.traces.forEach(function (t) { t.result = null; });
    if (S.step === 'extract' || S.step === 'verify' || S.step === 'send') scheduleExtract();
    requestDraw();
  }
  function pushOp(op) {
    var hadCal = MARKERS.some(function (k) { return S.cal[k].px != null; });
    S.ops.push(op); S.cropRect = null; S.persp = null; S.pendingRot = 0;
    recomputeGeom();
    if (hadCal || S.plotRect || S.excludes.length) {
      MARKERS.forEach(function (k) { S.cal[k].px = null; S.cal[k].py = null; }); S.cal.confirmed = false; S.cal.suggested = false; S.plotRect = null; S.excludes = [];
      toast('Image geometry changed: calibration markers, plot area and exclusions were cleared.', 'warn');
    }
    fitView(); renderAll();
  }
  function opLabel(op) {
    if (op.type === 'rotate') return 'Rotate ' + fmt(op.deg, 3) + '°';
    if (op.type === 'rot90') return 'Rotate 90° ' + (op.k > 0 ? 'clockwise' : 'counter-clockwise');
    if (op.type === 'crop') return 'Crop ' + Math.round(op.rect.w) + '×' + Math.round(op.rect.h);
    if (op.type === 'perspective') return 'Perspective → ' + op.w + '×' + op.h;
    return op.type;
  }

  /* ---------------- calibration helpers ---------------- */
  function calObj() {
    var c = S.cal;
    for (var i = 0; i < 4; i++) { var m = c[MARKERS[i]]; if (m.px == null) return { error: 'Place marker ' + MARKERS[i].toUpperCase() }; if (String(m.val).trim() === '' || !isFinite(parseFloat(m.val))) return { error: 'Enter a value for ' + MARKERS[i].toUpperCase() }; }
    try {
      return { cal: D.calibrate({ x1: { px: c.x1.px, val: parseFloat(c.x1.val) }, x2: { px: c.x2.px, val: parseFloat(c.x2.val) },
        y1: { px: c.y1.py, val: parseFloat(c.y1.val) }, y2: { px: c.y2.py, val: parseFloat(c.y2.val) }, xLog: c.xLog, yLog: c.yLog }) };
    } catch (e) { return { error: e.message }; }
  }
  function xScale() { return S.cal.xUnit === 'sec' ? 1 / 60 : 1; }
  function uncertainty(cal, tr) {
    var dx = 0.5 * cal.dxPerPx * xScale(), dy = 0.5 * cal.dyPerPx;
    if (tr && tr.result && tr.result.pts.length) {
      if (S.cal.xLog) dx = 0.5 * PK.util.median(tr.result.pts.map(function (p) { return cal.dxAt(p[0]); })) * xScale();
      if (S.cal.yLog) dy = 0.5 * PK.util.median(tr.result.pts.map(function (p) { return cal.dyAt(p[1]); }));
    }
    return { dxMin: dx, dy: dy };
  }
  function applyClaude(r) {
    var c = S.cal, img = S.prepImg, pb = r.plotBox;
    var bottom = pb ? pb.bottom : img.height * 0.85, left = pb ? pb.left : img.width * 0.12;
    function pick(ticks, key) {
      if (ticks.length < 2) return null;
      var s = ticks.slice().sort(function (a, b) { return a[key] - b[key]; }), a = s[0], b = s[s.length - 1];
      return Math.abs(b[key] - a[key]) < 5 || a.value === b.value ? null : [a, b];
    }
    var xt = pick(r.xAxis.ticks, 'px'), yt = pick(r.yAxis.ticks, 'py'), got = [];
    if (xt) { c.x1 = { px: xt[0].px, py: bottom, val: String(xt[0].value) }; c.x2 = { px: xt[1].px, py: bottom, val: String(xt[1].value) }; got.push('X ticks'); }
    if (yt) { c.y1 = { px: left, py: yt[1].py, val: String(yt[1].value) }; c.y2 = { px: left, py: yt[0].py, val: String(yt[0].value) }; got.push('Y ticks'); }
    c.xLog = r.xAxis.scale === 'log'; c.yLog = r.yAxis.scale === 'log';
    if (r.xAxis.unit) c.xUnit = /^s(ec(onds?)?)?$/i.test(String(r.xAxis.unit).trim()) ? 'sec' : 'min';
    if (r.yAxis.unit) c.yUnit = String(r.yAxis.unit);
    if (pb) { S.plotRect = normRect({ x: pb.left, y: pb.top, w: pb.right - pb.left, h: pb.bottom - pb.top }, img.width, img.height); got.push('plot frame'); }
    if (r.title) S.title = r.title;
    if (r.peaks.length) { S.printedText = r.peaks.map(function (p) { return p.rt + ', ' + (p.areaPct == null ? '' : p.areaPct) + ', ' + (p.label || ''); }).join('\n'); got.push(r.peaks.length + ' printed peaks'); }
    var cols = r.traces.filter(function (t) { return t.color; });
    if (cols.length) got.push(cols.length + ' trace colour(s)');
    c.suggested = true; c.confirmed = false;
    return got;
  }

  /* ---------------- extraction ---------------- */
  function addTrace(hex, name, mode) {
    var i = S.traces.length;
    S.traces.push({ id: PK.uid('dg'), name: name || ('Trace ' + (i + 1)), hex: hex || PK.palette[i % PK.palette.length], mode: mode || 'color', tol: mode === 'dark' ? 110 : 80, extract: 'centroid', result: null });
    S.active = S.traces.length - 1;
  }
  function scheduleExtract() { clearTimeout(S.extractTimer); S.extractTimer = setTimeout(runExtraction, 60); }
  function runExtraction() {
    if (!S || !S.prepImg) return;
    var co = calObj(); if (!co.cal) return;
    var img = S.prepImg;
    S.traces.forEach(function (t, i) {
      try {
        t.result = D.runPipeline(img, co.cal, {
          rgb: hexToRgb(t.hex), mode: t.mode, tol: t.tol, include: S.restrict && S.plotRect ? S.plotRect : null, exclude: S.excludes,
          removeGrid: S.removeGrid, minRunFrac: S.minRunFrac, extract: t.extract, maxGap: S.maxGap, nPoints: S.nPoints || 0, xScale: xScale()
        });
      } catch (e) { t.result = null; t.error = e.message; }
      if (i === S.active) buildMaskCanvas(t);
    });
    requestDraw(); refreshStats();
  }
  function buildMaskCanvas(t) {
    S.maskCanvas = null;
    if (!t || !t.result) return;
    var img = S.prepImg, w = img.width, h = img.height, m = t.result.mask, id = new ImageData(w, h), d = id.data;
    for (var i = 0; i < m.length; i++) if (m[i]) { var k = i * 4; d[k] = 0; d[k + 1] = 255; d[k + 2] = 90; d[k + 3] = 170; }
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(id, 0, 0); S.maskCanvas = cv;
  }
  function plotWidthPx() { var co = calObj(); return S.plotRect ? S.plotRect.w : (co.cal ? co.cal.sepPx.x * 1.15 : S.prepImg.width); }
  function traceWarnings(t) {
    var co = calObj(); if (!co.cal) return [];
    return D.qualityWarnings(S.geomImg, { plotWidthPx: plotWidthPx(), plotHeightPx: S.plotRect ? S.plotRect.h : null, calibSepPx: co.cal.sepPx, coverage: t.result ? t.result.coverage : null, bigGaps: t.result ? t.result.bigGaps : 0, isJpeg: S.isJpeg });
  }

  /* ---------------- step navigation ---------------- */
  function stepIndex(s) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i][0] === s) return i; return 0; }
  function canLeave(step) { // returns '' if ok else reason
    if (!S.srcImg) return 'Load an image first';
    if (step === 'prep') return '';
    if (step === 'calibrate') { var co = calObj(); if (!co.cal) return co.error; if (S.cal.suggested && !S.cal.confirmed) return 'Suggested calibration: click "Confirm calibration" first'; return ''; }
    if (step === 'extract') { if (!S.traces.length) return 'Add a trace'; if (!S.traces.some(function (t) { return t.result && t.result.x.length >= 10; })) return 'No trace extracted yet (pick a colour)'; return ''; }
    return '';
  }
  function goStep(target) {
    var cur = stepIndex(S.step), ti = stepIndex(target);
    if (ti > cur) for (var i = cur; i < ti; i++) { var why = canLeave(STEPS[i][0]); if (why) { toast(why, 'warn'); S.step = STEPS[i][0]; renderAll(); return; } }
    if (S.step === 'prep' && S.pendingRot) pushOp({ type: 'rotate', deg: S.pendingRot });
    S.step = target; S.tool = 'pan'; S.loupe = null;
    if (target === 'calibrate') { // ready to place the first unplaced marker straight away
      var firstFree = MARKERS.filter(function (k) { return S.cal[k].px == null; })[0];
      if (firstFree) { S.tool = 'place:' + firstFree; S.activeMarker = firstFree; }
    }
    if (target === 'extract' && !S.traces.length) {
      var sug = S.ai.result && S.ai.result.traces.filter(function (t) { return t.color; });
      if (sug && sug.length) sug.forEach(function (t, i) { var rgb = hexToRgb(t.color), dark = rgb && Math.max.apply(null, rgb) < 70; addTrace(t.color, t.label || ('Trace ' + (i + 1)), dark ? 'dark' : 'color'); });
      else if (S.sampleColors) S.sampleColors.forEach(function (t) { addTrace(t.hex, t.name); });
      else addTrace(null, 'Trace 1');
      S.active = 0;
    }
    if (target === 'extract' || target === 'verify' || target === 'send') runExtraction();
    renderAll();
  }

  /* ---------------- rendering ---------------- */
  function renderAll() { if (!S) return; renderSteps(); renderEmpty(); renderSide(); renderFoot(); updateCursor(); requestDraw(); }
  function renderSteps() {
    var cur = stepIndex(S.step);
    S.el.steps.innerHTML = STEPS.map(function (s, i) {
      return '<li data-act="step" data-step="' + s[0] + '" class="' + (i === cur ? 'on' : i < cur ? 'done' : '') + (!S.srcImg && i > 0 ? ' locked' : '') + '">' + (i + 1) + ' ' + s[1] + '</li>';
    }).join('');
  }
  function renderEmpty() {
    var e = S.el.empty;
    if (S.srcImg) { e.style.display = 'none'; e.innerHTML = ''; return; }
    e.style.display = '';
    e.innerHTML = '<div class="pkd-dropcard"><h3>Digitize a chromatogram image</h3>' +
      '<p class="muted">Drop an image or PDF here, paste a screenshot (Ctrl/⌘+V), take a photo, or try the sample.<br>Data you extract is marked <span class="badge digitized">digitized</span> and carries its pixel-resolution uncertainty.</p>' +
      '<div class="row"><button class="btn primary" data-act="pick">Choose image / PDF…</button><button class="btn" data-act="camera">Take photo</button><button class="btn ghost" data-act="sample">Load sample image</button></div></div>';
  }
  function renderFoot() {
    var why = S.step === 'send' ? '' : canLeave(S.step);
    var b = $('[data-act=back]'), n = $('[data-act=next]');
    b.disabled = stepIndex(S.step) === 0;
    n.style.display = S.step === 'send' ? 'none' : '';
    n.disabled = !!why; n.title = why || '';
    S.el.status.textContent = why ? why : (S.srcName ? S.srcName + ' — ' + S.prepImg.width + '×' + S.prepImg.height + ' px' : '');
  }
  function sec(title, html) { return '<div class="pkd-sec"><h4>' + title + '</h4>' + html + '</div>'; }
  function btn(act, label, extra) { extra = extra || {}; return '<button class="btn sm' + (extra.on ? ' on' : '') + (extra.primary ? ' primary' : '') + '" data-act="' + act + '"' + (extra.data ? ' ' + extra.data : '') + (extra.title ? ' title="' + esc(extra.title) + '"' : '') + (extra.disabled ? ' disabled' : '') + '>' + label + '</button>'; }
  function slider(bind, min, max, step, val, label, out) {
    return '<label class="row"><span style="min-width:74px">' + label + '</span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" data-bind="' + bind + '"><span data-out="' + bind + '" style="min-width:38px;text-align:right">' + (out != null ? out : val) + '</span></label>';
  }
  function renderSide() {
    var h = '';
    if (S.step === 'prep') h = sidePrep();
    else if (S.step === 'calibrate') h = sideCal();
    else if (S.step === 'extract') h = sideExtract();
    else if (S.step === 'verify') h = sideVerify();
    else h = sideSend();
    // Re-rendering replaces the inputs; keep focus (and caret) on the field the user just moved to.
    var ae = document.activeElement, keep = null;
    if (ae && S.el.side.contains(ae) && ae.getAttribute('data-bind')) {
      keep = { bind: ae.getAttribute('data-bind'), s: null, e: null };
      try { keep.s = ae.selectionStart; keep.e = ae.selectionEnd; } catch (er) { /* non-text input */ }
    }
    S.el.side.innerHTML = h;
    if (keep) {
      var nf = S.el.side.querySelector('[data-bind="' + keep.bind + '"]');
      if (nf) { nf.focus(); try { if (keep.s != null) nf.setSelectionRange(keep.s, keep.e); } catch (er) { /* ignore */ } }
    }
    if (S.step === 'verify') drawMiniPlot();
  }
  function sidePrep() {
    var h = sec('Input', '<div class="row">' + btn('pick', 'Open image / PDF…') + btn('camera', 'Camera') + btn('sample', 'Sample') + '</div>' +
      (S.pdf ? '<label class="row">PDF page <select data-bind="pdfpage">' + Array.apply(null, Array(S.pdf.pages)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === S.pdf.page ? ' selected' : '') + '>' + (i + 1) + ' / ' + S.pdf.pages + '</option>'; }).join('') + '</select></label>' : '') +
      '<div class="muted small">Tip: paste a screenshot with Ctrl/⌘+V, or drop a file onto this window.</div>');
    if (!S.srcImg) return h;
    h += sec('Geometry', '<div class="row">' + btn('tool', 'Crop', { on: S.tool === 'crop', data: 'data-tool="crop"', title: 'Drag a rectangle on the image' }) +
      btn('tool', 'Perspective', { on: S.tool === 'persp', data: 'data-tool="persp"', title: 'Drag the 4 corner handles onto the plot frame corners' }) + '</div>' +
      (S.tool === 'crop' ? '<div class="row">' + btn('applycrop', 'Apply crop', { primary: true, disabled: !S.cropRect }) + btn('cancelTool', 'Cancel') + '<span class="muted small">Drag on the image</span></div>' : '') +
      (S.tool === 'persp' ? '<div class="row">' + btn('applypersp', 'Apply perspective', { primary: true }) + btn('cancelTool', 'Cancel') + '</div><div class="muted small">Drag TL/TR/BR/BL onto the plot frame corners. The quadrilateral is warped into a rectangle.</div>' : '') +
      slider('pendingRot', -45, 45, 0.1, S.pendingRot, 'Rotate', fmt(S.pendingRot, 3) + '°') +
      '<div class="row">' + btn('rot90', '⟲ 90°', { data: 'data-k="-1"' }) + btn('rot90', '⟳ 90°', { data: 'data-k="1"' }) + btn('deskew', 'Auto-deskew', { title: 'Estimate tilt from long dark lines (axes, grid)' }) + btn('applyrot', 'Apply rotation', { disabled: !S.pendingRot }) + '</div>');
    var a = S.adjust;
    h += sec('Adjust (live)', slider('adjust.brightness', -100, 100, 1, a.brightness, 'Brightness') + slider('adjust.contrast', -100, 100, 1, a.contrast, 'Contrast') +
      slider('adjust.threshold', 0, 254, 1, a.threshold, 'Threshold', a.threshold ? a.threshold : 'off') +
      '<label class="row"><input type="checkbox" data-bind="adjust.gray"' + (a.gray ? ' checked' : '') + '> Grayscale</label>' +
      '<div class="muted small">Threshold/grayscale remove colour, so use them only for black-trace (dark mode) extraction.</div>' + btn('resetAdjust', 'Reset adjustments'));
    h += sec('Operation stack', S.ops.length ? '<ol class="pkd-ops">' + S.ops.map(function (o, i) { return '<li>' + esc(opLabel(o)) + ' <button class="btn ghost sm" data-act="rmop" data-i="' + i + '" title="Remove">×</button></li>'; }).join('') + '</ol>' + '<div class="row">' + btn('undoop', 'Undo last') + btn('resetops', 'Reset all') + '</div>'
      : '<div class="muted small">No geometric operations. Ops are re-applied in order to the original image.</div>');
    return h;
  }
  function sideCal() {
    var c = S.cal, co = calObj();
    var mk = MARKERS.map(function (k) {
      var m = c[k], placed = m.px != null;
      return '<div class="pkd-mk">' + btn('place', (placed ? '✓ ' : '') + k.toUpperCase(), { on: S.tool === 'place:' + k || S.activeMarker === k, data: 'data-m="' + k + '"', title: placed ? 'Click to re-place (or drag its handle)' : 'Click, then tap the image' }) +
        '<input type="text" inputmode="decimal" placeholder="value" data-bind="cal.' + k + '.val" value="' + esc(m.val) + '">' +
        '<span class="small muted">' + (placed ? (k[0] === 'x' ? 'x=' + fmt(m.px, 5) : 'y=' + fmt(m.py, 5)) : 'not placed') + '</span></div>';
    }).join('');
    var h = '';
    if (c.suggested && !c.confirmed) h += '<div class="pkd-suggest"><b>Suggested — please confirm.</b><div class="small">Markers and values were pre-filled' + (S.ai.result ? ' by Claude' : '') + '. Zoom in, drag the handles onto the exact tick marks, check the values, then confirm.</div><div class="row">' + btn('confirmcal', 'Confirm calibration', { primary: true, disabled: !co.cal }) + '</div></div>';
    else if (c.suggested && c.confirmed) h += '<div class="pkd-notice okc">Calibration confirmed.</div>';
    h += sec('Axis calibration', '<div class="muted small">Place two known points on each axis (tick marks far apart). Drag handles to adjust, use arrow keys to nudge the selected marker by 1 px (Shift: 10 px). The loupe magnifies while dragging.</div>' + mk +
      '<div class="row"><label>X scale <select data-bind="cal.xLog"><option value="0"' + (!c.xLog ? ' selected' : '') + '>linear</option><option value="1"' + (c.xLog ? ' selected' : '') + '>log</option></select></label>' +
      '<label>unit <select data-bind="cal.xUnit"><option value="min"' + (c.xUnit === 'min' ? ' selected' : '') + '>min</option><option value="sec"' + (c.xUnit === 'sec' ? ' selected' : '') + '>sec</option></select></label></div>' +
      '<div class="row"><label>Y scale <select data-bind="cal.yLog"><option value="0"' + (!c.yLog ? ' selected' : '') + '>linear</option><option value="1"' + (c.yLog ? ' selected' : '') + '>log</option></select></label>' +
      '<label>unit <input type="text" style="width:80px" data-bind="cal.yUnit" value="' + esc(c.yUnit) + '"></label></div>' +
      (co.cal ? '<div class="small okc">Resolution: ±' + fmt(0.5 * co.cal.dxPerPx * xScale(), 3) + ' min/px · ±' + fmt(0.5 * co.cal.dyPerPx, 3) + ' ' + esc(c.yUnit) + '/px</div>' : '<div class="small warn">' + esc(co.error) + '</div>'));
    h += sec('Plot frame (optional)', '<div class="row">' + btn('tool', S.plotRect ? 'Redraw plot area' : 'Draw plot area', { on: S.tool === 'plot', data: 'data-tool="plot"' }) + (S.plotRect ? btn('clearplot', 'Clear') : '') + '</div><div class="muted small">Restricts extraction to inside the axes (critical for black-trace plots).</div>');
    var ai = S.ai;
    h += '<details class="pkd-sec"' + (ai.result || apiKey ? ' open' : '') + '><summary><b>AI assist (optional)</b></summary>' +
      '<div class="pkd-notice">When you click the button, the image is sent to <b>Anthropic</b> (api.anthropic.com) using your own API key. The key stays in memory for this session only and is never saved. Results only pre-fill fields; you must confirm them.</div>' +
      '<div class="row"><input type="password" autocomplete="off" placeholder="sk-ant-… API key" data-bind="apikey" value="' + esc(apiKey) + '" style="flex:1">' + btn('clearkey', 'Clear') + '</div>' +
      '<label class="row">Model <select data-bind="ai.model">' + D.CLAUDE_MODELS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === ai.model ? ' selected' : '') + '>' + esc(m.label) + '</option>'; }).join('') + '</select></label>' +
      '<div class="row">' + btn('askclaude', ai.busy ? 'Reading…' : 'Read axes with Claude', { primary: true, disabled: ai.busy || !apiKey }) + '</div>' +
      (ai.error ? '<div class="err small">' + esc(ai.error) + '</div>' : '') +
      (ai.result ? '<div class="small">' + claudeSummary(ai.result) + '</div>' : '') + '</details>';
    return h;
  }
  function claudeSummary(r) {
    var parts = [];
    if (r.title) parts.push('<b>Title:</b> ' + esc(r.title));
    parts.push('<b>X:</b> ' + esc(r.xAxis.label || '?') + ' [' + esc(r.xAxis.unit || '?') + '], ' + r.xAxis.ticks.length + ' ticks');
    parts.push('<b>Y:</b> ' + esc(r.yAxis.label || '?') + ' [' + esc(r.yAxis.unit || '?') + '], ' + r.yAxis.ticks.length + ' ticks');
    if (r.traces.length) parts.push('<b>Traces:</b> ' + r.traces.map(function (t) { return (t.color ? '<span class="pkd-sw" style="background:' + t.color + '"></span> ' : '') + esc(t.label || ''); }).join(', '));
    if (r.peaks.length) parts.push('<b>Printed peaks:</b> ' + r.peaks.length);
    return '<div class="pkd-suggest" style="margin-top:6px">Suggested by ' + esc(r.model || 'Claude') + ':<br>' + parts.join('<br>') + '</div>';
  }
  function sideExtract() {
    var t = S.traces[S.active], h = '';
    h += sec('Traces', S.traces.map(function (tr, i) {
      return '<div class="pkd-tr' + (i === S.active ? ' on' : '') + '"><span class="pkd-sw" data-act="selTrace" data-i="' + i + '" style="background:' + (tr.mode === 'dark' ? '#000' : tr.hex) + '" title="Select"></span>' +
        '<input type="text" data-bind="traces.' + i + '.name" value="' + esc(tr.name) + '">' +
        '<select data-bind="traces.' + i + '.mode"><option value="color"' + (tr.mode === 'color' ? ' selected' : '') + '>colour</option><option value="dark"' + (tr.mode === 'dark' ? ' selected' : '') + '>dark on white</option></select>' +
        '<button class="btn ghost sm" data-act="rmTrace" data-i="' + i + '" title="Remove">×</button></div>';
    }).join('') + '<div class="row">' + btn('addTrace', '+ Add trace') + btn('autocolors', 'Auto-detect trace colours') + '</div>' +
      (S.colorCands.length ? '<div class="pkd-cands">' + S.colorCands.map(function (c, i) { return '<button class="btn sm" data-act="useCand" data-i="' + i + '" title="Use for selected trace (Shift: add new trace)"><span class="pkd-sw" style="background:' + c.hex + '"></span>' + Math.round(c.frac * 100) + '%</button>'; }).join('') + '<span class="muted small">click = set selected trace, shift-click = new trace</span></div>' : ''));
    if (t) {
      h += sec('Selected: ' + esc(t.name), (t.mode === 'color' ?
        '<div class="row">' + btn('tool', '⌖ Eyedropper', { on: S.tool === 'eyedrop', data: 'data-tool="eyedrop"', title: 'Click the trace on the image' }) +
        '<span class="pkd-sw" style="background:' + t.hex + '"></span><input type="text" style="width:84px" data-bind="trace.hex" value="' + esc(t.hex) + '"></div>' +
        slider('trace.tol', 5, 200, 1, t.tol, 'Tolerance') :
        slider('trace.tol', 20, 220, 1, t.tol, 'Darkness ≤') + '<div class="muted small">Dark mode keeps near-black, low-chroma pixels. Remove gridlines/axes and restrict to the plot area below.</div>') +
        '<label class="row">Per column <select data-bind="trace.extract"><option value="centroid"' + (t.extract === 'centroid' ? ' selected' : '') + '>centroid (line centre)</option><option value="top"' + (t.extract === 'top' ? ' selected' : '') + '>topmost pixel</option></select></label>' +
        '<label class="row"><input type="checkbox" data-bind="showMask"' + (S.showMask ? ' checked' : '') + '> Show mask preview (green)</label>');
    }
    h += sec('Masking', '<div class="row">' + btn('tool', '▭ Exclude rectangle', { on: S.tool === 'exclude', data: 'data-tool="exclude"', title: 'Drag over legends/text to ignore them' }) + (S.excludes.length ? btn('clearEx', 'Clear ' + S.excludes.length) : '') + '</div>' +
      '<label class="row"><input type="checkbox" data-bind="removeGrid"' + (S.removeGrid ? ' checked' : '') + '> Auto-remove gridlines / axes</label>' +
      (S.removeGrid ? slider('minRunFrac', 0.2, 0.95, 0.05, S.minRunFrac, 'Min run', Math.round(S.minRunFrac * 100) + '%') : '') +
      '<label class="row"><input type="checkbox" data-bind="restrict"' + (S.restrict ? ' checked' : '') + '> Restrict to plot area</label>' +
      '<div class="row">' + btn('tool', S.plotRect ? 'Redraw plot area' : 'Draw plot area', { on: S.tool === 'plot', data: 'data-tool="plot"' }) + (S.restrict && !S.plotRect ? '<span class="warn small">no plot area set</span>' : '') + '</div>');
    h += sec('Sampling', '<label class="row">Max gap (px) <input type="number" min="0" max="500" data-bind="maxGap" value="' + S.maxGap + '"></label>' +
      '<label class="row">Resample to N points <input type="number" min="0" max="20000" data-bind="nPoints" value="' + (S.nPoints || 0) + '"><span class="muted small">0 = one per pixel column</span></label>');
    h += '<div class="pkd-sec" data-stats>' + statsHtml() + '</div>';
    return h;
  }
  function statsHtml() {
    return '<h4>Result</h4>' + (S.traces.map(function (t) {
      var r = t.result; if (!r) return '<div class="small">' + esc(t.name) + ': ' + (t.error ? '<span class="err">' + esc(t.error) + '</span>' : '—') + '</div>';
      return '<div class="small"><span class="pkd-sw" style="background:' + (t.mode === 'dark' ? '#000' : t.hex) + ';width:10px;height:10px"></span> ' + esc(t.name) + ': ' + r.x.length + ' pts, coverage <b class="' + (r.coverage < 0.85 ? 'warn' : 'okc') + '">' + Math.round(r.coverage * 100) + '%</b>' + (r.bigGaps ? ', <span class="warn">' + r.bigGaps + ' long gap(s) bridged</span>' : '') + '</div>';
    }).join('') || '<div class="muted small">No traces</div>');
  }
  function refreshStats() { var el = S && S.el.side.querySelector('[data-stats]'); if (el) el.innerHTML = statsHtml(); if (S && S.step === 'verify') { renderSide(); } renderFoot(); }
  function sideVerify() {
    var co = calObj(), h = '';
    h += sec('Overlay', '<label class="row"><input type="checkbox" data-bind="overlayOn"' + (S.overlayOn ? ' checked' : '') + '> Show extracted traces over the image</label>' + slider('overlayOpacity', 0, 1, 0.05, S.overlayOpacity, 'Opacity', Math.round(S.overlayOpacity * 100) + '%') +
      '<div class="muted small">Toggle the overlay to compare against the source. Mismatches mean you should go back and adjust the colour, tolerance, masks or calibration.</div>');
    h += sec('Digitized traces: uncertainty', co.cal ? S.traces.map(function (t) {
      var u = uncertainty(co.cal, t), r = t.result;
      return '<div style="margin:4px 0"><b><span class="pkd-sw" style="background:' + (t.mode === 'dark' ? '#000' : t.hex) + ';width:10px;height:10px"></span> ' + esc(t.name) + '</b> <span class="badge digitized">digitized</span><br><span class="small">±' + fmt(u.dxMin, 3) + ' min/px · ±' + fmt(u.dy, 3) + ' ' + esc(S.cal.yUnit) + '/px · ' + (r ? r.x.length + ' points · coverage ' + Math.round(r.coverage * 100) + '%' : 'not extracted') + '</span></div>';
    }).join('') : '<div class="err small">' + esc(co.error) + '</div>');
    var warns = {};
    S.traces.forEach(function (t) { traceWarnings(t).forEach(function (w) { warns[w] = (warns[w] || []).concat(t.name); }); });
    var wk = Object.keys(warns);
    h += sec('Quality warnings', wk.length ? '<ul style="margin:0;padding-left:18px">' + wk.map(function (w) { return '<li class="warn small">' + esc(w) + (S.traces.length > 1 && warns[w].length < S.traces.length ? ' <span class="muted">(' + esc(warns[w].join(', ')) + ')</span>' : '') + '</li>'; }).join('') + '</ul>' : '<div class="okc small">No warnings.</div>');
    h += sec('Data preview (' + esc(S.cal.yUnit) + ' vs min)', '<div class="pkd-mini" id="pkd-mini"></div>');
    return h;
  }
  function drawMiniPlot() {
    var el = document.getElementById('pkd-mini'); if (!el) return;
    var data = S.traces.filter(function (t) { return t.result; }).map(function (t) { return { x: t.result.x, y: t.result.y, name: t.name + ' (digitized)', mode: 'lines', line: { color: t.mode === 'dark' ? '#444' : t.hex, width: 1.5 } }; });
    if (typeof Plotly !== 'undefined') {
      var cs = getComputedStyle(S.el.body);
      try { Plotly.react(el, data, { margin: { l: 40, r: 8, t: 6, b: 30 }, showlegend: false, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: cs.getPropertyValue('--text') || '#333' }, xaxis: { title: { text: 'min' } } }, { displayModeBar: false, responsive: true }); } catch (e) { /* ignore */ }
    } else {
      // tiny canvas fallback
      var cv = document.createElement('canvas'); cv.width = el.clientWidth || 300; cv.height = 190; el.innerHTML = ''; el.appendChild(cv);
      var c = cv.getContext('2d'), all = data.reduce(function (a, d) { return { x: a.x.concat(d.x), y: a.y.concat(d.y) }; }, { x: [], y: [] });
      if (!all.x.length) return;
      var x0 = Math.min.apply(null, all.x), x1 = Math.max.apply(null, all.x), y0 = Math.min.apply(null, all.y), y1 = Math.max.apply(null, all.y);
      data.forEach(function (d) { c.strokeStyle = d.line.color; c.beginPath(); d.x.forEach(function (x, i) { var X = 4 + (x - x0) / (x1 - x0 || 1) * (cv.width - 8), Y = cv.height - 4 - (d.y[i] - y0) / (y1 - y0 || 1) * (cv.height - 8); if (i) c.lineTo(X, Y); else c.moveTo(X, Y); }); c.stroke(); });
    }
  }
  function parsePrinted(text) {
    return String(text || '').split(/\n+/).map(function (l) {
      var p = l.split(/[,;\t]/).map(function (s) { return s.trim(); }); var rt = parseFloat(p[0]);
      if (!isFinite(rt)) return null; var a = parseFloat(p[1]);
      return { rt: rt, areaPct: isFinite(a) ? a : undefined, label: p.slice(2).join(', ') || undefined };
    }).filter(Boolean);
  }
  function comparisonFor() {
    var t = S.traces[S.printedFor]; var co = calObj();
    if (!t || !t.result || !co.cal) return null;
    var printed = parsePrinted(S.printedText); if (!printed.length) return null;
    var comp = D.computePeaks(t.result.x, t.result.y), u = uncertainty(co.cal, t);
    return { rows: D.comparePrinted(comp, printed, { dxMin: u.dxMin }), source: comp.length ? comp[0].source : '', nComputed: comp.length };
  }
  function sideSend() {
    var h = '';
    h += sec('Name & units', '<label class="row">Title <input type="text" style="flex:1" data-bind="title" value="' + esc(S.title) + '"></label>' +
      '<label class="row">Y unit <input type="text" style="width:90px" data-bind="cal.yUnit" value="' + esc(S.cal.yUnit) + '"></label>' +
      S.traces.map(function (t, i) { return '<label class="row"><span class="pkd-sw" style="background:' + (t.mode === 'dark' ? '#000' : t.hex) + '"></span><input type="text" style="flex:1" data-bind="traces.' + i + '.name" value="' + esc(t.name) + '"><span class="badge digitized">digitized</span></label>'; }).join(''));
    h += sec('Printed peak labels', '<div class="muted small">One per line: <code>RT, area%, label</code>. Pre-filled by Claude when available, otherwise type the values printed on the figure.</div>' +
      '<textarea data-bind="printedText" placeholder="5.62, 31.4, Caffeine">' + esc(S.printedText) + '</textarea>' +
      '<label class="row">Labels belong to <select data-bind="printedFor">' + S.traces.map(function (t, i) { return '<option value="' + i + '"' + (i === S.printedFor ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
      '<div data-cmp>' + cmpHtml() + '</div>');
    h += '<div class="row">' + btn('send', 'Send ' + S.traces.filter(function (t) { return t.result; }).length + ' digitized trace(s) to plot', { primary: true }) + '</div>';
    return h;
  }
  function cmpHtml() {
    var c = comparisonFor();
    if (!c) return '<div class="muted small">No printed values to compare.</div>';
    var nm = c.rows.filter(function (r) { return r.mismatch; }).length;
    return '<div class="small" style="margin:4px 0">Computed with ' + (c.source === 'analysis' ? 'Peakly peak analysis' : 'built-in simple peak finder') + ' on the digitized data. Mismatch when |ΔRT| &gt; ' + fmt(c.rows[0].rtTol, 3) + ' min or |Δarea%| &gt; ' + c.rows[0].areaTol + ' points.</div>' +
      '<table><thead><tr><th>Label</th><th>RT printed</th><th>RT computed</th><th>ΔRT</th><th>Area% pr.</th><th>Area% comp.</th><th></th></tr></thead><tbody>' +
      c.rows.map(function (r) {
        return '<tr class="' + (r.mismatch ? 'mm' : '') + '"><td>' + esc(r.printed.label || '') + '</td><td>' + fmt(r.printed.rt, 4) + '</td><td>' + (r.computed ? fmt(r.computed.rt, 4) : '—') + '</td><td>' + (r.dRt == null ? '—' : fmt(r.dRt, 2)) + '</td><td>' + fmt(r.printed.areaPct, 3) + '</td><td>' + (r.computed ? fmt(r.computed.areaPct, 3) : '—') + '</td><td>' + (r.mismatch ? '⚠' : '✓') + '</td></tr>';
      }).join('') + '</tbody></table>' + (nm ? '<div class="err small">' + nm + ' mismatch(es). Check calibration, or integration differences (baseline/peak bounds).</div>' : '<div class="okc small">All printed peaks agree within tolerance.</div>');
  }

  function send() {
    var co = calObj(); if (!co.cal) { toast(co.error, 'error'); return; }
    var ready = S.traces.filter(function (t) { return t.result && t.result.x.length >= 2; });
    if (!ready.length) { toast('Nothing to send.', 'warn'); return; }
    var imgURL;
    try { var big = S.geomCanvas.width * S.geomCanvas.height > 1.6e6; imgURL = S.geomCanvas.toDataURL(big ? 'image/jpeg' : 'image/png', 0.92); } catch (e) { imgURL = S.srcDataURL; }
    var imageId = PK.app && typeof PK.app.addImage === 'function' ? PK.app.addImage(imgURL) : PK.uid('img');
    var printed = parsePrinted(S.printedText);
    var traces = ready.map(function (t, i) {
      var u = uncertainty(co.cal, t), name = /digitized/i.test(t.name) ? t.name : t.name + ' (digitized)';
      return {
        name: name, x: Array.from(t.result.x), y: Array.from(t.result.y), xUnit: 'min', yUnit: S.cal.yUnit || 'a.u.',
        source: { kind: 'image', filename: S.srcName, format: 'digitized image' },
        digitized: { dxMin: u.dxMin, dy: u.dy, imageId: imageId, printedPeaks: S.traces.indexOf(t) === S.printedFor ? printed : [], warnings: traceWarnings(t) },
        meta: { title: S.title || undefined, digitizedFrom: S.srcName,
          digitize: { calibration: { x1: S.cal.x1, x2: S.cal.x2, y1: S.cal.y1, y2: S.cal.y2, xLog: S.cal.xLog, yLog: S.cal.yLog, xUnit: S.cal.xUnit },
            prepOps: S.ops, adjust: S.adjust, mode: t.mode, color: t.hex, tolerance: t.tol, extract: t.extract, plotRect: S.plotRect, excludes: S.excludes,
            removeGrid: S.removeGrid, maxGap: S.maxGap, coverage: t.result.coverage, aiAssisted: !!S.ai.result } },
        style: { color: t.mode === 'dark' ? PK.palette[i % PK.palette.length] : t.hex, visible: true, width: 1.5 }
      };
    });
    if (PK.app && typeof PK.app.addTraces === 'function') {
      PK.app.addTraces(traces, { select: true });
      toast(traces.length + ' digitized trace(s) added.', 'ok');
      D.close();
    } else { toast('App not available: traces logged to console.', 'warn'); console.log('[digitizer] traces', traces); }
    if (PK.bus) PK.bus.emit('digitizer:sent', { traces: traces, imageId: imageId });
  }

  /* ---------------- events: clicks / inputs ---------------- */
  function onClick(e) {
    var el = e.target.closest('[data-act]'); if (!el || !S.root.contains(el) || el.disabled) return;
    var act = el.getAttribute('data-act');
    switch (act) {
      case 'close': D.close(); return;
      case 'pick': $('.pkd-file').click(); return;
      case 'camera': $('.pkd-cam').click(); return;
      case 'sample': loadSample().catch(function (er) { toast(er.message, 'error'); }); return;
      case 'step': if (S.srcImg) goStep(el.getAttribute('data-step')); return;
      case 'next': goStep(STEPS[Math.min(STEPS.length - 1, stepIndex(S.step) + 1)][0]); return;
      case 'back': goStep(STEPS[Math.max(0, stepIndex(S.step) - 1)][0]); return;
      case 'zoomin': zoomAt(1.25); return;
      case 'zoomout': zoomAt(0.8); return;
      case 'fit': fitView(); requestDraw(); return;
      case 'pantool': S.tool = 'pan'; renderAll(); return;
      case 'tool': {
        var tool = el.getAttribute('data-tool'); S.tool = S.tool === tool ? 'pan' : tool;
        if (S.tool === 'persp' && !S.persp) { var w = S.geomImg.width, h = S.geomImg.height; S.persp = [[w * 0.1, h * 0.1], [w * 0.9, h * 0.1], [w * 0.9, h * 0.9], [w * 0.1, h * 0.9]]; }
        renderAll(); return;
      }
      case 'cancelTool': S.tool = 'pan'; S.cropRect = null; S.persp = null; renderAll(); return;
      case 'applycrop': if (S.cropRect && S.cropRect.w > 4 && S.cropRect.h > 4) pushOp({ type: 'crop', rect: normRect(S.cropRect, S.geomImg.width, S.geomImg.height) }); S.tool = 'pan'; renderAll(); return;
      case 'applypersp': { var sz = D.perspectiveSize(S.persp); pushOp({ type: 'perspective', pts: S.persp.map(function (p) { return p.slice(); }), w: sz.w, h: sz.h }); S.tool = 'pan'; renderAll(); return; }
      case 'rot90': if (S.pendingRot) pushOp({ type: 'rotate', deg: S.pendingRot }); pushOp({ type: 'rot90', k: +el.getAttribute('data-k') }); return;
      case 'applyrot': if (S.pendingRot) pushOp({ type: 'rotate', deg: S.pendingRot }); return;
      case 'deskew': {
        var ang = D.estimateSkew(S.geomImg);
        if (Math.abs(ang) < 0.05) { toast('Image already looks straight (skew < 0.05°).', 'ok'); return; }
        pushOp({ type: 'rotate', deg: -ang }); toast('Deskewed by ' + fmt(-ang, 3) + '°.', 'ok'); return;
      }
      case 'rmop': S.ops.splice(+el.getAttribute('data-i'), 1); recomputeGeom(); fitView(); renderAll(); return;
      case 'undoop': S.ops.pop(); recomputeGeom(); fitView(); renderAll(); return;
      case 'resetops': S.ops = []; recomputeGeom(); fitView(); renderAll(); return;
      case 'resetAdjust': S.adjust = { brightness: 0, contrast: 0, threshold: 0, gray: false }; recomputeAdjust(); renderAll(); return;
      case 'place': { var m = el.getAttribute('data-m'); S.tool = 'place:' + m; S.activeMarker = m; renderAll(); return; }
      case 'confirmcal': { var co = calObj(); if (!co.cal) { toast(co.error, 'warn'); return; } S.cal.confirmed = true; toast('Calibration confirmed.', 'ok'); renderAll(); return; }
      case 'clearplot': S.plotRect = null; renderAll(); return;
      case 'clearkey': apiKey = ''; renderAll(); return;
      case 'askclaude': askClaudeUI(); return;
      case 'addTrace': addTrace(); S.tool = 'eyedrop'; renderAll(); scheduleExtract(); return;
      case 'rmTrace': S.traces.splice(+el.getAttribute('data-i'), 1); S.active = Math.max(0, Math.min(S.active, S.traces.length - 1)); S.printedFor = Math.min(S.printedFor, Math.max(0, S.traces.length - 1)); buildMaskCanvas(S.traces[S.active]); renderAll(); return;
      case 'selTrace': S.active = +el.getAttribute('data-i'); buildMaskCanvas(S.traces[S.active]); renderAll(); return;
      case 'autocolors': {
        S.colorCands = D.detectColors(S.prepImg, { include: S.plotRect || null });
        if (!S.colorCands.length) toast('No saturated trace colours found. For black traces use "dark on white" mode.', 'warn');
        renderAll(); return;
      }
      case 'useCand': {
        var cand = S.colorCands[+el.getAttribute('data-i')];
        if (e.shiftKey || !S.traces.length) addTrace(cand.hex, 'Trace ' + (S.traces.length + 1)); else { S.traces[S.active].hex = cand.hex; S.traces[S.active].mode = 'color'; }
        renderAll(); scheduleExtract(); return;
      }
      case 'clearEx': S.excludes = []; renderAll(); scheduleExtract(); return;
      case 'send': send(); return;
    }
  }
  function setBind(path, el) {
    var v = el.type === 'checkbox' ? el.checked : el.value;
    if (path === 'apikey') { apiKey = String(v).trim(); var b = $('[data-act=askclaude]'); if (b) b.disabled = !apiKey || S.ai.busy; return; }
    if (path === 'pdfpage') { renderPdfPage(+v).catch(function (e) { toast(e.message, 'error'); }); return; }
    var parts = path.split('.'), obj = S;
    if (parts[0] === 'trace') { obj = S.traces[S.active]; parts = parts.slice(1); if (!obj) return; }
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    var key = parts[parts.length - 1], old = obj[key];
    if (key === 'xLog' || key === 'yLog') v = v === '1';
    else if (el.type === 'range' || el.type === 'number' || key === 'printedFor') v = parseFloat(v) || 0;
    else if (key === 'hex') { var rgb = hexToRgb(v); if (!rgb) return; v = rgbToHex(rgb); }
    obj[key] = v;
    var out = S.root.querySelector('[data-out="' + path + '"]');
    if (out) out.textContent = key === 'pendingRot' ? fmt(v, 3) + '°' : key === 'threshold' ? (v ? v : 'off') : key === 'minRunFrac' || key === 'overlayOpacity' ? Math.round(v * 100) + '%' : v;
    return old;
  }
  function afterBind(path, isChange) {
    if (/^adjust\./.test(path)) { if (S.adjustRaf) return; S.adjustRaf = requestAnimationFrame(function () { S.adjustRaf = 0; recomputeAdjust(); }); return; }
    if (path === 'pendingRot') { requestDraw(); var ab = $('[data-act=applyrot]'); if (ab) ab.disabled = !S.pendingRot; return; }
    if (/^cal\./.test(path)) {
      if (/\.val$/.test(path) || /Log$/.test(path)) { if (S.cal.confirmed) { S.cal.confirmed = false; } }
      if (isChange) renderSide();
      renderFoot(); requestDraw(); return;
    }
    if (path === 'ai.model' || path === 'title') return;
    if (path === 'overlayOn' || path === 'overlayOpacity') { requestDraw(); return; }
    if (path === 'printedText' || path === 'printedFor') { var c = S.root.querySelector('[data-cmp]'); if (c) c.innerHTML = cmpHtml(); return; }
    if (/^traces\.\d+\.name$/.test(path)) return;
    if (path === 'showMask') { requestDraw(); return; }
    if (/^traces\.\d+\.mode$/.test(path)) { var tr = S.traces[+path.split('.')[1]]; tr.tol = tr.mode === 'dark' ? 110 : 80; if (tr.mode === 'dark' && !S.removeGrid) S.removeGrid = true; renderSide(); }
    if (path === 'removeGrid' || path === 'trace.extract' || path === 'trace.hex' || path === 'restrict') renderSide();
    scheduleExtract();
  }
  function onInput(e) { var p = e.target.getAttribute && e.target.getAttribute('data-bind'); if (!p || e.target.tagName === 'SELECT' || e.target.type === 'checkbox') return; setBind(p, e.target); afterBind(p, false); }
  function onChange(e) {
    var p = e.target.getAttribute && e.target.getAttribute('data-bind'); if (!p) return;
    if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') { setBind(p, e.target); afterBind(p, true); }
    else if (/^cal\./.test(p)) { setTimeout(function () { if (S) { renderSide(); renderFoot(); } }, 0); } // defer: let focus reach the next field first
    else if (p === 'pendingRot') { /* committed via Apply / leaving step */ }
  }
  function askClaudeUI() {
    if (!apiKey) { toast('Enter an Anthropic API key first.', 'warn'); return; }
    S.ai.busy = true; S.ai.error = ''; renderSide();
    var url; try { url = S.geomCanvas.toDataURL('image/png'); } catch (e) { url = S.srcDataURL; }
    D.askClaude(apiKey, url, S.ai.model).then(function (r) {
      if (!S) return;
      S.ai.busy = false; S.ai.result = r;
      var got = applyClaude(r);
      toast(got.length ? 'Claude suggested: ' + got.join(', ') + '. Please confirm.' : 'Claude returned no usable axis ticks. Calibrate manually.', got.length ? 'info' : 'warn');
      renderAll();
    }, function (err) {
      if (!S) return;
      S.ai.busy = false; S.ai.error = err.message || String(err); renderSide();
      toast('Claude request failed: ' + S.ai.error, 'error');
    });
  }
  function onKey(e) {
    if (!S) return;
    var tag = e.target && e.target.tagName, typing = /input|textarea|select/i.test(tag || '');
    if (e.code === 'Space' && !typing) { if (!S.space) { S.space = true; updateCursor(); } e.preventDefault(); return; }
    if (typing) return;
    if (e.key === 'Escape' && (S.tool !== 'pan' || S.drag)) { S.tool = 'pan'; S.drag = null; S.dragRect = null; S.loupe = null; renderAll(); e.preventDefault(); return; }
    if (S.step === 'calibrate' && S.activeMarker && /^Arrow/.test(e.key)) {
      var m = S.cal[S.activeMarker]; if (m.px == null) return;
      var d = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') m.px -= d; else if (e.key === 'ArrowRight') m.px += d; else if (e.key === 'ArrowUp') m.py -= d; else if (e.key === 'ArrowDown') m.py += d;
      e.preventDefault(); markCalMoved(); S.loupe = { x: m.px, y: m.py }; drawLoupe(); requestDraw(); return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.step === 'extract' && S.excludes.length && S.tool === 'exclude') { S.excludes.pop(); renderAll(); scheduleExtract(); }
  }
  function markCalMoved() { if (S.cal.confirmed && S.cal.suggested) { /* moving after confirm is fine: user is adjusting */ } var sp = S.el.side.querySelector('.pkd-mk'); if (sp) { renderSide(); } renderFoot(); }

  /* ---------------- stage: view, draw ---------------- */
  function resizeStage() {
    if (!S) return;
    var r = S.el.wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, cv = S.el.stage;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    S.dpr = dpr; S.cw = r.width; S.ch = r.height;
    if (S.srcImg && (!S.viewInit || S.fitted)) fitView();
    requestDraw();
  }
  function curImg() { return (S.step === 'verify' || S.step === 'send') ? S.geomCanvas : S.prepCanvas; }
  function fitView() {
    var im = curImg(); if (!im || !S.cw) return;
    var s = Math.min(S.cw / im.width, S.ch / im.height) * 0.94;
    S.view = { s: s, tx: (S.cw - im.width * s) / 2, ty: (S.ch - im.height * s) / 2 }; S.viewInit = true; S.fitted = true;
  }
  function zoomAt(f, sx, sy) {
    var v = S.view; if (sx == null) { sx = S.cw / 2; sy = S.ch / 2; }
    var ns = PK.util.clamp(v.s * f, 0.02, 40), k = ns / v.s; S.fitted = false;
    v.tx = sx - (sx - v.tx) * k; v.ty = sy - (sy - v.ty) * k; v.s = ns; requestDraw();
  }
  function toImg(sx, sy) { return { x: (sx - S.view.tx) / S.view.s, y: (sy - S.view.ty) / S.view.s }; }
  function toScr(ix, iy) { return [S.view.tx + ix * S.view.s, S.view.ty + iy * S.view.s]; }
  function requestDraw() { if (!S || S.rafPending) return; S.rafPending = true; requestAnimationFrame(function () { if (!S) return; S.rafPending = false; draw(); }); }
  function cssVar(n, d) { var v = S && getComputedStyle(S.el.body).getPropertyValue(n); return (v && v.trim()) || d; }
  function updateCursor() {
    if (!S) return; var t = S.tool, c = 'default';
    if (S.space || t === 'pan') c = S.drag && S.drag.kind === 'pan' ? 'grabbing' : 'grab';
    else if (t === 'eyedrop' || /^place:/.test(t) || t === 'crop' || t === 'exclude' || t === 'plot') c = 'crosshair';
    S.el.stage.style.cursor = c;
    var hint = '';
    if (S.srcImg) {
      if (t === 'crop') hint = 'Drag a rectangle to crop';
      else if (t === 'persp') hint = 'Drag the 4 corner handles onto the plot frame corners';
      else if (/^place:/.test(t)) hint = 'Press on the ' + t.slice(6).toUpperCase() + ' tick mark; drag to fine-tune with the loupe, release to place';
      else if (t === 'eyedrop') hint = 'Click the trace line to pick its colour';
      else if (t === 'exclude') hint = 'Drag rectangles over legends/labels to ignore them';
      else if (t === 'plot') hint = 'Drag the plot area (inside the axes)';
    }
    S.el.hint.style.display = hint ? '' : 'none'; S.el.hint.textContent = hint;
    var pt = $('[data-act=pantool]'); if (pt) pt.classList.toggle('on', t === 'pan');
  }
  function draw() {
    var cv = S.el.stage, br = S.el.wrap.getBoundingClientRect();
    if (Math.abs(br.width - S.cw) > 0.5 || Math.abs(br.height - S.ch) > 0.5 || (window.devicePixelRatio || 1) !== S.dpr) resizeStage();
    var c = cv.getContext('2d'), dpr = S.dpr || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, S.cw, S.ch);
    var im = curImg(); if (!im) return;
    var v = S.view;
    c.save(); c.translate(v.tx, v.ty); c.scale(v.s, v.s);
    c.imageSmoothingEnabled = v.s < 2;
    if (S.step === 'prep' && S.pendingRot) { c.translate(im.width / 2, im.height / 2); c.rotate(S.pendingRot * Math.PI / 180); c.translate(-im.width / 2, -im.height / 2); }
    c.drawImage(im, 0, 0);
    if (S.step === 'extract' && S.showMask && S.maskCanvas && S.maskCanvas.width === im.width) c.drawImage(S.maskCanvas, 0, 0);
    c.restore();
    var acc = cssVar('--accent', '#2563eb'), warn = cssVar('--warn', '#d97706'), err = cssVar('--error', '#dc2626');
    c.lineWidth = 1.5;
    if (S.step === 'prep') {
      if (S.pendingRot) { c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1; for (var gy = 0; gy < S.ch; gy += 40) { c.beginPath(); c.moveTo(0, gy + 0.5); c.lineTo(S.cw, gy + 0.5); c.stroke(); } for (var gx = 0; gx < S.cw; gx += 40) { c.beginPath(); c.moveTo(gx + 0.5, 0); c.lineTo(gx + 0.5, S.ch); c.stroke(); } }
      if (S.tool === 'crop' && S.cropRect) {
        var r = normRect(S.cropRect), a = toScr(r.x, r.y), b = toScr(r.x + r.w, r.y + r.h);
        c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.rect(0, 0, S.cw, S.ch); c.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.fill('evenodd');
        c.strokeStyle = acc; c.setLineDash([6, 4]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.setLineDash([]);
      }
      if (S.tool === 'persp' && S.persp) {
        c.strokeStyle = acc; c.lineWidth = 2; c.beginPath(); S.persp.forEach(function (p, i) { var q = toScr(p[0], p[1]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.closePath(); c.stroke();
        ['TL', 'TR', 'BR', 'BL'].forEach(function (lb, i) { var q = toScr(S.persp[i][0], S.persp[i][1]); handle(c, q, acc, lb); });
      }
    }
    if (S.step === 'calibrate' || S.step === 'extract') drawPlotRect(c, acc);
    if (S.step === 'calibrate') {
      var sug = S.cal.suggested && !S.cal.confirmed;
      MARKERS.forEach(function (k) {
        var m = S.cal[k]; if (m.px == null) return;
        var q = toScr(m.px, m.py), col = sug ? warn : (k[0] === 'x' ? '#e11d48' : '#0891b2');
        c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([5, 4]); c.beginPath();
        if (k[0] === 'x') { c.moveTo(q[0], 0); c.lineTo(q[0], S.ch); } else { c.moveTo(0, q[1]); c.lineTo(S.cw, q[1]); }
        c.stroke(); c.setLineDash([]);
        handle(c, q, col, k.toUpperCase() + (m.val !== '' ? ' = ' + m.val : '') + (sug ? ' ?' : ''), S.activeMarker === k);
      });
    }
    if (S.step === 'extract') {
      S.excludes.forEach(function (ex) { var r2 = normRect(ex), a2 = toScr(r2.x, r2.y), b2 = toScr(r2.x + r2.w, r2.y + r2.h); c.fillStyle = 'rgba(220,38,38,.18)'; c.fillRect(a2[0], a2[1], b2[0] - a2[0], b2[1] - a2[1]); c.strokeStyle = err; c.lineWidth = 1; c.strokeRect(a2[0], a2[1], b2[0] - a2[0], b2[1] - a2[1]); });
      if (S.dragRect) { var r3 = normRect(S.dragRect), a3 = toScr(r3.x, r3.y), b3 = toScr(r3.x + r3.w, r3.y + r3.h); c.strokeStyle = S.tool === 'exclude' ? err : acc; c.setLineDash([5, 3]); c.strokeRect(a3[0], a3[1], b3[0] - a3[0], b3[1] - a3[1]); c.setLineDash([]); }
    }
    if (S.step === 'calibrate' && S.dragRect) { var r4 = normRect(S.dragRect), a4 = toScr(r4.x, r4.y), b4 = toScr(r4.x + r4.w, r4.y + r4.h); c.strokeStyle = acc; c.setLineDash([5, 3]); c.strokeRect(a4[0], a4[1], b4[0] - a4[0], b4[1] - a4[1]); c.setLineDash([]); }
    if (S.step === 'extract' || ((S.step === 'verify' || S.step === 'send') && S.overlayOn)) {
      c.save(); c.globalAlpha = S.step === 'extract' ? 1 : S.overlayOpacity;
      S.traces.forEach(function (t, i) {
        if (!t.result) return;
        var pts = t.result.pts; if (!pts.length) return;
        var col = t.mode === 'dark' ? '#ff00aa' : t.hex, act = S.step === 'extract' && i === S.active;
        [[act ? 4.5 : 3.5, 'rgba(0,0,0,.75)'], [act ? 2.2 : 1.6, col]].forEach(function (st) {
          c.strokeStyle = st[1]; c.lineWidth = st[0]; c.lineJoin = 'round'; c.beginPath();
          var prev = -2; pts.forEach(function (p) { var q = toScr(p[0], p[1]); if (p[0] - prev > 1.5) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]); prev = p[0]; });
          c.stroke();
        });
      });
      c.restore();
      if (S.step !== 'extract') { c.font = '600 11px system-ui,sans-serif'; var lw = c.measureText('DIGITIZED overlay').width; c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(8, S.ch - 30, lw + 14, 22); c.fillStyle = '#fff'; c.fillText('DIGITIZED overlay', 15, S.ch - 15); }
    }
    drawLoupe();
  }
  function drawPlotRect(c, acc) {
    if (!S.plotRect) return; var r = S.plotRect, a = toScr(r.x, r.y), b = toScr(r.x + r.w, r.y + r.h);
    c.strokeStyle = acc; c.lineWidth = 1; c.setLineDash([2, 3]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.setLineDash([]);
  }
  function handle(c, q, col, label, active) {
    c.beginPath(); c.arc(q[0], q[1], active ? 9 : 7, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,.75)'; c.fill(); c.lineWidth = 2; c.strokeStyle = col; c.stroke();
    c.beginPath(); c.moveTo(q[0] - 12, q[1]); c.lineTo(q[0] + 12, q[1]); c.moveTo(q[0], q[1] - 12); c.lineTo(q[0], q[1] + 12); c.lineWidth = 1; c.stroke();
    if (label) { c.font = '600 12px system-ui,sans-serif'; var w = c.measureText(label).width; c.fillStyle = col; c.fillRect(q[0] + 10, q[1] - 24, w + 8, 17); c.fillStyle = '#fff'; c.fillText(label, q[0] + 14, q[1] - 11); }
  }
  function drawLoupe() {
    var L = S.el.loupe; if (!S.loupe) { L.style.display = 'none'; return; }
    var im = curImg(); if (!im) return;
    var p = S.loupe, R = 14, size = 150, c = L.getContext('2d');
    L.style.display = 'block';
    var sp = toScr(p.x, p.y), left = sp[0] > S.cw - 190 && sp[1] < 190 ? 10 : (sp[0] < 190 && sp[1] < 190 ? S.cw - 160 : 10);
    if (sp[0] < 190 && sp[1] < 190) left = S.cw - 160; else left = 10;
    L.style.left = left + 'px'; L.style.top = '10px';
    c.imageSmoothingEnabled = false; c.fillStyle = '#fff'; c.fillRect(0, 0, size, size);
    c.drawImage(im, p.x - R, p.y - R, 2 * R + 1, 2 * R + 1, 0, 0, size, size);
    var k = size / (2 * R + 1), cx = (R + 0.5) * k;
    c.strokeStyle = 'rgba(255,0,80,.9)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, cx - k); c.moveTo(cx, cx + k); c.lineTo(cx, size); c.moveTo(0, cx); c.lineTo(cx - k, cx); c.moveTo(cx + k, cx); c.lineTo(size, cx); c.stroke();
    c.strokeRect(cx - k / 2, cx - k / 2, k, k);
    if (S.tool === 'eyedrop') { var col = sampleColor(p.x, p.y); c.fillStyle = col; c.fillRect(size - 34, size - 22, 30, 18); c.strokeStyle = '#000'; c.strokeRect(size - 34, size - 22, 30, 18); }
  }
  function sampleColor(x, y) { // most "ink-like" pixel in a 5×5 neighbourhood (high chroma or dark), ignores AA halo/background
    var im = S.prepImg, w = im.width, h = im.height, xi = Math.round(x), yi = Math.round(y), best = null, bs = -1;
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
      var X = xi + dx, Y = yi + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      var k = (Y * w + X) * 4, r = im.data[k], g = im.data[k + 1], b = im.data[k + 2];
      var sc = Math.max(r, g, b) - Math.min(r, g, b) + 0.5 * (255 - lum(r, g, b)) - 0.3 * (Math.abs(dx) + Math.abs(dy));
      if (sc > bs) { bs = sc; best = [r, g, b]; }
    }
    return rgbToHex(best || [0, 0, 0]);
  }

  /* ---------------- stage: pointer handling ---------------- */
  function evPos(e) { var r = S.el.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function hitHandle(sp) {
    var best = null, bd = 18;
    if (S.step === 'calibrate') MARKERS.forEach(function (k) { var m = S.cal[k]; if (m.px == null) return; var q = toScr(m.px, m.py), d = Math.hypot(q[0] - sp.x, q[1] - sp.y); if (d < bd) { bd = d; best = { kind: 'marker', key: k }; } });
    if (S.step === 'prep' && S.tool === 'persp' && S.persp) S.persp.forEach(function (p, i) { var q = toScr(p[0], p[1]), d = Math.hypot(q[0] - sp.x, q[1] - sp.y); if (d < bd + 6) { bd = d; best = { kind: 'persp', i: i }; } });
    return best;
  }
  function clampImg(p) { var im = curImg(); return { x: PK.util.clamp(p.x, 0, im.width - 1), y: PK.util.clamp(p.y, 0, im.height - 1) }; }
  function onPtrDown(e) {
    if (!S.srcImg) return;
    var sp = evPos(e); S.ptrs[e.pointerId] = sp;
    try { S.el.stage.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    var ids = Object.keys(S.ptrs);
    if (ids.length === 2) { // pinch
      var a = S.ptrs[ids[0]], b = S.ptrs[ids[1]];
      S.drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { s: S.view.s, tx: S.view.tx, ty: S.view.ty } };
      S.dragRect = null; S.loupe = null; requestDraw(); return;
    }
    if (ids.length > 2) return;
    e.preventDefault();
    if (e.button === 1 || e.button === 2 || S.space) { S.drag = { kind: 'pan', sx: sp.x, sy: sp.y, tx: S.view.tx, ty: S.view.ty }; updateCursor(); return; }
    var ip = toImg(sp.x, sp.y), hit = hitHandle(sp), t = S.tool;
    if (hit && !/^place:/.test(t)) {
      S.drag = hit; if (hit.kind === 'marker') { S.activeMarker = hit.key; S.loupe = clampImg(ip); }
      requestDraw(); drawLoupe(); return;
    }
    if (/^place:/.test(t)) { S.drag = { kind: 'place', key: t.slice(6) }; S.loupe = clampImg(ip); drawLoupe(); return; }
    if (t === 'eyedrop') { S.drag = { kind: 'eyedrop' }; S.loupe = clampImg(ip); drawLoupe(); return; }
    if ((t === 'crop' && S.step === 'prep') || ((t === 'exclude' || t === 'plot') && (S.step === 'extract' || S.step === 'calibrate'))) {
      var q = clampImg(ip); S.drag = { kind: 'rect', x0: q.x, y0: q.y };
      if (t === 'crop') S.cropRect = { x: q.x, y: q.y, w: 0, h: 0 }; else S.dragRect = { x: q.x, y: q.y, w: 0, h: 0 };
      return;
    }
    S.drag = { kind: 'pan', sx: sp.x, sy: sp.y, tx: S.view.tx, ty: S.view.ty }; updateCursor();
  }
  function onPtrMove(e) {
    if (!S || !S.srcImg) return;
    var sp = evPos(e);
    if (S.ptrs[e.pointerId]) S.ptrs[e.pointerId] = sp;
    var d = S.drag;
    if (!d) { // hover
      if (S.tool === 'eyedrop' && e.pointerType === 'mouse') { S.loupe = clampImg(toImg(sp.x, sp.y)); drawLoupe(); }
      return;
    }
    var ip = toImg(sp.x, sp.y);
    if (d.kind === 'pinch') {
      var ids = Object.keys(S.ptrs); if (ids.length < 2) return;
      var a = S.ptrs[ids[0]], b = S.ptrs[ids[1]], dist = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      var ns = PK.util.clamp(d.v0.s * dist / (d.d0 || 1), 0.02, 40), k = ns / d.v0.s;
      S.fitted = false; S.view.s = ns; S.view.tx = m.x - (d.m0.x - d.v0.tx) * k; S.view.ty = m.y - (d.m0.y - d.v0.ty) * k; requestDraw(); return;
    }
    if (d.kind === 'pan') { S.fitted = false; S.view.tx = d.tx + sp.x - d.sx; S.view.ty = d.ty + sp.y - d.sy; requestDraw(); return; }
    if (d.kind === 'marker') { var q = clampImg(ip), m2 = S.cal[d.key]; m2.px = q.x; m2.py = q.y; S.loupe = q; requestDraw(); return; }
    if (d.kind === 'persp') { var q2 = clampImg(ip); S.persp[d.i] = [q2.x, q2.y]; requestDraw(); return; }
    if (d.kind === 'place' || d.kind === 'eyedrop') { S.loupe = clampImg(ip); drawLoupe(); return; }
    if (d.kind === 'rect') {
      var q3 = clampImg(ip), r = { x: d.x0, y: d.y0, w: q3.x - d.x0, h: q3.y - d.y0 };
      if (S.tool === 'crop') S.cropRect = r; else S.dragRect = r;
      requestDraw();
    }
  }
  function onPtrUp(e) {
    if (!S) return;
    delete S.ptrs[e.pointerId];
    var d = S.drag; if (!d) return;
    if (d.kind === 'pinch') { if (Object.keys(S.ptrs).length === 0) S.drag = null; return; }
    S.drag = null;
    if (d.kind === 'pan') { updateCursor(); return; }
    if (d.kind === 'marker') { S.loupe = null; drawLoupe(); markCalMoved(); requestDraw(); return; }
    if (d.kind === 'persp') return;
    if (d.kind === 'place') {
      var p = S.loupe || clampImg(toImg(evPos(e).x, evPos(e).y)), m = S.cal[d.key];
      m.px = p.x; m.py = p.y; S.activeMarker = d.key; S.loupe = null;
      // auto-advance to next unplaced marker
      var nxt = MARKERS.filter(function (k) { return S.cal[k].px == null; })[0];
      S.tool = nxt ? 'place:' + nxt : 'pan';
      renderAll();
      var inp = S.root.querySelector('[data-bind="cal.' + d.key + '.val"]'); if (inp && !inp.value && e.pointerType === 'mouse') inp.focus();
      return;
    }
    if (d.kind === 'eyedrop') {
      var pp = S.loupe; S.loupe = e.pointerType === 'mouse' ? S.loupe : null;
      if (pp && S.traces[S.active]) { var hx = sampleColor(pp.x, pp.y), tr = S.traces[S.active]; tr.hex = hx; tr.mode = 'color'; toast('Picked ' + hx + ' for ' + tr.name, 'ok'); }
      S.tool = 'pan'; S.loupe = null; renderAll(); scheduleExtract(); return;
    }
    if (d.kind === 'rect') {
      var r = S.tool === 'crop' ? S.cropRect : S.dragRect; S.dragRect = null;
      if (!r || Math.abs(r.w) < 3 || Math.abs(r.h) < 3) { requestDraw(); return; }
      var im = curImg(), nr = normRect(r, im.width, im.height);
      if (S.tool === 'crop') { S.cropRect = nr; renderSide(); }
      else if (S.tool === 'exclude') { S.excludes.push(nr); renderSide(); scheduleExtract(); }
      else if (S.tool === 'plot') { S.plotRect = nr; S.tool = 'pan'; renderAll(); if (S.step === 'extract') scheduleExtract(); }
      requestDraw();
    }
  }
  function onWheel(e) {
    if (!S || !S.srcImg) return; e.preventDefault();
    var sp = evPos(e);
    // ctrl+wheel = trackpad pinch → zoom; horizontal component / shift = two-finger pan; plain wheel = zoom
    if (e.ctrlKey) zoomAt(Math.exp(-e.deltaY * 0.01), sp.x, sp.y);
    else if (e.shiftKey) { S.view.tx -= e.deltaY || e.deltaX; requestDraw(); }
    else if (e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5) { S.view.tx -= e.deltaX; S.view.ty -= e.deltaY; requestDraw(); }
    else zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), sp.x, sp.y);
  }
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
