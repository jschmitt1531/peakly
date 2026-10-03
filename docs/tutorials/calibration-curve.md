# Tutorial: calibration curve and unknowns

**You need:** chromatograms of standards at known concentrations, and of your unknowns (or typed-in responses). **Time:** 10 minutes.

Background and formulas: [CALIBRATION.md](../CALIBRATION.md).

## 1. Load the runs

Load all standard and unknown runs (multi-select in **Import**, or drop several files). Integrate the analyte peak in each: detect with **p**, or integrate the same window across runs with "apply same window to all traces" in **Compare** ([compare tutorial](compare-runs.md)). Check that the analyte peak is integrated consistently, with the same clipping mode, in every run.

## 2. Define the analyte

Open the **Calibration** panel and add an analyte:
- **Name** (e.g. caffeine).
- **Peak match:** retention time and tolerance (e.g. 4.21 ± 0.10 min). In each run, the peak with apex closest to this RT within the tolerance is used.
- **Response:** area (usual) or height.

## 3. Add levels

For each standard, add a level: its **concentration** and unit, and either the **trace** (the response is read from its matched peak) or a typed-in **response**. Untick **include** to exclude an outlier without deleting it (and say why in your notes).

Use at least 5 levels spanning the expected range; replicate injections count as separate levels at the same concentration.

![Calibration levels table](../img/tutorial-calibration-1.png)

## 4. Choose the model and weighting

| Model | Use when |
|---|---|
| **Linear** y = b₀ + b₁x | Default |
| **Linear through origin** y = b₁x | Intercept is not significantly different from 0 and you have a reason to force it |
| **Quadratic** | Detector response curves at high concentration (and you have enough levels) |

| Weighting | Use when |
|---|---|
| none | Residuals are similar in size across the range |
| 1/x or 1/x² | The range spans more than about one order of magnitude and residuals grow with concentration (common) |

Look at the **residual plot**: it should show no trend. Check R², s(y/x) and back-calculated recoveries for each standard (typically within ±15 %, ±20 % at the lowest level, for bioanalytical-style criteria).

![Fit with residuals](../img/tutorial-calibration-2.png)

## 5. Read unknowns

Every other trace with a matched peak gets a **Conc.** value in the peak table, with a ± (95 % interval from inverse prediction) and an ⓘ audit showing the calculation. Flags:
- **extrapolated:** outside the calibrated range; not reliable.
- **below LOQ / below LOD:** LOQ = 10·s(y/x)/slope, LOD = 3.3·s(y/x)/slope (ICH Q2 approach using the residual SD).

## 6. Export

The peak table CSV includes `analyte`, `conc`, `conc_lo`, `conc_hi` and `conc_flags` columns ([SCHEMA.md](../SCHEMA.md)); the PDF report includes the curve and its statistics.

**Reminder:** for research and education use; not validated for regulated (GMP/GLP) workflows.
