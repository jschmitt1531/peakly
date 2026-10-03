# Accessibility

Peakly aims to meet **WCAG 2.2 level AA** in its app and website. This page is the checklist we test against and the place where findings and their status are recorded.

> **Status (1.1.0):** checklist defined; audit findings to be added by the integrator/maintainers below. If you rely on assistive technology and something does not work, please [open an issue](https://github.com/OWNER/peakly/issues/new?template=bug_report.yml) (choose "User interface / accessibility").

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
| | | *(to be filled in after the audit)* | | | |

## Known limitations

- The interactive plot (Plotly) is primarily visual. The peak table and exports are the accessible equivalents of the plot's data.
- The image digitizer is inherently visual; its numeric inputs (calibration values, tolerances) are keyboard-accessible, but placing points on an image requires pointing or arrow-key nudging.
