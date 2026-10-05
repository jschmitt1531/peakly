# Credits

Peakly is created and maintained by **Jennifer Schmitt, Ph.D.**, and is free to use under the [Peakly Free-Use License](../LICENSE) (all other rights reserved). This page credits everything Peakly builds on: libraries, prior projects, published methods, standards, specifications, templates and tools. Licenses were checked on 2026-10-05 against the GitHub API (`license.spdx_id`) or the npm registry for the exact pinned versions, unless noted.

**No third-party code is copied into this repository.** Runtime libraries are loaded from CDNs at pinned versions; algorithms are written from the published literature; file layouts come from public format descriptions. See [PRIOR_ART.md](../PRIOR_ART.md) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## AI assistance

Code written with the assistance of Claude (Anthropic); reviewed, tested and maintained by Jennifer Schmitt. Documentation was drafted the same way and reviewed by Jennifer Schmitt. All formulas are checked against the cited literature and reference values ([VALIDATION.md](VALIDATION.md)), and the test suite (`node tests/run.js`) runs on every change.

## Runtime libraries (loaded by the app from CDNs)

| Library | Version | License | Authors / home |
|---|---|---|---|
| Plotly.js (`plotly.js-dist-min`) | 2.35.2 | MIT | Plotly Technologies Inc. and contributors, <https://github.com/plotly/plotly.js> |
| SheetJS Community Edition (`xlsx`) | 0.18.5 | Apache-2.0 | SheetJS LLC, <https://sheetjs.com/> |
| pako | 2.1.0 | MIT AND Zlib | Vitaly Puzrin, Andrei Tuputcyn and contributors (port of zlib by Jean-loup Gailly and Mark Adler), <https://github.com/nodeca/pako> |
| lz-string | 1.5.0 | MIT | Pieroxy, <https://github.com/pieroxy/lz-string> |
| jsPDF | 2.5.1 | MIT | James Hall, yWorks GmbH and contributors, <https://github.com/parallax/jsPDF> |
| PDF.js (`pdfjs-dist`) | 3.11.174 | Apache-2.0 | Mozilla and contributors, <https://github.com/mozilla/pdf.js> |

Delivered by [jsDelivr](https://www.jsdelivr.com/) and [cdnjs](https://cdnjs.com/) (Cloudflare). Thank you to their maintainers.

## Optional service

- **Claude** (Anthropic), via the Anthropic Messages API, for the optional "Read axes with Claude" assist in the digitizer. Used only with the user's own API key; no Anthropic code or SDK is included.

## Prior projects that shaped the design (no code used)

| Project | License | Credit |
|---|---|---|
| [Eclipse ChemClipse / OpenChrom®](https://github.com/eclipse-chemclipse/chemclipse) (Philip Wenig, Lablicate GmbH and contributors) | EPL-2.0 | Pluggable importer architecture; detect → integrate → report pipeline (ideas only) |
| [chromatoPy](https://github.com/GerardOtiniano/chromatoPy) (Gerard Otiniano) | MIT | Multi-Gaussian fitting with area uncertainty (approach reimplemented); output files are an import format |
| [MOCCA2](https://github.com/Bayer-Group/MOCCA) (Bayer AG) | MIT | Interoperability: its JSON serialization is an import format (written from its documented field names) |
| [rainbow](https://github.com/evanyeyeye/rainbow) (Evan Shi, Eugene Kwan and contributors) | LGPL-3.0 | Prose documentation of Agilent ChemStation `.ch` binary layouts (read; no code used) |
| [chromConverter](https://github.com/ethanbass/chromConverter) (Ethan Bass) | GPL-3.0 | Survey of common vendor export formats (no code used) |
| [entab](https://github.com/bovee/entab) (Roderick Bovee) | MIT | Reference for Agilent/Thermo readers (not used) |
| [WebPlotDigitizer](https://github.com/automeris-io/WebPlotDigitizer) (Ankit Rohatgi) | AGPL-3.0 | The digitizing workflow concept: axis calibration and colour-mask extraction (no code used) |

## Published methods and references

Signal processing and peak shape
- A. Savitzky, M. J. E. Golay, "Smoothing and differentiation of data by simplified least squares procedures", *Anal. Chem.* 36 (1964) 1627–1639. Smoothing and derivatives.
- P. H. C. Eilers, H. F. M. Boelens, *Baseline Correction with Asymmetric Least Squares Smoothing*, Leiden University Medical Centre report (2005). Baseline.
- E. Grushka, "Characterization of exponentially modified Gaussian peaks in chromatography", *Anal. Chem.* 44 (1972) 1733–1738. EMG peak model.
- J. P. Foley, J. G. Dorsey, "Equations for calculation of chromatographic figures of merit for ideal and skewed peaks", *Anal. Chem.* 55 (1983) 730–737.
- Yu. Kalambet, Yu. Kozmin, K. Mikhailova, I. Nagaev, P. Tikhonov, "Reconstruction of chromatographic peaks using the exponentially modified Gaussian function", *J. Chemometrics* 25 (2011) 352–356. Numerically stable EMG.
- N. Dyson, *Chromatographic Integration Methods*, 2nd ed., Royal Society of Chemistry (1998). Drop, valley, tangent and exponential skimming.

Fitting and numerics
- K. Levenberg, "A method for the solution of certain non-linear problems in least squares", *Q. Appl. Math.* 2 (1944) 164–168.
- D. W. Marquardt, "An algorithm for least-squares estimation of nonlinear parameters", *J. SIAM* 11 (1963) 431–441.
- C. Lanczos, "A precision approximation of the gamma function", *SIAM J. Numer. Anal. B* 1 (1964) 86–96 (log-gamma for the Student-t distribution).
- E. A. Cornish, R. A. Fisher, "Moments and cumulants in the specification of distributions", *Rev. Inst. Int. Statist.* 5 (1938) 307–320 (series for Student-t quantiles beyond the tabulated degrees of freedom).
- W. J. Lentz, *Appl. Opt.* 15 (1976) 668–671, and the modified Lentz algorithm (I. J. Thompson, A. R. Barnett, *J. Comput. Phys.* 64 (1986) 490–509) for continued fractions (incomplete beta).
- G. E. P. Box, M. E. Muller, "A note on the generation of random normal deviates", *Ann. Math. Statist.* 29 (1958) 610–611 (synthetic sample noise).
- Mulberry32 pseudo-random generator, commonly attributed to Tommy Ettinger and published as public domain, used for reproducible synthetic samples.
- R. Hartley, A. Zisserman, *Multiple View Geometry in Computer Vision*, 2nd ed., Cambridge University Press (2004). Homography (DLT) for perspective correction.

Chromatography and calibration standards
- United States Pharmacopeia, General Chapter <621> *Chromatography*. System-suitability definitions (tailing, plates, resolution, S/N).
- European Pharmacopoeia, 2.2.46 *Chromatographic separation techniques* (EDQM, Council of Europe).
- ICH Q2(R2) *Validation of Analytical Procedures* (2023). Linearity, range, LOD/LOQ.
- J. N. Miller, J. C. Miller, *Statistics and Chemometrics for Analytical Chemistry*, Pearson. Calibration, inverse prediction, weighted regression.
- Eurachem Guide, B. Magnusson, U. Örnemark (eds.), *The Fitness for Purpose of Analytical Methods*, 2nd ed. (2014). LOD/LOQ and working range.

## Data formats and specifications

| Specification | Owner | Used for |
|---|---|---|
| AnDI chromatography (ASTM E1947) and AnDI-MS (ASTM E2077) | ASTM International | `.cdf` import |
| netCDF classic format | Unidata / UCAR | `.cdf` container |
| mzML 1.1 and the PSI-MS controlled vocabulary | HUPO Proteomics Standards Initiative | mzML import; synthetic sample file |
| JCAMP-DX | IUPAC | JCAMP-DX import |
| RFC 4180 (CSV) | IETF | Delimited-text import |
| JSON Schema 2020-12 | JSON Schema project | `docs/schemas/*.schema.json` |
| chromatoPy and MOCCA2 output formats | Their authors (above) | Interoperability imports |
| Agilent ChemStation `.ch` layouts | Described publicly by the rainbow project | Binary import |
| Citation File Format 1.2.0 | Stephan Druskat et al., CC-BY-4.0, <https://citation-file-format.github.io/> | `CITATION.cff` |
| Zenodo metadata | CERN / Zenodo | `.zenodo.json`, DOI archiving |
| security.txt (RFC 9116) | IETF | `/.well-known/security.txt` |
| Web App Manifest | W3C | `site.webmanifest` |

## Accessibility and usability references

- W3C Web Content Accessibility Guidelines (WCAG) 2.1 and 2.2, and the WAI [accessibility statement guidance and generator](https://www.w3.org/WAI/planning/statements/) used to structure [ACCESSIBILITY_STATEMENT.md](ACCESSIBILITY_STATEMENT.md). © W3C.
- Testing tools suggested in [ACCESSIBILITY.md](ACCESSIBILITY.md): axe DevTools / axe-core (Deque Systems; axe-core is MPL-2.0), Lighthouse (Google), Chrome DevTools vision-deficiency emulation.
- If the feedback survey uses them: the **System Usability Scale** (J. Brooke, "SUS: a 'quick and dirty' usability scale", in *Usability Evaluation in Industry*, Taylor & Francis, 1996, 189–194), and a "likelihood to recommend" question. Net Promoter®, NPS® and Net Promoter Score® are registered trademarks of Bain & Company, Inc., NICE Satmetrix and Fred Reichheld; Peakly is not affiliated with them.

## Visual design

- The app's overlay palette is the widely used "category10" colour set (as in D3's `schemeCategory10`, ISC license, Mike Bostock, derived from Tableau's Tableau 10), with the first colour changed. Colours are credited as a courtesy.
- The Peakly icon (a chromatogram trace) and all screenshots are original to the project.
- Fonts: the system font stack only; no web fonts are loaded.

## Project templates and conventions

| Item | License | Where |
|---|---|---|
| [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) (Coraline Ada Ehmke and contributors; enforcement guidelines inspired by Mozilla's code of conduct enforcement ladder) | CC BY 4.0 | [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) is adapted from it: summarized and shortened, with reporting channels specific to Peakly. |
| [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) (Olivier Lacan) | MIT | [CHANGELOG.md](../CHANGELOG.md) format |
| [Semantic Versioning 2.0.0](https://semver.org/) (Tom Preston-Werner) | CC BY 3.0 | Release numbering ([RELEASING.md](RELEASING.md)) |
| [Shields.io](https://shields.io/) badges | Service (code Apache-2.0) | README badges |
| W3C WAI accessibility statement structure | W3C | [ACCESSIBILITY_STATEMENT.md](ACCESSIBILITY_STATEMENT.md) |

## Development and hosting tools

- **Node.js** (OpenJS Foundation) runs the build and the zero-dependency test suite.
- **Google Chrome** in headless mode captures the screenshots (`tools/screenshots.sh`) and checks the Content-Security-Policy.
- **GitHub** hosts the code, issues, Discussions and the website (GitHub Pages). CI uses GitHub Actions `actions/checkout`, `actions/setup-node`, `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages` and `github/codeql-action` (all MIT), pinned to commit SHAs and kept current by Dependabot.
- **GitHub CLI** (`gh`, MIT) is used by `tools/github-security-setup.sh`.
- **Google Forms / Google Sheets** host the optional feedback survey, owned by the project's Google account (peaklyfeedback@gmail.com).
- Optional, off by default: **GoatCounter** or **Plausible** for cookie-free website page counts.

## Data

All sample data in `samples/` is synthetic and generated by `tools/make-samples.js` (CC0). Contributed validation data, when added, will be credited in [VALIDATION.md](VALIDATION.md) under the license its contributor chose (CC0 or CC BY 4.0).

## Trademarks

Product and company names are trademarks of their owners and are used only to describe compatibility; Peakly is not affiliated with or endorsed by them. See [TRADEMARKS.md](TRADEMARKS.md).

---

Missing or wrong credit? Email [peaklyfeedback@gmail.com](mailto:peaklyfeedback@gmail.com) or [open an issue](https://github.com/jschmitt1531/peakly/issues/new/choose) and it will be fixed.
