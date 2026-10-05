# Changelog

All notable changes to Peakly are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The "public API" for versioning purposes is the project file format, the export schemas ([docs/SCHEMA.md](docs/SCHEMA.md)) and the parser plugin interface.

## [Unreleased]

## [1.2.0] - 2026-10-05

First public release.

### Changed
- **License changed from MIT (never published) to the Peakly Free-Use License 1.0:** free to use, including at work; copying, modifying, redistributing, sublicensing, selling, scraping and AI training are not permitted without written permission. Contributions are accepted under new contribution terms (CONTRIBUTING.md). Docs, app About panel, citation metadata and SPDX headers updated; Peakly is described as free-to-use, not open source.

### Added (protection)
- Text-and-data-mining reservation (LICENSE §2f; W3C TDMRep meta tags and `/.well-known/tdmrep.json`), `noai` robots meta, robots.txt blocking AI crawlers, copyright banner and provenance ID in every build, and an owner guide (docs/PROTECTING_PEAKLY.md).

### Added
- Optional feedback survey: links in About, Help, footer and PDF reports, plus an occasional, dismissible invitation after complex features (calibration, peak fit, digitizing, compare, split). The app never collects email or sends data; the survey lives on Google Forms (setup script in `tools/survey/`).
- Accessibility: plot text summary and "Show plot as table", keyboard editing of integration bounds, setting to turn off single-key shortcuts, arrow-key menus, 24 px targets; axe-core scan reports 0 violations across 36 view/theme/width combinations.
- MOCCA2 wavelength picker; mzML names decode XML entities; PDF pages render in background tabs.
- Privacy policy, terms, accessibility statement, trademark notice, credits, launch checklist; security.txt, robots.txt, sitemap, 404 page, icons and social preview on the website.
- Project contact: peaklyfeedback@gmail.com.

## [1.1.0] - 2026-10-03

Sustainability, peak clipping and calibration release.

### Added
- **Peak clipping modes** for fused peaks: perpendicular drop, valley-to-valley, common baseline, tangent skim, exponential skim (Dyson skim-ratio rule) and curve-fit (Gaussian/EMG) split. A dialog previews every applicable mode for a peak cluster ("How should these peaks be split?"); per-peak overrides persist.
- **Integration audit:** each peak's area shows the applied baseline and a step-by-step calculation (gross area, baseline area, net area, bounds, point count).
- **Calibration curves:** linear, linear through origin and quadratic models with none, 1/x or 1/x² weighting; R², adjusted R², s(y/x), residuals; inverse prediction of unknowns with 95 % intervals; LOD (3.3·s/slope) and LOQ (10·s/slope); flags for extrapolation and results below LOQ. Concentrations appear in the peak table with an audit popup.
- **Project format v2** (`PK.schema`): per-peak `clip`, `calibration` block, schema tag; automatic, non-destructive migration of v1 projects; validation with readable errors; documented export rows for peak tables, trace summaries and data. JSON Schemas in `docs/schemas/`.
- **Optional services interface** (`PK.services`) for future add-ons such as cloud save. Every service is off by default; the core never needs one.
- **About panel** with author, citation, license and disclaimer; `PK.config` holds author, links and citation metadata.
- Disclaimer in About, README and PDF footer: "For research and education use. Not validated for regulated (GMP/GLP) workflows. Digitized data is approximate."
- Parser plugins split into one file per format under `src/parsers/`.
- Project infrastructure: MIT LICENSE, THIRD_PARTY_NOTICES, CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY, GOVERNANCE, FUNDING, ROADMAP, CITATION.cff, `.zenodo.json`, GitHub Actions for tests and Pages, issue and pull request templates.
- Documentation site (`docs/`): landing page, FAQ, data schemas, services design, accessibility checklist, tutorials, release process, letter-of-support template.
- `tools/digitizer-accuracy.js` benchmark and its report `docs/DIGITIZER_ACCURACY.md`.

### Changed
- Default clipping for new automatic integrations is **perpendicular drop**; manual window integrations default to valley-to-valley. Peaks in v1 projects keep valley-to-valley, so their stored areas do not change.
- Peak heights and metrics are measured relative to the applied clipping baseline.
- Calculation details moved from the README into `docs/CALCULATIONS.md`, `docs/INTEGRATION.md` and `docs/CALIBRATION.md`.

### Fixed (found during integration testing)
- Peak labels of closely eluting peaks (e.g. 7.36 / 7.64 min) overlapped; labels now stack above the taller neighbour and avoid neighbouring peak lines.
- Automatic peak detection over-counted peaks on digitized (pixel-stepped) traces; the noise estimate is now floored at the pixel step.
- The "JPEG compression artifacts" warning fired on clean screenshots; the 8×8 blockiness test now compares pixel phases in both directions.
- Saved projects, share links and all CSV/JSON exports now use project schema v2 via `PK.schema`.

### Security
- Subresource Integrity (`integrity` + `crossorigin`) on every pinned CDN script.

## [1.0.0] - 2026-10-03

First build.

### Added
- Single-file, client-side app (`index.html`) built from plain-script modules by `node build.js`; no backend, no accounts, no telemetry.
- **Import:** generic delimited text (any delimiter, decimal comma, unit detection), pasted data, Excel (SheetJS), JSON, JCAMP-DX (AFFN and compressed ASDF), AnDI/netCDF-3, mzML (TIC/BPC/UV, zlib), Agilent ChemStation `.ch` (types 130/131/179/181), and text exports from Agilent ChemStation/OpenLab, Thermo Chromeleon, Shimadzu LabSolutions, Waters Empower (`.arw`), Cytiva UNICORN and Bio-Rad ChromLab/NGC. Pluggable parser registry with content sniffing and a manual column-mapping fallback.
- **Processing:** Savitzky–Golay smoothing and derivatives, asymmetric-least-squares baseline (O(n) banded solver), robust noise estimate.
- **Peaks:** automatic detection with prominence, minimum width/distance and shoulder detection; manual add, click-to-integrate and draggable bounds; metrics RT, height, area, area %, FWHM, W5/W10, USP tailing, asymmetry, plates (half-height and USP tangent), resolution, k′ and S/N, each with its formula and inputs.
- **Peak fitting:** joint Gaussian/EMG Levenberg–Marquardt fits with area standard errors from the covariance matrix.
- **Method model:** gradient table (linear and step), dwell and void time, %B or salt/imidazole concentration at elution, gradient overlay.
- **Image digitizer:** crop, rotate, deskew, 4-corner perspective correction, image adjustments; 2-point axis calibration (linear/log); colour-mask trace extraction with grid removal and exclusion zones; uncertainty and quality warnings; comparison with printed RT/area %; optional Claude vision assist with the user's own key held in memory only.
- **Compare:** overlays, normalization, alignment, difference traces, waterfall, cross-trace peak matching with ΔRT and area ratio.
- Curve-following cursor with readout; peak labels; run information; publication-style plot styling.
- **Export:** PNG/SVG figures, peak table CSV, trace CSV/JSON, PDF report, project files, share links with the compressed project in the URL fragment.
- Built-in self-tests runnable in Node (`node tests/run.js`) and in the app.

[Unreleased]: https://github.com/jschmitt1531/peakly/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/jschmitt1531/peakly/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jschmitt1531/peakly/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jschmitt1531/peakly/releases/tag/v1.0.0
