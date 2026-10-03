/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "chromatopy": interop with chromatoPy (Otiniano et al., MIT; github.com/GerardOtiniano/chromatoPy).
   Format 1, FID_output.json (written by chromatoPy's GC-FID integration):
     { "Samples": { "<sample>": { "Metadata": {...} | "text",
                                  "Raw Data": { "<time column>": [...], "<signal column>": [...] },
                                  "Processed Data": { "<peak label>": {
                                      "Peak Area - best fit", "Peak Area - median", "Peak Area - mean",
                                      "Peak Area - standard deviation", "Peak Area - number of ensemble members",
                                      "Area Ensembles"?: [areas...],   // older/alternate writers store the ensemble itself
                                      "Model Parameters": { name:'single'|'multi'|'asymmetric', x:[fit x], y:[fit y],
                                                            params:[amp, cen, wid, ...], pcov, error, idx_interest, multi_flag },
                                      "Retention Time" } | [NaN]  // [NaN] = peak not found } } },
       "Integration Metadata": { "peak dictionary": {label: rt} | [labels], "x limits": [min, max],
                                 "time_column": "...", "signal_column": "..." } }
     -> one trace per sample from Raw Data, plus traces[i].peaks = [{ start, apex, end, label, area (ensemble mean),
        areaSE (ensemble standard deviation), areaBestFit, areaMedian, nEnsemble, model, source:'chromatopy' }].
        start/end = range of the stored fit curve x (or cen ± 3·wid from the Gaussian params); apex = Retention Time.
   Format 2, hplc_to_csv CSV (chromatoPy converts Agilent .D MS data to CSV via the rainbow exporter):
     header "RT (min),<m/z>,<m/z>,..." (ion masses as bare numbers), then one row per scan -> one trace per ion ("m/z 744").
   Sniff: "Samples" with "Raw Data"/"Processed Data"/"Integration Metadata" keys -> 0.97; first line "RT (min)," followed by
     numeric column names -> 0.9. JSON already parsed by the json plugin reaches this plugin through sniffJSON().
   Variants: Raw Data as column dict (pandas orient="list") or list of row objects; Metadata as dict or string; missing
     Processed Data (raw only); peak dictionary as dict or list.
   Format knowledge: chromatoPy README "JSON Output Structure" and its public source (MIT) describing the written keys;
     no chromatoPy code is used.
   Samples: samples/data/chromatopy_FID_output.json, samples/data/chromatopy_hplc.csv */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, trim = H.trim, splitLines = H.splitLines, splitLine = H.splitLine, unquote = H.unquote, isTimeHeader = H.isTimeHeader,
    xUnitFromHeader = H.xUnitFromHeader, yUnitFromHeader = H.yUnitFromHeader, mkTrace = H.mkTrace, normPeaks = H.normPeaks,
    fail = H.fail, okRes = H.okRes, assign = H.assign;
  var FORMAT = 'chromatoPy output';

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function numArr(a) { return Array.isArray(a) && a.length > 0 && a.some(function (v) { return typeof v === 'number' || (typeof v === 'string' && isFinite(+v)); }); }
  function mean(a) { var s = 0; a.forEach(function (v) { s += v; }); return s / a.length; }
  function sd(a) { if (a.length < 2) return NaN; var m = mean(a), s = 0; a.forEach(function (v) { s += (v - m) * (v - m); }); return Math.sqrt(s / (a.length - 1)); }
  function finite(v) { return typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v !== '' && isFinite(+v) ? +v : undefined); }
  function describe(o) { return Object.keys(o || {}).slice(0, 12).map(function (k) { var v = o[k]; return k + ' (' + (Array.isArray(v) ? 'array[' + v.length + ']' : v === null ? 'null' : typeof v) + ')'; }).join(', '); }

  // Raw Data as {col:[...]} or [{col:v}, ...] -> {cols:[names], get(name) -> array}
  function columns(raw) {
    if (Array.isArray(raw) && raw.length && isObj(raw[0])) {
      var names = Object.keys(raw[0]);
      return { cols: names, get: function (n) { return raw.map(function (r) { return r[n]; }); } };
    }
    if (isObj(raw)) {
      var ks = Object.keys(raw).filter(function (k) { return numArr(raw[k]); });
      return { cols: ks, get: function (n) { return raw[n]; } };
    }
    return null;
  }

  function peakFrom(label, v, dict) {
    if (!isObj(v)) return null; // [NaN] marks "not found"
    var ens = v['Area Ensembles'] || v['Area Ensemble'] || v['Peak Area - ensemble'];
    ens = Array.isArray(ens) ? ens.map(Number).filter(isFinite) : null;
    var area = ens && ens.length ? mean(ens) : finite(v['Peak Area - mean']);
    var se = ens && ens.length > 1 ? sd(ens) : finite(v['Peak Area - standard deviation']);
    var best = finite(v['Peak Area - best fit']), med = finite(v['Peak Area - median']);
    if (area === undefined) area = best !== undefined ? best : med;
    var mp = isObj(v['Model Parameters']) ? v['Model Parameters'] : {};
    var apex = finite(v['Retention Time']), start, end;
    if (numArr(mp.x)) {
      var xs = mp.x.map(Number).filter(isFinite);
      start = Math.min.apply(null, xs); end = Math.max.apply(null, xs);
    }
    if (Array.isArray(mp.params) && mp.params.length >= 3) {
      var k = mp.multi_flag && isFinite(+mp.idx_interest) ? 3 * (+mp.idx_interest) : 0;
      var cen = finite(mp.params[k + 1]), wid = Math.abs(finite(mp.params[k + 2]) || 0);
      if (apex === undefined) apex = cen;
      if (start === undefined && cen !== undefined && wid > 0) { start = cen - 3 * wid; end = cen + 3 * wid; }
    }
    if (apex === undefined && dict && isObj(dict)) apex = finite(dict[label]);
    if (apex === undefined) return null;
    var p = { start: start, apex: apex, end: end, label: String(label), source: 'chromatopy' };
    if (area !== undefined) p.area = area;
    if (se !== undefined) p.areaSE = se;
    if (best !== undefined) p.areaBestFit = best;
    if (med !== undefined) p.areaMedian = med;
    var n = ens && ens.length ? ens.length : finite(v['Peak Area - number of ensemble members']);
    if (n !== undefined) p.nEnsemble = n;
    if (mp.name) p.model = String(mp.name);
    return p;
  }

  function flatMeta(md) {
    if (!md) return undefined;
    if (typeof md === 'string') return { text: md.slice(0, 4000) };
    if (!isObj(md)) return undefined;
    var out = {};
    Object.keys(md).forEach(function (k) {
      var v = md[k];
      if (isObj(v)) Object.keys(v).forEach(function (k2) { if (typeof v[k2] !== 'object') out[k + ' / ' + k2] = String(v[k2]); });
      else if (!Array.isArray(v)) out[k] = String(v);
    });
    return out;
  }

  function parseFID(obj, opts) {
    var S = obj.Samples, im = isObj(obj['Integration Metadata']) ? obj['Integration Metadata'] : {};
    if (!isObj(S)) return fail(FORMAT, 'A chromatoPy file needs a "Samples" object. Found keys: ' + (describe(obj) || 'none') + '.');
    var traces = [], w = [], missing = 0, names = Object.keys(S);
    names.forEach(function (name) {
      var s = S[name];
      var c = isObj(s) ? columns(s['Raw Data']) : null;
      if (!c || c.cols.length < 2) { w.push('Sample "' + name + '" has no usable "Raw Data" (time and signal arrays); skipped.'); return; }
      var tcol = c.cols.indexOf(im.time_column) >= 0 ? im.time_column : c.cols.filter(isTimeHeader)[0] || c.cols[0];
      var scol = c.cols.indexOf(im.signal_column) >= 0 ? im.signal_column : c.cols.filter(function (k) { return k !== tcol; })[0];
      var xu = xUnitFromHeader(tcol) || 'min', yu = yUnitFromHeader(scol) || 'a.u.';
      var meta = { sampleName: name, column: scol, timeColumn: tcol };
      var hdr = flatMeta(s.Metadata); if (hdr) meta.header = hdr;
      if (!xUnitFromHeader(tcol)) w.push('Time column "' + tcol + '" has no unit; assumed minutes.');
      var tr = mkTrace(name, c.get(tcol), c.get(scol), xu, yu, meta);
      var pd = isObj(s['Processed Data']) ? s['Processed Data'] : {}, list = [];
      Object.keys(pd).forEach(function (label) { var p = peakFrom(label, pd[label], im['peak dictionary']); if (p) list.push(p); else missing++; });
      var pk = normPeaks(list, xu, 'chromatopy');
      if (pk.length) tr.peaks = pk;
      if (tr.x.length) traces.push(tr);
    });
    if (missing) w.push(missing + ' labelled peak' + (missing === 1 ? ' was' : 's were') + ' marked as not found by chromatoPy and skipped.');
    if (!traces.length) return fail(FORMAT, 'The chromatoPy file has ' + names.length + ' sample(s) but none with "Raw Data" time/signal arrays. ' + (w.join(' ') || ''));
    var extra = {};
    if (im['peak dictionary']) extra.integrationMetadata = { peakDictionary: im['peak dictionary'], xLimits: im['x limits'] };
    return okRes(FORMAT, traces, w, extra);
  }

  var CSV_HEAD = /^\s*"?RT \((min|sec|s|ms)\)"?\s*,\s*"?\d+(\.\d+)?"?\s*(,|$)/i;
  function parseHplcCsv(text, opts) {
    var lines = splitLines(text), i = 0;
    while (i < lines.length && !trim(lines[i])) i++;
    var head = splitLine(lines[i] || '', ',').map(unquote);
    var t = P.parseDelimited(lines.slice(i + 1).join('\n'), { delimiter: ',', noHeader: true });
    if (!t.rows.length) return H.noTableError(FORMAT, text);
    var base = baseName(opts.filename), xu = xUnitFromHeader(head[0]) || 'min', yCols = [], names = [];
    for (var c = 1; c < t.ncols; c++) { yCols.push(c); names.push((base ? base + ' ' : '') + 'm/z ' + (head[c] || '?')); }
    t.header = head.slice(0, t.ncols);
    var traces = P.buildTraces(t, { xCol: 0, yCols: yCols, xUnit: xu, yUnit: 'counts', names: names, meta: {} });
    traces.forEach(function (tr, k) { var mz = parseFloat(head[k + 1]); tr.meta = assign({}, tr.meta, { mz: isFinite(mz) ? mz : undefined, chromatogram: 'extracted ion' }); if (tr.meta.mz === undefined) delete tr.meta.mz; delete tr.meta.column; });
    return okRes(FORMAT + ' (HPLC CSV)', traces, traces.length > 12 ? ['This file has ' + traces.length + ' ion traces; hide the ones you do not need in the trace list.'] : []);
  }

  P.register({
    id: 'chromatopy', order: 150, name: FORMAT, extensions: ['json', 'csv'], binary: false,
    description: 'chromatoPy FID_output.json (traces + fitted peaks with ensemble area ± SD) and hplc_to_csv ion CSVs.',
    sniff: function (head) {
      if (/"Samples"\s*:/.test(head) && /"(Raw Data|Processed Data|Integration Metadata|Metadata)"\s*:/.test(head)) return 0.97;
      return CSV_HEAD.test(head.split(/\r\n|\n|\r/).filter(function (l) { return trim(l); })[0] || '') ? 0.9 : 0;
    },
    sniffJSON: function (obj) {
      if (!isObj(obj) || !isObj(obj.Samples)) return 0;
      var ks = Object.keys(obj.Samples);
      return ks.some(function (k) { return isObj(obj.Samples[k]) && ('Raw Data' in obj.Samples[k] || 'Processed Data' in obj.Samples[k]); }) || 'Integration Metadata' in obj ? 0.97 : 0;
    },
    parseJSON: function (obj, opts) { return parseFID(obj, opts || {}); },
    parse: function (text, opts) {
      opts = opts || {};
      if (/^\s*[\[{]/.test(text)) {
        var obj;
        try { obj = H.parseJSONLoose(text); } catch (e) { return fail(FORMAT, 'This looks like a chromatoPy JSON file but could not be read (' + e.message + '). The file may be truncated.'); }
        return parseFID(obj, opts);
      }
      return parseHplcCsv(text, opts);
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
