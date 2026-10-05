/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "mzml": HUPO-PSI mzML 1.1 chromatograms.
   Format: XML; <chromatogramList><chromatogram id=...> with <binaryDataArray> elements whose cvParams give the array type
     (MS:1000595 time array, MS:1000515 intensity array), precision (MS:1000521 32-bit / MS:1000523 64-bit float,
     MS:1000519/1000522 ints), compression (MS:1000574 zlib via the pako global, MS:1000576 none) and units
     (UO:0000010 second, UO:0000031 minute). Falls back to a TIC built from MS1 spectrum-level cvParams.
   Sniff: <mzML or <indexedmzML -> 0.95; other XML mentioning "chromatogram" -> 0.5.
   Variants: TIC/BPC/SRM/UV (absorption) chromatograms; MS-Numpress is rejected with advice.
   Format knowledge: PSI mzML 1.1.0 specification and the PSI-MS controlled vocabulary (psi-ms.obo).
   Sample: samples/data/mzml.mzML */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var glob = H.glob, baseName = H.baseName, wavelengthOf = H.wavelengthOf, mkTrace = H.mkTrace, fail = H.fail, okRes = H.okRes;

  var B64 = (function () { var t = new Int16Array(128).fill(-1), s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; for (var i = 0; i < 64; i++) t[s.charCodeAt(i)] = i; t[45] = 62; t[95] = 63; return t; })();
  function b64decode(str) {
    var n = 0, out = new Uint8Array(Math.floor(str.length * 3 / 4) + 3), acc = 0, bits = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i), v = c < 128 ? B64[c] : -1; if (v < 0) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 0xFF; }
    }
    return out.subarray(0, n);
  }
  /** Attribute value with XML character references decoded (&quot; &amp; &#x..;), single or double quoted. */
  function xattr(tag, nm) { var m = new RegExp('\\s' + nm + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(tag); return m ? decodeXml(m[1] != null ? m[1] : m[2]) : null; }
  function decodeXml(s) { return PK.util && PK.util.decodeXmlEntities ? PK.util.decodeXmlEntities(s) : s; }
  function cvParams(xml) {
    var out = [], re = /<cvParam\b[^>]*>/g, m;
    while ((m = re.exec(xml))) out.push({ acc: xattr(m[0], 'accession'), name: xattr(m[0], 'name') || '', value: xattr(m[0], 'value'), unitAcc: xattr(m[0], 'unitAccession'), unitName: xattr(m[0], 'unitName') || '' });
    return out;
  }
  function hasCv(cvs, acc) { for (var i = 0; i < cvs.length; i++) if (cvs[i].acc === acc) return cvs[i]; return null; }
  function decodeBinaryArray(b64, cvs) {
    var bytes = b64decode(b64.replace(/\s+/g, ''));
    if (hasCv(cvs, 'MS:1002312') || hasCv(cvs, 'MS:1002313') || hasCv(cvs, 'MS:1002314') || /numpress/i.test(cvs.map(function (c) { return c.name; }).join(' ')))
      throw new Error('MS-Numpress compressed arrays are not supported. Re-convert with msconvert without --numpress.');
    if (hasCv(cvs, 'MS:1000574')) {
      var pako = glob('pako');
      if (!pako) throw new Error('the data is zlib-compressed and the decompression library (pako) is not loaded. Check your internet connection and reload, or convert with msconvert --noZlib.');
      bytes = pako.inflate(bytes);
    }
    var dvw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [], sz, rdr;
    if (hasCv(cvs, 'MS:1000523')) { sz = 8; rdr = function (o) { return dvw.getFloat64(o, true); }; }
    else if (hasCv(cvs, 'MS:1000519')) { sz = 4; rdr = function (o) { return dvw.getInt32(o, true); }; }
    else if (hasCv(cvs, 'MS:1000522')) { sz = 8; rdr = function (o) { return dvw.getInt32(o, true) + dvw.getInt32(o + 4, true) * 4294967296; }; }
    else { sz = 4; rdr = function (o) { return dvw.getFloat32(o, true); }; }
    for (var o = 0; o + sz <= bytes.length; o += sz) out.push(rdr(o));
    return out;
  }
  function mzTimeUnit(cv) {
    if (!cv) return null;
    if (cv.unitAcc === 'UO:0000031' || /minute/i.test(cv.unitName)) return 'min';
    if (cv.unitAcc === 'UO:0000010' || /^second/i.test(cv.unitName)) return 'sec';
    if (cv.unitAcc === 'UO:0000028' || /millisecond/i.test(cv.unitName)) return 'ms';
    return null;
  }
  function parseMzml(text, opts) {
    var w = [], traces = [], base = baseName(opts.filename), re = /<chromatogram\b([^>]*)>([\s\S]*?)<\/chromatogram>/g, m, count = 0, MAX = 24;
    while ((m = re.exec(text))) {
      count++; if (traces.length >= MAX) continue;
      var id = xattr(' ' + m[1], 'id') || 'chromatogram ' + count, body = m[2];
      var arrays = [], are = /<binaryDataArray\b[^>]*>([\s\S]*?)<\/binaryDataArray>/g, a;
      while ((a = are.exec(body))) { var bm = /<binary>([\s\S]*?)<\/binary>/.exec(a[1]); arrays.push({ cvs: cvParams(a[1]), b64: bm ? bm[1] : '' }); }
      var ccvs = cvParams(body.replace(/<binaryDataArrayList[\s\S]*<\/binaryDataArrayList>/, ''));
      var kind = ccvs.filter(function (c) { return /chromatogram/i.test(c.name); })[0];
      var tArr = arrays.filter(function (x) { return hasCv(x.cvs, 'MS:1000595'); })[0];
      var yArr = arrays.filter(function (x) { return hasCv(x.cvs, 'MS:1000515') || hasCv(x.cvs, 'MS:1000617') === null && x !== tArr && /intensity|absorb|signal/i.test(x.cvs.map(function (c) { return c.name; }).join(' ')); })[0] || arrays.filter(function (x) { return x !== tArr; })[0];
      if (!tArr || !yArr) { w.push('Chromatogram "' + id + '" has no time/intensity arrays; skipped.'); continue; }
      var xs = decodeBinaryArray(tArr.b64, tArr.cvs), ys = decodeBinaryArray(yArr.b64, yArr.cvs);
      var tcv = hasCv(tArr.cvs, 'MS:1000595'), unit = mzTimeUnit(tcv);
      if (!unit) { unit = xs.length && xs[xs.length - 1] > 200 ? 'sec' : 'min'; w.push('Chromatogram "' + id + '" time unit not stated; assumed ' + (unit === 'sec' ? 'seconds' : 'minutes') + '.'); }
      var ycv = yArr.cvs.filter(function (c) { return c.unitName || c.unitAcc; })[0], yUnit = 'counts';
      if (ycv) yUnit = /absorbance/i.test(ycv.unitName) ? 'AU' : /count/i.test(ycv.unitName) ? 'counts' : (ycv.unitName || 'a.u.');
      var kname = kind ? kind.name : '';
      if (/absorption|electromagnetic|emission/i.test(kname) && !ycv) yUnit = 'a.u.';
      var n = Math.min(xs.length, ys.length);
      var meta = { channel: kname || id, chromatogramId: id };
      var wl = wavelengthOf(id + ' ' + kname); if (wl) meta.wavelength = wl;
      traces.push(mkTrace((base ? base + ' ' : '') + (/^TIC$/i.test(id) ? 'TIC' : id), xs.slice(0, n), ys.slice(0, n), unit, yUnit, meta));
    }
    if (count > MAX) w.push('This mzML has ' + count + ' chromatograms; only the first ' + MAX + ' were loaded.');
    if (!traces.length) { // fall back: TIC from spectrum-level cvParams
      var sre = /<spectrum\b[^>]*>([\s\S]*?)<\/spectrum>/g, s, xs2 = [], ys2 = [], su = null;
      while ((s = sre.exec(text))) {
        var cv = cvParams(s[1].replace(/<binaryDataArrayList[\s\S]*<\/binaryDataArrayList>/, ''));
        var lvl = hasCv(cv, 'MS:1000511'); if (lvl && +lvl.value !== 1) continue;
        var st = hasCv(cv, 'MS:1000016'), tic = hasCv(cv, 'MS:1000285');
        if (st && tic) { xs2.push(+st.value); ys2.push(+tic.value); su = su || mzTimeUnit(st); }
      }
      if (xs2.length) { w.push('No <chromatogramList>; built the TIC from MS1 spectrum totals.'); traces.push(mkTrace((base ? base + ' ' : '') + 'TIC', xs2, ys2, su || 'min', 'counts', { channel: 'TIC (from spectra)' })); }
    }
    if (!traces.length) return fail('mzML', 'No chromatograms were found in this mzML (no <chromatogram> entries and no spectrum-level total ion current). Re-convert with msconvert keeping chromatograms.');
    // TIC first
    traces.sort(function (p, q) { return (/TIC$/.test(q.name) ? 1 : 0) - (/TIC$/.test(p.name) ? 1 : 0); });
    return okRes('mzML', traces, w);
  }
  P.register({
    id: 'mzml', order: 60, name: 'mzML', extensions: ['mzml'], binary: false,
    description: 'TIC/BPC/SRM and UV chromatograms; base64, zlib (pako), 32/64-bit floats.',
    sniff: function (head) { return /<(indexedmzML|mzML)\b/.test(head) ? 0.95 : (/<\?xml/.test(head) && /chromatogram/i.test(head) ? 0.5 : 0); },
    parse: function (text, opts) { return parseMzml(text, opts || {}); }
  });

  P._internal = P._internal || {}; P._internal.b64decode = b64decode;
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
