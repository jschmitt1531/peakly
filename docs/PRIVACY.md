# Privacy policy

**Effective date:** 2026-10-05 · **Applies to:** the Peakly app (hosted at <https://jschmitt1531.github.io/peakly/app/> or opened from a downloaded `peakly.html`), the Peakly website (<https://jschmitt1531.github.io/peakly/>), and the optional Peakly feedback survey.

> This is not legal advice; have counsel review before relying on it.

Peakly is a free-to-use project run by **Jennifer Schmitt, Ph.D.** ("we", "the maintainer"). It is not a company and has no server of its own. This page explains, in plain language, what information is and is not collected, and by whom.

## Summary

| | What happens |
|---|---|
| **Your chromatograms, images and projects** | Read and processed **only in your browser**. Never uploaded to Peakly. There is no Peakly server. |
| **Accounts** | None. |
| **Cookies** | None, in the app or on the website. |
| **Analytics, tracking, telemetry** | None in the app, ever. None on the website today (see [Website analytics](#website-analytics)). |
| **Browser storage** | A few on-device preferences only (theme and similar); no data, projects or keys. |
| **Optional Claude assist** | Only if *you* paste your own Anthropic API key and click the button: the image you are digitizing is sent from your browser **directly to Anthropic**. |
| **Optional feedback survey** | Only if *you* open it. Hosted on Google Forms; anonymous unless you choose to give an email address. |
| **Third parties who can see your IP address** | The CDNs that serve Peakly's libraries (jsDelivr, cdnjs/Cloudflare) and GitHub Pages, which hosts the site, as with any website. |
| **Sale or sharing of personal information** | Never. |

## 1. The app

Peakly is a single HTML file that runs entirely in your browser tab.

- **Your data stays on your device.** Files you open, images you digitize, peak tables, calibration data and projects are held in the browser's memory. They are not sent to the maintainer or to any Peakly-operated service, because none exists.
- **Exports and share links.** Files you export (PDF, CSV, PNG, project files) are saved by your browser to your device. Share links carry the compressed project in the URL `#fragment`, which browsers do not send to web servers. Anyone you give a link to can read the data in it, and links can end up in chat logs or browser history, so treat a link like the file itself.
- **No cookies, no accounts, no analytics, no telemetry, no error reporting.** The app's Content-Security-Policy blocks connections to any server other than the pinned CDN library files and, for the optional Claude assist, `api.anthropic.com` (see [SECURITY.md](../SECURITY.md#content-security-policy)).

### Browser storage (localStorage)

The app and website use the browser's `localStorage` only for preferences on your own device. Nothing in it is sent anywhere. Current keys:

| Key | Where | Holds |
|---|---|---|
| `peakly-theme` | App | Light/dark theme choice |
| `peakly-site-theme` | Website | Light/dark theme choice |
| `peakly-prefs` | App | Preferences, currently whether single-key keyboard shortcuts are on |
| `peakly-survey` | App | Survey-prompt state (whether and when the optional "tell us what you think" prompt was shown or dismissed), so it is not repeated; never your answers |

No chromatogram data, projects, file names or API keys are stored. You can clear these at any time through your browser's "clear site data" setting.

### Optional Claude assist (Anthropic)

The image digitizer can optionally ask Claude, an AI model made by Anthropic, to read axis labels and printed peak values from an image.

- It runs **only** when you paste **your own** Anthropic API key and click the button. Peakly ships no key and has no Anthropic account of its own for this feature.
- Your key is held **in memory only** for that tab. It is never saved to browser storage, project files, share links or exports.
- When you click the button, your browser sends the image (downscaled) and your key **directly to Anthropic** at `https://api.anthropic.com`. The maintainer never receives the image or the key.
- Anthropic processes that request under **your own agreement with Anthropic**, for example the [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms), and Anthropic's [Privacy Policy](https://www.anthropic.com/legal/privacy). Do not send images that contain confidential, personal or patient information unless your agreement with Anthropic and your organization's rules allow it.

## 2. Third parties that see ordinary web traffic

Like any website, opening Peakly causes your browser to contact a few servers. They receive the technical information every web request carries (your **IP address**, browser user-agent, the time, and the file requested). The maintainer does not receive these logs.

| Service | Why | Their policy |
|---|---|---|
| **GitHub Pages** (GitHub, Inc.) | Hosts the website and the hosted app | [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). GitHub may log visitor IP addresses for security and operations. |
| **jsDelivr** | Serves the pinned Plotly.js library | [jsDelivr privacy policy](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net) |
| **cdnjs** (operated by Cloudflare) | Serves the pinned SheetJS, pako, lz-string, jsPDF and PDF.js libraries | [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/) |
| **GitHub** (github.com) | Source code, issues and discussions, if you visit them | [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) |

If you download `peakly.html` and open it from disk, GitHub Pages is no longer involved, but the CDNs still serve the libraries. Labs that cannot accept this can serve the same pinned files internally ([SECURITY.md](../SECURITY.md#cdn-integrity-sri-policy)).

## 3. The website

The landing page sets no cookies and, today, runs **no analytics**. It stores only your theme preference in `localStorage` (above).

### Website analytics

The website has a switched-off slot for **cookie-free, aggregate** page-view counting (GoatCounter or Plausible), so the project can report usage to funders. It is **off**. If it is ever turned on:

- it will run **only on the landing page, never in the app**;
- it will use no cookies and no cross-site identifiers, and will be skipped for browsers that send Do Not Track or Global Privacy Control;
- this policy and the [FAQ](FAQ.md) will be updated first, naming the provider and linking its policy ([GoatCounter](https://www.goatcounter.com/help/privacy), [Plausible](https://plausible.io/data-policy)).

## 4. The optional feedback survey (Google Forms)

The maintainer may invite feedback through a survey hosted on **Google Forms**. It is entirely optional.

- **When it opens.** Only when you click a survey link (on the website or in the app). The app never sends survey data itself; the form opens in a new tab on Google's site.
- **What is collected.** Your answers to the questions (for example, how you use Peakly and what to improve). The survey is set up **not** to collect your Google account or email address automatically.
- **Anonymous by default.** Please do not put personal or confidential information in free-text answers.
- **Optional email opt-in.** The survey itself never asks for your email. If you want future surveys, a **separate short sign-up form** (linked at the end of the survey and in Peakly's About panel) lets you give an email address **only** to be invited to future Peakly surveys or told about major releases. This is voluntary, and the **lawful basis is your consent**. It is not used for anything else, not sold, and not shared.
- **Where it is stored.** Responses go to a Google Sheet owned by the dedicated Peakly Google account (peaklyfeedback@gmail.com), not a personal account. Invitations are sent from that address. Google provides the form and storage on the maintainer's behalf. Google's own processing (for example, security logs when you load the form, or your Google account if you are signed in) is governed by the [Google Privacy Policy](https://policies.google.com/privacy).
- **Who can see it.** Only the maintainer (and any co-maintainer explicitly given access). Results may be published in **aggregate or de-identified** form, for example in grant reports; email addresses are never published.
- **Retention.** Survey answers are kept while they are useful for improving Peakly, and reviewed at least once a year. Email addresses are kept until you unsubscribe, or for at most **24 months after the last survey invitation sent to you**, whichever comes first.
- **Unsubscribe or delete.** Every invitation will include an unsubscribe link (the unsubscribe form), or you can simply reply "unsubscribe" or email [peaklyfeedback@gmail.com](mailto:peaklyfeedback@gmail.com). You can also ask for your email or identifiable answers to be deleted (see [Your rights](#6-your-rights)). Anonymous answers cannot be linked to you, so they cannot be found and deleted individually.

## 5. Contacting the project

Peakly's contact address is **[peaklyfeedback@gmail.com](mailto:peaklyfeedback@gmail.com)**, a dedicated project mailbox (a separate Peakly Google account, not a personal one). The same account owns the feedback survey, its response sheet and the opt-in mailing list, and sends survey invitations. Email to it is read only by the maintainer and kept only as long as needed to answer you.

You can also use GitHub: [issues](https://github.com/jschmitt1531/peakly/issues/new/choose), [Discussions](https://github.com/jschmitt1531/peakly/discussions), or [private vulnerability reporting](https://github.com/jschmitt1531/peakly/security/advisories/new) for security issues. Anything you post in an issue or discussion is **public** and is handled by GitHub under its privacy statement. Do not post personal data there.

## 6. Your rights

Wherever you live, you can ask us to **tell you what we hold about you, correct it, or delete it**. In practice the only personal data the maintainer may hold is a survey email address you chose to give (and anything identifying you wrote in a survey answer).

- **EU/EEA and UK (GDPR / UK GDPR).** You have rights of access, rectification, erasure, restriction, objection and data portability, and you can **withdraw consent** at any time (this does not affect processing before withdrawal). You can complain to your local data-protection authority. The controller for survey data is Jennifer Schmitt, the Peakly maintainer, contactable at [peaklyfeedback@gmail.com](mailto:peaklyfeedback@gmail.com).
- **California (CCPA/CPRA) and other US states.** We **do not sell or share** personal information (including for cross-context behavioral advertising), and we do not use sensitive personal information. You may request to know, delete or correct personal information, and you will not be treated differently for doing so.
- **How to make a request.** Email **[peaklyfeedback@gmail.com](mailto:peaklyfeedback@gmail.com)** (from the address concerned, if your request is about a survey email), use the survey's unsubscribe form, or open a GitHub issue titled **"Privacy request"** that contains **no personal details** and a private channel will be arranged. We aim to respond within 30 days. We may need to confirm the request comes from the owner of the email address before acting.

## 7. International users

The maintainer is in the United States. The services listed above (GitHub, Google, Anthropic, Cloudflare/cdnjs, jsDelivr) may process data in the US and other countries under their own safeguards; see their policies. The app itself sends your chromatogram data nowhere.

## 8. Children

Peakly is a scientific tool for researchers, students and educators. It is **not directed to children under 13**, and the survey is **not intended for anyone under 16**. We do not knowingly collect personal information from children. If you believe a child has submitted an email address, ask us to delete it (see [Your rights](#6-your-rights)).

## 9. Security

There is no Peakly server or database to breach. See [SECURITY.md](../SECURITY.md) for the threat model, API-key handling, CDN integrity and how to report a vulnerability.

## 10. Changes to this policy

If what Peakly collects changes (for example, if website analytics are switched on), this page will be updated **before** the change takes effect, with a new effective date, and noted in the [CHANGELOG](../CHANGELOG.md). Past versions are in the repository's Git history.

## 11. Contact

Jennifer Schmitt, Ph.D., Peakly maintainer: [peaklyfeedback@gmail.com](mailto:peaklyfeedback@gmail.com), or via [GitHub](https://github.com/jschmitt1531/peakly/issues/new/choose). Related: [Terms of use](TERMS.md) · [Accessibility statement](ACCESSIBILITY_STATEMENT.md) · [Security policy](../SECURITY.md).
