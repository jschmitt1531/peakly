/* SPDX-License-Identifier: MIT */
/* Peakly project schema: version constant, v1 → v2 migration, validation, and the documented plain-object rows
   used by every CSV/JSON export (peak tables, trace summaries, long-format data). Pure: no DOM, loads in Node.

   Versioning
   - PROJECT_VERSION 1 (Peakly 1.0): project.version = 1, no clip modes, no calibration.
   - PROJECT_VERSION 2 (Peakly 1.1): adds trace.peaks[].clip, settings.clipDefault / settings.askClip,
     project.calibration and project.schema = { name: 'peakly-project', version: 2 }.
   Exports carry `schema_version` (rows) or `schema: { name, version }` (JSON) so downstream scripts can check it. */
(function (PK) {
  'use strict';
  var S = PK.schema = PK.schema || {};
  var VERSION = 2;
  S.PROJECT_VERSION = VERSION;
  S.EXPORT_VERSION = VERSION;
  S.NAME = 'peakly-project';
  /** Peak clipping (how a peak's area is separated from its baseline and its neighbours). */
  S.CLIP_MODES = ['drop', 'valley', 'baseline', 'skim-tangent', 'skim-exp', 'fit'];
  S.CLIP_LABELS = {
    drop: 'Perpendicular drop', valley: 'Valley to valley', baseline: 'Common baseline',
    'skim-tangent': 'Tangent skim', 'skim-exp': 'Exponential skim', fit: 'Curve fit (deconvolution)'
  };
  S.CLIP_HELP = {
    drop: 'One baseline under the whole fused group; vertical lines at the valleys split the area.',
    valley: 'Each peak gets its own straight baseline from its start to its end (valley points).',
    baseline: 'A single straight line from the start to the end of the group; drops at the valleys.',
    'skim-tangent': 'A small rider peak on a big peak\'s tail is cut off with a straight tangent line.',
    'skim-exp': 'A small rider peak is cut off with an exponential curve that follows the big peak\'s tail.',
    fit: 'Gaussian/EMG curves are fitted to the group; each peak\'s area is its fitted component.'
  };
  S.MODELS = ['linear', 'linear0', 'quadratic'];
  S.WEIGHTINGS = ['none', '1/x', '1/x2'];
  S.RESPONSES = ['area', 'height'];

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function blankCalibration() { return { analytes: [], unit: '' }; }
  S.blankCalibration = blankCalibration;

  /** Normalize a calibration block (unknown keys dropped, defaults filled). Pure. */
  function normalizeCalibration(c) {
    var out = blankCalibration();
    if (!isObj(c)) return out;
    out.unit = c.unit != null ? String(c.unit) : '';
    out.analytes = (Array.isArray(c.analytes) ? c.analytes : []).filter(isObj).map(function (a, i) {
      var pm = isObj(a.peakMatch) ? a.peakMatch : {};
      return {
        id: a.id ? String(a.id) : 'an_' + (i + 1),
        name: a.name != null ? String(a.name) : 'Analyte ' + (i + 1),
        peakMatch: { rt: isNum(+pm.rt) ? +pm.rt : null, tol: isNum(+pm.tol) && +pm.tol > 0 ? +pm.tol : 0.1 },
        response: S.RESPONSES.indexOf(a.response) >= 0 ? a.response : 'area',
        model: S.MODELS.indexOf(a.model) >= 0 ? a.model : 'linear',
        weighting: S.WEIGHTINGS.indexOf(a.weighting) >= 0 ? a.weighting : 'none',
        levels: (Array.isArray(a.levels) ? a.levels : []).filter(isObj).map(function (l) {
          var o = { conc: isNum(+l.conc) && l.conc !== '' && l.conc !== null ? +l.conc : null, unit: l.unit != null ? String(l.unit) : '', include: l.include !== false };
          if (l.traceId) o.traceId = String(l.traceId);
          if (l.response !== undefined && l.response !== null && l.response !== '' && isNum(+l.response)) o.response = +l.response;
          if (l.label) o.label = String(l.label);
          return o;
        })
      };
    });
    return out;
  }
  S.normalizeCalibration = normalizeCalibration;

  /** migrate(obj) → deep-cloned project upgraded to PROJECT_VERSION. Returns {project, from, to, changes[]} when
      opts.report is true, else the project. Unknown future versions are returned unchanged (validateProject flags them).
      v1 → v2: settings.clipDefault = 'drop' and settings.askClip = true for new work, existing peaks get clip 'valley'
      (the v1 integration, so stored results keep their areas), calibration = { analytes: [], unit: '' }, schema tag. */
  S.migrate = function (obj, opts) {
    opts = opts || {};
    if (!isObj(obj)) throw new Error('Not a Peakly project');
    // untrusted JSON: deep copy without __proto__/constructor/prototype keys (prototype-pollution guard)
    var p = PK.util && PK.util.stripUnsafeKeys ? PK.util.stripUnsafeKeys(obj) : clone(obj), from = isNum(+p.version) && +p.version > 0 ? +p.version : 1, changes = [];
    if (from > VERSION) return opts.report ? { project: p, from: from, to: from, changes: [] } : p;
    if (from < 2) {
      p.settings = isObj(p.settings) ? p.settings : {};
      if (S.CLIP_MODES.indexOf(p.settings.clipDefault) < 0) p.settings.clipDefault = 'drop';
      if (typeof p.settings.askClip !== 'boolean') p.settings.askClip = true;
      var n = 0;
      (Array.isArray(p.traces) ? p.traces : []).forEach(function (t) {
        if (!isObj(t) || !Array.isArray(t.peaks)) return;
        t.peaks.forEach(function (pk) { if (isObj(pk) && S.CLIP_MODES.indexOf(pk.clip) < 0) { pk.clip = 'valley'; n++; } });
      });
      if (n) changes.push(n + ' existing peak' + (n === 1 ? '' : 's') + ' keep the v1 valley-to-valley integration (clip = valley).');
      if (!isObj(p.calibration)) { p.calibration = blankCalibration(); changes.push('Added an empty calibration block.'); }
      changes.push('Default peak clip for new peaks: perpendicular drop.');
    }
    p.calibration = normalizeCalibration(p.calibration);
    p.version = VERSION;
    p.schema = { name: S.NAME, version: VERSION };
    return opts.report ? { project: p, from: from, to: VERSION, changes: changes } : p;
  };

  /** validateProject(obj) → { ok, errors[], warnings[] }. Errors make the file unusable; warnings are repairable
      (sanitizing drops NaN points, sorts x, fills defaults). */
  S.validateProject = function (obj) {
    var errors = [], warnings = [];
    function E(m) { errors.push(m); } function W(m) { warnings.push(m); }
    if (!isObj(obj)) { E('Project must be a JSON object.'); return { ok: false, errors: errors, warnings: warnings }; }
    var v = obj.version;
    if (v != null && !isNum(+v)) E('version must be a number.');
    else if (+v > VERSION) E('Project format v' + v + ' is newer than this Peakly (supports v' + VERSION + '). Update Peakly.');
    else if (v == null || +v < VERSION) W('Project format v' + (v == null ? 1 : v) + ' will be upgraded to v' + VERSION + '.');
    if (obj.traces == null) W('No traces array.');
    else if (!Array.isArray(obj.traces)) E('traces must be an array.');
    else obj.traces.forEach(function (t, i) {
      var tag = 'traces[' + i + ']' + (isObj(t) && t.name ? ' "' + t.name + '"' : '');
      if (!isObj(t)) { E(tag + ' must be an object.'); return; }
      var xa = Array.isArray(t.x) || (isObj(t.x) && (Array.isArray(t.x.u) || Array.isArray(t.x.d)));
      var ya = Array.isArray(t.y) || (isObj(t.y) && (Array.isArray(t.y.u) || Array.isArray(t.y.d)));
      if (!xa || !ya) { E(tag + ': x and y must be arrays.'); return; }
      if (Array.isArray(t.x) && Array.isArray(t.y)) {
        if (t.x.length !== t.y.length) E(tag + ': x has ' + t.x.length + ' values but y has ' + t.y.length + '.');
        if (t.x.length < 2) E(tag + ': needs at least 2 points.');
        var bad = 0, unsorted = false;
        for (var k = 0; k < t.x.length; k++) { if (!isNum(t.x[k]) || !isNum(t.y[k])) bad++; if (k && t.x[k] < t.x[k - 1]) unsorted = true; }
        if (bad) W(tag + ': ' + bad + ' non-numeric point' + (bad === 1 ? '' : 's') + ' will be dropped.');
        if (unsorted) W(tag + ': x is not ascending; it will be sorted.');
      }
      if (t.peaks != null && !Array.isArray(t.peaks)) E(tag + ': peaks must be an array.');
      (Array.isArray(t.peaks) ? t.peaks : []).forEach(function (pk, j) {
        var pt = tag + ' peak ' + (j + 1);
        if (!isObj(pk)) { E(pt + ' must be an object.'); return; }
        if (!isNum(+pk.start) || !isNum(+pk.end)) E(pt + ': start and end must be numbers.');
        else if (+pk.end < +pk.start) W(pt + ': end is before start.');
        if (pk.clip != null && S.CLIP_MODES.indexOf(pk.clip) < 0) E(pt + ': unknown clip "' + pk.clip + '" (use ' + S.CLIP_MODES.join(', ') + ').');
      });
    });
    if (obj.settings != null && !isObj(obj.settings)) E('settings must be an object.');
    else if (obj.settings && obj.settings.clipDefault != null && S.CLIP_MODES.indexOf(obj.settings.clipDefault) < 0) E('settings.clipDefault "' + obj.settings.clipDefault + '" is not a clip mode.');
    if (obj.method != null && !isObj(obj.method)) E('method must be an object.');
    var c = obj.calibration;
    if (c != null) {
      if (!isObj(c)) E('calibration must be an object.');
      else if (c.analytes != null && !Array.isArray(c.analytes)) E('calibration.analytes must be an array.');
      else (c.analytes || []).forEach(function (a, i) {
        var at = 'calibration.analytes[' + i + ']' + (isObj(a) && a.name ? ' "' + a.name + '"' : '');
        if (!isObj(a)) { E(at + ' must be an object.'); return; }
        if (a.model != null && S.MODELS.indexOf(a.model) < 0) E(at + ': model must be one of ' + S.MODELS.join(', ') + '.');
        if (a.weighting != null && S.WEIGHTINGS.indexOf(a.weighting) < 0) E(at + ': weighting must be one of ' + S.WEIGHTINGS.join(', ') + '.');
        if (a.response != null && S.RESPONSES.indexOf(a.response) < 0) E(at + ': response must be area or height.');
        if (a.levels != null && !Array.isArray(a.levels)) E(at + ': levels must be an array.');
        (Array.isArray(a.levels) ? a.levels : []).forEach(function (l, j) {
          if (!isObj(l)) { E(at + ' level ' + (j + 1) + ' must be an object.'); return; }
          if (l.conc != null && l.conc !== '' && !isNum(+l.conc)) E(at + ' level ' + (j + 1) + ': conc must be a number.');
        });
      });
    }
    return { ok: !errors.length, errors: errors, warnings: warnings };
  };

  /* ------------------------------------------------------------------ export rows */
  /* Unit templates: {x} = trace x unit (min or mL), {y} = trace y unit, {elu} = %B or salt/imidazole unit,
     {conc} = calibration concentration unit. Column keys never change between versions; new columns are appended. */
  var PEAK_COLUMNS = [
    ['schema_version', '', 'Peakly export schema version (integer).'],
    ['trace_id', '', 'Stable trace id inside the project.'],
    ['trace_name', '', 'Trace display name.'],
    ['peak_no', '', '1-based peak number in retention order.'],
    ['peak_id', '', 'Stable peak id inside the project.'],
    ['name', '', 'User peak label (empty if unnamed).'],
    ['rt', '{x}', 'Retention time (or volume) at the apex, parabolic interpolation.'],
    ['rt_unc', '{x}', '± uncertainty from image pixel size (digitized traces only).'],
    ['start', '{x}', 'Integration start.'],
    ['end', '{x}', 'Integration end.'],
    ['height', '{y}', 'Apex height above the applied baseline.'],
    ['area', '{y}·{x}', 'Net peak area above the applied baseline (multiply by 60 for {y}·s when x is min).'],
    ['area_pct', '%', 'Area as % of the sum of all peak areas in the trace.'],
    ['fwhm', '{x}', 'Width at half height.'],
    ['tailing', '', 'USP tailing factor T = W0.05/(2f).'],
    ['asymmetry', '', 'Asymmetry factor at 10 % height.'],
    ['plates', '', 'Plate number N = 5.54 (tR/W½)².'],
    ['plates_usp', '', 'Plate number by the USP tangent method N = 16 (tR/W)².'],
    ['resolution', '', 'Resolution vs the preceding peak, half-height formula.'],
    ['sn', '', 'Signal-to-noise S/N = 2H/h.'],
    ['k_prime', '', 'Retention factor k = (tR − t0)/t0 (needs a void time).'],
    ['elution', '{elu}', '%B (or salt/imidazole concentration) at elution.'],
    ['clip', '', 'Peak clipping applied: drop | valley | baseline | skim-tangent | skim-exp | fit.'],
    ['baseline_kind', '', 'Shape of the applied baseline (line, common line, tangent, exponential, fit).'],
    ['baseline_area', '{y}·{x}', 'Area under the applied baseline between start and end.'],
    ['gross_area', '{y}·{x}', 'Area under the signal between start and end (net = gross − baseline).'],
    ['fit_area', '{y}·{x}', 'Fitted component area (Gaussian/EMG deconvolution), if a fit was run.'],
    ['fit_area_se', '{y}·{x}', 'Standard error of the fitted area.'],
    ['analyte', '', 'Calibration analyte matched to this peak (by RT ± tolerance).'],
    ['conc', '{conc}', 'Concentration from the calibration curve (inverse prediction).'],
    ['conc_lo', '{conc}', 'Lower 95 % limit of the concentration.'],
    ['conc_hi', '{conc}', 'Upper 95 % limit of the concentration.'],
    ['conc_flags', '', 'Semicolon list: extrapolated, below_LOQ, below_LOD, standard.'],
    ['x_unit', '', 'x unit of the trace (min or mL).'],
    ['y_unit', '', 'y unit of the trace (e.g. mAU).'],
    ['digitized', '', 'true if the trace was digitized from an image (values are estimates).'],
    ['manual', '', 'true if the peak bounds were set or edited by hand.'],
    ['imported_from', '', 'Tool that reported this peak in the imported file (chromatopy, mocca2), else empty.'],
    ['imported_area', '', 'Area as reported by that tool (its own units and integration method; not recomputed).'],
    ['imported_area_se', '', 'Standard error / SD of the imported area as reported by that tool.']
  ].map(function (c) { return { key: c[0], unit: c[1], description: c[2] }; });
  var TRACE_COLUMNS = [
    ['schema_version', '', 'Peakly export schema version.'], ['trace_id', '', 'Stable trace id.'], ['name', '', 'Trace name.'],
    ['role', '', 'signal, or an auxiliary channel role (gradient, conductivity, pH, …).'], ['x_unit', '', 'x unit (min or mL).'], ['y_unit', '', 'y unit.'],
    ['n_points', '', 'Number of data points.'], ['x_min', '{x}', 'First x value.'], ['x_max', '{x}', 'Last x value.'],
    ['source_kind', '', 'file | image | paste | sample | derived.'], ['source_format', '', 'Detected file format.'], ['source_filename', '', 'Original file name.'],
    ['digitized', '', 'true if digitized from an image.'], ['dx_unc', '{x}', '± x uncertainty per pixel (digitized only).'], ['dy_unc', '{y}', '± y uncertainty per pixel (digitized only).'],
    ['n_peaks', '', 'Number of integrated peaks.'], ['sample_name', '', 'Run info: sample name.'], ['sample_id', '', 'Run info: sample id.'],
    ['inj_vol', 'µL', 'Run info: injection volume.'], ['instrument', '', 'Run info: instrument.'], ['detector', '', 'Run info: detector / wavelength.'],
    ['processing', '', 'Smoothing / baseline / detection settings summary.'], ['calibration_level', '', 'Analyte:concentration pairs if this trace is a calibration standard.']
  ].map(function (c) { return { key: c[0], unit: c[1], description: c[2] }; });
  var DATA_COLUMNS = [
    ['trace_id', '', 'Stable trace id.'], ['trace_name', '', 'Trace name.'], ['x', '{x}', 'Time or volume.'], ['y', '{y}', 'Raw signal as imported.'],
    ['y_processed', '{y}', 'Smoothed and baseline-corrected signal used for integration.'], ['digitized', '', 'true if digitized from an image.']
  ].map(function (c) { return { key: c[0], unit: c[1], description: c[2] }; });
  var CAL_COLUMNS = [
    ['schema_version', '', 'Peakly export schema version.'], ['analyte', '', 'Analyte name.'], ['level', '', 'Level number.'], ['trace_id', '', 'Standard trace (empty if typed in).'],
    ['trace_name', '', 'Standard trace name.'], ['conc', '{conc}', 'Nominal concentration.'], ['response', '{resp}', 'Measured response (area or height).'],
    ['included', '', 'true if used in the fit.'], ['predicted', '{resp}', 'Response predicted by the fit.'], ['residual', '{resp}', 'response − predicted.'],
    ['back_calc_conc', '{conc}', 'Concentration back-calculated from the response.'], ['recovery_pct', '%', '100·back-calculated / nominal.']
  ].map(function (c) { return { key: c[0], unit: c[1], description: c[2] }; });
  S.PEAK_COLUMNS = PEAK_COLUMNS; S.TRACE_COLUMNS = TRACE_COLUMNS; S.DATA_COLUMNS = DATA_COLUMNS; S.CAL_COLUMNS = CAL_COLUMNS;

  function unitCtx(trace, ctx) {
    ctx = ctx || {};
    return { x: (trace && trace.xUnit) || 'min', y: (trace && trace.yUnit) || 'a.u.', elu: ctx.eluUnit || '%B', conc: ctx.concUnit || '', resp: ctx.respUnit || '' };
  }
  function resolveUnit(tpl, u) { return String(tpl || '').replace(/\{(\w+)\}/g, function (_, k) { return u[k] != null ? u[k] : ''; }); }
  /** columnsWithUnits(columns, trace, ctx) → [{key, unit, description}] with unit templates resolved for that trace. */
  S.columnsWithUnits = function (cols, trace, ctx) { var u = unitCtx(trace, ctx); return cols.map(function (c) { return { key: c.key, unit: resolveUnit(c.unit, u), description: c.description }; }); };
  S.peakColumns = function (trace, ctx) { return S.columnsWithUnits(PEAK_COLUMNS, trace, ctx); };

  function isAux(t) { var r = t && t.meta && t.meta.role; return !!r && r !== 'signal'; }
  function num(v) { return isNum(v) ? v : null; }
  /** Default metrics when the caller provides none: PK.analysis.process + peakMetrics (null fields if unavailable). */
  function defaultMetrics(t) {
    var A = PK.analysis;
    if (!A || typeof A.process !== 'function' || typeof A.peakMetrics !== 'function' || !t.peaks || !t.peaks.length) return [];
    try { var pr = A.process(t); return A.peakMetrics(pr.x, pr.y, t.peaks, {}) || []; } catch (e) { return []; }
  }

  /** peakTableRows(project, opts) → one plain object per peak with every PEAK_COLUMNS key (null when unknown).
      opts: { traceIds?: string[] (default: all signal traces), metrics?(trace) → Metric[] aligned with trace.peaks,
              integration?(trace) → [{clip, baseline:{kind}, math:{baselineArea, grossArea}}] aligned with peaks,
              extra?(trace, peak, index, metric) → object merged into the row (elution, k_prime, conc, …) }. */
  S.peakTableRows = function (project, opts) {
    opts = opts || {};
    var traces = (project && Array.isArray(project.traces) ? project.traces : []).filter(function (t) {
      return t && !isAux(t) && (!opts.traceIds || opts.traceIds.indexOf(t.id) >= 0);
    });
    var rows = [];
    traces.forEach(function (t) {
      var ms = (opts.metrics ? opts.metrics(t) : defaultMetrics(t)) || [], ig = (opts.integration ? opts.integration(t) : null) || [];
      var dig = t.digitized && typeof t.digitized === 'object' ? t.digitized : null;
      (t.peaks || []).forEach(function (pk, i) {
        var m = ms[i] || {}, g = ig[i] || {}, gm = g.math || {};
        var row = {};
        PEAK_COLUMNS.forEach(function (c) { row[c.key] = null; });
        row.schema_version = VERSION; row.trace_id = t.id; row.trace_name = t.name; row.peak_no = i + 1; row.peak_id = pk.id; row.name = pk.label || '';
        row.rt = num(m.rt != null ? m.rt : pk.apex); row.rt_unc = dig ? num(dig.dxMin) : null; row.start = num(pk.start); row.end = num(pk.end);
        row.height = num(m.height); row.area = num(m.area); row.area_pct = num(m.areaPct); row.fwhm = num(m.fwhm); row.tailing = num(m.tailing);
        row.asymmetry = num(m.asymmetry); row.plates = num(m.plates); row.plates_usp = num(m.platesUSP); row.resolution = num(m.resolution); row.sn = num(m.sn);
        row.k_prime = num(m.k);
        row.clip = g.clip || pk.clip || null; row.baseline_kind = (g.baseline && g.baseline.kind) || null;
        row.baseline_area = num(gm.baselineArea); row.gross_area = num(gm.grossArea);
        row.imported_from = pk.importedFrom || null; row.imported_area = num(pk.importedArea); row.imported_area_se = num(pk.importedAreaSE);
        row.x_unit = t.xUnit || 'min'; row.y_unit = t.yUnit || 'a.u.'; row.digitized = !!dig; row.manual = !!pk.manual;
        if (opts.extra) { var ex = opts.extra(t, pk, i, m) || {}; Object.keys(ex).forEach(function (k) { if (k in row) row[k] = ex[k]; }); }
        rows.push(row);
      });
    });
    return rows;
  };

  /** traceRows(project, opts) → one summary object per trace (TRACE_COLUMNS). opts.procSummary?(trace) → string. */
  S.traceRows = function (project, opts) {
    opts = opts || {};
    var cal = project && project.calibration && Array.isArray(project.calibration.analytes) ? project.calibration.analytes : [];
    return (project && Array.isArray(project.traces) ? project.traces : []).filter(function (t) { return t && (!opts.traceIds || opts.traceIds.indexOf(t.id) >= 0); }).map(function (t) {
      var x = t.x || [], src = t.source || {}, dig = t.digitized && typeof t.digitized === 'object' ? t.digitized : null, run = (t.meta && t.meta.run) || {};
      var lv = [];
      cal.forEach(function (a) { (a.levels || []).forEach(function (l) { if (l.traceId === t.id) lv.push((a.name || a.id) + ':' + l.conc + (l.unit || (project.calibration.unit ? ' ' + project.calibration.unit : ''))); }); });
      return {
        schema_version: VERSION, trace_id: t.id, name: t.name, role: (t.meta && t.meta.role) || 'signal', x_unit: t.xUnit || 'min', y_unit: t.yUnit || 'a.u.',
        n_points: x.length, x_min: x.length ? num(x[0]) : null, x_max: x.length ? num(x[x.length - 1]) : null,
        source_kind: src.kind || null, source_format: src.format || null, source_filename: src.filename || null,
        digitized: !!dig, dx_unc: dig ? num(dig.dxMin) : null, dy_unc: dig ? num(dig.dy) : null, n_peaks: (t.peaks || []).length,
        sample_name: run.sampleName || null, sample_id: run.sampleId || null, inj_vol: run.injVol != null && run.injVol !== '' ? run.injVol : null,
        instrument: run.instrument || null, detector: run.detector || null, processing: opts.procSummary ? opts.procSummary(t) : null,
        calibration_level: lv.length ? lv.join('; ') : null
      };
    });
  };

  /** dataRows(trace, yProcessed?) → long-format rows (DATA_COLUMNS), one per data point. */
  S.dataRows = function (t, yp) {
    var out = [], dg = !!(t && t.digitized);
    for (var i = 0; i < ((t && t.x) || []).length; i++) out.push({ trace_id: t.id, trace_name: t.name, x: t.x[i], y: t.y[i], y_processed: yp && isNum(yp[i]) ? yp[i] : null, digitized: dg });
    return out;
  };

  /** CSV helpers shared by the app: rows → CSV text with a units comment line. */
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return isFinite(v) ? String(+v.toPrecision(10)) : '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    var s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  S.csvCell = csvCell;
  S.toCSV = function (cols, rows, opts) {
    opts = opts || {};
    var L = (opts.comments || []).map(function (c) { return '# ' + String(c).replace(/\r?\n/g, ' '); });
    if (opts.units !== false) L.push('# units: ' + cols.map(function (c) { return c.key + '=' + (c.unit || '-'); }).join(', '));
    L.push(cols.map(function (c) { return c.key; }).join(','));
    rows.forEach(function (r) { L.push(cols.map(function (c) { return csvCell(r[c.key]); }).join(',')); });
    return L.join('\n') + '\n';
  };

  /* ------------------------------------------------------------------ JSON-schema-like description */
  function colsSchema(title, cols, desc) {
    var props = {};
    cols.forEach(function (c) {
      var t = /^(schema_version|peak_no|n_points|n_peaks|level)$/.test(c.key) ? 'integer' : /^(digitized|manual|included)$/.test(c.key) ? 'boolean'
        : /^(imported_from|trace_id|trace_name|peak_id|name|clip|baseline_kind|analyte|conc_flags|x_unit|y_unit|role|source_kind|source_format|source_filename|sample_name|sample_id|instrument|detector|processing|calibration_level|inj_vol)$/.test(c.key) ? ['string', 'null'] : ['number', 'null'];
      props[c.key] = { type: t, description: c.description + (c.unit ? ' Unit: ' + c.unit + '.' : '') };
      if (c.key === 'clip') props[c.key].enum = S.CLIP_MODES.concat([null]);
    });
    return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'peakly/' + title + '.v' + VERSION + '.schema.json', title: title, description: desc,
      type: 'object', required: cols.map(function (c) { return c.key; }), properties: props, 'x-peakly-schema-version': VERSION,
      'x-unit-templates': { '{x}': 'trace x unit (min or mL)', '{y}': 'trace y unit', '{elu}': '%B or salt/imidazole unit', '{conc}': 'calibration concentration unit', '{resp}': 'response unit (y·x for area, y for height)' } };
  }
  /** describe() → { project, peakRow, traceRow, dataRow, calibrationRow } JSON-schema (draft 2020-12 flavoured) objects. */
  S.describe = function () {
    var clip = { type: 'string', enum: S.CLIP_MODES.slice(), description: 'Peak clipping mode.' };
    var num_ = { type: 'number' }, numN = { type: ['number', 'null'] };
    var peak = { type: 'object', required: ['id', 'start', 'end'], properties: {
      id: { type: 'string' }, start: num_, apex: num_, end: num_, manual: { type: 'boolean' }, label: { type: 'string' },
      importedFrom: { type: 'string', description: 'Tool that reported the peak in an imported file (chromatopy, mocca2); such peaks are kept as manual.' },
      importedArea: { type: 'number' }, importedAreaSE: { type: 'number' },
      clip: { description: 'Per-peak override; absent = project default (settings.clipDefault). Manual window integrations default to valley.', type: 'string', enum: S.CLIP_MODES.slice() } } };
    var level = { type: 'object', properties: { conc: numN, unit: { type: 'string' }, traceId: { type: 'string', description: 'Standard trace; the response is read from its matched peak.' },
      response: { type: 'number', description: 'Typed-in response (used when traceId is absent).' }, include: { type: 'boolean', default: true }, label: { type: 'string' } } };
    var analyte = { type: 'object', required: ['id', 'name', 'peakMatch'], properties: {
      id: { type: 'string' }, name: { type: 'string' }, peakMatch: { type: 'object', properties: { rt: numN, tol: { type: 'number', exclusiveMinimum: 0, default: 0.1 } } },
      response: { type: 'string', enum: S.RESPONSES.slice(), default: 'area' }, model: { type: 'string', enum: S.MODELS.slice(), default: 'linear', description: 'linear: y = b0 + b1·x; linear0: y = b1·x; quadratic: y = b0 + b1·x + b2·x².' },
      weighting: { type: 'string', enum: S.WEIGHTINGS.slice(), default: 'none' }, levels: { type: 'array', items: level } } };
    var trace = { type: 'object', required: ['id', 'name', 'x', 'y'], properties: {
      id: { type: 'string' }, name: { type: 'string' }, x: { description: 'Ascending x values (min, or mL when xUnit is mL). Share links pack arrays as {u:[x0,dx,n]} or {e,d}.', type: ['array', 'object'] },
      y: { type: ['array', 'object'] }, xUnit: { type: 'string', enum: ['min', 'mL', 'CV'] }, yUnit: { type: 'string' },
      source: { type: 'object' }, digitized: { description: 'false, or {dxMin, dy, imageId, printedPeaks?, warnings[]} for image-derived traces.', type: ['boolean', 'object'] },
      meta: { type: 'object', description: 'Parsed metadata; meta.run holds run info; meta.role marks auxiliary channels.' }, style: { type: 'object' },
      proc: { type: 'object', description: '{smooth:{on,window,order}, baseline:{on,lambda,lambdaAuto,p,iter}, peaks:{threshold,minDist,minWidth,auto}}' },
      peaks: { type: 'array', items: peak }, fit: { type: ['object', 'null'] } } };
    var project = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'peakly/project.v' + VERSION + '.schema.json', title: 'Peakly project',
      description: 'A saved Peakly project (.peakly.json). Older v1 files are migrated on load (see PK.schema.migrate).', type: 'object', required: ['version', 'traces'],
      properties: {
        format: { const: 'peakly-project' }, version: { type: 'integer', const: VERSION }, schema: { type: 'object', properties: { name: { const: S.NAME }, version: { const: VERSION } } },
        name: { type: 'string' }, traces: { type: 'array', items: trace }, method: { type: 'object', description: 'Method: gradient [{t,B,flow}], column, flow, dwell volume, wavelength… (CONTRACT.md).' },
        images: { type: 'object', additionalProperties: { type: 'string', description: 'data: URL' } },
        settings: { type: 'object', properties: { clipDefault: clip, askClip: { type: 'boolean', default: true, description: 'Ask how to split fused peaks.' },
          normalization: { type: 'string', enum: ['none', 'max', 'area'] }, lineStyles: { type: 'boolean', description: 'Distinguish overlay traces by dash pattern.' } } },
        calibration: { type: 'object', properties: { unit: { type: 'string' }, analytes: { type: 'array', items: analyte } } },
        activeTraceId: { type: ['string', 'null'] }
      } };
    return {
      project: project,
      peakRow: colsSchema('peak-row', PEAK_COLUMNS, 'One row of a Peakly peak table export (CSV columns / JSON objects).'),
      traceRow: colsSchema('trace-row', TRACE_COLUMNS, 'One row of a Peakly trace summary export.'),
      dataRow: colsSchema('data-row', DATA_COLUMNS, 'One point of the long-format trace data export.'),
      calibrationRow: colsSchema('calibration-row', CAL_COLUMNS, 'One calibration level of a Peakly calibration export.')
    };
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
