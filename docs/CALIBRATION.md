<!-- SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 -->
# Calibration curves in Peakly

Peakly fits an external-standard calibration curve (response against concentration), reports its statistics and back-calculates unknowns with a confidence interval. The code is `calibrationFit()` and `quantify()` in `src/analysis.js`. A simulation check is in [VALIDATION.md §6](VALIDATION.md), and integration (where the responses come from) is in [INTEGRATION.md](INTEGRATION.md).

## 1. Models

| `model` | equation | parameters p |
|---|---|---|
| `linear` (default) | y = b₀ + b₁x | 2 |
| `linear0` | y = b₁x (through the origin) | 1 |
| `quadratic` | y = b₀ + b₁x + b₂x² | 3 |

Here `x` is concentration and `y` is the response (peak area or height). At least p + 1 included points are required. Levels with `include: false` are ignored.

Use `linear0` only when a blank genuinely gives zero response and the intercept is not significantly different from zero; otherwise it biases low concentrations. Use `quadratic` only for a real, reproducible curvature (for example detector saturation), and never to rescue a bad straight line.

## 2. Weighting

Ordinary least squares assumes every point has the same response SD. In chromatography the SD usually grows with concentration, often roughly as a constant CV, so the top standards would otherwise dominate the fit.

| `weighting` | wᵢ ∝ | appropriate when |
|---|---|---|
| `none` | 1 | the SD is constant across the range (narrow range) |
| `1/x` | 1/xᵢ | the variance grows ∝ x (counting-like noise) |
| `1/x2` | 1/xᵢ² | the SD grows ∝ x, i.e. constant CV (typical over 2–3 decades) |

- **Normalisation:** weights are scaled to Σwᵢ = n, so s_y/x stays in response units.
- **Per-point weights:** an optional `w` on a point multiplies the model weight.
- **Zero or negative x:** 1/x and 1/x² are undefined there (a blank), so those points use the weight of the lowest positive level, and a note says so.
- **Choosing a weighting:** pick the one whose standardised residuals show no funnel shape. VALIDATION §6 shows what a mismatch does. With constant-CV noise and no weighting, 95 % intervals cover 100 % at the low end (far too wide) but only 48 % at the top.

## 3. Fit and statistics

Weighted least squares solves for b = (XᵀWX)⁻¹XᵀWy, where X has the rows `[1, x]`, `[x]` or `[1, x, x²]`.

| output | formula |
|---|---|
| `residuals[]`, `points[].fitted` | eᵢ = yᵢ − ŷᵢ |
| `syx` (s_y/x) | √(Σwᵢeᵢ² / (n − p)) |
| `cov` | s²·(XᵀWX)⁻¹ |
| `se[]` | √diag(cov) |
| `r2` | 1 − Σwe² / Σw(y − ȳ_w)²; uncentred (Σwy²) for `linear0` |
| `adjR2` | 1 − (1 − R²)(n − 1)/(n − p); uses n − 0 for `linear0` |
| `points[].stdResidual` | eᵢ√wᵢ / s_y/x (flagged in `notes` when \|·\| > 3) |
| `tCrit` | Student t(1 − α/2, n − p), with α = 0.05 by default |

`predict(x)` returns ŷ. `predictBand(x, {m})` returns the confidence band of the line (`loMean`, `hiMean`) and the prediction band for the mean of m new measurements (`lo`, `hi`).

R² alone does not show linearity, so always look at the residual plot. Following ICH Q2, report the slope, intercept, their SEs and the residuals, not just R².

`formulas` holds auditable `{expr, inputs, value, note}` entries for `model`, `weighting`, `se`, `syx`, `r2`, `adjR2`, `lod`, `loq` and `inverse`.

## 4. LOD and LOQ

```
LOD = 3.3·s_y/x / slope        LOQ = 10·s_y/x / slope
```

This is the ICH Q2 calibration-curve approach, using the residual SD of the regression.

- **Slope used:**
  - linear models: b₁;
  - quadratic: the tangent slope b₁ + 2b₂·x at the lowest positive level.
- **Intercept-based alternative:** `lodIntercept` = 3.3·SE(b₀)/slope, for models with an intercept.

Limitations, stated plainly:

- **Assumptions:** the errors must be homoscedastic and roughly normal near the limit. The estimate is only as good as the low end of the curve. A curve spanning 1–100 gives a poor LOD, so calibrate near the expected limit when the limit matters.
- **Weighted fits:** s_y/x is the SD at the *average* weight. At the low end the true SD is smaller, so a weighted LOD/LOQ is conservative (too high) there. VALIDATION §6 shows the effect.
- **What ICH asks for:** ICH Q2(R2) expects these estimates to be confirmed experimentally, by analysing samples near the limits. Peakly cannot do that for you.

## 5. Back-calculating unknowns: `inverse(y₀, {m})`

The unknown's response ȳ₀ is the mean of `m` replicate injections (default 1). Peakly solves f(x̂₀) = ȳ₀:

- **Linear models:** x̂₀ = (ȳ₀ − b₀)/b₁.
- **Quadratic:** the root on the monotonic branch of the curve (slope with the same sign as the calibration trend), nearest the middle of the calibrated range. If there is no real root, `flags` contains `'noSolution'`.

**Uncertainty, delta method:**

```
s(x̂₀)² = [ s²/(m·w(x₀)) + gᵀ·Cov(b)·g ] / f′(x₀)²,     g = ∂f/∂b at x₀,  f′ = b₁ + 2b₂x₀
interval: x̂₀ ± t(0.975, n − p)·s(x̂₀)
```

- The first term is the scatter of the unknown's own measurement. `w(x₀)` is the normalised weight the model assigns at x₀, so with 1/x² weighting a low-level unknown gets a proportionally smaller SD.
- The second term is the uncertainty of the fitted line at x₀.

For an unweighted straight line this is exactly the classic inverse-prediction formula (Miller & Miller):

```
s_x0 = (s_y/x / b)·√( 1/m + 1/n + (ȳ₀ − ȳ)² / (b²·Σ(xᵢ − x̄)²) )
```

`inverse()` returns `{ x, se, lo, hi, tCrit, dof, level, m, slopeAtX, weightAtX, flags[], notes[], formula }`. The `flags` are:

| flag | meaning |
|---|---|
| `extrapolated` | x̂₀ is outside [min, max] of the standards |
| `belowLOD` | x̂₀ < LOD: report "not detected / < LOD" |
| `belowLOQ` | LOD ≤ x̂₀ < LOQ: detected but not quantifiable at the stated precision |
| `noSolution` | the response cannot be reached by the model |

**Coverage check.** In seeded simulations (unit test "inverse-prediction interval coverage" and VALIDATION §6), the 95 % interval covers the true concentration 91–96 % of the time when the weighting matches the noise model.

## 6. `quantify(cal, response, {m, responses})`

`cal` can be either of:

- a `calibrationFit()` result;
- a project analyte, `{ model, weighting, unit, levels: [{ conc, response?, traceId?, include }] }`.

Levels without a numeric `response` are looked up in `opts.responses[traceId]`, typically the matched peak areas. Levels that still have no response are skipped, with a note. The result is the `inverse()` object plus `{ conc, unit, fit }`.

## 7. Worked example

This textbook-style data set has 7 standards: x = 0, 2, 4, 6, 8, 10, 12 and y = 2.1, 5.0, 9.0, 12.6, 17.3, 21.0, 24.7. It is fitted with `model: 'linear', weighting: 'none'`. Every value below is reproduced by the unit tests.

| quantity | value |
|---|---|
| slope b₁ ± SE | 1.9304 ± 0.0409 |
| intercept b₀ ± SE | 1.5179 ± 0.2949 |
| R², adjusted R² | 0.99776, 0.99731 |
| s_y/x | 0.43285 |
| x̄, ȳ, Σ(xᵢ − x̄)² | 6, 13.1, 112 |
| t(0.975, 5) | 2.5706 |
| LOD = 3.3·0.43285/1.9304 | 0.740 |
| LOQ = 10·0.43285/1.9304 | 2.242 |
| LOD from SE(b₀) | 0.504 |

**Unknown with response 13.5:**

- x̂₀ = (13.5 − 1.5179)/1.9304 = **6.207**.
- **m = 1:** s(x̂₀) = (0.43285/1.9304)·√(1 + 1/7 + (13.5 − 13.1)²/(1.9304²·112)) = 0.2398. The 95 % interval is 6.207 ± 2.5706·0.2398, that is **[5.59, 6.82]**.
- **m = 6 replicates:** s(x̂₀) = 0.1248, interval [5.89, 6.53].
- **Flags on other responses:**
  - 4.5 → x̂₀ = 1.54, `belowLOQ`;
  - 2.9 → `belowLOD`;
  - 30 → `extrapolated`.

**Effect of weighting.** Fitting the six non-zero standards with 1/x² gives y = 1.0208 + 1.9867x. At x ≈ 2, the back-calculated SE is 0.053, against 0.171 unweighted. That is right *if* the noise really is proportional, which this small data set cannot show. Choose the weighting from replicate data or the residual pattern, not from which one gives the smaller interval.

## References (by name)

- J. N. Miller & J. C. Miller, *Statistics and Chemometrics for Analytical Chemistry*, Pearson: calibration, inverse prediction, weighted regression, LOD.
- ICH Q2(R2) *Validation of Analytical Procedures*: linearity, range, detection and quantitation limits.
- Eurachem Guide *The Fitness for Purpose of Analytical Methods*: LOD/LOQ and working range.
- USP General Chapter <1225> *Validation of Compendial Procedures*.

For research and education use. Not validated for regulated (GMP/GLP) workflows.
