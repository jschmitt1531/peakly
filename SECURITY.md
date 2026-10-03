# Security policy

## Supported versions

Security fixes go into the latest release. Because Peakly is a single static file, upgrading means replacing the file or reloading the hosted copy.

| Version | Supported |
|---|---|
| 1.1.x | Yes |
| 1.0.x | No (please upgrade) |

## Reporting a vulnerability

**Please report privately. Do not open a public issue for security problems.**

1. Preferred: use GitHub's **[private vulnerability reporting](https://github.com/OWNER/peakly/security/advisories/new)** (Security tab → "Report a vulnerability").
2. Or email **SECURITY_CONTACT_EMAIL** (placeholder until the project has a dedicated address).

Please include the Peakly version (Help → About), browser and OS, steps or a file that reproduces the issue, and the impact you expect. Do not include real patient, clinical or confidential data; build a minimal synthetic reproduction instead.

What to expect: an acknowledgement within 7 days, an initial assessment within 14 days, and a fix or mitigation as fast as the severity warrants. We will credit you in the release notes unless you prefer otherwise. Please give us a reasonable window (normally up to 90 days) before public disclosure.

## Threat model

Peakly is a **client-side only** application: one HTML file that runs entirely in the user's browser tab.

**What Peakly does not have:** a server, accounts, a database, cookies, analytics or telemetry. There is no Peakly backend to breach, and no Peakly-operated service ever receives user data.

**Assets worth protecting:** the user's chromatogram data and project files (possibly confidential), and the user's Anthropic API key if they use the optional Claude assist.

**Trust boundaries and how they are handled:**

| Boundary | Risk | Mitigation |
|---|---|---|
| Untrusted input files (CSV, vendor exports, binary `.ch`/`.cdf`/mzML, images, PDF) | Crafted files causing script injection, hangs or memory exhaustion | Parsers are pure JavaScript over strings/ArrayBuffers with bounds checks; nothing from a file is evaluated as code; text from files is HTML-escaped (`PK.util.escapeHtml`) before display. Hangs/crashes on crafted files are in scope as bugs. |
| Project files and share links (`#fragment`) | A malicious link or project injecting script, or overwriting the user's work | Projects are parsed as JSON and validated/migrated (`PK.schema`) before use; strings are escaped on render; loading a link asks before replacing unsaved work. Share-link data stays in the URL fragment, which browsers do not send to servers. |
| Third-party libraries from CDNs | A compromised CDN or library serving malicious code | Exact versions pinned (no "latest"); see the CDN integrity policy below. |
| Optional Claude vision assist | API key leakage; unintended data transfer | See below. |
| Optional services (cloud save etc.) | Data leaving the browser | Off by default and not shipped in the core build; see [docs/SERVICES.md](docs/SERVICES.md). |

**Out of scope:** attacks that require a compromised browser or operating system, malicious browser extensions, physical access to an unlocked machine, and social-engineering a user into pasting their API key somewhere other than Peakly. Self-hosted copies that someone has modified are the responsibility of whoever modified them.

### Local storage

The app stores only the light/dark **theme preference** in `localStorage`. It does not store data, projects or keys in the browser. Unsaved work is lost when the tab closes unless you export a project file.

## API key handling (optional Claude assist)

The digitizer can optionally ask Claude to read axis labels and printed peak values from an image.

- The feature is **off until the user pastes their own Anthropic API key** and clicks the button. Peakly ships no key.
- The key is held **only in memory**, in a module-scoped JavaScript variable for that tab. It is never written to `localStorage`, `sessionStorage`, IndexedDB, cookies, project files, share links or exports. Closing or reloading the tab discards it; the "clear" button discards it immediately.
- The key is sent only to `https://api.anthropic.com/v1/messages`, directly from the browser, with the image the user is digitizing. Peakly has no proxy and never sees the key or the image.
- The request uses Anthropic's `anthropic-dangerous-direct-browser-access` header, which permits browser-side calls. This means the key is visible to anything else running in that page (for example a malicious browser extension). **Use a dedicated, low-limit key** for this feature and revoke it when you are done.
- Results only pre-fill the calibration form; the user must confirm every value.

## CDN integrity (SRI) policy

Runtime libraries load from cdnjs.cloudflare.com and cdn.jsdelivr.net at pinned, immutable version URLs (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

Policy:
1. **Pin exact versions.** Never reference a floating tag such as `@latest` or a major-only range.
2. **Subresource Integrity.** Every `<script src>` for a third-party library should carry an `integrity="sha384-…"` attribute and `crossorigin="anonymous"`, so the browser refuses a modified file. *Status for 1.1.0: in place for all six library scripts in `src/shell.html`. The pdf.js worker is loaded by pdf.js itself from the same pinned version and cannot carry an SRI attribute.* Hashes must be computed from the exact file served by the CDN (for example `curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A`) and re-computed on every version bump.
3. **Upgrades are reviewed changes.** Any library version bump is its own pull request that updates the URL, the SRI hash, THIRD_PARTY_NOTICES.md and the changelog, with a note on the library's release notes.
4. **Fail visibly.** If a library fails to load, the app shows a banner naming it and keeps working where it can (for example, no Excel import without SheetJS).
5. **Offline/air-gapped use.** Labs that cannot reach CDNs can serve the same pinned files from an internal web server and change the URLs; the SRI hashes stay valid because the files are identical.

## Content-Security-Policy for self-hosting

If you host Peakly yourself, a CSP like the following is compatible (the app uses inline scripts and styles because it is a single file):

```
default-src 'none'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src blob: https://cdnjs.cloudflare.com;
connect-src https://api.anthropic.com; font-src 'self' data:; base-uri 'none'; form-action 'none'
```

Remove `https://api.anthropic.com` from `connect-src` to disable the Claude assist completely.
