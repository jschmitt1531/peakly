<!-- SPDX-License-Identifier: MIT -->
# How Peakly integrates peaks

This page explains how Peakly turns a peak's bounds into an area, what each **clip mode** (the way fused peaks are split) does, and when to use it. All of it lives in `src/analysis.js` (`clusters`, `integrate`, `clipOptions`, `peakMetrics`). Accuracy on synthetic data with known answers is in [VALIDATION.md](VALIDATION.md). The other formulas are in [CALCULATIONS.md](CALCULATIONS.md).

Units: time in minutes, signal in the trace's unit (for example mAU). Areas are therefore in **mAU·min**; multiply by 60 for mAU·s, the unit many vendor systems report.

## 1. The basic recipe

Every mode follows the same three steps. Only the **baseline** `b(t)` under the peak changes.

1. **Nodes.** The integration window runs from `t_start` to `t_end`. The nodes are the two exact bounds (interpolated linearly when they fall between samples) plus every sample strictly inside. `n` is the number of nodes.
2. **Trapezoid rule** on the signal and on the baseline separately:
   - gross area `G = Σ ½(yᵢ + yᵢ₊₁)·(tᵢ₊₁ − tᵢ)`
   - baseline area `B = Σ ½(bᵢ + bᵢ₊₁)·(tᵢ₊₁ − tᵢ)`
3. **Net area** `A = G − B`, the area between the signal and the baseline.

Picture the peak as a hill drawn on graph paper. `G` is everything under the hill down to zero. `B` is the strip under the baseline line. The peak area is what is left when the strip is removed.

### The audit object (`math`)

Every result from `integrate()` carries a `math` object, so any number can be checked by hand:

| field | meaning |
|---|---|
| `method`, `clip` | Human-readable method name and the mode actually applied. |
| `formula` | Formula string for this mode. |
| `steps[]` | Ordered `{label, expr, value}` entries: start, end, n, Δt, baseline at start and end, mode-specific values (tangent point, τ, fit parameters…), gross, baseline and net area. |
| `n`, `dt` | Number of nodes and the trace's mean sampling interval. |
| `tStart`, `tEnd` | The integration window. |
| `yStart`, `yEnd` | **Baseline** values at the window ends. |
| `signalStart`, `signalEnd` | Signal values at the window ends. |
| `grossArea`, `baselineArea`, `netArea` | Always satisfy `grossArea − baselineArea = netArea = area`. |
| `notes[]` | Plain-language explanation, for example *"Area under the curve between 7.165 and 7.505 min, minus the area under the common cluster baseline from (7.165, 0.1454) to (7.87, 0.06721) with vertical drop lines at 7.165 and 7.505 min."* Notes also explain any fallback. |

Each result also returns `baseline: {kind, points: [[t, y], …]}` for drawing (skim curves are sampled at every node) and `segments: [{x, upper, lower}]`, the region to shade.

## 2. Clusters

Peaks that are not separated by baseline form a **cluster**. `clusters(x, y, peaks)` groups neighbouring peaks (in time order) when either:

- their bounds overlap, or
- their bounds touch or nearly touch (a gap of at most half the narrower peak's width), **and** the signal between them stays above the straight line from the first peak's start to the second peak's end by more than `valleyFrac` (default 2 %) of the smaller peak's height.

Peaks that are separated by baseline stay on their own, even when their bounds touch. Inside a cluster, a small gap between two automatic peaks is closed at the valley (the minimum of the lightly smoothed signal), and a note records it. Manual bounds are never moved.

The **common baseline** of a cluster is the straight line from the signal at the cluster start `T_s` to the signal at the cluster end `T_e`.

## 3. Clip modes

Each peak's mode is resolved in this order:

1. `peak.clip`, if set;
2. otherwise `'valley'` for manual (click-to-integrate) peaks, which keeps the straight line between the clicked points;
3. otherwise the `clip` option (the project default is `'drop'`).

`clipOptions(x, y, peaks, clusterIdx)` computes every mode for one cluster side by side, together with a recommendation, for the "How should these peaks be split?" dialog.

### `drop`: perpendicular drop to a common baseline

The baseline is the cluster's common line. Each peak is the area above that line between vertical lines dropped at its bounds (the valleys).

```
b(t) = y(T_s) + (y(T_e) − y(T_s))·(t − T_s)/(T_e − T_s)
```

Picture a single straight ruler laid under the whole cluster, with a vertical line drawn down from each valley to the ruler.

- **Strength:** the total cluster area is conserved, and each peak's area is accurate for similar-height, partially resolved peaks.
- **Weakness:** when the heights are very different and R_s < about 1.5, area moves from the small peak to the large one.
- **Isolated peaks:** drop is identical to valley-to-valley.
- If the signal dips below the common line, Peakly notes the baseline penetration and suggests `baseline` or `valley` instead.

### `valley`: valley-to-valley

Each peak gets its own straight baseline between its own bounds:

```
b(t) = y(t_s) + (y(t_e) − y(t_s))·(t − t_s)/(t_e − t_s)
```

Picture a separate ruler under each peak, touching the signal at both of its valleys.

- **When to use it:** baseline-resolved peaks, or peaks on a drifting baseline that is not corrected.
- **Weakness:** in a fused cluster it removes the area under the raised valley from both peaks (−30 % at R_s = 1 for equal Gaussians, as VALIDATION §3 shows).
- **Manual windows:** this is the default for click-to-integrate peaks.

### `baseline`: baseline-to-baseline (common baseline, no penetration)

The baseline is the **lower convex hull** of the signal over the cluster: the tightest polyline from `(T_s, y(T_s))` to `(T_e, y(T_e))` that never rises above the signal. Peaks are then split by vertical drops at the valleys, as in `drop`.

Picture a string pulled tight underneath the cluster. Where the signal sags below the straight ruler, the string follows it down.

- **On a flat or concave baseline:** this mode equals `drop`.
- **Where the straight common line would cut through the signal:** for example, where a valley dips below it, this mode removes that negative contribution.

### `skim-tangent`: tangent skim

This mode is for a small **rider** peak on the tail (or front) of a much larger **parent**.

1. Start from the valley point `(t_v, y_v)`. `y_v` is read from a lightly smoothed signal `ỹ`, a Savitzky–Golay quadratic over 5–15 points.
2. Draw the straight line through the valley that just touches the parent's tail beyond the rider:

```
m = min over t_j after the rider apex of (ỹ_j − y_v)/(t_j − t_v)        (tail rider)
m = max over t_j before the rider apex of (ỹ_j − y_v)/(t_j − t_v)       (front rider)
b(t) = y_v + m·(t − t_v),  from t_v to the tangent point t*
```

The rider is the area above that line. The parent keeps the area below it, above the common baseline.

Picture a ruler balanced on the valley and rotated down until it rests on the parent's tail. The rider is what pokes up above the ruler.

**Bias:** an exponential tail is convex, so the true tail lies *below* the tangent. Tangent skim therefore under-reads the rider: about −9 % at parent/rider = 10 and −43 % at 50 in VALIDATION §5. It is still far better than `drop`, which gives the rider the whole tail under it.

### `skim-exp`: exponential skim

This mode models the parent's tail as an exponential and removes it from under the rider.

1. **Estimate the rider's width.** `σ_r` is the half-width at half height on the rider's far flank, measured above the tangent line, divided by 1.1774.
2. **Fit the parent's tail.** The fit window is the stretch of tail that ends 4σ_r before the rider apex (or at the valley, whichever is nearer the parent) and spans 16σ_r towards the parent. Only points with `3σ < ỹ − c ≤ H_parent/2` are used, where `c` is the common baseline. The fit runs in two stages:
   - a weighted log-linear fit `ln(ỹ − c) = α + β(t − t_v)` with weights `(ỹ − c)²`;
   - a refinement of `ỹ − c = z₀·exp(β(t − t_v)) + c₀` by separable least squares: a golden-section search on ln τ, with `z₀` and `c₀` linear at each step. The offset `c₀` absorbs a common baseline that ends on the parent's tail rather than at the true baseline.
3. **Build the skim curve.** `b(t) = c(t) + z₀·exp(∓(t − t_v)/τ) + c₀`, with `τ = 1/|β|`.
4. **Find the rider's extent.** Walk outward from the rider apex in both directions until `ỹ − b` falls to `max(σ/2, 0.2 % of the rider height)`. The rider is the area between the signal and the curve over that span.

The curve is fitted to the tail *before* the rider and is **not** forced through the valley point, because the rider's own front lifts the valley. If the tail fit fails (fewer than 4 usable points, or no decay), Peakly uses the tangent skim and says so in the notes.

**Accuracy:** in VALIDATION §5, with automatically detected bounds and noise, the rider error is −1 % at parent/rider = 10, −3 % at 20 and −6 % at 50. In the unit tests, with exact tails, it is within 0.1 %.

### Parents of skimmed riders

A parent is integrated above the common baseline over its own bounds plus its riders' bounds. Under each rider, the signal is replaced by that rider's skim curve. The parent therefore keeps the tail under the rider, and **parent + riders = the drop total of the same region**, exactly. Boundary nodes are duplicated so that the shaded polygons meet cleanly.

### The skim criterion (Dyson rule)

Skimming is applied only when

```
H_parent / H_rider ≥ skimRatio      (default 10)
```

- `H_parent` is the parent's height above the common baseline.
- `H_rider` is the rider's height above the straight line between its own bounds.
- The parent is the nearest peak in the cluster that meets the ratio. If two qualify at the same distance, the taller one is used.

Otherwise the rider is integrated with `drop`. `math.notes` gives the ratio, for example *"Skim not applied: parent/rider height ratio 5.9 < skimRatio 10 (Dyson criterion); perpendicular drop used instead."* A peak with no height above its own valley line (≤ 3σ) is never skimmed.

The ratio of 10 follows common chromatography-data-system practice described by Dyson. Lower it (`skimRatio`) only when the parent's tail is clearly resolved.

### `fit`: deconvolution

All peaks of the cluster are fitted jointly with `fitPeaks`:

- the signal used is the signal minus the common baseline, over [T_s, T_e];
- `model` is `'gaussian'` (default) or `'emg'`.

Each fit-mode peak's area is the analytic component area `A·σ·√(2π)`, which includes the tails beyond the window. The `math` steps list A, μ, σ, τ, the area SE, the fit R² and the part of the component area that falls inside the window. For consistency, `grossArea` is defined as `baselineArea + netArea`. If the fit throws, the peak falls back to `drop` with a note.

- **Strength:** nearly unbiased when the model is right (VALIDATION §3).
- **Weakness:** biased when the model is wrong. A Gaussian fit to a tailing peak reads −10 % at τ/σ = 3. Fits can also converge to a wrong split for small riders (VALIDATION §5), so `fit` is never the automatic default.

## 4. Which mode should I use?

| situation | mode | why |
|---|---|---|
| isolated peak | any (`drop` = `valley` = `baseline`) | one peak, one line |
| fused peaks of similar height | `drop` | conserves total; split error cancels |
| fused peaks, very different heights, R_s < 1.5 | `fit` if the shape model is good; else `drop` and state the bias | drop moves area into the large peak |
| small peak on the tail/front of a large one (ratio ≥ 10) | `skim-exp`; `skim-tangent` if the tail is short or not exponential | removes the parent's tail from the rider |
| valley dips below the straight cluster line | `baseline` or `valley` | avoids negative contributions |
| uncorrected drifting baseline | correct with ALS first; then `drop` | VALIDATION §2 |
| manual click-to-integrate window | `valley` (default) | the line between the clicked points |

`clipOptions()` recommends a mode by these rules:

- **skim:** when a rider passes the Dyson criterion;
- **fit:** when the valley is above 50 % of the smaller peak's height and the fit succeeds;
- **drop:** otherwise.

## 5. Heights, widths and other metrics

`peakMetrics(x, y, peaks, opts)` measures height, FWHM, W₀.₀₅, tailing, asymmetry, plates and S/N on the region between `upper` and `lower` of the applied integration. So a rider's height is its height above the skim curve, and a fitted peak's width is the width of its component. There are four ways to pass the baseline:

1. `{integration: integrate(...)}`;
2. the `integrate()` results passed directly as `peaks`;
3. `{clip, skimRatio, model}`, which runs `integrate()` internally;
4. `{baselines: {peakId: [[t, y], …]}}`, a custom polyline.

Without any of these, the original call keeps its original behaviour: a straight line between `y(start)` and `y(end)`. Metrics with non-positive height or area are flagged (`valid: false`, `flags`, `warning`) and left out of Area %. They are never silently dropped, so the output stays aligned with the input peaks.

## 6. Worked example: the built-in sample

The sample chromatogram is `syntheticChromatogram({seed: 42})`, ALS-corrected with λ = 1e8 and p = 0.001. `detectPeaks` finds 8 peaks. Only the critical pair at 7.36 and 7.64 min forms a cluster: bounds 7.165–7.50 and 7.51–7.87 min, joined at the valley 7.505. The valley sits at about 8 % of the smaller peak's height, and `clipOptions` recommends `drop`.

**First peak with `drop`**, from the `math.steps`:

| step | value |
|---|---|
| t_start, t_end | 7.165, 7.505 min |
| n | 69 nodes, Δt = 0.005 min |
| cluster start / end T_s, T_e | 7.165 / 7.87 min |
| baseline at start / end | 0.1454 / 0.1077 mAU (on the common line to (7.87, 0.0672)) |
| gross area G | 7.8259 mAU·min |
| baseline area B | 0.0430 mAU·min |
| net area A = G − B | **7.7828 mAU·min** (= 467.0 mAU·s) |

**Both peaks with each mode** (true areas 7.8191 and 6.0121 mAU·min):

| mode | peak 1 | peak 2 | comment |
|---|---|---|---|
| drop | 7.7828 (−0.5 %) | 5.9935 (−0.3 %) | standard choice here |
| valley | 7.1936 (−8.0 %) | 5.3609 (−10.8 %) | the raised valley is cut out |
| baseline | 7.8049 (−0.2 %) | 6.0146 (+0.04 %) | the hull dips slightly below the straight line at the ends |
| fit (EMG) | 7.7927 (−0.3 %) | 5.9931 (−0.3 %) | analytic component areas |

## 7. Limitations

- **Noise:** detected bounds move inwards as noise grows, so areas under-read by about 2 % at S/N 17–33 (VALIDATION §1). Widen the bounds manually when this matters.
- **Skim geometry:** it uses a lightly smoothed signal and assumes an exponential (or at least convex) parent tail. Very short tails leave too few points for `skim-exp`, which then falls back to `skim-tangent`.
- **Parent tails:** the cluster ends at the last detected bound. A parent's long tail beyond that point is lost to every mode (≈ −5 % for the τ/σ = 6 parent in VALIDATION §5).
- **No vendor emulation:** Peakly does not emulate any vendor's integration events (tangent-skim timing, baseline hold, and so on). Results are close to, but not identical with, any particular commercial system.
- **Use:** for research and education. Not validated for regulated (GMP/GLP) workflows.

## References (by name)

- N. Dyson, *Chromatographic Integration Methods*, 2nd ed., Royal Society of Chemistry (1998): drop, valley, tangent and exponential skimming, and the height-ratio skim criterion.
- USP General Chapter <621> *Chromatography*, and Ph. Eur. 2.2.46: peak measurements and system suitability.
- E. Grushka, *Anal. Chem.* 44 (1972) 1733: the exponentially modified Gaussian.
- J. P. Foley & J. G. Dorsey, *Anal. Chem.* 55 (1983) 730: EMG figures of merit.
- Yu. Kalambet et al., *J. Chemometrics* 25 (2011) 352: numerically stable EMG; integration and deconvolution errors.
