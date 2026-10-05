/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly parser plugin "agilent-ch": Agilent ChemStation / OpenLab CDS 2D signal files (.ch).
   Format: 6144-byte (0x1800) big-endian header with length-prefixed UTF-16LE strings (sample name 0x35A, method 0xA0E,
     instrument 0xC11, units 0x104C, signal description 0x1075), start/end times in ms at 0x11A/0x11E, y scale (float64)
     at 0x127C; data from 0x1800.
     130/131 (LC): segments of [0x10, count] followed by int16 deltas; -32768 escapes an int32 absolute value.
     179: little-endian float64 values. 181: int16 double-delta stream with 0x7FFF escape to a 48-bit absolute.
   Sniff: first byte is the length of an ASCII version string 130/131/30/31/179/181 -> 0.95 (or UTF-16 version at 0x146 -> 0.9).
   Variants: DAD/VWD/MWD (130), FID/TCD (179/181). .uv spectra files are routed to the unsupported plugin.
   Format knowledge: public prose notes on the ChemStation layout (rainbow docs, read only; no LGPL code used) and
     verification against synthetic files.
   Sample: samples/data/agilent-ch.ch (type 130) */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, trim = H.trim, latin1 = H.latin1, normYUnit = H.normYUnit, wavelengthOf = H.wavelengthOf, mkTrace = H.mkTrace, fail = H.fail, okRes = H.okRes;

  // Length-prefixed UTF-16LE header string at a fixed offset.
  function chStr(u8, off) {
    if (off >= u8.length) return '';
    var n = u8[off], s = '';
    for (var i = 0; i < n && off + 2 + 2 * i <= u8.length; i++) s += String.fromCharCode(u8[off + 1 + 2 * i] | (u8[off + 2 + 2 * i] << 8));
    return trim(s.replace(/\u0000/g, ''));
  }
  function chVersion(u8) {
    var a = u8.length > 4 ? latin1(u8, 1, u8[0]) : '';
    if (/^\d+$/.test(a)) return a;
    var b = chStr(u8, 0x146); return /^\d+$/.test(b) ? b : null;
  }
  var CH_DATA = 0x1800;
  function parseCh(buf, opts) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), w = [], ver = chVersion(u8), len = u8.length;
    if (!ver) return fail('Agilent ChemStation .ch', 'The file has no ChemStation version tag at the start. It doesn\'t look like a ChemStation .ch file; export the signal as CSV from ChemStation/OpenLab instead.');
    if (['130', '131', '30', '31', '179', '181'].indexOf(ver) < 0) return fail('Agilent ChemStation .ch', 'ChemStation file version ' + ver + ' is not supported (supported: 130/131 LC and 179/181). Export the signal as CSV or AIA/ANDI (.cdf) instead.');
    if (len < CH_DATA + 2) return fail('Agilent ChemStation .ch', 'The file is too short (' + len + ' bytes) to contain data; ChemStation headers alone are 6144 bytes.');
    var units = chStr(u8, 0x104C), signal = ver === '181' ? '' : chStr(u8, 0x1075);
    var meta = { sampleName: chStr(u8, 0x35A) || undefined, date: chStr(u8, 0x957) || undefined, method: chStr(u8, 0xA0E) || undefined,
      instrument: chStr(u8, 0xC11) || undefined, channel: signal || undefined, chVersion: +ver, fileType: chStr(u8, 0x15B) || undefined };
    Object.keys(meta).forEach(function (k) { if (meta[k] === undefined) delete meta[k]; });
    var wl = wavelengthOf(signal); if (wl) meta.wavelength = wl;
    var scale = dv.getFloat64(0x127C, false);
    if (!isFinite(scale) || scale === 0) { scale = 1; w.push('No scaling factor in the header; raw values used.'); }
    var vals = [], t0, t1, p = CH_DATA;
    if (ver === '130' || ver === '131' || ver === '30' || ver === '31') {
      t0 = dv.getUint32(0x11A, false); t1 = dv.getUint32(0x11E, false);
      var acc = 0;
      while (p + 2 <= len) {
        var label = u8[p], cnt = u8[p + 1]; p += 2;
        if (label === 0 && cnt === 0) break;
        if (label !== 16) { w.push('Unexpected data segment marker ' + label + ' at byte ' + (p - 2) + '; stopped reading there.'); break; }
        for (var k = 0; k < cnt && p + 2 <= len; k++) {
          var d = dv.getInt16(p, false); p += 2;
          if (d === -32768) { if (p + 4 > len) break; acc = dv.getInt32(p, false); p += 4; } else acc += d;
          vals.push(acc * scale);
        }
      }
    } else {
      var n = dv.getUint32(0x116, false), room = Math.floor((len - CH_DATA) / 8);
      t0 = dv.getFloat32(0x11A, false); t1 = dv.getFloat32(0x11E, false);
      var asDoubles = ver === '179' || (n > 0 && Math.abs(room - n) <= 1);
      if (asDoubles) {
        if (!n || n > room) { if (n > room) w.push('Header says ' + n + ' points but the file holds ' + room + '; file may be truncated.'); n = room; }
        for (var i = 0; i < n; i++) vals.push(dv.getFloat64(CH_DATA + 8 * i, true) * scale);
      } else { // double-delta: int16 second differences, 0x7FFF escapes a 48-bit absolute value
        var v = 0, dd = 0;
        while (p + 2 <= len && (!n || vals.length < n)) {
          var x = dv.getInt16(p, false); p += 2;
          if (x === 32767) { if (p + 6 > len) break; v = dv.getInt32(p, false) * 65536 + dv.getUint16(p + 4, false); dd = 0; p += 6; }
          else { dd += x; v += dd; }
          vals.push(v * scale);
        }
        w.push('Read with double-delta decoding (181 layout).');
      }
    }
    if (!vals.length) return fail('Agilent ChemStation .ch', 'The header was read (version ' + ver + ') but no data points were found after it.');
    var n2 = vals.length, xs = [];
    if (!(t1 > t0)) { w.push('Start/end times missing in the header; x is the point index.'); for (var j = 0; j < n2; j++) xs.push(j); }
    else for (var q = 0; q < n2; q++) xs.push((t0 + (t1 - t0) * (n2 > 1 ? q / (n2 - 1) : 0)) / 60000);
    var yUnit = normYUnit(units) || units || (ver === '179' || ver === '181' ? 'pA' : 'mAU');
    var name = (meta.sampleName || baseName(opts.filename) || 'ChemStation') + (signal ? ' ' + signal.split(',')[0] : '');
    return okRes('Agilent ChemStation .ch', [mkTrace(name, xs, vals, 'min', yUnit, meta)], w);
  }
  P.register({
    id: 'agilent-ch', order: 70, name: 'Agilent ChemStation .ch', extensions: ['ch'], binary: true,
    description: 'Binary signal files: 130/131 (delta-encoded LC) and 179/181 (doubles / double-delta).',
    sniff: function (head) {
      var n = head.charCodeAt(0), a = head.substr(1, n);
      if (n >= 2 && n <= 3 && /^(130|131|30|31|179|181)$/.test(a)) return 0.95;
      if (head.length > 0x150) { var b = ''; for (var i = 0; i < head.charCodeAt(0x146) && i < 4; i++) b += head.charAt(0x147 + 2 * i); if (/^(130|131|179|181)$/.test(b)) return 0.9; }
      return 0;
    },
    parse: function (buf, opts) { return parseCh(buf, opts || {}); }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
