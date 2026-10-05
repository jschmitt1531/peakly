<!-- SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 -->
# Protecting Peakly from copying and AI scraping (owner guide)

> This is practical guidance, not legal advice. Have an intellectual-property lawyer review it, especially the copyright and trademark steps.

## What is and isn't possible

Peakly runs in each visitor's browser, so every visitor downloads its code, and a public GitHub repository can be read by anyone. **Nothing can make copying technically impossible.** What Peakly does instead:

1. Make copying, modifying, redistributing, selling, scraping and AI training **clearly unlawful**, through the license.
2. Tell AI crawlers **no** in machine-readable ways that reputable crawlers respect.
3. Make it **easy to prove** that Peakly is yours and that a copy came from it.
4. Give you a **process to act** when you find a copy.

## 1. Legal terms already in place

- **[LICENSE](../LICENSE)** (Peakly Free-Use License 1.0):
  - **What it allows:** free use only. Copying, modifying, merging, publishing, distribution, sublicensing and selling are not allowed.
  - **§2f:** scraping and mining, and using any part of Peakly to train or prompt AI systems or build datasets, are prohibited. It expressly reserves text and data mining rights, including under Article 4(3) of the EU Directive 2019/790 (the "TDM opt-out").
  - **§2g:** claiming Peakly as your own work is prohibited.
- **[TERMS.md](TERMS.md) §5** repeats these rules for the website and app.
- Every source file starts with a license header, and the built app starts with a copyright banner.

## 2. Machine-readable "no AI" signals already in place

| Signal | Where | Notes |
|---|---|---|
| `<meta name="tdm-reservation" content="1">` + `tdm-policy` | App and website pages | W3C TDM Reservation Protocol (TDMRep); recognised as a machine-readable opt-out in the EU. Works on the GitHub Pages address. |
| `/.well-known/tdmrep.json` | Website | Same protocol, site-wide. Only read at a domain root, so it takes effect with a custom domain. |
| `<meta name="robots" content="noai, noimageai">` | App and website | A widely used convention, but not a formal standard. Some services honour it. |
| `robots.txt` blocking named AI crawlers | Website | Covers OpenAI, Anthropic, Google-Extended, Common Crawl, Perplexity, ByteDance, Meta, Apple-Extended, Amazon, Cohere and others. **Only read at a domain root**, so it has no effect on `jschmitt1531.github.io/peakly/` until Peakly has its own domain. |

**Limits:** these rely on crawlers choosing to obey. Reputable companies document that they honour robots.txt; bad actors may not. GitHub's own handling of public repositories is governed by GitHub's terms, not by these files.

**Recommended:** register a domain (for example `peakly.app` or `peakly.org`, about $10–20/year) and point GitHub Pages at it. Then `robots.txt` and `tdmrep.json` take effect.

## 3. Proof that Peakly is yours

Already in place:
- **Signed, timestamped git history.** Every commit shows "Verified" on GitHub and is linked to your account.
- **A copyright line and license header in every file.**
- **CITATION.cff**, so citations name you as author.
- **Provenance ID.** `node build.js` stamps a unique fingerprint into every built `index.html`: a `Provenance: PEAKLY-…` comment and a `peakly-provenance` meta tag, derived from the code itself. A verbatim copy carries the same ID, and searching for it finds copies.

Recommended next steps:
1. **Register the copyright** with the US Copyright Office (eCO, copyright.gov). The fee is about $45–65 for a single author. Registration is needed before you can sue for infringement in the US, and registering early makes statutory damages and attorney's fees available.
   - **AI disclosure:** Peakly's code was written with AI assistance. The Copyright Office requires applicants to disclose AI-generated material and claims only the human-authored parts: selection, arrangement, design, editing and any code you wrote. Get a lawyer's advice on how to describe this.
2. **Archive releases on Zenodo.** Each release gets a dated DOI, which is independent proof of what existed when. See [RELEASING.md](RELEASING.md).
3. **Consider a trademark** for the name "Peakly" (USPTO; filing fees are a few hundred dollars per class). This lets you stop others from using the name for a similar tool. Search for existing "Peakly" marks first.

## 4. Watching for copies

- **GitHub code search:** search for `PEAKLY-` (the provenance prefix) and for distinctive strings such as `Peakly Free-Use License` or `PK.parsers.register`.
- **Web search:** set a Google Alert for "Peakly chromatogram" and for the provenance ID of the current release.
- **Survey and community feedback:** users often notice copies first.

## 5. If you find a copy

1. **Save evidence:** screenshots, URLs, dates, and the copy's file showing the provenance ID or banner.
2. **Ask politely first** if it may be a misunderstanding (for example a student mirror).
3. **GitHub:** file a DMCA takedown notice at https://github.com/contact/dmca. GitHub handles notices about public repositories and forks.
4. **Other websites or app stores:** use their copyright or DMCA forms, or send the host a notice.
5. **AI companies:** most publish a copyright or opt-out contact; send them the license (§2f) and your TDM reservation.
6. **Talk to a lawyer** before any demand letter or lawsuit, particularly given the AI-assistance question above.

## 6. The strongest option, if needed later

Keeping the repository **private** and publishing only the built app gives far less to scrape. A public GitHub repository can always be read and forked within GitHub. This is a trade-off against transparency for reviewers and citations, and you can switch at any time.
