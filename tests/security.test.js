/* SPDX-License-Identifier: MIT */
/* Security regression tests (pure, no DOM): escaping, prototype-pollution guards, project/share-link sanitizing, image and
   colour allow-lists, bounded share-link expansion, Claude-response normalizing. See docs/SECURITY_AUDIT.md. */
(function (PK) {
  'use strict';
  // tests/run.js does not load app.js; load it here when running under Node (no DOM is touched at load time).
  function ensureApp() {
    if (PK.app && PK.app.sanitizeProject) return true;
    try {
      var gb = typeof process !== 'undefined' && process.getBuiltinModule;
      if (!gb) return false;
      var fs = gb('fs'), path = gb('path'), vm = gb('vm');
      var f = path.join(path.dirname(process.argv[1]), '..', 'src', 'app.js');
      vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
      return !!(PK.app && PK.app.sanitizeProject);
    } catch (e) { return false; }
  }
  var ID_LZ = { compressToEncodedURIComponent: function (s) { return encodeURIComponent(s); }, decompressFromEncodedURIComponent: function (s) { try { return decodeURIComponent(s); } catch (e) { return null; } } };
  var IMG = '<img src=x onerror="window.__pwned=1">', SVG = '"><svg onload="window.__pwned=1">', JS = 'javascript:window.__pwned=1';
  var A_TAG = '<a href="javascript:window.__pwned=1">x</a>', TPL = '%{y}%{customdata}<extra>%{fullData.name}</extra>';
  function protoClean() {
    var o = {};
    return o.polluted === undefined && o.polluted2 === undefined && o.pollutedMeta === undefined && o.pollutedMig === undefined && o.pollutedSet === undefined;
  }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /** Hostile project as JSON text: "__proto__" must be a literal JSON key (an object literal would set the prototype). */
  function hostileJSON() {
    var x = [], y = [];
    for (var i = 0; i < 200; i++) { x.push(i * 0.05); y.push(100 * Math.exp(-Math.pow((i * 0.05 - 5) / 0.2, 2)) + 1); }
    var p = {
      app: 'Peakly', version: 2, name: IMG + A_TAG, activeTraceId: { evil: 1 },
      method: { name: IMG, notes: SVG, bConcUnit: IMG, gradientType: 'salt', bMaxConc: 500, flow: '1"><b>', wavelength_nm: SVG, column: { name: SVG, length_mm: '150' },
        gradient: [{ t: 0, B: 5 }, { t: 10, B: '95' }, { t: SVG, B: 1 }], run: { sampleName: IMG, notes: { nested: 1 }, bogus: IMG }, PROTO: { pollutedMig: 1 } },
      settings: { PROTO: { polluted: 1 }, constructor: { prototype: { polluted2: 1 } }, labels: { mode: IMG, size: SVG, all: 'yes' }, stack: SVG, compareTol: SVG,
        compareLabels: [{ rt: 1, label: IMG }, { rt: SVG, label: 'x' }], ghost: { opacity: SVG }, normalization: IMG, clipDefault: IMG, fitModel: IMG, differenceOf: [{ a: 1 }, 'b'] },
      calibration: { unit: IMG, analytes: [{ id: SVG, name: IMG, peakMatch: { rt: '5', tol: SVG }, levels: [{ conc: 1, response: 10, label: IMG }] }] },
      images: { a: 'data:image/png;base64,iVBORw0KGgo=', b: 'data:image/svg+xml;base64,PHN2Zz4=', c: JS, d: 'https://evil.example/x.png', e: 'data:text/html;base64,PHNjcmlwdD4=', PROTO: 'data:image/png;base64,AAAA' },
      traces: [{
        id: 'tr1', name: IMG + TPL, x: x, y: y, xUnit: { toString: 1 }, yUnit: SVG,
        source: { kind: IMG, filename: IMG + '.csv', format: { nested: true } },
        meta: { role: { evil: 1 }, PROTO: { pollutedMeta: 1 }, run: { sampleName: IMG, instrument: ['a'] }, events: { not: 'array' } },
        style: { color: 'red;background:url(https://evil.example/leak)', width: SVG, offset: SVG, visible: true },
        proc: { smooth: { on: true, window: SVG, order: IMG }, baseline: { on: true, lambda: SVG, p: IMG, iter: SVG }, peaks: { threshold: SVG, minDist: IMG, minWidth: SVG, auto: true } },
        peaks: [{ id: { evil: 1 }, start: 4.5, apex: 5, end: 5.5, label: IMG, importedFrom: { x: 1 } }],
        digitized: { dxMin: SVG, dy: 0.1, imageId: { x: 1 }, printedPeaks: [{ rt: 5, label: IMG }, { rt: SVG }], warnings: [IMG, { x: 1 }] },
        fit: { model: IMG, r2: SVG, components: 'nope', peakIds: [{ x: 1 }] }
      }]
    };
    return JSON.stringify(p).replace(/"PROTO"/g, '"__proto__"');
  }

  PK.test('security: escapeHtml neutralizes markup and attribute breakouts', function (t) {
    var e = PK.util.escapeHtml;
    [IMG, SVG, A_TAG, "'><script>alert(1)<\/script>", '`${alert(1)}`'].forEach(function (p) {
      var s = e(p);
      t.ok(!/[<>"'`]/.test(s), 'no raw < > " \' ` left in ' + JSON.stringify(s));
    });
    t.eq(e('a & b'), 'a &amp; b', 'ampersand');
    t.eq(e(null), '', 'null → empty');
    t.eq(e({ toString: function () { return '<b>'; } }), '&lt;b&gt;', 'objects are stringified then escaped');
  });

  PK.test('security: plotlyText escapes Plotly pseudo-HTML and %{} template tokens', function (t) {
    var f = PK.util.plotlyText;
    t.ok(typeof f === 'function', 'PK.util.plotlyText exists');
    var s = f(A_TAG + TPL + ' a&b');
    t.ok(s.indexOf('<') < 0 && s.indexOf('>') < 0, 'no raw angle brackets (no <a href>, <b>, <extra> for Plotly)');
    t.ok(s.indexOf('%{') < 0, 'no %{ token survives');
    t.ok(s.indexOf('%&#123;y}') >= 0, '%{ is broken with a numeric entity that Plotly renders as {');
    t.ok(/a&amp;b$/.test(s), 'ampersand escaped');
  });

  PK.test('security: safeDataImage only allows base64 PNG/JPEG/WebP/GIF data URLs', function (t) {
    var f = PK.util.safeDataImage;
    ['data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/jpg;base64,AAAA', 'data:image/webp;base64,UklGRg==', 'data:image/gif;base64,R0lGOD=='].forEach(function (u) { t.eq(f(u), u, 'accepted: ' + u.slice(0, 20)); });
    ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/svg+xml,<svg onload=alert(1)>', JS, 'https://evil.example/a.png', 'blob:http://x/1', 'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png;base64,AAAA"onerror="alert(1)', 'data:image/png,rawbytes', ' data:image/png;base64,AAAA', 'DATA:IMAGE/PNG;BASE64,AAAA', null, 42, { src: 'x' }].forEach(function (u) {
      t.eq(f(u), null, 'rejected: ' + String(u).slice(0, 30));
    });
  });

  PK.test('security: safeColor blocks CSS injection', function (t) {
    var f = PK.util.safeColor;
    ['#1f4fd8', '#fff', '#11223344', 'rgb(1,2,3)', 'rgba(1, 2, 3, 0.5)', 'red'].forEach(function (c) { t.eq(f(c), c, 'accepted ' + c); });
    ['red;background:url(https://evil.example/x)', 'url(x)', 'expression(alert(1))', '#12345', 'rgb(1,2,3);x', '"><b>', '', null, 5].forEach(function (c) { t.eq(f(c), null, 'rejected ' + c); });
  });

  PK.test('security: stripUnsafeKeys drops __proto__/constructor/prototype at any depth', function (t) {
    var o = JSON.parse('{"a":{"__proto__":{"x":1},"b":[{"constructor":{"prototype":{"y":1}},"ok":2}]},"prototype":3,"__proto__":{"z":1}}');
    var c = PK.util.stripUnsafeKeys(o);
    t.ok(!hasOwn(c, '__proto__') && !hasOwn(c, 'prototype'), 'top-level keys dropped');
    t.ok(!hasOwn(c.a, '__proto__'), 'nested __proto__ dropped');
    t.ok(!hasOwn(c.a.b[0], 'constructor') && c.a.b[0].ok === 2, 'constructor dropped inside arrays, other keys kept');
    t.eq(Object.getPrototypeOf(c.a), Object.prototype, 'prototype of copies untouched');
    t.ok(protoClean() && ({}).x === undefined && ({}).y === undefined && ({}).z === undefined, 'Object.prototype not polluted');
    var ta = PK.util.stripUnsafeKeys({ v: new Float64Array([1, 2]) }); t.ok(Array.isArray(ta.v) && ta.v[1] === 2, 'typed arrays → arrays');
    var deep = {}, cur = deep; for (var i = 0; i < 100; i++) { cur.n = {}; cur = cur.n; }
    t.ok(PK.util.stripUnsafeKeys(deep, 10) !== null, 'depth-limited copy returns');
    t.eq(PK.util.stripUnsafeKeys({ f: function () {}, u: undefined, s: 's' }).s, 's', 'functions/undefined dropped');
  });

  PK.test('security: schema.migrate does not copy __proto__ keys', function (t) {
    var raw = JSON.parse('{"version":1,"traces":[],"__proto__":{"pollutedMig":1},"settings":{"__proto__":{"polluted":1}}}');
    var m = PK.schema.migrate(raw);
    t.ok(!hasOwn(m, '__proto__') && !hasOwn(m.settings, '__proto__'), 'no own __proto__ keys after migrate');
    t.ok(protoClean(), 'Object.prototype not polluted');
  });

  PK.test('security: sanitizeProject neutralizes a hostile project file', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here; skipped'); return; }
    var A = PK.app, p = A.sanitizeProject(JSON.parse(hostileJSON())), tr = p.traces[0];
    t.ok(protoClean(), 'no prototype pollution through settings/meta/method');
    t.ok(!hasOwn(p.settings, '__proto__') && !hasOwn(p.settings, 'constructor') && !hasOwn(tr.meta, '__proto__'), 'dangerous keys are not copied');
    // types: numbers stay numbers, enums stay enums (render code interpolates these into HTML attributes)
    t.eq(tr.proc.smooth.window, 11, 'smooth.window markup → default number'); t.eq(typeof tr.proc.smooth.order, 'number', 'smooth.order number');
    t.eq(typeof tr.proc.baseline.lambda, 'number', 'lambda number'); t.eq(typeof tr.proc.baseline.p, 'number', 'p number'); t.eq(typeof tr.proc.baseline.iter, 'number', 'iter number');
    t.eq(tr.proc.peaks.threshold, 'auto', 'threshold markup → auto'); t.eq(typeof tr.proc.peaks.minDist, 'number', 'minDist number'); t.eq(typeof tr.proc.peaks.minWidth, 'number', 'minWidth number');
    t.eq(tr.style.color, A.palette[0], 'CSS-injecting colour replaced by the palette'); t.eq(tr.style.width, 1.5, 'width number'); t.eq(tr.style.offset, 0, 'offset number');
    t.eq(tr.xUnit, 'min', 'object xUnit → default'); t.eq(typeof tr.yUnit, 'string', 'yUnit string (escaped at render)');
    t.eq(typeof tr.meta.role, 'undefined', 'object role dropped'); t.ok(!('events' in tr.meta), 'non-array events dropped');
    t.eq(tr.meta.run.instrument, undefined, 'non-string run field dropped'); t.eq(tr.meta.run.sampleName, IMG, 'string run field kept verbatim (escaped at render)');
    t.eq(tr.source.format, undefined, 'object source.format dropped'); t.eq(tr.source.kind, IMG.slice(0, 32), 'source.kind capped');
    t.eq(typeof tr.peaks[0].id, 'string', 'object peak id → generated string'); t.eq(tr.peaks[0].importedFrom, undefined, 'object importedFrom dropped');
    t.eq(tr.digitized.dxMin, null, 'markup dxMin → null'); t.eq(tr.digitized.imageId, null, 'object imageId → null');
    t.eq(tr.digitized.printedPeaks.length, 1, 'printed peak with markup rt dropped'); t.eq(tr.digitized.warnings.length, 1, 'non-string warning dropped');
    t.eq(tr.fit.model, 'gaussian', 'fit model enum'); t.eq(tr.fit.r2, null, 'fit r2 number|null'); t.ok(Array.isArray(tr.fit.components) && !tr.fit.components.length, 'fit components array');
    t.eq(p.activeTraceId, 'tr1', 'object activeTraceId ignored');
    var s = p.settings;
    t.eq(s.labels.mode, 'auto', 'label mode enum'); t.eq(s.labels.size, 10, 'label size number'); t.eq(s.labels.all, false, 'label all boolean');
    t.eq(s.stack, 0, 'stack number'); t.eq(s.compareTol, 0.1, 'compareTol number'); t.eq(s.ghost.opacity, 0.35, 'ghost opacity number');
    t.eq(s.normalization, 'none', 'normalization enum'); t.eq(s.clipDefault, 'drop', 'clipDefault enum'); t.eq(s.fitModel, 'gaussian', 'fitModel enum');
    t.eq(s.compareLabels.length, 1, 'compare label with markup rt dropped'); t.eq(s.differenceOf[0], null, 'object ids → null');
    var m = p.method;
    t.eq(m.flow, null, 'flow with markup → null'); t.eq(m.wavelength_nm, null, 'wavelength markup → null'); t.eq(m.column.length_mm, 150, 'numeric string → number');
    t.eq(m.gradient.length, 2, 'gradient row with markup time dropped'); t.eq(m.gradient[1].B, 95, 'numeric B');
    t.eq(m.bConcUnit.length <= 16, true, 'bConcUnit capped'); t.ok(!('notes' in m.run) && !('bogus' in m.run), 'run info: unknown and non-string fields dropped');
    t.ok(!hasOwn(m, '__proto__'), 'method has no __proto__ key');
    t.eq(Object.keys(p.images).join(','), 'a', 'only the base64 PNG image survives (svg, javascript:, http:, text/html, __proto__ rejected)');
    t.eq(p.calibration.analytes[0].name, IMG, 'calibration name kept as text (escaped at render)'); t.eq(p.calibration.analytes[0].peakMatch.tol, 0.1, 'tol number');
  });

  PK.test('security: decodeShare of a crafted link yields a sanitized project', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here; skipped'); return; }
    var obj = JSON.parse(hostileJSON());
    obj.v = 1; obj.schema = 2; obj.images = { a: 'data:image/png;base64,iVBORw0KGgo=' };
    obj.traces.push({ name: 'bad grid', x: { u: [0, 1, -4e9] }, y: { e: 1e9, d: [1, 2, 3] } }); // negative length, absurd exponent
    var link = '#p=' + ID_LZ.compressToEncodedURIComponent(JSON.stringify(obj).replace(/"PROTO"/g, '"__proto__"'));
    var p = PK.app.decodeShare(link, ID_LZ);
    t.ok(protoClean(), 'no prototype pollution through a share link');
    t.eq(Object.keys(p.images).length, 0, 'share links never carry images');
    t.eq(p.traces[0].proc.smooth.window, 11, 'proc coerced'); t.eq(p.traces[0].style.color, PK.app.palette[0], 'colour coerced');
    t.ok(p.traces.length === 2 && p.traces[1].x.length === 0, 'malformed packed arrays expand to nothing (' + (p.traces[1] && p.traces[1].x.length) + ')');
    t.throws(function () { PK.app.decodeShare('#p=' + ID_LZ.compressToEncodedURIComponent('{"app":"Peakly","traces":{"length":5}}'), ID_LZ); }, 'non-array traces rejected');
    t.throws(function () { PK.app.decodeShare('#p=' + ID_LZ.compressToEncodedURIComponent('[1,2]'), ID_LZ); }, 'non-object payload rejected');
  });

  PK.test('security: unpackArray honours its length budget', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here; skipped'); return; }
    t.eq(PK.app.unpackArray({ u: [0, 1, 1e12] }, 1000).length, 1000, 'uniform grid capped by budget');
    t.eq(PK.app.unpackArray({ u: [0, 1, 1e12] }, 1e9).length, 5e6, 'hard per-array cap 5e6 even with a larger budget');
    t.eq(PK.app.unpackArray({ e: 1e6, d: [1, 2] }).length, 0, 'absurd exponent rejected');
    t.eq(PK.app.unpackArray([1, 2, 3], 2).length, 2, 'plain arrays capped too');
  });

  PK.test('security: sanitizeImages / sanitizeSettings are prototype-safe', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here; skipped'); return; }
    var im = PK.app.sanitizeImages(JSON.parse('{"__proto__":"data:image/png;base64,AAAA","constructor":"data:image/png;base64,AAAA","ok":"data:image/gif;base64,R0lGOD=="}'));
    t.eq(Object.keys(im).join(','), 'ok', 'dangerous keys skipped'); t.eq(Object.getPrototypeOf(im), Object.prototype, 'image map prototype intact');
    var s = PK.app.sanitizeSettings(JSON.parse('{"__proto__":{"pollutedSet":1},"labels":{"__proto__":{"pollutedSet":1}},"ghost":{"show":false}}'));
    t.ok(protoClean(), 'settings sanitizer does not pollute'); t.eq(s.ghost.show, false, 'valid values kept');
  });

  PK.test('security: Claude response strings are coerced and colours normalized', function (t) {
    var D = PK.digitizer; if (!D || !D._normalizeClaude) { t.ok(true, 'digitizer not loaded; skipped'); return; }
    var r = D._normalizeClaude({ title: { evil: 1 }, xAxis: { label: [IMG], unit: IMG, ticks: [] }, yAxis: { label: IMG.repeat(100), ticks: [] },
      traces: [{ label: { x: 1 }, color: 'red;background:url(x)' }, { label: IMG, color: '#ABC' }], peaks: [{ rt: 1, label: { x: 1 } }, { rt: '2', label: IMG }] }, 100, 100);
    t.eq(r.title, null, 'object title → null'); t.eq(r.xAxis.label, null, 'array label → null'); t.ok(r.yAxis.label.length <= 200, 'long label capped');
    t.eq(r.traces[0].color, null, 'CSS-injecting colour rejected'); t.eq(r.traces[1].color, '#aabbcc', 'hex colour normalized'); t.eq(r.traces[0].label, null, 'object trace label → null');
    t.eq(r.peaks[0].label, null, 'object peak label → null'); t.eq(r.peaks[1].label, IMG, 'string label kept (escaped at render)');
  });

  PK.test('security: JSON data rows keyed "__proto__"/"constructor" import without crashing', function (t) {
    if (!PK.parsers || !PK.parsers.parseText) { t.ok(true, 'parsers not loaded; skipped'); return; }
    var rows = [];
    ['__proto__', 'constructor', 'toString'].forEach(function (k) { for (var i = 0; i < 5; i++) rows.push({ trace_id: k, x: i, y: i * i }); });
    var res = PK.parsers.parseText(JSON.stringify(rows), { filename: 'rows.json' });
    t.ok(res && res.ok !== false && res.traces && res.traces.length === 3, 'three traces parsed (' + (res && (res.error || (res.traces && res.traces.length))) + ')');
    t.ok(protoClean() && ({}).x === undefined, 'no pollution');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
