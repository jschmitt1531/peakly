# Tutorial: vendor text exports

Most chromatography data systems can export a chromatogram as text. Peakly recognizes the common layouts automatically. This page gives **general guidance**; exact menu names vary between software versions and site configurations, so we describe where the option *typically* lives rather than exact click paths. If you know the exact path for your version, please [improve this page](../../CONTRIBUTING.md).

## General approach (any software)

1. Open the run (injection / result) in the vendor software.
2. Look for **Export**, **Save as**, **Copy to clipboard** or a report/export method that writes the **chromatogram data points** (time vs signal), not only the peak table.
3. Choose a **text/ASCII/CSV** format. If offered, include the header/metadata.
4. Prefer the **raw** signal (no smoothing) and **minutes** as the time unit.
5. Drop the exported file into Peakly. If it isn't recognized, use **"My format isn't working"** to map the columns (see [CSV tutorial](csv.md)), and consider sending us a [format request](https://github.com/OWNER/peakly/issues/new?template=format_request.yml).

Alternatively, many systems can export **AnDI/netCDF (`.cdf`)**, an open standard Peakly reads well ([binary files tutorial](binary-files.md)).

## Vendor notes

| Software | What Peakly reads | Where the export typically is | Sample |
|---|---|---|---|
| Agilent ChemStation / OpenLab | CSV/TXT signal exports (incl. UTF-16), and `.ch` signal files directly | ChemStation: typically an export/"Export Data" option for the signal, or use the `.ch` file inside the `.D` folder directly. OpenLab CDS: typically via export in Data Analysis | [`agilent-text.csv`](../../samples/data/agilent-text.csv), [`agilent-ch.ch`](../../samples/data/agilent-ch.ch) |
| Thermo Chromeleon | ASCII export with a header block and a `Chromatogram Data:` table | Typically an export option on the injection/chromatogram (ASCII/text) | [`chromeleon.txt`](../../samples/data/chromeleon.txt) |
| Shimadzu LabSolutions | ASCII export with `[Chromatogram (Ch1)]` sections and a `Multiplier` | Typically the data file's ASCII/text export (File menu or Postrun) | [`shimadzu.txt`](../../samples/data/shimadzu.txt) |
| Waters Empower | `.arw` text export (quoted header lines, then time/signal) | Typically an export method that writes `.arw` files from the review window | [`waters-arw.arw`](../../samples/data/waters-arw.arw) |
| Cytiva UNICORN | CSV/ASC export with paired columns (`ml, mAU, ml, mS/cm, …`) | Typically the evaluation module's export of curves | [`unicorn.asc`](../../samples/data/unicorn.asc); see [FPLC tutorial](fplc-unicorn.md) |
| Bio-Rad ChromLab / NGC | Multi-column CSV (time or volume, UV, conductivity, %B) | Typically an export of run data to CSV | [`biorad.csv`](../../samples/data/biorad.csv) |
| Other / generic | Any delimited text | Any "export data points" option | [`delimited.csv`](../../samples/data/delimited.csv) |

## What comes across

- **Signal** in its native unit (usually mAU), time converted to minutes.
- **Metadata** found in headers (sample name, wavelength, instrument, injection volume) fills **Run info**; click "fill from file" to copy it into empty fields.
- **Extra channels** (conductivity, %B, pressure) become separate traces marked as auxiliary, drawn on a second axis.

## Common problems

- **Only a peak table was exported.** Peakly needs the data points. Look for "signal", "chromatogram" or "raw data" export.
- **Numbers look 1000× off.** Check the y unit (AU vs mAU) and any multiplier in the header (Shimadzu exports scale by `Multiplier`).
- **Time looks 60× off.** The time column was in seconds; set the x unit in the column mapper.
- **Garbled text.** The file may be UTF-16 without a byte-order mark; save as UTF-8 or send us a sample.
