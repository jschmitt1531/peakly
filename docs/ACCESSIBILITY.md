# Accessibility

Peakly aims to meet **WCAG 2.2 level AA** in its app and website. This page is the checklist we test against and the place where findings and their status are recorded.

> **Status (1.1.0):** first app-UI audit done (code review + keyboard/contrast checks in Chromium, light and dark themes); findings below. No screen-reader pass yet. If you rely on assistive technology and something does not work, please [open an issue](https://github.com/OWNER/peakly/issues/new?template=bug_report.yml) (choose "User interface / accessibility").

## How to test

- **Keyboard only:** unplug the mouse; complete the quickstart (load sample, detect peaks, integrate a peak, export).
- **Screen readers:** NVDA + Firefox (Windows), VoiceOver + Safari (macOS/iOS), TalkBack + Chrome (Android).
- **Zoom and reflow:** 200 % browser zoom; 320 CSS px width (phone portrait).
- **Contrast:** check text and UI components in light and dark themes (axe DevTools, Lighthouse, or a contrast checker).
- **Colour vision:** simulate protanopia/deuteranopia/tritanopia (Chrome DevTools → Rendering).
- **Reduced motion:** enable "reduce motion" in the OS.

## Checklist

### Perceivable
- [ ] All images and icons have text alternatives; decorative ones are hidden from assistive tech.
- [ ] The plot has a text equivalent: the peak table, plus a summary (trace names, ranges, number of peaks).
- [ ] Text contrast ≥ 4.5:1 (≥ 3:1 for large text), UI component and focus-indicator contrast ≥ 3:1, both themes.
- [ ] Traces are distinguishable without colour (line styles / markers option, legend labels, direct labels).
- [ ] The "digitized" status is conveyed in text, not colour alone.
- [ ] Content reflows at 320 px width without two-dimensional scrolling (except the plot itself).
- [ ] Text can be resized to 200 % without loss of content.

### Operable
- [ ] Every function is reachable by keyboard; no keyboard traps (including the digitizer modal and menus).
- [ ] Visible focus indicator on every interactive element.
- [ ] Single-key shortcuts (`p`, `g`, `d`, …) can be turned off or only fire when the plot has focus (WCAG 2.1.4).
- [ ] Peak bounds and calibration points can be set without dragging (numeric inputs or arrow keys) (WCAG 2.5.7).
- [ ] Target size ≥ 24×24 CSS px for controls (WCAG 2.5.8).
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
| 11 | Single-key shortcuts | `o v i m c k n e s d p a g t ?` fire only when focus is not in a text field and no dialog is open, but cannot be turned off or remapped. | 2.1.4 | Moderate | Open |
| 12 | Plot | Plotly's SVG is not navigable by screen readers. The plot container is `role="application"` with instructions; arrow keys move the curve-tracing cursor and the readout is written to a status line (`aria-live="off"` to avoid chatter). The peak table and exports are the accessible equivalent. A text summary of the plot is still missing. | 1.1.1 | Moderate | Open |
| 13 | Integration bounds | Dragging the dotted bound lines is pointer-only; keyboard users can set bounds via Integrate mode (`G`, arrows, `Enter` twice) but cannot nudge existing bounds numerically. | 2.5.7 | Moderate | Open |
| 14 | Target size | Some compact controls (`.btn.sm.icon` reorder arrows in the trace list, 22 px high; ⓘ cell buttons) are below 24×24 px. | 2.5.8 | Minor | Open |
| 15 | Placeholders | Input placeholders use the browser default colour, which can be below 4.5:1; no information is carried by placeholders alone. | 1.4.3 | Minor | Open |
| 16 | Plot-options / sample menus | Menus use `aria-haspopup`/`aria-expanded`, close on `Esc` (focus returns to the button) and on outside click; arrow-key navigation between items is not implemented (Tab works). | 2.1.1 | Minor | Open |

## Known limitations

- The interactive plot (Plotly) is primarily visual. The peak table and exports are the accessible equivalents of the plot's data.
- The image digitizer is inherently visual; its numeric inputs (calibration values, tolerances) are keyboard-accessible, but placing points on an image requires pointing or arrow-key nudging.
