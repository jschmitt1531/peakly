/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly parser plugin "netcdf": AnDI / AIA chromatography netCDF (ASTM E1947) and AnDI-MS (ASTM E2077) TIC.
   Format: netCDF-3 classic (CDF1) or 64-bit offset (CDF2) container, big-endian. Chromatography files store
     ordered_derivative_values (signal), actual_sampling_interval, actual_delay_time, actual_run_time_length (seconds by
     default; global attribute retention_unit), detector_unit, sample_name, detector_name, injection_date_time_stamp.
     AnDI-MS files store total_intensity + scan_acquisition_time.
   Sniff: magic "CDF\x01" / "CDF\x02" -> 0.98 (HDF5 magic gets 0.05 so the unsupported plugin explains netCDF-4).
   Variants: optional raw_data_retention axis; missing sampling interval (derived from run length); fill values > 1e30.
   Format knowledge: Unidata netCDF classic format specification; ASTM E1947-98 variable names. Reader written from scratch.
   Sample: samples/data/netcdf.cdf */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, latin1 = H.latin1, normYUnit = H.normYUnit, wavelengthOf = H.wavelengthOf, mkTrace = H.mkTrace, fail = H.fail, okRes = H.okRes;

  /** Minimal netCDF-3 classic (CDF1/CDF2) reader. → { version, numrecs, dims[], attrs{}, vars{}, get(name) } */
  function readNetCDF(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), p = 0, len = u8.length;
    function need(n) { if (p + n > len) throw new Error('the file is truncated (needed ' + n + ' bytes at offset ' + p + ', file has ' + len + ').'); }
    function u32() { need(4); var v = dv.getUint32(p); p += 4; return v; }
    function pad4(n) { return (n + 3) & ~3; }
    function name() { var n = u32(); need(n); var s = latin1(u8, p, n); p += pad4(n); return s; }
    var SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
    function rd(t, o) { switch (t) { case 1: return dv.getInt8(o); case 3: return dv.getInt16(o); case 4: return dv.getInt32(o); case 5: return dv.getFloat32(o); case 6: return dv.getFloat64(o); } return NaN; }
    function values(t, n) {
      var sz = SZ[t]; if (!sz) throw new Error('unknown netCDF data type ' + t + '.');
      need(n * sz); var out;
      if (t === 2) out = latin1(u8, p, n).replace(/\u0000+$/, '');
      else { out = []; for (var i = 0; i < n; i++) out.push(rd(t, p + i * sz)); if (out.length === 1) out = out[0]; }
      p += pad4(n * sz); return out;
    }
    function attList() {
      var tag = u32(), n = u32(), a = Object.create(null); // names come from the file: no prototype to pollute
      if (tag === 0) return a; if (tag !== 12) throw new Error('bad attribute list tag ' + tag + '.');
      for (var i = 0; i < n; i++) { var nm = name(), t = u32(), k = u32(); a[nm] = values(t, k); }
      return a;
    }
    if (latin1(u8, 0, 3) !== 'CDF') throw new Error('missing "CDF" signature.');
    var ver = u8[3];
    if (ver === 5) throw new Error('this is a 64-bit-data netCDF (CDF5) file; only classic netCDF-3 (AIA/ANDI) is supported.');
    if (ver !== 1 && ver !== 2) throw new Error('unknown netCDF version byte ' + ver + '.');
    p = 4;
    var numrecs = u32(), dims = [], tag = u32(), n = u32(), i;
    if (tag === 10) for (i = 0; i < n; i++) dims.push({ name: name(), len: u32() }); else if (tag !== 0) throw new Error('bad dimension list tag ' + tag + '.');
    var attrs = attList(), vars = Object.create(null), order = [];
    tag = u32(); n = u32();
    if (tag === 11) for (i = 0; i < n; i++) {
      var vn = name(), nd = u32(), ids = []; for (var k = 0; k < nd; k++) ids.push(u32());
      var va = attList(), t = u32(), vsize = u32(), begin = ver === 2 ? u32() * 4294967296 + u32() : u32();
      vars[vn] = { name: vn, dimids: ids, attrs: va, type: t, vsize: vsize, begin: begin, isRecord: ids.length > 0 && dims[ids[0]] && dims[ids[0]].len === 0 };
      order.push(vn);
    } else if (tag !== 0) throw new Error('bad variable list tag ' + tag + '.');
    var recVars = order.filter(function (k) { return vars[k].isRecord; });
    var recsize = 0; recVars.forEach(function (k) { recsize += vars[k].vsize; });
    if (recVars.length === 1) { var rv = vars[recVars[0]]; recsize = SZ[rv.type] * rv.dimids.slice(1).reduce(function (a, d) { return a * dims[d].len; }, 1); }
    if (numrecs === 0xFFFFFFFF && recVars.length) numrecs = Math.floor((len - vars[recVars[0]].begin) / Math.max(1, recsize));
    function get(nm) {
      var v = vars[nm]; if (!v) return null;
      var sz = SZ[v.type], cnt = v.dimids.slice(v.isRecord ? 1 : 0).reduce(function (a, d) { return a * dims[d].len; }, 1);
      var nrec = v.isRecord ? numrecs : 1, out = [];
      for (var r = 0; r < nrec; r++) {
        var off = v.begin + (v.isRecord ? r * recsize : 0);
        if (off + cnt * sz > len) throw new Error('variable "' + nm + '" runs past the end of the file (truncated?).');
        if (v.type === 2) { out.push(latin1(u8, off, cnt).replace(/\u0000+$/, '')); continue; }
        for (var j = 0; j < cnt; j++) out.push(rd(v.type, off + j * sz));
      }
      return v.type === 2 ? out.join('') : out;
    }
    return { version: ver, numrecs: numrecs, dims: dims, attrs: attrs, vars: vars, get: get };
  }
  function ncScalar(nc, nm) { var v = nc.get(nm); if (v == null) return NaN; v = Array.isArray(v) ? v[0] : v; return typeof v === 'number' && Math.abs(v) < 1e30 ? v : NaN; }
  function parseAndi(buf, opts) {
    var nc = readNetCDF(buf), A = nc.attrs, w = [], base = baseName(opts.filename);
    var hdr = {}; Object.keys(A).forEach(function (k) { hdr[k] = Array.isArray(A[k]) ? A[k].join(', ') : A[k]; });
    var meta = { header: hdr };
    if (A.sample_name || A.sample_id) meta.sampleName = A.sample_name || A.sample_id;
    if (A.detector_name) meta.channel = A.detector_name;
    if (A.injection_date_time_stamp) meta.injectionDate = A.injection_date_time_stamp;
    var wl = wavelengthOf(String(A.detector_name || '') + ' ' + String(A.detection_method_name || '')); if (wl) meta.wavelength = wl;
    var y = nc.get('ordered_derivative_values');
    if (y) {
      var n = y.length, si = ncScalar(nc, 'actual_sampling_interval'), dl = ncScalar(nc, 'actual_delay_time') || 0, rl = ncScalar(nc, 'actual_run_time_length');
      var ru = String(A.retention_unit || 'seconds').toLowerCase(), unit = /min/.test(ru) ? 'min' : /^ms|milli/.test(ru) ? 'ms' : 'sec';
      var x = null, rt = nc.get('raw_data_retention');
      if (rt && rt.length === n) x = rt;
      else {
        if (!(si > 0) && rl > 0 && n > 1) { si = rl / (n - 1); w.push('No sampling interval stored; derived from the run length.'); }
        if (!(si > 0)) { si = 1; w.push('No sampling interval or run length stored; x is the point index in seconds — set the time axis manually.'); }
        x = []; for (var i = 0; i < n; i++) x.push(dl + i * si);
      }
      var ys = y.map(function (v) { return Math.abs(v) > 1e30 ? NaN : v; });
      var yUnit = A.detector_unit ? (normYUnit(A.detector_unit) || String(A.detector_unit)) : 'a.u.';
      if (!A.detector_unit) w.push('No detector_unit attribute; signal unit set to "a.u.".');
      return okRes('AnDI/AIA netCDF', [mkTrace(meta.sampleName || base || 'AIA trace', x, ys, unit, yUnit, meta)], w);
    }
    var tic = nc.get('total_intensity'), st = nc.get('scan_acquisition_time');
    if (tic && st && tic.length === st.length) {
      meta.role = undefined; delete meta.role;
      return okRes('AnDI-MS netCDF (TIC)', [mkTrace((meta.sampleName || base || 'MS') + ' TIC', st, tic, 'sec', 'counts', meta)], ['Mass-spec AnDI file: showing the total ion chromatogram.']);
    }
    return fail('AnDI/AIA netCDF', 'This netCDF file has no "ordered_derivative_values" (AIA chromatography) or "total_intensity" (AnDI-MS) variable. Variables found: ' + (Object.keys(nc.vars).join(', ') || 'none') + '.');
  }
  P.register({
    id: 'netcdf', order: 50, name: 'AnDI/AIA netCDF', extensions: ['cdf', 'nc', 'andi', 'aia'], binary: true,
    description: 'ASTM E1947 chromatography netCDF-3 (CDF1/CDF2); AnDI-MS TIC.',
    sniff: function (head) { return /^CDF[\u0001\u0002]/.test(head) ? 0.98 : (/^\u0089HDF/.test(head) ? 0.05 : 0); },
    parse: function (buf, opts) { return parseAndi(buf, opts || {}); }
  });

  P._internal = P._internal || {}; P._internal.readNetCDF = readNetCDF;
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
