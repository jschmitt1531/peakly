# Peakly

**Free, single-file, in-browser HPLC/FPLC chromatogram analysis.** Open `index.html` (or a hosted copy) and drop in data: a CSV, a vendor export, an Excel sheet, or a *photo of a printed chromatogram*. You get retention times, integration, gradient context, overlays and a shareable result.

- **No backend, no accounts, no uploads, no tracking.** Everything runs in your browser. The only outbound request Peakly can make is the **optional** Claude vision call in the image module. It runs only when you paste your own API key and click the button. The key stays in memory and is never saved.
- **One file.** Email it, put it on a USB stick, or host it anywhere static. Libraries load from pinned CDN versions (see *Credits*).

> Peakly is an independent project. It is **not** affiliated with OpenChrom®, Lablicate, Eclipse ChemClipse, or any instrument vendor.

## Quick start
1. Open `index.html` in a current Chrome, Edge, Firefox or Safari.
2. Click **Sample data** (an HPLC run plus a blank, with a gradient method) or **Sample image** (a printed chromatogram to digitize).
3. Hover the plot: the cursor follows the curve. Press **g**, click a peak's start and end, and it is integrated.
4. Name peaks in the table, set the method under **Method**, then use **Export** (PNG/SVG/CSV/PDF/project) or **Share** (link).

## Supported inputs
| Kind | Formats |
|---|---|
| Generic | CSV / TSV / TXT (any delimiter, decimal comma, optional header), pasted numbers, Excel `.xlsx/.xls`, JSON |
| Open standards | JCAMP-DX (AFFN + compressed ASDF), AnDI/netCDF-3 (`.cdf`), mzML (TIC/BPC/UV chromatograms, zlib) |
| Vendor binary | Agilent ChemStation `.ch` (types 130/131, 179/181) |
| Vendor text exports | Agilent ChemStation/OpenLab CSV/TXT (incl. UTF-16), Thermo Chromeleon ASCII, Shimadzu LabSolutions ASCII, Waters Empower `.arw`, Cytiva UNICORN CSV/ASC (multi-curve, fractions), Bio-Rad ChromLab/NGC CSV |
| Images | PNG, JPG, WebP, GIF, BMP, PDF page, clipboard screenshot, phone camera |

**Not supported** (you get a clear message instead): Thermo `.raw`, Agilent `.uv` full spectra, Shimadzu `.lcd`, netCDF-4/HDF5, MS-Numpress. Export to text from the vendor software instead.

If a file isn't recognized, **"My format isn't working"** shows the raw text and lets you choose the delimiter, header row, x and y columns and units by hand.

### Adding a format
Parsers are plugins:
```js
PK.parsers.register({
  id: 'myformat', name: 'My instrument', extensions: ['xyz'], binary: false,
  sniff: (head, filename) => /MY HEADER/.test(head) ? 0.9 : 0,      // confidence 0..1
  parse: (text, { filename }) => ({ ok: true, format: 'myformat', warnings: [],
           traces: [{ name: 'UV', x: [...minutes], y: [...], xUnit: 'min', yUnit: 'mAU',
                      source: { kind: 'file', filename }, meta: {} }] })
});
```

## Image → chromatogram (digitizing)
1. **Prep:** crop, rotate or auto-deskew, 4-corner perspective correction (for photos of screens or paper), and brightness/contrast/threshold.
2. **Calibrate:** place X1/X2/Y1/Y2 on known ticks and type their values (linear or log). An optional **Claude assist** reads the axes, ticks, title and printed peak labels and *pre-fills* them. You must confirm before continuing.
3. **Extract:** pick the trace color with the eyedropper (or auto-detect it) and set the tolerance. Gridlines and axes are removed automatically, and you can exclude legend or text boxes. The trace y in each pixel column is taken as either the centroid or the topmost pixel. Gaps are interpolated and the result is resampled to an even grid. One image can hold several traces.
4. **Verify:** the extracted trace is overlaid on the image with an opacity control. Pixel-resolution uncertainty is shown (± min, ± y), along with warnings for low resolution, JPEG artifacts, poor calibration spread and low coverage.
5. **Send:** traces arrive labelled **digitized**, with their uncertainty. Retention times and area % printed on the image are compared with the computed values, and mismatches are flagged.

### Limits of digitized data. Please read.
Digitized traces are reconstructions of a *picture*, not instrument data.
- **Good for:** retention times (to about ±1 pixel width), peak order, relative heights, **area %** of resolved peaks, and comparing runs plotted the same way.
- **Weak for:** absolute quantitation, small or overlapping peaks, noise and S/N, plate counts and tailing on narrow peaks (a few pixels wide), anything clipped at the top of the plot, and log-scaled axes.
- Line thickness, antialiasing, JPEG compression and the printer or camera all distort the shape. Peakly therefore labels every derived number with the source's ± uncertainty and never lets digitized data pass as raw data in exports.

## Calculations

Every number Peakly reports comes from `src/analysis.js`. Each per-peak metric also carries `formulas[metric] = { expr, inputs, value, note, unit? }`, so the UI can show the exact inputs behind each value. Time is always in **minutes**. Intensities stay in the trace's native unit (`y`, e.g. mAU).

### Signal processing

**Savitzky–Golay smoothing / derivatives** (`savitzkyGolay(y, window, order, deriv, delta)`)
- Fits a least-squares polynomial of degree `order` to each odd window of `m` points and evaluates it (or its `deriv`-th derivative) at the window position. Coefficients come from `(VᵀV)⁻¹Vᵀ` with a Vandermonde matrix `V` on normalised abscissae `z ∈ [−1, 1]`, scaled by `h^−d`.
- **Edges:** the first and last `(m−1)/2` points are evaluated from the polynomial fitted to the first/last full window, so there is no padding, no shortened output and no phase shift. Any polynomial of degree ≤ `order` is reproduced exactly everywhere.
- **Assumptions:** uniform sampling. Derivatives are per sample unless `delta` (Δx) is given.
- **Limitations:** a wide window with a low order flattens and broadens narrow peaks. As a rule, keep the window ≤ about half the FWHM in points.
- Ref: Savitzky & Golay, *Anal. Chem.* 36 (1964) 1627.

**Asymmetric least squares baseline** (`alsBaseline(y, {lambda=1e5, p=0.01, iter=10})`)
- Minimises `Σ wᵢ(yᵢ − zᵢ)² + λ Σ (Δ²zᵢ)²`. Weights are `wᵢ = p` where `yᵢ > zᵢ` (peaks) and `1 − p` otherwise. The weights are re-estimated until they stop changing or `iter` is reached.
- `(W + λDᵀD) z = W y` is a symmetric pentadiagonal system. It is solved with a banded LDLᵀ factorisation in O(n): 100 000 points × 10 iterations take about 60 ms in Node.
- **Choosing λ:** λ scales roughly with (points per baseline feature)⁴. For 4 000 points over 20 min, λ ≈ 1e8 and p ≈ 0.001 work well. For 20 000 points, use λ ≈ 1e9–1e10. Use smaller `p` for dense chromatograms.
- **Limitations:** broad humps such as unresolved polymer envelopes are partly treated as baseline. Negative peaks pull the baseline down.
- Ref: Eilers & Boelens, *Baseline Correction with Asymmetric Least Squares Smoothing* (Leiden Univ. Medical Centre report, 2005).

**Processing pipeline** (`process(trace)`): raw → Savitzky–Golay smoothing (if `proc.smooth.on`) → ALS baseline subtraction (if `proc.baseline.on`). All peak work then uses the processed `y`.

**Noise** (`noise(x, y, {range})`)
- **Default:** `σ = 1.4826·MAD(Δy)/√2`, the robust SD of first differences. Peaks and slow drift barely affect it. The peak-to-peak value is taken as `h = 6σ`.
- **With a blank `range`:** the region is linearly detrended. `σ` is the residual SD and `h` is the measured max − min (Ph. Eur. 2.2.46 practice).
- **Limitation:** on already-smoothed data, neighbouring points are correlated, so the difference-based σ underestimates the noise. Use a blank range in that case.

### Peak detection and integration bounds

`detectPeaks(x, y, {threshold, minDist, minWidth, shoulders, keep})`:
1. Smooth with a cubic Savitzky–Golay filter. The window is about ½·`minWidth`, otherwise n/500, clamped to 5–25 points.
2. Find local maxima and compute their topographic **prominence**. Keep maxima with prominence ≥ `threshold` (y units). `'auto'` uses 9σ, which equals S/N = 3 under the 6σ peak-to-peak convention.
3. `minWidth`: the width at half prominence must be ≥ `minWidth` minutes. `minDist`: among peaks closer than `minDist`, the more prominent one wins.
4. **Shoulders:** a significant local minimum of d²y (below −6 robust SD) that is not near an apex and whose curvature lobe is separated from neighbouring apexes. Separation means d²y recovers at least half-way toward 0 in between. These are flagged `shoulder: true`, one per lobe.
5. **Bounds:** consecutive apexes are split at the valley (minimum of the smoothed signal). If there is no valley, as with a shoulder, the split is at the maximum of d²y and acts as a perpendicular drop. On each side the bound walks outward from the apex and stops at the earliest of:
   - the signal returning to within `max(0.5 % of height, 2σ)` of the side minimum (return to baseline);
   - the signal rising again (a valley);
   - the split point.

   The search is capped at 20 half-widths.
6. `keep`: user peaks are returned unchanged, and auto peaks overlapping them are dropped.

**Manual integration.** Peaks with `manual: true` are never moved by `detectPeaks` or `refineBounds`.
- `integrateWindow(x, y, start, end)` creates a manual peak with exactly the clicked bounds.
- `peakAt(x, y, t)` places a manual peak at the highest point near the click, with bounds found as above.
- `refineBounds` snaps the bounds of automatic peaks to nearby local minima.

### Per-peak metrics (`peakMetrics(x, y, peaks, {voidTime, noise})`)

Each peak is integrated between `start` and `end` above a **straight drop-line baseline** joining `y(start)` and `y(end)`, linearly interpolated when the bounds fall between samples. If the bounds sit at valleys, this is valley-to-valley integration. All metrics below use the baseline-corrected signal `Y = y − b`.

| Metric | Formula | Notes |
|---|---|---|
| `rt` | `t_R = x_k − b/(2a)` | Parabola `a·u² + b·u + Y_k` through the apex sample and its two neighbours (handles non-uniform spacing). |
| `height` | `H = Y(t_R)` | Parabolic apex value above the drop line. |
| `area` | `Σ ½(Yᵢ + Yᵢ₊₁)(xᵢ₊₁ − xᵢ)` | Trapezoid rule. **Unit y·min**; multiply by 60 for y·s, as ChemStation reports mAU·s. |
| `areaPct` | `100·Aᵢ/ΣA` | Over all integrated peaks; no response factors. |
| `fwhm` | `t_r(H/2) − t_l(H/2)` | Linear interpolation between samples. Gaussian: 2√(2ln2)·σ = 2.3548σ. |
| `w5`, `w10` | widths at 5 % / 10 % height | `null` if that level is not reached inside the bounds. |
| `tailing` | `T = W₀.₀₅/(2f)`, `f = t_R − t_l(0.05H)` | USP <621> tailing factor, the same as the Ph. Eur. symmetry factor. |
| `asymmetry` | `A_s = b/a` at 10 % | Back half-width / front half-width. |
| `plates` | `N = 5.54(t_R/W½)²` | Half-height method; 5.54 ≈ 8 ln 2. Gaussian assumption. |
| `platesUSP` | `N = 16(t_R/W)²` | Tangent method. `W` = distance between the baseline intercepts of tangents at the inflection points (maximum \|slope\| from a Savitzky–Golay derivative). |
| `resolution` | `R_s = 1.18(t_R2 − t_R1)/(W½,1 + W½,2)` | Against the preceding peak in retention order. |
| `k` | `(t_R − t₀)/t₀` | Only when a void time is available. |
| `sn` | `S/N = 2H/h` | Ph. Eur. 2.2.46. **Default `h = 6σ`, so S/N = H/(3σ)**. Pass a measured peak-to-peak value (`noise: {p2p}`) or use a blank range for the strict pharmacopoeial form. |

**Limitations**
- Drop-line integration of strongly overlapping peaks splits the area at the valley. When peaks overlap substantially, use `fitPeaks` instead.
- Plate counts and resolution assume Gaussian shapes and overestimate efficiency for tailing peaks.
- Widths, tailing and asymmetry are `null` when their level is not reached inside the bounds.
- `t_R` is measured from injection (x = 0).

### Gradient and method model

- `gradientAt(method, t)` returns the program composition at pump time `t`:
  - Rows are linear between consecutive times. Two rows with the same `t` form an **instantaneous step**, and the later row applies from `t` onward.
  - Before the first row and after the last, the composition is held.
  - With `mode: 'step'`, each row is held until the next.
  - With `gradientType: 'isocratic'` or a single row, the composition is constant.
  - Per-row `flow` is interpolated like %B; it falls back to `method.flow`.
- **Concentration** for salt or imidazole gradients: `c = c_A + (bMaxConc − c_A)·B/100` in `bConcUnit`. `c_A` is the optional `method.aConc`, default 0, so the default is `bMaxConc·B/100`. This assumes ideal linear volumetric mixing.
- **Dwell time:** `t_D = V_D/F`.
- **Void volume:** `V₀ = ε·π·(d/2)²·L`. With `d` and `L` in mm the result is in mm³; ÷1000 converts to mL. `ε` is the total porosity: 0.65 for fully porous silica, about 0.35 for interstitial-only volume with pore-excluded proteins.
- **Void time:** `t₀ = V₀/F`, unless `voidTime_min` overrides it. Example: a 150 × 4.6 mm column with ε = 0.65 gives V₀ = 1.62 mL, so t₀ = 1.62 min at 1 mL/min.
- `gradientCurve(method, tMax, n)` is the composition reaching the **column inlet**: `B(t − t_D)`. Exact breakpoints, including both sides of each step, are merged into the grid. Pass `{includeVoid: true}` to also delay by t₀, which approximates the column outlet.
- `Bat(method, t_R)` is the %B at elution: `B_program(max(0, t_R − t_D − t₀))`. It is the mobile phase that left the mixer t_D + t₀ before the peak reached the detector. `elution()` returns the same value together with its inputs and concentration.
- **Assumptions:** constant flow, a plug-flow dwell volume (no gradient rounding by the mixer) and no extra-column volume after the column.
- **Limitation:** strongly retained solutes actually elute at a slightly lower %B than this estimate predicts.
- Ref: Snyder & Dolan, *High-Performance Gradient Elution* (Wiley, 2007).

### Comparison tools

- `normalize({x, y}, mode, {range})`: `'max'` scales so the maximum in the range is 1; `'area'` scales so the trapezoid area in the range is 1 (y·min).
- `align(x, shift)` adds a constant time shift.
- `difference(A, B)` linearly resamples B onto A's x values and subtracts. Points outside B's x range become `NaN` rather than extrapolated values.

### Peak fitting (`fitPeaks(x, y, peaks, {model, maxIter=200, baseline})`)

**Models.** Fits are joint over the union of the peaks' windows. `y` should be baseline-corrected; set `baseline: 'linear'` to fit a local `b₀ + b₁(t − t_c)` as well.
- **Gaussian:** `A·exp(−u²/2)`, with `u = (t − μ)/σ`.
- **EMG:** a Gaussian with amplitude `A` convolved with a unit-area exponential of time constant `τ`:
  `f = A·(σ/τ)·√(π/2)·exp(−u²/2)·erfcx(z)`, with `z = (σ/τ − u)/√2`.
  - Using the scaled complementary error function `erfcx` avoids overflow when τ is small and returns the Gaussian exactly as τ → 0.
  - For `z < 0`, the reflection `erfcx(z) = 2e^{z²} − erfcx(−z)` is applied with the exponents combined (`z² − u²/2 = r²/2 − r·u`, where `r = σ/τ`).
  - `erfcx` is computed with a power series below 2 and a continued fraction above, accurate to about 1e-14.
- **Area (both models)** = `A·σ·√(2π)`. Because the exponential kernel has unit area, the EMG area does not depend on τ.

**Algorithm.** Levenberg–Marquardt with Marquardt diagonal scaling, solving `(JᵀJ + λ·diag JᵀJ) δ = Jᵀr`.
- The Jacobian uses central differences. Only the perturbed component is re-evaluated; baseline columns are analytic.
- Bounds are enforced by projection: A ≥ 0, μ inside the window, σ ≥ Δx/20, τ ≥ Δx/100.
- `converged` is true when the relative RSS decrease is below 1e-8, the relative step is below 1e-6, or no downhill step exists.

**Uncertainty.**
- `cov = s²(JᵀJ)⁻¹`, with `s² = RSS/(n − p)` and `dof = n − p`.
- **Area SE** uses the delta method with the A–σ covariance term:
  `Var(area) = (σ√2π)²Var(A) + (A√2π)²Var(σ) + 2(σ√2π)(A√2π)Cov(A,σ)`.
- Validated by simulation: about 92 % of true areas fall within ±2 SE across 60 synthetic fits.

**Reported per component:** apex `rt` (golden-section maximum of the fitted curve), `fwhm` (bisection), `height` and `areaPct`. `r2 = 1 − RSS/TSS`.

**Limitations**
- Local minimum only: the fit starts from the detected apex and half-widths.
- The SE assumes white, independent noise and a correct model, and ignores parameters fixed at a bound.
- Real peak shapes that are not EMG or Gaussian give biased areas.
- Approach inspired by chromatoPy (MIT); the implementation is independent.

**Refs.**
- Marquardt, *SIAM J. Appl. Math.* 11 (1963) 431.
- Grushka, *Anal. Chem.* 44 (1972) 1733 (EMG).
- Kalambet et al., *J. Chemometrics* 25 (2011) 352 (numerically stable EMG).
- Foley & Dorsey, *Anal. Chem.* 55 (1983) 730.

### Sample data

- `syntheticChromatogram({tMax, n, peaks, drift, noise, seed})` sums EMG peaks (specified by apex height), a smooth drift (`1.5 + 0.25t + 1.2 sin(πt/14)`) and Gaussian noise from a seeded mulberry32 PRNG with Box–Muller. It returns the ground truth (apex rt, μ, area, σ, τ) for tests.
- `sampleMethod()`: RP-HPLC on a C18 column (150 × 4.6 mm, 5 µm) at 1 mL/min, dwell volume 1.1 mL. The gradient runs 5 → 95 %B over 20 min, holds for 3 min, steps back to 5 %B and re-equilibrates. A = water + 0.1 % FA, B = MeCN + 0.1 % FA; 254 nm, 30 °C.
- `sampleFPLCMethod()`: IMAC with an imidazole step and a linear gradient, where 100 %B = 500 mM imidazole.

## Using the app
- **Cursor:** follows the active trace. Use ←/→ to step a point, and `[` `]` to switch traces.
- **Integrate (g):** click start, then end, on the curve. **Add peak (a):** click near an apex. Select a peak and press **Delete** to remove it. Drag the bound handles to adjust a peak.
- **Peak labels:** double-click a label or edit the *Name* column.
- **Compare:** peaks are matched across traces by RT tolerance. You get ΔRT and area ratio against a reference, and "apply the same window to all traces".
- **Overlay:** normalization (none/max/area), RT offsets, waterfall stacking, and a difference trace.
- **Shortcuts:**

  | Key | Action |
  |---|---|
  | `o` | open |
  | `i` | image |
  | `m` | method |
  | `e` | export |
  | `s` | share |
  | `p` | detect peaks |
  | `d` | theme |
  | `?` | help |
  | Ctrl/⌘+Z, Shift+Ctrl/⌘+Z | undo, redo |

## Export & share
PNG/SVG figure (white background; can ghost the source image behind digitized traces), peak table CSV (with formulas and digitized flags), x,y CSV/JSON, PDF report, project JSON (data, method, settings and embedded images), and a share link. The link holds the compressed project in the URL `#hash`, so the data never touches a server. Images are not included in links. Large projects trigger a warning and an offer to save a project file instead.

## Tests
```
node tests/run.js          # all
node tests/run.js parsers  # one module
```
The same tests are bundled into `index.html`: **Help → Run self-tests**.

## Build
Sources are in `src/`. `node build.js` inlines `src/*.js` and `tests/*.test.js` into `src/shell.html` to produce `index.html`.

## Credits & licenses
Peakly's code is original. Prior work that informed the design (no code copied; see `PRIOR_ART.md`):

| Project | License | What we learned or used |
|---|---|---|
| OpenChrom / Eclipse ChemClipse | EPL-2.0 | Plugin-style importer architecture; detect → integrate → report pipeline |
| chromatoPy (G. Otiniano) | MIT | Multi-Gaussian fitting with area uncertainty from parameter covariance |
| rainbow (E. Shi et al.) | LGPL-3.0 | Public prose documentation of the Agilent `.ch` binary layouts |
| chromConverter (E. Bass) | GPL-3.0 | Survey of common vendor export formats (code not used) |
| entab (R. Bovee) | MIT | Reference for Agilent/Thermo readers (WASM not used, to keep a single file) |
| WebPlotDigitizer (A. Rohatgi) | AGPL-3.0 | The digitizing workflow concept: axis calibration and color-mask extraction |

Algorithms: Eilers & Boelens (2005) asymmetric least squares; Savitzky & Golay (1964); USP <621> and Ph. Eur. 2.2.46 system-suitability definitions; Levenberg (1944) and Marquardt (1963); Hartley & Zisserman for homography.

Runtime libraries:
- Plotly.js 2.35.2 (MIT)
- SheetJS 0.18.5 (Apache-2.0)
- pako 2.1.0 (MIT/Zlib)
- lz-string 1.5.0 (MIT)
- jsPDF 2.5.1 (MIT)
- pdf.js 3.11.174 (Apache-2.0)

## License
MIT. Data you analyze is yours and never leaves your browser.
