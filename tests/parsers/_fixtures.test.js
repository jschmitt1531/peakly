/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Shared fixture builders for tests/parsers/*.test.js (loaded first: "_" sorts before letters). Registers no tests.
   PK.parserFixtures = { bytesToBuf, asciiBuf, utf16leWithBom, b64encode, floatsLE, zlibShim, buildNetCDF, build130, build179,
     build181, mzmlDoc, mzChrom, readSample(name) -> ArrayBuffer|null, withSample(t, name, fn) -> Promise }.
   Sample files in samples/data/ are read only in Node (fs); in the in-browser self-test sample tests are skipped. */
(function (PK) {
  'use strict';
  var F = PK.parserFixtures = {};

  F.bytesToBuf = function (arr) { var u = new Uint8Array(arr.length); for (var i = 0; i < arr.length; i++) u[i] = arr[i] & 0xFF; return u.buffer; };
  F.utf16leWithBom = function (s) { var a = [0xFF, 0xFE]; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a.push(c & 0xFF, c >> 8); } return F.bytesToBuf(a); };
  F.asciiBuf = function (s) { var a = []; for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); return F.bytesToBuf(a); };
  F.b64encode = function (u8) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', s = '';
    for (var i = 0; i < u8.length; i += 3) {
      var n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0);
      s += A.charAt(n >> 18 & 63) + A.charAt(n >> 12 & 63) + (i + 1 < u8.length ? A.charAt(n >> 6 & 63) : '=') + (i + 2 < u8.length ? A.charAt(n & 63) : '=');
    }
    return s;
  };
  F.floatsLE = function (vals, bits) {
    var sz = bits / 8, dv = new DataView(new ArrayBuffer(vals.length * sz));
    vals.forEach(function (v, i) { if (bits === 64) dv.setFloat64(i * 8, v, true); else dv.setFloat32(i * 4, v, true); });
    return new Uint8Array(dv.buffer);
  };

  /* ---------- Node-only access (fs / zlib); null in the browser ---------- */
  function nodeModule(name) {
    try {
      var proc = typeof process !== 'undefined' ? process : null;
      if (!proc || !proc.versions || !proc.versions.node) return null;
      if (typeof proc.getBuiltinModule === 'function') return proc.getBuiltinModule(name);
      if (proc.mainModule) return proc.mainModule.require(name);
    } catch (e) { /* not Node */ }
    return null;
  }
  // zlib provider: real pako if loaded, else Node's zlib (tests only), else null → skip.
  F.zlibShim = function () {
    var pako = (typeof globalThis !== 'undefined' && globalThis.pako) || null;
    if (pako && pako.deflate) return { deflate: function (u) { return pako.deflate(u); }, install: function () { return function () {}; } };
    var zlib = nodeModule('zlib');
    if (!zlib) return null;
    return {
      deflate: function (u) { return new Uint8Array(zlib.deflateSync(u)); },
      install: function () { // temporarily provide a pako-compatible global
        globalThis.pako = { inflate: function (u) { return new Uint8Array(zlib.inflateSync(u)); } };
        return function () { delete globalThis.pako; };
      }
    };
  };
  function sampleDir() {
    var fs = nodeModule('fs'), path = nodeModule('path');
    if (!fs || !path) return null;
    var c = [];
    if (process.argv && process.argv[1]) c.push(path.resolve(path.dirname(process.argv[1]), '..', 'samples', 'data'));
    c.push(path.resolve(process.cwd(), 'samples', 'data'));
    for (var i = 0; i < c.length; i++) if (fs.existsSync(c[i])) return c[i];
    return null;
  }
  /** samples/data/<name> as an ArrayBuffer (Node only), else null. */
  F.readSample = function (name) {
    var dir = sampleDir(); if (!dir) return null;
    var fs = nodeModule('fs'), path = nodeModule('path'), p = path.join(dir, name);
    if (!fs.existsSync(p)) return null;
    var b = fs.readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  /** Parse samples/data/<name> with parseArrayBuffer and hand the ParseResult to fn; skipped (1 passing assertion) without fs. */
  F.withSample = function (t, name, fn, opts) {
    var buf = F.readSample(name);
    if (!buf) {
      if (nodeModule('fs')) { t.ok(false, 'sample file samples/data/' + name + ' is missing — run node tools/make-samples.js'); return; }
      t.ok(true, 'skipped: sample files are not available in the browser self-test'); return;
    }
    var o = { filename: name }; if (opts) for (var k in opts) o[k] = opts[k];
    return PK.parsers.parseArrayBuffer(buf, o).then(fn);
  };
  /** Index of the largest y value. */
  F.argmax = function (a) { var k = 0; for (var i = 1; i < a.length; i++) if (a[i] > a[k]) k = i; return k; };

  /* ---------- binary builders ---------- */
  // netCDF-3 classic (CDF1) writer for AIA fixtures.
  F.buildNetCDF = function (opts) {
    var N = opts.y.length;
    function header(begins) {
      var a = [];
      function u32(v) { a.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); }
      function str(s) { u32(s.length); for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); while (a.length % 4) a.push(0); }
      a.push(67, 68, 70, 1); u32(0);
      u32(10); u32(1); str('point_number'); u32(N);
      var atts = opts.attrs, keys = Object.keys(atts);
      u32(12); u32(keys.length);
      keys.forEach(function (k) { str(k); u32(2); str(atts[k]); });
      var vars = [['actual_sampling_interval', [], 4], ['actual_delay_time', [], 4], ['actual_run_time_length', [], 4], ['ordered_derivative_values', [0], 4 * N]];
      u32(11); u32(vars.length);
      vars.forEach(function (v, i) { str(v[0]); u32(v[1].length); v[1].forEach(u32); u32(0); u32(0); u32(5); u32(v[2]); u32(begins[i]); });
      return a;
    }
    var H = header([0, 0, 0, 0]).length, begins = [H, H + 4, H + 8, H + 12];
    var a = header(begins), dv = new DataView(new ArrayBuffer(a.length + 12 + 4 * N));
    a.forEach(function (b, i) { dv.setUint8(i, b); });
    dv.setFloat32(H, opts.interval); dv.setFloat32(H + 4, opts.delay); dv.setFloat32(H + 8, opts.runLength);
    opts.y.forEach(function (v, i) { dv.setFloat32(H + 12 + 4 * i, v); });
    return dv.buffer;
  };

  // Agilent ChemStation .ch writer (header facts from the public format notes).
  function chHeader(ver, extra) {
    var u = new Uint8Array(0x1800 + extra.length), dv = new DataView(u.buffer);
    function wstr(off, s) { u[off] = s.length; for (var i = 0; i < s.length; i++) { u[off + 1 + 2 * i] = s.charCodeAt(i); u[off + 2 + 2 * i] = 0; } }
    u[0] = 3; u[1] = ver.charCodeAt(0); u[2] = ver.charCodeAt(1); u[3] = ver.charCodeAt(2);
    wstr(0x146, ver); wstr(0x15B, ver === '130' ? 'LC DATA FILE' : 'GC DATA FILE');
    wstr(0x35A, 'Caffeine std'); wstr(0xA0E, 'TEST.M'); wstr(0xC11, 'LC1 ChemStation');
    u.set(extra, 0x1800);
    return { u: u, dv: dv, wstr: wstr };
  }
  F.build130 = function () {
    var seg = [], d = new DataView(new ArrayBuffer(64)), p = 0;
    function abs(v) { d.setInt16(p, -32768); d.setInt32(p + 2, v); p += 6; }
    function del(v) { d.setInt16(p, v); p += 2; }
    d.setUint8(p++, 16); d.setUint8(p++, 5);
    abs(1000); del(2); del(3); abs(900); del(-1);
    d.setUint8(p++, 0); d.setUint8(p++, 0);
    for (var i = 0; i < p; i++) seg.push(d.getUint8(i));
    var h = chHeader('130', seg);
    h.wstr(0x104C, 'mAU'); h.wstr(0x1075, 'DAD1 A, Sig=254,4 Ref=off');
    h.dv.setUint32(0x11A, 0); h.dv.setUint32(0x11E, 24000); h.dv.setFloat64(0x127C, 0.5);
    return h.u.buffer;
  };
  F.build179 = function () {
    var body = F.floatsLE([1.5, 2.5, 10, 3], 64), h = chHeader('179', body);
    h.wstr(0x104C, 'pA'); h.wstr(0x1075, 'Front Signal');
    h.dv.setUint32(0x116, 4); h.dv.setFloat32(0x11A, 120000); h.dv.setFloat32(0x11E, 123000); h.dv.setFloat64(0x127C, 2);
    return h.u.buffer;
  };
  F.build181 = function () {
    var d = new DataView(new ArrayBuffer(14));
    d.setInt16(0, 32767); d.setInt32(2, 0); d.setUint16(6, 1000); d.setInt16(8, 3); d.setInt16(10, 2); d.setInt16(12, -3);
    var h = chHeader('181', new Uint8Array(d.buffer));
    h.wstr(0x104C, 'pA');
    h.dv.setUint32(0x116, 4); h.dv.setFloat32(0x11A, 0); h.dv.setFloat32(0x11E, 3000); h.dv.setFloat64(0x127C, 1);
    return h.u.buffer;
  };

  F.mzmlDoc = function (chroms) {
    return '<?xml version="1.0" encoding="utf-8"?>\n<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">\n<run id="r1">\n' +
      '<chromatogramList count="' + chroms.length + '">\n' + chroms.join('\n') + '\n</chromatogramList>\n</run>\n</mzML>\n';
  };
  F.mzChrom = function (id, kindAcc, kindName, t, tBits, tUnit, y, yBits, zlib) {
    function arr(bytes, bits, typeAcc, typeName, unit) {
      var enc = zlib ? zlib.deflate(bytes) : bytes;
      return '<binaryDataArray encodedLength="0">' +
        '<cvParam cvRef="MS" accession="' + (bits === 64 ? 'MS:1000523' : 'MS:1000521') + '" name="' + bits + '-bit float"/>' +
        '<cvParam cvRef="MS" accession="' + (zlib ? 'MS:1000574' : 'MS:1000576') + '" name="' + (zlib ? 'zlib compression' : 'no compression') + '"/>' +
        '<cvParam cvRef="MS" accession="' + typeAcc + '" name="' + typeName + '"' + unit + '/>' +
        '<binary>' + F.b64encode(enc) + '</binary></binaryDataArray>';
    }
    var tu = tUnit === 'min' ? ' unitCvRef="UO" unitAccession="UO:0000031" unitName="minute"' : ' unitCvRef="UO" unitAccession="UO:0000010" unitName="second"';
    return '<chromatogram index="0" id="' + id + '" defaultArrayLength="' + t.length + '">' +
      '<cvParam cvRef="MS" accession="' + kindAcc + '" name="' + kindName + '"/>' +
      '<binaryDataArrayList count="2">' + arr(F.floatsLE(t, tBits), tBits, 'MS:1000595', 'time array', tu) +
      arr(F.floatsLE(y, yBits), yBits, 'MS:1000515', 'intensity array', ' unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"') +
      '</binaryDataArrayList></chromatogram>';
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
