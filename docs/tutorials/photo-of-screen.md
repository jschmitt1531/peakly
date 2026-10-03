# Tutorial: digitize a phone photo of a screen or printout

**You need:** a phone photo of a chromatogram on a monitor or on paper. **Time:** 5–10 minutes.

Photos add perspective distortion (the plot is a trapezoid, not a rectangle), uneven lighting, moiré patterns from screens, and lens distortion. Peakly corrects perspective; the rest you minimise when taking the photo. Expect larger errors than with a screenshot ([accuracy](../DIGITIZER_ACCURACY.md)); a screenshot or the original data is always better if you can get it.

## 1. Take a good photo

- Hold the phone **square-on** to the screen or page, filling the frame with the plot.
- Avoid glare: turn off overhead lights reflecting in the screen, or tilt slightly.
- Make sure the **four corners of the plot area** (the axis box) are visible.
- For screens, step back a little and zoom in to reduce moiré.
- Keep the phone steady; use the highest resolution.

## 2. Open and correct perspective

1. **Digitize an image** (**i**) → drop the photo, or use **Camera** on a phone.
2. In **Prep**, choose **Perspective**.
3. Click the **four corners of the plot area** in order (the corners where the axes meet and their opposites). Use the axis box corners, not the screen bezel.
4. **Apply perspective**. The plot becomes a rectangle.

![Four corner points on a skewed photo](../img/tutorial-photo-1.png)
![After perspective correction](../img/tutorial-photo-2.png)

## 3. Clean up

- **Brightness/contrast** to even out lighting; a **threshold** can help for black-and-white printouts.
- **Crop** to the corrected plot area.
- Use **deskew** if a small rotation remains.

## 4. Calibrate, extract, verify

Follow steps 3–6 of the [screenshot tutorial](image-screenshot.md). For photos:
- Use a **higher colour tolerance**; colours shift under room light.
- For a printout in black ink, use the **dark** (black trace) mode rather than a colour.
- Check the overlay carefully at peak apexes and near the edges, where lens distortion is largest.
- Expect quality warnings; read them.

## Limits

Perspective correction assumes a **flat** plot. Curled paper and curved screens leave residual distortion that calibration cannot remove. Lens (barrel) distortion is not corrected; keep the plot in the centre of the frame. Report RTs and area % from photos as approximate.
