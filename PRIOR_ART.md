# Prior art and licensing

Peakly is an independent project, not affiliated with OpenChrom®/Lablicate or any project listed below. **No code was copied from any of them.** Algorithms come from the published literature and file layouts from public format descriptions. Peakly's own code is written from scratch.

| Project | License | What it offers | Reused / reimplemented / skipped |
|---|---|---|---|
| [OpenChrom / Eclipse ChemClipse](https://github.com/eclipse-chemclipse/chemclipse) (Java) | EPL-2.0 | Many importers; baseline, peak detection and integration plugins | **Reimplemented ideas only.** Pluggable importer registry; detect→integrate→report pipeline. EPL code is not copied, and Java can't run in the browser. |
| [chromatoPy](https://github.com/GerardOtiniano/chromatoPy) (Python; G. Otiniano) | MIT | Single and multi-Gaussian fits with area uncertainty | **Approach reimplemented independently in JS** (no code copied): Levenberg–Marquardt Gaussian/EMG fit; area SE from the covariance matrix. Interop: Peakly imports chromatoPy output files. |
| [MOCCA2](https://github.com/Bayer-Group/MOCCA) (Python; Bayer) | MIT | HPLC-DAD processing; JSON serialization of results | **Interop only.** Peakly imports MOCCA2's `to_dict()` JSON, written from its documented field names. No code used. |
| [rainbow](https://github.com/evanyeyeye/rainbow) (Python; E. Shi et al.) | LGPL-3.0 | Prose documentation of Agilent ChemStation .ch/.uv binary layouts | **Reimplemented from the format documentation** (offsets, delta encoding). No rainbow code is used. |
| [chromConverter](https://github.com/ethanbass/chromConverter) (R; E. Bass) | GPL-3.0 | Wrappers for many vendor parsers | **Skipped (code).** Used only as a survey of which vendor exports are common. |
| [entab](https://github.com/bovee/entab) (Rust/WASM; R. Bovee) | MIT | Agilent CH/FID/UV/MS, Thermo readers | **Skipped.** Its WASM build needs a bundler and a separate .wasm file, which breaks single-file sharing. Native JS readers cover Agilent .ch. |
| [WebPlotDigitizer](https://github.com/automeris-io/WebPlotDigitizer) (A. Rohatgi) | AGPL-3.0 | Axis calibration, color-mask trace extraction | **Reimplemented concepts only** (2-point axis calibration, color-distance mask, per-column extraction, homography). No AGPL code. |

Licenses above were re-checked with the GitHub API on 2026-10-05.

Runtime libraries (loaded from CDNs, pinned; details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):
- Plotly.js 2.35.2 (MIT)
- SheetJS xlsx 0.18.5 (Apache-2.0)
- pako 2.1.0 (MIT AND Zlib)
- lz-string 1.5.0 (MIT)
- jsPDF 2.5.1 (MIT)
- pdf.js 3.11.174 (Apache-2.0)

Published methods, standards and data-format specifications are cited in [docs/CREDITS.md](docs/CREDITS.md) and in the reference sections of [docs/CALCULATIONS.md](docs/CALCULATIONS.md), [docs/INTEGRATION.md](docs/INTEGRATION.md) and [docs/CALIBRATION.md](docs/CALIBRATION.md). Code was written with the assistance of Claude (Anthropic) and reviewed, tested and maintained by Jennifer Schmitt; no third-party code was supplied to or copied through that process.
