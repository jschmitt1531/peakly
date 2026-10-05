# Accessibility

**Conformance target: WCAG 2.1 level AA** for the app and website (the basis of the ADA Title II rule and Section 508), plus the new WCAG 2.2 AA criteria we can meet (target size 2.5.8, dragging alternatives 2.5.7). This page is the checklist we test against and the place where findings and their status are recorded.

> **Status (1.1.0, October 2026):** app UI audited twice: manual review (code, keyboard-only use, screen-reader-style checks of names/roles/states and live regions in Chromium) and automated axe-core 4.10.2 scans of every `?demo=` mode in light and dark themes at 1280 px and 390 px. All findings 1–24 below are fixed; the automated scan reports **0 violations** (see [Automated results](#automated-results-axe-core)). Known limitations are listed at the end. No pass with a real screen reader (NVDA/JAWS/VoiceOver) yet. If you rely on assistive technology and something does not work, please [open an issue](https://github.com/jschmitt1531/peakly/issues/new?template=bug_report.yml) (choose "User interface / accessibility").

## How to test

- **Keyboard only:** unplug the mouse; complete the quickstart (load sample, detect peaks, integrate a peak, export).
- **Screen readers:** NVDA + Firefox (Windows), VoiceOver + Safari (macOS/iOS), TalkBack + Chrome (Android).
- **Zoom and reflow:** 200 % browser zoom; 320 CSS px width (phone portrait).
- **Contrast:** check text and UI components in light and dark themes (axe DevTools, Lighthouse, or a contrast checker).
- **Colour vision:** simulate protanopia/deuteranopia/tritanopia (Chrome DevTools → Rendering).
- **Reduced motion:** enable "reduce motion" in the OS.

## Method used for this audit

1. **Manual keyboard pass:** every toolbar button, menu, dialog, the peak table, the ⓘ popover, the trace list, Integrate mode and the new bound-editing keys, with the mouse unused; focus order, visible focus, `Esc`, focus return.
2. **Screen-reader-style checks:** accessible names, roles and states read from the accessibility tree (Chromium), `aria-describedby` targets, live-region announcements (`#pk-live`, toasts), table headers and captions.
3. **Automated:** axe-core 4.10.2 with the tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`, run against the built `index.html` (a copy without the CSP `<meta>`, so the test library could load; axe is **never** shipped in the app) for: the empty start page and `?demo=hplc|calibration|compare|integration-math|about|image|fplc|split`, each in the light and dark theme at 1280 px and 390 px wide (36 runs), plus interactive states not covered by a demo (survey invitation, MOCCA2 wavelength picker, peak ⓘ popover with bound inputs, Sample menu open, Plot options open, "Plot as table" dialog, Help with Settings) in both themes.
4. **Contrast:** axe colour-contrast rule plus manual checks of theme tokens (both themes).

## Checklist

### Perceivable
- [ ] All images and icons have text alternatives; decorative ones are hidden from assistive tech.
- [x] The plot has a text equivalent: a text summary (trace names, ranges, number of peaks, largest peak) referenced by the plot, a "Show plot as table" dialog, the peak table and the x,y CSV.
- [ ] Text contrast ≥ 4.5:1 (≥ 3:1 for large text), UI component and focus-indicator contrast ≥ 3:1, both themes.
- [ ] Traces are distinguishable without colour (line styles / markers option, legend labels, direct labels).
- [ ] The "digitized" status is conveyed in text, not colour alone.
- [ ] Content reflows at 320 px width without two-dimensional scrolling (except the plot itself).
- [ ] Text can be resized to 200 % without loss of content.

### Operable
- [ ] Every function is reachable by keyboard; no keyboard traps (including the digitizer modal and menus).
- [ ] Visible focus indicator on every interactive element.
- [x] Single-key shortcuts (`p`, `g`, `d`, …) can be turned off (Help → Settings) and only fire when focus is not in a text field (WCAG 2.1.4).
- [x] Peak bounds and calibration points can be set without dragging (numeric inputs or keys) (WCAG 2.5.7).
- [x] Target size ≥ 24×24 CSS px for compact controls (WCAG 2.5.8).
- [ ] Modals trap focus while open and return focus to the trigger on close; `Esc` closes them.
- [ ] No content flashes more than three times per second; animations respect `prefers-reduced-motion`.

### Understandable
- [ ] Page language is set (`<html lang="en">`).
- [ ] Form fields (method, run info, calibration levels) have programmatic labels and units.
- [ ] Error messages (unrecognized file, invalid calibration) say what went wrong and how to fix it.
- [ ] Consistent naming and placement of controls across panels.

### Robust
- [ ] Valid, semantic HTML: landmarks (`header`, `main`, `nav`), headings in order, buttons are `<button>`.
- [ ] Custom widgets expose correct roles, names, states (`aria-pressed`, `aria-expanded`, `aria-selected`).
- [ ] Toasts use `role="status"` (and `role="alert"` for errors) so they are announced.
- [ ] Tables use `<th>` with `scope`; sortable columns announce sort state.

### Website (docs/index.html)
- [ ] Skip link, landmarks, heading order.
- [ ] Contrast in light and dark.
- [ ] Works at 320 px with no horizontal scroll.

## Findings

| # | Area | Issue | WCAG | Severity | Status |
|---|---|---|---|---|---|
| 1 | Dialogs | Modals had `role="dialog"`/`aria-modal` but Tab could leave them. Added a focus trap to every modal (except the digitizer, which manages its own focus) and to the ⓘ audit popover; `Esc` closes the top dialog/popover/menu and focus returns to the trigger. | 2.1.2, 2.4.3 | Major | Fixed |
| 2 | Contrast (light) | `--warn` #b45309 (4.44:1), `--ok` #15803d (4.43:1) on `--panel-2`, and accent text on the selected-tab/pressed background (4.48:1) were just under 4.5:1. Changed to `--warn`/`--digitized` #a34a07 (≥ 5.2:1), `--ok` #137333 (5.3:1), `--accent` #1d4ed8 (5.7:1 on the pressed background, 6.7:1 white-on-accent). All theme text tokens now ≥ 4.5:1 on `--bg`, `--panel` and `--panel-2` in both themes. | 1.4.3 | Moderate | Fixed |
| 3 | Peak table | Rows were mouse-only and the ⓘ formula buttons had `tabindex="-1"` and were invisible until hover. Rows are now focusable (`tabindex="0"`, `aria-selected`), `Enter`/`Space` selects and zooms; ⓘ buttons are in the tab order, faintly visible and fully visible on row focus. | 2.1.1, 2.4.7 | Major | Fixed |
| 4 | Tables | Compare-view sub-headers, gradient table and metadata table lacked `scope`. All `<th>` now carry `scope="col"`/`"row"`; new tables (calibration, integration steps, third-party notices) use scoped headers. | 1.3.1 | Minor | Fixed |
| 5 | Icon buttons | Several toolbar buttons with emoji icons relied on the label text that is hidden below 1180 px. Every toolbar icon button now has an `aria-label`; plot-option inputs gained labels. | 4.1.2, 2.5.3 | Moderate | Fixed |
| 6 | Toasts | `#pk-toasts` is an `aria-live="polite"` region; each toast has `role="status"` (`role="alert"` for errors). Verified unchanged. | 4.1.3 | — | OK |
| 7 | Skip link | The "Skip to plot" link was `sr-only` and stayed invisible when focused. It now becomes visible on focus. | 2.4.1, 2.4.7 | Minor | Fixed |
| 8 | Colour-only trace identity | The default overlay palette (Tableau-10 style) is distinguishable for common colour-vision deficiencies for the first ~6 traces, but overlays still relied on colour. Added **Plot options → "Distinguish traces by line style"** (solid, dash, dot, dash-dot, long-dash, …) which also carries into PNG/SVG/PDF exports. | 1.4.1 | Moderate | Fixed (opt-in) |
| 9 | Split dialog | Clip-mode previews are a native radio group with visible labels, per-peak areas in text and a text recommendation, so the SVG previews are not the only carrier of information (`role="img"` + `aria-label` on each preview). | 1.1.1, 1.3.1 | — | OK |
| 10 | Calibration plot | Points can be excluded by clicking the plot **or** with the per-level "Use" checkbox (keyboard). All fit numbers are in a table with ⓘ formula buttons; the plot container has a text label. | 2.1.1, 2.5.7 | — | OK |
| 11 | Single-key shortcuts | `o v i m c k n e s d p a g t ? , . < >` fire only when focus is not in a text field (input, textarea, select, contenteditable) and no dialog is open. New **Help → Settings → "Single-key shortcuts"** (on by default) turns all single-character shortcuts off; the choice is saved in this browser (`localStorage` key `peakly-prefs`, wrapped in try/catch: without storage it lasts for the tab). Ctrl/⌘ shortcuts, arrows and Delete are not character keys and stay on. Verified: with the setting off, `,` no longer moves a bound. | 2.1.4 | Moderate | Fixed |
| 12 | Plot | Plotly's SVG is not navigable by screen readers. Added a visually hidden text summary (`#plot-summary`, e.g. "Sample 254 nm: 8 peaks, largest at 10.24 min (39.5 % area); 0 to 20 min, signal in mAU.") referenced by `aria-describedby` on the plot and updated on every render; it is deliberately not a live region, so tweaking a slider does not interrupt speech (peak counts are announced by the status toasts). New **Show plot as table** button opens a dialog with the summary, one captioned table per visible trace (#, name, RT, start, end, height, area, area %; `<th scope>`), the secondary-axis channels, and buttons for the x,y CSV and peak CSV. | 1.1.1, 1.3.1 | Moderate | Fixed |
| 13 | Integration bounds | The peak ⓘ details popover now has numeric **Start / End** inputs (Enter applies; undoable). With a peak selected, `,` / `.` move its start bound one data point left/right and `<` / `>` (Shift+`,` / Shift+`.`) move its end bound; rapid presses form one undo step and the new window is announced via a polite live region (`#pk-live`). The keys avoid the plot-focused `[` `]` trace switching and are listed in Help. | 2.1.1, 2.5.7 | Moderate | Fixed |
| 14 | Target size | Trace reorder arrows are 24×24 px (`.btn.icon.tiny`), the visibility toggles 24×24 px, and the ⓘ cell buttons have a 24×24 px hit box (negative margins, so table rows did not grow). Other small buttons were already ≥ 26 px high and ≥ 24 px wide. Inline text links are exempt. | 2.5.8 | Minor | Fixed |
| 15 | Placeholders | `::placeholder` uses `--muted` with `opacity: 1`: 5.9:1 on white (light), ≥ 6.7:1 on the dark panels. Placeholders still carry no information on their own. | 1.4.3 | Minor | Fixed |
| 16 | Menus | **Sample ▾** and the mobile **⋯** menu follow the WAI-ARIA menu-button pattern: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, `role="menu"` / `"menuitem"` with roving `tabindex`; `↓`/`↑` on the button open the menu on the first/last item; `↓ ↑ Home End` (and PageUp/PageDown) move, a letter jumps to the next item starting with it, `Esc` closes and returns focus, `Tab` closes and moves on, focus leaving closes it. **Plot options** contains form fields, so it is a non-modal popover dialog (`aria-haspopup="dialog"`, `role="dialog"`): opening focuses its first field, Tab moves through it, Esc closes and returns focus, focus leaving closes it. | 2.1.1, 4.1.2 | Minor | Fixed |
| 17 | Landmarks (axe) | Dialog headers were `<header>` elements, and the digitizer had its own `<header>`/`<footer>`, so the page exposed several `banner`/`contentinfo` landmarks. Dialog and digitizer header/footer bars are now plain `<div>`s. | 1.3.1 | Moderate | Fixed |
| 18 | Toolbar role (axe) | `<nav role="toolbar">` is not an allowed role on `nav`; the toolbar is a `<div role="toolbar">` (the header is the banner landmark). | 4.1.2 | Minor | Fixed |
| 19 | Headings (axe) | No `<h1>` once data was loaded (the empty-state title was the only one); the digitizer jumped from `h2` to `h4`. Added a visually hidden `<h1>` in `main`, the empty-state title is an `h2`, digitizer section titles are `h3`. | 1.3.1, 2.4.6 | Moderate | Fixed |
| 20 | Scrollable region (axe) | The integration-math dialog body scrolls but had no focusable content, so keyboard users could not scroll it. It is now a focusable, labelled region (`tabindex="0"`, `role="region"`). | 2.1.1 | Serious | Fixed |
| 21 | Contrast, dark theme (axe) | Digitizer active step and pressed buttons used white text on `--accent` (#60a5fa in dark: 2.5:1). They now use `--accent-contrast` (≥ 7:1 in both themes). | 1.4.3 | Serious | Fixed |
| 22 | New: survey invitation | The optional feedback invitation is a non-modal `role="dialog"` (`aria-modal="false"`, labelled and described) that does **not** take focus: it is announced through the polite live region, sits in the tab order, closes with `Esc` (focus returns to where the user came from), never appears while a modal dialog is open or in demo mode, and can be turned off (Help → Settings). Its links say "(opens in a new tab)" to screen readers. | 2.2.4, 3.2.1, 4.1.3 | — | OK (by design) |
| 23 | New: wavelength picker | MOCCA2 traces get a labelled `<select>` ("Wavelength for …"). When the source is no longer in memory it is disabled with a visible tooltip and an `aria-describedby` text "Re-open the file to change wavelength". | 4.1.2, 3.3.2 | — | OK (by design) |
| 24 | Contact and links | About/Help/survey contact uses a `mailto:` link from `PK.config.contactEmail`; external links carry `rel="noopener noreferrer"` and an "(opens in a new tab)" hint. | 2.4.4, 3.2.5 | — | OK |

## Automated results (axe-core)

| Run | Before (build of commit `5fc2900`) | After (this release) |
|---|---|---|
| 9 views × 2 themes × 2 widths (36 runs) | **9 rule failures.** Serious: `target-size` (48 nodes in 12 runs: trace reorder arrows, ⓘ cell buttons, visibility toggles; see #14), `scrollable-region-focusable` (integration math, 4 runs; #20), `color-contrast` (digitizer step bar, dark theme, 2 runs; #21). Moderate: `landmark-no-duplicate-banner` (20 runs), `landmark-unique` (20), `landmark-no-duplicate-contentinfo` (2) (#17), `page-has-heading-one` (12), `heading-order` (4) (#19). Minor: `aria-allowed-role` (all 36 runs; #18). | **0 violations** |
| Interactive states (survey card, wavelength picker, ⓘ popover with bound inputs, Sample menu, Plot options, Plot as table, Help/Settings), light + dark | not applicable (features new) | **0 violations** |

axe cannot judge everything (e.g. whether a text alternative is *equivalent*, sensible focus order, or speech output), so the manual checks above remain the main evidence. Automated tools typically catch 30–50 % of issues.

## Known limitations

- The interactive plot (Plotly) is primarily visual. Its text alternatives are the plot summary, "Show plot as table", the peak table and the x,y CSV; individual data points are not navigable by screen readers inside the SVG (the plot-focused arrow-key cursor writes values to a non-live status line).
- The image digitizer is inherently visual; its numeric inputs (calibration values, tolerances) are keyboard-accessible, but placing points on an image requires pointing or arrow-key nudging. Its step bar (`1 Prep … 5 Send`) is operated with the Back/Next buttons by keyboard.
- Calibration levels can be excluded with the per-level "Use" checkbox instead of clicking the plot; calibration plots themselves are visual (all numbers are in the adjacent tables).
- Shift-drag integration and dragging bound lines are pointer gestures; the keyboard equivalents are Integrate mode (`G`, arrows, `Enter`), the bound keys `, . < >` and the Start/End inputs.
- No formal test with NVDA, JAWS, VoiceOver or TalkBack has been done yet. Toasts disappear after 3.5 s (7 s for errors); everything they report is also visible in the UI or the Undo history.
- Plotly's own mode bar (zoom, pan, download) is third-party markup; its buttons have names but are small (Plotly default size).
