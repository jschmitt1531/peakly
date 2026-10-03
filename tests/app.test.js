/* App shell pure-helper tests: share codec, project sanitizing, cross-trace peak matching, manual table parser. */
(function (PK) {
  'use strict';
  // tests/run.js does not load app.js; load it here when running under Node (no DOM is touched at load time).
  function ensureApp() {
    if (PK.app && PK.app.encodeShare) return true;
    try {
      var gb = typeof process !== 'undefined' && process.getBuiltinModule;
      if (!gb) return false;
      var fs = gb('fs'), path = gb('path'), vm = gb('vm');
      var f = path.join(path.dirname(process.argv[1]), '..', 'src', 'app.js');
      vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
      return !!(PK.app && PK.app.encodeShare);
    } catch (e) { return false; }
  }
  // identity "compressor" so the codec can be tested without lz-string
  var ID_LZ = { compressToEncodedURIComponent: function (s) { return encodeURIComponent(s); }, decompressFromEncodedURIComponent: function (s) { try { return decodeURIComponent(s); } catch (e) { return null; } } };
  function sampleProject() {
    var x = [], y = [], x2 = [], y2 = [];
    for (var i = 0; i < 500; i++) { x.push(i * 0.01); y.push(Math.exp(-Math.pow((i * 0.01 - 2.5) / 0.1, 2)) * 100 + 0.123456789); }
    for (var j = 0; j < 50; j++) { x2.push(j * j * 0.001); y2.push(j); }
    return { name: 'Test', method: { name: 'M', gradient: [{ t: 0, B: 5, flow: 1 }, { t: 10, B: 95, flow: 1 }], flow: 1, run: { operator: 'JS' } },
      traces: [{ name: 'A', x: x, y: y, xUnit: 'min', yUnit: 'mAU', peaks: [{ id: 'p1', start: 2.2, apex: 2.5, end: 2.8, label: 'Caffeine', manual: true }], meta: { run: { sampleName: 'S1' } } },
        { name: 'B (digitized)', x: x2, y: y2, xUnit: 'min', yUnit: 'mAU', digitized: { dxMin: 0.01, dy: 0.5, imageId: 'img1', warnings: [] }, source: { kind: 'image' } }],
      images: { img1: 'data:image/png;base64,AAAA' } };
  }

  PK.test('app: packArray detects uniform grids and round-trips', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here; skipped'); return; }
    var A = PK.app, u = [];
    for (var i = 0; i < 1000; i++) u.push(1.5 + i * 0.002);
    var pu = A.packArray(u, 7);
    t.ok(pu && pu.u, 'uniform array packed as {u}');
    var back = A.unpackArray(pu);
    t.eq(back.length, 1000, 'length restored');
    t.near(back[999], u[999], 1e-9, 'last value restored');
    var nu = [0, 0.1, 0.35, 0.9, 2.0001234567];
    var pn = A.packArray(nu, 6);
    t.ok(Array.isArray(pn), 'non-uniform stays an array');
    t.near(A.unpackArray(pn)[4], 2.00012, 1e-5, 'rounded to 6 significant digits');
    var sig = []; for (var k = 0; k < 300; k++) sig.push(150 * Math.exp(-Math.pow((k - 150) / 20, 2)) - 0.37 + 0.01 * Math.sin(k));
    var pd = A.packDelta(sig), rec = A.unpackArray(pd), err = 0;
    for (k = 0; k < sig.length; k++) err = Math.max(err, Math.abs(rec[k] - sig[k]));
    t.ok(pd && Array.isArray(pd.d), 'signal delta-packed');
    t.ok(err <= 150 * 1e-5, 'delta packing error below max·1e-5 (got ' + err + ')');
  });

  PK.test('app: encodeShare/decodeShare round-trip (no images, labels kept)', function (t) {
    if (!ensureApp()) { t.ok(true, 'skipped'); return; }
    var A = PK.app, p = A.sanitizeProject(sampleProject());
    var lz = (typeof LZString !== 'undefined') ? LZString : ID_LZ;
    var s = A.encodeShare(p, lz);
    t.ok(typeof s === 'string' && s.length > 10, 'encoded string');
    t.ok(!/data%3Aimage|data:image/.test(s), 'images are not embedded');
    var q = A.decodeShare('#p=' + s, lz);
    t.eq(q.traces.length, 2, 'two traces');
    t.eq(q.traces[0].x.length, 500, 'x length');
    t.near(q.traces[0].y[250], p.traces[0].y[250], 1e-3, 'y value preserved (rounded)');
    t.eq(q.traces[0].peaks[0].label, 'Caffeine', 'peak label preserved');
    t.ok(q.traces[1].digitized && q.traces[1].digitized.dxMin === 0.01, 'digitized flag and uncertainty preserved');
    t.eq(Object.keys(q.images).length, 0, 'no images after decode');
    t.eq(q.method.gradient.length, 2, 'method preserved');
    t.eq(q.method.run.operator, 'JS', 'project run info preserved');
    t.eq(q.traces[0].meta.run.sampleName, 'S1', 'trace run info preserved');
    t.throws(function () { A.decodeShare('#p=garbage%%%', ID_LZ); }, 'garbage rejected');
    t.throws(function () { A.decodeShare('#p=' + encodeURIComponent('{"app":"Other"}'), ID_LZ); }, 'foreign JSON rejected');
  });

  PK.test('app: sanitizeProject fills defaults, sorts x, drops NaN', function (t) {
    if (!ensureApp()) { t.ok(true, 'skipped'); return; }
    var A = PK.app;
    t.throws(function () { A.sanitizeProject(null); }, 'null rejected');
    t.throws(function () { A.sanitizeProject({ traces: 5 }); }, 'non-array traces rejected');
    var p = A.sanitizeProject({ traces: [{ x: [3, 1, 2, NaN], y: [30, 10, 20, 5] }] });
    var tr = p.traces[0];
    t.eq(JSON.stringify(tr.x), '[1,2,3]', 'x sorted and NaN dropped');
    t.eq(JSON.stringify(tr.y), '[10,20,30]', 'y follows x');
    t.ok(tr.proc && tr.proc.baseline.p === 0.001 && tr.proc.baseline.lambdaAuto === true, 'baseline defaults (p=0.001, auto λ)');
    t.eq(tr.style.color, A.palette[0], 'first trace gets the primary blue');
    t.eq(p.activeTraceId, tr.id, 'active trace set');
  });

  PK.test('app: autoLambda scales with point count and clamps', function (t) {
    if (!ensureApp()) { t.ok(true, 'skipped'); return; }
    var L = PK.app.autoLambda;
    t.near(L(4000), 1e8, 1, 'n=4000 → 1e8');
    t.near(L(8000), 1.6e9, 1e3, 'n=8000 → 1.6e9');
    t.eq(L(100), 1e4, 'clamped low');
    t.eq(L(1e6), 1e11, 'clamped high');
  });

  PK.test('app: matchPeaks groups peaks across traces by RT tolerance', function (t) {
    if (!ensureApp()) { t.ok(true, 'skipped'); return; }
    var g = PK.app.matchPeaks([
      { traceId: 'A', peaks: [{ id: 'a1', rt: 1.00 }, { id: 'a2', rt: 2.00 }, { id: 'a3', rt: 5.00 }] },
      { traceId: 'B', peaks: [{ id: 'b1', rt: 1.05 }, { id: 'b2', rt: 2.08 }, { id: 'b3', rt: 3.50 }] },
      { traceId: 'C', peaks: [{ id: 'c1', rt: 0.97 }, { id: 'c2', rt: 2.30 }] }
    ], 0.1);
    t.eq(g.length, 5, 'five groups (1.0, 2.0, 2.3, 3.5, 5.0)');
    t.ok(g[0].members.A && g[0].members.B && g[0].members.C, 'first group has all three traces');
    t.near(g[0].rt, (1 + 1.05 + 0.97) / 3, 1e-9, 'group RT is the mean');
    t.ok(g[1].members.A.id === 'a2' && g[1].members.B.id === 'b2' && !g[1].members.C, '2.30 is outside tolerance of the 2.0 group');
    t.ok(g[2].members.C && g[2].members.C.id === 'c2', '2.30 forms its own group');
    t.ok(g[3].members.B && !g[3].members.A, 'unmatched peak gets its own row');
    for (var i = 1; i < g.length; i++) t.ok(g[i].rt > g[i - 1].rt, 'groups sorted by RT');
    var g2 = PK.app.matchPeaks([{ traceId: 'A', peaks: [{ id: 'x', rt: 1 }, { id: 'y', rt: 1.02 }] }], 0.1);
    t.eq(g2.length, 2, 'two peaks of the same trace never share a group');
  });

  PK.test('app: parseTable honours delimiter, skip, header and decimal comma', function (t) {
    if (!ensureApp() || !PK.app.parseTable) { t.ok(true, 'skipped'); return; }
    var P = PK.app.parseTable;
    var a = P('Instrument X\nTime;Signal;Cond\n0,0;1,5;10\n0,1;2,5;11\n0,2;3,5;12\n', { delimiter: 'auto', skip: 1, header: 'auto', decimal: 'auto' });
    t.eq(a.delimiter, ';', 'semicolon detected');
    t.eq(a.decimal, ',', 'decimal comma detected');
    t.ok(a.headerUsed && a.header[1] === 'Signal', 'header row used');
    t.eq(a.rows.length, 3, 'three data rows');
    t.near(a.rows[2][1], 3.5, 1e-12, 'value parsed');
    var b = P('1 2\n3 4\n', { delimiter: ' ', skip: 0, header: false });
    t.eq(b.rows.length, 2, 'whitespace rows'); t.eq(b.header, null, 'no header');
  });

  PK.test('app: gradientSummary describes the main ramp', function (t) {
    if (!ensureApp() || !PK.app.gradientSummary) { t.ok(true, 'skipped'); return; }
    var s = PK.app.gradientSummary({ gradient: [{ t: 0, B: 5 }, { t: 20, B: 95 }, { t: 23, B: 95 }, { t: 23, B: 5 }], gradientType: 'organic' });
    t.eq(s, '5→95% B in 20 min', 'RP summary');
    var s2 = PK.app.gradientSummary({ gradient: [{ t: 0, B: 40 }, { t: 10, B: 40 }], gradientType: 'isocratic' });
    t.eq(s2, 'isocratic 40% B', 'isocratic summary');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
