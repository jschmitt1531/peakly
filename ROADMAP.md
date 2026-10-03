# Roadmap

This is a statement of direction, not a promise of dates. Priorities shift with contributor time, funding and what users ask for; the [issue tracker](https://github.com/jschmitt1531/peakly/issues) and [Discussions](https://github.com/jschmitt1531/peakly/discussions) are where to weigh in. Everything here respects the [core principles](GOVERNANCE.md#core-principles-not-up-for-a-vote): free, private by default, transparent math, single file.

## Near term (next minor releases)

- **Validation with real reference data.** Run Peakly side by side with established chromatography data systems on shared, non-confidential datasets and publish the comparison (RT, area, tailing, plates, resolution) in [docs/VALIDATION.md](docs/VALIDATION.md). Contributions of paired data are the single most useful thing a lab can give.
- **Accessibility pass:** keyboard access to every function, screen-reader labels, colour-blind-safe defaults; findings tracked in [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).
- **Digitizer benchmark on real images:** extend `tools/digitizer-accuracy.js` with contributed screenshots and photos that have known ground truth.
- **Sample library:** more example files in `samples/` for every supported format and tutorial.
- More robust peak detection on digitized (pixel-staircase) traces.

## Mid term

- **More vendor binary formats**, written from public descriptions or contributed samples: Agilent `.uv` (DAD) and OpenLab CDS `.dx` containers, Shimadzu `.lcd`, Waters raw folders, Thermo `.raw` chromatogram channels, Cytiva UNICORN result files. Each needs shareable sample files; see the [format request form](https://github.com/jschmitt1531/peakly/issues/new?template=format_request.yml).
- **DAD / 3D data:** time × wavelength matrices with contour view, spectrum at cursor, extract-chromatogram-at-wavelength, peak purity indices.
- **Batch mode:** apply one processing method to many runs and export a combined table.
- **System-suitability report** template (USP <621> / Ph. Eur. 2.2.46 parameters with pass/fail limits).
- **Internationalisation** of the UI and docs.
- **Offline bundle:** an optional build with the libraries inlined, for air-gapped labs (with license notices included).

## Long term

- **Optional services layer** (separately hosted, off by default, never required): cloud save, team sharing and accounts, built against `PK.services` without touching the core. See [docs/SERVICES.md](docs/SERVICES.md). If it ever exists as a hosted offering, it must keep the free core fully functional and could help fund maintenance.
- **Method development helpers:** gradient scouting, retention modelling (linear solvent strength) from two or more runs.
- **Mass-spec chromatograms** beyond TIC/BPC: extracted-ion chromatograms from mzML.
- **Plugin packaging** so third parties can distribute parsers or analysis modules without forking.
- **Community-maintained validation suite** recognised by teaching labs as a reference for chromatography calculations.

## Explicitly not planned

- Telemetry, ads, or any data collection in the app.
- Paywalled features.
- Claims of regulatory (GMP/GLP, 21 CFR Part 11) compliance. Peakly will remain a research and education tool unless a properly resourced validation effort says otherwise.
