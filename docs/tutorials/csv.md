# Tutorial: CSV and text files

**You need:** [`samples/data/delimited.csv`](../../samples/data/delimited.csv) (or your own two-column export). **Time:** 3 minutes.

## 1. Open the file

1. Open Peakly.
2. Drag `delimited.csv` onto the window, or click **Import → Choose files…** (shortcut **o**).
3. Peakly detects the delimiter (comma, tab, semicolon or spaces), decimal separator (point or comma), header row and units, and plots the trace.

## 2. Check units

Peakly works in **minutes**. If the header says `Time (s)`, `sec` or `ms`, it converts automatically. Check the x axis: if a 20-minute run shows as 1200, the time column was in seconds without a unit in the header; use the column mapper (next step) and set the x unit to seconds.

Intensity keeps the unit found in the header (`mAU`, `AU`, `mV`, …), or `a.u.` if none.

## 3. If the file is not recognized: map columns by hand

If Peakly cannot confidently read a file, or you click **"My format isn't working"**, the column mapper opens with the raw text:

1. Choose the **delimiter** and **decimal** separator until the preview shows clean columns.
2. Set the **header row** (or "none") and skip any preamble lines.
3. Pick the **x column** and one or more **y columns** (each y column becomes a trace).
4. Set the **x unit** (min, s, ms, h) and **y unit**.
5. Click **Use this text** / import.

![Column mapper](../img/app-overview.png)

## 4. Pasting numbers

You can also paste two columns copied from a spreadsheet: **Paste data** (shortcut **v**). The same detection and mapper apply.

## 5. Next steps

- Press **p** to detect peaks, or see [integration and clipping](integration-and-clipping.md).
- Add the gradient under **Method** (**m**) to get %B at elution.
- Several y columns? They load as overlaid traces; see [compare runs](compare-runs.md).

**Tips**
- Excel files (`.xlsx`) load the first sheet with numeric columns; try [`samples/data/xlsx.xlsx`](../../samples/data/xlsx.xlsx).
- Files with a UTF-16 byte-order mark (common from Windows instrument software) are detected automatically.
