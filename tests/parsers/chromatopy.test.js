/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Tests for src/parsers/chromatopy.js — inline fixtures plus the samples/data file (sample read via fs in Node; skipped in the browser). */
(function (PK) {
  'use strict';
  var P = PK.parsers, F = PK.parserFixtures;

  function fid(extraPd, im) {
    var x = [], y = [];
    for (var i = 0; i <= 100; i++) { x.push(5 + i * 0.02); y.push(6 + 30 * Math.exp(-Math.pow((5 + i * 0.02 - 6.2) / 0.03, 2) / 2)); }
    var pd = { C16: { 'Peak Area - best fit': 2.2, 'Peak Area - median': 2.21, 'Peak Area - mean': 2.25, 'Peak Area - standard deviation': 0.05,
      'Peak Area - number of ensemble members': 10, 'Model Parameters': { name: 'single', x: [6.1, 6.2, 6.3], y: [1, 30, 1], params: [30, 6.2, 0.03], idx_interest: null, multi_flag: false },
      'Retention Time': 6.2 }, C18: '__NAN__' };
    for (var k in extraPd) pd[k] = extraPd[k];
    return JSON.stringify({ Samples: { 'Run 1': { Metadata: { Sample: 'Run 1', Detector: { Name: 'FID1', Unit: 'pA' } }, 'Raw Data': { 'Time (min)': x, 'Value (pA)': y }, 'Processed Data': pd } },
      'Integration Metadata': im || { 'peak dictionary': { C16: 6.2, C18: 7.4, C20: 8.0 }, 'x limits': [5, 7], time_column: 'Time (min)', signal_column: 'Value (pA)' } }, null, 2)
      .replace('"__NAN__"', '[\n NaN\n ]');
  }

  PK.test('parsers/chromatopy: FID_output.json → trace + imported peaks (mean ± SD), NaN tolerated', function (t) {
    var txt = fid({ C20: { 'Area Ensembles': [1, 1.2, 1.4], 'Model Parameters': { name: 'multi', params: [9, 7.7, 0.05, 12, 8.0, 0.04], idx_interest: 1, multi_flag: true } } });
    t.eq(P.rank(txt.slice(0, 4096), 'FID_output.json', false)[0].id, 'chromatopy', 'sniffed from the head');
    var r = P.parseText(txt, { filename: 'FID_output.json' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'chromatopy'); t.eq(r.traces.length, 1); var tr = r.traces[0];
    t.eq(tr.name, 'Run 1'); t.eq(tr.yUnit, 'pA'); t.eq(tr.xUnit, 'min'); t.eq(tr.x.length, 101); t.eq(tr.meta.header['Detector / Name'], 'FID1');
    t.eq(tr.peaks.length, 2, 'C18 ([NaN]) skipped'); t.ok(r.warnings.some(function (w) { return /not found/.test(w); }), 'missing peak warned');
    var c16 = tr.peaks[0]; t.eq(c16.label, 'C16'); t.eq(c16.apex, 6.2); t.eq(c16.start, 6.1); t.eq(c16.end, 6.3); t.eq(c16.area, 2.25); t.eq(c16.areaSE, 0.05);
    t.eq(c16.areaBestFit, 2.2); t.eq(c16.nEnsemble, 10); t.eq(c16.source, 'chromatopy'); t.eq(c16.model, 'single');
    var c20 = tr.peaks[1]; t.near(c20.area, 1.2, 1e-12, 'ensemble mean'); t.near(c20.areaSE, 0.2, 1e-12, 'ensemble SD (n-1)');
    t.eq(c20.apex, 8.0, 'multi-Gaussian component idx_interest=1'); t.near(c20.start, 8.0 - 0.12, 1e-12); t.near(c20.end, 8.12, 1e-12); t.eq(c20.nEnsemble, 3);
    t.ok(r.integrationMetadata && r.integrationMetadata.peakDictionary.C16 === 6.2, 'integration metadata kept');
  });

  PK.test('parsers/chromatopy: seconds time column, records Raw Data, delegation from the JSON plugin, clear errors', function (t) {
    var obj = { Samples: { S: { 'Raw Data': [{ 'Time (s)': 0, Signal: 1 }, { 'Time (s)': 30, Signal: 3 }, { 'Time (s)': 60, Signal: 2 }],
      'Processed Data': { A: { 'Peak Area - mean': 4, 'Retention Time': 30 } } } } };
    var r = P.parseText(JSON.stringify(obj), { filename: 'renamed.json', format: 'json' });
    t.ok(r.ok, r.error); t.eq(r.plugin, 'chromatopy', 'json plugin delegated'); var tr = r.traces[0];
    t.eq(tr.x.join(','), '0,0.5,1'); t.eq(tr.peaks[0].apex, 0.5, 'peak RT converted with the time column'); t.eq(tr.peaks[0].start, 0.5, 'no fit → zero-width bounds at apex');
    var bad = P.parseText('{"Samples": {"S": {"Metadata": {}}}, "Integration Metadata": {}}', { filename: 'FID_output.json' });
    t.ok(!bad.ok && /Raw Data/.test(bad.error), bad.error);
  });

  PK.test('parsers/chromatopy: hplc_to_csv layout (RT (min) + ion columns)', function (t) {
    var txt = 'RT (min),744,1302.5\n10.00,100,50\n10.05,150,55\n10.10,900,60\n10.15,120,52\n';
    t.eq(P.rank(txt, 'S1.csv', false)[0].id, 'chromatopy');
    var r = P.parseText(txt, { filename: 'S1.csv' });
    t.ok(r.ok, r.error); t.eq(r.traces.length, 2, 'header row not read as data'); t.eq(r.traces[0].x.length, 4);
    t.eq(r.traces[0].name, 'S1 m/z 744'); t.eq(r.traces[1].meta.mz, 1302.5); t.eq(r.traces[0].yUnit, 'counts'); t.eq(r.traces[0].y[2], 900);
  });

  PK.test('parsers/chromatopy: sample files chromatopy_FID_output.json and chromatopy_hplc.csv', function (t) {
    return F.withSample(t, 'chromatopy_FID_output.json', function (r) {
      t.ok(r.ok, r.error); t.eq(r.plugin, 'chromatopy'); t.eq(r.traces.length, 2); var a = r.traces[0], b = r.traces[1];
      t.eq(a.yUnit, 'pA'); t.eq(a.x.length, 361); t.eq(a.peaks.length, 3, 'C22 not found in sample 1'); t.eq(b.peaks.length, 4);
      t.eq(a.peaks.map(function (p) { return p.label; }).join(','), 'C16,C18,C20');
      t.near(a.peaks[0].apex, 6.2, 1e-9); t.ok(a.peaks[0].start < 6.2 && a.peaks[0].end > 6.2, 'bounds around apex');
      t.near(a.peaks[0].area, 2.005, 0.05); t.ok(a.peaks[0].areaSE > 0 && a.peaks[0].areaSE < 0.1, 'SD from ensemble');
      return F.withSample(t, 'chromatopy_hplc.csv', function (h) {
        t.ok(h.ok, h.error); t.eq(h.plugin, 'chromatopy'); t.eq(h.traces.length, 5); t.eq(h.traces[0].meta.mz, 744); t.eq(h.traces[0].x.length, 241);
        t.near(h.traces[0].x[F.argmax(h.traces[0].y)], 18, 0.2);
      });
    });
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
