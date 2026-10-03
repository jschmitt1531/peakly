# Pause notes: v1.1 work in progress (2026-10-03)

State at pause: `node tests/run.js` → **125/125 pass**, and `node build.js` works (index.html ≈ 918 KB). Everything is committed as a WIP checkpoint. Nothing is pushed, and no GitHub repo exists yet.

## Done this round
- **Repo hygiene:**
  - LICENSE (MIT © 2026 Jennifer Schmitt), THIRD_PARTY_NOTICES, README rewrite
  - CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, GOVERNANCE, FUNDING, CHANGELOG, ROADMAP
  - CITATION.cff, .zenodo.json, package.json
  - `.github/` workflows (test, pages), issue templates, PR template
- **docs/:**
  - Landing page, with analytics OFF.
  - FAQ, SCHEMA (with `schemas/*.json`), SERVICES, ACCESSIBILITY (skeleton), RELEASING, DIGITIZER_ACCURACY.
  - Nine tutorials and the letter-of-support template.
- **Parsers:** split into `src/parsers/` (registry plus one file per format, and `_template.js`). Per-format tests are in `tests/parsers/`, synthetic samples in `samples/data/` (`tools/make-samples.js`). New chromatoPy and MOCCA2 importers. `docs/CONTRIBUTING_PARSERS.md`.
- **Optional services:** `src/config.js` (About/author block, links, services all OFF) and `src/services.js` (interface plus test).
- **Digitizer:** the JPEG-blockiness warning no longer fires on clean images (plus a test). SPDX headers added to core, testkit and digitizer.

## Interrupted mid-work: resume here
1. **Integration and calibration math** (`src/analysis.js`). `clusters`, `integrate`, `clipOptions` and `calibrationFit` exist and tests pass, but the agent was mid-tuning:
   - Exponential-skim rider end detection: the meet tolerance was too large, so riders were cut at about 2σ.
   - Some cases fall back to tangent skim when they shouldn't.
   - Still to do: `docs/INTEGRATION.md` and `docs/CALIBRATION.md` (missing); re-run `node tools/validate.js` → `docs/VALIDATION.md`.
   - Still to do: make `noise()` robust to stepped/quantized digitized traces (`{quantum}` option). Auto-detection over-counts peaks on digitized traces (finds 6–20 when the truth is 5).
2. **App UI** (`src/app.js`, `src/shell.html`, `src/schema.js`). The calibration modal, clip default, split dialog, integration-math panel, About panel and schema v2 are largely in. The agent was testing click-to-exclude on calibration points and the peak-table Conc. column. Still to verify or do:
   - `saveProject` and share links must write schema version 2.
   - CSV/JSON exports must go through `PK.schema.peakTableRows` / `traceRows`.
   - `describe()` `$id` must not use the peakly.app domain.
   - Pass `digitized.dy` as the noise quantum.
   - Show imported chromatoPy/MOCCA2 peaks (`traces[i].peaks`, no ids) as manual peaks with an "imported area ± SE" column.
   - Add chromatoPy and MOCCA2 to the Help formats list.
   - `?demo=` URL param for screenshots (`hplc|calibration|compare|integration-math|about|image|fplc`, sets `body.dataset.demoReady`).
   - Accessibility pass findings → `docs/ACCESSIBILITY.md`.
3. **Integrator tasks:**
   - Add SRI `integrity` + `crossorigin="anonymous"` to the CDN scripts in `src/shell.html`. Hashes are below.
   - Capture screenshots into `docs/img/` with headless Chrome (`/Applications/Google Chrome.app`) using `?demo=`. Filenames are listed in the README and tutorials.
   - Re-run `node tools/digitizer-accuracy.js`.
   - Regenerate `docs/schemas/*.json` if `src/schema.js` changed.
   - SPDX headers on `build.js` and `tests/run.js`.
   - End-to-end browser pass, then commit.

## Needs the owner (Jennifer)
- **GitHub owner/repo name:** replace the `OWNER` placeholder (`grep -rn OWNER .`) and set `repoUrl`/`discussionsUrl` in `src/config.js`.
- **Contact emails** for CODE_OF_CONDUCT and SECURITY (placeholders `CONDUCT_CONTACT_EMAIL`, `SECURITY_CONTACT_EMAIL`).
- **Review the About text** in `src/config.js` (written from the public LinkedIn profile).
- **On GitHub:** enable Pages (source: Actions), Discussions and private vulnerability reporting; connect Zenodo for a DOI.

## SRI hashes (sha384) for pinned CDN scripts
| Script | Hash |
|---|---|
| plotly.js-dist-min@2.35.2 | `sha384-cCVCZkAjYNxaYKbM8lsArLznDF/SvMFr1jcZrvOpSTCa0W40ZAdLzHCEulnUa5i7` |
| xlsx 0.18.5 | `sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw` |
| pako 2.1.0 | `sha384-rNlaE5fs9dGIjmxWDALQh/RBAaGRYT5ChrzHo6tRfgrZ36iRFAiquP5g41Jsv+0j` |
| lz-string 1.5.0 | `sha384-0d+Gr7vM4Drod8E3hXKgciWJSWbjD/opKLLygI9ktiWbuvlDwQLzU46wJ9s5gsp7` |
| jspdf 2.5.1 | `sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk` |
| pdf.js 3.11.174 | `sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e` |

## How to work
- `node tests/run.js [filter]`
- `node build.js`
- `node tools/validate.js`
- `node tools/digitizer-accuracy.js`
- Browser preview: `../.claude/launch.json` ("peakly", port 8765).
- Module APIs: `CONTRACT.md` (see the Round 4 section).
