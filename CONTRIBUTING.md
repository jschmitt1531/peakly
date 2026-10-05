# Contributing to Peakly

Thank you for helping. Peakly is a small project with a clear goal: a free, transparent, single-file chromatogram analyzer that anyone can open in a browser. Contributions of every size are welcome: bug reports, sample files, validation data, parsers, documentation, translations and code.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help without writing code

- **Report a bug** with the [bug report form](https://github.com/jschmitt1531/peakly/issues/new?template=bug_report.yml). A small file that reproduces the problem is worth a thousand words.
- **Share a sample file** for an unsupported or mis-read format with the [format request form](https://github.com/jschmitt1531/peakly/issues/new?template=format_request.yml). Only share files you have the right to share, and strip confidential sample names first.
- **Share validation data**: a chromatogram plus the peak table your validated CDS produced for it. These become regression tests (see [docs/VALIDATION.md](docs/VALIDATION.md)).
- **Improve the docs and tutorials** in `docs/`.
- **Tell us how you use Peakly** in [Discussions](https://github.com/jschmitt1531/peakly/discussions).

## Development setup

There is nothing to install. Peakly has **zero dependencies** and no build toolchain beyond Node.js.

Requirements: [Node.js](https://nodejs.org/) 18 or newer (the CI uses the current LTS), git, and a browser.

```sh
git clone https://github.com/jschmitt1531/peakly.git
cd peakly
node tests/run.js            # run all tests (or: npm test)
node tests/run.js parsers    # run tests whose name contains "parsers"
node build.js                # inline src/ + tests/ into index.html (or: npm run build)
node tools/validate.js       # numerical validation against reference values (or: npm run validate)
node tools/digitizer-accuracy.js   # regenerate docs/DIGITIZER_ACCURACY.md (or: npm run accuracy)
```

Then open `index.html` in a browser. The same tests run in the app under **Help → Run self-tests**.

### Repository layout

| Path | What it is |
|---|---|
| `src/*.js` | App modules (plain scripts, see below). Load order is defined in `build.js`. |
| `src/parsers/` | One file per file-format plugin. |
| `src/shell.html` | HTML/CSS shell; `build.js` replaces `<!--PK:SCRIPTS-->` with the inlined code. |
| `tests/*.test.js` | Tests, loaded by `tests/run.js` in Node and bundled into the app. |
| `tools/` | Node scripts for validation and benchmarks (not shipped in the app). |
| `samples/` | Example data files used by tutorials and tests. |
| `docs/` | Documentation and the project website (published to GitHub Pages). |
| `index.html` | **Built output, committed.** CI fails if it is stale. |

### The committed build must be fresh

`index.html` is committed so people can download and open it directly. After changing anything in `src/` or `tests/`, run `node build.js` and commit the regenerated `index.html` in the same pull request. CI rebuilds it and fails if the result differs from what you committed.

## Code style

Follow the patterns already in the code. In particular:

- **No modules, no bundler, no dependencies.** Every file in `src/` is a plain script wrapped in an IIFE that attaches to the global `PK` namespace:

  ```js
  /* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
  (function (PK) {
    'use strict';
    PK.mymodule = PK.mymodule || {};
    // ...
  })(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
  ```

- **Pure code must load in Node.** Math and parsing must not touch `document` or `window` at load time. DOM code goes inside functions that run in the browser, guarded with `typeof document !== 'undefined'`.
- **ES5-compatible style** in `src/` (`var`, `function`), matching the existing code, so the single file runs on older lab PCs. Node-only tools in `tools/` may use modern syntax.
- **Never write a literal `</script>`** in source; `build.js` refuses to build. Write `<\/script>` if you need it.
- **Library globals** (`Plotly`, `XLSX`, `pako`, `LZString`, `jspdf`, `pdfjsLib`) may be missing in Node and when a CDN is blocked. Check before use and degrade gracefully.
- **Units:** time is always minutes internally; intensities keep their native unit.
- **Every number shown to users needs a documented formula.** If you add or change a calculation, update the matching file in `docs/` and expose the inputs so the UI can show them.
- **Tests:** add a test for every bug fix and new function. Tests must be pure (no DOM), deterministic and fast (< 1 s each):

  ```js
  PK.test('analysis: SG preserves polynomial', function (t) { t.near(a, b, 1e-9, 'msg'); });
  ```

- **No telemetry, ever.** The app must not phone home. The only permitted network requests are the pinned CDN libraries and user-initiated calls the user has explicitly configured (see [SECURITY.md](SECURITY.md) and [docs/SERVICES.md](docs/SERVICES.md)).

### SPDX headers

Every source file starts with an SPDX license identifier:

```js
/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
```

Use `<!-- SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 -->` in HTML files and `# SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0` in YAML/shell files where comments are allowed.

## Licensing rules (please read)

Peakly is **not** open source: it is free to use, with all other rights reserved ([LICENSE](LICENSE)). Contributions are still welcome under these rules:

1. **Never copy code from projects with incompatible licenses.** That includes GPL, LGPL, AGPL and EPL projects such as ChemClipse/OpenChrom, chromConverter, rainbow and WebPlotDigitizer. Do not port their code line by line or translate it to JavaScript either. You may read *prose* format documentation and published papers, and implement from those.
2. **Permissively licensed code** (MIT, BSD, Apache-2.0, ISC, Zlib) may be adapted only if you keep its copyright notice, note it in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and say so in your pull request. Prefer writing your own implementation.
3. **Cite algorithms.** Add the paper or standard to the relevant docs file.
4. **Data and sample files** must be yours to share, or under a license that permits redistribution (for example CC0 or CC-BY). Say where they came from. Remove confidential sample names, operator names and instrument serial numbers.
5. **New runtime libraries** need discussion first. They must be permissively licensed, loaded from a CDN at a pinned version, and added to THIRD_PARTY_NOTICES.md.
6. **AI-assisted contributions** are fine; you are responsible for checking that the result is correct and does not reproduce licensed code.

**Contribution terms.** By submitting a pull request, issue attachment or other contribution, you confirm that you have the right to contribute it, you keep your copyright, and you grant Jennifer Schmitt (the maintainer) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, copy, modify, distribute, sublicense and relicense your contribution as part of Peakly or any future version of it, under any license. *(These terms have not yet been reviewed by a lawyer; a formal contributor license agreement may replace them.)*

## Adding a file format

Parsers are plugins. Each lives in its own file under `src/parsers/` and registers itself. Start by copying [`src/parsers/_template.js`](src/parsers/_template.js), which documents the helpers available; the essentials look like this:

```js
/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
(function (PK) {
  'use strict';
  PK.parsers.register({
    id: 'myformat', name: 'My instrument export', extensions: ['xyz'],
    binary: false,                                   // true → parse() receives an ArrayBuffer
    sniff: function (head, filename) {               // head = first ~4 KB as text; return confidence 0..1
      return /MY HEADER/.test(head) ? 0.9 : 0;
    },
    parse: function (text, opts) {                   // may return a Promise
      return { ok: true, format: 'myformat', warnings: [],
        traces: [{ name: 'UV 254 nm', x: [/* minutes */], y: [/* mAU */], xUnit: 'min', yUnit: 'mAU',
                   source: { kind: 'file', filename: opts.filename }, meta: {} }] };
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
```

Checklist for a new format:
- Write it from a **public format description** or your own analysis of files you own. See the licensing rules above.
- Convert time to **minutes**; keep intensity in its native unit. FPLC volume axes stay in mL with `meta.xIsVolume = true`.
- Detect UTF-16 byte-order marks.
- Return `ok: false, needsMapping: true` with the parsed table when unsure, so the user gets the manual column mapper instead of wrong data.
- Add a small, shareable sample file to `samples/` and a test in `tests/` that parses it and checks a few known values.
- Add the format to the table in [README.md](README.md#supported-formats) and, if it is a vendor export, to [docs/tutorials/vendor-export.md](docs/tutorials/vendor-export.md).

More detail on the parser API, sniffing scores and test fixtures: [docs/CONTRIBUTING_PARSERS.md](docs/CONTRIBUTING_PARSERS.md).

## Adding or changing documentation

- Docs are Markdown in `docs/`. The website landing page is `docs/index.html`; GitHub Pages publishes the whole `docs/` folder (see `.github/workflows/pages.yml`).
- Calculations: [docs/CALCULATIONS.md](docs/CALCULATIONS.md), [docs/INTEGRATION.md](docs/INTEGRATION.md), [docs/CALIBRATION.md](docs/CALIBRATION.md). Keep formulas in sync with the code.
- Tutorials go in `docs/tutorials/`. Use the sample files in `samples/` so readers can follow along, and put screenshots in `docs/img/` named `tutorial-<topic>-<step>.png`.
- Screenshots: PNG, light theme, about 1600 px wide, no personal or confidential data.
- Write plainly. Prefer short sentences, concrete steps and real numbers.
- Generated files (`docs/DIGITIZER_ACCURACY.md`) are rebuilt by their tools; edit the tool, not the output.

## Pull request process

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Fork, create a branch, make your change with tests and docs.
3. Run `node tests/run.js`, `node build.js` and (if present) `node tools/validate.js`. Commit the rebuilt `index.html`.
4. Fill in the pull request checklist.
5. A maintainer reviews. Expect questions about formulas and edge cases; that is how we keep the numbers trustworthy.
6. Changes are listed in [CHANGELOG.md](CHANGELOG.md) under "Unreleased".

See [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made and [docs/RELEASING.md](docs/RELEASING.md) for releases.
