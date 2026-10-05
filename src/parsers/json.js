/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly parser plugin "json": JSON chromatograms (generic shapes, Peakly project / exports).
   Format: [{x,y},...], [[x,y],...], {x:[],y:[]}, {traces:[{name,x,y,xUnit,yUnit,meta}]}, a saved Peakly project
     ({version, traces, method|settings|images} -> ParseResult.project), and Peakly's own exports (round trip):
     - Traces JSON {schema:{name:'peakly-traces',version}, traces:[{id,name,x,y,xUnit,yUnit,run,digitized,peaks}], peakRows?}
       -> traces with meta.run / meta.digitized and traces[i].peaks (areas etc. merged from peakRows by trace_id+peak_id);
     - peak table {schema:'peakly.peaks'|{name:'peakly-peaks'}, rows|peaks:[PK.schema.peakTableRows rows], traces?|data?}
       or a bare array of such rows -> peaks attached to the embedded traces / long-format data rows; without any trace
       data -> ok:false with ParseResult.peakTable = rows and an explanation;
     - long-format data rows [{trace_id, trace_name, x, y, ...}] (PK.schema.dataRows) -> one trace per trace_id.
     Schema names are matched loosely: 'peakly-traces', 'peakly.traces', 'peakly_traces' are the same.
     Python's NaN / Infinity literals are accepted (read as missing).
   Sniff: text starts with "{" or "[" -> 0.6; with "x"/"y"/"traces"/"time"/"version"/"schema" keys or [[ -> 0.9.
   Delegation: after JSON.parse the object is offered to every plugin that defines sniffJSON(obj) (chromatopy, mocca2,
     ...); the best score >= 0.5 parses it with parseJSON(obj, opts). New JSON dialects should use that hook.
   Format knowledge: Peakly CONTRACT.md data model; docs/SCHEMA.md for the peakly.* export documents.
   Sample: samples/data/json.json (the app's Traces JSON export: traces, app peaks and peakRows) */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, trim = H.trim, assign = H.assign, normXUnit = H.normXUnit, mkTrace = H.mkTrace, fail = H.fail, okRes = H.okRes, normPeaks = H.normPeaks;

  function isProject(o) { return o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.traces) && o.version != null && (o.method || o.settings || o.images); }
  function jsonTrace(o, hint) {
    var xs, ys, xu, yu, name = hint, meta = {};
    if (Array.isArray(o)) {
      if (!o.length) return null;
      if (Array.isArray(o[0])) { xs = o.map(function (p) { return +p[0]; }); ys = o.map(function (p) { return +p[1]; }); }
      else if (o[0] && typeof o[0] === 'object') {
        var kx = pick(o[0], ['x', 't', 'time', 'rt', 'min']), ky = pick(o[0], ['y', 'value', 'signal', 'intensity', 'absorbance', 'v']);
        if (!kx || !ky) return null;
        xs = o.map(function (p) { return +p[kx]; }); ys = o.map(function (p) { return +p[ky]; }); xu = /time|^t$|rt/i.test(kx) ? null : null;
      } else return null;
    } else if (o && typeof o === 'object') {
      var ax = pick(o, ['x', 't', 'time', 'times', 'rt']), ay = pick(o, ['y', 'values', 'signal', 'intensity', 'intensities', 'absorbance']);
      if (ax && ay && Array.isArray(o[ax]) && Array.isArray(o[ay])) { xs = o[ax]; ys = o[ay]; }
      else if (Array.isArray(o.data)) return jsonTrace(o.data, o.name || hint);
      else return null;
      xu = o.xUnit || o.xunit || o.timeUnit; yu = o.yUnit || o.yunit || o.unit;
      name = o.name || o.label || hint;
      if (o.meta && typeof o.meta === 'object') meta = assign({}, o.meta);
      if (o.run && typeof o.run === 'object' && !meta.run) meta.run = assign({}, o.run); // Peakly traces export
      if (o.digitized && typeof o.digitized === 'object') meta.digitized = assign({}, o.digitized); // uncertainty kept as metadata
    } else return null;
    var u = normXUnit(xu) || 'min';
    if (xu && !normXUnit(xu)) meta.xUnitOriginal = xu;
    var tr = mkTrace(name, xs, ys, u, yu ? String(yu) : 'a.u.', meta);
    if (!Array.isArray(o) && Array.isArray(o.peaks) && o.peaks.length) {
      var pk = normPeaks(o.peaks.map(peakRow), u, 'peakly');
      if (pk.length) tr.peaks = pk;
    }
    return tr;
  }
  // A peak row from a Peakly export (camelCase app peaks or snake_case PK.schema.peakTableRows rows) -> imported peak.
  function peakRow(r) {
    if (!r || typeof r !== 'object') return null;
    function first() { for (var i = 0; i < arguments.length; i++) if (r[arguments[i]] != null && r[arguments[i]] !== '') return r[arguments[i]]; return undefined; }
    var out = { start: first('start'), apex: first('apex', 'rt', 'RT'), end: first('end'), label: first('label', 'name'),
      area: first('area', 'fit_area'), areaSE: first('areaSE', 'area_se', 'fit_area_se') };
    var extra = { height: 'height', areaPct: 'area_pct', clip: 'clip', conc: 'conc', manual: 'manual', analyte: 'analyte' };
    Object.keys(extra).forEach(function (k) { var v = first(k, extra[k]); if (v != null) out[k] = v; });
    if (r.areaPct != null) out.areaPct = r.areaPct;
    Object.keys(out).forEach(function (k) { if (out[k] === undefined) delete out[k]; });
    return out;
  }
  // Export documents name themselves with schema:'peakly.traces' | schema:{name:'peakly-peaks',version} | format:'...'.
  function schemaOf(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return '';
    var s = o.schema && typeof o.schema === 'object' ? o.schema.name : o.schema;
    if (typeof s !== 'string') s = typeof o.format === 'string' ? o.format : '';
    s = s.toLowerCase().replace(/[-_\s]/g, '.');
    return /^peakly\./.test(s) ? s : '';
  }
  function rowsOf(o) { return Array.isArray(o.peaks) ? o.peaks : Array.isArray(o.rows) ? o.rows : Array.isArray(o.data) ? o.data : []; }
  function isPeakRows(rows) { var r = rows[0]; return !!(r && typeof r === 'object' && !Array.isArray(r) && ('rt' in r || 'apex' in r) && ('trace_name' in r || 'trace_id' in r || 'traceName' in r || 'traceId' in r || 'area' in r)); }
  function isDataRows(rows) { var r = rows[0]; return !!(r && typeof r === 'object' && !Array.isArray(r) && 'x' in r && 'y' in r && ('trace_id' in r || 'trace_name' in r)); }
  // Long-format data rows [{trace_id, trace_name, x, y}] (PK.schema.dataRows) -> one trace per trace_id.
  function dataRowsToTraces(rows, units) {
    var by = Object.create(null), order = []; // keys come from the file ("__proto__", "constructor"…): no prototype
    rows.forEach(function (r) {
      if (!r) return; var k = r.trace_id != null ? r.trace_id : r.trace_name;
      if (!by[k]) { by[k] = { name: r.trace_name || String(k), id: r.trace_id, x: [], y: [] }; order.push(k); }
      by[k].x.push(+r.x); by[k].y.push(+r.y);
    });
    return order.map(function (k) { var b = by[k], u = (units && units[k]) || {}; var t = mkTrace(b.name, b.x, b.y, u.x || 'min', u.y || 'a.u.', {}); t._key = [b.id, b.name]; return t; });
  }
  // Peak table export: rows reference traces by trace_id/trace_name (or traceId/traceName/trace). Rows are attached as
  // imported peaks to the traces embedded in the same document (traces[] or long-format data rows), if any.
  function parsePeakTable(obj, rows) {
    var traces = [], units = Object.create(null);
    rows.forEach(function (r) { if (r && (r.trace_id != null || r.trace_name != null)) units[r.trace_id != null ? r.trace_id : r.trace_name] = { x: r.x_unit, y: r.y_unit }; });
    (Array.isArray(obj.traces) ? obj.traces : []).forEach(function (o, i) { var t = jsonTrace(o, (o && o.name) || 'Trace ' + (i + 1)); if (t && t.x.length) { t._key = [o.id, o.name, t.name]; traces.push(t); } });
    if (!traces.length && Array.isArray(obj.data) && isDataRows(obj.data)) traces = dataRowsToTraces(obj.data, units);
    if (!traces.length) {
      return fail('Peakly peak table', 'This is a Peakly peak-table export (' + rows.length + ' peak row' + (rows.length === 1 ? '' : 's') +
        ') and contains no chromatogram data. Open the matching trace/data export or the saved project instead.', { peakTable: rows });
    }
    var unmatched = 0;
    rows.forEach(function (r) {
      if (!r) return;
      var keys = [r.trace_id, r.traceId, r.trace_name, r.traceName, r.trace].filter(function (k) { return k != null; });
      var t = traces.filter(function (x) { return keys.some(function (k) { return x._key.indexOf(k) >= 0; }); })[0] || (traces.length === 1 && !keys.length ? traces[0] : null);
      if (!t) { unmatched++; return; }
      var pk = normPeaks([peakRow(r)], 'min', 'peakly');
      if (pk.length) t.peaks = (t.peaks || []).concat(pk).sort(function (a, b) { return a.apex - b.apex; });
    });
    traces.forEach(function (t) { delete t._key; });
    return okRes('Peakly peak table', traces, unmatched ? [unmatched + ' peak row(s) did not match any trace and were skipped.'] : []);
  }
  // Offer a parsed JSON object to plugins that understand a JSON dialect (chromatoPy, MOCCA2, ...).
  function delegate(obj, opts) {
    var best = null;
    H.plugins().forEach(function (p) {
      if (typeof p.sniffJSON !== 'function' || typeof p.parseJSON !== 'function') return;
      var s = 0; try { s = +p.sniffJSON(obj) || 0; } catch (e) { s = 0; }
      if (s >= 0.5 && (!best || s > best.s)) best = { p: p, s: s };
    });
    if (!best) return null;
    var r = best.p.parseJSON(obj, opts || {});
    if (r) { r.plugin = best.p.id; r.format = r.format || best.p.name; }
    return r;
  }
  function pick(o, keys) { var ks = Object.keys(o); for (var i = 0; i < keys.length; i++) for (var j = 0; j < ks.length; j++) if (ks[j].toLowerCase() === keys[i]) return ks[j]; return null; }
  P.register({
    id: 'json', order: 20, name: 'JSON', extensions: ['json', 'peakly'], binary: false,
    description: 'Peakly project and peakly.traces / peakly.peaks exports, [{x,y}], [[x,y]], {x:[],y:[]}, {traces:[...]}.',
    sniff: function (head) { var s = trim(head); return /^[\[{]/.test(s) ? (/"(x|y|traces|time|version|schema)"\s*:/.test(s) || /^\[\s*\[/.test(s) ? 0.9 : 0.6) : 0; },
    parse: function (text, opts) {
      var obj;
      try { obj = H.parseJSONLoose(text); } catch (e) { return fail('JSON', 'This looks like JSON but could not be read (' + e.message + '). The file may be truncated or have a trailing comma.'); }
      if (isProject(obj)) return { ok: true, project: obj, traces: obj.traces, format: 'Peakly project', warnings: [] };
      var sch = schemaOf(obj), rows = sch ? rowsOf(obj) : [];
      if (/^peakly\.peak/.test(sch) || (sch && !Array.isArray(obj.traces) && isPeakRows(rows))) return parsePeakTable(obj, rows);
      if (Array.isArray(obj) && isPeakRows(obj)) return parsePeakTable({}, obj);
      if (sch && !Array.isArray(obj.traces) && isDataRows(rows)) { var dt = dataRowsToTraces(rows); dt.forEach(function (t) { delete t._key; }); return okRes('Peakly data', dt, []); }
      if (Array.isArray(obj) && isDataRows(obj)) { var da = dataRowsToTraces(obj); da.forEach(function (t) { delete t._key; }); return okRes('Peakly data', da, []); }
      if (!sch) { var d = delegate(obj, opts); if (d) return d; }
      var base = baseName(opts && opts.filename) || 'Trace', traces = [];
      var list = obj && !Array.isArray(obj) && Array.isArray(obj.traces) ? obj.traces : null;
      if (!list && Array.isArray(obj) && obj.length && obj[0] && typeof obj[0] === 'object' && !Array.isArray(obj[0]) && (pick(obj[0], ['x', 'time', 't']) && Array.isArray(obj[0][pick(obj[0], ['x', 'time', 't'])]))) list = obj;
      // Peakly traces export: peakRows (PK.schema.peakTableRows) carry areas etc. for the bare app peaks; merge by trace_id + peak_id.
      var rowsBy = {};
      if (sch && Array.isArray(obj.peakRows)) obj.peakRows.forEach(function (r) { if (r && r.trace_id != null && r.peak_id != null) rowsBy[r.trace_id + '\u0000' + r.peak_id] = r; });
      if (list) list.forEach(function (o, i) {
        var src = o;
        if (o && o.id != null && Array.isArray(o.peaks) && Object.keys(rowsBy).length) {
          src = assign({}, o, { peaks: o.peaks.map(function (pk) { var r = pk && rowsBy[o.id + '\u0000' + pk.id]; return r ? assign(peakRow(r), pk) : pk; }) });
        }
        var t = jsonTrace(src, base + (list.length > 1 ? ' ' + (i + 1) : '')); if (t && t.x.length) traces.push(t);
      });
      else { var t = jsonTrace(obj, base); if (t && t.x.length) traces.push(t); }
      if (!traces.length) return fail('JSON', 'The JSON was valid but no chromatogram data was found. Expected one of: [{"x":0,"y":1},…], [[0,1],…], {"x":[…],"y":[…]}, {"traces":[{"name":…,"x":[…],"y":[…]}]} or a saved Peakly project.');
      return okRes(sch ? 'Peakly traces' : 'JSON', traces, []);
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
