/* Tests for src/parsers.js — all fixtures are built inline (text strings / ArrayBuffers built in code). */
(function (PK) {
  'use strict';
  var P = PK.parsers;

  /* ---------- fixture helpers ---------- */
  function bytesToBuf(arr) { var u = new Uint8Array(arr.length); for (var i = 0; i < arr.length; i++) u[i] = arr[i] & 0xFF; return u.buffer; }
  function utf16leWithBom(s) { var a = [0xFF, 0xFE]; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a.push(c & 0xFF, c >> 8); } return bytesToBuf(a); }
  function asciiBuf(s) { var a = []; for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); return bytesToBuf(a); }
  function b64encode(u8) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', s = '';
    for (var i = 0; i < u8.length; i += 3) {
      var n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0);
      s += A.charAt(n >> 18 & 63) + A.charAt(n >> 12 & 63) + (i + 1 < u8.length ? A.charAt(n >> 6 & 63) : '=') + (i + 2 < u8.length ? A.charAt(n & 63) : '=');
    }
    return s;
  }
  function floatsLE(vals, bits) {
    var sz = bits / 8, dv = new DataView(new ArrayBuffer(vals.length * sz));
    vals.forEach(function (v, i) { if (bits === 64) dv.setFloat64(i * 8, v, true); else dv.setFloat32(i * 4, v, true); });
    return new Uint8Array(dv.buffer);
  }
  // zlib provider: real pako if loaded, else Node's zlib (tests only), else null → skip.
  function zlibShim() {
    var pako = (typeof globalThis !== 'undefined' && globalThis.pako) || null;
    if (pako && pako.deflate) return { deflate: function (u) { return pako.deflate(u); }, install: function () { return function () {}; } };
    var zlib = null;
    try {
      var proc = typeof process !== 'undefined' ? process : null;
      if (proc && typeof proc.getBuiltinModule === 'function') zlib = proc.getBuiltinModule('zlib');
      else if (proc && proc.mainModule) zlib = proc.mainModule.require('zlib');
    } catch (e) { zlib = null; }
    if (!zlib) return null;
    return {
      deflate: function (u) { return new Uint8Array(zlib.deflateSync(u)); },
      install: function () { // temporarily provide a pako-compatible global
        globalThis.pako = { inflate: function (u) { return new Uint8Array(zlib.inflateSync(u)); } };
        return function () { delete globalThis.pako; };
      }
    };
  }

  // netCDF-3 classic (CDF1) writer for AIA fixtures.
  function buildNetCDF(opts) {
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
  }

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
  function build130() {
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
  }
  function build179() {
    var body = floatsLE([1.5, 2.5, 10, 3], 64), h = chHeader('179', body);
    h.wstr(0x104C, 'pA'); h.wstr(0x1075, 'Front Signal');
    h.dv.setUint32(0x116, 4); h.dv.setFloat32(0x11A, 120000); h.dv.setFloat32(0x11E, 123000); h.dv.setFloat64(0x127C, 2);
    return h.u.buffer;
  }
  function build181() {
    var d = new DataView(new ArrayBuffer(14));
    d.setInt16(0, 32767); d.setInt32(2, 0); d.setUint16(6, 1000); d.setInt16(8, 3); d.setInt16(10, 2); d.setInt16(12, -3);
    var h = chHeader('181', new Uint8Array(d.buffer));
    h.wstr(0x104C, 'pA');
    h.dv.setUint32(0x116, 4); h.dv.setFloat32(0x11A, 0); h.dv.setFloat32(0x11E, 3000); h.dv.setFloat64(0x127C, 1);
    return h.u.buffer;
  }

  function mzmlDoc(chroms) {
    return '<?xml version="1.0" encoding="utf-8"?>\n<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">\n<run id="r1">\n' +
      '<chromatogramList count="' + chroms.length + '">\n' + chroms.join('\n') + '\n</chromatogramList>\n</run>\n</mzML>\n';
  }
  function mzChrom(id, kindAcc, kindName, t, tBits, tUnit, y, yBits, zlib) {
    function arr(bytes, bits, typeAcc, typeName, unit) {
      var enc = zlib ? zlib.deflate(bytes) : bytes;
      return '<binaryDataArray encodedLength="0">' +
        '<cvParam cvRef="MS" accession="' + (bits === 64 ? 'MS:1000523' : 'MS:1000521') + '" name="' + bits + '-bit float"/>' +
        '<cvParam cvRef="MS" accession="' + (zlib ? 'MS:1000574' : 'MS:1000576') + '" name="' + (zlib ? 'zlib compression' : 'no compression') + '"/>' +
        '<cvParam cvRef="MS" accession="' + typeAcc + '" name="' + typeName + '"' + unit + '/>' +
        '<binary>' + b64encode(enc) + '</binary></binaryDataArray>';
    }
    var tu = tUnit === 'min' ? ' unitCvRef="UO" unitAccession="UO:0000031" unitName="minute"' : ' unitCvRef="UO" unitAccession="UO:0000010" unitName="second"';
    return '<chromatogram index="0" id="' + id + '" defaultArrayLength="' + t.length + '">' +
      '<cvParam cvRef="MS" accession="' + kindAcc + '" name="' + kindName + '"/>' +
      '<binaryDataArrayList count="2">' + arr(floatsLE(t, tBits), tBits, 'MS:1000595', 'time array', tu) +
      arr(floatsLE(y, yBits), yBits, 'MS:1000515', 'intensity array', ' unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"') +
      '</binaryDataArrayList></chromatogram>';
  }

  /* ---------- registry / dispatch ---------- */
  PK.test('parsers: registry lists all required plugins', function (t) {
    var ids = P.list().map(function (p) { return p.id; });
    ['delimited', 'json', 'xlsx', 'jcamp', 'netcdf', 'mzml', 'agilent-ch', 'agilent-text', 'chromeleon', 'shimadzu', 'waters-arw', 'unicorn', 'biorad'].forEach(function (id) { t.ok(ids.indexOf(id) >= 0, 'plugin ' + id + ' registered'); });
    t.ok(P.list()[0].extensions.length > 0, 'extensions listed');
  });

  PK.test('parsers: sniff dispatch picks the right plugin', function (t) {
    function top(head, fn, bin) { return P.rank(head, fn, bin)[0].id; }
    t.eq(top('##TITLE=x\n##JCAMP-DX=4.24\n', 'a.jdx', false), 'jcamp');
    t.eq(top('<?xml version="1.0"?>\n<mzML xmlns="x">', 'a.mzML', false), 'mzml');
    t.eq(top('{"x":[1,2],"y":[3,4]}', 'a.json', false), 'json');
    t.eq(top('Information:\nChromatogram Data:\nTime (min)\tStep (s)\tValue (mAU)\n', 'x.txt', false), 'chromeleon');
    t.eq(top('[Header]\nApplication Name\tLabSolutions\n[LC Chromatogram(Detector A-Ch1)]\n', 'x.txt', false), 'shimadzu');
    t.eq(top('"SampleName"\t"Channel"\n"A"\t"PDA 254nm"\n0\t1\n', 'x.arw', false), 'waters-arw');
    t.eq(top('UV\t\tCond\t\nml\tmAU\tml\tmS/cm\n0\t1\t0\t2\n', 'x.asc', false), 'unicorn');
    t.eq(top('ChromLab export\nVolume (ml),UV (mAU)\n', 'x.csv', false), 'biorad');
    t.eq(top('Time,Signal\n0,1\n1,2\n2,3\n', 'x.csv', false), 'delimited');
    t.eq(top('CDF\u0001\u0000\u0000\u0000\u0000', 'x.cdf', true), 'netcdf');
    t.eq(top('\u0003130\u0000', 'DAD1A.ch', true), 'agilent-ch');
  });

  PK.test('parsers: isImage routes images and PDFs', function (t) {
    t.ok(P.isImage('chrom.PNG'), 'png'); t.ok(P.isImage({ name: 'scan.pdf' }), 'pdf'); t.ok(P.isImage({ name: 'x', type: 'image/jpeg' }), 'mime');
    t.ok(!P.isImage('run.csv'), 'csv is not an image'); t.ok(!P.isImage(null), 'null');
  });

  /* ---------- generic delimited ---------- */
  PK.test('parsers: CSV with header units (min, mAU)', function (t) {
    var r = P.parseText('Time (min),Absorbance (mAU)\n0,0.1\n0.1,0.5\n0.2,2.0\n0.3,0.4\n', { filename: 'run1.csv' });
    t.ok(r.ok, r.error); t.eq(r.traces.length, 1); var tr = r.traces[0];
    t.eq(tr.yUnit, 'mAU'); t.eq(tr.xUnit, 'min'); t.eq(tr.name, 'run1'); t.near(tr.x[3], 0.3, 1e-12); t.near(tr.y[2], 2.0, 1e-12);
    t.eq(tr.source.kind, 'file'); t.eq(tr.source.filename, 'run1.csv'); t.eq(r.warnings.length, 0, 'no warnings');
  });

  PK.test('parsers: semicolon + decimal comma + preamble + seconds', function (t) {
    var txt = 'Sample: Lysozyme\nDetector: UV 280 nm\n\nTime [s];Signal [mAU]\n0,0;1,25\n0,5;2,50\n1,0;3,75\n1,5;5,00\n';
    var tb = P.parseDelimited(txt);
    t.eq(tb.delimiter, ';'); t.ok(tb.decimalComma, 'decimal comma detected'); t.eq(tb.preamble.length, 2, 'preamble kept');
    t.eq(tb.header[0], 'Time [s]'); t.eq(tb.rows.length, 4); t.near(tb.rows[3][1], 5, 1e-12);
    var r = P.parseText(txt, { filename: 'lyz.csv' });
    t.ok(r.ok, r.error); var tr = r.traces[0];
    t.near(tr.x[1], 0.5 / 60, 1e-12, 'seconds → minutes'); t.near(tr.y[0], 1.25, 1e-12); t.eq(tr.yUnit, 'mAU');
    t.eq(tr.meta.sampleName, 'Lysozyme'); t.eq(tr.meta.header.Detector, 'UV 280 nm'); t.eq(tr.name, 'Lysozyme');
  });

  PK.test('parsers: pasted Excel block (tab, no header)', function (t) {
    var r = P.parseText('0\t1.2\n0.01\t1.3\n0.02\t1.9\n0.03\t1.4\n');
    t.ok(r.ok, r.error); t.eq(r.traces[0].source.kind, 'paste'); t.eq(r.traces[0].x.length, 4);
    t.ok(r.warnings.some(function (w) { return /assumed/.test(w); }), 'assumption warned');
    var c = P.parseText('# Sample: X\n# Detector: RI\n0.0 1\n0.1 2\n0.2 3\n', { filename: 'c.txt' });
    t.ok(c.ok && c.table.header === null, 'comment lines are not taken as header'); t.eq(c.traces[0].meta.header.Detector, 'RI');
  });

  PK.test('parsers: whitespace columns with spaced header, thousands separators', function (t) {
    var r = P.parseText('Time (min)   Signal (mV)\n0.0   1.0\n0.5   2.0\n1.0   1.5\n', { filename: 'a.txt' });
    t.ok(r.ok, r.error); t.eq(r.traces[0].yUnit, 'mV'); t.near(r.traces[0].x[2], 1, 1e-12);
    var tb = P.parseDelimited('t\tA\n0\t1,234.5\n1\t2,000.25\n2\t3.5\n');
    t.near(tb.rows[0][1], 1234.5, 1e-9, 'thousands comma'); t.near(tb.rows[1][1], 2000.25, 1e-9);
  });

  PK.test('parsers: multi-column FPLC table → roles and units', function (t) {
    var r = P.parseText('Time (min),UV 280 (mAU),Cond (mS/cm),%B\n0,1,10,0\n1,5,12,10\n2,3,14,20\n3,2,16,30\n', { filename: 'fplc.csv' });
    t.ok(r.ok, r.error); t.eq(r.traces.length, 3);
    var cond = r.traces.filter(function (x) { return x.meta.role === 'conductivity'; })[0], grad = r.traces.filter(function (x) { return x.meta.role === 'gradient'; })[0];
    t.ok(cond && cond.yUnit === 'mS/cm', 'conductivity trace'); t.ok(grad && grad.yUnit === '%', 'gradient trace');
    t.eq(r.traces[0].meta.wavelength, 280); t.ok(!r.traces[0].meta.role, 'UV has no role');
  });

  PK.test('parsers: garbage → clear error; scrambled numbers → needsMapping', function (t) {
    var r = P.parseText('hello world\nthis is not data\nat all\n', { filename: 'notes.txt' });
    t.ok(!r.ok, 'not ok'); t.ok(!r.needsMapping, 'no mapping offered'); t.ok(/Couldn't find a table of numbers/.test(r.error), r.error);
    var m = P.parseText('5,1\n3,7\n9,2\n1,8\n7,3\n', { filename: 'x.csv' });
    t.ok(!m.ok && m.needsMapping, 'needsMapping'); t.ok(m.table && m.table.rows.length === 5, 'table attached'); t.ok(m.rawText.length > 0, 'rawText');
    t.ok(/time axis/.test(m.error), m.error);
    var e = P.parseText('   ', { filename: 'e.csv' }); t.ok(!e.ok && /empty/.test(e.error), 'empty file');
  });

  PK.test('parsers: buildTraces converts units, sorts, drops NaN, dt mode', function (t) {
    var tb = { header: ['t', 'a', 'b'], rows: [[120, 1, 5], [60, 2, NaN], [0, 3, 7], [NaN, 9, 9]] };
    var tr = P.buildTraces(tb, { xCol: 0, yCols: [1, 2], xUnit: 'sec', yUnit: 'mAU', yScale: 2 });
    t.eq(tr.length, 2); t.eq(tr[0].x.join(','), '0,1,2'); t.eq(tr[0].y.join(','), '6,4,2'); t.eq(tr[1].x.length, 2, 'NaN dropped');
    t.eq(tr[0].yUnit, 'mAU'); t.eq(tr[0].xUnit, 'min');
    var ms = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'ms' }); t.near(ms[0].x[2], 120 / 60000, 1e-15);
    var h = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'h' }); t.eq(h[0].x[1], 3600);
    var dt = P.buildTraces({ rows: [[1], [2], [3]] }, { xCol: -1, yCols: [0], xUnit: 'sec', dt: 30 }); t.eq(dt[0].x.join(','), '0,0.5,1');
    var vol = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'mL' }); t.eq(vol[0].xUnit, 'mL'); t.ok(vol[0].meta.xIsVolume, 'volume flagged');
    var fl = P.buildTraces(tb, { xCol: 0, yCols: [1], xUnit: 'mL', flow: 2 }); t.eq(fl[0].xUnit, 'min'); t.eq(fl[0].x[2], 60);
  });

  /* ---------- JSON ---------- */
  PK.test('parsers: JSON shapes and Peakly project detection', function (t) {
    var a = P.parseText('[{"x":0,"y":1},{"x":1,"y":3}]', { filename: 'a.json' }); t.ok(a.ok && a.traces[0].y[1] === 3, 'array of {x,y}');
    var b = P.parseText('[[0,1],[0.5,2],[1,4]]', { filename: 'b.json' }); t.ok(b.ok && b.traces[0].x.length === 3, '[[x,y]]');
    var c = P.parseText('{"name":"S1","x":[0,30,60],"y":[1,2,3],"xUnit":"s","yUnit":"mAU"}', { filename: 'c.json' });
    t.ok(c.ok, c.error); t.eq(c.traces[0].name, 'S1'); t.near(c.traces[0].x[2], 1, 1e-12); t.eq(c.traces[0].yUnit, 'mAU');
    var d = P.parseText('{"traces":[{"name":"A","x":[0,1],"y":[1,2]},{"name":"B","x":[0,1],"y":[3,4]}]}', { filename: 'd.json' });
    t.ok(d.ok && d.traces.length === 2 && d.traces[1].name === 'B', 'traces list');
    var proj = { version: 1, name: 'P', traces: [{ id: 'tr_1', name: 'T', x: [0, 1], y: [1, 2], xUnit: 'min', yUnit: 'mAU' }], method: {}, settings: {} };
    var e = P.parseText(JSON.stringify(proj), { filename: 'p.json' });
    t.ok(e.ok && e.project && e.project.name === 'P', 'project detected'); t.eq(e.format, 'Peakly project');
    var bad = P.parseText('{"x":[1,2,', { filename: 'bad.json' }); t.ok(!bad.ok && /could not be read/.test(bad.error), bad.error);
  });

  /* ---------- JCAMP-DX ---------- */
  PK.test('parsers: JCAMP ASDF decoder (SQZ/DIF/DUP)', function (t) {
    var d = P._internal.decodeAsdf('0 A00KL%Tk');
    t.eq(d.vals.join(','), '0,100,102,105,105,105,103'); t.ok(d.endsDif, 'ends in DIF');
    t.eq(P._internal.decodeAsdf('5 @T a2').vals.join(','), '5,0,0,-12');
    t.eq(P._internal.decodeAsdf('1.5E+02 -3').vals.join(','), '150,-3');
  });

  PK.test('parsers: JCAMP compressed XYDATA with Y-check across lines', function (t) {
    var txt = '##TITLE=Test chrom\n##JCAMP-DX=4.24\n##DATA TYPE=CHROMATOGRAM\n##XUNITS=MINUTES\n##YUNITS=MAU\n' +
      '##FIRSTX=0\n##LASTX=0.4\n##NPOINTS=5\n##XFACTOR=1\n##YFACTOR=0.1\n##XYDATA=(X++(Y..Y))\n0 A00KL\n0.3 A05%k\n##END=\n';
    var r = P.parseText(txt, { filename: 't.jdx' });
    t.ok(r.ok, r.error); t.eq(r.format, 'JCAMP-DX'); var tr = r.traces[0];
    t.eq(tr.y.length, 5); [10, 10.2, 10.5, 10.5, 10.3].forEach(function (v, i) { t.near(tr.y[i], v, 1e-9, 'y' + i); });
    t.near(tr.x[4], 0.4, 1e-12); t.eq(tr.yUnit, 'mAU'); t.eq(tr.name, 'Test chrom'); t.eq(r.warnings.length, 0, 'no y-check warnings');
  });

  PK.test('parsers: JCAMP AFFN seconds and XYPOINTS', function (t) {
    var r = P.parseText('##TITLE=affn\n##XUNITS=SECONDS\n##YUNITS=COUNTS\n##FIRSTX=0\n##LASTX=50\n##NPOINTS=6\n##XYDATA=(X++(Y..Y))\n0 1.5 2.5 3.5\n30 4.5 5.5 -6.5\n##END=', { filename: 'a.dx' });
    t.ok(r.ok, r.error); t.near(r.traces[0].x[5], 50 / 60, 1e-12); t.eq(r.traces[0].y[5], -6.5); t.eq(r.traces[0].yUnit, 'counts');
    var p = P.parseText('##TITLE=pts\n##XUNITS=MINUTES\n##XYPOINTS=(XY..XY)\n0.0, 1.0; 0.5, 2.0\n1.0, 3.0\n##END=', { filename: 'p.jdx' });
    t.ok(p.ok, p.error); t.eq(p.traces[0].x.join(','), '0,0.5,1'); t.eq(p.traces[0].y.join(','), '1,2,3');
  });

  /* ---------- AnDI / netCDF ---------- */
  PK.test('parsers: AnDI netCDF values, units and metadata', function (t) {
    var y = []; for (var i = 0; i < 11; i++) y.push(i * i);
    var buf = buildNetCDF({ y: y, interval: 0.5, delay: 6, runLength: 5, attrs: { detector_unit: 'mAU', retention_unit: 'seconds', sample_name: 'Std mix', detector_name: 'UV 254nm' } });
    var nc = P._internal.readNetCDF(buf);
    t.eq(nc.version, 1); t.eq(nc.attrs.detector_unit, 'mAU'); t.eq(nc.get('ordered_derivative_values').length, 11);
    return P.parseArrayBuffer(buf, { filename: 'run.cdf' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'netcdf'); var tr = r.traces[0];
      t.near(tr.x[0], 0.1, 1e-9, 'delay 6 s'); t.near(tr.x[10], 11 / 60, 1e-9); t.eq(tr.y[10], 100); t.eq(tr.yUnit, 'mAU');
      t.eq(tr.meta.sampleName, 'Std mix'); t.eq(tr.meta.wavelength, 254); t.eq(tr.name, 'Std mix');
      return P.parseArrayBuffer(buf.slice(0, buf.byteLength - 20), { filename: 'trunc.cdf' });
    }).then(function (r) {
      t.ok(!r.ok && /truncated/.test(r.error), 'truncated file error: ' + r.error);
    });
  });

  /* ---------- mzML ---------- */
  PK.test('parsers: mzML base64 float64 time (s) + float32 intensity', function (t) {
    var doc = mzmlDoc([mzChrom('TIC', 'MS:1000235', 'total ion current chromatogram', [0, 30, 60, 90, 120], 64, 'sec', [10, 20, 400, 30, 10], 32, null)]);
    var r = P.parseText(doc, { filename: 's.mzML' });
    t.ok(r.ok, r.error); t.eq(r.format, 'mzML'); var tr = r.traces[0];
    t.eq(tr.x.join(','), '0,0.5,1,1.5,2'); t.eq(tr.y[2], 400); t.eq(tr.yUnit, 'counts'); t.eq(tr.name, 's TIC');
  });

  PK.test('parsers: mzML zlib-compressed (pako or Node zlib; skipped otherwise)', function (t) {
    var z = zlibShim();
    if (!z) { t.ok(true, 'skipped: no zlib available'); return; }
    var doc = mzmlDoc([mzChrom('BPC', 'MS:1000628', 'basepeak chromatogram', [0, 0.25, 0.5], 64, 'min', [5, 50, 5], 64, z)]);
    var hadPako = typeof globalThis !== 'undefined' && !!globalThis.pako;
    if (!hadPako) {
      var none = P.parseText(doc, { filename: 'z.mzML' });
      t.ok(!none.ok && /pako|decompression/.test(none.error), 'clear error without pako: ' + none.error);
    }
    var restore = z.install();
    try {
      var r = P.parseText(doc, { filename: 'z.mzML' });
      t.ok(r.ok, r.error); t.eq(r.traces[0].x.join(','), '0,0.25,0.5'); t.eq(r.traces[0].y[1], 50);
    } finally { restore(); }
  });

  /* ---------- Agilent ChemStation binary ---------- */
  PK.test('parsers: Agilent .ch type 130 delta encoding', function (t) {
    return P.parseArrayBuffer(build130(), { filename: 'DAD1A.ch' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'agilent-ch'); var tr = r.traces[0];
      t.eq(tr.y.join(','), '500,501,502.5,450,449.5', 'delta-decoded and scaled');
      t.near(tr.x[4], 0.4, 1e-12); t.near(tr.x[1], 0.1, 1e-12); t.eq(tr.yUnit, 'mAU');
      t.eq(tr.meta.wavelength, 254); t.eq(tr.meta.sampleName, 'Caffeine std'); t.eq(tr.meta.chVersion, 130);
    });
  });

  PK.test('parsers: Agilent .ch type 179 doubles and 181 double-delta', function (t) {
    return P.parseArrayBuffer(build179(), { filename: 'FID1A.ch' }).then(function (r) {
      t.ok(r.ok, r.error); var tr = r.traces[0];
      t.eq(tr.y.join(','), '3,5,20,6'); t.near(tr.x[0], 2, 1e-9); t.near(tr.x[3], 2.05, 1e-9); t.eq(tr.yUnit, 'pA');
      return P.parseArrayBuffer(build181(), { filename: 'FID1A.ch' });
    }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.traces[0].y.join(','), '1000,1003,1008,1010'); t.near(r.traces[0].x[3], 0.05, 1e-9);
    });
  });

  /* ---------- vendor text exports ---------- */
  PK.test('parsers: Agilent CSV export in UTF-16LE', function (t) {
    var buf = utf16leWithBom('0.000000,1.50\r\n0.003333,1.60\r\n0.006667,2.40\r\n0.010000,1.70\r\n');
    return P.parseArrayBuffer(buf, { filename: 'DAD1A.CSV' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'agilent-text'); var tr = r.traces[0];
      t.eq(tr.yUnit, 'mAU'); t.near(tr.x[3], 0.01, 1e-12); t.eq(tr.y[2], 2.4); t.eq(r.warnings.length, 0, 'no unit warnings for known export');
      t.eq(tr.meta.channel, 'DAD1A');
    });
  });

  PK.test('parsers: Thermo Chromeleon ASCII (decimal comma)', function (t) {
    var txt = 'Raw Data:\nInformation:\nSample Name\tBSA 1 mg/mL\nInjection Volume\t10,0\n\nChromatogram Data Information:\nTime Min.\t0,000\nData Points\t4\n' +
      'Signal Unit\tmAU\nChannel\tUV_VIS_1\n\nChromatogram Data:\nTime (min)\tStep (s)\tValue (mAU)\n0,000000\tn.a.\t0,100\n0,003333\t0,20\t0,250\n0,006667\t0,20\t5,500\n0,010000\t0,20\t0,300\n';
    var r = P.parseText(txt, { filename: 'bsa.txt' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'chromeleon'); t.eq(r.traces.length, 1, 'Step column skipped');
    var tr = r.traces[0]; t.eq(tr.yUnit, 'mAU'); t.near(tr.y[2], 5.5, 1e-12); t.near(tr.x[3], 0.01, 1e-12);
    t.eq(tr.meta.sampleName, 'BSA 1 mg/mL'); t.eq(tr.name, 'BSA 1 mg/mL UV_VIS_1');
  });

  PK.test('parsers: Shimadzu LabSolutions ASCII with Multiplier', function (t) {
    var txt = '[Header]\nApplication Name\tLabSolutions\nVersion\t5.97\n[Sample Information]\nSample Name\tDigest\n' +
      '[LC Chromatogram(Detector A-Ch1)]\nInterval(msec)\t500\n# of Points\t4\nStart Time(min)\t0.000\nIntensity Units\tmV\nIntensity Multiplier\t0.001\nWavelength(nm)\t214\n' +
      'R.Time (min)\tIntensity\n0.00000\t1000\n0.00833\t2000\n0.01667\t53000\n0.02500\t1500\n' +
      '[Peak Table(Detector A-Ch1)]\n# of Peaks\t1\nPeak#\tR.Time\tArea\n1\t0.017\t12345\n';
    var r = P.parseText(txt, { filename: 'run.txt' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'shimadzu'); t.eq(r.traces.length, 1, 'peak table ignored');
    var tr = r.traces[0]; t.eq(tr.yUnit, 'mV'); t.near(tr.y[2], 53, 1e-9, 'multiplier applied'); t.eq(tr.meta.wavelength, 214);
    t.eq(tr.meta.sampleName, 'Digest'); t.eq(tr.meta.channel, 'Detector A-Ch1');
  });

  PK.test('parsers: Waters Empower .arw', function (t) {
    var txt = '"SampleName"\t"Channel"\t"Date Acquired"\n"Std A"\t"2998 Ch1 254nm@1.2nm"\t"3/1/2024 10:00:00 AM"\n0.000000\t0.000100\n0.016667\t0.000200\n0.033333\t0.004000\n0.050000\t0.000300\n';
    var r = P.parseText(txt, { filename: 'stdA.arw' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'waters-arw'); var tr = r.traces[0];
    t.eq(tr.yUnit, 'AU'); t.eq(tr.meta.wavelength, 254); t.eq(tr.y[2], 0.004); t.eq(tr.x.length, 4); t.ok(/^Std A/.test(tr.name), tr.name);
  });

  PK.test('parsers: Cytiva UNICORN multi-curve (volume x, fractions)', function (t) {
    var txt = 'Chrom.1\t\tChrom.1\t\tChrom.1\t\tChrom.1\t\nUV 1_280\t\tCond\t\tConc B\t\tFractions\t\nml\tmAU\tml\tmS/cm\tml\t%\tml\t\n' +
      '0.00\t1.0\t0.00\t5.0\t0.00\t0\t0.50\tA1\n0.10\t2.0\t0.10\t5.5\t1.00\t50\t1.50\tA2\n0.20\t3.0\t0.20\t6.0\t\t\t2.50\tWaste\n';
    var r = P.parseText(txt, { filename: 'imac.asc' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'unicorn'); t.eq(r.traces.length, 3);
    var uv = r.traces[0]; t.eq(uv.xUnit, 'mL'); t.ok(uv.meta.xIsVolume, 'xIsVolume'); t.eq(uv.yUnit, 'mAU'); t.eq(uv.meta.wavelength, 280);
    var cond = r.traces.filter(function (x) { return x.meta.role === 'conductivity'; })[0]; t.ok(cond && cond.yUnit === 'mS/cm', 'cond');
    var grad = r.traces.filter(function (x) { return x.meta.role === 'gradient'; })[0]; t.ok(grad && grad.y[1] === 50 && grad.x.length === 2, 'conc B');
    t.eq(r.events.length, 3); t.eq(r.events[2].label, 'Waste'); t.ok(r.warnings.some(function (w) { return /flow rate/.test(w); }), 'volume warning');
    var f = P.parseText(txt, { filename: 'imac.asc', flow: 0.5 });
    t.eq(f.traces[0].xUnit, 'min'); t.near(f.traces[0].x[2], 0.4, 1e-12, 'mL / flow');
  });

  PK.test('parsers: Bio-Rad ChromLab/NGC CSV', function (t) {
    var txt = 'Bio-Rad ChromLab Run Report\nRun Name:,IMAC run 1\nColumn:,Profinity 1 mL\n\nVolume (ml),UV (mAU),Conductivity (mS/cm),GP (%B)\n0.0,1.0,10.0,0\n0.5,1.5,10.5,5\n1.0,9.0,11.0,10\n1.5,2.0,11.5,15\n';
    var r = P.parseText(txt, { filename: 'ngc.csv' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'biorad'); t.eq(r.traces.length, 3);
    t.eq(r.traces[0].yUnit, 'mAU'); t.eq(r.traces[0].xUnit, 'mL'); t.eq(r.traces[0].meta.sampleName, 'IMAC run 1');
    t.ok(r.traces.some(function (x) { return x.meta.role === 'gradient' && x.yUnit === '%'; }), '%B trace');
    t.ok(r.traces.some(function (x) { return x.meta.role === 'conductivity'; }), 'conductivity trace');
  });

  /* ---------- binary edge cases ---------- */
  PK.test('parsers: xlsx needs SheetJS (graceful) or parses when present', function (t) {
    var X = typeof globalThis !== 'undefined' ? globalThis.XLSX : null;
    if (!X) {
      return P.parseArrayBuffer(asciiBuf('PK\u0003\u0004[Content_Types].xml xl/workbook.xml'), { filename: 'run.xlsx' }).then(function (r) {
        t.ok(!r.ok && /SheetJS/.test(r.error), r.error); t.eq(r.plugin, 'xlsx');
      });
    }
    var ws = X.utils.aoa_to_sheet([['Time (min)', 'UV (mAU)'], [0, 1], [0.5, 4], [1, 2]]), wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Data');
    var out = X.write(wb, { type: 'array', bookType: 'xlsx' });
    return P.parseArrayBuffer(out, { filename: 'run.xlsx' }).then(function (r) {
      t.ok(r.ok, r.error); t.eq(r.traces[0].y[1], 4); t.eq(r.traces[0].yUnit, 'mAU');
    });
  });

  PK.test('parsers: unknown/unsupported binaries give specific errors', function (t) {
    var junk = new Uint8Array(512); for (var i = 0; i < junk.length; i++) junk[i] = (i * 37 + 11) % 256;
    return P.parseArrayBuffer(junk.buffer, { filename: 'mystery.bin' }).then(function (r) {
      t.ok(!r.ok && /binary file/.test(r.error), r.error);
      return P.parseArrayBuffer(asciiBuf('\u0089HDF\r\n\u001a\n' + new Array(64).join('\u0000')), { filename: 'x.cdf' });
    }).then(function (r) {
      t.ok(!r.ok && /HDF5/.test(r.error), r.error);
      return P.parseArrayBuffer(new ArrayBuffer(0), { filename: 'zero.csv' });
    }).then(function (r) {
      t.ok(!r.ok && /empty/.test(r.error), r.error);
      var bad = new Uint8Array(build130()); bad[1] = '9'.charCodeAt(0); // version "930"
      return P.parseArrayBuffer(bad.buffer, { filename: 'odd.ch' });
    }).then(function (r) {
      t.ok(!r.ok && /version|ChemStation/.test(r.error), r.error);
    });
  });

  PK.test('parsers: decodeBytes handles BOM-less UTF-16LE and UTF-8', function (t) {
    var s = 'Time,Value\n0,1\n', u = new Uint8Array(s.length * 2);
    for (var i = 0; i < s.length; i++) u[2 * i] = s.charCodeAt(i);
    var d = P._internal.decodeBytes(u); t.eq(d.encoding, 'utf-16le'); t.eq(d.text, s);
    var e = P._internal.decodeBytes(new Uint8Array([0xEF, 0xBB, 0xBF, 0x41, 0xC2, 0xB5])); t.eq(e.text, 'Aµ');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
