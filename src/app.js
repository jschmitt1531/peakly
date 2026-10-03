/* Peakly app shell: state, rendering, interaction, import/export. Loads last. */
(function (PK) {
  'use strict';
  var U = PK.util || {};
  var app = PK.app = PK.app || {};
  var HAS_DOM = typeof document !== 'undefined';
  var FORMAT_TAG = 'peakly-project';
  var SHARE_WARN = 8000, SHARE_MAX = 60000, UNDO_CAP = 100;

  /* ------------------------------------------------------------------ helpers */
  function an(name) { return PK.analysis && typeof PK.analysis[name] === 'function' ? PK.analysis[name] : null; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, d) { var n = typeof v === 'string' ? parseFloat(v) : v; return isNum(n) ? n : d; }
  function first() { for (var i = 0; i < arguments.length; i++) if (isNum(arguments[i])) return arguments[i]; return undefined; }
  function esc(s) { return U.escapeHtml ? U.escapeHtml(s) : String(s == null ? '' : s); }
  function fmt(v, d) { return U.fmt ? U.fmt(v, d) : (isNum(v) ? String(+v.toPrecision(d || 4)) : '—'); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function toArr(a) { return a ? Array.prototype.slice.call(a) : []; }
  function toast(m, k) { if (PK.toast) PK.toast(m, k); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function hexA(hex, a) {
    var h = String(hex || '#2563eb').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16); if (!isFinite(n)) return 'rgba(37,99,235,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function interp(xs, ys, x) { return U.interp1 ? U.interp1(xs, ys, x) : NaN; }
  function trapz(x, y, i0, i1) { var s = 0; for (var i = i0; i < i1; i++) s += (x[i + 1] - x[i]) * (y[i] + y[i + 1]) / 2; return s; }
  function lowerIdx(xs, v) { var lo = 0, hi = xs.length; while (lo < hi) { var m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return lo; }
  function csvCell(v) { var s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function fileSafe(s) { return String(s || 'peakly').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'peakly'; }
  function nowStamp() { var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); }

  /* ------------------------------------------------------------------ data model defaults */
  /** Colorblind-friendly publication palette (overrides PK.palette inside the app). */
  var APP_PALETTE = ['#1f4fd8', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
  app.palette = APP_PALETTE;
  /** ALS stiffness scaled with point count: λ = 1e8·(n/4000)^4, clamped to [1e4, 1e11]. */
  function autoLambda(n) { var v = 1e8 * Math.pow((n || 4000) / 4000, 4); v = Math.min(1e11, Math.max(1e4, v)); return Number(v.toPrecision(3)); }
  app.autoLambda = autoLambda;
  function defaultProc(n) {
    return { smooth: { on: true, window: 11, order: 3 }, baseline: { on: true, lambda: autoLambda(n), lambdaAuto: true, p: 0.001, iter: 10 },
      peaks: { threshold: 'auto', minDist: 0.05, minWidth: 0.01, auto: true } };
  }
  var RUN_FIELDS = [['sampleName', 'Sample name'], ['sampleId', 'Sample ID'], ['injVol', 'Injection volume (µL)'], ['conc', 'Concentration'], ['instrument', 'Instrument'],
    ['column', 'Column (name / lot)'], ['methodName', 'Method name'], ['operator', 'Operator'], ['dateTime', 'Run date / time'], ['detector', 'Detector / wavelength'], ['notes', 'Notes']];
  app.RUN_FIELDS = RUN_FIELDS;
  /** Pre-fill run info from parsed metadata (case-insensitive key match). */
  function runFromMeta(meta) {
    var out = {}, keys = Object.keys(meta || {});
    var pats = { sampleName: /^(sample ?name|samplename|sample|title)$/i, sampleId: /^(sample ?id|sampleid|vial|barcode)$/i, injVol: /inj.*vol|injection ?volume/i,
      conc: /^conc|concentration/i, instrument: /instrument|system|device/i, column: /^column ?(name|id|type|lot|serial)$/i, methodName: /^(method|method ?name|acq.*method|instrument ?method)$/i,
      operator: /operator|user|analyst|acquired ?by/i, dateTime: /date|time ?stamp|acquired|injection ?time|run ?time$/i, detector: /detector|wavelength|channel|signal/i };
    Object.keys(pats).forEach(function (f) {
      for (var i = 0; i < keys.length; i++) {
        var v = meta[keys[i]];
        if (pats[f].test(keys[i]) && v != null && typeof v !== 'object' && String(v).trim() !== '') { out[f] = String(v) + (f === 'detector' && /wavelength/i.test(keys[i]) && /^\d+(\.\d+)?$/.test(String(v)) ? ' nm' : ''); break; }
      }
    });
    return out;
  }
  function blankMethod() {
    return { name: '', gradient: [], mode: 'linear', solventA: '', solventB: '', bufferPH: null, gradientType: 'organic',
      bMaxConc: null, bConcUnit: 'mM', column: { length_mm: null, id_mm: null, particle_um: null, porosity: 0.65 },
      flow: null, dwellVolume_mL: null, wavelength_nm: null, temperature_C: null, notes: '', voidTime_min: null, run: {} };
  }
  function emptyProject() {
    return { version: 1, format: FORMAT_TAG, name: 'Untitled project', traces: [], method: blankMethod(), images: {},
      settings: { normalization: 'none', showGradient: true, showRaw: false, ghost: { show: true, opacity: 0.35 }, alignRef: null, differenceOf: null,
        labels: { mode: 'auto', size: 10, all: false }, grid: true, mirror: false, darkPlot: false, caption: true, gradientIncludeVoid: true,
        stack: 0, compareTol: 0.1, compareRef: null, compareLabels: [], fitModel: 'gaussian', snapAll: false },
      activeTraceId: null };
  }
  function mergeDeep(dst, src) {
    if (!src || typeof src !== 'object') return dst;
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) mergeDeep(dst[k], v);
      else if (v !== undefined) dst[k] = v;
    });
    return dst;
  }
  var colorCounter = 0;
  function nextColor(project) {
    var pal = APP_PALETTE;
    var used = {}; (project ? project.traces : []).forEach(function (t) { if (t.style) used[String(t.style.color).toLowerCase()] = 1; });
    for (var i = 0; i < pal.length; i++) if (!used[pal[i].toLowerCase()]) return pal[i];
    return pal[(colorCounter++) % pal.length];
  }

  /** Fill defaults and sanitize a trace partial. Pure (no DOM). */
  function normalizeTrace(t, project) {
    if (!t || typeof t !== 'object') throw new Error('Trace must be an object');
    var x = toArr(t.x).map(Number), y = toArr(t.y).map(Number);
    var n = Math.min(x.length, y.length), pts = [];
    for (var i = 0; i < n; i++) if (isFinite(x[i]) && isFinite(y[i])) pts.push([x[i], y[i]]);
    var sorted = true;
    for (var j = 1; j < pts.length; j++) if (pts[j][0] < pts[j - 1][0]) { sorted = false; break; }
    if (!sorted) pts.sort(function (a, b) { return a[0] - b[0]; });
    var out = {
      id: t.id || (PK.uid ? PK.uid('tr') : 'tr_' + Math.random().toString(36).slice(2)),
      name: String(t.name || 'Trace'),
      x: pts.map(function (p) { return p[0]; }), y: pts.map(function (p) { return p[1]; }),
      xUnit: t.xUnit || 'min', yUnit: t.yUnit || 'a.u.',
      source: t.source && typeof t.source === 'object' ? t.source : { kind: 'file' },
      digitized: t.digitized && typeof t.digitized === 'object' ? t.digitized : false,
      meta: t.meta && typeof t.meta === 'object' ? t.meta : {},
      style: mergeDeep({ color: null, visible: true, width: 1.5, offset: 0 }, t.style || {}),
      proc: mergeDeep(defaultProc(pts.length), t.proc || {}),
      peaks: toArr(t.peaks).filter(function (p) { return p && isNum(+p.start) && isNum(+p.end); }).map(function (p) {
        var o = { id: p.id || (PK.uid ? PK.uid('pk') : 'pk_' + Math.random().toString(36).slice(2)), start: +p.start, apex: isNum(+p.apex) ? +p.apex : (+p.start + +p.end) / 2, end: +p.end };
        if (p.manual) o.manual = true; if (p.label != null && String(p.label).trim()) o.label = String(p.label); return o;
      }),
      fit: t.fit && typeof t.fit === 'object' ? t.fit : null
    };
    if (t.derived) out.derived = t.derived;
    if (out.meta.xIsVolume && out.xUnit === 'min') out.xUnit = 'mL';
    if (out.xUnit === 'minutes' || out.xUnit === 'minute') out.xUnit = 'min';
    // colors handed out by other modules from PK.palette are treated as unassigned → publication palette
    var pkp = (PK.palette || []).map(function (c) { return String(c).toLowerCase(); });
    var taken = (project ? project.traces : []).some(function (o) { return o.id !== out.id && String(o.style && o.style.color).toLowerCase() === String(out.style.color).toLowerCase(); });
    if (!out.style.color || taken || (pkp.indexOf(String(out.style.color).toLowerCase()) >= 0 && APP_PALETTE.indexOf(out.style.color) < 0)) out.style.color = nextColor(project);
    var bl = t.proc && t.proc.baseline, explicitLam = bl && bl.lambda != null && bl.lambdaAuto !== true;
    if (explicitLam) out.proc.baseline.lambdaAuto = false;
    if (out.proc.baseline.lambdaAuto) out.proc.baseline.lambda = autoLambda(out.x.length);
    if (!out.meta.run || typeof out.meta.run !== 'object') out.meta.run = runFromMeta(out.meta);
    if (out.digitized && !Array.isArray(out.digitized.warnings)) out.digitized.warnings = [];
    return out;
  }

  /** Validate and fill a project object (from file/share/undo). Throws on garbage. */
  function sanitizeProject(p) {
    if (!p || typeof p !== 'object') throw new Error('Not a Peakly project');
    if (p.traces != null && !Array.isArray(p.traces)) throw new Error('Project traces must be an array');
    var out = emptyProject();
    out.name = p.name ? String(p.name) : out.name;
    out.method = mergeDeep(blankMethod(), p.method || {});
    if (!Array.isArray(out.method.gradient)) out.method.gradient = [];
    if (!out.method.run || typeof out.method.run !== 'object') out.method.run = {};
    out.method.gradient = out.method.gradient.filter(function (r) { return r && isNum(+r.t) && isNum(+r.B); })
      .map(function (r) { return { t: +r.t, B: +r.B, flow: isNum(+r.flow) && r.flow !== null && r.flow !== '' ? +r.flow : null }; });
    out.settings = mergeDeep(out.settings, p.settings || {});
    out.images = p.images && typeof p.images === 'object' ? p.images : {};
    (p.traces || []).forEach(function (t) { out.traces.push(normalizeTrace(t, out)); });
    out.activeTraceId = p.activeTraceId && out.traces.some(function (t) { return t.id === p.activeTraceId; }) ? p.activeTraceId : (out.traces[0] ? out.traces[0].id : null);
    return out;
  }

  /* ------------------------------------------------------------------ share codec (pure) */
  function roundSig(v, sig) { if (!isNum(v)) return null; if (v === 0) return 0; return Number(v.toPrecision(sig)); }
  /** Compact numeric arrays: uniformly spaced → {u:[x0,dx,n]}, else rounded to `sig` significant digits. */
  function packArray(arr, sig) {
    var n = arr.length;
    if (n > 2) {
      var dx = (arr[n - 1] - arr[0]) / (n - 1), ok = dx > 0, tol = Math.abs(dx) * 1e-4;
      for (var i = 1; ok && i < n; i++) if (Math.abs(arr[i] - (arr[0] + i * dx)) > tol) ok = false;
      if (ok) return { u: [arr[0], dx, n] };
    }
    return arr.map(function (v) { return roundSig(v, sig || 6); });
  }
  /** Signal arrays: quantize to max|y|·1e-5 (power of ten) and store integer first differences, which compress well. */
  function packDelta(arr) {
    var mx = 0, i; for (i = 0; i < arr.length; i++) if (isNum(arr[i]) && Math.abs(arr[i]) > mx) mx = Math.abs(arr[i]);
    if (!(mx > 0) || arr.length < 3 || arr.some(function (v) { return !isNum(v); })) return packArray(arr, 6);
    var e = Math.floor(Math.log10(mx)) - 5, sc = Math.pow(10, e), d = new Array(arr.length), prev = 0;
    for (i = 0; i < arr.length; i++) { var q = Math.round(arr[i] / sc); d[i] = q - prev; prev = q; }
    return { e: e, d: d };
  }
  function unpackArray(a) {
    if (Array.isArray(a)) return a.map(function (v) { return v == null ? NaN : +v; });
    if (a && Array.isArray(a.d) && isNum(a.e)) { var sc = Math.pow(10, a.e), acc = 0; return a.d.map(function (v) { acc += +v; return +(acc * sc).toPrecision(12); }); }
    if (a && Array.isArray(a.u) && a.u.length === 3) {
      var x0 = +a.u[0], dx = +a.u[1], n = Math.min(+a.u[2] | 0, 5e6), out = new Array(Math.max(n, 0));
      for (var i = 0; i < n; i++) out[i] = x0 + i * dx; return out;
    }
    return [];
  }
  /** Project → compact plain object for share links (no images, no fit curves, rounded data). */
  function packShare(project) {
    var p = project || emptyProject();
    var settings = clone(p.settings || {}); delete settings.theme;
    return {
      app: 'Peakly', v: 1, name: p.name, method: clone(p.method), settings: settings, activeTraceId: p.activeTraceId,
      traces: (p.traces || []).map(function (t) {
        var o = { id: t.id, name: t.name, xUnit: t.xUnit, yUnit: t.yUnit, source: t.source, meta: t.meta, style: t.style, proc: t.proc,
          x: packArray(toArr(t.x), 7), y: packDelta(toArr(t.y)),
          peaks: (t.peaks || []).map(function (k) { var q = { id: k.id, start: roundSig(k.start, 7), apex: roundSig(k.apex, 7), end: roundSig(k.end, 7) }; if (k.manual) q.manual = 1; if (k.label) q.label = k.label; return q; }) };
        if (t.digitized) { o.digitized = clone(t.digitized); o.digitized.imageMissing = true; }
        if (t.derived) o.derived = t.derived;
        if (t.fit) { o.fit = clone(t.fit); delete o.fit.curve; delete o.fit.cov; }
        return o;
      })
    };
  }
  function unpackShare(obj) {
    if (!obj || typeof obj !== 'object' || obj.app !== 'Peakly') throw new Error('This link does not contain a Peakly project');
    var p = clone(obj);
    p.traces = (p.traces || []).map(function (t) { t.x = unpackArray(t.x); t.y = unpackArray(t.y); return t; });
    p.images = {};
    return sanitizeProject(p);
  }
  function getLZ(lz) { var L = lz || (typeof LZString !== 'undefined' ? LZString : null); if (!L) throw new Error('Share links need the lz-string library, which did not load.'); return L; }
  /** encodeShare(project, [lz]) → URI-safe string (payload for '#p='). */
  app.encodeShare = function (project, lz) { return getLZ(lz).compressToEncodedURIComponent(JSON.stringify(packShare(project))); };
  /** decodeShare(str | '#p=...', [lz]) → sanitized Project (images empty). Throws on bad input. */
  app.decodeShare = function (str, lz) {
    var s = String(str || ''); var m = s.match(/[#&]?p=([^&]*)/); if (m) s = m[1];
    var json = getLZ(lz).decompressFromEncodedURIComponent(s);
    if (!json) throw new Error('The share link is damaged or incomplete (it may have been cut off when copied).');
    var obj; try { obj = JSON.parse(json); } catch (e) { throw new Error('The share link is damaged (invalid data).'); }
    return unpackShare(obj);
  };
  app.packShare = packShare; app.unpackShare = unpackShare; app.packArray = packArray; app.packDelta = packDelta; app.unpackArray = unpackArray;
  app.sanitizeProject = sanitizeProject; app.normalizeTrace = normalizeTrace; app.defaultProc = defaultProc;
  app.blankMethod = blankMethod; app.emptyProject = emptyProject; app.SHARE_WARN = SHARE_WARN; app.SHARE_MAX = SHARE_MAX;

  /* ------------------------------------------------------------------ method helpers (fallbacks if analysis is missing) */
  function sortedRows(m) { return (m && m.gradient || []).filter(function (r) { return isNum(+r.t) && isNum(+r.B); }).map(function (r, i) { return { t: +r.t, B: +r.B, flow: r.flow, i: i }; }).sort(function (a, b) { return a.t - b.t || a.i - b.i; }); }
  function gradientAtLocal(m, t) {
    var r = sortedRows(m); if (!r.length) return null;
    if (t <= r[0].t) return r[0].B; if (t >= r[r.length - 1].t) return r[r.length - 1].B;
    for (var i = 0; i < r.length - 1; i++) {
      if (t >= r[i].t && t < r[i + 1].t) {
        if (m.mode === 'step' || r[i + 1].t === r[i].t) return r[i].B;
        return r[i].B + (r[i + 1].B - r[i].B) * (t - r[i].t) / (r[i + 1].t - r[i].t);
      }
    }
    return r[r.length - 1].B;
  }
  function methodFlow(m) { if (!m) return null; if (num(m.flow, 0) > 0) return +m.flow; var r = sortedRows(m); for (var i = 0; i < r.length; i++) if (num(r[i].flow, 0) > 0) return +r[i].flow; return null; }
  function dwellTime(m) {
    var f = an('dwellTime'); if (f) { try { var v = f(m); if (isNum(v)) return v; } catch (e) { /* fall through */ } }
    var fl = methodFlow(m); return fl && num(m.dwellVolume_mL, 0) > 0 ? m.dwellVolume_mL / fl : 0;
  }
  function autoVoidTime(m) {
    var c = m && m.column || {}, fl = methodFlow(m);
    if (!(num(c.id_mm, 0) > 0 && num(c.length_mm, 0) > 0 && fl)) return NaN;
    var por = num(c.porosity, 0.65); return por * Math.PI * Math.pow(c.id_mm / 2, 2) * c.length_mm / 1000 / fl; // mm³ → mL
  }
  function voidTime(m) {
    if (m && num(m.voidTime_min, 0) > 0) return +m.voidTime_min;
    var f = an('voidTime'); if (f) { try { var v = f(m); if (isNum(v) && v > 0) return v; } catch (e) { /* fall through */ } }
    var a = autoVoidTime(m); return isNum(a) && a > 0 ? a : NaN;
  }
  function hasGradient(m) { return !!(m && sortedRows(m).length); }
  function concInfo(m) {
    if (m && (m.gradientType === 'salt' || m.gradientType === 'imidazole') && num(m.bMaxConc, 0) > 0) {
      return { k: m.bMaxConc / 100, unit: m.bConcUnit || 'mM', label: m.gradientType === 'imidazole' ? 'Imidazole' : 'Salt' };
    }
    return null;
  }
  function gradientCurve(m, tMax, n) {
    var f = an('gradientCurve'), res = null;
    var iv = !!(state.project && state.project.settings && state.project.settings.gradientIncludeVoid);
    if (f) { try { res = f(m, tMax, n, { includeVoid: iv }); } catch (e) { res = null; } }
    if (!res || !res.t || !res.B) {
      var t0v = iv ? voidTime(m) : 0, d = dwellTime(m) + (isNum(t0v) ? t0v : 0), t = U.linspace(0, tMax, n || 400);
      res = { t: t, B: t.map(function (v) { return gradientAtLocal(m, v - d); }) };
    }
    return res;
  }
  /** %B at elution: gradient at (rt − dwell − void) (rt in minutes). */
  function bAt(m, rtMin) {
    if (!hasGradient(m) || !isNum(rtMin)) return NaN;
    var f = an('Bat'); if (f) { try { var v = f(m, rtMin); if (isNum(v)) return v; } catch (e) { /* fall through */ } }
    
    var t0 = voidTime(m); return gradientAtLocal(m, rtMin - dwellTime(m) - (isNum(t0) ? t0 : 0));
  }

  /* ------------------------------------------------------------------ state + undo */
  var state = { project: emptyProject(), selPeakId: null, addMode: false, cache: {}, undo: [], redo: [], procSession: null, warned: {} };
  app._state = state;

  function snapshot() {
    var p = state.project, imgs = p.images; p.images = {};
    try { return JSON.stringify(p); } finally { p.images = imgs; }
  }
  app.pushUndo = function (label) {
    state.undo.push({ label: label || 'edit', snap: snapshot(), sel: state.selPeakId });
    if (state.undo.length > UNDO_CAP) state.undo.shift();
    state.redo = []; updateUndoButtons();
  };
  function restore(entry) {
    var imgs = state.project.images, p = JSON.parse(entry.snap); p.images = imgs;
    state.project = p; state.selPeakId = entry.sel || null; renderAll(); refreshOpenPanels();
  }
  app.undo = function () {
    if (!state.undo.length) { toast('Nothing to undo', 'info'); return; }
    var e = state.undo.pop(); state.redo.push({ label: e.label, snap: snapshot(), sel: state.selPeakId });
    restore(e); toast('Undid: ' + e.label, 'info');
  };
  app.redo = function () {
    if (!state.redo.length) { toast('Nothing to redo', 'info'); return; }
    var e = state.redo.pop(); state.undo.push({ label: e.label, snap: snapshot(), sel: state.selPeakId });
    restore(e); toast('Redid: ' + e.label, 'info');
  };
  function updateUndoButtons() {
    if (!HAS_DOM) return;
    var u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo');
    if (u) { u.disabled = !state.undo.length; u.title = state.undo.length ? 'Undo ' + state.undo[state.undo.length - 1].label + ' (Ctrl/Cmd+Z)' : 'Undo (Ctrl/Cmd+Z)'; }
    if (r) { r.disabled = !state.redo.length; r.title = state.redo.length ? 'Redo ' + state.redo[state.redo.length - 1].label + ' (Shift+Ctrl/Cmd+Z)' : 'Redo'; }
  }

  /* ------------------------------------------------------------------ project API */
  function P() { return state.project; }
  function traceById(id) { var ts = P().traces; for (var i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i]; return null; }
  function activeTrace() { return traceById(P().activeTraceId) || null; }
  /** Auxiliary channels (FPLC %B, conductivity, pH, pressure, temperature…) are plotted on secondary axes, never integrated. */
  function isAux(t) { var r = t && t.meta && t.meta.role; return !!r && r !== 'signal'; }
  function isEmpty() { return !P().traces.length; }

  app.getProject = function () { return state.project; };
  app.setProject = function (p, opts) {
    opts = opts || {};
    var np = sanitizeProject(p);
    if (opts.undo !== false) app.pushUndo(opts.label || 'Load project');
    state.project = np; state.selPeakId = null; state.cache = {};
    np.traces.forEach(function (t) { if (!t.peaks.length && t.proc.peaks.auto && !isAux(t)) detectFor(t, true); });
    renderAll(); refreshOpenPanels();
    return np;
  };
  app.addImage = function (dataURL) { var id = PK.uid ? PK.uid('img') : 'img_' + Date.now(); P().images[id] = dataURL; return id; };
  app.addTraces = function (traces, opts) {
    opts = opts || {}; if (!Array.isArray(traces)) traces = [traces];
    traces = traces.filter(Boolean); if (!traces.length) return [];
    app.pushUndo(opts.label || (traces.length > 1 ? 'Add ' + traces.length + ' traces' : 'Add trace'));
    var added = [], anyImage = false;
    traces.forEach(function (t) {
      try {
        var nt = normalizeTrace(t, P());
        var role = nt.meta.role;
        if (role && role !== 'signal' && role !== 'gradient' && role !== 'conductivity' && !(t.style && t.style.visible === true)) nt.style.visible = false;
        if (nt.source && nt.source.kind === 'image' && !(t.proc && t.proc.baseline)) { nt.proc.baseline.on = false; nt.proc.smooth.on = false; }
        if (nt.x.length < 2) { toast('Skipped "' + nt.name + '": fewer than 2 valid data points.', 'warn'); return; }
        while (traceById(nt.id)) nt.id = PK.uid('tr');
        P().traces.push(nt); added.push(nt);
        if (nt.source && nt.source.kind === 'image') anyImage = true;
        if (!nt.peaks.length && nt.proc.peaks.auto && !isAux(nt)) detectFor(nt, true);
      } catch (e) { console.error(e); toast('Could not add a trace: ' + e.message, 'error'); }
    });
    if (!added.length) { state.undo.pop(); updateUndoButtons(); return []; }
    if (opts.select !== false) {
      var main = added.filter(function (t) { return !isAux(t); });
      P().activeTraceId = (main[0] || added[0]).id; state.selPeakId = null;
    } else if (!P().activeTraceId) P().activeTraceId = added[0].id;
    renderAll();
    if (!opts.silent) toast('Added ' + added.length + ' trace' + (added.length > 1 ? 's' : '') + (anyImage ? ' (digitized)' : ''), 'ok');
    return added.map(function (t) { return t.id; });
  };
  app.selectTrace = function (id) { if (traceById(id)) { P().activeTraceId = id; state.selPeakId = null; renderAll(); } };

  /* ------------------------------------------------------------------ analysis wrappers */
  function warnOnce(key, msg) { if (state.warned[key]) return; state.warned[key] = 1; toast(msg, 'warn'); }
  function procKey(t) { return t.id + '|' + t.x.length + '|' + t.x[0] + '|' + t.x[t.x.length - 1] + '|' + t.y[t.y.length >> 1] + '|' + JSON.stringify(t.proc); }
  function processed(t) {
    var key = procKey(t), c = state.cache[t.id];
    if (c && c.key === key) return c.res;
    var res = null, f = an('process');
    if (f && !isAux(t)) {
      try { res = f(t); } catch (e) { console.error(e); warnOnce('proc', 'Processing failed for "' + t.name + '": ' + e.message + '. Showing raw data.'); }
    }
    if (!res || !res.y || res.y.length !== t.x.length) res = { x: t.x, y: t.y, yRaw: t.y, baseline: null };
    res = { x: toArr(res.x || t.x), y: toArr(res.y), yRaw: toArr(res.yRaw || t.y), baseline: res.baseline ? toArr(res.baseline) : null };
    state.cache[t.id] = { key: key, res: res, mkey: null, metrics: null, noise: null };
    return res;
  }
  function noiseOf(t) {
    var pr = processed(t), c = state.cache[t.id];
    if (c.noise) return c.noise;
    // Noise from the raw (unsmoothed) signal: the MAD of first differences ignores drift, and smoothing would
    // otherwise shrink σ, which would inflate S/N and lower the auto threshold.
    var f = an('noise'), nz = null;
    if (f) { try { nz = f(t.x, t.y); } catch (e) { nz = null; } }
    c.noise = nz || { sigma: NaN, method: 'n/a' }; return c.noise;
  }
  function clearFit(t) { t.fit = null; }
  function detectFor(t, silent) {
    var f = an('detectPeaks'); if (!f) { if (!silent) toast('Peak detection is unavailable (analysis module not loaded).', 'error'); return false; }
    var pr = processed(t), o = t.proc.peaks, res;
    var keep = t.peaks.filter(function (p) { return p.manual; });
    var thr = o.threshold;
    if (thr === 'auto' || !isNum(+thr)) { var nz = noiseOf(t); if (isNum(nz.sigma) && nz.sigma > 0) thr = 9 * nz.sigma; else thr = 'auto'; } // 9σ_raw ⇒ S/N ≥ 3 (h = 6σ)
    try { res = f(pr.x, pr.y, { threshold: thr, minDist: o.minDist, minWidth: o.minWidth, keep: keep }) || []; }
    catch (e) { console.error(e); if (!silent) toast('Peak detection failed: ' + e.message, 'error'); return false; }
    t.peaks = toArr(res).filter(function (p) { return p && isNum(p.start) && isNum(p.end); })
      .map(function (p) { var q = { id: p.id || PK.uid('pk'), start: +p.start, apex: isNum(p.apex) ? +p.apex : (p.start + p.end) / 2, end: +p.end }; if (p.manual) q.manual = true; if (p.label) q.label = p.label; return q; })
      .sort(function (a, b) { return a.apex - b.apex; });
    clearFit(t);
    if (state.selPeakId && !t.peaks.some(function (p) { return p.id === state.selPeakId; })) state.selPeakId = null;
    return true;
  }
  /** Time conversion for a trace's x (minutes or mL). */
  function xToMin(t, v) { if (t.xUnit === 'mL') { var fl = methodFlow(P().method); return fl ? v / fl : NaN; } return t.xUnit === 'min' ? v : NaN; }
  function voidInXUnits(t) { var t0 = voidTime(P().method); if (!isNum(t0)) return NaN; if (t.xUnit === 'mL') { var fl = methodFlow(P().method); return fl ? t0 * fl : NaN; } return t.xUnit === 'min' ? t0 : NaN; }
  function metricsFor(t) {
    if (!t || !t.peaks.length) return [];
    var pr = processed(t), c = state.cache[t.id], t0 = voidInXUnits(t);
    var mkey = JSON.stringify(t.peaks) + '|' + t0;
    if (c.mkey === mkey && c.metrics) return c.metrics;
    var f = an('peakMetrics'), ms = [];
    if (f) {
      try { ms = toArr(f(pr.x, pr.y, t.peaks, { voidTime: isNum(t0) ? t0 : undefined, noise: noiseOf(t) })); }
      catch (e) { console.error(e); warnOnce('metrics', 'Peak metrics failed: ' + e.message); ms = []; }
    }
    if (ms.length !== t.peaks.length) ms = t.peaks.map(function (p) { return basicMetric(pr, p); });
    c.mkey = mkey; c.metrics = ms; return ms;
  }
  /** Minimal metrics when the analysis module is unavailable. */
  function basicMetric(pr, p) {
    var x = pr.x, y = pr.y, i0 = lowerIdx(x, p.start), i1 = Math.min(lowerIdx(x, p.end), x.length - 1), h = -Infinity, rt = p.apex;
    var b0 = interp(x, y, p.start), b1 = interp(x, y, p.end), area = 0;
    for (var i = i0; i <= i1; i++) {
      var b = b0 + (b1 - b0) * (x[i] - p.start) / ((p.end - p.start) || 1), v = y[i] - b;
      if (v > h) { h = v; rt = x[i]; }
      if (i < i1) { var bn = b0 + (b1 - b0) * (x[i + 1] - p.start) / ((p.end - p.start) || 1); area += (x[i + 1] - x[i]) * (v + y[i + 1] - bn) / 2; }
    }
    return { id: p.id, rt: rt, height: h, area: area, formulas: { area: { expr: '∑ trapezoid(y − drop baseline)·Δx', inputs: { start: p.start, end: p.end }, value: area } } };
  }
  function withAreaPct(ms) {
    var tot = 0; ms.forEach(function (m) { if (isNum(m.area) && m.area > 0) tot += m.area; });
    return ms.map(function (m) { if (!isNum(m.areaPct) && tot > 0 && isNum(m.area)) m.areaPct = 100 * m.area / tot; return m; });
  }
  /** Local fallback for manual add when PK.analysis.peakAt is missing: local max then walk to valleys. */
  function peakAtLocal(x, y, t, win) {
    var i0 = lowerIdx(x, t - win), i1 = Math.min(lowerIdx(x, t + win), x.length - 1), im = i0;
    for (var i = i0; i <= i1; i++) if (y[i] > y[im]) im = i;
    var a = im, b = im;
    while (a > 0 && y[a - 1] <= y[a]) a--;
    while (b < x.length - 1 && y[b + 1] <= y[b]) b++;
    return { start: x[a], apex: x[im], end: x[b] };
  }

  /* ================================================================== DOM rendering */
  function $(id) { return HAS_DOM ? document.getElementById(id) : null; }
  function cssVar(name) { return HAS_DOM ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : ''; }
  function themeColors(forceLight) {
    if (forceLight) return { panel: '#ffffff', text: '#0f172a', muted: '#5b6577', border: '#d5dbe5', grid: '#e6eaf0', accent: '#2563eb', accent2: '#0e7490', digitized: '#b45309' };
    return { panel: cssVar('--panel') || '#fff', text: cssVar('--text') || '#111', muted: cssVar('--muted') || '#666', border: cssVar('--border') || '#ccc',
      grid: cssVar('--grid') || '#eee', accent: cssVar('--accent') || '#2563eb', accent2: cssVar('--accent-2') || '#0e7490', digitized: cssVar('--digitized') || '#b45309' };
  }
  var renderQueued = false;
  function renderAll() {
    if (!HAS_DOM || !state.ready) return;
    renderTraceList(); renderProc(); renderOverlay(); renderNotices(); renderEmpty(); renderPlot(); renderTable(); updateUndoButtons(); renderPlotTools();
  }
  function scheduleRender() { if (renderQueued || !HAS_DOM) return; renderQueued = true; requestAnimationFrame(function () { renderQueued = false; renderAll(); }); }
  app.render = function () { renderAll(); };

  /* ---------------- trace list */
  function traceBadges(t) {
    var b = [];
    if (t.digitized) {
      var d = t.digitized;
      b.push('<span class="badge digitized" title="Digitized from an image. Uncertainty from pixel size: ±' + esc(fmt(d.dxMin, 2)) + ' ' + esc(t.xUnit) + ', ±' + esc(fmt(d.dy, 2)) + ' ' + esc(t.yUnit) + '">digitized ±' + esc(fmt(d.dxMin, 2)) + '</span>');
    }
    if (t.derived || (t.meta && t.meta.derived)) b.push('<span class="badge derived">derived</span>');
    if (t.meta && t.meta.role) b.push('<span class="badge">' + esc(t.meta.role) + '</span>');
    if (t.xUnit === 'mL') b.push('<span class="badge warn" title="x axis is volume (mL)">mL</span>');
    return b.join(' ');
  }
  function renderTraceList() {
    var ul = $('trace-list'); if (!ul) return;
    var p = P();
    if (!p.traces.length) { ul.innerHTML = '<li class="small muted">No traces yet. Open a file, paste data, digitize an image or load a sample.</li>'; return; }
    ul.innerHTML = p.traces.map(function (t) {
      var act = t.id === p.activeTraceId, vis = t.style.visible !== false;
      var src = t.source || {}, srcTxt = [src.kind, src.format, src.filename].filter(Boolean).join(' · ');
      return '<li class="trace-item' + (act ? ' active' : '') + '" data-id="' + esc(t.id) + '">' +
        '<div class="top">' +
        '<input type="color" value="' + esc(t.style.color) + '" data-act="color" aria-label="Color of ' + esc(t.name) + '">' +
        '<input type="checkbox" class="vis-toggle" data-act="vis"' + (vis ? ' checked' : '') + ' aria-label="Show ' + esc(t.name) + '" title="Show/hide">' +
        '<button class="name' + (vis ? '' : ' hidden-trace') + '" data-act="select" aria-pressed="' + act + '" title="' + esc(t.name + (srcTxt ? '\n' + srcTxt : '')) + '">' + esc(t.name) + '</button>' +
        '<button class="btn ghost sm icon" data-act="rename" aria-label="Rename ' + esc(t.name) + '" title="Rename">&#9998;</button>' +
        '<button class="btn ghost sm icon danger" data-act="delete" aria-label="Delete ' + esc(t.name) + '" title="Delete">&#10005;</button>' +
        '</div>' +
        '<div class="sub">' + traceBadges(t) + ' <span>' + t.x.length + ' pts</span>' + (isAux(t) ? '' : '<span>' + t.peaks.length + ' peaks</span>') +
        '<button class="btn ghost sm icon" data-act="up" aria-label="Move ' + esc(t.name) + ' up" title="Move up (legend/stack order)" style="min-height:22px;padding:0 5px">&#9650;</button>' +
        '<button class="btn ghost sm icon" data-act="down" aria-label="Move ' + esc(t.name) + ' down" title="Move down" style="min-height:22px;padding:0 5px">&#9660;</button>' +
        (remapSource(t) ? '<button class="btn ghost sm" data-act="remap" title="Re-map the columns of the source data">Re-map columns</button>' : '') +
        '<label class="inline" title="Retention-time offset applied to the display (for overlay alignment)">Δt <input type="number" step="0.01" data-act="offset" value="' + (num(t.style.offset, 0) || 0) + '" aria-label="Time offset for ' + esc(t.name) + '"></label>' +
        '</div></li>';
    }).join('');
  }
  function bindTraceList() {
    var ul = $('trace-list');
    function tr(el) { var li = el.closest('.trace-item'); return li ? traceById(li.getAttribute('data-id')) : null; }
    ul.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el) return; var t = tr(el); if (!t) return;
      var act = el.getAttribute('data-act');
      if (act === 'select') { app.selectTrace(t.id); closeDrawerIfMobile(); }
      else if (act === 'delete') {
        app.pushUndo('Delete trace'); P().traces = P().traces.filter(function (x) { return x.id !== t.id; });
        if (P().activeTraceId === t.id) { var m = P().traces.filter(function (x) { return !isAux(x); }); P().activeTraceId = (m[0] || P().traces[0] || {}).id || null; state.selPeakId = null; }
        delete state.cache[t.id]; renderAll(); toast('Deleted "' + t.name + '" (Ctrl/Cmd+Z to undo)', 'info');
      } else if (act === 'rename') startRename(el.closest('.trace-item'), t);
      else if (act === 'up' || act === 'down') {
        var ts = P().traces, i = ts.indexOf(t), j = act === 'up' ? i - 1 : i + 1; if (j < 0 || j >= ts.length) return;
        app.pushUndo('Reorder traces'); ts.splice(i, 1); ts.splice(j, 0, t); renderAll();
        var b = document.querySelector('#trace-list .trace-item[data-id="' + cssEsc(t.id) + '"] [data-act="' + act + '"]'); if (b) b.focus();
      } else if (act === 'remap') { var rs = remapSource(t); if (rs) { if (rs.then) rs.then(function (o) { if (o) openFallback(o); }); else openFallback(rs); } }
    });
    ul.addEventListener('change', function (e) {
      var el = e.target, t = tr(el); if (!t) return; var act = el.getAttribute('data-act');
      if (act === 'vis') { app.pushUndo('Toggle visibility'); t.style.visible = el.checked; renderAll(); }
      else if (act === 'color') { app.pushUndo('Change color'); t.style.color = el.value; renderTraceList(); renderPlot(); }
      else if (act === 'offset') { app.pushUndo('Change time offset'); t.style.offset = num(el.value, 0); renderPlot(); }
    });
    ul.addEventListener('input', function (e) {
      var el = e.target, t = tr(el); if (!t) return;
      if (el.getAttribute('data-act') === 'color') { t.style.color = el.value; schedulePlot(); }
    });
  }
  function startRename(li, t) {
    var btn = li.querySelector('.name'); if (!btn) return;
    var inp = document.createElement('input'); inp.type = 'text'; inp.className = 'rename'; inp.value = t.name; inp.setAttribute('aria-label', 'New name');
    btn.replaceWith(inp); inp.focus(); inp.select();
    var done = false;
    function commit(save) {
      if (done) return; done = true;
      var v = inp.value.trim();
      if (save && v && v !== t.name) { app.pushUndo('Rename trace'); t.name = v; }
      renderAll();
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(true); else if (e.key === 'Escape') { e.stopPropagation(); commit(false); } });
    inp.addEventListener('blur', function () { commit(true); });
  }

  /* ---------------- processing panel */
  var procBuiltFor = null;
  function renderProc() {
    var host = $('proc-body'), lbl = $('proc-trace-name'); if (!host) return;
    var t = activeTrace();
    if (!t) { host.innerHTML = '<p class="small muted">Select a trace to adjust smoothing, baseline and peak detection.</p>'; if (lbl) lbl.textContent = ''; procBuiltFor = null; return; }
    if (lbl) lbl.textContent = t.name;
    if (isAux(t)) { host.innerHTML = '<p class="small muted">This is a ' + esc(t.meta.role) + ' trace, plotted on a secondary axis without processing.</p>'; procBuiltFor = null; return; }
    var pr = t.proc, thrAuto = pr.peaks.threshold === 'auto' || !isNum(+pr.peaks.threshold);
    var xu = t.xUnit === 'mL' ? 'mL' : 'min', fitModel = P().settings.fitModel || 'gaussian';
    host.innerHTML =
      '<div class="proc-group"><div class="gh"><label class="inline"><input type="checkbox" data-p="smooth.on"' + (pr.smooth.on ? ' checked' : '') + '> Smoothing (Savitzky–Golay)</label></div>' +
      '<div class="grid2"><label class="field"><span>Window (points, odd)</span><input type="number" min="3" max="301" step="2" data-p="smooth.window" value="' + pr.smooth.window + '"></label>' +
      '<label class="field"><span>Polynomial order</span><input type="number" min="1" max="6" step="1" data-p="smooth.order" value="' + pr.smooth.order + '"></label></div></div>' +
      '<div class="proc-group"><div class="gh"><label class="inline"><input type="checkbox" data-p="baseline.on"' + (pr.baseline.on ? ' checked' : '') + '> Baseline correction (ALS)</label></div>' +
      '<label class="field"><span>Stiffness λ = <b id="lam-val">' + esc(fmt(pr.baseline.lambda, 2)) + '</b> <span id="lam-auto" class="badge"' + (pr.baseline.lambdaAuto ? '' : ' hidden') + ' title="λ = 1e8·(n/4000)⁴ for n points; move the slider to override">auto</span> <button type="button" class="btn ghost sm" data-pa="lamauto"' + (pr.baseline.lambdaAuto ? ' hidden' : '') + ' title="Return to the automatic λ for this point count">reset to auto</button></span><input type="range" min="1" max="10" step="0.1" data-p="baseline.lambdaLog" value="' + Math.log10(Math.max(pr.baseline.lambda, 1)).toFixed(1) + '" aria-label="Baseline stiffness lambda, log10"></label>' +
      '<div class="grid2"><label class="field"><span>Asymmetry p</span><input type="number" min="0.0001" max="0.5" step="0.001" data-p="baseline.p" value="' + pr.baseline.p + '"></label>' +
      '<label class="field"><span>Iterations</span><input type="number" min="1" max="50" step="1" data-p="baseline.iter" value="' + pr.baseline.iter + '"></label></div>' +
      '<label class="inline"><input type="checkbox" data-s="showRaw"' + (P().settings.showRaw ? ' checked' : '') + '> Show raw signal &amp; baseline</label></div>' +
      '<div class="proc-group"><div class="gh">Peak detection <label class="inline" title="Re-detect peaks whenever processing changes. Turns off when you edit peaks by hand."><input type="checkbox" data-p="peaks.auto"' + (pr.peaks.auto ? ' checked' : '') + '> auto</label></div>' +
      '<div class="grid2"><label class="field"><span>Threshold (' + esc(t.yUnit) + ')</span><span class="row" style="gap:4px"><input type="number" step="any" data-p="peaks.thresholdNum" value="' + (thrAuto ? '' : pr.peaks.threshold) + '"' + (thrAuto ? ' placeholder="auto" ' : '') + ' style="width:80px" aria-label="Peak height threshold">' +
      '<label class="inline"><input type="checkbox" data-p="peaks.thresholdAuto"' + (thrAuto ? ' checked' : '') + '> auto</label></span></label>' +
      '<label class="field"><span>Min distance (' + xu + ')</span><input type="number" min="0" step="0.01" data-p="peaks.minDist" value="' + pr.peaks.minDist + '"></label>' +
      '<label class="field"><span>Min width (' + xu + ')</span><input type="number" min="0" step="0.005" data-p="peaks.minWidth" value="' + pr.peaks.minWidth + '"></label></div>' +
      '<div class="row"><button class="btn sm primary" data-pa="detect" title="Detect peaks; manually set peaks are kept">Detect peaks</button><button class="btn sm" data-pa="clearmanual" title="Discard manual edits and detect from scratch">Re-detect all</button><button class="btn sm" data-pa="clear">Clear peaks</button></div></div>' +
      '<div class="proc-group"><div class="gh">Peak fitting (deconvolution)</div>' +
      '<div class="row"><select data-s="fitModel" aria-label="Peak model"><option value="gaussian"' + (fitModel === 'gaussian' ? ' selected' : '') + '>Gaussian</option><option value="emg"' + (fitModel === 'emg' ? ' selected' : '') + '>EMG (tailing)</option></select>' +
      '<button class="btn sm" data-pa="fit">Fit peaks</button><button class="btn sm ghost" data-pa="clearfit">Clear fit</button></div>' +
      '<div id="fit-status" class="small muted" style="margin-top:6px"></div></div>' +
      '<div id="proc-status" class="small muted" style="margin-top:8px"></div>';
    procBuiltFor = t.id; updateProcStatus();
  }
  function updateProcStatus() {
    var t = activeTrace(), st = $('proc-status'), fs = $('fit-status'); if (!t || !st) return;
    var nz = noiseOf(t);
    st.innerHTML = t.peaks.length + ' peak' + (t.peaks.length === 1 ? '' : 's') + (t.proc.peaks.auto ? ' (auto)' : ' (manual edits kept)') +
      (isNum(nz.sigma) ? ' · noise σ ≈ ' + esc(fmt(nz.sigma, 3)) + ' ' + esc(t.yUnit) : '') + (an('process') ? '' : ' · <span style="color:var(--warn)">analysis module missing, raw data shown</span>');
    if (fs) fs.innerHTML = t.fit ? (esc(t.fit.model === 'emg' ? 'EMG' : 'Gaussian') + ' fit: R² = ' + esc(fmt(t.fit.r2, 5)) + (t.fit.converged === false ? ' · <span style="color:var(--warn)">did not fully converge</span>' : '') + ' · ' + (t.fit.components || []).length + ' components') : 'No fit. Fitting models overlapping peaks jointly and reports area ± standard error.';
  }
  var procTimer = null;
  function beginProcEdit(el) {
    if (state.procSession !== el) { app.pushUndo('Change processing'); state.procSession = el; }
    clearTimeout(procTimer); procTimer = setTimeout(function () { state.procSession = null; }, 1500);
  }
  var recompute = debounce(function () {
    var t = activeTrace(); if (!t) return;
    if (t.proc.peaks.auto) detectFor(t, true); else clearFit(t);
    renderPlot(); renderTable(); updateProcStatus(); renderTraceListCounts();
  }, 140);
  function renderTraceListCounts() { renderTraceList(); }
  function applyProcInput(el) {
    var t = activeTrace(); if (!t) return;
    var path = el.getAttribute('data-p'), pr = t.proc, v = el.type === 'checkbox' ? el.checked : el.value;
    switch (path) {
      case 'smooth.on': pr.smooth.on = v; break;
      case 'smooth.window': { var w = Math.round(num(v, 11)); if (w < 3) w = 3; if (w % 2 === 0) w += 1; pr.smooth.window = w; if (pr.smooth.order >= w) pr.smooth.order = w - 1; break; }
      case 'smooth.order': pr.smooth.order = U.clamp(Math.round(num(v, 3)), 0, 10); if (pr.smooth.order >= pr.smooth.window) pr.smooth.window = pr.smooth.order + (pr.smooth.order % 2 ? 2 : 1); break;
      case 'baseline.on': pr.baseline.on = v; break;
      case 'baseline.lambdaLog': { pr.baseline.lambda = Number(Math.pow(10, num(v, 5)).toPrecision(3)); pr.baseline.lambdaAuto = false; var l = $('lam-val'); if (l) l.textContent = fmt(pr.baseline.lambda, 2);
        var la = $('lam-auto'); if (la) la.hidden = true; var lr = $('proc-body').querySelector('[data-pa="lamauto"]'); if (lr) lr.hidden = false; break; }
      case 'baseline.p': pr.baseline.p = U.clamp(num(v, 0.01), 1e-5, 0.5); break;
      case 'baseline.iter': pr.baseline.iter = U.clamp(Math.round(num(v, 10)), 1, 100); break;
      case 'peaks.auto': pr.peaks.auto = v; break;
      case 'peaks.thresholdAuto': {
        var ni = el.closest('.field').querySelector('[data-p="peaks.thresholdNum"]');
        if (v) { pr.peaks.threshold = 'auto'; if (ni) { ni.value = ''; ni.placeholder = 'auto'; } }
        else { var nz = noiseOf(t), guess = isNum(nz.sigma) ? Number((10 * nz.sigma).toPrecision(2)) : 0; pr.peaks.threshold = num(ni && ni.value, guess); if (ni) ni.value = pr.peaks.threshold; }
        pr.peaks.auto = true; break;
      }
      case 'peaks.thresholdNum': { if (v === '') { pr.peaks.threshold = 'auto'; } else { pr.peaks.threshold = num(v, 0); var cb = el.closest('.field').querySelector('[data-p="peaks.thresholdAuto"]'); if (cb) cb.checked = false; } pr.peaks.auto = true; break; }
      case 'peaks.minDist': pr.peaks.minDist = Math.max(0, num(v, 0.05)); pr.peaks.auto = true; break;
      case 'peaks.minWidth': pr.peaks.minWidth = Math.max(0, num(v, 0.01)); pr.peaks.auto = true; break;
    }
    var autoCb = $('proc-body').querySelector('[data-p="peaks.auto"]'); if (autoCb) autoCb.checked = !!pr.peaks.auto;
  }
  function bindProc() {
    var host = $('proc-body');
    function onEdit(e) {
      var el = e.target;
      if (el.hasAttribute('data-p')) { beginProcEdit(el); applyProcInput(el); recompute(); }
    }
    host.addEventListener('input', function (e) { if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') onEdit(e); });
    host.addEventListener('change', function (e) {
      var el = e.target;
      if (el.type === 'checkbox' || el.tagName === 'SELECT') {
        if (el.hasAttribute('data-p')) onEdit(e);
        var s = el.getAttribute('data-s');
        if (s === 'showRaw') { P().settings.showRaw = el.checked; renderPlot(); }
        if (s === 'fitModel') { P().settings.fitModel = el.value; }
      }
      state.procSession = null;
    });
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pa]'); if (!b) return; var a = b.getAttribute('data-pa'), t = activeTrace(); if (!t) return;
      if (a === 'detect') detectPeaksCmd();
      else if (a === 'clearmanual') { app.pushUndo('Re-detect all peaks'); t.peaks = []; t.proc.peaks.auto = true; detectFor(t); renderAll(); }
      else if (a === 'clear') { if (!t.peaks.length) return; app.pushUndo('Clear peaks'); t.peaks = []; t.proc.peaks.auto = false; clearFit(t); state.selPeakId = null; renderAll(); }
      else if (a === 'fit') fitPeaksCmd();
      else if (a === 'lamauto') { app.pushUndo('Auto baseline λ'); t.proc.baseline.lambdaAuto = true; t.proc.baseline.lambda = autoLambda(t.x.length); renderProc(); recompute(); }
      else if (a === 'clearfit') { if (t.fit) { app.pushUndo('Clear fit'); clearFit(t); renderAll(); } }
    });
  }
  function detectPeaksCmd() {
    var t = activeTrace(); if (!t || isAux(t)) { toast('Select a chromatogram trace first.', 'warn'); return; }
    app.pushUndo('Detect peaks'); t.proc.peaks.auto = true;
    if (detectFor(t)) { renderAll(); toast(t.peaks.length + ' peak' + (t.peaks.length === 1 ? '' : 's') + ' detected on "' + t.name + '"', t.peaks.length ? 'ok' : 'warn'); }
    else { state.undo.pop(); updateUndoButtons(); }
  }
  function fitPeaksCmd() {
    var t = activeTrace(); if (!t || !t.peaks.length) { toast('Detect or add peaks before fitting.', 'warn'); return; }
    var f = an('fitPeaks'); if (!f) { toast('Peak fitting is unavailable (analysis module not loaded).', 'error'); return; }
    var model = P().settings.fitModel || 'gaussian', pr = processed(t);
    if (t.peaks.length > 40) toast('Fitting ' + t.peaks.length + ' peaks jointly can take a few seconds…', 'info');
    setTimeout(function () {
      var res;
      try { res = f(pr.x, pr.y, t.peaks, { model: model, maxIter: 200 }); }
      catch (e) { console.error(e); toast('Fit failed: ' + e.message, 'error'); return; }
      if (!res || !res.components) { toast('Fit returned no result.', 'error'); return; }
      app.pushUndo('Fit peaks');
      t.fit = { model: model, components: res.components, curve: res.curve || null, r2: res.r2, rss: res.rss, dof: res.dof, converged: res.converged, peakIds: t.peaks.map(function (p) { return p.id; }) };
      renderAll(); toast('Fitted ' + res.components.length + ' ' + (model === 'emg' ? 'EMG' : 'Gaussian') + ' components, R² = ' + fmt(res.r2, 5), res.converged === false ? 'warn' : 'ok');
    }, 20);
  }

  /* ---------------- overlay panel */
  function renderOverlay() {
    var host = $('overlay-body'); if (!host) return;
    var p = P(), s = p.settings, mains = p.traces.filter(function (t) { return !isAux(t); });
    function opts(sel) { return mains.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join(''); }
    var dA = (s.differenceOf && s.differenceOf[0]) || (mains[0] && mains[0].id), dB = (s.differenceOf && s.differenceOf[1]) || (mains[1] && mains[1].id);
    host.innerHTML =
      '<label class="field"><span>Normalization</span><select id="ov-norm"><option value="none">None (native units)</option><option value="max">Max = 1</option><option value="area">Area = 1</option></select></label>' +
      '<div class="field"><span>Align retention times to a reference</span><div class="row"><select id="ov-ref" aria-label="Reference trace" style="flex:1;min-width:0">' + opts(s.alignRef || p.activeTraceId) + '</select></div>' +
      '<div class="row" style="margin-top:4px"><button class="btn sm" id="ov-align"' + (mains.length < 2 ? ' disabled' : '') + '>Align to selected peak</button><button class="btn sm ghost" id="ov-reset">Reset offsets</button></div>' +
      '<span class="small muted">Select a peak on the reference trace (or its largest peak is used). Each other visible trace is shifted so its nearest peak lines up.</span></div>' +
      '<div class="field"><span>Difference trace</span><div class="row"><select id="ov-a" aria-label="Trace A" style="flex:1;min-width:0">' + opts(dA) + '</select><span>−</span><select id="ov-b" aria-label="Trace B" style="flex:1;min-width:0">' + opts(dB) + '</select></div>' +
      '<div class="row" style="margin-top:4px"><button class="btn sm" id="ov-diff"' + (mains.length < 2 ? ' disabled' : '') + '>Create A − B</button></div></div>';
    $('ov-norm').value = s.normalization || 'none';
  }
  function bindOverlay() {
    var host = $('overlay-body');
    host.addEventListener('change', function (e) {
      if (e.target.id === 'ov-norm') { app.pushUndo('Change normalization'); P().settings.normalization = e.target.value; renderAll(); }
      if (e.target.id === 'ov-ref') P().settings.alignRef = e.target.value;
    });
    host.addEventListener('click', function (e) {
      var id = e.target.id;
      if (id === 'ov-align') alignTraces($('ov-ref').value);
      else if (id === 'ov-reset') { app.pushUndo('Reset offsets'); P().traces.forEach(function (t) { t.style.offset = 0; }); renderAll(); }
      else if (id === 'ov-diff') makeDifference($('ov-a').value, $('ov-b').value);
    });
  }
  function alignTraces(refId) {
    var ref = traceById(refId); if (!ref) return;
    if (!ref.peaks.length) { toast('The reference trace has no peaks. Detect peaks on it first.', 'warn'); return; }
    var pk = null;
    if (P().activeTraceId === ref.id && state.selPeakId) pk = ref.peaks.filter(function (p) { return p.id === state.selPeakId; })[0];
    if (!pk) { var ms = metricsFor(ref), best = -Infinity; ref.peaks.forEach(function (p, i) { var h = ms[i] && ms[i].height; if (isNum(h) && h > best) { best = h; pk = p; } }); pk = pk || ref.peaks[0]; }
    var target = pk.apex + num(ref.style.offset, 0), moved = 0, skipped = [];
    app.pushUndo('Align traces');
    P().settings.alignRef = ref.id;
    P().traces.forEach(function (t) {
      if (t.id === ref.id || isAux(t) || t.style.visible === false) return;
      if (t.xUnit !== ref.xUnit) { skipped.push(t.name); return; }
      if (!t.peaks.length) { skipped.push(t.name); return; }
      var near = t.peaks.reduce(function (a, b) { return Math.abs(b.apex - target) < Math.abs(a.apex - target) ? b : a; });
      t.style.offset = Number((target - near.apex).toFixed(6)); moved++;
    });
    renderAll();
    toast('Aligned ' + moved + ' trace' + (moved === 1 ? '' : 's') + ' to ' + fmt(target, 4) + ' ' + ref.xUnit + (skipped.length ? '. Skipped (no peaks or different x unit): ' + skipped.join(', ') : ''), skipped.length ? 'warn' : 'ok');
  }
  function makeDifference(aId, bId) {
    var A = traceById(aId), B = traceById(bId);
    if (!A || !B || A === B) { toast('Choose two different traces for A − B.', 'warn'); return; }
    if (A.xUnit !== B.xUnit) { toast('A and B must use the same x unit (both minutes or both mL).', 'error'); return; }
    var res = null, f = an('difference');
    if (f) { try { res = f(A, B); } catch (e) { console.error(e); } }
    var x, y;
    if (res && Array.isArray(res.y) && res.x) { x = toArr(res.x); y = toArr(res.y); }
    else if (res && (Array.isArray(res) || ArrayBuffer.isView(res)) && res.length === A.x.length) { x = A.x.slice(); y = toArr(res); }
    else { x = A.x.slice(); y = A.x.map(function (xv, i) { return A.y[i] - interp(B.x, B.y, xv); }); }
    if (A.yUnit !== B.yUnit) toast('Note: A is in ' + A.yUnit + ' and B is in ' + B.yUnit + '. The difference uses raw values.', 'warn');
    P().settings.differenceOf = [aId, bId];
    app.addTraces([{ name: A.name + ' − ' + B.name, x: x, y: y, xUnit: A.xUnit, yUnit: A.yUnit, source: { kind: 'derived', format: 'difference' },
      derived: { op: 'difference', of: [aId, bId] }, meta: { derived: true, note: 'B resampled onto A’s x grid (linear interpolation), then subtracted' },
      proc: clone(A.proc) }], { label: 'Create difference trace' });
  }

  /* ---------------- notices, empty state, plot tools */
  function renderNotices() {
    var host = $('plot-notices'); if (!host) return;
    var p = P(), html = [], ml = p.traces.filter(function (t) { return t.xUnit === 'mL'; }), cv = p.traces.filter(function (t) { return t.xUnit !== 'min' && t.xUnit !== 'mL'; });
    if (ml.length) {
      var fl = methodFlow(p.method);
      html.push('<div class="note warn">' + ml.length + ' trace' + (ml.length > 1 ? 's use' : ' uses') + ' elution volume (mL) on the x axis' +
        (p.traces.length > ml.length ? '. Traces in other units are drawn on a separate top axis' : '') + '. ' +
        (fl ? '<button class="btn sm" data-notice="convert-ml">Convert to minutes (÷ ' + esc(fmt(fl, 4)) + ' mL/min)</button>' : 'Set the flow rate under Method to convert to minutes. <button class="btn sm" data-action="method">Open Method</button>') + '</div>');
    }
    if (cv.length) html.push('<div class="note warn">' + cv.length + ' trace' + (cv.length > 1 ? 's use' : ' uses') + ' ' + esc(cv[0].xUnit) + ' on the x axis. %B at elution and k′ need time and are left blank.</div>');
    var miss = [];
    if (!PK.parsers) miss.push('file parsers');
    if (!PK.analysis) miss.push('analysis');
    if (!PK.digitizer) miss.push('image digitizer');
    if (miss.length) html.push('<div class="note error">Some Peakly modules failed to load (' + miss.join(', ') + '). Related features are disabled.</div>');
    host.innerHTML = html.join('');
  }
  function convertVolumeTraces() {
    var fl = methodFlow(P().method); if (!fl) return;
    app.pushUndo('Convert mL to minutes');
    P().traces.forEach(function (t) {
      if (t.xUnit !== 'mL') return;
      t.x = t.x.map(function (v) { return v / fl; });
      t.peaks.forEach(function (p) { p.start /= fl; p.apex /= fl; p.end /= fl; });
      if (t.digitized && isNum(t.digitized.dxMin)) t.digitized.dxMin /= fl;
      t.style.offset = num(t.style.offset, 0) / fl; t.fit = null;
      t.xUnit = 'min'; t.meta.xIsVolume = false; t.meta.convertedFromVolume = { flow_mL_min: fl };
    });
    state.cache = {}; renderAll(); toast('Converted volume to time using ' + fmt(fl, 4) + ' mL/min', 'ok');
  }
  function formatsList() {
    var L = [];
    try { if (PK.parsers && PK.parsers.list) L = PK.parsers.list() || []; } catch (e) { L = []; }
    L = L.filter(function (f) { return !/unsupported/i.test(f.name || '') && !/unsupported/i.test(f.id || ''); });
    var html = L.map(function (f) { var ex = (f.extensions || []).map(function (e) { return '.' + e; }).join(' '); return '<span class="badge" title="' + esc(ex) + '">' + esc(f.name || f.id) + '</span>'; });
    html.push('<span class="badge" title=".png .jpg .webp .gif .bmp .pdf">Images &amp; PDF → digitizer</span>');
    html.push('<span class="badge" title=".peakly.json">Peakly project</span>');
    return html.join(' ');
  }
  function renderEmpty() {
    var host = $('empty-state'); if (!host) return;
    if (!isEmpty()) { host.hidden = true; return; }
    host.hidden = false;
    if (host.getAttribute('data-built')) return;
    host.setAttribute('data-built', '1');
    host.innerHTML = '<div class="dropzone" id="dropzone">' +
      '<h1>Analyze an HPLC/FPLC chromatogram</h1>' +
      '<p class="muted">Drop instrument exports or chromatogram images anywhere on this page, or choose files. Everything runs in your browser. Nothing is uploaded.</p>' +
      '<div class="row"><button class="btn primary" data-action="open-files">Choose files…</button><button class="btn" data-action="paste">Paste data</button><button class="btn" data-action="image">Digitize an image</button></div>' +
      '<div class="row"><span class="small muted">Or try a sample:</span><button class="btn sm" data-action="sample">HPLC run + blank</button><button class="btn sm" data-action="sample-fplc">FPLC / IMAC run</button><button class="btn sm" data-action="sample-image">Chromatogram image</button></div>' +
      '<div class="formats">' + formatsList() + '</div>' +
      '<p class="small muted" style="margin-top:12px">File not recognized? <a href="#" data-action="fallback">Map the columns manually</a>.</p></div>';
  }
  function renderPlotTools() {
    var s = P().settings, cg = $('chk-gradient'), am = $('btn-addmode'), gt = $('ghost-tools');
    if (cg) { cg.checked = s.showGradient !== false; cg.disabled = !hasGradient(P().method); cg.parentNode.title = hasGradient(P().method) ? 'Show the method gradient on a secondary axis (shifted by dwell time)' : 'Define a gradient under Method to show it'; }
    if (am) { am.setAttribute('aria-pressed', String(!!state.addMode)); }
    var pl = $('plot'); if (pl) pl.classList.toggle('add-mode', !!state.addMode);
    var anyGhost = P().traces.some(function (t) { return t.digitized && ghostExtent(t) && P().images[t.digitized.imageId]; });
    if (gt) { gt.classList.toggle('hidden', !anyGhost); $('chk-ghost').checked = s.ghost.show !== false; $('rng-ghost').value = s.ghost.opacity; }
    renderPlotToolsExtra();
  }

  /* ---------------- plot */
  function normFactor(t, pr) {
    var mode = P().settings.normalization;
    if (isAux(t) || !mode || mode === 'none') return 1;
    var y = pr.y, x = pr.x;
    if (mode === 'max') { var m = 0; for (var i = 0; i < y.length; i++) if (Math.abs(y[i]) > m) m = Math.abs(y[i]); return m > 0 ? 1 / m : 1; }
    if (mode === 'area') { var a = 0; for (var j = 0; j < y.length - 1; j++) a += (x[j + 1] - x[j]) * (Math.abs(y[j]) + Math.abs(y[j + 1])) / 2; return a > 0 ? 1 / a : 1; }
    return 1;
  }
  function axisLayout() {
    var vis = P().traces.filter(function (t) { return t.style.visible !== false; });
    var mains = vis.filter(function (t) { return !isAux(t); }), ref = mains.length ? mains : vis;
    var mainUnit = ref.length && ref.every(function (t) { return t.xUnit === ref[0].xUnit; }) ? ref[0].xUnit : 'min';
    if (ref.length && ref.every(function (t) { return t.xUnit !== 'min'; }) && !ref.every(function (t) { return t.xUnit === mainUnit; })) mainUnit = ref[0].xUnit;
    return { vis: vis, mains: mains, mainUnit: mainUnit, xa: function (t) { return t.xUnit === mainUnit ? 'x' : 'x2'; } };
  }
  function unitTitle(u) { return u === 'min' ? 'Retention time (min)' : u === 'mL' ? 'Elution volume (mL)' : u === 'CV' ? 'Column volumes (CV)' : String(u);
  }
  /** Vertical waterfall offsets for visible main traces (settings.stack = fraction of max |y|). */
  function stackOffsets(AX) {
    var s = num(P().settings.stack, 0), out = {}; if (!s) return out;
    var mx = 0;
    AX.mains.forEach(function (t) { var pr = processed(t), k = normFactor(t, pr); for (var i = 0; i < pr.y.length; i++) { var v = Math.abs(pr.y[i] * k); if (v > mx) mx = v; } });
    AX.mains.forEach(function (t, i) { out[t.id] = i * s * mx; });
    return out;
  }
  /** What is drawn for a trace: display x (with RT offset) and y (normalized + stacked) plus axis ids. */
  function displaySeries(t, AX, stk) {
    var pr = processed(t), k = normFactor(t, pr), off = num(t.style.offset, 0), dy = (stk && stk[t.id]) || 0, role = t.meta && t.meta.role;
    return { t: t, pr: pr, k: k, off: off, dy: dy,
      x: off ? pr.x.map(function (v) { return v + off; }) : pr.x,
      y: (k === 1 && !dy) ? pr.y : pr.y.map(function (v) { return v * k + dy; }),
      xa: AX.xa(t), ya: !isAux(t) ? 'y' : role === 'gradient' ? 'y2' : 'y3' };
  }
  /** Publication look: white plot, black axes, light-gray grid (optional dark plot in-app only). */
  function plotColors(forExport) {
    var dark = !forExport && P().settings.darkPlot;
    return dark ? { panel: '#111827', text: '#e5e7eb', axis: '#e5e7eb', grid: '#374151', muted: '#9ca3af', accent: '#60a5fa', grad: '#d1d5db', legendBg: '#111827', legendBorder: '#e5e7eb', border: '#4b5563', accent2: '#d1d5db' }
      : { panel: '#ffffff', text: '#000000', axis: '#000000', grid: '#e5e5e5', muted: '#666666', accent: '#1f4fd8', grad: '#444444', legendBg: '#ffffff', legendBorder: '#000000', border: '#999999', accent2: '#444444' };
  }
  app.plotColors = plotColors;
  function imgDims(id) {
    var c = state.imgDims || (state.imgDims = {});
    if (c[id]) return c[id].w ? c[id] : null;
    var src = P().images[id]; if (!src || !HAS_DOM || typeof Image === 'undefined') return null;
    c[id] = {}; var im = new Image();
    im.onload = function () { c[id] = { w: im.naturalWidth, h: im.naturalHeight }; renderPlot(); renderPlotTools(); };
    im.src = src; return null;
  }
  /** Data-space extent of the stored source image: explicit digitized.extent, else derived from the linear 2-point calibration. */
  function ghostExtent(t) {
    var d = t.digitized; if (!d) return null;
    var e = d.extent || d.imageExtent || (t.meta && t.meta.imageExtent);
    if (e && !e.xLog && !e.yLog) {
      var x0 = first(e.x0, e.xMin, e.left), x1 = first(e.x1, e.xMax, e.right), y0 = first(e.y0, e.yMin, e.bottom), y1 = first(e.y1, e.yMax, e.top);
      if ([x0, x1, y0, y1].every(isNum) && x1 !== x0 && y1 !== y0) return { x0: x0, x1: x1, y0: y0, y1: y1 };
    }
    var c = t.meta && t.meta.digitize && t.meta.digitize.calibration;
    if (!c || c.xLog || c.yLog || !c.x1 || !c.x2 || !c.y1 || !c.y2) return null;
    var dims = imgDims(d.imageId); if (!dims) return null;
    function lin(p1, p2, px) { return +p1.val + (px - p1.px) * (p2.val - p1.val) / ((p2.px - p1.px) || 1); }
    var xs = c.xUnit === 'sec' ? 1 / 60 : 1;
    var ex = { x0: lin(c.x1, c.x2, 0) * xs, x1: lin(c.x1, c.x2, dims.w) * xs, y1: lin(c.y1, c.y2, 0), y0: lin(c.y1, c.y2, dims.h) };
    return [ex.x0, ex.x1, ex.y0, ex.y1].every(isNum) && ex.x1 !== ex.x0 && ex.y1 !== ex.y0 ? ex : null;
  }
  function gradientSummary(m) {
    var r = sortedRows(m); if (!r.length) return '';
    var ci = concInfo(m);
    function v(B) { return ci ? fmt(B * ci.k, 3) : fmt(B, 3); }
    var unit = ci ? ' ' + ci.unit + ' ' + ci.label.toLowerCase() : '% B';
    if (m.gradientType === 'isocratic' || r.length === 1 || r.every(function (q) { return q.B === r[0].B; })) return 'isocratic ' + v(r[0].B) + unit;
    var best = null;
    for (var i = 0; i < r.length - 1; i++) { var dB = r[i + 1].B - r[i].B; if (r[i + 1].t > r[i].t && dB !== 0 && (!best || Math.abs(dB) > Math.abs(best.b.B - best.a.B))) best = { a: r[i], b: r[i + 1] }; }
    if (!best) return 'step gradient';
    return v(best.a.B) + '→' + v(best.b.B) + unit + ' in ' + fmt(best.b.t - best.a.t, 3) + ' min';
  }
  app.gradientSummary = gradientSummary;
  function captionText() {
    var m = P().method, c = m.column || {}, parts = [];
    if (m.name) parts.push(m.name);
    var col = [c.name, (num(c.length_mm, 0) > 0 && num(c.id_mm, 0) > 0) ? fmt(c.length_mm, 4) + '×' + fmt(c.id_mm, 3) + ' mm' : '', num(c.particle_um, 0) > 0 ? fmt(c.particle_um, 3) + ' µm' : ''].filter(Boolean).join(' ');
    if (col) parts.push(col);
    var fl = methodFlow(m); if (fl) parts.push(fmt(fl, 4) + ' mL/min');
    var gs = gradientSummary(m); if (gs) parts.push(gs);
    if (num(m.wavelength_nm, 0) > 0) parts.push(fmt(m.wavelength_nm, 4) + ' nm');
    if (isNum(+m.temperature_C) && m.temperature_C !== null && m.temperature_C !== '') parts.push(fmt(+m.temperature_C, 3) + ' °C');
    return parts.join(' · ');
  }
  app.captionText = captionText;
  function peakLabelText(pk, m, mode) {
    var rt = fmt(m && isNum(m.rt) ? m.rt : pk.apex, 4);
    switch (mode) {
      case 'none': return '';
      case 'name': return pk.label || '';
      case 'rt': return rt;
      case 'name+rt': return pk.label ? pk.label + ' (' + rt + ')' : rt;
      case 'area': return m && isNum(m.areaPct) ? fmt(m.areaPct, 3) + ' %' : '';
      default: return pk.label || rt;
    }
  }
  function isDefaultTitle(n) { return !n || n === 'Untitled project'; }
  /** Build the Plotly figure. opts: {includeGradient, includeGhost, export, width, height} */
  function buildFigure(opts) {
    opts = opts || {};
    var p = P(), s = p.settings, col = plotColors(opts.export), act = activeTrace(), AX = axisLayout();
    var data = [], shapes = [], images = [], annotations = [], annMap = [], hasX2 = false, hasY2 = false, hasY3 = false, xMaxMin = 0, yUnits = {}, y3Title = [];
    var stk = stackOffsets(AX), disp = {};
    if (!opts.export) { state.disp = disp; state.annMap = annMap; }
    var font = 'Arial, Helvetica, sans-serif';
    AX.vis.forEach(function (t) {
      var ds = displaySeries(t, AX, stk), pr = ds.pr, aux = isAux(t), k = ds.k, off = ds.off, dy = ds.dy;
      var xs = ds.x, ys = ds.y, xa = ds.xa, ya = ds.ya; disp[t.id] = ds;
      if (xa === 'x2') hasX2 = true; if (ya === 'y2') hasY2 = true;
      if (ya === 'y3') { hasY3 = true; var lb = (t.meta.role === 'pH' ? 'pH' : (t.meta.role.charAt(0).toUpperCase() + t.meta.role.slice(1) + ' (' + t.yUnit + ')')); if (y3Title.indexOf(lb) < 0) y3Title.push(lb); }
      if (ya === 'y') yUnits[t.yUnit] = 1;
      var isAct = act && t.id === act.id;
      var tm = xToMin(t, pr.x[pr.x.length - 1] + off); if (isNum(tm) && tm > xMaxMin) xMaxMin = tm;
      data.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, xaxis: xa, yaxis: ya, name: t.name + (t.digitized ? ' (digitized)' : ''),
        line: { color: t.style.color, width: (t.style.width || 1.5) + (isAct && AX.mains.length > 1 && !opts.export ? 0.5 : 0), dash: (t.derived || (t.meta && t.meta.derived)) ? 'dot' : aux ? 'dash' : 'solid' },
        hovertemplate: '%{y:.4~g} ' + esc(k === 1 ? t.yUnit : 'norm.') + '<extra>' + esc(t.name).slice(0, 30) + '</extra>', _pkId: t.id, _pkOff: off });
      if (isAct && !aux && s.showRaw && pr.baseline && !opts.export) {
        data.push({ type: 'scatter', mode: 'lines', x: xs, y: pr.yRaw.map(function (v) { return v * k + dy; }), xaxis: xa, yaxis: ya, name: 'Raw', line: { color: col.muted, width: 1, dash: 'dot' }, hoverinfo: 'skip' });
        data.push({ type: 'scatter', mode: 'lines', x: xs, y: pr.baseline.map(function (v) { return v * k + dy; }), xaxis: xa, yaxis: ya, name: 'Baseline', line: { color: col.grad, width: 1.2, dash: 'dash' }, hoverinfo: 'skip' });
      }
      var ext = ghostExtent(t), img = t.digitized && p.images[t.digitized.imageId];
      if (opts.includeGhost && ext && img && k === 1 && !dy && !aux) {
        images.push({ source: img, xref: xa, yref: 'y', x: ext.x0 + off, y: ext.y1, sizex: ext.x1 - ext.x0, sizey: ext.y1 - ext.y0, sizing: 'stretch', xanchor: 'left', yanchor: 'top', layer: 'below', opacity: num(s.ghost.opacity, 0.35) });
      }
      // instrument events (fractions, injection marks)
      var evs = s.showEvents !== false && toArr(t.meta && t.meta.events);
      if (evs && evs.length) {
        evs.forEach(function (ev) {
          if (!isNum(+ev.x)) return; var ex = +ev.x + off;
          shapes.push({ type: 'line', name: 'ev', xref: xa, yref: 'paper', x0: ex, x1: ex, y0: 0, y1: 0.035, line: { color: col.muted, width: 1 } });
          if (evs.length <= 60 && ev.label) annotations.push({ xref: xa, yref: 'paper', x: ex, y: 0.04, text: esc(String(ev.label)).slice(0, 16), showarrow: false, textangle: -90, xanchor: 'center', yanchor: 'bottom', font: { size: 8, color: col.muted } });
        });
      }
    });
    // peaks: shading for active trace; labels for active (or all visible) traces
    var labelTraces = [];
    if (act && act.style.visible !== false && !isAux(act) && act.peaks.length) {
      var dsa = disp[act.id], pr = dsa.pr, k = dsa.k, off = dsa.off, dy = dsa.dy, xa = dsa.xa, mx = [], my = [], mid = [], msz = [];
      act.peaks.forEach(function (pk) {
        var sel = pk.id === state.selPeakId, i0 = lowerIdx(pr.x, pk.start), i1 = lowerIdx(pr.x, pk.end), px = [pk.start + off], py = [interp(pr.x, pr.y, pk.start) * k + dy];
        for (var j = i0; j < i1 && j < pr.x.length; j++) if (pr.x[j] > pk.start) { px.push(pr.x[j] + off); py.push(pr.y[j] * k + dy); }
        px.push(pk.end + off); py.push(interp(pr.x, pr.y, pk.end) * k + dy);
        data.push({ type: 'scatter', mode: 'lines', x: px, y: py, xaxis: xa, yaxis: 'y', fill: 'toself', fillcolor: hexA(act.style.color, sel ? 0.38 : 0.18),
          line: { width: sel ? 1.2 : 0.6, color: hexA(act.style.color, sel ? 0.9 : 0.45) }, hoverinfo: 'skip', showlegend: false, _pkPeak: pk.id });
        mx.push(pk.apex + off); my.push(interp(pr.x, pr.y, pk.apex) * k + dy); mid.push(pk.id); msz.push(sel ? 10 : 6);
        if (sel && !opts.export) {
          [['pk-start', pk.start], ['pk-end', pk.end]].forEach(function (b) {
            shapes.push({ type: 'line', name: b[0], xref: xa, yref: 'paper', x0: b[1] + off, x1: b[1] + off, y0: 0, y1: 1, line: { color: col.accent, width: 2.5, dash: 'dot' } });
          });
        }
      });
      if (!opts.export) data.push({ type: 'scatter', mode: 'markers', x: mx, y: my, xaxis: xa, yaxis: 'y', customdata: mid, marker: { size: msz, color: act.style.color, symbol: 'line-ew-open', line: { width: 2, color: act.style.color } }, name: 'Peaks', showlegend: false, hoverinfo: 'skip', _pkMarkers: true });
      if (act.fit && act.fit.curve && act.fit.curve.x && act.fit.curve.yFit) {
        var fx = toArr(act.fit.curve.x).map(function (v) { return v + off; });
        data.push({ type: 'scatter', mode: 'lines', x: fx, y: toArr(act.fit.curve.yFit).map(function (v) { return v * k + dy; }), xaxis: xa, yaxis: 'y', name: 'Fit (' + (act.fit.model === 'emg' ? 'EMG' : 'Gaussian') + ')', line: { color: col.text, width: 1.2, dash: 'dash' }, hoverinfo: 'skip' });
        toArr(act.fit.curve.perComponent).forEach(function (c, ci) {
          data.push({ type: 'scatter', mode: 'lines', x: fx, y: toArr(c).map(function (v) { return v * k + dy; }), xaxis: xa, yaxis: 'y', name: 'Component ' + (ci + 1), showlegend: false, line: { color: APP_PALETTE[(ci + 2) % APP_PALETTE.length], width: 1, dash: 'dot' }, hoverinfo: 'skip' });
        });
      }
      labelTraces.push(act);
    }
    if (s.labels && s.labels.all) AX.mains.forEach(function (t) { if (labelTraces.indexOf(t) < 0 && t.peaks.length) labelTraces.push(t); });
    var lmode = (s.labels && s.labels.mode) || 'auto', lsize = num(s.labels && s.labels.size, 10);
    if (lmode !== 'none') {
      var cands = [];
      labelTraces.forEach(function (t) {
        var ds = disp[t.id]; if (!ds) return; var ms = withAreaPct(metricsFor(t));
        t.peaks.forEach(function (pk, i) {
          var txt = peakLabelText(pk, ms[i], lmode); if (!txt) return;
          cands.push({ x: pk.apex + ds.off, y: interp(ds.pr.x, ds.pr.y, pk.apex) * ds.k + ds.dy, text: txt, xa: ds.xa, traceId: t.id, peakId: pk.id, color: t.style.color, own: !!pk.label });
        });
      });
      var gdEl = typeof document !== 'undefined' && document.getElementById('plot'), plotPxW = Math.max(200, ((opts.export && opts.width) || (gdEl && gdEl.clientWidth) || 900) - 140);
      var xr = state.viewRange || null, xlo = Infinity, xhi = -Infinity;
      cands.forEach(function (c) { if (c.x < xlo) xlo = c.x; if (c.x > xhi) xhi = c.x; });
      var span = xr ? Math.abs(xr[1] - xr[0]) : Math.max(xhi - xlo, 1e-9) * 1.1, lastAt = [];
      cands.sort(function (a, b) { return a.x - b.x; }).forEach(function (c) {
        // label width in data units: ~0.6·fontsize px per char over the plot's pixel width
        var need = span * (Math.max(3, Math.min(c.text.length, 18)) * lsize * 0.6 + 8) / plotPxW, lvl = 0;
        while (lvl < 5 && lastAt[lvl] != null && c.x - lastAt[lvl] < need) lvl++;
        if (lvl >= 5) lvl = 0; lastAt[lvl] = c.x;
        annMap[annotations.length] = { traceId: c.traceId, peakId: c.peakId, text: c.text };
        annotations.push({ xref: c.xa, yref: 'y', x: c.x, y: c.y, text: esc(c.text), showarrow: true, arrowhead: 0, arrowwidth: 0.7, arrowcolor: col.muted, ax: 0, ay: -(14 + lvl * (lsize + 7)),
          font: { size: lsize, color: labelTraces.length > 1 ? c.color : col.text }, bgcolor: 'rgba(0,0,0,0)', captureevents: true, hovertext: 'Click to rename this peak' });
      });
    }
    // cross-trace highlight (compare view row selection)
    (state.compareHl || []).forEach(function (h) {
      var t = traceById(h.traceId), ds = t && disp[t.id]; if (!ds || opts.export) return;
      var pk = t.peaks.filter(function (q) { return q.id === h.peakId; })[0]; if (!pk) return;
      shapes.push({ type: 'rect', name: 'cmp', xref: ds.xa, yref: 'paper', x0: pk.start + ds.off, x1: pk.end + ds.off, y0: 0, y1: 1, fillcolor: hexA(t.style.color, 0.10), line: { width: 1, color: hexA(t.style.color, 0.6), dash: 'dot' }, layer: 'below' });
      data.push({ type: 'scatter', mode: 'markers', x: [pk.apex + ds.off], y: [interp(ds.pr.x, ds.pr.y, pk.apex) * ds.k + ds.dy], xaxis: ds.xa, yaxis: ds.ya, marker: { size: 13, symbol: 'circle-open', color: t.style.color, line: { width: 2.5 } }, showlegend: false, hoverinfo: 'skip' });
    });
    // gradient on y2
    var m = p.method, ci = concInfo(m), gradTitle = ci ? ci.label + ' (' + ci.unit + ')' : '%B';
    if (opts.includeGradient && hasGradient(m) && AX.mainUnit !== 'CV') {
      var rows = sortedRows(m), tMax = Math.max(xMaxMin, rows[rows.length - 1].t + dwellTime(m), 1);
      var gc = gradientCurve(m, tMax, 500), gx = toArr(gc.t), gy = toArr(ci && gc.conc ? gc.conc : gc.B), fl = methodFlow(m), ok = true;
      if (ci && !gc.conc) gy = gy.map(function (v) { return v * ci.k; });
      if (AX.mainUnit === 'mL') { if (fl) gx = gx.map(function (v) { return v * fl; }); else ok = false; }
      if (ok) {
        hasY2 = true;
        data.push({ type: 'scatter', mode: 'lines', x: gx, y: gy, xaxis: 'x', yaxis: 'y2', name: 'Gradient ' + gradTitle, line: { color: col.grad, width: 1.3, dash: 'dash' }, hovertemplate: '%{y:.3~f} ' + esc(ci ? ci.unit : '%B') + '<extra>gradient</extra>' });
      }
    }
    var ys = Object.keys(yUnits), normLbl = { max: 'Normalized intensity (max = 1)', area: 'Normalized intensity (area = 1)' }[s.normalization];
    var named = data.filter(function (d) { return d.showlegend !== false && d.name && d.name !== 'Raw' && d.name !== 'Baseline'; }).length;
    var title = isDefaultTitle(p.name) ? '' : p.name, cap = s.caption !== false ? captionText() : '';
    var axisBase = { gridcolor: col.grid, showgrid: s.grid !== false, zeroline: false, linecolor: col.axis, linewidth: 1, tickcolor: col.axis, tickfont: { color: col.axis, size: 11 }, showline: true, ticks: 'outside', ticklen: 5, automargin: true, mirror: s.mirror ? 'ticks' : false, title: { font: { size: 12.5, color: col.axis } } };
    if (cap) annotations.push({ xref: 'paper', yref: 'paper', x: 0, y: 0, xanchor: 'left', yanchor: 'top', yshift: -62, showarrow: false, align: 'left', text: esc(cap), font: { size: 10.5, color: col.muted }, _pkCaption: true });
    var gdW = (opts.export && opts.width) || (typeof document !== 'undefined' && document.getElementById('plot') && document.getElementById('plot').clientWidth) || 900, narrow = gdW < 640;
    // phones: horizontal legend above the plot; estimate wrapped rows from item widths (~6 px/char + swatch)
    var legendRows = 1, rowW = 0;
    data.filter(function (d) { return d.showlegend !== false && d.name && d.name !== 'Raw' && d.name !== 'Baseline'; }).forEach(function (d) {
      var iw = String(d.name).length * 6 + 50; if (rowW + iw > gdW - 30 && rowW > 0) { legendRows++; rowW = iw; } else rowW += iw;
    });
    var layout = {
      paper_bgcolor: col.panel, plot_bgcolor: col.panel, font: { family: font, size: 12, color: col.text },
      title: narrow ? { text: esc(title), x: 0.02, xanchor: 'left', y: 0.985, yref: 'container', yanchor: 'top', font: { size: 13, color: col.text } } : { text: esc(title), x: 0.5, xanchor: 'center', font: { size: 15, color: col.text } },
      margin: { l: narrow ? 52 : 64, r: hasY3 ? 72 : hasY2 ? 52 : 18, t: ((title || !opts.export) ? 44 : 14) + (hasX2 ? 36 : 0) + (narrow && named > 1 ? 19 * legendRows + 6 : 0), b: 48 + (cap ? 30 : 0) },
      hovermode: (state.cursorOn && !opts.export) ? false : 'x unified', hoverlabel: { bgcolor: '#ffffff', bordercolor: '#999', font: { color: '#000', size: 11 } },
      dragmode: 'zoom', uirevision: 'pk' + (state.uirev || 0), showlegend: named > 1,
      legend: narrow ? { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', bgcolor: col.legendBg, bordercolor: col.legendBorder, borderwidth: 1, font: { size: 10, color: col.text } } : { x: hasY2 || hasY3 ? 0.98 : 0.995, xanchor: 'right', y: 0.99, yanchor: 'top', bgcolor: col.legendBg, bordercolor: col.legendBorder, borderwidth: 1, font: { size: 11, color: col.text } },
      xaxis: mergeDeep(clone(axisBase), { title: { text: unitTitle(AX.mainUnit) }, domain: [0, hasY3 ? 0.92 : 1], anchor: 'y' }),
      yaxis: mergeDeep(clone(axisBase), { showticklabels: !num(s.stack, 0), title: { text: (num(s.stack, 0) ? 'Stacked · ' : '') + (normLbl || (ys.length ? 'Absorbance (' + ys.join(', ') + ')' : 'Signal')) }, exponentformat: 'SI' }),
      shapes: shapes, images: images, annotations: annotations
    };
    if (ys.length && !/AU$/i.test(ys[0])) layout.yaxis.title.text = layout.yaxis.title.text.replace('Absorbance', 'Signal');
    if (opts.export) { layout.width = opts.width; layout.height = opts.height; }
    var xu2 = AX.vis.filter(function (t) { return t.xUnit !== AX.mainUnit; }).map(function (t) { return t.xUnit; })[0];
    if (hasX2) layout.xaxis2 = mergeDeep(clone(axisBase), { title: { text: unitTitle(xu2) }, overlaying: 'x', side: 'top', showgrid: false, anchor: 'y', mirror: false });
    if (hasY2) layout.yaxis2 = mergeDeep(clone(axisBase), { title: { text: gradTitle }, overlaying: 'y', side: 'right', showgrid: false, anchor: 'x', mirror: false, range: ci ? undefined : [-2, 105] });
    if (hasY3) layout.yaxis3 = mergeDeep(clone(axisBase), { title: { text: y3Title.join(' / ') }, overlaying: 'y', side: 'right', anchor: 'free', position: 1, showgrid: false, mirror: false });
    var config = { responsive: true, scrollZoom: true, displaylogo: false, edits: { shapePosition: true, annotationText: true, titleText: true }, doubleClickDelay: 300,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toggleSpikelines'], toImageButtonOptions: { format: 'png', filename: fileSafe(p.name), scale: 2 } };
    return { data: data, layout: layout, config: config };
  }
  app.buildFigure = buildFigure;

  var plotBound = false, plotTimer = null;
  function schedulePlot() { clearTimeout(plotTimer); plotTimer = setTimeout(renderPlot, 60); }
  function renderPlot() {
    var el = $('plot'); if (!el) return;
    if (typeof Plotly === 'undefined') {
      el.innerHTML = '<div class="plot-fallback"><div><strong>The plotting library did not load.</strong><br>Check your connection or content blocker, then reload. Import, analysis and the peak table still work.</div></div>';
      return;
    }
    var fig = buildFigure({ includeGradient: P().settings.showGradient !== false, includeGhost: P().settings.ghost.show !== false });
    try {
      var pr0 = Plotly.react(el, fig.data, fig.layout, fig.config);
      if (!plotBound) { bindPlotEvents(el); plotBound = true; }
      Promise.resolve(pr0).then(fitPlotSize);
    } catch (e) { console.error(e); toast('Plot error: ' + e.message, 'error'); }
  }
  /** Plotly.react keeps a stale autosize; resize when the container no longer matches. */
  function fitPlotSize() {
    var el = $('plot'); if (!el || !el._fullLayout || !el.clientHeight) return;
    if (Math.abs(el._fullLayout.height - el.clientHeight) > 2 || Math.abs(el._fullLayout.width - el.clientWidth) > 2) { try { Plotly.Plots.resize(el); } catch (e) { /* ignore */ } }
  }
  function bindPlotEvents(el) {
    el.on('plotly_relayout', onPlotRelayout);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(debounce(fitPlotSize, 60)).observe(el);
    }
    el.on('plotly_afterplot', function () { if (state.cursor.xDisp != null || state.integ) drawCursor(); });
    el.on('plotly_hover', function (ev) {
      var t = activeTrace(); if (state.cursorOn || !t || !ev || !ev.points || !ev.points.length) return;
      var pt = ev.points[0], xv = +pt.x - num(t.style.offset, 0), hit = null;
      t.peaks.forEach(function (p) { if (xv >= p.start && xv <= p.end) hit = p; });
      hoverRow(hit ? hit.id : null);
    });
    el.on('plotly_unhover', function () { hoverRow(null); });
  }
  function onShapeDrag() {
    var el = $('plot'), t = activeTrace(); if (!el || !t) return;
    var pk = t.peaks.filter(function (p) { return p.id === state.selPeakId; })[0]; if (!pk) return;
    var off = num(t.style.offset, 0), ns = pk.start, ne = pk.end;
    (el.layout.shapes || []).forEach(function (sh) {
      var xv = (num(sh.x0, NaN) + num(sh.x1, NaN)) / 2 - off;
      if (!isNum(xv)) return;
      if (sh.name === 'pk-start') ns = xv; else if (sh.name === 'pk-end') ne = xv;
    });
    if (ns === pk.start && ne === pk.end) return;
    var pr = processed(t), xmin = pr.x[0], xmax = pr.x[pr.x.length - 1];
    ns = U.clamp(ns, xmin, xmax); ne = U.clamp(ne, xmin, xmax);
    if (ne < ns) { var tmp = ns; ns = ne; ne = tmp; }
    if (ne - ns < (pr.x[1] - pr.x[0]) * 2) { toast('Integration window too narrow.', 'warn'); renderPlot(); return; }
    app.pushUndo('Move integration bounds');
    pk.start = ns; pk.end = ne; pk.manual = true;
    if (pk.apex < ns || pk.apex > ne) { var i0 = lowerIdx(pr.x, ns), i1 = lowerIdx(pr.x, ne), im = i0; for (var i = i0; i <= i1 && i < pr.x.length; i++) if (pr.y[i] > pr.y[im]) im = i; pk.apex = pr.x[im]; }
    t.proc.peaks.auto = false; clearFit(t);
    renderPlot(); renderTable(); updateProcStatus();
  }
  function addPeakAt(t, xv) {
    var pr = processed(t), n = pr.x.length; if (n < 5) return;
    var range = pr.x[n - 1] - pr.x[0], win = Math.max(range * 0.01, 3 * (pr.x[1] - pr.x[0])), pk = null, f = an('peakAt');
    if (f) { try { pk = f(pr.x, pr.y, xv, { window: win }); } catch (e) { console.error(e); pk = null; } }
    if (!pk || !isNum(pk.start) || !isNum(pk.end)) pk = peakAtLocal(pr.x, pr.y, xv, win);
    var dup = t.peaks.filter(function (p) { return Math.abs(p.apex - pk.apex) < (pr.x[1] - pr.x[0]) * 2; })[0];
    if (dup) { selectPeak(dup.id); toast('A peak already exists there. Selected it.', 'info'); return; }
    var np = { id: PK.uid('pk'), start: +pk.start, apex: isNum(pk.apex) ? +pk.apex : xv, end: +pk.end, manual: true };
    t.peaks.forEach(function (p) { // keep bounds from overlapping neighbours
      if (p.apex < np.apex && p.end > np.start) np.start = Math.min(np.apex, p.end);
      if (p.apex > np.apex && p.start < np.end) np.end = Math.max(np.apex, p.start);
    });
    app.pushUndo('Add peak');
    t.peaks.push(np); t.peaks.sort(function (a, b) { return a.apex - b.apex; });
    t.proc.peaks.auto = false; clearFit(t); state.selPeakId = np.id;
    renderPlot(); renderTable(); updateProcStatus(); renderTraceList();
    toast('Peak added at ' + fmt(np.apex, 4) + ' ' + t.xUnit + '. Drag the dotted lines to adjust its bounds.', 'ok');
  }
  function selectNearestPeak(t, xv) {
    var best = null, bd = Infinity, pr = processed(t), range = pr.x[pr.x.length - 1] - pr.x[0];
    t.peaks.forEach(function (p) { var d = (xv >= p.start && xv <= p.end) ? 0 : Math.abs(p.apex - xv); if (d < bd) { bd = d; best = p; } });
    if (best && bd < range * 0.02) selectPeak(best.id, { scroll: true });
    else if (state.selPeakId) { state.selPeakId = null; renderPlot(); renderTable(); }
  }
  function removePeak(id) {
    var t = activeTrace(); if (!t) return;
    var idx = -1; t.peaks.forEach(function (p, i) { if (p.id === id) idx = i; }); if (idx < 0) return;
    app.pushUndo('Remove peak');
    t.peaks.splice(idx, 1); t.proc.peaks.auto = false; clearFit(t);
    state.selPeakId = t.peaks.length ? t.peaks[Math.min(idx, t.peaks.length - 1)].id : null;
    renderPlot(); renderTable(); updateProcStatus(); renderTraceList();
  }
  function selectPeak(id, o) {
    o = o || {}; var t = activeTrace(); if (!t) return;
    var pk = t.peaks.filter(function (p) { return p.id === id; })[0]; if (!pk) return;
    state.selPeakId = id; renderPlot(); renderTable();
    if (o.scroll) { var row = document.querySelector('#peak-table tr[data-id="' + cssEsc(id) + '"]'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' }); }
    if (o.zoom) zoomToPeak(t, pk);
  }
  function cssEsc(s) { return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function zoomToPeak(t, pk) {
    var el = $('plot'); if (!el || typeof Plotly === 'undefined' || !el.layout) return;
    var pr = processed(t), k = normFactor(t, pr), off = num(t.style.offset, 0), w = Math.max(pk.end - pk.start, (pr.x[1] - pr.x[0]) * 10);
    var a = pk.start - 1.5 * w, b = pk.end + 1.5 * w, i0 = lowerIdx(pr.x, a), i1 = Math.min(lowerIdx(pr.x, b), pr.x.length - 1), lo = Infinity, hi = -Infinity;
    for (var i = i0; i <= i1; i++) { var v = pr.y[i] * k; if (v < lo) lo = v; if (v > hi) hi = v; }
    var pad = (hi - lo) * 0.12 || 1, ax = axisLayout().xa(t) === 'x2' ? 'xaxis2' : 'xaxis', upd = {};
    upd[ax + '.range'] = [a + off, b + off]; upd['yaxis.range'] = [lo - pad, hi + pad * 1.6];
    Plotly.relayout(el, upd);
  }
  function hoverRow(id) {
    var tb = $('peak-table'); if (!tb) return;
    toArr(tb.querySelectorAll('tr.hover')).forEach(function (r) { if (r.getAttribute('data-id') !== id) r.classList.remove('hover'); });
    if (id) { var r = tb.querySelector('tr[data-id="' + cssEsc(id) + '"]'); if (r) r.classList.add('hover'); }
  }
  function highlightPeakOnPlot(id) {
    var el = $('plot'), t = activeTrace(); if (!el || !el.layout || typeof Plotly === 'undefined' || !t) return;
    var shapes = (el.layout.shapes || []).filter(function (s) { return s.name !== 'hl'; });
    var pk = id && t.peaks.filter(function (p) { return p.id === id; })[0];
    if (pk) { var off = num(t.style.offset, 0); shapes.push({ type: 'rect', name: 'hl', xref: axisLayout().xa(t), yref: 'paper', x0: pk.start + off, x1: pk.end + off, y0: 0, y1: 1, fillcolor: hexA(plotColors().accent, 0.10), line: { width: 0 }, layer: 'below' }); }
    Plotly.relayout(el, { shapes: shapes });
  }

  /* ================================================================== peak table + audit */
  var METRIC_LABELS = { rt: 'Retention time', height: 'Height', area: 'Area', areaPct: 'Area %', fwhm: 'Width at half height (W½)', w5: 'Width at 5 % height',
    tailing: 'USP tailing factor', asymmetry: 'Asymmetry (10 %)', plates: 'Plates N (half-height)', platesUSP: 'Plates N (USP tangent)', resolution: 'Resolution Rs', sn: 'Signal-to-noise',
    pctB: '%B at elution', kprime: "Retention factor k′", fit: 'Fitted area ± SE' };
  function tableColumns(t, ctx) {
    var xu = t.xUnit, cols = [
      { key: 'name', label: 'Name', d: 0 },
      { key: 'rt', label: (t.xUnit === 'mL' ? 'V' : 'RT') + ' (' + xu + ')', d: 5 },
      { key: 'pctB', label: ctx.ci ? ctx.ci.label + ' (' + ctx.ci.unit + ')' : '%B', d: 4, hide: !ctx.hasGrad },
      { key: 'height', label: 'Height (' + t.yUnit + ')', d: 4 },
      { key: 'area', label: 'Area (' + t.yUnit + '·' + xu + ')', d: 5 },
      { key: 'areaPct', label: 'Area %', d: 4 },
      { key: 'fwhm', label: 'W½ (' + xu + ')', d: 3 },
      { key: 'tailing', label: 'Tailing', d: 3 },
      { key: 'plates', label: 'N', d: 4 },
      { key: 'resolution', label: 'Rs', d: 3 },
      { key: 'sn', label: 'S/N', d: 3 },
      { key: 'kprime', label: "k′", d: 3, hide: !isNum(ctx.t0) },
      { key: 'fit', label: 'Fit area ± SE', d: 4, hide: !t.fit },
      { key: 'printed', label: 'Printed (RT / area %)', d: 4, hide: !(t.digitized && t.digitized.printedPeaks && t.digitized.printedPeaks.length) }
    ];
    return cols.filter(function (c) { return !c.hide; });
  }
  function tableCtx(t) {
    var m = P().method;
    return { m: m, ci: concInfo(m), hasGrad: hasGradient(m), t0: voidInXUnits(t), dwell: dwellTime(m), t0min: voidTime(m), dig: t.digitized || null };
  }
  function fitComp(t, pk, i) {
    if (!t.fit || !t.fit.components) return null;
    var c = t.fit.components.filter(function (q) { return q.id === pk.id; })[0];
    return c || ((t.fit.peakIds || [])[i] === pk.id ? t.fit.components[i] : null);
  }
  function printedFor(t, m) {
    var pp = t.digitized && t.digitized.printedPeaks; if (!pp || !pp.length || !isNum(m.rt)) return null;
    var tol = Math.max(0.05, 3 * num(t.digitized.dxMin, 0)), best = null, bd = Infinity;
    pp.forEach(function (q) { var d = Math.abs(q.rt - m.rt); if (d < bd) { bd = d; best = q; } });
    if (!best || bd > tol) return null;
    var mismatch = isNum(best.areaPct) && isNum(m.areaPct) && Math.abs(best.areaPct - m.areaPct) > Math.max(1, 0.1 * best.areaPct);
    return { p: best, mismatch: mismatch };
  }
  function cellValue(key, t, pk, m, i, ctx) {
    switch (key) {
      case 'pctB': {
        var rtm = xToMin(t, m.rt); if (!isNum(rtm) || !ctx.hasGrad) return NaN;
        var el = an('elution'); if (el) { try { var e = el(ctx.m, rtm); if (e) return ctx.ci ? (isNum(e.conc) ? e.conc : e.B * ctx.ci.k) : e.B; } catch (er) { /* fall back */ } }
        var b = bAt(ctx.m, rtm); return ctx.ci && isNum(b) ? b * ctx.ci.k : b; }
      case 'kprime': return isNum(m.k) ? m.k : (isNum(ctx.t0) && ctx.t0 > 0 && isNum(m.rt) ? (m.rt - ctx.t0) / ctx.t0 : NaN);
      case 'fit': { var c = fitComp(t, pk, i); return c ? c.area : NaN; }
      default: return m[key];
    }
  }
  function renderTable() {
    var tb = $('peak-table'), sel = $('table-trace'), sum = $('table-summary'); if (!tb) return;
    var p = P(), mains = p.traces.filter(function (t) { return !isAux(t); });
    if (sel) { sel.innerHTML = mains.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === p.activeTraceId ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join(''); sel.disabled = !mains.length; sel.hidden = state.view === 'compare'; }
    toArr(document.querySelectorAll('[data-view]')).forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-view') === (state.view || 'peaks'))); });
    var pcsv = document.querySelector('.table-head [data-action="export-peaks"]'); if (pcsv) pcsv.hidden = state.view === 'compare';
    if (state.view === 'compare') { renderCompare(); return; }
    var cc = $('compare-controls'); if (cc) cc.hidden = true;
    var t = activeTrace();
    if (!t || isAux(t)) { tb.innerHTML = '<tbody><tr><td class="table-empty">' + (mains.length ? 'Select a chromatogram trace.' : 'Peaks appear here after you load data.') + '</td></tr></tbody>'; if (sum) sum.textContent = ''; return; }
    var ms = withAreaPct(metricsFor(t)), ctx = tableCtx(t), cols = tableColumns(t, ctx), dig = ctx.dig;
    if (sum) sum.innerHTML = t.peaks.length + ' peak' + (t.peaks.length === 1 ? '' : 's') + (dig ? ' · <span class="badge digitized">digitized</span> RT ±' + esc(fmt(dig.dxMin, 2)) + ' ' + esc(t.xUnit) : '') + (isNum(ctx.t0min) ? ' · t₀ = ' + esc(fmt(ctx.t0min, 3)) + ' min' : '');
    if (!t.peaks.length) { tb.innerHTML = '<tbody><tr><td class="table-empty">No peaks. Click <strong>Detect peaks</strong>, use <strong>Integrate</strong> (G) to click a start and end on the curve, or Alt/Option-click a peak.</td></tr></tbody>'; return; }
    var head = '<thead><tr><th scope="col">#</th>' + cols.map(function (c) { return '<th scope="col" title="' + esc(METRIC_LABELS[c.key] || c.label) + '">' + esc(c.label) + '</th>'; }).join('') + '<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>';
    var body = t.peaks.map(function (pk, i) {
      var m = ms[i] || {}, selC = pk.id === state.selPeakId;
      var cells = cols.map(function (c) {
        if (c.key === 'name') return '<td style="text-align:left"><input type="text" class="pk-name" value="' + esc(pk.label || '') + '" placeholder="' + esc(fmt(m.rt, 4)) + '" aria-label="Name of peak ' + (i + 1) + '" style="width:110px;min-height:24px;padding:2px 6px"></td>';
        if (c.key === 'printed') { var pf = printedFor(t, m); return '<td' + (pf && pf.mismatch ? ' class="mismatch" title="Printed area % differs from the computed value"' : '') + '>' + (pf ? esc(fmt(pf.p.rt, 4)) + ' / ' + esc(fmt(pf.p.areaPct, 3)) : '—') + '</td>'; }
        var v = cellValue(c.key, t, pk, m, i, ctx), txt = esc(fmt(v, c.d));
        if (c.key === 'rt' && dig && isNum(dig.dxMin)) txt += ' <span class="unc">±' + esc(fmt(dig.dxMin, 2)) + '</span>';
        if (c.key === 'fit') { var fc = fitComp(t, pk, i); if (fc && isNum(fc.areaSE)) txt += ' <span class="muted">± ' + esc(fmt(fc.areaSE, 2)) + '</span>'; }
        return '<td>' + txt + '<button class="cell-i" tabindex="-1" data-audit="' + c.key + '" aria-label="How ' + esc(METRIC_LABELS[c.key] || c.key) + ' was computed">&#9432;</button></td>';
      }).join('');
      return '<tr data-id="' + esc(pk.id) + '"' + (selC ? ' class="selected" aria-selected="true"' : '') + '><td>' + (i + 1) + (pk.manual ? ' <span class="badge manual" title="Manually added or edited">M</span>' : '') + (dig ? ' <span class="badge digitized">dig.</span>' : '') + '</td>' + cells +
        '<td class="row-actions"><button class="btn ghost sm icon" data-row="audit" aria-label="Show calculation details for peak ' + (i + 1) + '" title="Calculation details">&#9432;</button>' +
        '<button class="btn ghost sm icon" data-row="window" aria-label="Integrate the same window in all visible traces" title="Apply this integration window to all visible traces">&#8649;</button>' +
        '<button class="btn ghost sm icon danger" data-row="del" aria-label="Remove peak ' + (i + 1) + '" title="Remove peak (Del)">&#10005;</button></td></tr>';
    }).join('');
    tb.innerHTML = head + '<tbody>' + body + '</tbody>';
  }
  function bindTable() {
    var tb = $('peak-table');
    tb.addEventListener('click', function (e) {
      if (state.view === 'compare') return onCompareClick(e);
      if (e.target.closest('input')) return;
      var tr = e.target.closest('tr[data-id]'); if (!tr) return; var id = tr.getAttribute('data-id'), t = activeTrace(); if (!t) return;
      var idx = -1; t.peaks.forEach(function (p, i) { if (p.id === id) idx = i; });
      var au = e.target.closest('[data-audit]'), rb = e.target.closest('[data-row]');
      if (au) { e.stopPropagation(); showAudit(t, idx, au.getAttribute('data-audit'), au); return; }
      if (rb) {
        var a = rb.getAttribute('data-row');
        if (a === 'del') removePeak(id);
        else if (a === 'audit') showAudit(t, idx, null, rb);
        else if (a === 'window') applyWindowToAll(t, t.peaks[idx]);
        return;
      }
      selectPeak(id, { zoom: true });
    });
    tb.addEventListener('mouseover', function (e) { if (state.view === 'compare') return; var tr = e.target.closest('tr[data-id]'); var id = tr ? tr.getAttribute('data-id') : null; if (id !== state.hoverId) { state.hoverId = id; highlightPeakOnPlot(id); } });
    tb.addEventListener('mouseleave', function () { if (state.hoverId) { state.hoverId = null; highlightPeakOnPlot(null); } });
    tb.addEventListener('change', function (e) {
      if (e.target.classList.contains('grp-label')) setGroupLabel(+e.target.getAttribute('data-rt'), e.target.value);
      if (e.target.classList.contains('pk-name')) { var tr = e.target.closest('tr[data-id]'), t = activeTrace(); if (tr && t) setPeakLabel(t, tr.getAttribute('data-id'), e.target.value); }
    });
    tb.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('pk-name')) e.target.blur(); });
    $('table-trace').addEventListener('change', function (e) { app.selectTrace(e.target.value); });
  }
  function setPeakLabel(t, id, label) {
    var pk = t.peaks.filter(function (p) { return p.id === id; })[0]; if (!pk) return;
    label = String(label || '').trim(); if ((pk.label || '') === label) return;
    app.pushUndo('Rename peak'); if (label) pk.label = label; else delete pk.label;
    renderPlot(); renderTable();
  }
  app.setPeakLabel = function (traceId, peakId, label) { var t = traceById(traceId); if (t) setPeakLabel(t, peakId, label); };
  function fmtInputs(inp) {
    if (!inp || typeof inp !== 'object') return '';
    return Object.keys(inp).map(function (k) { var v = inp[k]; return esc(k) + ' = ' + esc(typeof v === 'number' ? fmt(v, 6) : Array.isArray(v) ? '[' + v.length + ' values]' : (v && typeof v === 'object') ? JSON.stringify(v).slice(0, 80) : String(v)); }).join('<br>');
  }
  function auditEntries(t, idx, only) {
    var ms = withAreaPct(metricsFor(t)), m = ms[idx] || {}, pk = t.peaks[idx], ctx = tableCtx(t), out = [], F = m.formulas || {};
    var keys = only ? [only] : ['rt', 'height', 'area', 'areaPct', 'fwhm', 'tailing', 'asymmetry', 'plates', 'platesUSP', 'resolution', 'sn', 'pctB', 'kprime', 'fit'];
    keys.forEach(function (k) {
      var f = F[k], e = { key: k, label: METRIC_LABELS[k] || k };
      if (k === 'pctB') {
        if (!ctx.hasGrad) return; var rtm = xToMin(t, m.rt); if (!isNum(rtm)) return;
        var elf = an('elution'), eo = null; if (elf) { try { eo = elf(ctx.m, rtm); } catch (er) { eo = null; } }
        if (eo && eo.formula) { e.expr = eo.formula.expr + (ctx.ci ? '; c = c_A + (c_B,max − c_A)·B/100' : ''); e.inputs = eo.formula.inputs; e.value = cellValue('pctB', t, pk, m, idx, ctx); e.note = eo.formula.note; out.push(e); return; }
        e.expr = 'B(t_R − t_dwell − t₀)' + (ctx.ci ? ' × ' + fmt(ctx.ci.k * 100, 4) + ' ' + ctx.ci.unit + '/100 %' : '');
        e.inputs = { 't_R (min)': rtm, 't_dwell = V_dwell/F (min)': ctx.dwell, 't₀ (min)': ctx.t0min }; e.value = cellValue('pctB', t, pk, m, idx, ctx);
        e.note = 'Gradient program value at the time the eluting band left the column inlet (linear segments; steps where two rows share a time).';
      } else if (k === 'kprime' && F.k) { e.expr = F.k.expr; e.inputs = F.k.inputs; e.value = F.k.value; e.note = F.k.note;
      } else if (k === 'kprime') {
        if (!isNum(ctx.t0)) return; e.expr = "k′ = (t_R − t₀) / t₀"; e.inputs = { t_R: m.rt, 't₀': ctx.t0 }; e.value = cellValue('kprime', t, pk, m, idx, ctx);
        e.note = P().method.voidTime_min ? 't₀ is the user override from Method.' : 't₀ = ε·π·(ID/2)²·L / F from the column in Method.';
      } else if (k === 'fit') {
        var c = fitComp(t, pk, idx); if (!c) return;
        var cf = c.formulas && c.formulas.area;
        e.expr = cf ? cf.expr : (t.fit.model === 'emg' ? 'area = A·σ·√(2π) (EMG, Gaussian-amplitude form)' : 'area = A·σ·√(2π)');
        e.inputs = mergeDeep({}, c.params || {}); e.inputs.SE = c.areaSE; e.inputs['R² (joint fit)'] = t.fit.r2; e.value = c.area;
        e.note = cf && cf.note ? cf.note : 'SE from s²·(JᵀJ)⁻¹ propagated through the area formula (Levenberg–Marquardt joint fit).';
      } else if (f) { e.expr = f.expr || f.formula || ''; e.inputs = f.inputs; e.value = isNum(f.value) ? f.value : m[k]; e.note = f.note || f.desc || ''; }
      else if (isNum(m[k])) { e.expr = k === 'areaPct' ? '100 · area / Σ areas' : k === 'rt' ? 'apex of the processed signal' : ''; e.value = m[k]; }
      else return;
      if (k === 'rt' && ctx.dig) e.note = (e.note ? e.note + ' ' : '') + 'Digitized trace: ± ' + fmt(ctx.dig.dxMin, 3) + ' ' + t.xUnit + ' from the image pixel size.';
      out.push(e);
    });
    return out;
  }
  function showAudit(t, idx, only, anchor) {
    var pop = $('audit-pop'); if (!pop || idx < 0) return;
    var es = auditEntries(t, idx, only), pk = t.peaks[idx];
    pop.innerHTML = '<div class="row" style="justify-content:space-between"><strong>Peak ' + (idx + 1) + ' · ' + esc(t.name) + '</strong><button class="btn ghost sm" data-close-audit aria-label="Close">&#10005;</button></div>' +
      '<label class="inline" style="margin:6px 0">Name <input type="text" data-audit-name value="' + esc(pk.label || '') + '" placeholder="e.g. Caffeine" style="flex:1"></label>' +
      '<div class="small muted">Window ' + esc(fmt(pk.start, 5)) + ' – ' + esc(fmt(pk.end, 5)) + ' ' + esc(t.xUnit) + ', drop-line baseline between the bound points' + (pk.manual ? ' · manually set' : '') + '</div>' +
      (es.length ? es.map(function (e) {
        return '<div class="metric"><div><strong>' + esc(e.label) + '</strong> = <span class="mono">' + esc(fmt(e.value, 6)) + '</span></div>' + (e.expr ? '<div class="expr">' + esc(e.expr) + '</div>' : '') +
          (e.inputs ? '<div class="inputs">' + fmtInputs(e.inputs) + '</div>' : '') + (e.note ? '<div class="small muted">' + esc(e.note) + '</div>' : '') + '</div>';
      }).join('') : '<p class="muted">No formula details available for this value.</p>') +
      (t.digitized ? '<div class="note warn" style="margin-top:6px">Digitized from an image: values are estimates. Uncertainty ±' + esc(fmt(t.digitized.dxMin, 3)) + ' ' + esc(t.xUnit) + ', ±' + esc(fmt(t.digitized.dy, 3)) + ' ' + esc(t.yUnit) + '.</div>' : '') +
      '<div class="row" style="margin-top:8px"><button class="btn sm" data-audit-window>&#8649; Apply this window to all traces</button></div>';
    pop.hidden = false;
    var r = anchor ? anchor.getBoundingClientRect() : { left: 100, bottom: 100, top: 100 }, pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left - pw / 2), window.innerWidth - pw - 8), top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    pop._ctx = { t: t, idx: idx, anchor: anchor };
    var c = pop.querySelector('[data-close-audit]'); if (c) c.focus();
  }
  function hideAudit() { var pop = $('audit-pop'); if (pop && !pop.hidden) { pop.hidden = true; var a = pop._ctx && pop._ctx.anchor; if (a && a.focus && document.contains(a)) a.focus(); } }
  function bindAudit() {
    var pop = $('audit-pop');
    pop.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-audit]')) hideAudit();
      else if (e.target.closest('[data-audit-window]') && pop._ctx) { var c = pop._ctx; hideAudit(); applyWindowToAll(c.t, c.t.peaks[c.idx]); }
    });
    pop.addEventListener('change', function (e) { if (e.target.hasAttribute('data-audit-name') && pop._ctx) { var c = pop._ctx, pk = c.t.peaks[c.idx]; if (pk) setPeakLabel(c.t, pk.id, e.target.value); } });
    pop.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.hasAttribute('data-audit-name')) e.target.blur(); });
    document.addEventListener('mousedown', function (e) { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('[data-audit],[data-row="audit"]')) hideAudit(); });
  }

  /** Parabolic interpolation of the maximum within [s, e] (processed data). */
  function apexIn(pr, s, e) {
    var i0 = lowerIdx(pr.x, s), i1 = Math.min(lowerIdx(pr.x, e), pr.x.length - 1), im = i0;
    for (var i = i0; i <= i1; i++) if (pr.y[i] > pr.y[im]) im = i;
    if (im > i0 && im < i1) {
      var y0 = pr.y[im - 1], y1 = pr.y[im], y2 = pr.y[im + 1], den = y0 - 2 * y1 + y2, h = (pr.x[im + 1] - pr.x[im - 1]) / 2;
      if (den < 0) { var d = 0.5 * (y0 - y2) / den; if (Math.abs(d) <= 1) return pr.x[im] + d * h; }
    }
    return pr.x[im];
  }
  /** Create a manual peak on trace t from s to e (trace x units). Replaces peaks whose apex lies inside. */
  function integrateOnTrace(t, s, e, opts) {
    opts = opts || {};
    var pr = processed(t), xmin = pr.x[0], xmax = pr.x[pr.x.length - 1];
    if (e < s) { var tmp = s; s = e; e = tmp; }
    s = U.clamp(s, xmin, xmax); e = U.clamp(e, xmin, xmax);
    if (e - s < (pr.x[1] - pr.x[0]) * 2) return null;
    var np = null, iw = an('integrateWindow');
    if (iw) { try { np = iw(pr.x, pr.y, s, e); } catch (er) { np = null; } }
    np = { id: (np && np.id) || PK.uid('pk'), start: s, apex: np && isNum(np.apex) ? np.apex : apexIn(pr, s, e), end: e, manual: true };
    if (opts.label) np.label = opts.label;
    t.peaks = t.peaks.filter(function (q) { return !(q.apex >= s && q.apex <= e); });
    t.peaks.push(np); t.peaks.sort(function (a, b) { return a.apex - b.apex; });
    t.proc.peaks.auto = false; clearFit(t);
    return np;
  }
  function applyWindowToAll(src, pk) {
    if (!src || !pk) return;
    var offS = num(src.style.offset, 0), a = pk.start + offS, b = pk.end + offS;
    var targets = P().traces.filter(function (t) { return t !== src && !isAux(t) && t.style.visible !== false && t.xUnit === src.xUnit; });
    if (!targets.length) { toast('No other visible traces with the same x unit to integrate.', 'info'); return; }
    app.pushUndo('Apply integration window to all traces');
    var n = 0, hl = [{ traceId: src.id, peakId: pk.id }];
    targets.forEach(function (t) { var off = num(t.style.offset, 0), np = integrateOnTrace(t, a - off, b - off, { label: pk.label }); if (np) { n++; hl.push({ traceId: t.id, peakId: np.id }); } });
    state.compareHl = hl;
    renderAll(); toast('Integrated ' + fmt(a, 4) + '–' + fmt(b, 4) + ' ' + src.xUnit + ' in ' + n + ' more trace' + (n === 1 ? '' : 's') + '. See the Compare tab.', 'ok');
  }

  /* ================================================================== compare view */
  /** Pure: group peaks across traces by RT. list = [{traceId, peaks:[{id, rt, ...}]}] → [{index, rt, members:{traceId: peak}, count}] */
  app.matchPeaks = function (list, tol) {
    tol = tol > 0 ? tol : 0.1;
    var all = [];
    (list || []).forEach(function (tr, ti) { (tr.peaks || []).forEach(function (p) { if (isNum(p.rt)) all.push({ traceId: tr.traceId, ti: ti, p: p }); }); });
    all.sort(function (a, b) { return a.p.rt - b.p.rt || a.ti - b.ti; });
    var groups = [];
    all.forEach(function (e) {
      var best = null, bd = Infinity;
      for (var g = 0; g < groups.length; g++) {
        var G = groups[g]; if (G.members[e.traceId]) continue;
        var d = Math.abs(G.rt - e.p.rt); if (d <= tol && d < bd) { bd = d; best = G; }
      }
      if (!best) { best = { rt: e.p.rt, members: {}, n: 0, sum: 0 }; groups.push(best); }
      best.members[e.traceId] = e.p; best.n++; best.sum += e.p.rt; best.rt = best.sum / best.n;
    });
    groups.sort(function (a, b) { return a.rt - b.rt; });
    return groups.map(function (g, i) { return { index: i, rt: g.rt, members: g.members, count: g.n }; });
  };
  function compareData() {
    var s = P().settings, tol = num(s.compareTol, 0.1);
    var vis = P().traces.filter(function (t) { return t.style.visible !== false && !isAux(t); });
    var list = vis.map(function (t) {
      var ms = withAreaPct(metricsFor(t)), off = num(t.style.offset, 0);
      return { traceId: t.id, peaks: t.peaks.map(function (p, i) { var m = ms[i] || {}; return { id: p.id, label: p.label || '', rt: (isNum(m.rt) ? m.rt : p.apex) + off, rawRt: isNum(m.rt) ? m.rt : p.apex, area: m.area, areaPct: m.areaPct, height: m.height }; }) };
    });
    var ref = traceById(s.compareRef) && vis.indexOf(traceById(s.compareRef)) >= 0 ? traceById(s.compareRef) : vis[0];
    return { vis: vis, groups: app.matchPeaks(list, tol), tol: tol, ref: ref };
  }
  function groupLabel(rt, tol, g) {
    var own = g ? Object.keys(g.members).map(function (k) { return g.members[k].label; }).filter(Boolean)[0] : '';
    var L = P().settings.compareLabels || [], best = null, bd = Infinity;
    L.forEach(function (l) { var d = Math.abs(l.rt - rt); if (d < bd) { bd = d; best = l; } });
    return best && bd <= tol / 2 ? best.label : (own || '');
  }
  function setGroupLabel(rt, label) {
    app.pushUndo('Rename peak group');
    var s = P().settings, tol = num(s.compareTol, 0.1);
    s.compareLabels = (s.compareLabels || []).filter(function (l) { return Math.abs(l.rt - rt) > tol / 2; });
    if (label.trim()) s.compareLabels.push({ rt: rt, label: label.trim() });
  }
  function renderCompare() {
    var tb = $('peak-table'), sum = $('table-summary'), cc = $('compare-controls'), s = P().settings;
    var cd = compareData();
    if (cc) {
      cc.hidden = false;
      cc.innerHTML = '<label class="inline">Match tolerance <input type="number" id="cmp-tol" min="0.001" step="0.01" value="' + cd.tol + '" style="width:70px" aria-label="RT matching tolerance"> ' + (cd.ref && cd.ref.xUnit === 'mL' ? 'mL' : 'min') + '</label>' +
        '<label class="inline">Reference <select id="cmp-ref" aria-label="Reference trace">' + cd.vis.map(function (t) { return '<option value="' + esc(t.id) + '"' + (cd.ref && t.id === cd.ref.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="inline">Stack <input type="range" id="cmp-stack" min="0" max="1" step="0.05" value="' + num(s.stack, 0) + '" style="width:90px" aria-label="Vertical stacking offset (waterfall)"></label>' +
        '<label class="inline">Normalize <select id="cmp-norm" aria-label="Normalization"><option value="none">none</option><option value="max">max</option><option value="area">area</option></select></label>' +
        '<button class="btn sm" data-action="export-compare">CSV</button>';
      $('cmp-norm').value = s.normalization || 'none';
    }
    if (sum) sum.textContent = cd.vis.length + ' visible trace' + (cd.vis.length === 1 ? '' : 's') + ' · ' + cd.groups.length + ' peak group' + (cd.groups.length === 1 ? '' : 's');
    if (cd.vis.length < 1 || !cd.groups.length) { tb.innerHTML = '<tbody><tr><td class="table-empty">' + (cd.vis.length < 2 ? 'Show two or more traces to compare peaks across runs.' : 'No peaks to compare. Detect peaks on each trace, or integrate a window and apply it to all traces (⇉).') + '</td></tr></tbody>'; return; }
    var refId = cd.ref && cd.ref.id, xu = cd.ref && cd.ref.xUnit === 'mL' ? 'mL' : 'min';
    var h1 = '<tr><th scope="col" rowspan="2">Peak group</th>' + cd.vis.map(function (t) { var ref = t.id === refId; return '<th scope="colgroup" colspan="' + (ref ? 4 : 6) + '" style="text-align:center;border-left:1px solid var(--border)"><span class="swatch" style="background:' + esc(t.style.color) + '"></span>' + esc(t.name) + (ref ? ' (ref)' : '') + '</th>'; }).join('') + '</tr>';
    var h2 = '<tr>' + cd.vis.map(function (t) { var ref = t.id === refId; return '<th style="border-left:1px solid var(--border)">RT</th><th>Area</th><th>Area %</th><th>Height</th>' + (ref ? '' : '<th>ΔRT</th><th>Area ratio</th>'); }).join('') + '</tr>';
    var hlKey = state.compareGroupRt;
    var rows = cd.groups.map(function (g) {
      var refP = refId && g.members[refId], lbl = groupLabel(g.rt, cd.tol, g), sel = isNum(hlKey) && Math.abs(hlKey - g.rt) < 1e-9;
      var cells = cd.vis.map(function (t) {
        var q = g.members[t.id], ref = t.id === refId, bl = ' style="border-left:1px solid var(--border)"';
        if (!q) return '<td' + bl + '>—</td><td>—</td><td>—</td><td>—</td>' + (ref ? '' : '<td>—</td><td>—</td>');
        return '<td' + bl + '>' + esc(fmt(q.rt, 5)) + (t.digitized ? ' <span class="unc">±' + esc(fmt(t.digitized.dxMin, 2)) + '</span>' : '') + '</td><td>' + esc(fmt(q.area, 4)) + '</td><td>' + esc(fmt(q.areaPct, 4)) + '</td><td>' + esc(fmt(q.height, 4)) + '</td>' +
          (ref ? '' : '<td>' + (refP ? esc(fmt(q.rt - refP.rt, 3)) : '—') + '</td><td>' + (refP && isNum(q.area) && refP.area ? esc(fmt(q.area / refP.area, 4)) : '—') + '</td>');
      }).join('');
      return '<tr data-grp="' + g.rt + '"' + (sel ? ' class="selected"' : '') + '><td><input type="text" class="grp-label" data-rt="' + g.rt + '" value="' + esc(lbl) + '" placeholder="RT ' + esc(fmt(g.rt, 4)) + ' ' + xu + '" aria-label="Name for peak group at ' + esc(fmt(g.rt, 4)) + '" style="width:130px;min-height:24px;padding:2px 6px"> <span class="small muted">' + g.count + '/' + cd.vis.length + '</span></td>' + cells + '</tr>';
    }).join('');
    tb.innerHTML = '<thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody>';
  }
  function onCompareClick(e) {
    if (e.target.closest('input')) return;
    var tr = e.target.closest('tr[data-grp]'); if (!tr) return;
    var rt = +tr.getAttribute('data-grp');
    if (isNum(state.compareGroupRt) && Math.abs(state.compareGroupRt - rt) < 1e-9) { state.compareGroupRt = null; state.compareHl = []; }
    else {
      var g = compareData().groups.filter(function (q) { return Math.abs(q.rt - rt) < 1e-9; })[0];
      state.compareGroupRt = rt; state.compareHl = g ? Object.keys(g.members).map(function (tid) { return { traceId: tid, peakId: g.members[tid].id }; }) : [];
    }
    renderPlot(); renderTable();
  }
  function bindCompareControls() {
    var cc = $('compare-controls'); if (!cc) return;
    cc.addEventListener('change', function (e) {
      var s = P().settings, id = e.target.id;
      if (id === 'cmp-tol') { s.compareTol = Math.max(1e-4, num(e.target.value, 0.1)); renderTable(); }
      else if (id === 'cmp-ref') { s.compareRef = e.target.value; renderTable(); }
      else if (id === 'cmp-norm') { app.pushUndo('Change normalization'); s.normalization = e.target.value; renderAll(); }
      else if (id === 'cmp-stack') { app.pushUndo('Change stacking'); }
    });
    cc.addEventListener('input', function (e) { if (e.target.id === 'cmp-stack') { P().settings.stack = num(e.target.value, 0); schedulePlot(); } });
  }
  function compareCSV() {
    var cd = compareData(), refId = cd.ref && cd.ref.id, L = [];
    L.push('# Peakly ' + (PK.version || '') + ' cross-trace peak comparison');
    L.push('# Exported ' + new Date().toISOString() + '; RT matching tolerance ' + cd.tol + ' (after per-trace RT offsets); reference: ' + (cd.ref ? cd.ref.name : '—'));
    L.push('# RT values include each trace\'s display offset (alignment). Area ratio = area / reference area. ΔRT = RT − reference RT.');
    cd.vis.forEach(function (t) { if (t.digitized) L.push('# ' + t.name + ': DIGITIZED from an image, RT uncertainty ±' + t.digitized.dxMin + ' ' + t.xUnit); });
    var hdr = ['group', 'mean_RT'];
    cd.vis.forEach(function (t) { var n = t.name; hdr.push(n + ' RT', n + ' area', n + ' area_pct', n + ' height'); if (t.id !== refId) hdr.push(n + ' dRT', n + ' area_ratio'); });
    L.push(hdr.map(csvCell).join(','));
    cd.groups.forEach(function (g) {
      var refP = refId && g.members[refId], row = [groupLabel(g.rt, cd.tol, g), g.rt];
      cd.vis.forEach(function (t) { var q = g.members[t.id]; row.push(q ? q.rt : '', q ? q.area : '', q ? q.areaPct : '', q ? q.height : ''); if (t.id !== refId) row.push(q && refP ? q.rt - refP.rt : '', q && refP && refP.area ? q.area / refP.area : ''); });
      L.push(row.map(function (v) { return csvCell(typeof v === 'number' ? (isFinite(v) ? +v.toPrecision(8) : '') : v); }).join(','));
    });
    return L.join('\n') + '\n';
  }

  /* ================================================================== import */
  function isImageFile(f) {
    if (PK.parsers && typeof PK.parsers.isImage === 'function') { try { return !!PK.parsers.isImage(f); } catch (e) { /* fall through */ } }
    return /\.(png|jpe?g|webp|gif|bmp|pdf)$/i.test(f.name || '') || /^image\//.test(f.type || '') || f.type === 'application/pdf';
  }
  function readText(f) { return U.readFileAs ? U.readFileAs(f, 'text') : Promise.resolve(''); }
  app.handleFiles = function (files) {
    files = toArr(files); if (!files.length) return Promise.resolve();
    hideModal('import');
    var imgs = files.filter(isImageFile), others = files.filter(function (f) { return !isImageFile(f); });
    if (imgs.length) { openDigitizer({ file: imgs[0] }); if (imgs.length > 1) toast('Images are digitized one at a time. Opened "' + imgs[0].name + '". Drop the others afterwards.', 'info'); }
    return others.reduce(function (pr, f) { return pr.then(function () { return importFile(f); }); }, Promise.resolve());
  };
  function friendly(err) {
    var m = (err && err.message) || String(err || 'unknown error');
    if (/Unexpected token|JSON/i.test(m)) return 'The file looks like JSON but could not be read (' + m + ').';
    if (/XLSX|SheetJS/i.test(m) && typeof XLSX === 'undefined') return 'Excel files need the SheetJS library, which did not load. Export the sheet as CSV, or check your connection.';
    return m;
  }
  function looksLikeProject(o) { return o && typeof o === 'object' && (o.format === FORMAT_TAG || (o.app === 'Peakly' && Array.isArray(o.traces)) || (Array.isArray(o.traces) && o.method && o.version)); }
  function importFile(f) {
    var isJson = /\.json$/i.test(f.name);
    var pre = isJson && f.size < 300e6 ? readText(f).then(function (txt) { var o = null; try { o = JSON.parse(txt); } catch (e) { /* not ours */ } return o; }) : Promise.resolve(null);
    return pre.then(function (obj) {
      if (looksLikeProject(obj)) { loadProjectObj(obj.app === 'Peakly' && obj.v ? unpackShare(obj) : obj, f.name); return; }
      if (!PK.parsers || typeof PK.parsers.parseFile !== 'function') {
        return readText(f).then(function (text) { openFallback({ text: text, filename: f.name, error: 'The file-format module did not load, so columns must be mapped by hand.' }); });
      }
      return Promise.resolve().then(function () { return PK.parsers.parseFile(f); }).then(function (res) { return handleParseResult(res, { file: f, filename: f.name, kind: 'file' }); },
        function (err) { console.error(err); return readText(f).then(function (text) { openFallback({ text: text, filename: f.name, error: 'Could not read "' + f.name + '": ' + friendly(err) }); }); });
    });
  }
  function handleParseResult(res, ctx) {
    if (res && typeof res.then === 'function') return res.then(function (r) { return handleParseResult(r, ctx); });
    res = res || { ok: false, error: 'No result from parser' };
    if (res.project) { loadProjectObj(res.project, ctx.filename); return; }
    var trs = toArr(res.traces).filter(function (t) { return t && t.x && t.x.length > 1; });
    if (res.ok !== false && trs.length && !res.needsMapping) {
      var srcKey = PK.uid('src');
      state.sources = state.sources || {};
      state.sources[srcKey] = { file: ctx.file || null, text: ctx.text || res.rawText || null, filename: ctx.filename, kind: ctx.kind, mapping: res.mapping || null, table: res.table || null };
      trs.forEach(function (t) {
        t.meta = t.meta || {}; t.meta._src = srcKey;
        t.source = mergeDeep({ kind: ctx.kind || 'file', filename: ctx.filename, format: res.format }, t.source || {});
        if (ctx.kind === 'paste') t.source.kind = 'paste';
        if (t.meta && t.meta.xIsVolume) t.xUnit = 'mL';
      });
      app.addTraces(trs, { label: 'Import ' + (ctx.filename || 'data') });
      if (res.warnings && res.warnings.length) toast(ctx.filename + ': ' + res.warnings.slice(0, 3).join(' · '), 'warn');
      return;
    }
    var tp = res.rawText ? Promise.resolve(res.rawText) : ctx.text ? Promise.resolve(ctx.text) : ctx.file ? readText(ctx.file) : Promise.resolve('');
    return tp.then(function (text) {
      openFallback({ text: text, filename: ctx.filename, kind: ctx.kind, mapping: res.mapping, table: res.table, error: res.error ? ('"' + (ctx.filename || 'Data') + '": ' + res.error) : res.needsMapping ? 'Peakly couldn\'t tell which columns hold time and signal in "' + (ctx.filename || 'your data') + '". Pick them below.' : 'No chromatogram data found in "' + (ctx.filename || 'your data') + '".', warnings: res.warnings });
    });
  }
  function loadProjectObj(obj, name) {
    if (!isEmpty() && HAS_DOM && !window.confirm('Replace the current work with the project "' + (obj.name || name || 'project') + '"? You can undo this.')) return;
    try { app.setProject(obj, { label: 'Open project' }); state.uirev = (state.uirev || 0) + 1; renderPlot(); toast('Opened project "' + P().name + '"', 'ok'); }
    catch (e) { toast('Could not open project: ' + e.message, 'error'); }
  }

  /* ---------------- column mapper ("My format isn't working") */
  var DELIMS = { auto: 'Auto-detect', ',': 'Comma', '\t': 'Tab', ';': 'Semicolon', ' ': 'Whitespace', '|': 'Pipe' };
  function splitLine(line, d) {
    if (d === ' ') return line.trim().split(/\s+/);
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === d && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out.map(function (s) { return s.trim(); });
  }
  function detectDelim(lines) {
    var best = ' ', bs = -1;
    ['\t', ';', ',', '|', ' '].forEach(function (d) {
      var counts = lines.slice(0, 40).filter(function (l) { return l.trim(); }).map(function (l) { return splitLine(l, d).length; });
      if (!counts.length) return; var mode = U.median ? U.median(counts) : counts[0];
      var cons = counts.filter(function (c) { return c === mode; }).length / counts.length, score = mode > 1 ? cons * (1 + Math.min(mode, 8) / 8) + (d === ' ' ? -0.05 : 0) : 0;
      if (score > bs) { bs = score; best = d; }
    });
    return best;
  }
  function toNum(s, dec) {
    s = String(s).trim().replace(/^"|"$/g, ''); if (!s) return NaN;
    if (dec === ',') s = s.replace(/\s/g, '').replace(',', '.');
    var v = Number(s); return isFinite(v) ? v : NaN;
  }
  /** Pure table parser used by the manual mapper: honours delimiter, skip and header choices exactly. */
  function parseTable(text, o) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r\n|\n|\r/), skip = Math.max(0, o.skip | 0);
    var body = lines.slice(skip), d = o.delimiter && o.delimiter !== 'auto' ? o.delimiter : detectDelim(body.slice(0, 200));
    while (body.length && !body[0].trim()) body.shift();
    var dec = o.decimal && o.decimal !== 'auto' ? o.decimal : '.';
    if ((!o.decimal || o.decimal === 'auto') && d !== ',') {
      var sample = body.slice(0, 60).join(d), cm = (sample.match(/(^|[^\d])-?\d+,\d+/g) || []).length, dt = (sample.match(/\d\.\d/g) || []).length;
      if (cm > dt && cm > 3) dec = ',';
    }
    var first = body.length ? splitLine(body[0], d) : [], hdr = o.header;
    if (hdr === 'auto' || hdr == null) hdr = first.some(function (c) { return c !== '' && !isFinite(toNum(c, dec)); });
    var header = hdr ? first : null, rows = [], ncol = 0;
    body.slice(hdr ? 1 : 0).forEach(function (l) {
      if (!l.trim()) return;
      var cells = splitLine(l, d).map(function (c) { return toNum(c, dec); });
      if (cells.filter(isFinite).length < 1) return;
      rows.push(cells); if (cells.length > ncol) ncol = cells.length;
    });
    if (header && header.length > ncol) ncol = header.length;
    return { header: header, rows: rows, delimiter: d, decimal: dec, ncol: ncol, headerUsed: !!hdr };
  }
  app.parseTable = parseTable;
  function colName(tb, i) { return (tb.header && tb.header[i]) ? tb.header[i] : 'Column ' + (i + 1); }
  function buildTracesLocal(tb, mp) {
    var f = { min: 1, sec: 1 / 60, s: 1 / 60, ms: 1 / 60000, h: 60 }[mp.xUnit] || 1;
    return mp.yCols.map(function (yc) {
      var x = [], y = [];
      tb.rows.forEach(function (r) { var a = r[mp.xCol], b = r[yc]; if (isFinite(a) && isFinite(b)) { x.push(a * f); y.push(b * (mp.yScale || 1)); } });
      return { name: colName(tb, yc), x: x, y: y, xUnit: 'min', yUnit: mp.yUnit, meta: {} };
    });
  }
  function openFallback(o) {
    o = o || {};
    state.fb = { text: o.text || '', filename: o.filename || 'Data', kind: o.kind || 'file', error: o.error || '', warnings: o.warnings || [], delimiter: 'auto', header: 'auto', skip: 0, decimal: 'auto', xCol: 0, yCols: null, xUnit: 'min', yUnit: 'mAU', customY: '', replaceIds: o.replaceIds || null };
    if (/\b(sec|seconds?)\b|\(s\)/i.test(state.fb.text.slice(0, 2000))) state.fb.xUnit = 'sec';
    var mp = o.mapping;
    if (mp && (isNum(mp.xCol) || (mp.yCols && mp.yCols.length))) {
      var ncol = o.table && (o.table.header ? o.table.header.length : (o.table.rows && o.table.rows[0] ? o.table.rows[0].length : 0));
      var probe = parseTable(state.fb.text, { delimiter: 'auto', skip: 0, header: 'auto', decimal: 'auto' });
      if (!ncol || probe.ncol === ncol) {
        if (isNum(mp.xCol) && mp.xCol >= 0) state.fb.xCol = mp.xCol;
        if (mp.yCols && mp.yCols.length) state.fb.yCols = mp.yCols.filter(function (c) { return c !== state.fb.xCol; });
      }
      var xu = String(mp.xUnit || '').toLowerCase(); if (/^(s|sec|seconds?)$/.test(xu)) state.fb.xUnit = 'sec'; else if (/^(min|ms|h|ml)$/.test(xu)) state.fb.xUnit = xu === 'ml' ? 'mL' : xu;
      var yu = (mp.yUnits && mp.yUnits[0]) || mp.yUnit; if (yu) { if (['mAU', 'AU', 'counts', 'mS/cm', '%', 'mV', 'a.u.'].indexOf(yu) >= 0) state.fb.yUnit = yu; else { state.fb.yUnit = 'custom'; state.fb.customY = yu; } }
    }
    showModal('fallback'); renderFallback();
  }
  app.openFallback = openFallback;
  function renderFallback() {
    var host = $('import-fallback-root'), fb = state.fb; if (!host || !fb) return;
    var lines = fb.text.split(/\r\n|\n|\r/), shown = lines.slice(0, 200).join('\n'), binary = /[\x00-\x08\x0E-\x1F]/.test(fb.text.slice(0, 2000));
    host.innerHTML = (fb.error ? '<div class="note error" role="alert" style="margin-bottom:10px">' + esc(fb.error) + (fb.warnings && fb.warnings.length ? '<br><span class="small">' + esc(fb.warnings.slice(0, 3).join(' · ')) + '</span>' : '') + '</div>' : '') +
      '<div class="split"><div>' +
      '<div class="row" style="justify-content:space-between"><h3>Raw text <span class="muted small">(' + esc(fb.filename) + ', first ' + Math.min(200, lines.length) + ' of ' + lines.length + ' lines)</span></h3>' +
      '<button class="btn sm" id="fb-file">Load another file as text…</button></div>' +
      (fb.text ? '<pre class="raw-text" tabindex="0" aria-label="Raw file text">' + esc(shown) + '</pre>' : '<textarea id="fb-paste" rows="12" placeholder="Paste the data text here…" aria-label="Raw text to map"></textarea><div class="row" style="margin-top:6px"><button class="btn sm primary" id="fb-use">Use this text</button></div>') +
      (binary ? '<p class="note warn" style="margin-top:8px">This looks like a binary file. Export it from the instrument software as CSV/TXT (or AIA/ANDI .cdf), then import that.</p>' : '') +
      '</div><div>' +
      '<div class="grid3"><label class="field"><span>Delimiter</span><select id="fb-delim">' + Object.keys(DELIMS).map(function (k) { return '<option value="' + esc(k) + '">' + DELIMS[k] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Skip first N lines</span><input type="number" id="fb-skip" min="0" step="1" value="' + fb.skip + '"></label>' +
      '<label class="field"><span>Decimal mark</span><select id="fb-dec"><option value="auto">Auto</option><option value=".">Point (1.5)</option><option value=",">Comma (1,5)</option></select></label></div>' +
      '<label class="inline"><input type="checkbox" id="fb-header"> First row (after skipping) is a header</label>' +
      '<div id="fb-cols" style="margin-top:10px"></div>' +
      '<svg class="mini-plot" id="fb-preview" viewBox="0 0 400 160" preserveAspectRatio="none" role="img" aria-label="Preview of the selected columns"></svg>' +
      '<div id="fb-msg" class="small muted" style="margin:6px 0"></div>' +
      '<div class="row"><button class="btn primary" id="fb-import">Import</button><button class="btn ghost" data-close>Cancel</button></div>' +
      '</div></div>';
    $('fb-delim').value = fb.delimiter; $('fb-dec').value = fb.decimal;
    updateFallback();
  }
  function updateFallback() {
    var fb = state.fb; if (!fb) return;
    var tb = parseTable(fb.text, { delimiter: fb.delimiter, skip: fb.skip, header: fb.header, decimal: fb.decimal });
    fb.table = tb; $('fb-header').checked = tb.headerUsed;
    var numeric = []; for (var c = 0; c < tb.ncol; c++) { var cnt = 0; tb.rows.forEach(function (r) { if (isFinite(r[c])) cnt++; }); numeric.push(cnt >= Math.max(2, tb.rows.length * 0.5)); }
    if (fb.xCol >= tb.ncol) fb.xCol = 0;
    if (!fb.yCols || fb.yCols.some(function (i) { return i >= tb.ncol; })) { fb.yCols = []; for (var j = 0; j < tb.ncol; j++) if (j !== fb.xCol && numeric[j]) { fb.yCols.push(j); if (fb.yCols.length >= 1) break; } }
    var units = ['mAU', 'AU', 'counts', 'mS/cm', '%', 'mV', 'a.u.', 'custom'];
    $('fb-cols').innerHTML = !tb.ncol ? '<p class="note warn">No numeric rows found with these settings. Try another delimiter or skip more header lines.</p>' :
      '<div class="grid2"><label class="field"><span>X column (time or volume)</span><select id="fb-x">' + tb.header_opts + Array.apply(null, { length: tb.ncol }).map(function (_, i) { return '<option value="' + i + '"' + (i === fb.xCol ? ' selected' : '') + '>' + esc(colName(tb, i)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>X unit</span><select id="fb-xu">' + [['min', 'minutes'], ['sec', 'seconds'], ['ms', 'milliseconds'], ['h', 'hours'], ['mL', 'mL (volume)']].map(function (u) { return '<option value="' + u[0] + '"' + (u[0] === fb.xUnit ? ' selected' : '') + '>' + u[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="field"><span>Y columns (one trace each)</span><div class="ycols">' + Array.apply(null, { length: tb.ncol }).map(function (_, i) { return i === fb.xCol ? '' : '<label><input type="checkbox" data-yc="' + i + '"' + (fb.yCols.indexOf(i) >= 0 ? ' checked' : '') + (numeric[i] ? '' : ' title="Mostly non-numeric"') + '> ' + esc(colName(tb, i)) + (numeric[i] ? '' : ' <span class="muted">(text)</span>') + '</label>'; }).join('') + '</div></div>' +
      '<div class="grid2"><label class="field"><span>Y unit</span><select id="fb-yu">' + units.map(function (u) { return '<option' + (u === fb.yUnit ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></label>' +
      '<label class="field' + (fb.yUnit === 'custom' ? '' : ' hidden') + '" id="fb-cu-wrap"><span>Custom unit</span><input type="text" id="fb-cu" value="' + esc(fb.customY) + '"></label></div>';
    var series = fb.yCols.slice(0, 4).map(function (yc, k) { var x = [], y = []; tb.rows.forEach(function (r) { if (isFinite(r[fb.xCol]) && isFinite(r[yc])) { x.push(r[fb.xCol]); y.push(r[yc]); } }); return { x: x, y: y, color: (PK.palette || [])[k] || '#2563eb' }; });
    var pv = $('fb-preview'); if (pv) pv.innerHTML = svgLines(series, 400, 160);
    var n = series.length ? series[0].x.length : 0, msg = $('fb-msg');
    if (msg) msg.textContent = tb.rows.length + ' data rows · delimiter: ' + (DELIMS[tb.delimiter] || JSON.stringify(tb.delimiter)) + ' · decimal "' + tb.decimal + '"' + (fb.yCols.length ? ' · ' + n + ' points in first trace' : ' · select at least one Y column');
    var ib = $('fb-import'); if (ib) { ib.disabled = !fb.yCols.length || n < 2; ib.textContent = 'Import ' + fb.yCols.length + ' trace' + (fb.yCols.length === 1 ? '' : 's'); }
  }
  function svgLines(series, W, H) {
    var xs = [], ys = []; series.forEach(function (s) { xs = xs.concat(s.x); ys = ys.concat(s.y); });
    if (xs.length < 2) return '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" font-size="12" fill="currentColor" opacity=".6">No data to preview</text>';
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x1 === x0) x1 = x0 + 1; if (y1 === y0) y1 = y0 + 1;
    return series.map(function (s) {
      var step = Math.max(1, Math.floor(s.x.length / 600)), pts = [];
      for (var i = 0; i < s.x.length; i += step) pts.push(((s.x[i] - x0) / (x1 - x0) * (W - 8) + 4).toFixed(1) + ',' + (H - 4 - (s.y[i] - y0) / (y1 - y0) * (H - 8)).toFixed(1));
      return '<polyline fill="none" stroke="' + esc(s.color) + '" stroke-width="1.4" vector-effect="non-scaling-stroke" points="' + pts.join(' ') + '"/>';
    }).join('');
  }
  app.svgLines = svgLines;
  function bindFallback() {
    var host = $('import-fallback-root');
    host.addEventListener('change', function (e) {
      var fb = state.fb, id = e.target.id; if (!fb) return;
      if (id === 'fb-delim') fb.delimiter = e.target.value;
      else if (id === 'fb-skip') fb.skip = Math.max(0, num(e.target.value, 0) | 0);
      else if (id === 'fb-dec') fb.decimal = e.target.value;
      else if (id === 'fb-header') fb.header = e.target.checked;
      else if (id === 'fb-x') { fb.xCol = +e.target.value; fb.yCols = fb.yCols.filter(function (i) { return i !== fb.xCol; }); }
      else if (id === 'fb-xu') fb.xUnit = e.target.value;
      else if (id === 'fb-yu') fb.yUnit = e.target.value;
      else if (id === 'fb-cu') fb.customY = e.target.value;
      else if (e.target.hasAttribute('data-yc')) { var c = +e.target.getAttribute('data-yc'); fb.yCols = fb.yCols.filter(function (i) { return i !== c; }); if (e.target.checked) fb.yCols.push(c); fb.yCols.sort(function (a, b) { return a - b; }); }
      else return;
      if (id === 'fb-delim' || id === 'fb-skip' || id === 'fb-header' || id === 'fb-dec') fb.yCols = (id === 'fb-header') ? fb.yCols : null;
      updateFallback();
    });
    host.addEventListener('click', function (e) {
      var id = e.target.id, fb = state.fb;
      if (id === 'fb-import') fallbackImport();
      else if (id === 'fb-use') { fb.text = $('fb-paste').value; fb.filename = 'Pasted data'; fb.kind = 'paste'; renderFallback(); }
      else if (id === 'fb-file') {
        var inp = document.createElement('input'); inp.type = 'file';
        inp.onchange = function () { var f = inp.files[0]; if (f) readText(f).then(function (t) { fb.text = t; fb.filename = f.name; fb.kind = 'file'; fb.error = ''; fb.yCols = null; renderFallback(); }); };
        inp.click();
      }
    });
  }
  function fallbackImport() {
    var fb = state.fb, tb = fb.table; if (!tb || !fb.yCols.length) return;
    var yUnit = fb.yUnit === 'custom' ? (fb.customY || 'a.u.') : fb.yUnit, mp = { xCol: fb.xCol, yCols: fb.yCols.slice(), xUnit: fb.xUnit === 'mL' ? 'min' : fb.xUnit, yUnit: yUnit, yScale: 1 };
    var trs = null;
    if (PK.parsers && typeof PK.parsers.buildTraces === 'function') { try { trs = PK.parsers.buildTraces({ header: tb.header, rows: tb.rows, delimiter: tb.delimiter }, mp); } catch (e) { console.warn(e); trs = null; } }
    if (!trs || !trs.length) trs = buildTracesLocal(tb, mp);
    var base = String(fb.filename).replace(/\.[^.]+$/, '');
    trs.forEach(function (t, i) {
      var col = fb.yCols[i];
      t.name = trs.length > 1 || tb.header ? base + ' · ' + colName(tb, col) : base;
      t.source = { kind: fb.kind === 'paste' ? 'paste' : 'file', filename: fb.filename, format: 'manual column mapping' };
      t.yUnit = yUnit; t.meta = t.meta || {};
      if (fb.xUnit === 'mL') { t.xUnit = 'mL'; t.meta.xIsVolume = true; }
      var hn = String(colName(tb, col)).toLowerCase();
      if (/mS\/?cm|conductiv/i.test(hn)) { t.meta.role = 'conductivity'; } else if (/(^|\W)%\s*b|conc\s*b|gradient/i.test(hn)) t.meta.role = 'gradient';
    });
    if (fb.replaceIds && fb.replaceIds.length) {
      var rm = fb.replaceIds; app.pushUndo('Re-map columns');
      P().traces = P().traces.filter(function (t) { return rm.indexOf(t.id) < 0; });
      if (rm.indexOf(P().activeTraceId) >= 0) P().activeTraceId = null;
      var ids0 = app.addTraces(trs, { label: 'Import (re-mapped)' });
      if (ids0.length) { state.undo.splice(state.undo.length - 1, 1); updateUndoButtons(); hideModal('fallback'); } else { state.undo.pop(); updateUndoButtons(); }
      return;
    }
    var ids = app.addTraces(trs, { label: 'Import (manual mapping)' });
    if (ids.length) hideModal('fallback');
  }

  /* ---------------- paste */
  /** Source text for "Re-map columns" (kept in memory only for files opened in this session). */
  function remapSource(t) {
    var key = t.meta && t.meta._src, src = key && state.sources && state.sources[key]; if (!src) return null;
    var ids = P().traces.filter(function (o) { return o.meta && o.meta._src === key; }).map(function (o) { return o.id; });
    var base = { filename: src.filename, kind: src.kind, mapping: src.mapping, table: src.table, replaceIds: ids, error: '' };
    if (src.text) { base.text = src.text; return base; }
    if (src.file) return readText(src.file).then(function (tx) { if (/[\x00-\x08\x0E-\x1F]/.test(tx.slice(0, 2000))) { toast('This is a binary file, so its columns cannot be re-mapped.', 'warn'); return null; } base.text = tx; return base; });
    return null;
  }
  function pasteImport(text, map) {
    text = String(text || '');
    if (!text.trim()) { toast('Nothing to import. Paste some data first.', 'warn'); return; }
    hideModal('paste');
    var trimmed = text.trim();
    if (trimmed[0] === '{') { try { var o = JSON.parse(trimmed); if (looksLikeProject(o)) { loadProjectObj(o, 'pasted project'); return; } } catch (e) { /* not JSON */ } }
    if (/^#?p=|[#&]p=/.test(trimmed) && trimmed.length > 40) { try { loadProjectObj(app.decodeShare(trimmed), 'shared link'); return; } catch (e) { /* not a link */ } }
    if (map || !PK.parsers || typeof PK.parsers.parseText !== 'function') { openFallback({ text: text, filename: 'Pasted data', kind: 'paste' }); return; }
    var res; try { res = PK.parsers.parseText(text, { filename: 'pasted.txt' }); } catch (e) { res = { ok: false, error: friendly(e) }; }
    handleParseResult(res, { text: text, filename: 'Pasted data', kind: 'paste' });
  }

  /* ================================================================== modals */
  var modalStack = [];
  function isOpen(name) { var el = $('modal-' + name); return !!el && !el.hidden; }
  function isDigitizerOpen() { return isOpen('digitizer'); }
  function showModal(name) {
    var el = $('modal-' + name); if (!el) return;
    if (el.hidden) { el._prevFocus = document.activeElement; el.hidden = false; modalStack.push(name); }
    setTimeout(function () {
      if (name === 'digitizer') return; // the digitizer manages its own focus
      var f = el.querySelector('.pk-modal-body input:not([type=hidden]), .pk-modal-body select, .pk-modal-body textarea, .pk-modal-body button, .pk-modal-body [tabindex="0"]');
      (f || el.querySelector('[data-close]')).focus();
    }, 30);
  }
  function hideModal(name) {
    var el = $('modal-' + name); if (!el || el.hidden) return;
    el.hidden = true; modalStack = modalStack.filter(function (n) { return n !== name; });
    if (name === 'digitizer' && !state.closingDigitizer && PK.digitizer && typeof PK.digitizer.close === 'function') {
      state.closingDigitizer = true; try { PK.digitizer.close(); } catch (e) { console.error(e); } state.closingDigitizer = false;
    }
    var pf = el._prevFocus; if (pf && pf.focus && document.contains(pf)) pf.focus();
  }
  app.showModal = showModal; app.hideModal = hideModal;
  function refreshOpenPanels() {
    if (!HAS_DOM) return;
    if (isOpen('method')) renderMethod();
    if (isOpen('export')) renderExport();
  }
  app.openPanel = function (name) {
    if (!HAS_DOM) return;
    switch (name) {
      case 'import': renderImportPanel(); showModal('import'); break;
      case 'digitizer': openDigitizer({}); break;
      case 'method': state.methodTab = 'method'; renderMethod(); showModal('method'); break;
      case 'runinfo': state.methodTab = 'run'; renderMethod(); showModal('method'); break;
      case 'export': renderExport(); showModal('export'); break;
      case 'share': renderShare(); showModal('share'); break;
      case 'paste': showModal('paste'); break;
      case 'help': renderHelp(); showModal('help'); break;
      case 'fallback': openFallback({}); break;
      default: console.warn('Unknown panel', name);
    }
  };
  function openDigitizer(arg) {
    if (!PK.digitizer || typeof PK.digitizer.open !== 'function') { toast('The image digitizer module did not load.', 'error'); return; }
    showModal('digitizer');
    try { var r = PK.digitizer.open(arg || {}); if (r && r.catch) r.catch(function (e) { toast('Digitizer error: ' + e.message, 'error'); }); }
    catch (e) { console.error(e); toast('Digitizer error: ' + e.message, 'error'); }
  }
  app.openDigitizer = openDigitizer;
  function renderImportPanel() {
    var host = $('import-root'); if (!host) return;
    host.innerHTML = '<div class="dropzone" style="max-width:none;margin-bottom:12px"><p style="margin-top:0">Drop files anywhere on the page, or</p><button class="btn primary" data-action="open-files">Choose files…</button>' +
      '<p class="small muted" style="margin-bottom:0">Several files at once are fine. Each becomes a trace you can overlay. A saved Peakly project (.json) opens as a project.</p></div>' +
      '<div class="row"><button class="btn" data-action="paste">Paste data…</button><button class="btn" data-action="image">Digitize an image or PDF…</button><button class="btn ghost" data-action="fallback">My format isn\'t working: map columns manually</button></div>' +
      '<h3>Supported formats</h3><div class="formats" style="justify-content:flex-start">' + formatsList() + '</div>' +
      '<p class="small muted">Files are read in this tab only. Nothing is uploaded.</p>';
  }

  /* ================================================================== method + run info */
  var TEMPLATES = {
    rp: { label: 'RP-HPLC (C18, 5→95 %B)', make: function () { return an('sampleMethod') ? PK.analysis.sampleMethod() : { name: 'RP-HPLC gradient', gradient: [{ t: 0, B: 5, flow: 1 }, { t: 20, B: 95, flow: 1 }, { t: 23, B: 95, flow: 1 }, { t: 23, B: 5, flow: 1 }, { t: 30, B: 5, flow: 1 }], gradientType: 'organic', solventA: 'Water + 0.1% FA', solventB: 'Acetonitrile + 0.1% FA', column: { name: 'C18', length_mm: 150, id_mm: 4.6, particle_um: 5, porosity: 0.65 }, flow: 1, dwellVolume_mL: 1.1, wavelength_nm: 254, temperature_C: 30 }; } },
    imac: { label: 'IMAC His-tag (imidazole)', make: function () { return an('sampleFPLCMethod') ? PK.analysis.sampleFPLCMethod() : { name: 'IMAC', gradient: [{ t: 0, B: 0, flow: 1 }, { t: 10, B: 0, flow: 1 }, { t: 30, B: 100, flow: 1 }], gradientType: 'imidazole', bMaxConc: 500, bConcUnit: 'mM', column: { length_mm: 25, id_mm: 7, porosity: 0.35 }, flow: 1, dwellVolume_mL: 0.6, wavelength_nm: 280 }; } },
    iso: { label: 'Isocratic', make: function () { return { name: 'Isocratic', gradient: [{ t: 0, B: 40, flow: 1 }, { t: 15, B: 40, flow: 1 }], gradientType: 'isocratic', solventA: 'Water', solventB: 'Methanol', column: { name: 'C18', length_mm: 150, id_mm: 4.6, particle_um: 5, porosity: 0.65 }, flow: 1, dwellVolume_mL: 1, wavelength_nm: 254, temperature_C: 30 }; } },
    blank: { label: 'Blank', make: function () { return blankMethod(); } }
  };
  function mField(path, label, type, extra) {
    var v = getPath(P().method, path); if (v == null) v = '';
    if (type === 'textarea') return '<label class="field"><span>' + label + '</span><textarea data-m="' + path + '" rows="3" style="font-family:inherit">' + esc(v) + '</textarea></label>';
    return '<label class="field"><span>' + label + '</span><input type="' + (type || 'text') + '" data-m="' + path + '" value="' + esc(v) + '"' + (type === 'number' ? ' step="any"' : '') + (extra || '') + '></label>';
  }
  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, path, v) { var ks = path.split('.'), last = ks.pop(); ks.forEach(function (k) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[last] = v; }
  function renderMethod() {
    var host = $('method-root'); if (!host) return;
    var tab = state.methodTab || 'method';
    host.innerHTML = '<div class="row" role="tablist" style="margin-bottom:12px"><button class="btn sm" role="tab" data-mtab="method" aria-selected="' + (tab === 'method') + '"' + (tab === 'method' ? ' aria-pressed="true"' : '') + '>Method &amp; gradient</button>' +
      '<button class="btn sm" role="tab" data-mtab="run" aria-selected="' + (tab === 'run') + '"' + (tab === 'run' ? ' aria-pressed="true"' : '') + '>Run info</button></div><div id="mtab-body"></div>';
    if (tab === 'run') renderRunInfo(); else renderMethodTab();
  }
  function renderMethodTab() {
    var host = $('mtab-body'), m = P().method, salt = m.gradientType === 'salt' || m.gradientType === 'imidazole', autoT0 = autoVoidTime(m), aT0 = an('voidTime');
    if (aT0) { try { var tmp = clone(m); tmp.voidTime_min = null; var v0 = aT0(tmp); if (isNum(v0)) autoT0 = v0; } catch (e) { /* keep */ } }
    host.innerHTML = '<div class="split"><div>' +
      '<div class="row" style="margin-bottom:8px"><select id="m-tpl" aria-label="Method template">' + Object.keys(TEMPLATES).map(function (k) { return '<option value="' + k + '">' + esc(TEMPLATES[k].label) + '</option>'; }).join('') + '</select><button class="btn sm" id="m-tpl-apply">Apply template</button></div>' +
      mField('name', 'Method name') +
      '<div class="grid2"><label class="field"><span>Gradient type</span><select data-m="gradientType"><option value="organic">Organic (%B)</option><option value="salt">Salt (concentration)</option><option value="imidazole">Imidazole (concentration)</option><option value="isocratic">Isocratic</option></select></label>' +
      '<label class="field"><span>Between rows</span><select data-m="mode"><option value="linear">Linear ramps</option><option value="step">Hold until next row (steps)</option></select></label></div>' +
      (salt ? '<div class="grid2">' + mField('bMaxConc', 'Concentration at 100 % B', 'number') + '<label class="field"><span>Unit</span><select data-m="bConcUnit"><option>mM</option><option>M</option><option>%</option></select></label></div>' : '') +
      '<div class="grid2">' + mField('solventA', 'Solvent A') + mField('solventB', 'Solvent B') + '</div>' +
      '<div class="grid3">' + mField('bufferPH', 'Buffer pH', 'number') + mField('wavelength_nm', 'Wavelength (nm)', 'number') + mField('temperature_C', 'Temperature (°C)', 'number') + '</div>' +
      '<h3>Column</h3><div class="grid3">' + mField('column.name', 'Name / chemistry') + mField('column.length_mm', 'Length (mm)', 'number', ' min="0"') + mField('column.id_mm', 'ID (mm)', 'number', ' min="0"') +
      mField('column.particle_um', 'Particle (µm)', 'number', ' min="0"') + mField('column.porosity', 'Total porosity ε', 'number', ' min="0" max="1"') + '</div>' +
      '<h3>Flow &amp; timing</h3><div class="grid3">' + mField('flow', 'Flow (mL/min)', 'number', ' min="0"') + mField('dwellVolume_mL', 'Dwell volume (mL)', 'number', ' min="0"') +
      mField('voidTime_min', 'Void time override (min)', 'number', ' min="0" placeholder="auto: ' + esc(isNum(autoT0) ? fmt(autoT0, 4) : '—') + '"') + '</div>' +
      '<dl class="kv" id="m-derived"></dl>' + mField('notes', 'Notes', 'textarea') +
      '</div><div>' +
      '<h3 style="margin-top:0">Gradient program</h3><p class="small muted" style="margin-top:0">Time is pump (program) time. Two rows at the same time make a step. %B is linear between rows unless "steps" is chosen.</p>' +
      '<table class="grad" id="m-grad"></table>' +
      '<div class="row" style="margin:8px 0"><button class="btn sm" id="g-add">+ Row</button><button class="btn sm" id="g-step" title="Duplicate the last time so the next %B is a step">+ Step</button><button class="btn sm ghost" id="g-sort">Sort by time</button></div>' +
      '<svg class="mini-plot" id="m-preview" viewBox="0 0 400 160" preserveAspectRatio="none" role="img" aria-label="Gradient preview"></svg>' +
      '<p class="small muted" id="m-summary"></p>' +
      '<label class="inline"><input type="checkbox" id="m-incvoid"' + (P().settings.gradientIncludeVoid ? ' checked' : '') + '> On the plot, delay the gradient by dwell time + void time (what reaches the detector)</label>' +
      '</div></div>';
    toArr(host.querySelectorAll('select[data-m]')).forEach(function (s) { var v = getPath(m, s.getAttribute('data-m')); if (v != null) s.value = v; });
    renderGradTable(); updateMethodDerived();
  }
  function renderGradTable() {
    var tb = $('m-grad'); if (!tb) return; var g = P().method.gradient, ci = concInfo(P().method);
    tb.innerHTML = '<thead><tr><th>Time (min)</th><th>%B' + (ci ? ' (' + ci.unit + ')' : '') + '</th><th>Flow (mL/min)</th><th></th></tr></thead><tbody>' +
      (g.length ? g.map(function (r, i) {
        return '<tr><td><input type="number" step="any" data-g="' + i + '.t" value="' + esc(r.t) + '" aria-label="Row ' + (i + 1) + ' time"></td><td><input type="number" step="any" min="0" max="100" data-g="' + i + '.B" value="' + esc(r.B) + '" aria-label="Row ' + (i + 1) + ' percent B"></td>' +
          '<td><input type="number" step="any" min="0" data-g="' + i + '.flow" value="' + esc(r.flow == null ? '' : r.flow) + '" placeholder="' + esc(P().method.flow || '') + '" aria-label="Row ' + (i + 1) + ' flow"></td><td><button class="btn ghost sm icon danger" data-gdel="' + i + '" aria-label="Remove row ' + (i + 1) + '">&#10005;</button></td></tr>';
      }).join('') : '<tr><td colspan="4" class="muted small">No gradient rows. Add rows, or apply a template.</td></tr>') + '</tbody>';
  }
  function updateMethodDerived() {
    var m = P().method, dl = $('m-derived'), pv = $('m-preview'), sm = $('m-summary'); if (!dl) return;
    var tD = dwellTime(m), t0 = voidTime(m), fl = methodFlow(m);
    dl.innerHTML = '<dt>Dwell time t_D = V_D/F</dt><dd>' + esc(fl ? fmt(tD, 4) + ' min' : '— (set flow)') + '</dd>' +
      '<dt>Void time t₀' + (m.voidTime_min ? ' (override)' : ' = ε·π·(ID/2)²·L/F') + '</dt><dd>' + esc(isNum(t0) ? fmt(t0, 4) + ' min' : '— (set column & flow)') + '</dd>' +
      '<dt>Caption</dt><dd style="font-family:inherit">' + esc(captionText() || '—') + '</dd>';
    if (sm) sm.textContent = hasGradient(m) ? 'Summary: ' + gradientSummary(m) : '';
    if (pv) {
      if (!hasGradient(m)) { pv.innerHTML = svgLines([], 400, 160); return; }
      var r = sortedRows(m), tMax = Math.max(r[r.length - 1].t + tD + (isNum(t0) ? t0 : 0), 1) * 1.08, ci = concInfo(m);
      var prog = { x: [], y: [], color: '#7f7f7f' }, n = 300;
      for (var i = 0; i <= n; i++) { var t = tMax * i / n; prog.x.push(t); prog.y.push(gradientAtLocal(m, t)); }
      var gc = gradientCurve(m, tMax, 300);
      pv.innerHTML = svgLines([{ x: [0, tMax], y: [0, 100], color: 'transparent' }, prog, { x: toArr(gc.t), y: toArr(gc.B), color: '#1f4fd8' }], 400, 160) +
        '<text x="6" y="14" font-size="11" fill="currentColor" opacity=".7">grey: program · blue: at detector' + (ci ? '' : ' (%B 0–100)') + '</text>';
    }
  }
  var methodChanged = debounce(function () { state.cache = {}; renderPlot(); renderTable(); renderPlotTools(); renderNotices(); }, 150);
  var mSession = null, mTimer = null;
  function beginMethodEdit(el) { if (mSession !== el) { app.pushUndo('Edit method'); mSession = el; } clearTimeout(mTimer); mTimer = setTimeout(function () { mSession = null; }, 1500); }
  function bindMethod() {
    var host = $('method-root');
    function onInput(e) {
      var el = e.target, m = P().method;
      if (el.hasAttribute('data-m')) {
        beginMethodEdit(el);
        var path = el.getAttribute('data-m'), v = el.value;
        if (el.type === 'number') v = el.value === '' ? null : num(el.value, null);
        setPath(m, path, v);
        if (path === 'gradientType' || path === 'mode') { renderMethodTab(); }
        updateMethodDerived(); methodChanged();
      } else if (el.hasAttribute('data-g')) {
        beginMethodEdit(el);
        var parts = el.getAttribute('data-g').split('.'), row = m.gradient[+parts[0]]; if (!row) return;
        row[parts[1]] = el.value === '' ? (parts[1] === 'flow' ? null : 0) : num(el.value, 0);
        updateMethodDerived(); methodChanged();
      } else if (el.hasAttribute('data-r')) {
        beginMethodEdit(el);
        var scope = el.getAttribute('data-rscope'), key = el.getAttribute('data-r');
        var target = scope === 'project' ? m.run : (traceById(scope) || {}).meta;
        if (!target) return;
        if (scope !== 'project') { target.run = target.run || {}; target = target.run; }
        if (el.value === '') delete target[key]; else target[key] = el.value;
        methodChanged();
      }
    }
    host.addEventListener('input', function (e) { if (e.target.tagName !== 'SELECT') onInput(e); });
    host.addEventListener('change', function (e) {
      if (e.target.tagName === 'SELECT' && (e.target.hasAttribute('data-m'))) onInput(e);
      if (e.target.id === 'm-incvoid') { app.pushUndo('Gradient delay option'); P().settings.gradientIncludeVoid = e.target.checked; updateMethodDerived(); methodChanged(); }
      if (e.target.id === 'ri-trace') { state.runTrace = e.target.value; renderRunInfo(); }
      mSession = null;
    });
    host.addEventListener('click', function (e) {
      var id = e.target.id, m = P().method, tb = e.target.closest('[data-mtab]');
      if (tb) { state.methodTab = tb.getAttribute('data-mtab'); renderMethod(); return; }
      if (id === 'm-tpl-apply') {
        var k = $('m-tpl').value, tpl = TEMPLATES[k]; if (!tpl) return;
        if (hasGradient(m) && !window.confirm('Replace the current method with the "' + tpl.label + '" template?')) return;
        app.pushUndo('Apply method template'); var run = m.run; P().method = mergeDeep(blankMethod(), tpl.make()); P().method.run = run || {};
        renderMethodTab(); methodChanged(); toast('Applied template: ' + tpl.label, 'ok');
      } else if (id === 'g-add') {
        app.pushUndo('Add gradient row'); var last = m.gradient[m.gradient.length - 1];
        m.gradient.push(last ? { t: +last.t + 5, B: last.B, flow: last.flow } : { t: 0, B: 5, flow: null }); renderGradTable(); updateMethodDerived(); methodChanged();
      } else if (id === 'g-step') {
        app.pushUndo('Add gradient step'); var l2 = m.gradient[m.gradient.length - 1];
        m.gradient.push(l2 ? { t: l2.t, B: l2.B, flow: l2.flow } : { t: 0, B: 0, flow: null }); renderGradTable(); updateMethodDerived(); methodChanged();
        var ins = $('m-grad').querySelectorAll('input[data-g$=".B"]'); if (ins.length) ins[ins.length - 1].focus();
      } else if (id === 'g-sort') {
        app.pushUndo('Sort gradient'); m.gradient = sortedRows(m).map(function (r) { return { t: r.t, B: r.B, flow: r.flow }; }); renderGradTable(); updateMethodDerived(); methodChanged();
      } else if (e.target.closest('[data-gdel]')) {
        var i = +e.target.closest('[data-gdel]').getAttribute('data-gdel'); app.pushUndo('Remove gradient row'); m.gradient.splice(i, 1); renderGradTable(); updateMethodDerived(); methodChanged();
      } else if (id === 'ri-prefill') {
        var t = traceById(state.runTrace); if (!t) return; app.pushUndo('Pre-fill run info');
        t.meta.run = mergeDeep(runFromMeta(t.meta), t.meta.run || {}); renderRunInfo(); toast('Filled empty fields from the file metadata', 'ok');
      } else if (id === 'ri-copy') {
        var t2 = traceById(state.runTrace); if (!t2) return; app.pushUndo('Apply run info to all traces');
        P().traces.forEach(function (o) { if (o !== t2 && !isAux(o)) { o.meta.run = mergeDeep(clone(o.meta.run || {}), {}); RUN_FIELDS.forEach(function (f) { if (t2.meta.run && t2.meta.run[f[0]] && f[0] !== 'sampleName' && f[0] !== 'sampleId') o.meta.run[f[0]] = t2.meta.run[f[0]]; }); } });
        toast('Copied instrument/column/method/operator fields to all traces', 'ok');
      }
    });
  }
  function effectiveRun(t) { return mergeDeep(clone(P().method.run || {}), (t && t.meta && t.meta.run) || {}); }
  app.effectiveRun = effectiveRun;
  function renderRunInfo() {
    var host = $('mtab-body'); if (!host) return;
    var mains = P().traces.filter(function (t) { return !isAux(t); });
    if (!traceById(state.runTrace) || isAux(traceById(state.runTrace))) state.runTrace = (activeTrace() && !isAux(activeTrace())) ? P().activeTraceId : (mains[0] && mains[0].id);
    var t = traceById(state.runTrace), d = P().method.run || {};
    function fields(scope, obj, ph) {
      return '<div class="grid2">' + RUN_FIELDS.map(function (f) {
        var v = obj && obj[f[0]] != null ? obj[f[0]] : '', p = ph && ph[f[0]] ? ' placeholder="' + esc(ph[f[0]]) + ' (default)"' : '';
        return f[0] === 'notes' ? '<label class="field" style="grid-column:1/-1"><span>' + esc(f[1]) + '</span><textarea rows="2" style="font-family:inherit" data-r="notes" data-rscope="' + esc(scope) + '"' + p + '>' + esc(v) + '</textarea></label>'
          : '<label class="field"><span>' + esc(f[1]) + '</span><input type="text" data-r="' + f[0] + '" data-rscope="' + esc(scope) + '" value="' + esc(v) + '"' + p + '></label>';
      }).join('') + '</div>';
    }
    var metaKeys = t ? Object.keys(t.meta).filter(function (k) { var v = t.meta[k]; return k !== 'run' && k[0] !== '_' && v != null && typeof v !== 'object'; }) : [];
    host.innerHTML = '<div class="split"><div>' +
      '<h3 style="margin-top:0">Per-trace run info</h3>' +
      (t ? '<div class="row" style="margin-bottom:8px"><select id="ri-trace" aria-label="Trace">' + mains.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === t.id ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select>' +
        '<button class="btn sm" id="ri-prefill" title="Fill empty fields from metadata found in the file">Pre-fill from file</button><button class="btn sm ghost" id="ri-copy" title="Copy instrument, column, method and operator to the other traces">Copy to all traces</button></div>' +
        fields(t.id, t.meta.run || {}, d) +
        (metaKeys.length ? '<details><summary class="small muted">Metadata found in the file (' + metaKeys.length + ')</summary><table class="plain small">' + metaKeys.slice(0, 80).map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + esc(String(t.meta[k]).slice(0, 120)) + '</td></tr>'; }).join('') + '</table></details>' : '')
        : '<p class="muted">No traces yet.</p>') +
      '</div><div><h3 style="margin-top:0">Project defaults</h3><p class="small muted" style="margin-top:0">Used for any field a trace leaves empty (shown as placeholders on the left).</p>' + fields('project', d, null) + '</div></div>';
  }

  /* ================================================================== export */
  state.exp = { w: 1200, h: 600, scale: 2, grad: true, ghost: true, scope: 'visible' };
  function renderExport() {
    var host = $('export-root'); if (!host) return; var e = state.exp, s = P().settings;
    var hasPlotly = typeof Plotly !== 'undefined', hasPdf = !!(typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF);
    host.innerHTML = '<div class="split"><div>' +
      '<div class="section"><h3>Figure</h3>' + (hasPlotly ? '' : '<p class="note error">Plotting library not loaded. Figure export is unavailable.</p>') +
      '<div class="grid3"><label class="field"><span>Width (px)</span><input type="number" id="ex-w" min="300" max="6000" value="' + e.w + '"></label><label class="field"><span>Height (px)</span><input type="number" id="ex-h" min="200" max="6000" value="' + e.h + '"></label><label class="field"><span>Scale (PNG)</span><input type="number" id="ex-s" min="1" max="6" step="0.5" value="' + e.scale + '"></label></div>' +
      '<div class="row"><label class="inline"><input type="checkbox" id="ex-grad"' + (e.grad ? ' checked' : '') + '> Gradient</label><label class="inline"><input type="checkbox" id="ex-ghost"' + (e.ghost ? ' checked' : '') + '> Source image behind digitized traces</label>' +
      '<label class="inline"><input type="checkbox" id="ex-cap"' + (s.caption !== false ? ' checked' : '') + '> Method caption</label></div>' +
      '<p class="small muted">White background, black axes. The title is the project name (click the plot title to edit it).</p>' +
      '<div class="row"><button class="btn primary" data-ex="png"' + (hasPlotly ? '' : ' disabled') + '>Download PNG</button><button class="btn" data-ex="svg"' + (hasPlotly ? '' : ' disabled') + '>Download SVG</button></div></div>' +
      '<div class="section"><h3>Report</h3><p class="small muted">PDF with method, run info, figure, peak tables' + (state.view === 'compare' ? ', cross-trace comparison' : '') + ', and audit notes (formulas, processing settings, digitized-data disclaimer).</p>' +
      '<button class="btn primary" data-ex="pdf"' + (hasPdf ? '' : ' disabled title="jsPDF did not load"') + '>Download PDF report</button></div>' +
      '</div><div>' +
      '<div class="section"><h3>Tables &amp; data</h3>' +
      '<div class="row"><button class="btn" data-ex="peaks">Peak table (CSV): active trace</button><button class="btn" data-ex="peaks-all">Peak tables (CSV): all visible</button></div>' +
      '<div class="row" style="margin-top:6px"><button class="btn" data-ex="compare">Comparison table (CSV)</button></div>' +
      '<div class="row" style="margin-top:10px"><label class="inline">Traces <select id="ex-scope"><option value="active">active</option><option value="visible">visible</option><option value="all">all</option></select></label>' +
      '<button class="btn" data-ex="xy-csv">x,y CSV</button><button class="btn" data-ex="xy-json">JSON</button></div>' +
      '<p class="small muted">Digitized traces are flagged in headers along with their ± uncertainty.</p></div>' +
      '<div class="section"><h3>Project</h3><p class="small muted">Saves traces, method, run info, settings, peaks, processing and source images in one .json file you can reopen later.</p>' +
      '<div class="row"><button class="btn primary" data-ex="save">Save project…</button><button class="btn" data-ex="load">Open project…</button></div></div>' +
      '</div></div>';
    $('ex-scope').value = e.scope;
  }
  function bindExport() {
    var host = $('export-root');
    host.addEventListener('change', function (ev) {
      var e = state.exp, id = ev.target.id;
      if (id === 'ex-w') e.w = U.clamp(num(ev.target.value, 1200), 300, 6000);
      else if (id === 'ex-h') e.h = U.clamp(num(ev.target.value, 600), 200, 6000);
      else if (id === 'ex-s') e.scale = U.clamp(num(ev.target.value, 2), 1, 6);
      else if (id === 'ex-grad') e.grad = ev.target.checked;
      else if (id === 'ex-ghost') e.ghost = ev.target.checked;
      else if (id === 'ex-scope') e.scope = ev.target.value;
      else if (id === 'ex-cap') { app.pushUndo('Toggle caption'); P().settings.caption = ev.target.checked; renderPlot(); }
    });
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ex]'); if (!b) return; var k = b.getAttribute('data-ex');
      try {
        if (k === 'png' || k === 'svg') exportFigure(k);
        else if (k === 'pdf') exportPDF();
        else if (k === 'peaks') downloadPeaks([activeTrace()]);
        else if (k === 'peaks-all') downloadPeaks(P().traces.filter(function (t) { return !isAux(t) && t.style.visible !== false; }));
        else if (k === 'compare') U.downloadText(compareCSV(), fileSafe(P().name) + '_comparison.csv', 'text/csv');
        else if (k === 'xy-csv' || k === 'xy-json') exportXY(k === 'xy-json' ? 'json' : 'csv');
        else if (k === 'save') saveProject();
        else if (k === 'load') $('project-input').click();
      } catch (err) { console.error(err); toast('Export failed: ' + err.message, 'error'); }
    });
  }
  function dataURLtoBlob(url) {
    var m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/); if (!m) return new Blob([url]);
    if (m[2]) { var bin = atob(m[3]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: m[1] }); }
    return new Blob([decodeURIComponent(m[3])], { type: m[1] });
  }
  function figureImage(fmtName, w, h, scale, o) {
    o = o || {};
    var fig = buildFigure({ export: true, includeGradient: o.grad !== false && P().settings.showGradient !== false, includeGhost: !!o.ghost, width: w, height: h });
    return Plotly.toImage({ data: fig.data, layout: fig.layout, config: { displayModeBar: false } }, { format: fmtName, width: w, height: h, scale: scale || 1 });
  }
  function exportFigure(kind) {
    if (typeof Plotly === 'undefined') { toast('Plotly is not loaded.', 'error'); return; }
    if (isEmpty()) { toast('Nothing to export yet.', 'warn'); return; }
    var e = state.exp;
    figureImage(kind, e.w, e.h, kind === 'svg' ? 1 : e.scale, { grad: e.grad, ghost: e.ghost }).then(function (url) {
      U.downloadBlob(dataURLtoBlob(url), fileSafe(P().name) + '.' + kind); toast('Saved ' + kind.toUpperCase(), 'ok');
    }, function (err) { toast('Image export failed: ' + err.message, 'error'); });
  }
  function procSummary(t) {
    var p = t.proc;
    return 'SG ' + (p.smooth.on ? 'window ' + p.smooth.window + ', order ' + p.smooth.order : 'off') + '; ALS baseline ' + (p.baseline.on ? 'λ=' + fmt(p.baseline.lambda, 3) + (p.baseline.lambdaAuto ? ' (auto)' : '') + ', p=' + p.baseline.p + ', ' + p.baseline.iter + ' iter' : 'off') +
      '; peaks threshold=' + p.peaks.threshold + ', minDist=' + p.peaks.minDist + ', minWidth=' + p.peaks.minWidth;
  }
  function peakRows(t) {
    var ms = withAreaPct(metricsFor(t)), ctx = tableCtx(t);
    return t.peaks.map(function (pk, i) {
      var m = ms[i] || {}, fc = fitComp(t, pk, i);
      return { i: i + 1, name: pk.label || '', rt: m.rt, unc: t.digitized ? t.digitized.dxMin : null, start: pk.start, end: pk.end, pctB: cellValue('pctB', t, pk, m, i, ctx), height: m.height, area: m.area, areaPct: m.areaPct,
        fwhm: m.fwhm, tailing: m.tailing, plates: m.plates, resolution: m.resolution, sn: m.sn, k: cellValue('kprime', t, pk, m, i, ctx), fitArea: fc ? fc.area : null, fitSE: fc ? fc.areaSE : null, manual: !!pk.manual };
    });
  }
  function peakCSV(t) {
    var L = [], xu = t.xUnit, ci = concInfo(P().method), F = (PK.analysis && PK.analysis.FORMULAS) || {};
    L.push('# Peakly ' + (PK.version || '') + ' peak table');
    L.push('# Trace: ' + t.name + ' | source: ' + [t.source.kind, t.source.format, t.source.filename].filter(Boolean).join(', '));
    L.push('# Exported: ' + new Date().toISOString());
    L.push('# Units: RT/start/end/W_half [' + xu + ']; height [' + t.yUnit + ']; area [' + t.yUnit + '*' + xu + ']; ' + (ci ? 'elution conc [' + ci.unit + ']' : '%B at elution [%]'));
    L.push('# Processing: ' + procSummary(t));
    ['area', 'fwhm', 'tailing', 'plates', 'resolution', 'sn', 'k', 'Bat'].forEach(function (k) { if (F[k]) L.push('# ' + (F[k].name || k) + ': ' + F[k].expr); });
    L.push('# Integration: trapezoid above a straight drop-line between the signal at start and end.');
    if (t.digitized) L.push('# DIGITIZED from an image: values are estimates. RT uncertainty +/-' + t.digitized.dxMin + ' ' + xu + ', y uncertainty +/-' + t.digitized.dy + ' ' + t.yUnit + ' (pixel size).');
    var cols = ['#', 'name', 'RT_' + xu, 'RT_uncertainty_' + xu, 'start_' + xu, 'end_' + xu, ci ? 'elution_' + ci.unit : 'pctB_elution', 'height', 'area', 'area_pct', 'W_half_' + xu, 'tailing_USP', 'plates_N', 'Rs', 'S_N', 'k_prime', 'fit_area', 'fit_area_SE', 'digitized', 'manual'];
    L.push(cols.join(','));
    peakRows(t).forEach(function (r) {
      L.push([r.i, r.name, r.rt, r.unc, r.start, r.end, r.pctB, r.height, r.area, r.areaPct, r.fwhm, r.tailing, r.plates, r.resolution, r.sn, r.k, r.fitArea, r.fitSE, t.digitized ? 'yes' : 'no', r.manual ? 'yes' : 'no']
        .map(function (v) { return csvCell(typeof v === 'number' ? (isFinite(v) ? +v.toPrecision(8) : '') : v == null ? '' : v); }).join(','));
    });
    return L.join('\n') + '\n';
  }
  function downloadPeaks(ts) {
    ts = ts.filter(function (t) { return t && !isAux(t); });
    if (!ts.length) { toast('No chromatogram trace to export.', 'warn'); return; }
    U.downloadText(ts.map(peakCSV).join('\n'), fileSafe(ts.length === 1 ? ts[0].name : P().name) + '_peaks.csv', 'text/csv');
  }
  app.peakCSV = function (traceId) { var t = traceById(traceId) || activeTrace(); return t ? peakCSV(t) : ''; };
  function scopeTraces(scope) {
    var p = P(); if (scope === 'active') return activeTrace() ? [activeTrace()] : [];
    if (scope === 'all') return p.traces.slice();
    return p.traces.filter(function (t) { return t.style.visible !== false; });
  }
  function exportXY(kind) {
    var ts = scopeTraces(state.exp.scope); if (!ts.length) { toast('No traces to export.', 'warn'); return; }
    if (kind === 'json') {
      var o = { app: 'Peakly', version: PK.version, exported: new Date().toISOString(), traces: ts.map(function (t) {
        var pr = processed(t); return { name: t.name, xUnit: t.xUnit, yUnit: t.yUnit, source: t.source, digitized: t.digitized ? { dxMin: t.digitized.dxMin, dy: t.digitized.dy, note: 'digitized from an image; values are estimates' } : false,
          run: effectiveRun(t), x: t.x, y: t.y, yProcessed: pr.y, peaks: t.peaks };
      }) };
      U.downloadText(JSON.stringify(o), fileSafe(P().name) + '_traces.json', 'application/json'); return;
    }
    var L = ['# Peakly ' + (PK.version || '') + ' trace data (long format). y = raw signal, y_processed = smoothed & baseline-corrected.'];
    ts.forEach(function (t) { L.push('# ' + t.name + ': x [' + t.xUnit + '], y [' + t.yUnit + ']' + (t.digitized ? '; DIGITIZED from an image, uncertainty +/-' + t.digitized.dxMin + ' ' + t.xUnit + ', +/-' + t.digitized.dy + ' ' + t.yUnit : '')); });
    L.push('trace,x,y,y_processed,digitized');
    ts.forEach(function (t) { var pr = processed(t), nm = csvCell(t.name), dg = t.digitized ? 'yes' : 'no'; for (var i = 0; i < t.x.length; i++) L.push(nm + ',' + t.x[i] + ',' + t.y[i] + ',' + (+pr.y[i].toPrecision(10)) + ',' + dg); });
    U.downloadText(L.join('\n') + '\n', fileSafe(P().name) + '_traces.csv', 'text/csv');
  }
  function saveProject() {
    var p = clone(P()); p.format = FORMAT_TAG; p.version = 1; p.app = 'Peakly'; p.peaklyVersion = PK.version; p.saved = new Date().toISOString();
    p.traces.forEach(function (t) { if (t.meta) delete t.meta._src; });
    U.downloadText(JSON.stringify(p), fileSafe(p.name) + '.peakly.json', 'application/json');
    toast('Project saved (' + Math.round(JSON.stringify(p).length / 1024) + ' KB)', 'ok');
  }
  app.saveProject = saveProject;

  /* ---------------- PDF report */
  var PDF_MAP = { '−': '-', '–': '-', '—': '-', 'λ': 'lambda', '√': 'sqrt', '∑': 'sum', 'Σ': 'sum', 'Δ': 'd', '≈': '~', 'σ': 'sigma', 'τ': 'tau', 'ε': 'eps', 'π': 'pi', '₀': '0', '₁': '1', '₂': '2', '′': "'", '→': '->', '≥': '>=', '≤': '<=', '⁴': '^4', 'ᵢ': 'i', '₊': '+', 'ᵀ': 'T', '⁻': '-', '·': '·', '…': '...', '’': "'", '“': '"', '”': '"' };
  function pdfSafe(s) { return String(s == null ? '' : s).replace(/[^\x00-\xff]/g, function (c) { return PDF_MAP[c] != null ? PDF_MAP[c] : '?'; }); }
  function exportPDF() {
    var J = window.jspdf && window.jspdf.jsPDF; if (!J) { toast('The PDF library (jsPDF) did not load.', 'error'); return; }
    if (isEmpty()) { toast('Nothing to report yet.', 'warn'); return; }
    toast('Building PDF…', 'info');
    var imgP = typeof Plotly !== 'undefined' ? figureImage('png', 1600, 800, 1, { grad: true, ghost: false }).catch(function () { return null; }) : Promise.resolve(null);
    imgP.then(function (img) {
      var doc = new J({ unit: 'mm', format: 'a4' }), W = 210, H = 297, M = 14, y = M, CW = W - 2 * M, p = P();
      function need(h) { if (y + h > H - 14) { doc.addPage(); y = M; } }
      function text(s, size, style, color) { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size || 9); if (Array.isArray(color)) doc.setTextColor(color[0], color[1], color[2]); else doc.setTextColor(color || 0); var lines = doc.splitTextToSize(pdfSafe(s), CW); need(lines.length * size * 0.42 + 1); doc.text(lines, M, y + size * 0.35); y += lines.length * size * 0.42 + 1.2; }
      function h2(s) { y += 2; need(10); text(s, 12, 'bold'); doc.setDrawColor(180); doc.line(M, y, M + CW, y); y += 2; }
      function table(cols, rows, widths, size) {
        size = size || 7.5; var rh = size * 0.5 + 1.6, tw = widths.reduce(function (a, b) { return a + b; }, 0), k = CW / tw;
        widths = widths.map(function (w) { return w * k; });
        function header() { need(rh * 2); doc.setFillColor(236, 239, 244); doc.rect(M, y, CW, rh, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(0); var x = M; cols.forEach(function (c, i) { doc.text(doc.splitTextToSize(pdfSafe(c), widths[i] - 1)[0] || '', x + 0.8, y + rh - 1.3); x += widths[i]; }); y += rh; }
        header(); doc.setFont('helvetica', 'normal');
        rows.forEach(function (r) {
          if (y + rh > H - 14) { doc.addPage(); y = M; header(); doc.setFont('helvetica', 'normal'); }
          var x = M; r.forEach(function (c, i) { doc.text((doc.splitTextToSize(pdfSafe(c), widths[i] - 1)[0]) || '', x + 0.8, y + rh - 1.3); x += widths[i]; });
          doc.setDrawColor(225); doc.line(M, y + rh, M + CW, y + rh); y += rh;
        });
        y += 2;
      }
      var mains = p.traces.filter(function (t) { return !isAux(t) && t.style.visible !== false; }), anyDig = p.traces.some(function (t) { return t.digitized; });
      text(isDefaultTitle(p.name) ? 'Chromatogram report' : p.name, 17, 'bold');
      text('Generated ' + new Date().toLocaleString() + ' with Peakly ' + (PK.version || '') + ' (runs in the browser; no data leaves your computer)', 8.5, 'normal', 90);
      if (anyDig) text('Contains DIGITIZED data reconstructed from an image. Values are estimates (see uncertainty notes).', 9, 'bold', [180, 83, 9]);
      // method
      var m = p.method, c = m.column || {}, t0 = voidTime(m), ci = concInfo(m);
      h2('Method');
      var mrows = [['Method', m.name], ['Gradient', hasGradient(m) ? gradientSummary(m) + ' (' + m.gradientType + ', ' + (m.mode || 'linear') + ')' : '—'], ['Solvent A / B', [m.solventA, m.solventB].filter(Boolean).join(' / ')], ['Buffer pH', m.bufferPH],
        ['Column', [c.name, c.length_mm && c.id_mm ? c.length_mm + ' x ' + c.id_mm + ' mm' : '', c.particle_um ? c.particle_um + ' um' : '', c.porosity ? 'eps ' + c.porosity : ''].filter(Boolean).join(', ')],
        ['Flow', methodFlow(m) ? methodFlow(m) + ' mL/min' : ''], ['Dwell volume / time', m.dwellVolume_mL ? m.dwellVolume_mL + ' mL / ' + fmt(dwellTime(m), 4) + ' min' : ''], ['Void time t0', isNum(t0) ? fmt(t0, 4) + ' min' + (m.voidTime_min ? ' (override)' : ' (from column geometry)') : ''],
        ['Detection', m.wavelength_nm ? m.wavelength_nm + ' nm' : ''], ['Temperature', m.temperature_C != null && m.temperature_C !== '' ? m.temperature_C + ' C' : ''], ['Notes', m.notes]].filter(function (r) { return r[1] != null && String(r[1]).trim() !== ''; });
      table(['Parameter', 'Value'], mrows.map(function (r) { return [r[0], String(r[1])]; }), [45, 137]);
      if (hasGradient(m)) table(['Time (min)', ci ? '%B (' + ci.unit + ')' : '%B', 'Flow (mL/min)'], m.gradient.map(function (r) { return [fmt(r.t, 5), fmt(r.B, 4) + (ci ? ' (' + fmt(r.B * ci.k, 4) + ')' : ''), r.flow != null ? fmt(r.flow, 4) : '']; }), [40, 40, 40]);
      // run info
      var runRows = [];
      mains.forEach(function (t) { var r = effectiveRun(t); RUN_FIELDS.forEach(function (f) { if (r[f[0]]) runRows.push([t.name, f[1], String(r[f[0]])]); }); });
      if (runRows.length) { h2('Run information'); table(['Trace', 'Field', 'Value'], runRows, [55, 40, 87]); }
      // figure
      if (img) { h2('Chromatogram'); need(CW / 2 + 4); doc.addImage(img, 'PNG', M, y, CW, CW / 2, undefined, 'FAST'); y += CW / 2 + 3; }
      else text('(Figure unavailable: plotting library not loaded.)', 9, 'italic');
      // peak tables
      mains.forEach(function (t) {
        if (!t.peaks.length) return;
        h2('Peaks: ' + t.name + (t.digitized ? ' [digitized, RT +/-' + fmt(t.digitized.dxMin, 2) + ' ' + t.xUnit + ']' : ''));
        var rows = peakRows(t), hasB = rows.some(function (r) { return isNum(r.pctB); }), hasK = rows.some(function (r) { return isNum(r.k); });
        var cols = ['#', 'Name', 'RT', hasB ? (ci ? ci.unit : '%B') : null, 'Height', 'Area', 'Area %', 'W1/2', 'Tail', 'N', 'Rs', 'S/N', hasK ? "k'" : null], wid = [6, 22, 14, hasB ? 12 : 0, 15, 17, 12, 12, 10, 14, 10, 12, hasK ? 10 : 0];
        var keep = cols.map(function (cc) { return cc != null; });
        table(cols.filter(Boolean), rows.map(function (r) {
          var a = [r.i, r.name, fmt(r.rt, 5), fmt(r.pctB, 3), fmt(r.height, 4), fmt(r.area, 4), fmt(r.areaPct, 4), fmt(r.fwhm, 3), fmt(r.tailing, 3), fmt(r.plates, 4), fmt(r.resolution, 3), fmt(r.sn, 3), fmt(r.k, 3)];
          return a.filter(function (_, i) { return keep[i]; }).map(String);
        }), wid.filter(function (_, i) { return keep[i]; }), 7);
        if (t.fit) text('Peak fit (' + t.fit.model + '): R2 = ' + fmt(t.fit.r2, 5) + '. Fitted areas: ' + rows.filter(function (r) { return isNum(r.fitArea); }).map(function (r) { return '#' + r.i + ' ' + fmt(r.fitArea, 4) + ' +/- ' + fmt(r.fitSE, 2); }).join('; '), 8);
      });
      // comparison
      if (state.view === 'compare' && mains.length > 1) {
        var cd = compareData(), refId = cd.ref && cd.ref.id;
        h2('Cross-trace comparison (tolerance ' + cd.tol + ', reference: ' + (cd.ref ? cd.ref.name : '-') + ')');
        for (var s0 = 0; s0 < cd.vis.length; s0 += 4) {
          var chunk = cd.vis.slice(s0, s0 + 4), cols2 = ['Group'], w2 = [26];
          chunk.forEach(function (t) { cols2.push(t.name.slice(0, 14) + ' RT', 'Area %', t.id === refId ? 'Area' : 'Ratio'); w2.push(16, 12, 14); });
          table(cols2, cd.groups.map(function (g) {
            var refP = refId && g.members[refId], row = [groupLabel(g.rt, cd.tol, g) || 'RT ' + fmt(g.rt, 4)];
            chunk.forEach(function (t) { var q = g.members[t.id]; row.push(q ? fmt(q.rt, 4) : '-', q ? fmt(q.areaPct, 3) : '-', q ? (t.id === refId ? fmt(q.area, 4) : (refP && refP.area ? fmt(q.area / refP.area, 3) : '-')) : '-'); });
            return row.map(String);
          }), w2, 7);
        }
      }
      // audit notes
      h2('Audit notes');
      var F = (PK.analysis && PK.analysis.FORMULAS) || {};
      Object.keys(F).forEach(function (k) { var f = F[k]; text((f.name || k) + ': ' + (f.expr || '') + (f.description ? '. ' + f.description : '') + (f.ref ? ' [' + f.ref + ']' : ''), 7.5); });
      text('Integration: trapezoid rule above a straight drop-line baseline between the signal values at the start and end bounds. Manually set bounds are marked "manual" in the CSV export.', 7.5);
      mains.forEach(function (t) { text('Processing of "' + t.name + '": ' + procSummary(t) + (num(t.style.offset, 0) ? '; display RT offset ' + t.style.offset : ''), 7.5); });
      if (anyDig) text('Digitized-data disclaimer: traces marked digitized were reconstructed from an image by color masking and axis calibration. Their accuracy is limited by image resolution, line thickness and calibration. The stated +/- values reflect pixel size only. Do not use them for regulated decisions without checking against the original instrument data.', 7.5, 'bold');
      text('Privacy: this report was generated entirely in your browser by Peakly ' + (PK.version || '') + '. No data was uploaded. Peakly has no tracking or analytics.', 7.5, 'normal', 90);
      var np = doc.getNumberOfPages();
      for (var i = 1; i <= np; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text(pdfSafe('Peakly ' + (PK.version || '') + ' · page ' + i + ' / ' + np), W - M, H - 7, { align: 'right' }); }
      doc.save(fileSafe(p.name) + '_report.pdf'); toast('PDF report saved', 'ok');
    }).catch(function (err) { console.error(err); toast('PDF export failed: ' + err.message, 'error'); });
  }

  /* ================================================================== share */
  function renderShare() {
    var host = $('share-root'); if (!host) return;
    if (isEmpty()) { host.innerHTML = '<p class="muted">Load some data first. A share link carries the whole analysis inside the URL.</p>'; return; }
    var str, err = null;
    try { str = app.encodeShare(P()); } catch (e) { err = e.message; }
    if (err) { host.innerHTML = '<p class="note error">' + esc(err) + '</p><p>You can still <button class="btn sm" data-ex-share="save">save a project file</button> and send it.</p>'; return; }
    var base = location.href.split('#')[0], url = base + '#p=' + str, n = url.length, hasImg = P().traces.some(function (t) { return t.digitized; });
    var head = '<p class="small">The link holds the traces, peaks, names, method, run info and settings, compressed into the URL fragment (after #). Browsers don\'t send the fragment to any server, so the data travels only inside the link. Source images are <strong>not</strong> included' + (hasImg ? ' (digitized traces keep their data)' : '') + '. Signals are stored to 1/100 000 of their maximum, far below detector noise.</p>';
    if (n > SHARE_MAX) {
      host.innerHTML = head + '<p class="note error">This project is too large for a link (' + n.toLocaleString() + ' characters; limit ' + SHARE_MAX.toLocaleString() + '). Save a project file and send that instead.</p><div class="row"><button class="btn primary" data-ex-share="save">Save project file…</button></div>';
      return;
    }
    host.innerHTML = head + (n > SHARE_WARN ? '<p class="note warn">This is a long link (' + n.toLocaleString() + ' characters). Some email and chat apps cut off links longer than about 8,000 characters. If it fails, send a project file instead.</p>' : '<p class="small muted">' + n.toLocaleString() + ' characters.</p>') +
      '<textarea class="share-out" id="share-url" rows="4" readonly aria-label="Share link">' + esc(url) + '</textarea>' +
      '<div class="row" style="margin-top:8px"><button class="btn primary" id="share-copy">Copy link</button><button class="btn" data-ex-share="save">Save project file instead…</button></div>';
  }
  function bindShare() {
    $('share-root').addEventListener('click', function (e) {
      if (e.target.id === 'share-copy') {
        var ta = $('share-url'), v = ta.value;
        var done = function () { toast('Link copied to clipboard', 'ok'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
        else { ta.select(); document.execCommand('copy'); done(); }
      } else if (e.target.closest('[data-ex-share="save"]')) saveProject();
    });
  }
  function checkHash() {
    var h = location.hash || '';
    if (h.indexOf('#p=') !== 0) return;
    var proj;
    try { proj = app.decodeShare(h); } catch (e) { toast('Could not open the shared link: ' + e.message, 'error'); return; }
    if (!isEmpty() && !window.confirm('Open the shared project "' + proj.name + '"? This replaces your current work (you can undo).')) return;
    app.setProject(proj, { label: 'Open shared link' }); state.uirev = (state.uirev || 0) + 1; renderPlot();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    toast('Opened shared project "' + proj.name + '"' + (proj.traces.some(function (t) { return t.digitized; }) ? ' (source images are not part of links)' : ''), 'ok');
  }

  /* ================================================================== help + self-test */
  function renderHelp() {
    var f = $('help-formats'); if (f) f.innerHTML = formatsList();
    var v1 = $('help-version'), v2 = $('foot-version'); if (v1) v1.textContent = PK.version || ''; if (v2) v2.textContent = PK.version || '';
    var fm = $('help-formulas'), F = (PK.analysis && PK.analysis.FORMULAS) || null;
    if (fm) fm.innerHTML = F ? '<table class="plain">' + Object.keys(F).map(function (k) { var x = F[k]; return '<tr><td><strong>' + esc(x.name || k) + '</strong><br><span class="mono">' + esc(x.expr || '') + '</span></td><td class="muted">' + esc(x.description || '') + (x.ref ? ' <em>' + esc(x.ref) + '</em>' : '') + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">The analysis module is not loaded.</p>';
  }
  function runSelfTests() {
    var host = $('selftest-root'); if (!host) return;
    if (typeof PK.runTests !== 'function') { host.innerHTML = '<p class="note error">Test harness not loaded.</p>'; return; }
    host.innerHTML = '<p class="small muted">Running…</p>';
    var t0 = Date.now();
    PK.runTests().then(function (rs) {
      var fail = rs.filter(function (r) { return !r.pass; }).length;
      host.innerHTML = '<p class="' + (fail ? 'note error' : 'note') + '" style="margin-top:8px">' + (rs.length - fail) + ' / ' + rs.length + ' tests passed in ' + (Date.now() - t0) + ' ms' + (fail ? ' · ' + fail + ' failed' : '') + '</p>' +
        '<ul class="selftest-list">' + rs.map(function (r) {
          return '<li><span class="' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? '✓ pass' : '✗ FAIL') + '</span> ' + esc(r.name) + ' <span class="muted">(' + r.assertions + ' checks, ' + r.ms + ' ms)</span>' +
            (r.fails.length ? '<div class="small" style="color:var(--error)">' + r.fails.map(esc).join('<br>') + '</div>' : '') + '</li>';
        }).join('') + '</ul>';
    });
  }

  /* ================================================================== samples */
  function localRng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gaussNoise(r) { var a = r() || 1e-12, b = r(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }
  function localSynth(o) {
    o = o || {}; var n = o.n || 4001, tMax = o.tMax || 20, r = localRng(o.seed || 42), x = U.linspace(0, tMax, n), y = new Array(n);
    var pk = o.peaks || [[2.1, 35, 0.03], [4.8, 120, 0.045], [7.35, 60, 0.05], [7.62, 45, 0.05], [10.2, 200, 0.06], [13.1, 8, 0.06], [15.7, 90, 0.06], [18.2, 40, 0.07]];
    for (var i = 0; i < n; i++) { var t = x[i], v = o.drift === false ? 0 : 1.5 + 0.25 * t + 1.2 * Math.sin(Math.PI * t / 14); pk.forEach(function (q) { var u = (t - q[0]) / q[2]; v += q[1] * Math.exp(-0.5 * u * u); }); y[i] = v + (o.noise == null ? 0.05 : o.noise) * gaussNoise(r); }
    return { x: x, y: y };
  }
  function confirmReplace(what) { return isEmpty() || window.confirm('Replace the current work with ' + what + '? You can undo.'); }
  function loadSampleHPLC() {
    if (!confirmReplace('the HPLC sample')) return;
    var A = PK.analysis || {}, sample, blank;
    try { sample = A.sampleTrace ? A.sampleTrace() : null; } catch (e) { sample = null; }
    if (!sample) { var s0 = localSynth(); sample = { name: 'Sample (synthetic) 254 nm', x: s0.x, y: s0.y, xUnit: 'min', yUnit: 'mAU', source: { kind: 'sample' }, meta: { wavelength: 254, synthetic: true } }; }
    var b0 = null;
    try { if (A.syntheticChromatogram) b0 = A.syntheticChromatogram({ peaks: [{ mu: 1.25, height: 4, sigma: 0.035, tau: 0.01 }], seed: 7 }); } catch (e) { b0 = null; }
    if (!b0) b0 = localSynth({ peaks: [[1.25, 4, 0.035]], seed: 7 });
    blank = { name: 'Blank (synthetic) 254 nm', x: b0.x, y: b0.y, xUnit: 'min', yUnit: 'mAU', source: { kind: 'sample' }, meta: { wavelength: 254, synthetic: true, run: { sampleName: 'Blank (mobile phase)', injVol: '10', instrument: 'Simulated HPLC', detector: 'UV 254 nm' } } };
    sample.meta = sample.meta || {}; sample.meta.run = { sampleName: 'Synthetic test mix', sampleId: 'TM-001', injVol: '10', conc: '0.5 mg/mL', instrument: 'Simulated HPLC', detector: 'UV 254 nm', notes: 'Synthetic data generated in the browser' };
    var method = A.sampleMethod ? A.sampleMethod() : TEMPLATES.rp.make();
    var proj = { name: 'Sample: RP-HPLC test mix', traces: [sample, blank], method: method, settings: {} };
    app.setProject(proj, { label: 'Load HPLC sample' }); state.uirev = (state.uirev || 0) + 1; renderPlot();
    toast('Loaded a synthetic RP-HPLC run and a blank. Peaks were detected automatically.', 'ok');
  }
  function loadSampleFPLC() {
    if (!confirmReplace('the FPLC/IMAC sample')) return;
    var A = PK.analysis || {}, method = A.sampleFPLCMethod ? A.sampleFPLCMethod() : TEMPLATES.imac.make();
    var n = 3001, x = U.linspace(0, 50, n), r = localRng(11), uv = new Array(n), cond = new Array(n), gB = new Array(n);
    var mp = clone(method); var dly = dwellTime(mp);
    function g(t, mu, h, s, tau) { if (A.emg && tau) { try { return A.emg(t, h, mu, s, tau); } catch (e) { /* fall through */ } } var u = (t - mu) / s; return h * Math.exp(-0.5 * u * u); }
    for (var i = 0; i < n; i++) {
      var t = x[i], B = gradientAtLocal(mp, t - dly);
      var ft = t > 1 && t < 9 ? 1400 * (1 - Math.exp(-(t - 1) / 0.4)) * (t < 8 ? 1 : Math.exp(-(t - 8) / 0.5)) : (t >= 9 ? 1400 * Math.exp(-(1) / 0.5) * Math.exp(-(t - 9) / 0.6) : 0);
      uv[i] = 12 + ft + g(t, 11.4, 85, 0.35, 0.3) + g(t, 27.5, 950, 0.9, 0.9) + g(t, 31.2, 60, 0.5, 0.4) + 0.4 * gaussNoise(r) + 0.08 * B;
      gB[i] = B; cond[i] = 48.5 + 0.035 * B + 0.15 * gaussNoise(r);
    }
    var run = { sampleName: 'His6-GFP clarified lysate', sampleId: 'LYS-07', injVol: '5000', instrument: 'Simulated FPLC', column: method.column && method.column.name, detector: 'UV 280 nm', operator: '', notes: 'Synthetic data' };
    var traces = [
      { name: 'UV 280 nm (synthetic)', x: x, y: uv, xUnit: 'min', yUnit: 'mAU', source: { kind: 'sample' }, meta: { wavelength: 280, synthetic: true, run: run }, proc: { smooth: { on: true, window: 11, order: 3 }, baseline: { on: false }, peaks: { threshold: 30, minDist: 0.5, minWidth: 0.2, auto: true } } },
      { name: 'Conc B (synthetic)', x: x, y: gB, xUnit: 'min', yUnit: '%', source: { kind: 'sample' }, meta: { role: 'gradient', synthetic: true } },
      { name: 'Conductivity (synthetic)', x: x, y: cond, xUnit: 'min', yUnit: 'mS/cm', source: { kind: 'sample' }, meta: { role: 'conductivity', synthetic: true } }
    ];
    var proj = { name: 'Sample: IMAC His-tag purification', traces: traces, method: method, settings: { showGradient: false } };
    app.setProject(proj, { label: 'Load FPLC sample' }); state.uirev = (state.uirev || 0) + 1; renderPlot();
    toast('Loaded a synthetic IMAC run with Conc B and conductivity on secondary axes.', 'ok');
  }
  function loadSampleImage() {
    var D = PK.digitizer; if (!D) { toast('The image digitizer module did not load.', 'error'); return; }
    var url = null;
    try { url = typeof D.sampleImageDataURL === 'function' ? D.sampleImageDataURL() : D.sampleImageDataURL; } catch (e) { url = null; }
    if (!url && typeof D.makeSampleImage === 'function') { try { var si = D.makeSampleImage(); if (si && si.canvas) url = si.canvas.toDataURL('image/png'); } catch (e) { url = null; } }
    if (url && url.then) { url.then(function (u) { openDigitizer({ dataURL: u, name: 'sample-chromatogram.png' }); }); return; }
    if (!url) { toast('Could not create the sample image.', 'error'); return; }
    openDigitizer({ dataURL: url, name: 'sample-chromatogram.png' });
  }
  app.loadSample = function (kind) { if (kind === 'fplc') loadSampleFPLC(); else if (kind === 'image') loadSampleImage(); else loadSampleHPLC(); };

  /* ================================================================== curve-tracing cursor + click-to-integrate */
  state.cursorOn = true; state.cursor = { traceId: null, idx: null, xDisp: null }; state.integ = null;
  function axisObj(id) { var gd = $('plot'), fl = gd && gd._fullLayout; if (!fl) return null; return fl[id === 'x' ? 'xaxis' : id === 'x2' ? 'xaxis2' : id === 'y' ? 'yaxis' : id === 'y2' ? 'yaxis2' : 'yaxis3'] || null; }
  function cursorTrace() {
    var t = traceById(state.cursor.traceId);
    if (t && t.style.visible !== false && state.disp && state.disp[t.id]) return t;
    var a = activeTrace(); if (a && a.style.visible !== false && state.disp && state.disp[a.id]) return a;
    var vis = P().traces.filter(function (o) { return o.style.visible !== false && !isAux(o) && state.disp && state.disp[o.id]; });
    return vis[0] || null;
  }
  function ensureOverlay() {
    var gd = $('plot'); if (!gd) return null;
    var ov = $('pk-cursor');
    if (!ov || ov.parentNode !== gd) {
      ov = document.createElement('div'); ov.id = 'pk-cursor'; ov.setAttribute('aria-hidden', 'true');
      ov.innerHTML = '<svg class="cur-svg"></svg><div class="cur-chip" hidden></div>';
      gd.appendChild(ov);
    }
    return ov;
  }
  function nearestIdx(xs, v) { var i = lowerIdx(xs, v); if (i >= xs.length) return xs.length - 1; if (i > 0 && Math.abs(xs[i - 1] - v) <= Math.abs(xs[i] - v)) return i - 1; return i; }
  /** Pixel (relative to #plot) → display x on the axis of trace t. Returns null outside the plot area. */
  function eventToDisp(ev, t) {
    var gd = $('plot'), ds = state.disp && state.disp[t.id]; if (!gd || !ds) return null;
    var xa = axisObj(ds.xa), ya = axisObj(ds.ya); if (!xa || !ya) return null;
    var r = gd.getBoundingClientRect(), px = ev.clientX - r.left - xa._offset, py = ev.clientY - r.top - ya._offset;
    if (px < 0 || px > xa._length || py < -4 || py > ya._length + 4) return null;
    return { x: xa.p2l(px), px: px, py: py };
  }
  function readoutFor(t, idx) {
    var ds = state.disp[t.id], pr = ds.pr, xn = pr.x[idx], m = P().method, ci = concInfo(m), out = { t: t, x: xn, y: pr.y[idx] };
    var tm = xToMin(t, xn);
    if (hasGradient(m) && isNum(tm)) {
      var t0 = P().settings.gradientIncludeVoid ? voidTime(m) : 0, dl = dwellTime(m) + (isNum(t0) ? t0 : 0), g = an('gradientAt'), B = null;
      if (g) { try { B = g(m, tm - dl).B; } catch (e) { B = null; } }
      if (!isNum(B)) B = gradientAtLocal(m, tm - dl);
      out.B = B; out.conc = ci ? B * ci.k : null; out.cunit = ci ? ci.unit : null;
    }
    return out;
  }
  function readoutText(r, html) {
    var t = r.t, dig = t.digitized, xu = t.xUnit;
    var parts = [(html ? '<b style="color:' + esc(t.style.color) + '">' + esc(t.name) + '</b>' : t.name),
      (xu === 'min' ? 't' : 'x') + ' = ' + fmt(r.x, 5) + (dig ? ' ± ' + fmt(dig.dxMin, 2) : '') + ' ' + xu,
      'y = ' + fmt(r.y, 5) + (dig ? ' ± ' + fmt(dig.dy, 2) : '') + ' ' + t.yUnit];
    if (isNum(r.B)) parts.push(r.cunit ? fmt(r.conc, 4) + ' ' + r.cunit + ' (' + fmt(r.B, 3) + ' %B)' : fmt(r.B, 3) + ' %B');
    return parts.map(function (p) { return html ? p : p; }).join(html ? ' · ' : ' · ');
  }
  function drawCursor() {
    var ov = ensureOverlay(); if (!ov) return;
    var svg = ov.querySelector('.cur-svg'), chip = ov.querySelector('.cur-chip'), st = $('cursor-status'), gd = $('plot');
    var t = cursorTrace(), c = state.cursor, show = (state.cursorOn || state.integ) && t && c.xDisp != null;
    if (!show) { svg.innerHTML = ''; chip.hidden = true; if (st) st.textContent = state.integ ? integHint() : (state.cursorOn ? 'Move over the plot to read values. ←/→ nudge, [ ] switch trace.' : ''); return; }
    var ds = state.disp[t.id], xa = axisObj(ds.xa), ya = axisObj(ds.ya); if (!xa || !ya) return;
    var W = gd.clientWidth, H = gd.clientHeight, idx = nearestIdx(ds.x, c.xDisp); c.idx = idx;
    var px = xa.l2p(ds.x[idx]) + xa._offset, py = ya.l2p(ds.y[idx]) + ya._offset, top = ya._offset, bot = ya._offset + ya._length, parts = [];
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    // integrate preview (rubber band from the pending start to the cursor on the active trace)
    var act = activeTrace();
    if (state.integ && state.integ.start != null && act && state.disp[act.id]) {
      var da = state.disp[act.id], xa2 = axisObj(da.xa), ya2 = axisObj(da.ya);
      if (xa2 && ya2) {
        var s = state.integ.start + da.off, e = state.integ.cur != null ? state.integ.cur : c.xDisp, lo = Math.min(s, e), hi = Math.max(s, e);
        var i0 = lowerIdx(da.x, lo), i1 = Math.min(lowerIdx(da.x, hi), da.x.length - 1), step = Math.max(1, Math.floor((i1 - i0) / 800)), pts = [];
        function P2(xv, yv) { return (xa2.l2p(xv) + xa2._offset).toFixed(1) + ',' + (ya2.l2p(yv) + ya2._offset).toFixed(1); }
        var y0 = interp(da.x, da.y, lo), y1 = interp(da.x, da.y, hi);
        pts.push(P2(lo, y0)); for (var i = i0; i <= i1; i += step) if (da.x[i] > lo && da.x[i] < hi) pts.push(P2(da.x[i], da.y[i])); pts.push(P2(hi, y1));
        parts.push('<polygon points="' + pts.join(' ') + '" fill="' + hexA(act.style.color, 0.25) + '" stroke="none"/>');
        parts.push('<line x1="' + P2(lo, y0).split(',')[0] + '" y1="' + P2(lo, y0).split(',')[1] + '" x2="' + P2(hi, y1).split(',')[0] + '" y2="' + P2(hi, y1).split(',')[1] + '" stroke="#000" stroke-width="1.2" stroke-dasharray="4 3"/>');
        var sp = P2(s, interp(da.x, da.y, s)).split(',');
        parts.push('<circle cx="' + sp[0] + '" cy="' + sp[1] + '" r="5" fill="#fff" stroke="#000" stroke-width="1.5"/>');
      }
    }
    if (state.cursorOn || state.integ) {
      parts.push('<line x1="' + px.toFixed(1) + '" y1="' + top + '" x2="' + px.toFixed(1) + '" y2="' + bot + '" stroke="#555" stroke-width="1" stroke-dasharray="3 3"/>');
      var rows = [readoutFor(t, idx)];
      if (P().settings.snapAll) {
        P().traces.forEach(function (o) {
          if (o === t || o.style.visible === false || !state.disp[o.id] || isAux(o)) return;
          var d2 = state.disp[o.id], xb = axisObj(d2.xa), yb = axisObj(d2.ya); if (!xb || !yb) return;
          var xd = d2.xa === ds.xa ? ds.x[idx] : null; if (xd == null) return;
          var j = nearestIdx(d2.x, xd); if (Math.abs(d2.x[j] - xd) > Math.abs(d2.x[1] - d2.x[0]) * 2 && (xd < d2.x[0] || xd > d2.x[d2.x.length - 1])) return;
          parts.push('<circle cx="' + (xb.l2p(d2.x[j]) + xb._offset).toFixed(1) + '" cy="' + (yb.l2p(d2.y[j]) + yb._offset).toFixed(1) + '" r="4" fill="' + esc(o.style.color) + '" stroke="#fff" stroke-width="1.2"/>');
          rows.push(readoutFor(o, j));
        });
      }
      parts.push('<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="5.5" fill="' + esc(t.style.color) + '" stroke="#fff" stroke-width="1.8"/>');
      chip.hidden = false;
      chip.innerHTML = rows.map(function (r) { return '<div>' + readoutText(r, true) + '</div>'; }).join('');
      var cw = chip.offsetWidth, chh = chip.offsetHeight, cx = px + 12, cy = Math.max(top, py - chh - 10);
      if (cx + cw > W - 4) cx = px - cw - 12;
      chip.style.left = Math.max(2, cx) + 'px'; chip.style.top = cy + 'px';
      if (st) st.textContent = (state.integ ? integHint() + '   |   ' : '') + rows.map(function (r) { return readoutText(r, false); }).join('   |   ');
    } else chip.hidden = true;
    svg.innerHTML = parts.join('');
  }
  function integHint() { return state.integ && state.integ.start != null ? 'Integrate: start set at ' + fmt(state.integ.start, 5) + '. Click the end point (Esc cancels).' : 'Integrate: click the start point on the curve (or Shift-drag from start to end).'; }
  function hideCursor() { state.cursor.xDisp = null; drawCursor(); }
  function setIntegrate(on) {
    state.integ = on ? { start: null } : null;
    if (on) state.addMode = false;
    var b = $('btn-integrate'); if (b) b.setAttribute('aria-pressed', String(!!on));
    var pl = $('plot'); if (pl) pl.classList.toggle('add-mode', !!on || !!state.addMode);
    renderPlotTools(); drawCursor();
    if (on) toast('Integrate mode: click the start, then the end of the peak on the active trace. Shift-drag also works.', 'info');
  }
  app.setIntegrate = setIntegrate;
  function finishIntegrate(t, s, e) {
    app.pushUndo('Integrate window');
    var np = integrateOnTrace(t, s, e);
    if (!np) { state.undo.pop(); updateUndoButtons(); toast('That window is too narrow. Pick two points further apart.', 'warn'); return; }
    state.selPeakId = np.id; renderAll();
    var ms = withAreaPct(metricsFor(t)), i = -1; t.peaks.forEach(function (p, k) { if (p.id === np.id) i = k; });
    var m = ms[i] || {};
    toast('Integrated ' + fmt(np.start, 5) + '–' + fmt(np.end, 5) + ' ' + t.xUnit + ': RT ' + fmt(m.rt, 5) + ', area ' + fmt(m.area, 5) + '. Use ⇉ in the table to apply this window to all traces.', 'ok');
  }
  function snapNative(t, ev) {
    var d = eventToDisp(ev, t); if (!d) return null;
    var ds = state.disp[t.id], j = nearestIdx(ds.x, d.x); return { native: ds.pr.x[j], disp: ds.x[j] };
  }
  function bindCursor() {
    var gd = $('plot'); if (!gd) return;
    gd.setAttribute('tabindex', '0');
    var down = null;
    gd.addEventListener('pointermove', function (ev) {
      if (isEmpty() || typeof Plotly === 'undefined') return;
      var t = cursorTrace(); if (!t) return;
      var d = eventToDisp(ev, t);
      if (!d) { if (state.cursor.xDisp != null) hideCursor(); hoverRow(null); return; }
      state.cursor.traceId = t.id; state.cursor.xDisp = d.x;
      if (state.integ && state.integ.drag) { var act = activeTrace(), da = act && state.disp[act.id]; if (da) { var dd = eventToDisp(ev, act); if (dd) state.integ.cur = dd.x; } }
      drawCursor();
      var a = activeTrace();
      if (a && state.disp[a.id] && state.view !== 'compare') { var ad = eventToDisp(ev, a); if (ad) { var xn = ad.x - state.disp[a.id].off, hit = null; a.peaks.forEach(function (p) { if (xn >= p.start && xn <= p.end) hit = p; }); hoverRow(hit ? hit.id : null); } }
    });
    gd.addEventListener('pointerleave', function () { if (!(state.integ && state.integ.drag)) hideCursor(); hoverRow(null); });
    // Shift-drag integration: intercept before Plotly starts a zoom box
    function shiftDown(ev) {
      if (!ev.shiftKey || ev.button !== 0) return;
      var t = activeTrace(); if (!t || isAux(t) || !state.disp || !state.disp[t.id]) return;
      if (ev.target.closest && ev.target.closest('.legend, .annotation, .modebar, .g-gtitle')) return;
      var sn = snapNative(t, ev); if (!sn) return;
      ev.stopPropagation(); ev.preventDefault();
      state.integ = { start: sn.native, drag: true, cur: sn.disp, wasOn: !!state.integ };
      drawCursor();
      function mv(e2) { var s2 = eventToDisp(e2, t); if (s2) { state.integ.cur = s2.x; state.cursor.xDisp = s2.x; drawCursor(); } }
      function up(e2) {
        window.removeEventListener('mousemove', mv, true); window.removeEventListener('mouseup', up, true);
        var st = state.integ, en = snapNative(t, e2), endNative = en ? en.native : (st.cur - state.disp[t.id].off);
        state.integ = st.wasOn ? { start: null } : null; state.suppressClick = true; setTimeout(function () { state.suppressClick = false; }, 50);
        finishIntegrate(t, st.start, endNative); renderPlotTools(); drawCursor();
      }
      window.addEventListener('mousemove', mv, true); window.addEventListener('mouseup', up, true);
    }
    gd.addEventListener('mousedown', shiftDown, true);
    gd.addEventListener('pointerdown', function (ev) { down = { x: ev.clientX, y: ev.clientY, t: Date.now(), target: ev.target }; }, true);
    // Listen on window: Plotly inserts a body-level "dragcover" on mousedown, so pointerup never reaches gd.
    window.addEventListener('pointerup', function (ev) {
      if (!down || state.suppressClick) { down = null; return; }
      var moved = Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y), dt = Date.now() - down.t, tg = down.target; down = null;
      if (moved > 6 || dt > 900 || ev.button > 0) return;
      if (tg && tg.closest && tg.closest('.legend, .annotation, .modebar, .g-gtitle, .cur-chip')) return;
      handlePlotClick(ev);
    }, true);
    gd.addEventListener('keydown', function (ev) {
      var t = cursorTrace(); if (!t || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var ds = state.disp[t.id];
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        var i = state.cursor.idx != null && state.cursor.traceId === t.id ? state.cursor.idx : Math.floor(ds.x.length / 2);
        i = U.clamp(i + (ev.key === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 10 : 1), 0, ds.x.length - 1);
        state.cursor.traceId = t.id; state.cursor.idx = i; state.cursor.xDisp = ds.x[i];
        if (state.integ && state.integ.start != null) state.integ.cur = null;
        drawCursor(); ev.preventDefault(); ev.stopPropagation();
      } else if (ev.key === '[' || ev.key === ']') {
        var vis = P().traces.filter(function (o) { return o.style.visible !== false && !isAux(o) && state.disp[o.id]; }); if (vis.length < 2) return;
        var k = vis.indexOf(t); k = (k + (ev.key === ']' ? 1 : -1) + vis.length) % vis.length;
        state.cursor.traceId = vis[k].id; if (state.cursor.xDisp == null) state.cursor.xDisp = ds.x[Math.floor(ds.x.length / 2)];
        drawCursor(); ev.preventDefault(); ev.stopPropagation();
      } else if (ev.key === 'Enter' && state.integ && state.cursor.xDisp != null) {
        var a = activeTrace(), da = a && state.disp[a.id]; if (!da || isAux(a)) return;
        var xn = da.pr.x[nearestIdx(da.x, state.cursor.xDisp)];
        if (state.integ.start == null) { state.integ.start = xn; drawCursor(); }
        else { var s0 = state.integ.start; state.integ.start = null; finishIntegrate(a, s0, xn); drawCursor(); }
        ev.preventDefault(); ev.stopPropagation();
      }
    });
    var wasNarrow = gd.clientWidth < 640;
    window.addEventListener('resize', debounce(function () {
      var nw = gd.clientWidth < 640; // legend/title placement depends on width: rebuild when crossing the breakpoint
      if (nw !== wasNarrow) { wasNarrow = nw; renderPlot(); } else drawCursor();
    }, 150));
  }
  function handlePlotClick(ev) {
    var t = activeTrace(); if (!t || isAux(t) || !state.disp || !state.disp[t.id]) return;
    var sn = snapNative(t, ev); if (!sn) return;
    if (state.integ) {
      if (state.integ.start == null) { state.integ.start = sn.native; state.integ.cur = null; drawCursor(); }
      else { var s = state.integ.start; state.integ.start = null; finishIntegrate(t, s, sn.native); drawCursor(); }
      return;
    }
    if (state.addMode || ev.altKey) { addPeakAt(t, sn.native); return; }
    selectNearestPeak(t, sn.native);
  }

  /* ================================================================== plot tools, relayout edits */
  function bindPlotTools() {
    $('btn-addmode').addEventListener('click', function () { state.addMode = !state.addMode; if (state.addMode) setIntegrate(false); renderPlotTools(); if (state.addMode) toast('Add-peak mode: click on a peak in the plot. Esc to finish.', 'info'); });
    $('btn-integrate').addEventListener('click', function () { setIntegrate(!state.integ); });
    $('btn-cursor').addEventListener('click', function () { state.cursorOn = !state.cursorOn; renderPlotTools(); renderPlot(); drawCursor(); });
    $('chk-snapall').addEventListener('change', function (e) { P().settings.snapAll = e.target.checked; drawCursor(); });
    $('chk-gradient').addEventListener('change', function (e) { app.pushUndo('Toggle gradient'); P().settings.showGradient = e.target.checked; renderPlot(); });
    $('chk-ghost').addEventListener('change', function (e) { P().settings.ghost.show = e.target.checked; renderPlot(); });
    $('rng-ghost').addEventListener('input', function (e) { P().settings.ghost.opacity = num(e.target.value, 0.35); schedulePlot(); });
    var menuBtn = $('btn-plotmenu'), menu = $('plot-menu');
    menuBtn.addEventListener('click', function (e) { e.stopPropagation(); var open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); if (open) renderPlotMenu(); });
    document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });
    menu.addEventListener('change', function (e) {
      var s = P().settings, id = e.target.id; app.pushUndo('Plot options');
      if (id === 'po-lmode') s.labels.mode = e.target.value;
      else if (id === 'po-lsize') s.labels.size = U.clamp(num(e.target.value, 10), 6, 24);
      else if (id === 'po-lall') s.labels.all = e.target.checked;
      else if (id === 'po-grid') s.grid = e.target.checked;
      else if (id === 'po-mirror') s.mirror = e.target.checked;
      else if (id === 'po-dark') s.darkPlot = e.target.checked;
      else if (id === 'po-cap') s.caption = e.target.checked;
      else if (id === 'po-ev') s.showEvents = e.target.checked;
      else if (id === 'po-title') p_setTitle(e.target.value);
      renderPlot(); applyPlotTheme();
    });
    $('plot-notices').addEventListener('click', function (e) { if (e.target.closest('[data-notice="convert-ml"]')) convertVolumeTraces(); });
  }
  function p_setTitle(v) { P().name = String(v || '').trim() || 'Untitled project'; }
  function renderPlotMenu() {
    var s = P().settings, menu = $('plot-menu'), l = s.labels || {};
    menu.innerHTML = '<label class="field"><span>Plot title</span><input type="text" id="po-title" value="' + esc(isDefaultTitle(P().name) ? '' : P().name) + '" placeholder="Untitled"></label>' +
      '<label class="field"><span>Peak labels</span><select id="po-lmode"><option value="auto">Name, else RT</option><option value="name">Name only</option><option value="rt">RT</option><option value="name+rt">Name + RT</option><option value="area">Area %</option><option value="none">None</option></select></label>' +
      '<div class="row"><label class="inline">Size <input type="number" id="po-lsize" min="6" max="24" value="' + num(l.size, 10) + '" style="width:60px"></label><label class="inline"><input type="checkbox" id="po-lall"' + (l.all ? ' checked' : '') + '> Label all traces</label></div>' +
      '<label class="inline"><input type="checkbox" id="po-grid"' + (s.grid !== false ? ' checked' : '') + '> Gridlines</label>' +
      '<label class="inline"><input type="checkbox" id="po-mirror"' + (s.mirror ? ' checked' : '') + '> Full axis frame</label>' +
      '<label class="inline"><input type="checkbox" id="po-cap"' + (s.caption !== false ? ' checked' : '') + '> Method caption</label>' +
      '<label class="inline"><input type="checkbox" id="po-ev"' + (s.showEvents !== false ? ' checked' : '') + '> Instrument events (fractions, injections)</label>' +
      '<label class="inline"><input type="checkbox" id="po-dark"' + (s.darkPlot ? ' checked' : '') + '> Dark plot (screen only; exports stay white)</label>' +
      '<p class="small muted" style="margin:6px 0 0">Click a peak label or the title on the plot to edit it in place.</p>';
    $('po-lmode').value = l.mode || 'auto';
  }
  function applyPlotTheme() { var w = document.querySelector('.plot-wrap'); if (w) w.classList.toggle('dark-plot', !!P().settings.darkPlot); }
  function onPlotRelayout(ev) {
    if (!ev) return;
    var keys = Object.keys(ev);
    if (keys.some(function (k) { return k.indexOf('shapes[') === 0; })) onShapeDrag();
    if (ev['title.text'] != null) {
      var tt = String(ev['title.text']).replace(/<[^>]*>/g, '').trim();
      if (tt !== (isDefaultTitle(P().name) ? '' : P().name)) { app.pushUndo('Rename project'); p_setTitle(tt); renderPlot(); }
    }
    keys.forEach(function (k) {
      var mm = k.match(/^annotations\[(\d+)\]\.text$/); if (!mm) return;
      var info = state.annMap && state.annMap[+mm[1]]; if (!info) { renderPlot(); return; }
      var txt = String(ev[k]).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(), t = traceById(info.traceId);
      if (!t) return;
      var pk = t.peaks.filter(function (q) { return q.id === info.peakId; })[0]; if (!pk) return;
      if (txt === info.text) return;
      setPeakLabel(t, pk.id, txt);
    });
    if (ev['xaxis.range[0]'] != null || ev['xaxis.range'] || ev['xaxis.autorange']) {
      var gd = $('plot'), xr = gd && gd._fullLayout && gd._fullLayout.xaxis && gd._fullLayout.xaxis.range;
      state.viewRange = ev['xaxis.autorange'] ? null : (xr ? [xr[0], xr[1]] : null);
      if (P().traces.some(function (t) { return t.peaks.length; })) schedulePlot();
    }
    setTimeout(drawCursor, 0);
  }

  /* ================================================================== global actions, keyboard, drop, paste */
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('peakly-theme', cur); } catch (e) { /* storage unavailable */ }
    renderPlot();
  }
  function openFilePicker() { var fi = $('file-input'); fi.value = ''; fi.click(); }
  function selectAdjacent(dir) {
    var t = activeTrace(); if (!t || !t.peaks.length) return;
    var i = -1; t.peaks.forEach(function (p, k) { if (p.id === state.selPeakId) i = k; });
    i = i < 0 ? (dir > 0 ? 0 : t.peaks.length - 1) : U.clamp(i + dir, 0, t.peaks.length - 1);
    selectPeak(t.peaks[i].id, { scroll: true, zoom: true });
  }
  var ACTIONS = {
    'import': function () { app.openPanel('import'); }, 'open-files': openFilePicker, 'paste': function () { app.openPanel('paste'); },
    'image': function () { openDigitizer({}); }, 'sample': loadSampleHPLC, 'sample-fplc': loadSampleFPLC, 'sample-image': loadSampleImage,
    'method': function () { app.openPanel('method'); }, 'runinfo': function () { app.openPanel('runinfo'); }, 'export': function () { app.openPanel('export'); }, 'share': function () { app.openPanel('share'); },
    'undo': function () { app.undo(); }, 'redo': function () { app.redo(); }, 'theme': toggleTheme, 'help': function () { app.openPanel('help'); },
    'detect': detectPeaksCmd, 'export-peaks': function () { downloadPeaks([activeTrace()]); }, 'export-compare': function () { U.downloadText(compareCSV(), fileSafe(P().name) + '_comparison.csv', 'text/csv'); },
    'fallback': function () { hideModal('import'); openFallback({}); }, 'integrate': function () { setIntegrate(!state.integ); }
  };
  function closeDrawerIfMobile() { var sb = $('sidebar'); if (sb && sb.classList.contains('open')) toggleDrawer(false); }
  function toggleDrawer(open) {
    var sb = $('sidebar'), sc = $('scrim'), b = $('btn-drawer'); if (!sb) return;
    open = open == null ? !sb.classList.contains('open') : open;
    sb.classList.toggle('open', open); sc.classList.toggle('on', open); b.setAttribute('aria-expanded', String(open));
  }
  function bindGlobal() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-action]'); if (!a) return;
      var fn = ACTIONS[a.getAttribute('data-action')]; if (!fn) return;
      e.preventDefault();
      var menu = $('more-menu'); if (menu && !menu.hidden) { menu.hidden = true; $('btn-more').setAttribute('aria-expanded', 'false'); }
      if (a.closest('#modal-import') && a.getAttribute('data-action') !== 'open-files') hideModal('import');
      fn();
    });
    toArr(document.querySelectorAll('.pk-modal')).forEach(function (m) {
      var name = m.id.replace('modal-', '');
      m.addEventListener('click', function (e) {
        if (e.target.closest('[data-close]')) { hideModal(name); return; }
        if (e.target === m && name !== 'digitizer' && name !== 'fallback') hideModal(name);
      });
    });
    $('btn-more').addEventListener('click', function (e) { e.stopPropagation(); var mm = $('more-menu'); mm.hidden = !mm.hidden; this.setAttribute('aria-expanded', String(!mm.hidden)); if (!mm.hidden) { var f = mm.querySelector('button'); if (f) f.focus(); } });
    document.addEventListener('click', function (e) { var mm = $('more-menu'); if (mm && !mm.hidden && !mm.contains(e.target)) { mm.hidden = true; $('btn-more').setAttribute('aria-expanded', 'false'); } });
    $('btn-drawer').addEventListener('click', function () { toggleDrawer(); });
    $('scrim').addEventListener('click', function () { toggleDrawer(false); });
    $('file-input').addEventListener('change', function (e) { app.handleFiles(e.target.files); });
    $('project-input').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) readText(f).then(function (txt) { try { var o = JSON.parse(txt); loadProjectObj(o.app === 'Peakly' && o.v ? unpackShare(o) : o, f.name); } catch (err) { toast('"' + f.name + '" is not a valid Peakly project: ' + err.message, 'error'); } }); });
    $('paste-go').addEventListener('click', function () { pasteImport($('paste-text').value, false); });
    $('paste-map').addEventListener('click', function () { var v = $('paste-text').value; hideModal('paste'); openFallback({ text: v, filename: 'Pasted data', kind: 'paste' }); });
    $('btn-selftest').addEventListener('click', runSelfTests);
    toArr(document.querySelectorAll('[data-view]')).forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); if (state.view !== 'compare') { state.compareHl = []; state.compareGroupRt = null; } renderTable(); renderPlot(); });
    });
    // keyboard
    window.addEventListener('keydown', function (e) {
      if (isDigitizerOpen() || e.defaultPrevented) return;
      var tg = e.target, typing = tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable), mod = e.metaKey || e.ctrlKey, k = e.key;
      if (mod && !e.altKey && (k === 'z' || k === 'Z')) { if (typing && tg.type !== 'checkbox' && tg.type !== 'range') return; e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); return; }
      if (mod && !e.altKey && (k === 'y' || k === 'Y')) { if (typing) return; e.preventDefault(); app.redo(); return; }
      if (k === 'Escape') {
        var pop = $('audit-pop');
        if (pop && !pop.hidden) { hideAudit(); return; }
        var pm = $('plot-menu'); if (pm && !pm.hidden) { pm.hidden = true; return; }
        if (state.integ && state.integ.start != null) { state.integ.start = null; drawCursor(); toast('Integration start cleared', 'info'); return; }
        if (modalStack.length) { hideModal(modalStack[modalStack.length - 1]); return; }
        if (state.integ) { setIntegrate(false); return; }
        if (state.addMode) { state.addMode = false; renderPlotTools(); return; }
        closeDrawerIfMobile(); return;
      }
      if (typing || mod || e.altKey || modalStack.length) return;
      var handled = true;
      switch (k) {
        case 'o': case 'O': openFilePicker(); break;
        case 'v': case 'V': app.openPanel('paste'); break;
        case 'i': case 'I': openDigitizer({}); break;
        case 'm': case 'M': app.openPanel('method'); break;
        case 'e': case 'E': app.openPanel('export'); break;
        case 's': case 'S': app.openPanel('share'); break;
        case 'd': case 'D': toggleTheme(); break;
        case 'p': case 'P': detectPeaksCmd(); break;
        case 'a': case 'A': state.addMode = !state.addMode; if (state.addMode) setIntegrate(false); renderPlotTools(); break;
        case 'g': case 'G': setIntegrate(!state.integ); break;
        case 't': case 'T': state.cursorOn = !state.cursorOn; renderPlotTools(); renderPlot(); drawCursor(); break;
        case '?': app.openPanel('help'); break;
        case 'Delete': case 'Backspace': if (state.selPeakId) removePeak(state.selPeakId); else handled = false; break;
        case 'ArrowLeft': case 'ArrowUp': selectAdjacent(-1); break;
        case 'ArrowRight': case 'ArrowDown': selectAdjacent(1); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });
    // drag & drop anywhere
    var depth = 0, ov = $('drop-overlay');
    function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
    window.addEventListener('dragenter', function (e) { if (!hasFiles(e) || isDigitizerOpen()) return; depth++; ov.classList.add('on'); e.preventDefault(); });
    window.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('on'); });
    window.addEventListener('drop', function (e) {
      depth = 0; ov.classList.remove('on');
      if (!hasFiles(e)) return;
      if (isDigitizerOpen() || e.defaultPrevented) { e.preventDefault(); return; }
      e.preventDefault(); app.handleFiles(e.dataTransfer.files);
    });
    // global paste: text → parse, image → digitizer
    document.addEventListener('paste', function (e) {
      if (isDigitizerOpen()) return;
      var tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
      if (modalStack.length && !isOpen('import')) return;
      var cd = e.clipboardData; if (!cd) return;
      var files = toArr(cd.files), img = files.filter(function (f) { return /^image\//.test(f.type); })[0];
      if (img) { e.preventDefault(); hideModal('import'); openDigitizer({ blob: img }); return; }
      var txt = cd.getData('text/plain'); if (txt && txt.trim()) { e.preventDefault(); hideModal('import'); pasteImport(txt, false); }
    });
    window.addEventListener('hashchange', checkHash);
    if (PK.bus) {
      PK.bus.on('digitizer:close', function () { state.closingDigitizer = true; hideModal('digitizer'); state.closingDigitizer = false; });
      PK.bus.on('digitizer:open', function () { if (!isDigitizerOpen()) showModal('digitizer'); });
    }
  }
  function renderPlotToolsExtra() {
    var b = $('btn-cursor'); if (b) b.setAttribute('aria-pressed', String(!!state.cursorOn));
    var ig = $('btn-integrate'); if (ig) ig.setAttribute('aria-pressed', String(!!state.integ));
    var sa = $('chk-snapall'); if (sa) sa.checked = !!P().settings.snapAll;
    var pl = $('plot'); if (pl) pl.classList.toggle('add-mode', !!state.addMode || !!state.integ);
    applyPlotTheme();
  }
  function cdnBanner() {
    var fails = (window.__pkCdnFail || []).slice(), checks = [['Plotly', typeof Plotly !== 'undefined', 'plots and figure export'], ['SheetJS', typeof XLSX !== 'undefined', 'Excel import'],
      ['pako', typeof pako !== 'undefined', 'compressed mzML'], ['LZString', typeof LZString !== 'undefined', 'share links'], ['jsPDF', !!(window.jspdf && window.jspdf.jsPDF), 'PDF reports'], ['pdf.js', typeof pdfjsLib !== 'undefined', 'PDF images in the digitizer']];
    var miss = checks.filter(function (c) { return !c[1]; }).map(function (c) { return c[0] + ' (' + c[2] + ')'; });
    fails.forEach(function (f) { if (!miss.some(function (m) { return m.indexOf(f) === 0; })) miss.push(f); });
    var b = $('cdn-banner'); if (!b) return;
    if (miss.length) { b.hidden = false; b.textContent = 'Some libraries could not be loaded from the CDN (offline, or blocked by an extension?): ' + miss.join(', ') + '. Those features are unavailable. Everything else works.'; }
  }

  /* ================================================================== init */
  function init() {
    if (state.ready) return; state.ready = true;
    bindTraceList(); bindProc(); bindOverlay(); bindTable(); bindAudit(); bindCompareControls(); bindFallback(); bindMethod(); bindExport(); bindShare(); bindGlobal(); bindPlotTools(); bindCursor();
    renderHelp(); cdnBanner();
    renderAll();
    checkHash();
  }
  app.init = init;
  if (HAS_DOM) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 0);
  }
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
