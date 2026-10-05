# Accessibility statement for Peakly

**Date of this statement:** 2026-10-05 · **Applies to:** the Peakly app (hosted at <https://jschmitt1531.github.io/peakly/app/> and the downloadable `peakly.html`, version 1.1.x) and the Peakly website (<https://jschmitt1531.github.io/peakly/>).

> This is not legal advice; have counsel review before relying on it.

This statement follows the structure recommended by the W3C Web Accessibility Initiative ([Developing an Accessibility Statement](https://www.w3.org/WAI/planning/statements/) and its [statement generator](https://www.w3.org/WAI/planning/statements/generator/)). The detailed technical audit, test method and per-issue status live in [ACCESSIBILITY.md](ACCESSIBILITY.md).

## Our commitment

Peakly is meant to be usable by every scientist, student and educator, including people with disabilities. Jennifer Schmitt, Ph.D., the maintainer, treats accessibility barriers as bugs: they are tracked in public, fixed in normal releases, and never hidden behind a paid tier.

## Standard we aim for

- **Target:** [Web Content Accessibility Guidelines (WCAG) 2.1](https://www.w3.org/TR/WCAG21/), **Level AA**. The audit also tracks the newer WCAG 2.2 criteria (for example 2.5.7 Dragging Movements and 2.5.8 Target Size).
- **Context.** WCAG 2.1 AA is the technical standard referenced by the U.S. Department of Justice's 2024 [ADA Title II web rule](https://www.ada.gov/resources/2024-03-08-web-rule/) for state and local governments, is commonly used as the benchmark under ADA Title III, underlies the revised [Section 508](https://www.section508.gov/) standards (which incorporate WCAG 2.0 AA), and is incorporated in the European standard EN 301 549. Peakly is a free, volunteer-run research tool, not a government service or a vendor under a procurement contract; we cite these frameworks because they define what "accessible" means in practice, not to claim legal compliance with them.

## Conformance status

**Peakly is partially conformant with WCAG 2.1 Level AA.** "Partially conformant" means that some parts of the content do not yet fully conform.

What has been done (version 1.1.x): a first audit of the app and website by code review and keyboard and contrast testing in Chromium in light and dark themes. Fixes so far include focus trapping and focus return in dialogs, `Esc` to close, colour-contrast fixes to at least 4.5:1 for text in both themes, keyboard-operable peak-table rows and formula (ⓘ) buttons, labels on icon buttons, a visible skip link, announced status messages, scoped table headers, and an option to tell overlaid traces apart by line style as well as colour. Further fixes in this version: a text summary of the plot and a "Show plot as table" view, keyboard controls and number fields for integration bounds, a setting to turn off single-key shortcuts, 24 × 24 px minimum targets, arrow-key menus, and placeholder contrast. An automated axe-core scan (WCAG 2.0/2.1/2.2 A/AA) of 9 app views in both themes at desktop and phone width reports **0 violations**. **No screen-reader test has been completed yet**, which is why the status remains "partially conformant".

The status above reflects [ACCESSIBILITY.md](ACCESSIBILITY.md) as of this statement's date. That file is the source of truth; when its open items are closed and a screen-reader pass is done, this statement will be updated.

## Known limitations and alternatives

| Area | Limitation | Alternative available now |
|---|---|---|
| **Interactive chart** (Plotly) | Individual points inside the chart's SVG are not navigable by screen readers. | A **text summary** of the plot is attached to it, **Show plot as table** lists every trace's peaks in a data table, and the **peak table**, **CSV/JSON/PDF exports** carry the same data. Arrow keys move the read-out cursor along the curve. |
| **Image digitizer** | Turning a picture into data is inherently visual; placing calibration points and corners on an image needs a pointer (arrow-key nudging is available). | If you have the numbers, skip the image: **import a CSV/TSV/Excel file or paste data** ("My format isn't working" lets you map columns by hand), or type values into a spreadsheet and import it. Calibration values and tolerances are ordinary keyboard-accessible inputs. |
| **Single-key shortcuts** | Shortcuts such as `p`, `g`, `e` act on single key presses (ignored while typing in a field). | They can be **turned off** in Help → Settings, and every shortcut has a button or menu equivalent. |
| **Adjusting integration bounds** | Dragging a bound needs a pointer. | Keyboard: select a peak, then `,` / `.` move its start and `<` / `>` its end; the peak's ⓘ popover has Start/End number fields; Integrate mode (`G`, arrow keys, `Enter`) also works. |
| **Third-party content** | GitHub-rendered documentation pages, the Google Forms survey and the Anthropic API are provided by others; we cannot fix barriers in them. | Tell us, and we will provide the information another way. |

## Compatibility

Peakly is designed to work with current versions of:

- **Browsers:** Chrome, Edge, Firefox and Safari on desktop; Safari on iOS/iPadOS; Chrome on Android.
- **Assistive technology (intended, not yet fully tested):** NVDA with Firefox or Chrome (Windows), VoiceOver with Safari (macOS, iOS), TalkBack with Chrome (Android), browser zoom to 200 % and reflow at 320 CSS px, Windows high-contrast/forced-colors mode, and operating-system "reduce motion".

It is not designed for Internet Explorer or other browsers without modern JavaScript.

## Technical specifications

Peakly relies on HTML, CSS, JavaScript, WAI-ARIA and SVG, working with the browser and any assistive technology installed.

## Feedback and contact

We welcome feedback on Peakly's accessibility. If you meet a barrier:

- **Preferred:** open an [accessibility issue](https://github.com/jschmitt1531/peakly/issues/new?template=accessibility.yml) (it is labelled `accessibility`).
- **By email:** [peaklyfeedback@gmail.com](mailto:peaklyfeedback@gmail.com) (use this if you prefer not to post publicly, or cannot use GitHub).
- If you need content from the website or docs in another format, say which, and we will try to provide it.

**Response target:** we aim to acknowledge accessibility reports within **5 business days** and to propose a fix or a workaround within **30 days**. Peakly is maintained by volunteers, so these are targets, not guarantees.

## Assessment approach

Self-evaluation by the maintainer: code review against the WCAG checklist in [ACCESSIBILITY.md](ACCESSIBILITY.md), keyboard-only walkthroughs, contrast measurement in both themes, and automated checks in the browser. No independent third-party audit has been done.

## Formal complaints

Peakly is not operated by a public-sector body, so there is no statutory enforcement procedure for it. If you are not satisfied with our response, comment on the issue or ask in [Discussions](https://github.com/jschmitt1531/peakly/discussions).

---

This statement was created on 2026-10-05 using the W3C [Accessibility Statement Generator](https://www.w3.org/WAI/planning/statements/generator/) structure as a guide. Related: [Accessibility audit](ACCESSIBILITY.md) · [Privacy policy](PRIVACY.md) · [Terms of use](TERMS.md).
