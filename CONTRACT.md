# Peakly module contract (READ FULLY before coding)

App name is **Peakly**. Never use the name "OpenChrom" in UI/code (separate existing project). Namespace global is `PK`.
Licensing rule: DO NOT copy code from EPL/GPL/LGPL/AGPL projects (ChemClipse, chromConverter, rainbow, WebPlotDigitizer).
Write all code yourself from published algorithms/format descriptions. See PRIOR_ART.md.

Single-file client-side HPLC/FPLC chromatogram analyzer. Source lives in `openchrom/src/`,
`node build.js` inlines everything into `openchrom/index.html`. No backend, no telemetry,
no network except pinned CDN libs and the optional user-initiated Claude vision call.

## Module pattern (mandatory)
Every src file is a plain script (NO import/export, NO modules), wrapped like:
```js
(function (PK) {
  'use strict';
  PK.analysis = PK.analysis || {};
  // ...
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
```
- Pure math/parsing must not touch `document`/`window` at load time, so Node tests can load it.
- DOM code only inside functions called at runtime (guard with `typeof document !== 'undefined'`).
- Load order: config.js, core.js, services.js, testkit.js, schema.js, parsers/registry.js, parsers/*.js (sorted, skipping _*), analysis.js, digitizer.js, app.js.
- Never use backticks containing `</script>` (file gets inlined into a <script> tag). Write `<\/script>` if needed.

## CDN globals available in browser (may be absent in Node — guard)
`Plotly` (plotly.js-dist-min 2.35.2), `XLSX` (SheetJS 0.18.5), `pako` (2.1.0),
`LZString` (1.5.0), `jspdf.jsPDF` (2.5.1), `pdfjsLib` (3.11.174; worker URL
`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`).

## core.js (provided — use it)
- `PK.uid(prefix)` → unique id string
- `PK.bus.on(evt, fn)`, `PK.bus.off(evt, fn)`, `PK.bus.emit(evt, payload)`
- `PK.util.linspace(a,b,n)`, `PK.util.interp1(xs, ys, x)` (linear, xs ascending, clamps ends),
  `PK.util.resample(x, y, xNew)` → array, `PK.util.clamp(v,a,b)`, `PK.util.median(arr)`,
  `PK.util.fmt(v, digits)` (smart number format, '—' for null/NaN), `PK.util.escapeHtml(s)`,
  `PK.util.downloadBlob(blob, filename)`, `PK.util.downloadText(text, filename, mime)`,
  `PK.util.readFileAs(file, 'text'|'arraybuffer'|'dataurl')` → Promise
- `PK.palette` → array of 10 trace colors
- `PK.toast(msg, kind)` kind ∈ 'info'|'warn'|'error'|'ok' (no-op in Node)

## testkit.js (provided)
Tests live in `tests/<module>.test.js`, use the same IIFE wrapper, and register with:
```js
PK.test('analysis: SG preserves polynomial', function (t) { t.ok(cond, msg); t.near(a, b, tol, msg); t.eq(a, b, msg); });
```
`t.throws(fn, msg)` also exists. Tests may be async (return a Promise).
Run all: `node tests/run.js`. The same tests are inlined into index.html and runnable from the
in-app "Self-test" button. Tests must be pure (no DOM), deterministic, and fast (<1s each).

## Canonical data model
```js
Trace = {
  id: 'tr_xxx', name: 'Sample 254 nm',
  x: number[],            // ALWAYS minutes, ascending
  y: number[],            // ALWAYS in yUnit (keep native unit; 'mAU' preferred)
  xUnit: 'min', yUnit: 'mAU'|'AU'|'counts'|'mS/cm'|'%'|'a.u.'|string,
  source: { kind: 'file'|'image'|'paste'|'sample', filename?: string, format?: string },
  digitized: false | {    // present (object) ONLY for image-derived traces
    dxMin: number,         // +/- minutes per pixel (half pixel width in data units)
    dy: number,            // +/- y units per pixel
    imageId: string,       // key into project.images
    printedPeaks?: [{ rt:number, areaPct?:number, label?:string }], // read from image
    warnings: string[]
  },
  meta: { wavelength?, instrument?, sampleName?, channel?, ...anything parsed },
  style: { color: '#hex', visible: true, width: 1.5 },
  // analysis state is owned by app and stored on the trace:
  proc: { smooth:{on,window,order}, baseline:{on,lambda,p,iter}, peaks:{threshold,minDist,minWidth,auto:true} },
  peaks: Peak[]            // manual edits persist here
}
Peak = { id, start:number, apex:number, end:number, manual?:bool }  // all in minutes
Method = {
  name, gradient: [{ t:min, B:% , flow:mL/min }],  // segments linear between rows; a step = two rows at same t
  mode: 'linear'|'step',            // interpretation default; same-t rows always step
  solventA, solventB, bufferPH, gradientType: 'organic'|'salt'|'imidazole'|'isocratic',
  bMaxConc?: number, bConcUnit?: 'mM'|'M'|'%',  // for salt/imidazole: 100%B = bMaxConc
  column: { length_mm, id_mm, particle_um, porosity: 0.65 },
  flow: mL/min, dwellVolume_mL, wavelength_nm, temperature_C, notes,
  voidTime_min?: number (user override)
}
Project = { version:1, name, traces:Trace[], method:Method, images:{ [imageId]: dataURL },
            settings:{ normalization:'none'|'max'|'area', alignRef?:traceId, theme, showGradient:true,
                       differenceOf?:[idA,idB] }, activeTraceId }
```

## app.js exposes (Agent D implements; others call these)
- `PK.app.addTraces(traces, {select:true})` → adds Trace(s) (fills id/style/proc defaults), records undo, rerenders
- `PK.app.getProject()`, `PK.app.setProject(p)`
- `PK.app.addImage(dataURL)` → imageId (stores into project.images)
- `PK.app.openPanel(name)` name ∈ 'import'|'digitizer'|'method'|'export'|'help'
- `PK.app.pushUndo(label)` / `PK.app.undo()` / `PK.app.redo()`
- DOM mount points in the shell (Agent D creates): `#digitizer-root` (full-screen modal body
  for the digitizer UI), `#import-fallback-root` (modal for raw-text column mapping),
  `#selftest-root`.

## parsers.js (Agent A)
PLUGGABLE registry — every format is a plugin:
```js
PK.parsers.register({
  id: 'jcamp', name: 'JCAMP-DX', extensions: ['jdx','dx','jcamp'],
  binary: false,                         // true → receives ArrayBuffer, else text
  sniff: function (head, filename) { return 0..1 confidence },  // head = first ~4KB as text (latin1 for binary)
  parse: function (input, {filename}) { return ParseResult }    // may return a Promise
});
PK.parsers.list()  // registered plugins (for Help/"supported formats" UI)
```
Dispatcher picks highest sniff score (extension match adds weight); falls back to generic delimited.
Required plugins: generic delimited (CSV/TSV/semicolon/space, decimal comma, header optional, unit detection from
header e.g. 'Time (min)', 'mAU', 'sec'), JSON (array of {x,y}/[x,y], {x:[],y:[]}, {traces:[...]}, Peakly project
detection → ParseResult.project), xlsx (SheetJS; first numeric sheet, else needsMapping), JCAMP-DX (AFFN + (X++(Y..Y))
compressed SQZ/DIF/DUP forms, XUNITS/YUNITS), AnDI/netCDF-3 classic reader written from scratch (CDF1/CDF2;
ordered_derivative_values / actual_sampling_interval / actual_run_time_length / detector_unit), mzML (TIC/BPC and
UV chromatograms in <chromatogramList>, base64 + zlib via pako, 32/64-bit floats), Agilent ChemStation binary .ch
(types 130/131 delta-encoded, and 179/181 double-delta or doubles — spec in
/private/tmp/claude-501/-Users-williamhartwig-JenAI-twinsteps/cc65027e-707b-4ceb-a41a-758e5cfbdbb4/scratchpad/refs/*.rst — rainbow
docs, LGPL: read the prose spec only, do not port its code), vendor text: Agilent ChemStation/OpenLab CSV & .txt export
(incl. UTF-16LE), Thermo Chromeleon ASCII export (header block + 'Chromatogram Data:' table), Shimadzu LabSolutions
ASCII ([Chromatogram (Ch1)] section, 'Multiplier'), Waters Empower .arw (quoted header lines then 2-col data),
Cytiva UNICORN CSV/ASC (multi-curve header row pairs: 'ml','mAU','ml','mS/cm',... — x is VOLUME mL; convert to
min only if flow known, else keep xUnit:'mL' and set meta.xIsVolume=true; app treats x generically),
Bio-Rad ChromLab/NGC CSV export (multi-column, time/volume + UV/conductivity/%B). Detect UTF-16 BOM everywhere.
NOTE: x is minutes except UNICORN-volume case (xUnit 'mL'). %B / conductivity columns from FPLC exports become
separate traces with yUnit '%' / 'mS/cm' and meta.role='gradient'|'conductivity' (app can show them on y2).
- `PK.parsers.parseFile(file)` → Promise<ParseResult> (browser File/Blob; detects by extension + sniffing content)
- `PK.parsers.parseText(text, {filename})` → ParseResult (sync)
- `PK.parsers.parseArrayBuffer(buf, {filename})` → Promise<ParseResult> (xlsx, netCDF, mzML w/ binary)
- `PK.parsers.parseDelimited(text, opts)` → { header:string[]|null, rows:number[][], delimiter, skipped:int, preamble:string[] }
- `PK.parsers.buildTraces(table, mapping)` mapping = { xCol, yCols:[int], xUnit:'min'|'sec'|'ms'|'h', yUnit, yScale?:1 } → Trace[] (converts x to minutes, sorts ascending, drops NaN)
- `PK.parsers.isImage(file)` → bool (png/jpg/jpeg/webp/gif/bmp/pdf) — app routes those to the digitizer
ParseResult = { ok:bool, traces:Trace-partials[], format:string, warnings:string[], error?:string,
                needsMapping?:bool, table?:{header,rows,...}, rawText?:string }
When confidence is low → ok:false, needsMapping:true, table + rawText so the app shows the fallback mapper.
Trace-partials need only: name, x, y, xUnit:'min', yUnit, source, meta.

## analysis.js (Agent B) — pure functions, arrays in/out, all x in minutes
- `PK.analysis.savitzkyGolay(y, window, order, deriv=0)`
- `PK.analysis.alsBaseline(y, {lambda=1e5, p=0.01, iter=10})` → baseline array (banded/sparse solve, O(n))
- `PK.analysis.process(trace)` → { x, y, yRaw, baseline } applying trace.proc (smooth then baseline subtract)
- `PK.analysis.noise(x, y)` → { sigma, method } (robust MAD of first difference or quietest window)
- `PK.analysis.detectPeaks(x, y, {threshold (in y units or 'auto'), minDist, minWidth})` → Peak[]
- `PK.analysis.peakMetrics(x, y, peaks, {voidTime, noise})` → Metric[] aligned with peaks:
  { id, rt, height, area, areaPct, fwhm, w5, tailing, asymmetry, plates, platesUSP, resolution, sn,
    formulas: { area:{expr:'∑ trapezoid(y−baseline)·Δx', inputs:{...}, value}, ... for each metric } }
  Area by trapezoid between start/end with straight-line drop baseline between bound points
  (valley-to-valley); tailing USP T=W0.05/(2f); plates N=5.54(tR/W½)²; Rs=1.18(tR2−tR1)/(W½1+W½2);
  S/N = 2H/h_noise (EP/USP) where h_noise = peak-to-peak ≈ 6σ — document which.
- `PK.analysis.refineBounds(x,y,peak)` → snap to valleys; `PK.analysis.peakAt(x,y,t,{window})` → manual add peak near t
- `PK.analysis.gradientAt(method, t)` → { B, flow } at column-outlet-relative time (handles steps, linear,
  isocratic, holds before first/after last row)
- `PK.analysis.dwellTime(method)` = dwellVolume/flow; `PK.analysis.voidTime(method)` = override or
  0.65·π·(id/2)²·L / flow (mm→mL conversion documented); `PK.analysis.gradientCurve(method, tMax, n)` →
  {t[], B[], conc?[]} shifted by dwell time (what the detector "sees", ignoring void time—document)
- `PK.analysis.Bat(method, rt)` → %B at elution = gradientAt(method, rt − dwell − void)  (document model)
- `PK.analysis.normalize(trace xy, mode, {range})`, `PK.analysis.align(x, shift)`,
  `PK.analysis.difference(traceA, traceB)` → resample B onto A's x and subtract
- FITTING (inspired by chromatoPy (MIT) ideas; own implementation):
  `PK.analysis.fitPeaks(x, y, peaks, {model:'gaussian'|'emg', maxIter:200})` → { components:[{id, model, params:{A,mu,sigma,tau?},
  area, areaSE, rt (apex of fitted curve), fwhm}], curve:{x[],yFit[],perComponent:[[...]]}, rss, r2, dof, converged, cov }
  Levenberg–Marquardt with numeric/analytic Jacobian; fits all given peaks jointly over the union window (handles overlap).
  areaSE from covariance s²·(JᵀJ)⁻¹ propagated through area = A·σ·√(2π) (Gaussian; EMG area=A·σ·√(2π) with A the
  Gaussian-amplitude parameterization — document). EMG via numerically stable erfcx formulation.
- `PK.analysis.FORMULAS` → human-readable descriptions used by README & tooltips

## digitizer.js (Agent C)
- UI: `PK.digitizer.open({file?|dataURL?|blob?})` renders into `#digitizer-root`, and on "Send to plot"
  calls `PK.app.addTraces([...])` with digitized traces (source.kind='image', digitized{...}),
  storing the image via `PK.app.addImage(dataURL)`.
- Pure functions (testable in Node with fake ImageData {width,height,data:Uint8ClampedArray}):
  `PK.digitizer.calibrate({x1:{px,val},x2:{px,val},y1:{px,val},y2:{px,val},xLog,yLog})` → {toData(px,py)→[x,y], toPixel(x,y)→[px,py], dxPerPx, dyPerPx}
  `PK.digitizer.colorMask(img, rgb, tol, {exclude rects})` → Uint8Array mask
  `PK.digitizer.removeLines(mask, w, h, {minRun})` → remove long horizontal/vertical runs (grid/axes)
  `PK.digitizer.extractTrace(mask, w, h, {mode:'centroid'|'top', xRange:[px0,px1]})` → per-column py (NaN gaps)
  `PK.digitizer.fillGaps(arr, maxGap)`, `PK.digitizer.homography(src4, dst4)` → 3x3, `PK.digitizer.warp(img, H, w, h)`
  `PK.digitizer.makeSampleImage()` → { canvas (browser only) or ImageData-like, truth:{x[],y[]}, printedPeaks, axes }
  `PK.digitizer.qualityWarnings(img, meta)` → string[] (low-res, JPEG blockiness)
  `PK.digitizer.comparePrinted(computedPeaks, printedPeaks, tol)` → [{rt, printed, computed, mismatch:bool}]
- Claude vision assist: `PK.digitizer.askClaude(apiKey, dataURL, model)` → Promise<{xAxis:{label,unit,ticks:[{value,approxPxFrac}]}, yAxis..., title, peaks:[{rt,areaPct,label}]}>
  POST https://api.anthropic.com/v1/messages with headers
  `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`,
  `content-type: application/json`; body `{model, max_tokens:2000, messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type,data}},{type:'text',text:PROMPT}]}]}`.
  Models dropdown: 'claude-sonnet-5-5' (default), 'claude-opus-5-5', 'claude-haiku-4-5-20251001'.
  Key held only in a JS variable (never localStorage). Results only PRE-FILL; user must confirm.

## Styling (shared)
CSS custom properties defined by Agent D on :root (light) and [data-theme="dark"]:
`--bg --panel --panel-2 --text --muted --border --accent --accent-2 --warn --error --ok --radius`
Buttons: `<button class="btn">`, `.btn.primary`, `.btn.ghost`, `.btn.sm`; inputs inherit. Modal content
goes inside the given root; use class `.pk-modal-body`. Digitized data badge: `<span class="badge digitized">digitized</span>`.
Keep module CSS in a JS string injected once via `PK.injectCSS(id, cssText)` (provided by core.js).

## Added user features (round 2)
- Curve-tracing cursor snapped to the active trace (readout: t, y, %B, ± for digitized); optional readout for all visible traces.
- Click-to-integrate mode: click start → click end on the curve → manual peak (exact bounds), RT/area/metrics, undoable.
  `PK.analysis.integrateWindow(x, y, start, end)` → Peak{manual:true}; `detectPeaks(..., {keep})` preserves manual peaks.
- Compare view: cross-trace peak matching (`PK.app.matchPeaks(traces, tol)`), ΔRT / area ratio vs reference,
  "apply same window to all traces", waterfall offset, CSV + PDF export.

## Added user features (round 3)
- Peak labels on plot (peak.label, user-editable; display name/RT/name+RT/area%/none), carried into tables & exports.
- Plot style: white plot background, black axes/ticks/labels, light gray grid; primary trace blue #1f4fd8; overlay palette
  #1f4fd8 #d62728 #2ca02c #ff7f0e #9467bd #8c564b #e377c2 #7f7f7f #bcbd22 #17becf; gradient dashed dark gray.
- Overlays default on shared axes with legend; mix of file/paste/image traces.
- Run info: trace.meta.run {sampleName, sampleId, injVol_uL, conc, instrument, column, methodName, operator, date,
  detector, notes}; plot caption + PDF header from method + run info; project.name as plot title.

## Round 4 (v1.1): sustainability, clipping, calibration — READ before coding
Author: Jennifer Schmitt, Ph.D. (LinkedIn https://www.linkedin.com/in/jschmitt1531/). License MIT. Use they/them or the name, no gendered pronouns.
Disclaimer (must appear in About, README, PDF footer): "For research and education use. Not validated for regulated
(GMP/GLP) workflows. Digitized data is approximate."

### src/config.js (integrator writes) → PK.config
{ appName, version:'1.1.0', author:{ name, credentials, headline, bio[], linkedin }, repoUrl, discussionsUrl, citation:{...},
  services:{ cloudSave:false, teamSharing:false, accounts:false } }

### src/services.js (integrator writes) → PK.services
register({id, name, capabilities:['save','load','share','auth'], enabled:false, ...hooks}); list(); get(id); isEnabled(id).
Core never requires a service; UI only shows service buttons for enabled services (none by default).

### src/schema.js (Agent B owns) → PK.schema
PROJECT_VERSION = 2; migrate(obj) → upgraded project (v1 → v2 adds trace.peaks[].clip, project.calibration, project.schema);
validateProject(obj) → {ok, errors[]}; peakTableRows(project) / traceRows(project) → documented plain objects used for CSV/JSON export.
Documented in docs/SCHEMA.md + docs/schemas/*.json (Agent D writes docs from Agent B's code).

### Peak clipping (Agent A math in analysis.js; Agent B UI)
Peak.clip ∈ 'drop' (perpendicular drop to a common baseline across the cluster) | 'valley' (valley-to-valley, each peak's own baseline
between its bounds — the current behaviour) | 'baseline' (single straight baseline from cluster start to cluster end, drops at valleys)
| 'skim-tangent' (rider peak skimmed with a tangent line off the parent's tail/front) | 'skim-exp' (exponential skim fitted to the parent
tail) | 'fit' (Gaussian/EMG deconvolution split, uses fitPeaks; area = component area).
- `PK.analysis.clusters(x, y, peaks)` → [[peakIdx...]] groups of fused peaks (bounds touching / valley above baseline by > X% of the smaller height).
- `PK.analysis.integrate(x, y, peaks, {clip default, skimRatio:10 (Dyson rule: skim when parent/child height ≥ ratio), model})`
  → per peak { id, clip (as applied), area, baseline:{kind, points:[[t,y]...] or fn samples for skim curve}, segments for shading,
  math:{ method, formula, steps:[{label, expr, value}], n, dt, tStart, tEnd, yStart, yEnd, baselineArea, grossArea, netArea } }.
  peakMetrics must use these baselines (heights relative to the applied baseline).
- `PK.analysis.clipOptions(x, y, peaks, clusterIdx)` → preview of every applicable clip mode for one cluster (areas per peak + baseline
  polylines) — used by the UI "How should these peaks be split?" dialog.
- Default for auto-integration: project.settings.clipDefault (default 'drop'); per-peak override peak.clip; manual window integrations
  default 'valley' (straight line between the clicked points).

### Calibration curve (Agent A math; Agent B UI) → project.calibration
{ analytes:[{ id, name, peakMatch:{ rt, tol } , response:'area'|'height', model:'linear'|'linear0'|'quadratic', weighting:'none'|'1/x'|'1/x2',
  levels:[{ conc, unit, traceId?|response?, include:true }] }], unit }
- `PK.analysis.calibrationFit(points [{x:conc, y:response, w?}], {model, weighting})` → { coef[], se[], cov, r2, adjR2, syx, n, dof,
  residuals[], predict(x), inverse(y) → {x, se, lo, hi} (inverse prediction with SE via delta method / standard inverse-regression
  formula, 95% t-interval), lod: 3.3·syx/slope, loq: 10·syx/slope, formulas:{...auditable} }.
- Unknowns: concentration = inverse(response) shown in peak table column "Conc." with ± and an ⓘ audit; flag extrapolation outside
  the calibrated range; flag when response is below LOQ.
