/* SPDX-License-Identifier: MIT */
/* Tests for src/parsers/mocca2.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  // Synthetic MOCCA2 Chromatogram: 3 wavelengths, one deconvolved peak with 2 components and one plain peak.
  function chrom(opts) {
    opts = opts || {};
    var t = [], wl = opts.wl || [230, 254, 280], data = wl.map(function () { return []; });
    for (var i = 0; i < 100; i++) {
      t.push(i * 0.05);
      wl.forEach(function (w, k) { data[k].push((k + 1) * Math.exp(-Math.pow((i * 0.05 - 2) / 0.1, 2) / 2) + (w === 280 ? 4 * Math.exp(-Math.pow((i * 0.05 - 4) / 0.1, 2) / 2) : 0)); });
    }
    var c = { time: t, wavelength: wl, data: opts.transpose ? t.map(function (_, i) { return data.map(function (r) { return r[i]; }); }) : data,
      peaks: [
        { left: 30, right: 50, maximum: 40, height: 2, prominence: 2, all_maxima: [40], residual_mse: 1e-6, r2: 0.999, resolved: true, __classname__: 'DeconvolvedPeak',
          components: [{ concentration: [1, 2, 1], spectrum: [1, 2, 3].slice(0, wl.length), compound_id: 7, elution_time: 39, integral: 4, peak_fraction: 0.7, __classname__: 'Component' },
                       { concentration: [1, 1], spectrum: [0.5, 0.5, 0.5].slice(0, wl.length), compound_id: null, elution_time: 42, integral: 2, peak_fraction: 0.3, __classname__: 'Component' }] },
        { left: 75, right: 85, maximum: 80, height: 4, prominence: 4, all_maxima: [80], __classname__: 'Peak' }],
      sample_path: 'C:/data/run7.D', blank_path: null, name: null, __classname__: 'Chromatogram' };
    return c;
  }

  PK.test('parsers/mocca2: Chromatogram → 254 nm trace + deconvolved/plain peaks', function (t) {
    var r = P.parseText(JSON.stringify(chrom()), { filename: 'run7.json' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'mocca2'); var tr = r.traces[0];
    t.eq(tr.meta.wavelength, 254, '254 nm preferred'); t.eq(tr.name, 'run7 254 nm'); t.eq(tr.yUnit, 'AU'); t.eq(tr.meta.wavelengths.join(','), '230,254,280');
    t.near(tr.y[40], 2, 1e-9, 'row 2 of data'); t.eq(tr.peaks.length, 3);
    var p0 = tr.peaks[0]; t.near(p0.apex, 1.95, 1e-9, 'component elution_time index'); t.near(p0.start, 1.5, 1e-9); t.near(p0.end, 2.5, 1e-9);
    t.eq(p0.label, 'Compound 7'); t.near(p0.area, 4 * 2 * 0.05, 1e-9, 'integral · spectrum[254] · Δt'); t.eq(p0.r2, 0.999);
    t.ok(!('label' in tr.peaks[1]), 'unassigned component has no label'); t.near(tr.peaks[1].area, 2 * 0.5 * 0.05, 1e-9);
    var p2 = tr.peaks[2]; t.near(p2.apex, 4, 1e-9); t.ok(p2.area > 0 && p2.area < 0.01, 'plain peak: trapezoid of the 254 nm trace (tiny there)');
    t.ok(r.warnings.some(function (w) { return /3 wavelengths/.test(w); }), 'channel choice explained');
  });

  PK.test('parsers/mocca2: max-absorbance default, opts.wavelength, sum, transposed data, dataset compounds', function (t) {
    var noUv = chrom({ wl: [220, 240, 280] }), r = P.parseText(JSON.stringify(noUv), { filename: 'a.json' });
    t.ok(r.ok, r.error); t.eq(r.traces[0].meta.wavelength, 280, 'max absorbance when 254 absent');
    var w = P.parseText(JSON.stringify(chrom()), { filename: 'a.json', wavelength: 230 }); t.eq(w.traces[0].meta.wavelength, 230); t.near(w.traces[0].peaks[0].area, 4 * 1 * 0.05, 1e-9);
    var s = P.parseText(JSON.stringify(chrom()), { filename: 'a.json', wavelength: 'sum' }); t.ok(/sum of 3/.test(s.traces[0].name), s.traces[0].name); t.near(s.traces[0].y[40], 6, 1e-9);
    var tp = P.parseText(JSON.stringify(chrom({ transpose: true })), { filename: 'a.json' }); t.ok(tp.ok, tp.error); t.near(tp.traces[0].y[40], 2, 1e-9, 'transposed [time][wl]');
    var c = chrom(); c.name = 'inj 1';
    var ds = { chromatograms: { 3: c }, _raw_2d_data: {}, compounds: { 7: { name: 'Caffeine', elution_time: 39, spectrum: [1, 1, 1], __classname__: 'Compound' } }, settings: null, __classname__: 'MoccaDataset' };
    var d = P.parseText(JSON.stringify(ds), { filename: 'ds.json' });
    t.ok(d.ok, d.error); t.eq(d.traces[0].name, 'inj 1 254 nm'); t.eq(d.traces[0].peaks[0].label, 'Caffeine', 'compound name from dataset');
  });

  PK.test('parsers/mocca2: unknown shapes give an error listing what was found', function (t) {
    var r = P.parseText('{"__classname__": "Chromatogram", "time": [0, 1, 2], "spectra": [1, 2]}', { filename: 'x.json' });
    t.ok(!r.ok, 'not ok'); t.eq(r.plugin, 'mocca2'); t.ok(/time \(array\[3\]\)/.test(r.error) && /spectra/.test(r.error), r.error);
    var m = P.parseText('{"__classname__": "Data2D", "time": [0, 1, 2], "wavelength": [254, 260], "data": [[1, 2], [3, 4], [5, 6], [7, 8]]}', { filename: 'y.json' });
    t.ok(!m.ok && /4×2/.test(m.error), m.error);
  });

  PK.test('parsers/mocca2: sample file samples/data/mocca2.json (MoccaDataset)', function (t) {
    return F.withSample(t, 'mocca2.json', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'mocca2'); t.eq(r.traces.length, 1); var tr = r.traces[0];
      t.eq(tr.meta.wavelength, 254); t.eq(tr.x.length, 200); t.eq(tr.peaks.length, 3);
      t.eq(tr.peaks[0].label, 'Benzaldehyde'); t.eq(tr.peaks[1].label, 'Benzoic acid'); t.near(tr.peaks[0].apex, 1.5, 0.03); t.near(tr.peaks[2].apex, 3.0, 0.03);
      t.ok(tr.peaks.every(function (p) { return p.area > 0 && p.source === 'mocca2'; }), 'areas present');
      return F.withSample(t, 'mocca2.json', function (r2) {
        var b254 = tr.peaks[1].area, b262 = r2.traces[0].peaks[1].area;
        t.eq(r2.traces[0].meta.wavelength, 262); t.ok(b262 > b254, 'benzoic acid (λmax 262) larger at 262 nm');
      }, { wavelength: 262 });
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
