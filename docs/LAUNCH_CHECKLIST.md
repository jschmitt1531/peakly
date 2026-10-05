# Launch checklist: public website and app

What Peakly needs to run as a public web tool at <https://jschmitt1531.github.io/peakly/> (app at `/app/`). Status as of 2026-10-05. **Owner** = Jennifer Schmitt (repository admin).

Legend: ✅ done in the repo · ⏳ owner action needed · ➖ not needed / optional

## Before flipping the repository to public

| # | Item | Status | Notes / owner action |
|---|---|---|---|
| 1 | **Legal review** of [PRIVACY.md](PRIVACY.md), [TERMS.md](TERMS.md), [ACCESSIBILITY_STATEMENT.md](ACCESSIBILITY_STATEMENT.md), [TRADEMARKS.md](TRADEMARKS.md) | ⏳ | Each is marked "not legal advice". Have counsel review, especially liability limits, survey consent wording, and the retention periods (24 months for survey emails) before relying on them. |
| 2 | **Governing law** in TERMS.md §10 | ⏳ | Replace `[STATE], USA` (and add a venue if counsel advises). |
| 3 | **GitHub account security** | ⏳ | See [SECURITY.md](../SECURITY.md) and the project notes: enable 2FA (passkey + authenticator app; store recovery codes offline), turn on vigilant mode (show unsigned commits), "block command-line pushes that expose my email", review authorized OAuth apps, personal access tokens, SSH keys and active sessions. Turn on 2FA for the Peakly Google account (peaklyfeedback@gmail.com) too, since it owns the survey data. |
| 4 | **Repository hardening** | ⏳ | After making the repo public, run `tools/github-security-setup.sh` (Dependabot alerts and security updates, private vulnerability reporting, secret scanning + push protection, read-only workflow token, branch ruleset). Confirm the `triage` label exists (used by issue templates; currently missing) and the `accessibility` label (exists). |
| 5 | **Content review** | ⏳ | Read the About text in `src/config.js` and the landing page bio. |
| 6 | **Survey setup (Google Forms)** | ✅ | Created 2026-10-05 by `tools/survey/create-survey.gs` in the Peakly Google account (Drive folder "Peakly feedback"): survey https://forms.gle/Cqr15LVq2gkGEDhP8, future-surveys sign-up https://forms.gle/jeoMRAKqtvpzbnBV9, unsubscribe form, results sheet with Dashboard, private mailing-list sheet. Verified: all three forms open without sign-in; no automatic email collection. Links are in `src/config.js` and `docs/index.html`. Owner: calendar a yearly review of the sheets; delete emails per the retention rule. |
| 7 | **Google's role** | ⏳ | A personal/consumer Google account is governed by Google's consumer terms; Google acts as a processor only under Google Workspace's Cloud Data Processing Addendum. If EU/UK respondents are expected, ask counsel whether the consumer account is acceptable or whether to use Workspace. PRIVACY.md is worded to be accurate either way. |

## Hosting and site basics

| # | Item | Status | Notes |
|---|---|---|---|
| 8 | **HTTPS** | ✅ | GitHub Pages serves `*.github.io` over HTTPS. After the first deploy, check Settings → Pages → "Enforce HTTPS" is ticked. |
| 9 | **Pages deployment** | ✅ / ⏳ | `.github/workflows/pages.yml` builds, tests and publishes `docs/` + the app. Fixed: `upload-pages-artifact` drops dot-files by default, so `include-hidden-files: true` was added (needed for `.well-known/security.txt` and `.nojekyll`), and the job now fails if a launch file is missing. Owner: Settings → Pages → Source: **GitHub Actions** (the job is skipped while the repo is private). |
| 10 | **Custom domain** | ➖ | Optional. If added (e.g. `peakly.app`), update canonical/OG URLs in `docs/index.html`, `404.html`, `sitemap.xml`, `robots.txt`, `security.txt`, `CITATION.cff` `url`, README links, and add a `CNAME`. A custom domain also makes robots.txt and security.txt work at the host root (items 12–13). |
| 11 | **404 page** | ✅ | `docs/404.html` (absolute links, light/dark, no scripts). |
| 12 | **robots.txt / sitemap.xml** | ✅ with caveat | Both in `docs/`. On a GitHub *project* site they live at `/peakly/robots.txt`, and crawlers only read `robots.txt` at the host root, so it has no effect there (harmless; nothing is disallowed). Submit `https://jschmitt1531.github.io/peakly/sitemap.xml` directly in Google Search Console / Bing Webmaster Tools (owner, optional). |
| 13 | **security.txt (RFC 9116)** | ✅ with caveat | `docs/.well-known/security.txt` with Contact (GitHub advisory URL + mailto), Expires **2027-10-04** (renew before then; max 1 year), Preferred-Languages, Canonical, Policy. RFC 9116 expects it at the host root (`/.well-known/`); on the project site it is at `/peakly/.well-known/security.txt`. For a root copy, the owner can create a `jschmitt1531.github.io` user-site repository containing the same file, or use a custom domain. Optional: sign it with OpenPGP. **Calendar the renewal.** |
| 14 | **Favicon / manifest** | ✅ | `favicon.svg` (adapts to dark tabs), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `site.webmanifest`, `theme-color`. The app (`src/shell.html`) keeps its own inline icon. |
| 15 | **Social preview** | ✅ / ⏳ | Open Graph and Twitter Card tags with an absolute image URL (`img/app-overview.png`, 1440×900) and alt text. Owner: also upload a 1280×640 image in GitHub → Settings → Social preview for the repository card. |
| 16 | **SEO basics** | ✅ | `lang="en"`, unique `<title>`, meta description, canonical URL, headings in order, descriptive link text, sitemap. Policy and doc pages are rendered by GitHub (linked from the footer), not hosted on the Pages site. |
| 17 | **Uptime / monitoring** | ➖ | Static hosting; status at <https://www.githubstatus.com/>. Optional: a free external uptime check on `/` and `/app/`. The app keeps working from a downloaded `peakly.html` if Pages is down (CDNs still needed). |
| 18 | **Backups** | ✅ | Git is the backup: keep a local clone; Zenodo archives each release (item 21). Survey data: export the response Sheet periodically, stored privately. |

## Policies and user-facing statements

| # | Item | Status | Notes |
|---|---|---|---|
| 19 | **Privacy policy** | ✅ | [PRIVACY.md](PRIVACY.md), effective 2026-10-05, linked from the site footer and README. Update it **before** any change in data handling (analytics, new service). |
| 20 | **Terms of use** | ✅ (⏳ items 1–2) | [TERMS.md](TERMS.md). |
| 21 | **Accessibility statement** | ✅ | [ACCESSIBILITY_STATEMENT.md](ACCESSIBILITY_STATEMENT.md): "partially conformant" with WCAG 2.1 AA. Update when [ACCESSIBILITY.md](ACCESSIBILITY.md) open items close and after a screen-reader pass. New issue form `.github/ISSUE_TEMPLATE/accessibility.yml`. Landing page checked with axe-core 4.10 (WCAG 2.0/2.1/2.2 A/AA + best practice): 0 violations, light and dark, desktop and 390 px. |
| 22 | **Cookie statement / banner** | ➖ | No cookies and no non-essential storage that needs consent: `localStorage` holds only user-requested preferences (theme, shortcuts, survey-prompt state), which is "strictly necessary" for a feature the user asked for under the ePrivacy rules, and nothing is sent anywhere. So **no cookie banner is needed**. If analytics that set cookies or identifiers were ever added, this would change; the planned options (GoatCounter/Plausible) are cookie-free. |
| 23 | **Analytics** | ➖ off | Slot in `docs/index.html`, set to `'off'`. Never in the app (CSP blocks it anyway). If enabled: cookie-free provider only, respect DNT/GPC, update PRIVACY.md §3 and the FAQ first. |
| 24 | **Credits / licenses** | ✅ | [CREDITS.md](CREDITS.md), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), [PRIOR_ART.md](../PRIOR_ART.md); AI-assistance disclosure in README, CREDITS and the site footer. |
| 25 | **Trademarks** | ✅ | [TRADEMARKS.md](TRADEMARKS.md); README and footer carry a short notice. |
| 26 | **Not a medical device; regulated use** | ✅ | TERMS §3 and the README: research and education only; not validated for GMP/GLP; not for clinical or diagnostic decisions. Do not market it for diagnostic or regulated release use, which could change its regulatory status. |
| 27 | **Export control** | ✅ | Publicly available open-source software with no encryption beyond the browser's own HTTPS; generally not subject to licensing requirements when published (US EAR "published" software). TERMS §9 reminds users of their own obligations. Ask counsel if a commercial services layer is ever added. |

## Releases, support and security

| # | Item | Status | Notes |
|---|---|---|---|
| 28 | **Versioning & releases** | ✅ | SemVer, CHANGELOG (Keep a Changelog), process in [RELEASING.md](RELEASING.md). |
| 29 | **DOI** | ⏳ | Connect the repo in Zenodo (GitHub integration) *before* the next release tag; then add the DOI to `CITATION.cff`, the README badge and `src/config.js`. |
| 30 | **Support channels** | ✅ / ⏳ | GitHub issues (bug, feature, format, accessibility forms), Discussions, and peaklyfeedback@gmail.com. Owner: watch the repo and the mailbox; enable Discussions categories (Q&A, Show and tell). |
| 31 | **Security reporting** | ✅ / ⏳ | [SECURITY.md](../SECURITY.md); private vulnerability reporting is enabled by the setup script once public. Note: SECURITY.md "Local storage" still says only the theme is stored; it should also list `peakly-prefs` and `peakly-survey` (outside this checklist's files; flagged to the maintainer). |
| 32 | **Dependency updates** | ✅ | Dependabot (weekly) for SHA-pinned GitHub Actions. CDN libraries are pinned with SRI and bumped by hand (SECURITY.md policy). Owner: check library advisories roughly quarterly (Plotly, SheetJS, PDF.js especially). |
| 33 | **CSP / SRI** | ✅ app / ➖ site | The app ships a strict hash-based CSP and SRI on all six libraries. The landing page has no CSP: it loads no third-party scripts while analytics is off. Optional: add a CSP `<meta>` with script hashes to `docs/index.html` (and extend it if analytics is enabled). GitHub Pages cannot set custom HTTP headers (no `frame-ancestors`, HSTS is GitHub's default). |
| 34 | **Browser support matrix** | ✅ | Current Chrome, Edge, Firefox, Safari (desktop), Safari iOS/iPadOS, Chrome Android. Tested: Chromium desktop and 390 px mobile emulation; owner/contributors: spot-check Safari and Firefox before each release. |
| 35 | **Performance** | ✅ note | Built `index.html` is about 1.0 MB (inlined app code and styles), plus CDN libraries on first load (uncompressed: Plotly ≈ 4.6 MB, SheetJS ≈ 0.9 MB, PDF.js + worker ≈ 1.4 MB, jsPDF ≈ 0.36 MB, pako and lz-string small; the PDF.js worker loads only when a PDF is opened), all cached afterwards. Pages serves gzip/brotli. Fine on broadband; slow on poor mobile links. Possible later: lazy-load SheetJS/PDF.js/jsPDF on first use. |
| 36 | **Survey data protection** | ⏳ | Consent text on the opt-in question; anonymous by default; access limited to the Peakly account; 2FA on that account; retention per PRIVACY §4 (yearly review; delete emails 24 months after last invitation or on unsubscribe); every invitation has an unsubscribe link; handle deletion requests within 30 days; never publish emails; publish only aggregate results. |

## After launch

- Re-run the landing-page accessibility and console checks after any change to `docs/index.html`.
- Renew `security.txt` `Expires` before **2027-10-04**.
- Update PRIVACY/TERMS effective dates and CHANGELOG on any change.
- Review this checklist at each minor release.
