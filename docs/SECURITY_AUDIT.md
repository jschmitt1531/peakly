# Security audit: untrusted input, XSS and Content-Security-Policy

**Scope:** Peakly 1.1.0 single-file app (`src/*.js`, `src/parsers/*.js`, `src/shell.html`, `build.js`).
**Audited revision:** commit `2f33092` (all `file:line` references below point at that revision, i.e. *before* the fixes).
**Date:** October 2026.

## 1. Threat model

Peakly has no server, so the attack surface is the browser tab. Everything below is attacker-controlled and was treated
as hostile:

| Input | Entry point |
|---|---|
| Instrument files (CSV/TSV/TXT, JSON, XML/mzML, JCAMP, netCDF, `.ch`, xlsx), their **file names** and **metadata** (sample names, instrument strings, JCAMP `##TITLE`, mzML chromatogram ids, column headers) | `PK.parsers.*` → `app.handleFiles` → `normalizeTrace` |
| Peakly project files (`.peakly.json`), including the `images` map | `importFile` / `#project-input` → `loadProjectObj` → `sanitizeProject` |
| Share links `#p=…` (LZString-compressed project JSON; anyone can craft one and send it) | `checkHash` → `decodeShare` → `unpackShare` → `sanitizeProject` |
| Pasted text / pasted images | `pasteImport`, digitizer `onPaste` |
| The Claude vision API response (model output is untrusted text) | `PK.digitizer._parseClaudeJSON` → `_normalizeClaude` |

Hostile strings used throughout: `<img src=x onerror=…>`, `"><svg onload=…>`, `javascript:` URLs,
`<a href="javascript:…">` (Plotly markup), `%{…}` (Plotly template tokens), 100 k-character strings, and JSON keys
`__proto__` / `constructor` / `prototype`.

## 2. Method

1. **Sink inventory.** Grepped every `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `href=`/`src=`,
   `setAttribute`, `style="…"` concatenation, `new Function`/`eval`/string timers, and every Plotly text field (trace
   `name`, `text`, `hovertemplate`, layout/axis `title`, `annotations[].text`, layout `images[].source`) in
   `src/app.js`, `src/digitizer.js`, `src/parsers/*`, `src/shell.html`. Each concatenated value was traced back to its
   source.
2. **Data-flow review** of the three loaders (file import, project file, share link) end to end:
   `decodeShare → unpackShare → (schema.migrate) → sanitizeProject → normalizeTrace → render*`.
3. **Prototype pollution:** every place where parsed JSON is merged or copied by key (`mergeDeep`, `Object.assign`-style
   loops, maps keyed by file content).
4. **Dynamic tests:** hostile share link, hostile project file, hostile CSV/JSON/JCAMP/mzML imports in Chrome against the
   pre-fix build and the fixed build (a payload sets `window.__pwned` / `document.title`; the DOM is then scanned for any
   attribute starting with `on`, `<img>`, `<svg onload>`, `javascript:` URLs and `url(` in style attributes).
5. **CSP verification** in Chrome over `http://localhost` and from `file://` with headless Chrome, for every `?demo=`
   mode, the in-app self-test, and every export path.

## 3. Findings

Severity: **High** = script execution or global state corruption from a link or file with no or minimal user action;
**Medium** = needs a specific user action, or injection limited to links/markup/data exfiltration; **Low** = robustness
or defence-in-depth; **Info** = no direct impact.

| ID | Location (pre-fix) | Severity | Description | Fix | Status |
|---|---|---|---|---|---|
| F-01 | `src/app.js:733-745` (`renderProc`), fed by `src/app.js:121` | **High** | Processing settings from a project or share link (`proc.smooth.window`, `.order`, `baseline.p`, `.iter`, `peaks.threshold`, `.minDist`, `.minWidth`) were merged without type checks and concatenated into `value="…"` attributes. A share link with `window: "\"><img src=x onerror=…>"` executed script as soon as the link was opened (the active trace's panel renders on load). Confirmed against the pre-fix build. | `sanitizeProc()` coerces every field to a bounded number/boolean (`'auto'` for the threshold); `normalizeTrace` uses it instead of `mergeDeep`. | Fixed, regression test |
| F-02 | `src/app.js:86-94` (`mergeDeep`), used at `:120-121`, `:159`, `:164`; `src/schema.js:76` | **High** | Prototype pollution: `JSON.parse` creates an own `"__proto__"` key; `mergeDeep(out.settings, p.settings)` then recursed into `dst["__proto__"]` (= `Object.prototype`) and copied attacker keys onto it. A share link or project file polluted `Object.prototype` for the whole tab (verified in Node: `({}).polluted === 1`). | `mergeDeep` skips `__proto__`/`constructor`/`prototype`; `sanitizeProject` and `schema.migrate` first deep-copy input through `PK.util.stripUnsafeKeys`; settings/method/style/proc are rebuilt field by field (`sanitizeSettings`, `sanitizeMethod`, …) instead of merged. | Fixed, regression tests |
| F-03 | `src/app.js:2711-2717` (`readoutText`) | **High** | The curve-tracing cursor chip (`chip.innerHTML`, on by default, shown on any mouse-over of the plot) interpolated `t.xUnit`, `t.yUnit` and the salt/imidazole unit unescaped. A unit such as `<img src=x onerror=…>` from a file or link ran on hover. | Every data-derived part is escaped in HTML mode; colour passes `safeColor`. Units are also type-checked and length-capped on load. | Fixed |
| F-04 | `src/app.js:2176` (`renderGradTable`) | Medium | `method.bConcUnit` was concatenated into the gradient table header (`innerHTML`); script ran when the user opened *Method* on a salt/imidazole project. | Escaped; `bConcUnit` coerced to a string of ≤ 16 chars on load. | Fixed |
| F-05 | `src/app.js:1110`, `:1114-1116`, `:1131`, `:1013`, `:1244`, `:1266`, `:1273-1274`, `:3295`, `:3302`, `:3312`; `src/digitizer.js:1374` | Medium | Plotly renders a subset of HTML in names, titles, annotations and hover labels (`<a href>`, `<span style>`, `<b>`…) and expands `%{…}` in `hovertemplate`. Trace names (legend), units and roles (axis titles), the concentration unit, calibration-unknown names (`text` shown via `%{text}`) and the digitizer preview were passed raw: a file could plant clickable `https://` links, restyle the plot, or inject template tokens into hover labels. (Plotly itself drops `javascript:` hrefs, so no script execution was found.) Escaping with `esc()` then `slice()` could also cut entities in half. | New `PK.util.plotlyText` (escapes `& < >`, turns `%{` into `%&#123;`, which Plotly displays as `{`) used for every Plotly text field; truncation happens before escaping. Title/label in-place edits decode it back. | Fixed, regression test |
| F-06 | `src/app.js:165`, `:1044`, `:1123` | Medium | The project `images` map was accepted as-is and used as `<img>.src` (size probe) and as a Plotly layout image. A project file could reference `https://attacker/…` (a beacon revealing that and when the file was opened, against the "nothing leaves the browser" promise), `data:image/svg+xml` or `javascript:` URLs. | `PK.util.safeDataImage` allow-lists `data:image/(png|jpeg|webp|gif);base64,…` only; `sanitizeImages` filters the map on load and both use sites re-check. Share links never carried images (unchanged). | Fixed, regression test |
| F-07 | `src/app.js:120`, `:1734`, `:2713` | Low | `style.color` from a file/link was escaped but not validated before going into `style="background:…"`, allowing CSS injection such as `red;background-image:url(https://attacker/…)` (data beacon). | `PK.util.safeColor` (hex, `rgb[a]()`, keyword) on load; invalid colours fall back to the palette. | Fixed, regression test |
| F-08 | `src/shell.html` (no CSP); `:23-28` | Medium | No Content-Security-Policy, so any future escaping slip would be directly exploitable and nothing enforced the "no network except pinned libraries and the optional Claude call" promise. The six CDN `<script>` tags used inline `onerror="…"` handlers, which a hash-based CSP cannot allow. | Added a `<meta>` CSP with **sha256 hashes** of the inline scripts (computed by `build.js`), no `'unsafe-inline'`/`'unsafe-eval'` for scripts, path-scoped library sources, `connect-src` limited to the Anthropic API. Inline handlers replaced by a capturing `error` listener (`data-pk-lib`). `build.js` refuses to build if inline handlers or `javascript:` URLs appear in markup. Added `<meta name="referrer" content="no-referrer">` so library requests do not send the page URL. See §4. | Fixed |
| F-09 | `src/app.js:193-201` (`unpackArray`) | Low | A share link can describe arrays as `{u:[x0,dx,n]}`; `n` was capped at 5·10⁶ per array but not in total, so a short link with many such traces could allocate gigabytes and crash the tab. `+n|0` also wrapped large values to negative/odd lengths. | Total budget of 2·10⁷ points per link, per-array cap kept, `Math.floor` instead of `|0`, sane exponent check for `{e,d}` arrays, non-object traces rejected. | Fixed, regression test |
| F-10 | `src/app.js:104-147` (`normalizeTrace`), `:1110` | Low | Fields were trusted to have their documented types. Non-string `meta.role` crashed every render (`charAt` on an object); object ids or names produced `[object Object]` and broken references; non-array `events` or `digitized.printedPeaks` threw. | Typed coercion for every project/trace field (`sanitizeMeta`, `sanitizeSource`, `sanitizeDigitized`, `sanitizeFit`, `sanitizeRun`, `idStr`, `sStr` with length caps). | Fixed, regression test |
| F-11 | `src/parsers/json.js:80`, `:91`; `src/parsers/netcdf.js:34`, `:46` | Low | Maps keyed by file content (`by[trace_id]`, `units[...]`, netCDF attribute/variable names) were plain objects: a trace id `__proto__`/`constructor`/`toString` crashed the JSON data-row import and netCDF names could replace a map's prototype (local only; no global pollution). | `Object.create(null)` maps. | Fixed, regression test |
| F-12 | `src/digitizer.js:636`, `:642-645` (`_normalizeClaude`) | Low | The Claude response is untrusted model output. Titles, axis labels/units and peak labels were passed through without type checks (objects/arrays reached later string code). All HTML sinks already escaped them and trace colours were already normalized. | Strings coerced and length-capped (`str()`), list sizes capped; `addTrace` re-normalizes colours. | Fixed, regression test |
| F-13 | `src/digitizer.js:1024` | Info | pdf.js probes `new Function` to compile PostScript functions; under the new CSP that probe is a (harmless, caught) violation. | `getDocument({…, isEvalSupported: false})`. | Fixed |
| F-14 | `src/core.js` (`escapeHtml`) | Info | Backtick was not escaped. No unquoted-attribute or template contexts were found, so not exploitable today. | Backtick escaped as `&#96;`. | Fixed |
| F-15 | `src/parsers/mzml.js` | Info | XML character references in attributes (e.g. `&quot;`) are not decoded, so such ids display literally (still escaped; cosmetic). | — | Open (cosmetic) |
| F-16 | `src/digitizer.js` (PDF import) | Info | pdf.js renders with `requestAnimationFrame`, so PDF pages do not render while the tab is hidden (observed in background automation tabs). Not CSP-related. | — | Open (not security) |

Paths reviewed and found safe: all other `innerHTML` templates escape data with `esc()` or use only numbers and
constants; the trace list, peak table, compare table, calibration dialog, run-info and metadata tables, audit popovers,
integration-math dialog, split dialog, import mapper (file name, headers, raw text in `<pre>`), share dialog, self-test
list, About (links only from `PK.config`, checked with `^https://`), toasts (`textContent`), the digitizer side panels;
PDF report text goes through jsPDF (no HTML); CSV export quotes cells; external links use
`rel="noopener noreferrer"`; there is no `eval`, `new Function`, string `setTimeout` or `document.write` in Peakly code.

## 4. Content-Security-Policy

`src/shell.html` carries the policy; `node build.js` replaces the `PK_SCRIPT_HASHES` placeholder with the sha256 of each
inline script (the theme bootstrap, the app bundle and the self-test bundle). The built `index.html` contains:

```
default-src 'none';
script-src 'self' 'sha256-…' 'sha256-…' 'sha256-…'
  https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/
  https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/
  https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/
  https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/
  https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://api.anthropic.com blob: data:;
worker-src blob: https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/;
object-src 'none'; base-uri 'none'; form-action 'none'
```

Why each part:

- **Scripts:** no `'unsafe-inline'` and no `'unsafe-eval'`. Inline scripts run only if their hash matches, so an
  injected `<script>` or `onerror=` attribute is blocked even if an escaping bug slips in. Third-party code is limited to
  the exact pinned library *directories* (not whole CDN hosts, which would let an injected tag load any package from
  jsDelivr/cdnjs as a script gadget), and each library tag additionally has SRI.
- **No eval needed:** the app draws only SVG `scatter` traces (no `scattergl`/WebGL, whose regl code generation would
  need `'unsafe-eval'`). Plotly 2.35, SheetJS 0.18.5, pako, lz-string and jsPDF 2.5.1 load and run (plots, xlsx import,
  PNG/SVG/PDF export, share links) without any violation; pdf.js runs with `isEvalSupported: false`.
- **pdf.js worker:** pdf.js 3.11 sees a cross-origin `workerSrc` and wraps it in a `blob:` worker that calls
  `importScripts()` on the cdnjs URL. `worker-src blob:` allows the wrapper; the imported script is covered by
  `script-src` (blob workers inherit the page policy). Verified: a real `Worker` renders a PDF page under the CSP.
- **Styles:** `'unsafe-inline'` is required: Plotly sets inline styles and injects `<style>` rules, the app uses
  `style=""` attributes and `PK.injectCSS`. CSS injection is mitigated separately (F-07: colours validated).
- **Images:** `data:` (favicon, digitizer images, Plotly export rasterization) and `blob:`. No remote images.
- **connect-src:** only `https://api.anthropic.com` (the optional, user-started Claude call), plus `blob:`/`data:` for
  local object URLs. Removing the Anthropic origin disables the Claude assist completely. Any other network request, for
  example a beacon planted in a project file, is blocked by the browser.
- **object-src/base-uri/form-action `'none'`:** no plugins, no `<base>` hijacking, no form posts.
- **Referrer:** `<meta name="referrer" content="no-referrer">` stops the page URL being sent to the CDNs.

Limits of a `<meta>` CSP (document for anyone hosting Peakly):

- `frame-ancestors`, `sandbox` and `report-uri`/`report-to` are **ignored in `<meta>`**. To prevent clickjacking (framing)
  or collect violation reports, send the policy as an HTTP `Content-Security-Policy` header (plus `frame-ancestors 'none'`)
  from the web server. GitHub Pages cannot set headers; the meta policy still applies there.
- The policy only takes effect from the point the `<meta>` is parsed; it is the first element after `<meta charset>`.
- `'unsafe-inline'` for styles remains (see above).
- `'self'` is meaningless for `file://` pages (Chrome treats the origin as opaque); nothing in Peakly loads from `'self'`,
  so the app works the same from disk (verified with headless Chrome).
- Self-hosters who serve the libraries from their own server must add that origin/path to `script-src` (and to
  `worker-src` for pdf.js). The SRI hashes stay valid.
- Changing any inline script requires a rebuild (`node build.js`) so the hashes match; editing `index.html` by hand
  breaks the app (the browser console names the expected hash).

## 5. Verification performed

- `node tests/run.js`: all tests pass, including 12 new tests in `tests/security.test.js` (escaping, `plotlyText`,
  image/colour allow-lists, `stripUnsafeKeys`, `schema.migrate`, `sanitizeProject` on a hostile project, a crafted
  `decodeShare` link, `unpackArray` budgets, `sanitizeImages`/`sanitizeSettings`, Claude response normalizing, JSON data
  rows keyed `__proto__`/`constructor`).
- Chrome over `http://localhost:8765`: every `?demo=` mode (`hplc`, `calibration`, `compare`, `integration-math`,
  `about`, `image`, `fplc`, `split`) renders with **zero CSP violations**; the in-app self-test passes; PNG and SVG
  (`Plotly.toImage`), the PDF report (jsPDF), peak/compare/trace CSV, trace/project/calibration JSON (blob URLs), xlsx
  import (SheetJS), PDF page import in the digitizer (pdf.js worker) and share-link encode/decode all work.
- Headless Chrome from `file://` for every `?demo=` mode: page renders (`data-demo-ready="1"`, Plotly SVG present),
  no `Content Security Policy` messages in the log.
- Hostile share link (`#p=` built with `PK.app.encodeShare` from a project whose trace name, peak labels, units, role,
  run info, method fields, calibration analyte/unit, settings and image map carry the payloads above, plus `__proto__`
  and `constructor` keys): no script ran (`window.__pwned` stayed undefined), `Object.prototype` stayed clean, no element
  in the DOM had an `on*` attribute, no `<img>`/`<svg onload>`/`javascript:` URL/`url(` style appeared, and the payload
  text showed literally in the trace list, tables, dialogs, cursor chip, Plotly legend, axis titles, annotations and hover
  labels. The same link against the pre-fix build executed the payload (F-01).
- Hostile imports (CSV with a hostile file name and column headers, JSON traces with hostile names/units and a
  `__proto__` metadata key, JCAMP with hostile `##TITLE`/`##XUNITS`/`##YUNITS`, mzML with a hostile chromatogram id, a
  hostile project file with an images map): same result; only the base64 PNG image survived.

## 6. How to re-run the checks

```bash
node build.js                 # rebuilds index.html, injects CSP hashes, fails on inline handlers / javascript: URLs
node tests/run.js             # all tests
node tests/run.js security    # just the security regression tests

# Sinks to re-audit after UI changes
grep -nE "innerHTML|insertAdjacentHTML|outerHTML|document\.write|\.src *=|href=|style=\"[^\"]*' *\+" src/*.js
grep -nE "name:|text:|title:|hovertemplate" src/app.js src/digitizer.js | grep -v "ptxt\|plotlyText"   # Plotly text fields

# CSP from disk (look for "Content Security Policy" in err.log; headless Chrome may not exit, the DOM is written first)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --enable-logging=stderr --v=0 \
  --virtual-time-budget=20000 --dump-dom "file://$PWD/index.html?demo=hplc" > dom.html 2> err.log
grep -i "content security policy" err.log
```

In a browser: open each `index.html?demo=<mode>` with DevTools open and check the console for
"Content Security Policy" errors; run Help → *Run self-tests*. For a share-link test, build a project object whose
strings contain `<img src=x onerror="window.__pwned=1">`, encode it with `PK.app.encodeShare(obj)`, open
`index.html?fresh#p=<encoded>` in a new tab, open every dialog, hover the plot, and confirm `window.__pwned` is
`undefined`, `({}).polluted` is `undefined` and
`[...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name)))` is empty.

Rules for new code: build HTML only with `PK.util.escapeHtml` (or `textContent`) for every value that did not come from
a constant; pass every user/file string given to Plotly through `PK.util.plotlyText`; validate URLs, colours and images
with the `PK.util.safe*` helpers; never merge parsed JSON with plain object spread/assign: go through the typed
sanitizers in `app.js`; never add inline `on*=` attributes (use `addEventListener`).
