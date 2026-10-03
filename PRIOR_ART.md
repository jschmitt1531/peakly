# Prior art and licensing

Peakly is an independent project, not affiliated with OpenChrom®/Lablicate or any project listed below. **No code was copied from any of them.** Algorithms come from the published literature and file layouts from public format descriptions. Peakly's own code is written from scratch.

| Project | License | What it offers | Reused / reimplemented / skipped |
|---|---|---|---|
| OpenChrom / Eclipse ChemClipse (Java) | EPL-2.0 | Many importers; baseline, peak detection and integration plugins | **Reimplemented ideas only.** Pluggable importer registry; detect→integrate→report pipeline. EPL code is not copied, and Java can't run in the browser. |
| chromatoPy (Python) | MIT | Single and multi-Gaussian fits with area uncertainty | **Reimplemented in JS.** Levenberg–Marquardt Gaussian/EMG fit; area SE from the covariance matrix. |
| rainbow (Python) | LGPL-3.0 | Prose documentation of Agilent ChemStation .ch/.uv binary layouts | **Reimplemented from the format documentation** (offsets, delta encoding). No rainbow code is used. |
| chromConverter (R) | GPL-3.0 | Wrappers for many vendor parsers | **Skipped (code).** Used only as a survey of which vendor exports are common. |
| entab (Rust/WASM) | MIT | Agilent CH/FID/UV/MS, Thermo readers | **Skipped.** Its WASM build needs a bundler and a separate .wasm file, which breaks single-file sharing. Native JS readers cover Agilent .ch. |
| WebPlotDigitizer | AGPL-3.0 | Axis calibration, color-mask trace extraction | **Reimplemented concepts only** (2-point axis calibration, color-distance mask, per-column extraction, homography). No AGPL code. |

Runtime libraries (loaded from CDNs, pinned):
- Plotly.js 2.35.2 (MIT)
- SheetJS xlsx 0.18.5 (Apache-2.0)
- pako 2.1.0 (MIT/Zlib)
- lz-string 1.5.0 (MIT)
- jsPDF 2.5.1 (MIT)
- pdf.js 3.11.174 (Apache-2.0)
