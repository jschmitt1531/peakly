# Data schemas

This page documents the files Peakly reads and writes: the **project file** (format v2), the **peak table** (CSV/JSON), and **trace data** (CSV/JSON). It is written for people who script around Peakly: loading exports into Python/R, archiving projects, or building tools that interoperate with it.

The source of truth is [`src/schema.js`](../src/schema.js) (`PK.schema`). Machine-readable JSON Schemas (draft 2020-12) are in [`docs/schemas/`](schemas/):

| File | Describes |
|---|---|
| [`project.v2.schema.json`](schemas/project.v2.schema.json) | Saved project (`*.peakly.json`), format version 2 |
| [`peaks.schema.json`](schemas/peaks.schema.json) | Peak table export (array of peak rows) |
| [`traces.schema.json`](schemas/traces.schema.json) | Trace data exports (traces JSON, trace summary rows, long-format data rows) |
| [`calibration.schema.json`](schemas/calibration.schema.json) | Calibration levels export |

These files are generated from `PK.schema.describe()` by `node tools/gen-schemas.js`. If `src/schema.js` changes, regenerate them and review the diff. The `$id` URLs use the project website (`https://jschmitt1531.github.io/peakly/schemas/…`), which serves this folder.

> **Status (1.1.0).** Saved projects, share links and all CSV/JSON exports are produced through `PK.schema`, so the tables below describe what the app writes.

## Conventions

- **Time is minutes.** `x` is always minutes, except FPLC volume axes, where `xUnit` is `mL` (or `CV`, column volumes) and `meta.xIsVolume` is true. Column units in exports say which.
- **Intensity keeps its native unit** (`mAU`, `AU`, `counts`, `mS/cm`, `%`, …), given by `yUnit`.
- **Areas are y-unit × x-unit**, e.g. mAU·min. Multiply by 60 for mAU·s (what ChemStation reports).
- **Digitized data is flagged** everywhere: `digitized: true` (rows) or an object with pixel-size uncertainties `dxMin` (± x per pixel) and `dy` (± y per pixel) on traces.
- **Unknown values** are `null` in JSON and empty cells in CSV. Numbers are written with up to 10 significant digits.
- **Column keys never change between schema versions.** New columns are only appended; scripts should select columns by name, not position.
- **CSV files start with `# ` comment lines**: exporter, trace, processing settings, formulas, and a `# units:` line listing `key=unit` for every column. Most CSV readers can skip them (`comment='#'` in pandas, `comment.char = "#"` in R).
- **Versioning:** row exports carry `schema_version` (integer, currently `2`); JSON exports carry `schema: { name, version }`.

## Project file v2 (`*.peakly.json`)

A project is one JSON object holding all data, so it can be archived, emailed or reopened offline. Images used for digitizing are embedded as `data:` URLs.

```jsonc
{
  "format": "peakly-project",
  "version": 2,
  "schema": { "name": "peakly-project", "version": 2 },
  "app": "Peakly", "peaklyVersion": "1.1.0", "saved": "2026-10-03T12:00:00.000Z",   // informational
  "name": "Caffeine calibration",
  "traces": [ /* Trace objects, below */ ],
  "method": { /* gradient, column, flow, dwell volume, wavelength, … */ },
  "images": { "img_abc": "data:image/png;base64,…" },
  "settings": { "clipDefault": "drop", "askClip": true, "normalization": "none", "showGradient": true, "theme": "light" },
  "calibration": { "unit": "µg/mL", "analytes": [ /* Analyte objects, below */ ] },
  "activeTraceId": "tr_1"
}
```

### Trace

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable id inside the project |
| `name` | string | Display name |
| `x`, `y` | number[] | Ascending x (min or mL) and signal. Share links may pack arrays as `{u:[x0,dx,n]}` (uniform grid) or `{e,d}`; files saved from the app use plain arrays. |
| `xUnit`, `yUnit` | string | Units (see Conventions) |
| `source` | object | `{kind: 'file'\|'image'\|'paste'\|'sample', filename?, format?}` |
| `digitized` | `false` \| object | For image-derived traces: `{dxMin, dy, imageId, printedPeaks?: [{rt, areaPct?, label?}], warnings: []}` |
| `meta` | object | Parsed metadata. `meta.run` holds run info (`sampleName, sampleId, injVol_uL, conc, instrument, column, methodName, operator, date, detector, notes`). `meta.role` marks auxiliary channels (`gradient`, `conductivity`, …). |
| `style` | object | `{color, visible, width}` |
| `proc` | object | Processing settings: `{smooth:{on,window,order}, baseline:{on,lambda,lambdaAuto,p,iter}, peaks:{threshold,minDist,minWidth,auto}}` |
| `peaks` | Peak[] | Integrated peaks (below) |
| `fit` | object \| null | Last curve-fit result, if any |

### Peak

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable id |
| `start`, `apex`, `end` | number | Bounds and apex, in x units |
| `manual` | boolean | Bounds set or edited by hand (never moved by auto-detection) |
| `label` | string | User name for the peak |
| `clip` | string | **New in v2.** Peak clipping mode: `drop`, `valley`, `baseline`, `skim-tangent`, `skim-exp`, `fit`. Absent = project default (`settings.clipDefault`). See [INTEGRATION.md](INTEGRATION.md). |

### Calibration (new in v2)

```jsonc
"calibration": {
  "unit": "µg/mL",
  "analytes": [{
    "id": "an_1", "name": "Caffeine",
    "peakMatch": { "rt": 4.21, "tol": 0.1 },        // peak = nearest apex within ±tol of rt
    "response": "area",                               // or "height"
    "model": "linear",                                // "linear" | "linear0" (through origin) | "quadratic"
    "weighting": "1/x",                               // "none" | "1/x" | "1/x2"
    "levels": [
      { "conc": 5,  "unit": "µg/mL", "traceId": "tr_2", "include": true },  // response read from that trace's matched peak
      { "conc": 10, "unit": "µg/mL", "response": 1234.5, "include": true }  // or a typed-in response
    ]
  }]
}
```

Fit statistics, LOD/LOQ and concentrations of unknowns are **computed on load**, not stored, so they always match the current math. See [CALIBRATION.md](CALIBRATION.md).

### Migration from v1 to v2

Peakly 1.0 wrote `version: 1` (or no version). `PK.schema.migrate(project)` upgrades on load, non-destructively (the input is deep-cloned):

| Change | Why |
|---|---|
| Every existing peak without a valid `clip` gets `clip: "valley"` | v1 always integrated valley-to-valley; this keeps stored areas identical |
| `settings.clipDefault = "drop"` (if missing) | New auto-integrations use perpendicular drop by default |
| `settings.askClip = true` (if missing) | The app asks how to split fused peaks |
| `calibration = { analytes: [], unit: "" }` (if missing) | New calibration block |
| `version = 2`, `schema = { name: "peakly-project", version: 2 }` | Version tag |

`PK.schema.migrate(project, { report: true })` returns `{ project, from, to, changes[] }` with human-readable change notes. Files from a **newer** Peakly (version > 2) are not modified; `PK.schema.validateProject` reports an error asking the user to update.

`PK.schema.validateProject(obj)` returns `{ ok, errors[], warnings[] }`. Errors (wrong types, mismatched x/y lengths, unknown clip modes) make a file unusable; warnings (NaN points, unsorted x, old version) are repaired on load.

Projects are saved as `version: 2` with `schema: {name: "peakly-project", version: 2}`. Files without a version are treated as v1 and migrated on load.

## Peak table (CSV / JSON)

One row per peak, built by `PK.schema.peakTableRows(project)`. Auxiliary channels (gradient, conductivity) are excluded. Column units use templates resolved per trace: `{x}` = x unit, `{y}` = y unit, `{elu}` = %B or salt/imidazole unit, `{conc}` = calibration unit.

| Column | Unit | Meaning |
|---|---|---|
| `schema_version` | | Export schema version (2) |
| `trace_id`, `trace_name` | | Trace |
| `peak_no` | | 1-based, retention order |
| `peak_id`, `name` | | Peak id and user label |
| `rt` | {x} | Apex (parabolic interpolation) |
| `rt_unc` | {x} | ± from pixel size (digitized only) |
| `start`, `end` | {x} | Integration bounds |
| `height` | {y} | Apex above the applied baseline |
| `area` | {y}·{x} | Net area above the applied baseline |
| `area_pct` | % | Share of all peak areas in the trace |
| `fwhm` | {x} | Width at half height |
| `tailing` | | USP tailing T = W0.05/(2f) |
| `asymmetry` | | At 10 % height |
| `plates` | | N = 5.54 (tR/W½)² |
| `plates_usp` | | N = 16 (tR/W)², tangent method |
| `resolution` | | Vs preceding peak, half-height formula |
| `sn` | | S/N = 2H/h |
| `k_prime` | | (tR − t0)/t0 |
| `elution` | {elu} | %B or concentration at elution |
| `clip` | | Clipping mode applied |
| `baseline_kind` | | Shape of the applied baseline |
| `baseline_area`, `gross_area` | {y}·{x} | net = gross − baseline |
| `fit_area`, `fit_area_se` | {y}·{x} | Curve-fit component area and its SE |
| `analyte` | | Matched calibration analyte |
| `conc`, `conc_lo`, `conc_hi` | {conc} | Inverse-predicted concentration and 95 % limits |
| `conc_flags` | | `;`-separated: `extrapolated`, `below_LOQ`, `below_LOD`, `standard` |
| `x_unit`, `y_unit` | | Units of this trace |
| `digitized`, `manual` | | Booleans |
| `imported_from` | | Tool that reported the peak in an imported file (`chromatopy`, `mocca2`), else empty |
| `imported_area`, `imported_area_se` | tool's units | Area (and SE/SD) as reported by that tool, not recomputed |

Formulas: [CALCULATIONS.md](CALCULATIONS.md), [INTEGRATION.md](INTEGRATION.md), [CALIBRATION.md](CALIBRATION.md).

Note: the 1.0 peak CSV used different headers (`RT_min`, `area_pct`, `W_half_min`, `tailing_USP`, …, `yes`/`no` booleans). Files written by 1.1.0+ use the v2 column keys above; the first comment line records the Peakly version.

## Trace data (CSV / JSON)

- **Long-format data** (`PK.schema.dataRows`): columns `trace_id, trace_name, x, y, y_processed, digitized`; one row per point. `y` is the raw imported signal; `y_processed` is smoothed and baseline-corrected (what integration used).
- **Trace summary** (`PK.schema.traceRows`): one row per trace with `schema_version, trace_id, name, role, x_unit, y_unit, n_points, x_min, x_max, source_kind, source_format, source_filename, digitized, dx_unc, dy_unc, n_peaks, sample_name, sample_id, inj_vol, instrument, detector, processing, calibration_level`.
- **Traces JSON**: `{ app, version, exported, traces: [{ name, xUnit, yUnit, source, digitized, run, x, y, yProcessed, peaks }] }`.

## Interoperability

### Python (pandas)

```python
import pandas as pd
peaks = pd.read_csv("run_peaks.csv", comment="#")
data  = pd.read_csv("run_traces.csv", comment="#")
uv = data[data.trace_name == "Sample 254 nm"]
```

### R

```r
peaks <- read.csv("run_peaks.csv", comment.char = "#")
```

### chromatoPy

[chromatoPy](https://github.com/GerardOtiniano/chromatoPy) (MIT) fits Gaussian peaks to HPLC and GC-FID data. Peakly **imports** its outputs directly (parser `src/parsers/chromatopy.js`, written from chromatoPy's documented output keys; no chromatoPy code is used):

- **`FID_output.json`** (GC-FID integration results): one trace per sample from `Raw Data`, plus peaks from `Processed Data` with the ensemble-mean area as `area`, the ensemble standard deviation as `areaSE`, the best-fit area, the model, and the retention time. Sample: [`samples/data/chromatopy_FID_output.json`](../samples/data/chromatopy_FID_output.json).
- **`hplc_to_csv` CSV** (header `RT (min),<m/z>,…`): one trace per ion. Sample: [`samples/data/chromatopy_hplc.csv`](../samples/data/chromatopy_hplc.csv).

Going the other way, Peakly's `fit_area` / `fit_area_se` peak-table columns are comparable to chromatoPy's fitted areas and their spread (both use area = A·σ·√(2π) for Gaussian components), and the long-format trace CSV gives time/signal columns that can be fed to chromatoPy after selecting one trace with pandas (above). **(verify the input column names against the chromatoPy version you use.)**

### MOCCA2

[MOCCA2](https://github.com/bayer-group/MOCCA) (MIT, Bayer) processes HPLC-DAD data in Python. Peakly **imports** the JSON produced by `json.dump` of MOCCA2 objects' `to_dict()` (`Data2D`, `Chromatogram`, `MoccaDataset`; parser `src/parsers/mocca2.js`, written from MOCCA2's documented field names; no MOCCA2 code is used):

- Peakly is single-wavelength, so it extracts **one trace per chromatogram** at 254 nm when present (otherwise the wavelength with the highest absorbance, or the sum over wavelengths).
- Deconvolved components become peaks labelled with the compound name; their area is the component integral × spectrum at the selected wavelength × Δt (absorbance·min). Plain peaks get the trapezoid area between their bounds.
- Sample: [`samples/data/mocca2.json`](../samples/data/mocca2.json).

To compare results, export Peakly's peak table and join it with MOCCA2's on retention time within a tolerance. Remember the units: Peakly `area` is y-unit·min (×60 for ·s). **(verify field names against the MOCCA2 version you use.)**

### Back into Peakly

Peakly's JSON parser recognizes its own project files, the traces JSON export, and generic shapes (`[{x,y}]`, `[[x,y]]`, `{x:[],y:[]}`, `{traces:[…]}`), so exports can be edited by a script and dropped back in.
