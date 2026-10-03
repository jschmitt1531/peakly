/* SPDX-License-Identifier: MIT */
/* Peakly parser plugin "shimadzu": Shimadzu LabSolutions ASCII export.
   Format: INI-like [Section] blocks: [Header], [File Information], [Sample Information], [LC Chromatogram(Detector A-Ch1)]
     with "Interval(msec)", "# of Points", "Intensity Units", "Intensity Multiplier", "Wavelength(nm)" then an
     "R.Time (min)<TAB>Intensity" table. [Peak Table(...)] / [Compound Results] sections are ignored.
   Sniff: [Header] plus LabSolutions/Chromatogram/[File Information] -> 0.95; any [... Chromatogram ...] section -> 0.8.
   Variants: several detector channels -> one trace per section; GC and PDA chromatogram sections.
   Format knowledge: LabSolutions "Data > ASCII Output" documentation and example exports.
   Sample: samples/data/shimadzu.txt */
(function (PK) {
  'use strict';
  var P = PK.parsers;
  var H = P._h;
  var baseName = H.baseName, assign = H.assign, splitLines = H.splitLines, parseNum = H.parseNum, normYUnit = H.normYUnit, wavelengthOf = H.wavelengthOf, kvMeta = H.kvMeta, deriveMeta = H.deriveMeta, autoMap = H.autoMap, fail = H.fail, okRes = H.okRes;

  P.register({
    id: 'shimadzu', order: 110, name: 'Shimadzu LabSolutions ASCII', extensions: ['txt', 'csv'], binary: false,
    sniff: function (head) { return /^\s*\[Header\]/m.test(head) && /LabSolutions|Chromatogram|\[File Information\]/i.test(head) ? 0.95 : (/^\s*\[(LC |PDA |GC )?.*Chromatogram.*\]/im.test(head) ? 0.8 : 0); },
    parse: function (text, opts) {
      opts = opts || {};
      var lines = splitLines(text), secs = [], cur = null, w = [];
      lines.forEach(function (l) { var m = /^\s*\[(.+)\]\s*$/.exec(l); if (m) { cur = { name: m[1], lines: [] }; secs.push(cur); } else if (cur) cur.lines.push(l); });
      var header = {}; secs.forEach(function (s) { if (/^(header|file information|sample information|original files)$/i.test(s.name)) kvMeta(s.lines, header); });
      var base = deriveMeta(header), traces = [];
      secs.forEach(function (s) {
        if (!/chromatogram/i.test(s.name) || /peak|compound|3d|spectrum/i.test(s.name)) return;
        var t = P.parseDelimited(s.lines.join('\n'));
        if (!t.rows.length) return;
        var kv = kvMeta(t.preamble), mult = NaN;
        Object.keys(kv).forEach(function (k) { if (/multiplier/i.test(k)) mult = parseNum(kv[k], t.decimalComma) || parseNum(kv[k], false); });
        if (!isFinite(mult) || mult === 0) mult = 1;
        var yuk = Object.keys(kv).filter(function (k) { return /intensity\s*units?|^units?$/i.test(k); })[0];
        var m = autoMap(t, { xUnit: 'min', xUnitTrusted: true, yUnit: normYUnit(kv[yuk]) || kv[yuk] || 'mV', quietY: true });
        if (!m.ok || m.pairs) { w.push('Section [' + s.name + ']: ' + (m.reason || 'unexpected layout') + ' — skipped.'); return; }
        m.yUnits = m.yUnits.map(function () { return normYUnit(kv[yuk]) || kv[yuk] || 'mV'; });
        var meta = assign({}, base, { section: s.name, sectionHeader: kv, multiplier: mult });
        var wl = parseFloat(kv['Wavelength(nm)'] || kv['Wavelength (nm)']) || wavelengthOf(s.name + ' ' + (kv['Detector Name'] || '')); if (wl) meta.wavelength = wl;
        var ch = /\(([^)]*)\)/.exec(s.name); meta.channel = ch ? ch[1] : s.name;
        P.buildTraces(t, assign({}, m, { yScale: mult, meta: meta, names: [(base.sampleName || baseName(opts.filename) || 'Shimadzu') + ' ' + meta.channel] })).forEach(function (tr) { traces.push(tr); });
      });
      if (!traces.length) return fail('Shimadzu LabSolutions ASCII', 'No [... Chromatogram ...] section with data was found. In LabSolutions, export with "Chromatogram" ticked in the ASCII output options.' + (w.length ? ' ' + w.join(' ') : ''));
      return okRes('Shimadzu LabSolutions ASCII', traces, w);
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
