/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/unsupported.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  PK.test('parsers/unsupported: unknown/unsupported binaries give specific errors', function (t) {
    var junk = new Uint8Array(512); for (var i = 0; i < junk.length; i++) junk[i] = (i * 37 + 11) % 256;
    return P.parseArrayBuffer(junk.buffer, { filename: 'mystery.bin' }).then(function (r) {
      t.ok(!r.ok && /binary file/.test(r.error), r.error);
      return P.parseArrayBuffer(F.asciiBuf('\u0089HDF\r\n\u001a\n' + new Array(64).join('\u0000')), { filename: 'x.cdf' });
    }).then(function (r) {
      t.ok(!r.ok && /HDF5/.test(r.error), r.error);
      return P.parseArrayBuffer(new ArrayBuffer(0), { filename: 'zero.csv' });
    }).then(function (r) {
      t.ok(!r.ok && /empty/.test(r.error), r.error);
      var bad = new Uint8Array(F.build130()); bad[1] = '9'.charCodeAt(0); // version "930"
      return P.parseArrayBuffer(bad.buffer, { filename: 'odd.ch' });
    }).then(function (r) {
      t.ok(!r.ok && /version|ChemStation/.test(r.error), r.error);
    });
  });

  PK.test('parsers/unsupported: Shimadzu .lcd, ZIP and Agilent .uv get specific advice', function (t) {
    var ole = new Uint8Array(512); [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1].forEach(function (b, i) { ole[i] = b; });
    return P.parseArrayBuffer(ole.buffer, { filename: 'run.lcd' }).then(function (r) {
      t.ok(!r.ok && /LabSolutions/.test(r.error) && r.plugin === 'unsupported', r.error);
      return P.parseArrayBuffer(F.asciiBuf('PK\u0003\u0004' + new Array(80).join('\u0000') + 'data/run1.csv'), { filename: 'export.zip' });
    }).then(function (r) {
      t.ok(!r.ok && /ZIP archive/.test(r.error), r.error);
      var uv = new Uint8Array(F.build130()); return P.parseArrayBuffer(uv.buffer, { filename: 'DAD1.uv' });
    }).then(function (r) { t.ok(!r.ok && /\.uv/.test(r.error), r.error); });
  });

  PK.test('parsers/unsupported: sample file samples/data/unsupported.raw', function (t) {
    return F.withSample(t, 'unsupported.raw', function (r) {
      t.ok(!r.ok, 'not readable'); t.eq(r.plugin, 'unsupported'); t.ok(/Thermo \.raw/.test(r.error) && /mzML/.test(r.error), r.error);
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
