/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "unsupported": Known-but-unsupported binaries: produce a specific, actionable error instead of "unknown file".
   Covers: HDF5 / netCDF-4 (magic \x89HDF), Thermo .raw (01 A1 magic), Agilent .uv spectra, OLE2 compound files such as
     Shimadzu .lcd (D0 CF 11 E0), non-Excel ZIP archives, and .raw/.lcd/.cmbx/.dat2/.d/.ms extensions.
   Sniff: magic numbers above -> 0.6 to 0.92.
   Format knowledge: published file magic numbers (HDF5 spec, MS-CFB, PKWARE APPNOTE).
   Sample: samples/data/unsupported.raw (16-byte Thermo-style magic header + padding, synthetic) */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var extOf = H.extOf, latin1 = H.latin1, fail = H.fail;

  P.register({
    id: 'unsupported', order: 80, name: 'Unsupported binary', extensions: ['raw', 'lcd', 'uv', 'cmbx', 'dat2', 'zip', 'd', 'ms'], binary: true,
    description: 'Explains known vendor binaries (Thermo .raw, Shimadzu .lcd, Agilent .uv, HDF5, ZIP) and how to export them.',
    sniff: function (head, fn) {
      var ext = extOf(fn);
      if (/^\u0089HDF/.test(head)) return 0.9;
      if (head.charCodeAt(0) === 1 && head.charCodeAt(1) === 0xA1) return 0.9;
      if (head.slice(0, 4) === 'ÐÏ\u0011à' && ext !== 'xls') return 0.6;
      if (head.slice(0, 4) === 'PK\u0003\u0004' && !/xl\/|\[Content_Types\]/.test(head) && !/^(xlsx|xlsm|ods)$/.test(ext)) return 0.6;
      if (ext === 'uv' || (head.charCodeAt(0) === 3 && head.substr(1, 3) === '131' && ext === 'uv')) return 0.92;
      return 0;
    },
    parse: function (buf, opts) {
      var u8 = new Uint8Array(buf), head = latin1(u8, 0, 8), ext = extOf(opts && opts.filename), msg;
      if (/^\u0089HDF/.test(head)) msg = 'This is an HDF5 / netCDF-4 file. Peakly reads classic netCDF-3 (AIA/ANDI .cdf). Re-export the run as AIA/ANDI from the instrument software.';
      else if (u8[0] === 1 && u8[1] === 0xA1) msg = 'This is a Thermo .raw file (proprietary). Export the chromatogram as text from Chromeleon/FreeStyle, or convert to mzML with msconvert.';
      else if (ext === 'uv') msg = 'This is an Agilent .uv (full DAD spectra) file. Open the matching single-wavelength DAD1A.ch file instead, or export the signal as CSV.';
      else if (head.slice(0, 4) === 'ÐÏ\u0011à') msg = 'This is a Microsoft compound file' + (ext === 'lcd' ? ' (Shimadzu LabSolutions .lcd)' : '') + '. Export the chromatogram as ASCII text (LabSolutions: File > Export Data > ASCII) or as CSV.';
      else if (head.slice(0, 2) === 'PK') msg = 'This is a ZIP archive. Unzip it and open the chromatogram file inside (.ch, .cdf, .csv, .txt…).';
      else msg = 'This binary file type is not supported. Export the chromatogram as CSV/TXT or AIA/ANDI (.cdf).';
      return fail('Unsupported binary', msg);
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
