# Third-party notices

Peakly's own source code is © 2026 Jennifer Schmitt and released under the [MIT License](LICENSE).

## No third-party code is vendored in this repository

Nothing in this repository is copied from another project. The runtime libraries below are **not** stored in the repo and are **not** inlined into `index.html` by `node build.js`. The built `index.html` contains `<script src="…">` tags that load each library, at a pinned version, from a public CDN (cdnjs.cloudflare.com or cdn.jsdelivr.net) when the page opens in a browser. Each library is distributed under its own license by its authors; when you open Peakly, your browser downloads it directly from the CDN.

If you redistribute a build that **bundles** any of these libraries (for example an offline copy with the scripts inlined), you must include that library's license text and notices with it. Apache-2.0 libraries also require keeping their `NOTICE` file, if any.

## Runtime libraries (loaded from CDNs at runtime)

Licenses were checked against the npm registry metadata for the exact pinned versions on 2026-10-03 and re-checked on 2026-10-05.

| Library | Version | License (SPDX) | Used for | Source | CDN URL loaded by Peakly |
|---|---|---|---|---|---|
| Plotly.js (`plotly.js-dist-min`) | 2.35.2 | MIT | Interactive plotting | https://github.com/plotly/plotly.js | https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js |
| SheetJS Community Edition (`xlsx`) | 0.18.5 | Apache-2.0 | Reading `.xlsx` / `.xls` | https://github.com/SheetJS/sheetjs (https://sheetjs.com/) | https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js |
| pako | 2.1.0 | MIT AND Zlib | zlib inflate for mzML binary arrays | https://github.com/nodeca/pako | https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js |
| lz-string | 1.5.0 | MIT | Compressing projects into share links | https://github.com/pieroxy/lz-string | https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js |
| jsPDF | 2.5.1 | MIT | PDF report export | https://github.com/parallax/jsPDF (npm metadata: github.com/MrRio/jsPDF) | https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js |
| PDF.js (`pdfjs-dist`) | 3.11.174 | Apache-2.0 | Rendering a PDF page to an image for the digitizer | https://github.com/mozilla/pdf.js | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js (+ `pdf.worker.min.js`) |

Notes:
- pako is dual-attributed: its JavaScript is MIT, and it is a port of zlib, whose license (Zlib) also applies. The npm `license` field for 2.1.0 is `(MIT AND Zlib)`.
- SheetJS 0.18.5 is the last Community Edition published to the public npm registry. Later versions are distributed from the SheetJS CDN; any upgrade must re-check the license.

## Optional network service (not a library)

The optional "Claude assist" in the image digitizer sends one image to the Anthropic Messages API (`https://api.anthropic.com/v1/messages`) **only** when a user pastes their own API key and clicks the button. No Anthropic SDK or code is included. Use of that API is governed by the user's own agreement with Anthropic. See [SECURITY.md](SECURITY.md).

## Text and conventions adapted from others

| Item | License | Notice |
|---|---|---|
| [Contributor Covenant](https://www.contributor-covenant.org), version 2.1 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) is adapted from the Contributor Covenant 2.1 (summarized and shortened; reporting channels changed for Peakly). Its enforcement guidelines, linked rather than copied, were inspired by Mozilla's code of conduct enforcement ladder. |
| [Semantic Versioning 2.0.0](https://semver.org/) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Referenced (not copied) in CHANGELOG.md, GOVERNANCE.md and docs/RELEASING.md. |
| [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) | MIT | CHANGELOG.md follows its format. |
| [Citation File Format 1.2.0](https://citation-file-format.github.io/) | CC-BY-4.0 | CITATION.cff follows the schema. |
| W3C WAI [accessibility statement guidance](https://www.w3.org/WAI/planning/statements/) | W3C | Structure of docs/ACCESSIBILITY_STATEMENT.md (written for Peakly; no text copied). |

## Projects referenced but not copied

These projects informed Peakly's design or are documented as interoperability targets. **No code from any of them is included in Peakly.** Copyleft-licensed projects (EPL, GPL, LGPL, AGPL) were consulted only for concepts or prose format descriptions; see [PRIOR_ART.md](PRIOR_ART.md).

| Project | License (SPDX) | URL | Relationship to Peakly |
|---|---|---|---|
| Eclipse ChemClipse / OpenChrom | EPL-2.0 | https://github.com/eclipse-chemclipse/chemclipse | Ideas only: pluggable importers, detect → integrate → report pipeline |
| chromatoPy (G. Otiniano) | MIT | https://github.com/GerardOtiniano/chromatoPy | Ideas only: multi-Gaussian fitting with area uncertainty from covariance. Interop: Peakly reads chromatoPy output files, written from its documented output keys (see [docs/SCHEMA.md](docs/SCHEMA.md)) |
| MOCCA2 (Bayer) | MIT | https://github.com/Bayer-Group/MOCCA | Interop only: Peakly reads MOCCA2's JSON serialization, written from its documented field names (see [docs/SCHEMA.md](docs/SCHEMA.md)) |
| rainbow (E. Shi et al.) | LGPL-3.0 | https://github.com/evanyeyeye/rainbow | Prose documentation of Agilent `.ch` binary layouts was read; no code used |
| chromConverter (E. Bass) | GPL-3.0 | https://github.com/ethanbass/chromConverter | Survey of common vendor export formats; no code used |
| entab (R. Bovee) | MIT | https://github.com/bovee/entab | Reference for Agilent/Thermo readers; not used (WASM would break the single-file design) |
| WebPlotDigitizer (A. Rohatgi) | AGPL-3.0 | https://github.com/automeris-io/WebPlotDigitizer | Concepts only: axis calibration and colour-mask extraction; no code used |

Peakly is an independent project and is not affiliated with or endorsed by any of the projects, companies or instrument vendors named here. Product names are trademarks of their respective owners and are used only to describe file compatibility ([docs/TRADEMARKS.md](docs/TRADEMARKS.md)).

The full list of credits, including published algorithms, standards, data-format specifications and development tools, is in [docs/CREDITS.md](docs/CREDITS.md).
