/* SPDX-License-Identifier: MIT */
/* Pure helpers behind the accessibility and feedback features: survey invitation rules, plot text summary, keyboard
   bound editing, wavelength re-parsing (MOCCA2), XML entity decoding, preferences without storage. */
(function (PK) {
  'use strict';
  // tests/run.js does not load app.js; load it here when running under Node (no DOM is touched at load time).
  function ensureApp() {
    if (PK.app && PK.app.surveyShouldPrompt) return true;
    try {
      var gb = typeof process !== 'undefined' && process.getBuiltinModule;
      if (!gb) return false;
      var fs = gb('fs'), path = gb('path'), vm = gb('vm');
      var f = path.join(path.dirname(process.argv[1]), '..', 'src', 'app.js');
      vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
      return !!(PK.app && PK.app.surveyShouldPrompt);
    } catch (e) { return false; }
  }
  var CFG = { url: 'https://forms.example.org/peakly-survey', promptAfter: ['calibration', 'fit', 'digitize', 'compare', 'split'], maxPrompts: 2, minMinutesBetween: 1440 };
  var NOW = Date.UTC(2026, 9, 5, 12, 0, 0), DAY = 864e5;

  PK.test('survey: prompt rules (url, event list, session, max, interval, never, opt-out, demo, modal)', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here'); return; }
    var Q = PK.app.surveyShouldPrompt, fresh = { prompts: 0, last: 0 };
    t.ok(Q(fresh, NOW, CFG, 'fit'), 'fresh browser, listed event → prompt');
    t.ok(Q(fresh, NOW, CFG, { id: 'calibration' }), 'event object form');
    t.ok(!Q(fresh, NOW, { url: '', promptAfter: CFG.promptAfter, maxPrompts: 2 }, 'fit'), 'empty url → never');
    t.ok(!Q(fresh, NOW, { url: 'http://insecure.example/x', promptAfter: CFG.promptAfter, maxPrompts: 2 }, 'fit'), 'non-https url → never');
    t.ok(!Q(fresh, NOW, { url: 'javascript:alert(1)', promptAfter: CFG.promptAfter, maxPrompts: 2 }, 'fit'), 'javascript: url → never');
    t.ok(!Q(fresh, NOW, CFG, 'detect'), 'event not in promptAfter → no');
    t.ok(!Q({ prompts: 0, session: true }, NOW, CFG, 'fit'), 'once per session');
    t.ok(!Q({ prompts: 2, last: NOW - 30 * DAY }, NOW, CFG, 'fit'), 'maxPrompts reached');
    t.ok(Q({ prompts: 1, last: NOW - 30 * DAY }, NOW, CFG, 'fit'), 'second prompt after the interval');
    t.ok(!Q({ prompts: 1, last: NOW - 60 * 60000 }, NOW, CFG, 'fit'), 'min interval respected (1 h < 1 day)');
    t.ok(Q({ prompts: 1, last: NOW - 1440 * 60000 }, NOW, CFG, 'fit'), 'exactly the min interval is enough');
    t.ok(!Q({ prompts: 0, never: true }, NOW, CFG, 'fit'), '"Don\'t ask again" is permanent');
    t.ok(!Q({ prompts: 0, invites: false }, NOW, CFG, 'fit'), 'settings toggle off');
    t.ok(!Q(fresh, NOW, CFG, { id: 'fit', demo: true }), 'never in demo mode');
    t.ok(!Q(fresh, NOW, CFG, { id: 'fit', modalOpen: true }), 'never while a modal is open');
    t.ok(!Q(fresh, NOW, { url: CFG.url, promptAfter: CFG.promptAfter, maxPrompts: 0 }, 'fit'), 'maxPrompts 0 disables');
    t.ok(!Q(null, NOW, null, null), 'garbage input → no');
  });

  PK.test('survey: config helpers accept only https links; prefs work without localStorage', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here'); return; }
    var ok = PK.app.surveyUrlOk;
    t.ok(ok('https://docs.google.com/forms/d/e/abc/viewform'), 'Google Form link');
    t.ok(!ok(''), 'empty'); t.ok(!ok('http://x.org'), 'http'); t.ok(!ok('https://x.org/" onclick="x'), 'quote injection'); t.ok(!ok(null), 'null');
    var saved = PK.config.survey;
    PK.config.survey = { url: '', signupUrl: 'https://x.org/s', promptAfter: ['fit'], maxPrompts: 2, minMinutesBetween: 1 };
    t.eq(PK.app.surveyCfg().url, '', 'empty url stays empty (all survey UI hidden)');
    PK.config.survey = { url: 'https://x.org/survey', signupUrl: 'mailto:a@b', promptAfter: ['fit'] };
    t.eq(PK.app.surveyCfg().signupUrl, '', 'non-https signup link dropped');
    t.eq(PK.app.surveyCfg().maxPrompts, 2, 'default maxPrompts');
    PK.config.survey = saved;
    var st = PK.app.surveyState(); t.ok(st.prompts >= 0 && st.prompts === Math.floor(st.prompts), 'prompt count is a whole number (0 without storage)');
    if (typeof localStorage === 'undefined') t.eq(PK.app.prefs().singleKeys, true, 'single-key shortcuts on by default');
    var was = PK.app.prefs().singleKeys;
    PK.app.setPref('singleKeys', false); t.eq(PK.app.prefs().singleKeys, false, 'pref kept (in memory when storage is unavailable)');
    PK.app.setPref('singleKeys', was);
  });

  PK.test('contact: contactEmail comes from PK.config only and must look like an address', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here'); return; }
    var saved = PK.config.contactEmail;
    PK.config.contactEmail = 'peaklyfeedback@gmail.com'; t.eq(PK.app.contactEmail(), 'peaklyfeedback@gmail.com', 'configured address');
    PK.config.contactEmail = 'x" onclick="y@z.com'; t.eq(PK.app.contactEmail(), '', 'markup rejected');
    PK.config.contactEmail = '1+a@users.noreply.github.com'; t.eq(PK.app.contactEmail(), '', 'noreply addresses are not shown');
    PK.config.contactEmail = ''; t.eq(PK.app.contactEmail(), '', 'empty → no contact link');
    PK.config.contactEmail = saved;
  });

  PK.test('a11y: plot text summary names traces, peak count, largest peak and range', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here'); return; }
    var S = PK.app.summarizeTraces;
    t.eq(S([]), 'No traces are shown.', 'empty');
    var s = S([{ name: 'Sample 254 nm', xUnit: 'min', yUnit: 'mAU', xMin: 0, xMax: 30, peaks: [{ rt: 2.5, areaPct: 10 }, { rt: 10.2412, areaPct: 39.5, label: 'Caffeine' }, { rt: 12, areaPct: 50.5 }] }]);
    t.ok(/^1 trace shown\. Sample 254 nm: 3 peaks, largest at 12 min \(50\.5 % area\); 0 to 30 min, signal in mAU\.$/.test(s), s);
    var s2 = S([{ name: 'A', xUnit: 'mL', peaks: [] }, { name: 'B', xUnit: 'min', peaks: [{ rt: 1, areaPct: 100, label: 'X' }] }]);
    t.ok(/^2 traces shown\. A: no peaks\. B: 1 peak, largest \(X\) at 1 min \(100 % area\)\.$/.test(s2), s2);
  });

  PK.test('a11y: keyboard bound editing (boundsFor, nudgeBound)', function (t) {
    if (!ensureApp()) { t.ok(true, 'app.js not loadable here'); return; }
    var x = []; for (var i = 0; i <= 100; i++) x.push(i * 0.1);
    var B = PK.app.boundsFor, N = PK.app.nudgeBound;
    t.eq(JSON.stringify(B(x, 5, 3)), JSON.stringify({ start: 3, end: 5 }), 'swapped bounds are sorted');
    t.eq(B(x, -4, 99).start, 0, 'clamped to data'); t.eq(B(x, -4, 99).end, 10, 'clamped to data (end)');
    t.eq(B(x, 2, 2.1), null, 'narrower than 2 samples → null');
    var pk = { start: 2, apex: 3, end: 4 };
    t.near(N(x, pk, 'start', -1).start, 1.9, 1e-9, 'start one point left'); t.near(N(x, pk, 'start', 1).start, 2.1, 1e-9, 'start one point right');
    t.near(N(x, pk, 'end', 1).end, 4.1, 1e-9, 'end one point right'); t.near(N(x, pk, 'end', -1).end, 3.9, 1e-9, 'end one point left');
    t.near(N(x, { start: 2.05, end: 4 }, 'start', -1).start, 2, 1e-9, 'between samples → nearest sample below');
    t.near(N(x, { start: 2.05, end: 4 }, 'start', 1).start, 2.1, 1e-9, 'between samples → nearest sample above');
    t.eq(N(x, { start: 3.8, end: 4 }, 'start', 1), null, 'cannot shrink below 2 samples');
    t.eq(N(x, { start: 0, end: 4 }, 'start', -1).start, 0, 'stays at the first point');
  });

  PK.test('wavelength: MOCCA2 source re-parsed at another wavelength / sum; trace keeps id, style, processing', function (t) {
    if (!ensureApp() || !PK.parsers || !PK.parsers.get('mocca2')) { t.ok(true, 'app/parsers not loadable here'); return; }
    var time = [0, 0.5, 1, 1.5, 2, 2.5, 3], rows = [[0, 1, 2, 3, 2, 1, 0], [0, 2, 8, 20, 8, 2, 0], [0, 1, 3, 5, 3, 1, 0]];
    var txt = JSON.stringify({ __classname__: 'Data2D', time: time, wavelength: [220, 254, 280], data: rows });
    var r0 = PK.parsers.parseText(txt, { filename: 'run.json' });
    t.ok(r0.ok, r0.error); var tr0 = r0.traces[0];
    t.eq(JSON.stringify(tr0.meta.wavelengths), '[220,254,280]', 'parser lists the wavelengths'); t.eq(tr0.y[3], 20, 'default 254 nm');
    var r = PK.app.reparseWavelength(txt, 'run.json', 0, 280);
    t.eq(r.trace.y[3], 5, '280 nm channel'); t.eq(r.trace.meta.mocca.selected, 280, 'selected recorded');
    var rs = PK.app.reparseWavelength(txt, 'run.json', 0, 'sum');
    t.eq(rs.trace.y[3], 28, 'sum over wavelengths');
    var t0 = PK.app.normalizeTrace(tr0, null); t0.meta._src = 'src_1'; t0.meta._srcIdx = 0; t0.style.color = '#123456'; t0.proc.smooth.window = 7;
    var id = t0.id, name0 = t0.name;
    PK.app.applyWavelengthData(t0, r.trace);
    t.eq(t0.id, id, 'id kept'); t.eq(t0.style.color, '#123456', 'colour kept'); t.eq(t0.proc.smooth.window, 7, 'processing kept');
    t.eq(t0.meta._src, 'src_1', 'source link kept for the next change'); t.eq(t0.y[3], 5, 'data replaced');
    t.ok(/ 254 nm$/.test(name0) && / 280 nm$/.test(t0.name), 'name suffix follows the wavelength: ' + name0 + ' → ' + t0.name);
    t.throws(function () { PK.app.reparseWavelength('not json at all', 'x.txt', 0, 254); }, 'unreadable source throws');
  });

  PK.test('core: decodeXmlEntities (predefined, numeric, unknown, invalid)', function (t) {
    var D = PK.util.decodeXmlEntities;
    t.eq(D('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), 'a & b <c> "d" \'e\'', 'predefined entities');
    t.eq(D('&#955; &#x3bb; &#X3BB;'), 'λ λ λ', 'decimal and hex references');
    t.eq(D('&#x1F600;'), '😀', 'astral code point');
    t.eq(D('&nbsp; &bogus;'), '&nbsp; &bogus;', 'unknown named entities left alone');
    t.eq(D('&#0; &#xD800; &#x110000;'), '� � �', 'invalid code points → U+FFFD');
    t.eq(D('&amp;lt;'), '&lt;', 'decoded once (no double decoding)');
    t.eq(D(null), '', 'null'); t.eq(D('plain'), 'plain', 'no entities');
    t.eq(PK.util.escapeHtml(D('&lt;img src=x onerror=alert(1)&gt;')), '&lt;img src=x onerror=alert(1)&gt;', 'decoded markup is escaped again for display');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
