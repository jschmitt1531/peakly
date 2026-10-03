# Tutorial: digitize a screenshot or PDF figure

**You need:** a screenshot or image of a chromatogram, or Peakly's built-in **Sample image**. **Time:** 5 minutes.

Digitizing turns a *picture* of a chromatogram into approximate data. Read [Known limits](../../README.md#known-limits) and [DIGITIZER_ACCURACY.md](../DIGITIZER_ACCURACY.md) first: retention times and area % of resolved peaks are reliable; absolute values are not.

## 0. Get the best image you can

- A **PNG screenshot** at full screen size beats a JPEG, a thumbnail or a photo. Aim for a plot area **at least 600–900 px wide**.
- Hide legends and annotations that sit on top of peaks, if the source software allows.
- For a PDF, Peakly renders the page; pick the page and crop to the figure.

## 1. Open the digitizer

Click **Digitize an image** (shortcut **i**), then drop, paste (Ctrl/⌘+V) or choose the image. Or click **Sample image** to practice.

The digitizer has five steps: **Prep → Calibrate → Extract → Verify → Send**.

## 2. Prep

- **Crop** to the plot, **rotate** or **deskew** if the image is tilted.
- Adjust **brightness/contrast** if the trace is faint.
- Photos of screens or paper need perspective correction instead: see [photo of a screen](photo-of-screen.md).

![Prep step](../img/tutorial-image-1.png)

## 3. Calibrate the axes

1. Place **X1** and **X2** on two labelled x-axis ticks **far apart** (e.g. 2 and 18 min) and type their values.
2. Place **Y1** and **Y2** on two y ticks far apart (e.g. 0 and 250 mAU).
3. Mark an axis as **log** only if it really is logarithmic.
4. Optional: **Read axes with Claude** pre-fills ticks, labels and printed peak values (needs your own API key; see [SECURITY.md](../../SECURITY.md#api-key-handling-optional-claude-assist)). Always check and **Confirm calibration** yourself.

Zoom in to place markers precisely: a 1 px error on points 150 px apart is a 0.7 % scale error.

![Calibration markers on ticks](../img/tutorial-image-2.png)

## 4. Extract the trace

1. Pick the trace colour with the **eyedropper** (click the trace), or let Peakly auto-detect colours.
2. Adjust the **tolerance** until the mask covers the line but not gridlines or text.
3. **Exclude** legend boxes and labels by dragging rectangles over them.
4. Choose **centroid** (default; best for thin lines) or **top** extraction.
5. For multiple traces in one image, **Add a trace** and pick the next colour.

## 5. Verify

The extracted curve is overlaid on the image. Use the **opacity** slider to compare. Check:
- apexes are not flattened (a legend or label hiding a peak top is the most common failure);
- **coverage** is near 100 % and no long gaps were bridged;
- the **quality warnings** (low resolution, JPEG artifacts, poor calibration spread).

If the image has printed RTs/area %, Peakly compares them with the computed values and flags mismatches.

![Verify overlay](../img/tutorial-image-3.png)

## 6. Send to plot

Click **Send**. The trace arrives labelled **digitized**, with ± uncertainty (half a pixel in x and y). All exports carry the digitized flag.

**Next:** detect peaks. Digitized traces are pixel staircases, so turn on light smoothing or raise the detection threshold, or integrate peaks by hand ([integration tutorial](integration-and-clipping.md)).
