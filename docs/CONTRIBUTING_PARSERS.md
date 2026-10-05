# Contributing a file-format parser

Peakly reads chromatograms through **parser plugins**. Each format lives in its own file under `src/parsers/`, registers itself with `PK.parsers.register({...})`, and comes with a synthetic sample file and its own test file. This guide covers adding one, from copying the template to opening the pull request.

## How the parser layer is organised

| Path | Purpose |
|---|---|
| `src/parsers/registry.js` | Registry, sniff-based dispatch, the public API (`parseFile`, `parseText`, `parseArrayBuffer`, `parseDelimited`, `buildTraces`, `guessMapping`, `isImage`, `list`, `get`, `rank`, `register`, `unregister`), and the shared helpers `PK.parsers._h`. Loaded first. |
| `src/parsers/<id>.js` | One plugin per format, for example `jcamp.js`, `netcdf.js`, `chromatopy.js`. Loaded in alphabetical order after the registry. |
| `src/parsers/_template.js` | Commented starting point. Files whose names start with `_` are never loaded. |
| `samples/data/` | One small **synthetic** sample per format (CC0). |
| `tools/make-samples.js` | Regenerates every file in `samples/data/` deterministically. |
| `tests/parsers/<id>.test.js` | Tests for one format: inline fixtures plus a test that parses the sample file. |
| `tests/parsers/_fixtures.test.js` | Shared fixture builders (`PK.parserFixtures`), including `withSample()`. |

`build.js` and `tests/run.js` find the files on their own. You don't need to register a new file anywhere.

### How a file is dispatched

1. `parseArrayBuffer` decodes the first 4 KB and asks every plugin's `sniff(head, filename, info)` for a score from 0 to 1. A matching extension adds 0.3, or 0.05 for generic extensions such as csv and txt.
2. Binary plugins are tried first. Text files are decoded (UTF-8, UTF-16 with or without BOM, or Windows-1252) and handed to `parseText`, which ranks the text plugins in the same way.
3. The plugin with the highest score parses the file. If a text plugin fails, the generic delimited reader gets a try, except for JSON. If the content is a table but no plugin is sure about it, the result is `needsMapping`, and the app shows the column mapper.
4. JSON is parsed once by the `json` plugin. It then offers the object to any plugin that implements `sniffJSON(obj)`/`parseJSON(obj, opts)`. This lets JSON dialects such as chromatoPy and MOCCA2 work even when the first 4 KB look generic.

## Step by step

### 1. Copy the template

```sh
cp src/parsers/_template.js src/parsers/myformat.js
```

Use a lowercase, dash-separated id that matches the file name (`myformat`). Keep the first line `/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */`. Then fill in the header comment:

- **Format:** layout, sections, delimiters, units, and binary offsets.
- **Sniff:** what identifies the format in the first 4 KB, and the score you return.
- **Variants:** locales, software versions, optional sections, and what you deliberately don't handle.
- **Format knowledge:** where the layout came from, such as a public specification, vendor documentation, or files you exported yourself.
- **Sample:** `samples/data/myformat.<ext>`.

### 2. Write `sniff()`

- Return **0** unless you see something specific to your format.
- Return **0.8 or more** only for a signature no other software writes, such as a magic number, a fixed first line or a unique section name.
- Return around **0.5–0.7** for strong but shared hints, such as a header combination.
- Don't rely on the extension. The registry already adds weight for it.
- Run `node tests/run.js "parsers/registry"` afterwards. The dispatch test checks that the existing formats still route correctly.

### 3. Write `parse()`

`parse(input, opts)` receives text (`binary: false`) or an `ArrayBuffer` (`binary: true`), and `opts = { filename, flow?, encoding?, ... }`. It returns a **ParseResult**:

```js
{ ok: true, format: 'My instrument export', warnings: [],
  traces: [{ name, x: [...minutes], y: [...], xUnit: 'min', yUnit: 'mAU', meta: { sampleName, wavelength, channel, ... },
             peaks: [{ start, apex, end, label, area, areaSE, source: 'myformat' }] /* optional imported integrations */ }] }
```

Use the shared helpers in `PK.parsers._h`. They are documented at the top of `src/parsers/registry.js`.

- `tableToResult(text, format, opts, defaults, meta)`: takes a block of numeric text and returns traces, including unit detection, FPLC roles and `needsMapping`.
- `mkTrace(name, xs, ys, xUnit, yUnit, meta, flow)`: converts x to minutes (from sec, ms or h; mL only when a flow is known), sorts, and drops non-finite pairs.
- `kvMeta(lines)` and `deriveMeta(header)` turn "Key: value" preambles into `meta.sampleName`, `meta.wavelength`, `meta.channel` and so on.
- `normPeaks(list, unit, source)` converts imported peak times to minutes and validates them.
- `fail(format, message)` and `okRes(format, traces, warnings)` build results. `parseJSONLoose(text)` accepts Python's `NaN`.

Rules:

- Write error messages people can act on. Say what was expected, what was found, and how to re-export: "No [Data] section found. In MySoft, use File > Export > ASCII with *Raw data* ticked."
- x is **always minutes** in the result. The one exception is FPLC volume without a flow rate, which uses `xUnit: 'mL'` and `meta.xIsVolume = true`.
- Keep the native y unit (`mAU`, `AU`, `pA`, `mV`, `counts`). Auxiliary channels get `meta.role` (`gradient`, `conductivity`, `pH`, `pressure`, …).
- Don't touch `document` or `window`. Parsers must run in Node.
- Don't use `import`/`export`. Use the IIFE pattern from the template. Don't put a literal `</script>` in the code; write `<\/script>`.
- For a JSON dialect, also implement `sniffJSON(obj)` and `parseJSON(obj, opts)`. See `chromatopy.js` and `mocca2.js`.

### 4. Add a synthetic sample file

Add a generator block for your format to `tools/make-samples.js`, then run:

```sh
node tools/make-samples.js
```

- Generate the data. Sums of Gaussian peaks with seeded noise are enough. **Never commit a real instrument file or a file from another project.** Real files can carry confidential sample names, operators and serial numbers, and their license is usually unclear.
- Use the same layout the instrument software writes, including realistic header lines, units and quirks such as decimal commas, UTF-16 or Y-check values.
- Keep it small. Under about 60 KB is plenty.
- The output must be byte-identical on every run. The script must stay deterministic, with no dates or random seeds that vary.
- Name it `samples/data/<id>.<ext>`, and add it to `samples/data/README.md`.

If you have a real file that the parser must handle, use it locally to check your work. Then reproduce its *layout* synthetically.

### 5. Add `tests/parsers/<id>.test.js`

Copy an existing test file, for example `tests/parsers/chromeleon.test.js`. Include:

- Inline fixtures, built as strings or with byte builders from `PK.parserFixtures`, that cover each variant you support and at least one failure path with its error message.
- A test that parses the sample file through `PK.parserFixtures.withSample(t, '<id>.<ext>', fn)`. In Node it reads `samples/data/` with `fs`. In the in-browser self-test the file isn't available, so the test is skipped. Inline fixtures must therefore cover the behaviour on their own.
- Assertions on known values: point count, units, the retention time of the tallest peak, metadata, and the `r.plugin` id.

Tests must be deterministic and fast (under 1 s each), and must not touch the DOM.

### 6. Run the tests and build

```sh
node tests/run.js parsers   # all parser tests
node tests/run.js           # everything
node build.js               # inline into index.html; also checks for a literal </script>
```

Open `index.html`, drop your sample file on the app, and check that the trace, units and name look right. Then run **Help → Run self-tests**.

## Pull request checklist

- [ ] `src/parsers/<id>.js` starts with `/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */` and has the header comment: format, sniff, variants, **source of format knowledge**, sample path.
- [ ] The code is your own. Nothing is copied or ported from GPL, LGPL, AGPL or EPL readers (for example ChemClipse/OpenChrom, chromConverter, rainbow, or WebPlotDigitizer). Reading a public prose description of a format is fine; translating someone else's parser code is not. MIT/BSD/Apache sources must be credited in `THIRD_PARTY_NOTICES.md` if you used more than general ideas.
- [ ] The format source is named in the PR, for example a specification URL, vendor manual section, or "files exported from MySoft 7.2 by me".
- [ ] The sample file is **synthetic**, generated by `tools/make-samples.js`, small, and **CC0**. No confidential or third-party data.
- [ ] `samples/data/README.md` lists the new file.
- [ ] `tests/parsers/<id>.test.js` has inline-fixture tests, a sample-file test and a failure-path test.
- [ ] `node tests/run.js` passes, `node build.js` succeeds, and the committed `index.html` is rebuilt.
- [ ] Sniffing doesn't steal files from other formats (`node tests/run.js parsers/registry`).
- [ ] Error messages tell the user how to export a readable file.
- [ ] The user-facing list of formats in the docs (README / Help) mentions the new format.
