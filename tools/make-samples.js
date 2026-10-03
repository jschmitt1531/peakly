/* SPDX-License-Identifier: MIT */
// Regenerates samples/data/* deterministically: node tools/make-samples.js
// Every file is SYNTHETIC (sums of Gaussian/EMG-like peaks + seeded noise) and dedicated to the public domain (CC0 1.0).
// Layouts follow the public format descriptions cited in each src/parsers/<id>.js header; no vendor or third-party files
// were copied. Keep files small (< ~60 KB): they are fixtures, not benchmarks.
'use strict';
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'samples', 'data');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- deterministic signal model ---------- */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(x, h, mu, s) { return h * Math.exp(-0.5 * ((x - mu) / s) ** 2); }
// tailed peak: Gaussian with a wider right half (simple, deterministic, looks like real HPLC tailing)
function tailed(x, h, mu, s, tail) { return gauss(x, h, mu, x > mu ? s * tail : s); }
function signal(xs, peaks, opt) {
  const r = rng(opt.seed || 1), noise = opt.noise || 0, drift = opt.drift || 0, offset = opt.offset || 0;
  return xs.map(x => {
    let y = offset + drift * x;
    for (const p of peaks) y += tailed(x, p.h, p.mu, p.s, p.tail || 1);
    return y + noise * (r() + r() + r() - 1.5);
  });
}
function axis(a, b, n) { const out = []; for (let i = 0; i < n; i++) out.push(a + (b - a) * i / (n - 1)); return out; }
const f = (v, d) => (+v).toFixed(d);
function write(name, data) { fs.writeFileSync(path.join(OUT, name), data); console.log('wrote', name, (Buffer.byteLength(data) / 1024).toFixed(1) + ' KB'); }

// Common "caffeine & friends" HPLC-UV run: 10 min, peaks at 2.35 / 3.10 / 4.80 min (4.80 is the tallest).
const HPLC_PEAKS = [{ h: 42, mu: 2.35, s: 0.045, tail: 1.3 }, { h: 18, mu: 3.10, s: 0.05, tail: 1.2 }, { h: 120, mu: 4.80, s: 0.06, tail: 1.5 }];

/* ---------- 1. delimited.csv ---------- */
(function () {
  const x = axis(0, 10, 501), y = signal(x, HPLC_PEAKS, { seed: 11, noise: 0.15, drift: 0.2, offset: 0.5 });
  let s = '# Synthetic sample (CC0) - Peakly samples/data\nSample: Xanthine std mix 50 ug/mL\nInstrument: Synthetic HPLC-UV\nDetector: UV 273 nm\n\nTime (min),Absorbance (mAU)\n';
  x.forEach((v, i) => { s += f(v, 3) + ',' + f(y[i], 3) + '\n'; });
  write('delimited.csv', s);
})();

/* ---------- 2. json.json (Peakly traces JSON export with peaks) ---------- */
(function () {
  const x = axis(0, 8, 241), y = signal(x, [{ h: 30, mu: 2.0, s: 0.07 }, { h: 55, mu: 5.5, s: 0.09, tail: 1.2 }], { seed: 12, noise: 0.1 });
  // Same shape as the app's "Traces JSON" export (src/app.js exportXY): schema {name:'peakly-traces'}, traces[] with
  // bare app peaks, and peakRows (PK.schema.peakTableRows) carrying the numbers.
  const doc = { schema: { name: 'peakly-traces', version: 2 }, app: 'Peakly', version: '1.1.0', exported: '2026-01-01T00:00:00.000Z', note: 'synthetic sample, CC0',
    traceRows: [], peakRows: [
      { schema_version: 2, trace_id: 'tr_std_a', trace_name: 'Std A 254 nm', peak_no: 1, peak_id: 'pk_1', name: 'Uracil', rt: 2.0, start: 1.75, end: 2.3, area: 5.24, x_unit: 'min', y_unit: 'mAU' },
      { schema_version: 2, trace_id: 'tr_std_a', trace_name: 'Std A 254 nm', peak_no: 2, peak_id: 'pk_2', name: 'Toluene', rt: 5.5, start: 5.15, end: 6.0, area: 13.1, x_unit: 'min', y_unit: 'mAU' }],
    traces: [{ id: 'tr_std_a', name: 'Std A 254 nm', xUnit: 'min', yUnit: 'mAU', source: { kind: 'file', filename: 'stdA.csv', format: 'Delimited text' }, digitized: false,
      run: { sampleName: 'Std A', detector: 'UV 254 nm' }, x: x.map(v => +f(v, 4)), y: y.map(v => +f(v, 3)),
      peaks: [{ id: 'pk_1', start: 1.75, apex: 2.0, end: 2.3, label: 'Uracil', clip: 'drop' }, { id: 'pk_2', start: 5.15, apex: 5.5, end: 6.0, label: 'Toluene', clip: 'drop' }] }],
    calibration: null };
  write('json.json', JSON.stringify(doc, null, 1));
})();

/* ---------- 3. xlsx.xlsx (stored ZIP, minimal OOXML with inline strings) ---------- */
(function () {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc32 = b => { let c = 0xFFFFFFFF; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const parts = [], central = []; let off = 0;
    for (const [name, text] of files) {
      const data = Buffer.from(text, 'utf8'), nm = Buffer.from(name, 'utf8'), crc = crc32(data);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
      lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
      parts.push(lh, nm, data);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
      ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
      central.push(ch, nm);
      off += 30 + nm.length + data.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat(parts.concat([cd, end]));
  }
  const x = axis(0, 6, 121), y = signal(x, [{ h: 25, mu: 1.8, s: 0.06 }, { h: 60, mu: 3.9, s: 0.08, tail: 1.3 }], { seed: 13, noise: 0.1 });
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cell = (r, c, v) => { const ref = String.fromCharCode(65 + c) + r; return typeof v === 'number' ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>'; };
  let rows = '<row r="1">' + cell(1, 0, 'Time (min)') + cell(1, 1, 'UV 280 (mAU)') + '</row>';
  x.forEach((v, i) => { rows += '<row r="' + (i + 2) + '">' + cell(i + 2, 0, +f(v, 3)) + cell(i + 2, 1, +f(y[i], 3)) + '</row>'; });
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  write('xlsx.xlsx', zip([
    ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Chromatogram" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', X + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + '</sheetData></worksheet>']
  ]));
})();

/* ---------- 4. jcamp.jdx (ASDF DIFDUP compressed, Y-check) ---------- */
(function () {
  const SQZ_P = '@ABCDEFGHI', SQZ_N = '@abcdefghi', DIF_P = '%JKLMNOPQR', DIF_N = '%jklmnopqr', DUP = ' STUVWXYZs';
  const enc = (v, P, N) => { const s = String(Math.abs(v)); return (v < 0 ? N : P).charAt(+s[0]) + s.slice(1); };
  const dup = n => { const s = String(n); return DUP.charAt(+s[0]) + s.slice(1); };
  const n = 401, x = axis(0, 8, n), ys = signal(x, [{ h: 15, mu: 1.6, s: 0.05 }, { h: 40, mu: 3.3, s: 0.07, tail: 1.4 }, { h: 22, mu: 6.1, s: 0.09 }], { seed: 14, noise: 0.02, offset: 0.3 });
  const yf = 0.001, iy = ys.map(v => Math.round(v / yf)), dx = (x[n - 1] - x[0]) / (n - 1);
  let body = '', i = 0;
  while (i < n) {
    // a line: X, SQZ(y_i), DIF tokens (DUP for repeats) for up to 10 following points; next line repeats the last y (Y-check)
    const start = i, end = Math.min(n - 1, i + 10);
    let line = f(x[start] / 1, 3) + ' ' + enc(iy[start], SQZ_P, SQZ_N), k = start + 1;
    while (k <= end) {
      const d = iy[k] - iy[k - 1]; let run = 1;
      while (k + run <= end && iy[k + run] - iy[k + run - 1] === d) run++;
      line += enc(d, DIF_P, DIF_N) + (run > 1 ? dup(run) : '');
      k += run;
    }
    body += line + '\n';
    if (end === n - 1) break;
    i = end; // Y-check: the next line starts with the last value of this one
  }
  const s = '##TITLE=Synthetic RP-HPLC run (CC0)\n##JCAMP-DX=5.01\n##DATA TYPE=CHROMATOGRAM\n##ORIGIN=Peakly samples/data (synthetic)\n##OWNER=public domain (CC0)\n' +
    '##XUNITS=MINUTES\n##YUNITS=MAU\n##XFACTOR=1\n##YFACTOR=' + yf + '\n##FIRSTX=' + x[0] + '\n##LASTX=' + x[n - 1] + '\n##DELTAX=' + dx + '\n##NPOINTS=' + n + '\n##FIRSTY=' + (iy[0] * yf) + '\n' +
    '##XYDATA=(X++(Y..Y))\n' + body + '##END=\n';
  write('jcamp.jdx', s);
})();

/* ---------- 5. netcdf.cdf (AIA/ANDI CDF1) ---------- */
(function () {
  const N = 600, interval = 0.5, delay = 0; // seconds
  const x = axis(0, (N - 1) * interval / 60, N), y = signal(x, HPLC_PEAKS.map(p => Object.assign({}, p, { mu: p.mu * 0.9 })), { seed: 15, noise: 0.1, offset: 0.2 });
  const attrs = { dataset_completeness: 'C1+C2', aia_template_revision: '1.0', netcdf_revision: '2.3.2', languages: 'English', dataset_origin: 'Peakly synthetic sample (CC0)',
    experiment_title: 'Synthetic AIA export', injection_date_time_stamp: '20260101120000+0000', detector_name: 'UV 254nm', detector_unit: 'mAU', retention_unit: 'seconds', sample_name: 'AIA std mix' };
  const vars = [['actual_sampling_interval', [], 4, [interval]], ['actual_delay_time', [], 4, [delay]], ['actual_run_time_length', [], 4, [(N - 1) * interval]], ['ordered_derivative_values', [0], 4 * N, y]];
  function header(begins) {
    const a = [];
    const u32 = v => a.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255);
    const str = s => { u32(s.length); for (const c of Buffer.from(s, 'latin1')) a.push(c); while (a.length % 4) a.push(0); };
    a.push(67, 68, 70, 1); u32(0);
    u32(10); u32(1); str('point_number'); u32(N);
    const keys = Object.keys(attrs); u32(12); u32(keys.length);
    keys.forEach(k => { str(k); u32(2); str(attrs[k]); });
    u32(11); u32(vars.length);
    vars.forEach((v, i) => { str(v[0]); u32(v[1].length); v[1].forEach(u32); u32(0); u32(0); u32(5); u32(v[2]); u32(begins[i]); });
    return a;
  }
  let H = header([0, 0, 0, 0]).length, begins = [], p = H;
  vars.forEach(v => { begins.push(p); p += v[2]; });
  const hd = header(begins), buf = Buffer.alloc(p);
  Buffer.from(hd).copy(buf, 0);
  vars.forEach((v, i) => v[3].forEach((val, k) => buf.writeFloatBE(val, begins[i] + 4 * k)));
  write('netcdf.cdf', buf);
})();

/* ---------- 6. mzml.mzML (uncompressed base64; TIC + BPC) ---------- */
(function () {
  const n = 240, t = axis(0, 600, n); // seconds
  const tic = signal(t.map(v => v / 60), [{ h: 8e5, mu: 3.2, s: 0.06 }, { h: 2.4e6, mu: 6.4, s: 0.08, tail: 1.3 }], { seed: 16, noise: 2e4, offset: 1e5 });
  const bpc = tic.map(v => v * 0.35);
  const b64 = (vals, bits) => { const b = Buffer.alloc(vals.length * bits / 8); vals.forEach((v, i) => bits === 64 ? b.writeDoubleLE(v, i * 8) : b.writeFloatLE(v, i * 4)); return b.toString('base64'); };
  function arr(vals, bits, acc, nm, unit) {
    return '      <binaryDataArray encodedLength="' + b64(vals, bits).length + '">\n        <cvParam cvRef="MS" accession="' + (bits === 64 ? 'MS:1000523' : 'MS:1000521') + '" name="' + bits + '-bit float"/>\n' +
      '        <cvParam cvRef="MS" accession="MS:1000576" name="no compression"/>\n        <cvParam cvRef="MS" accession="' + acc + '" name="' + nm + '"' + unit + '/>\n' +
      '        <binary>' + b64(vals, bits) + '</binary>\n      </binaryDataArray>\n';
  }
  function chrom(i, id, acc, nm, ys) {
    return '  <chromatogram index="' + i + '" id="' + id + '" defaultArrayLength="' + n + '">\n    <cvParam cvRef="MS" accession="' + acc + '" name="' + nm + '"/>\n    <binaryDataArrayList count="2">\n' +
      arr(t, 64, 'MS:1000595', 'time array', ' unitCvRef="UO" unitAccession="UO:0000010" unitName="second"') +
      arr(ys, 32, 'MS:1000515', 'intensity array', ' unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"') + '    </binaryDataArrayList>\n  </chromatogram>\n';
  }
  const s = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Synthetic sample (CC0) - Peakly samples/data -->\n<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0" id="peakly_synthetic">\n' +
    '<cvList count="2"><cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/><cv id="UO" fullName="Unit Ontology" URI="http://ontologies.berkeleybop.org/uo.obo"/></cvList>\n' +
    '<run id="synthetic_run">\n<chromatogramList count="2" defaultDataProcessingRef="none">\n' +
    chrom(0, 'TIC', 'MS:1000235', 'total ion current chromatogram', tic) + chrom(1, 'BPC', 'MS:1000628', 'basepeak chromatogram', bpc) +
    '</chromatogramList>\n</run>\n</mzML>\n';
  write('mzml.mzML', s);
})();

/* ---------- 7. agilent-ch.ch (ChemStation type 130, delta encoded) ---------- */
(function () {
  const n = 1200, x = axis(0, 10, n), y = signal(x, HPLC_PEAKS, { seed: 17, noise: 0.08, offset: 1.0 }), scale = 0.001;
  const iv = y.map(v => Math.round(v / scale));
  const seg = []; let prev = 0, i = 0;
  const pushI16 = v => seg.push((v >> 8) & 255, v & 255);
  while (i < n) {
    const cnt = Math.min(255, n - i); seg.push(16, cnt);
    for (let k = 0; k < cnt; k++, i++) {
      const d = iv[i] - prev;
      if (i === 0 || d <= -32768 || d > 32767) { pushI16(-32768 & 0xFFFF); const b = Buffer.alloc(4); b.writeInt32BE(iv[i]); seg.push(...b); }
      else pushI16(d & 0xFFFF);
      prev = iv[i];
    }
  }
  seg.push(0, 0);
  const u = Buffer.alloc(0x1800 + seg.length);
  const wstr = (off, s) => { u[off] = s.length; for (let k = 0; k < s.length; k++) { u[off + 1 + 2 * k] = s.charCodeAt(k) & 255; u[off + 2 + 2 * k] = s.charCodeAt(k) >> 8; } };
  u[0] = 3; u.write('130', 1, 'latin1');
  wstr(0x146, '130'); wstr(0x15B, 'LC DATA FILE'); wstr(0x35A, 'Xanthine std (synthetic)'); wstr(0x957, '01-Jan-26, 12:00:00');
  wstr(0xA0E, 'SYNTH.M'); wstr(0xC11, 'Synthetic LC'); wstr(0x104C, 'mAU'); wstr(0x1075, 'DAD1 A, Sig=273,4 Ref=off');
  u.writeUInt32BE(0, 0x11A); u.writeUInt32BE(600000, 0x11E); u.writeDoubleBE(scale, 0x127C);
  Buffer.from(seg).copy(u, 0x1800);
  write('agilent-ch.ch', u);
})();

/* ---------- 8. agilent-text.csv (UTF-16LE + BOM, no header) ---------- */
(function () {
  const x = axis(0, 10, 301), y = signal(x, HPLC_PEAKS, { seed: 18, noise: 0.1, offset: 0.4 });
  let s = ''; x.forEach((v, i) => { s += f(v, 6) + ',' + f(y[i], 4) + '\r\n'; });
  const b = Buffer.alloc(2 + 2 * s.length); b[0] = 0xFF; b[1] = 0xFE;
  for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), 2 + 2 * i);
  write('agilent-text.csv', b);
})();

/* ---------- 9. chromeleon.txt ---------- */
(function () {
  const n = 361, x = axis(0, 12, n), y = signal(x, [{ h: 12, mu: 3.4, s: 0.06 }, { h: 85, mu: 7.25, s: 0.08, tail: 1.4 }, { h: 30, mu: 9.0, s: 0.1 }], { seed: 19, noise: 0.05 });
  let s = 'Raw Data:\nInformation:\nSample Name\tBSA digest (synthetic)\nInjection Volume\t10.0\nInjection Date\t01.01.2026\nProgram\tSynthetic gradient\n\n' +
    'Chromatogram Data Information:\nTime Min.\t0.000\nTime Max.\t12.000\nData Points\t' + n + '\nDetector\tUV\nSignal Unit\tmAU\nChannel\tUV_VIS_1\nWavelength\t214.0\n\n' +
    'Chromatogram Data:\nTime (min)\tStep (s)\tValue (mAU)\n';
  x.forEach((v, i) => { s += f(v, 6) + '\t' + (i ? f(12 * 60 / (n - 1), 2) : 'n.a.') + '\t' + f(y[i], 4) + '\n'; });
  write('chromeleon.txt', s);
})();

/* ---------- 10. shimadzu.txt ---------- */
(function () {
  const n = 481, step = 1000, x = axis(0, (n - 1) * step / 60000, n), y = signal(x, [{ h: 70, mu: 2.2, s: 0.05 }, { h: 35, mu: 5.1, s: 0.07, tail: 1.3 }], { seed: 20, noise: 0.1, offset: 0.5 });
  let s = '[Header]\nApplication Name\tLabSolutions\nVersion\t5.97\nData File Name\tC:\\LabSolutions\\Data\\synthetic.lcd\nOutput Date\t1/1/2026\n\n' +
    '[File Information]\nType\tData File\nGenerated\t1/1/2026 12:00:00 PM\n\n[Sample Information]\nOperator\tsynthetic\nSample Name\tTryptic digest (synthetic)\nSample ID\tSYN-001\n\n' +
    '[LC Chromatogram(Detector A-Ch1)]\nInterval(msec)\t' + step + '\n# of Points\t' + n + '\nStart Time(min)\t0.000\nEnd Time(min)\t' + f(x[n - 1], 3) + '\nIntensity Units\tmV\nIntensity Multiplier\t0.001\nWavelength(nm)\t214\n' +
    'R.Time (min)\tIntensity\n';
  x.forEach((v, i) => { s += f(v, 5) + '\t' + Math.round(y[i] * 1000) + '\n'; });
  s += '\n[Peak Table(Detector A-Ch1)]\n# of Peaks\t2\nPeak#\tR.Time\tI.Time\tF.Time\tArea\tHeight\n1\t2.200\t2.050\t2.400\t525432\t70012\n2\t5.103\t4.900\t5.500\t401225\t35009\n';
  write('shimadzu.txt', s);
})();

/* ---------- 11. waters-arw.arw ---------- */
(function () {
  const x = axis(0, 15, 451), y = signal(x, [{ h: 0.12, mu: 4.4, s: 0.06 }, { h: 0.35, mu: 8.8, s: 0.08, tail: 1.3 }, { h: 0.08, mu: 11.2, s: 0.1 }], { seed: 21, noise: 0.0005 });
  let s = '"SampleName"\t"Channel"\t"Date Acquired"\t"Instrument Method Name"\t"Sample Set Name"\n"Std B (synthetic)"\t"2998 Ch1 254nm@1.2nm"\t"1/1/2026 12:00:00 PM"\t"Synthetic_IM"\t"SYN_SET"\n';
  x.forEach((v, i) => { s += f(v, 6) + '\t' + f(y[i], 6) + '\n'; });
  write('waters-arw.arw', s);
})();

/* ---------- 12. unicorn.asc (IMAC run: UV, Cond, Conc B, Fractions; x = mL) ---------- */
(function () {
  const n = 301, v = axis(0, 30, n), uv = signal(v, [{ h: 900, mu: 3.0, s: 0.8, tail: 1.5 }, { h: 420, mu: 21.5, s: 0.6, tail: 1.3 }], { seed: 22, noise: 0.6, offset: 2 });
  const cond = v.map(x => x < 15 ? 12 : 12 + Math.min(40, (x - 15) * 4)), concB = v.map(x => x < 15 ? 0 : Math.min(100, (x - 15) * 10));
  let s = 'Chrom.1\t\tChrom.1\t\tChrom.1\t\tChrom.1\t\nUV 1_280\t\tCond\t\tConc B\t\tFractions\t\nml\tmAU\tml\tmS/cm\tml\t%\tml\t\n';
  const fr = []; for (let k = 0; k < 12; k++) fr.push([15 + 1.5 * k, 'A' + (k + 1)]); fr.push([33, 'Waste']);
  for (let i = 0; i < n; i++) {
    const row = [f(v[i], 2), f(uv[i], 3), f(v[i], 2), f(cond[i], 3), f(v[i], 2), f(concB[i], 1)];
    if (i < fr.length) row.push(f(fr[i][0], 2), fr[i][1]); else row.push('', '');
    s += row.join('\t') + '\n';
  }
  write('unicorn.asc', s);
})();

/* ---------- 13. biorad.csv ---------- */
(function () {
  const n = 241, v = axis(0, 24, n), uv = signal(v, [{ h: 300, mu: 2.5, s: 0.6, tail: 1.4 }, { h: 160, mu: 16.2, s: 0.5 }], { seed: 23, noise: 0.4, offset: 1 });
  const gp = v.map(x => x < 10 ? 0 : Math.min(100, (x - 10) * 10)), cond = gp.map(b => 8 + b * 0.9);
  let s = 'Bio-Rad ChromLab Run Report - synthetic sample (CC0)\nRun Name:,His-tag IMAC run 7 (synthetic)\nColumn:,Synthetic 1 mL\nSystem:,NGC Quest 10 (simulated)\n\nVolume (ml),UV (mAU),Conductivity (mS/cm),GP (%B)\n';
  for (let i = 0; i < n; i++) s += [f(v[i], 2), f(uv[i], 3), f(cond[i], 3), f(gp[i], 1)].join(',') + '\n';
  write('biorad.csv', s);
})();

/* ---------- 14. unsupported.raw (Thermo-style magic only) ---------- */
(function () {
  const b = Buffer.alloc(256); b[0] = 0x01; b[1] = 0xA1;
  Buffer.from('Synthetic placeholder (CC0): not a real instrument file', 'utf16le').copy(b, 2);
  write('unsupported.raw', b);
})();

/* ---------- 15. chromatopy_FID_output.json ---------- */
(function () {
  const labels = { C16: 6.2, C18: 7.4, C20: 8.5, C22: 9.6 };
  const samples = {};
  [['GC-FID sample 1', 31, [1, 1, 1, 0]], ['GC-FID sample 2', 32, [0.8, 1.2, 0.9, 0.5]]].forEach(([name, seed, amp]) => {
    const x = axis(5, 11, 361), shift = (seed - 31) * 0.01;
    const pk = Object.keys(labels).map((k, i) => ({ h: 40 * amp[i], mu: labels[k] + shift, s: 0.02 })).filter(p => p.h > 0);
    const y = signal(x, pk, { seed, noise: 0.05, offset: 6.6 });
    const pd = {}, r = rng(seed + 100);
    Object.keys(labels).forEach((lab, i) => {
      if (!amp[i]) { pd[lab] = [NaN]; return; } // chromatoPy stores [NaN] when a labelled peak is not found
      const cen = labels[lab] + shift, wid = 0.02, a = 40 * amp[i], area = a * wid * Math.sqrt(2 * Math.PI);
      const ens = []; for (let k = 0; k < 8; k++) ens.push(area * (1 + 0.03 * (r() - 0.5)));
      const mean = ens.reduce((p, q) => p + q, 0) / ens.length, sd = Math.sqrt(ens.reduce((p, q) => p + (q - mean) ** 2, 0) / (ens.length - 1));
      const fx = axis(cen - 0.06, cen + 0.06, 13);
      pd[lab] = { 'Peak Area - best fit': +f(area, 5), 'Peak Area - median': +f(ens.slice().sort()[4], 5), 'Peak Area - mean': +f(mean, 5),
        'Peak Area - standard deviation': +f(sd, 5), 'Peak Area - number of ensemble members': ens.length,
        'Model Parameters': { name: 'single', x: fx.map(v => +f(v, 4)), y: fx.map(v => +f(gauss(v, a, cen, wid), 4)), params: [+f(a, 4), +f(cen, 4), wid], pcov: [[0.01, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]], error: 0.012, idx_interest: null, multi_flag: false },
        'Retention Time': +f(cen, 4) };
    });
    samples[name] = { Metadata: { 'Sample Name': name, 'Injection Volume': '1.0', 'Signal Unit': 'pA', note: 'synthetic, CC0' },
      'Raw Data': { 'Time (min)': x.map(v => +f(v, 5)), 'Value (pA)': y.map(v => +f(v, 4)) }, 'Processed Data': pd };
  });
  const doc = { Samples: samples, 'Integration Metadata': { 'peak dictionary': labels, 'x limits': [5, 11], time_column: 'Time (min)', signal_column: 'Value (pA)' } };
  // Python's json.dump writes NaN literally; keep that so readers are tested against it.
  write('chromatopy_FID_output.json', JSON.stringify(doc, (k, v) => (typeof v === 'number' && isNaN(v) ? '__NaN__' : v), 2).replace(/"__NaN__"/g, 'NaN'));
})();

/* ---------- 16. chromatopy_hplc.csv (RT (min) + ion columns, as written by hplc_to_csv) ---------- */
(function () {
  const ions = [744, 1018, 1020, 1022, 1302], n = 241, x = axis(10, 50, n);
  const traces = ions.map((m, k) => signal(x, [{ h: 2000 + 500 * k, mu: 18 + 5 * k, s: 0.25 }, { h: 900, mu: 40 - 2 * k, s: 0.3 }], { seed: 40 + k, noise: 30, offset: 200 }));
  let s = 'RT (min),' + ions.join(',') + '\n';
  for (let i = 0; i < n; i++) s += f(x[i], 4) + ',' + traces.map(t => Math.round(t[i])).join(',') + '\n';
  write('chromatopy_hplc.csv', s);
})();

/* ---------- 17. mocca2.json (MoccaDataset with one deconvolved Chromatogram) ---------- */
(function () {
  const n = 200, t = axis(0, 4, n).map(v => +f(v, 4)), wl = []; for (let w = 230; w <= 270; w += 4) wl.push(w);
  // two compounds: A at 1.5 min (lambda max 250), B at 1.62 min (lambda max 262, co-eluting); C at 3.0 min (plain peak)
  const spec = (lmax, w) => Math.exp(-0.5 * ((w - lmax) / 12) ** 2);
  const prof = (mu, s, h) => t.map(x => gauss(x, h, mu, s));
  const cA = prof(1.5, 0.03, 0.8), cB = prof(1.62, 0.03, 0.5), cC = prof(3.0, 0.04, 0.6);
  const r = rng(50);
  const data = wl.map(w => t.map((_, i) => +f(cA[i] * spec(250, w) + cB[i] * spec(262, w) + cC[i] * spec(240, w) + 0.002 * (r() - 0.5), 5)));
  const idx = v => t.findIndex(x => x >= v);
  const L = idx(1.35), R = idx(1.8), mean1 = a => a.reduce((p, q) => p + q, 0) / a.length;
  function comp(c, lmax, cid, frac) {
    const conc = c.slice(L, R + 1).map(v => +f(v, 5)), sp = wl.map(w => spec(lmax, w)), m = mean1(sp);
    let mx = 0; conc.forEach((v, k) => { if (v > conc[mx]) mx = k; });
    return { concentration: conc, spectrum: sp.map(v => +f(v / m, 5)), elution_time: L + mx, integral: +f(conc.reduce((p, q) => p + q, 0), 5), compound_id: cid, peak_fraction: frac, __classname__: 'Component' };
  }
  const peaks = [
    { left: L, right: R, maximum: idx(1.5), height: 0.8, prominence: 0.8, all_maxima: [idx(1.5), idx(1.62)], components: [comp(cA, 250, 0, 0.6), comp(cB, 262, 1, 0.4)], residual_mse: 1.2e-6, r2: 0.9993, resolved: true, __classname__: 'DeconvolvedPeak' },
    { left: idx(2.8), right: idx(3.2), maximum: idx(3.0), height: 0.6, prominence: 0.6, all_maxima: [idx(3.0)], __classname__: 'Peak' }
  ];
  const chrom = { time: t, wavelength: wl, data, peaks, sample_path: 'synthetic/run_001.D', blank_path: null, name: 'run_001 (synthetic)', __classname__: 'Chromatogram' };
  const compounds = { 0: { elution_time: idx(1.5), spectrum: wl.map(w => +f(spec(250, w), 4)), name: 'Benzaldehyde', concentration_factor: null, concentration_factor_vs_istd: null, _absorption_maxima: null, __classname__: 'Compound' },
    1: { elution_time: idx(1.62), spectrum: wl.map(w => +f(spec(262, w), 4)), name: 'Benzoic acid', concentration_factor: null, concentration_factor_vs_istd: null, _absorption_maxima: null, __classname__: 'Compound' } };
  const ds = { chromatograms: { 0: chrom }, _raw_2d_data: {}, compounds, compound_references: {}, istd_concentrations: {}, istd_chromatogram: null, istd_compound: null, settings: null, __classname__: 'MoccaDataset' };
  write('mocca2.json', JSON.stringify(ds));
})();
