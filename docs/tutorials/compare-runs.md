# Tutorial: compare runs

**You need:** two or more runs, e.g. the built-in **HPLC run + blank** sample, or several files from [`samples/data/`](../../samples/data/). **Time:** 5 minutes.

## 1. Overlay

Load several files (they overlay on shared axes, each in its own colour, with a legend). Mixed sources are fine: files, pasted data and digitized images can be compared, and digitized traces keep their badge.

Use the trace list to show/hide, rename, recolour and reorder traces; the active trace (bold) is the one the cursor and peak tools act on (switch with `[` and `]`).

![Overlaid runs](../img/tutorial-compare-1.png)

## 2. Normalize, align, offset

In the overlay options:
- **Normalization:** none, **max** (tallest point = 1) or **area** (total area = 1). Use max or area to compare shapes across different injection amounts.
- **Align:** shift a trace in time, or **align to selected peak** to line up a reference peak across runs (corrects small RT drift).
- **Waterfall:** vertical offsets to separate traces; **reset offsets** to undo.
- **Difference:** subtract one trace from another (e.g. sample − blank). The second trace is resampled onto the first's time points.

## 3. Match peaks across runs

1. Detect peaks in each trace (**p** with each active), or integrate one window and use **apply same window to all traces** for consistent bounds.
2. Click **Compare**. Peaks are matched across visible traces by retention time within a tolerance.
3. The comparison table shows, for each matched peak, its RT and area in every run, **ΔRT** and **area ratio** relative to the reference trace.
4. Choose the reference trace and the RT tolerance; unmatched peaks are listed separately.

![Compare table](../img/tutorial-compare-2.png)

## 4. Export

Export the comparison as **CSV**, or include it in the **PDF report**. Figures (**PNG/SVG**) keep the overlay exactly as shown.

**Tips**
- Compare like with like: same detector wavelength, same units. Normalization does not fix different wavelengths.
- For a stability or purity series, align on the main peak first, then match the impurities.
