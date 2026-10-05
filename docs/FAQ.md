# Frequently asked questions

## General

**What is Peakly?**
A free-to-use chromatogram analyzer for HPLC and FPLC data that runs entirely in a web browser, from a single HTML file. See the [README](../README.md).

**Is it really free? What's the catch?**
Yes, free to use (including at work), with no paywalled features, ever. It is not open source: the code is public so it can be reviewed and cited, but copying, modifying or redistributing it needs permission ([LICENSE](../LICENSE)) ([GOVERNANCE.md](../GOVERNANCE.md#core-principles-not-up-for-a-vote)). There is no catch and no data collection. If it helps you, please [cite it](../README.md#how-to-cite) and tell us how you use it.

**Do I need to install anything?**
No. Open the hosted app or download `peakly.html` and double-click it. Any current Chrome, Edge, Firefox or Safari works, including on phones and tablets.

**Does it work offline?**
The file works offline once the browser has cached the libraries from the first online load. For fully air-gapped machines, serve the pinned library files from an internal server (see [SECURITY.md](../SECURITY.md#cdn-integrity-sri-policy)).

**Who makes it?**
Peakly is created and maintained by [Jennifer Schmitt, Ph.D.](https://www.linkedin.com/in/jschmitt1531/), with contributions from the community. It is independent and not affiliated with any instrument vendor or with OpenChrom/ChemClipse.

## Privacy and security

**Is my data uploaded anywhere?**
No. Files are read by your browser into memory. There is no Peakly server.

**What network requests does Peakly make?**
Only two kinds: loading pinned libraries (Plotly, SheetJS, pako, lz-string, jsPDF, PDF.js) from public CDNs when the page opens, and the **optional** Claude vision assist in the digitizer, which sends one image to Anthropic only when you paste your own API key and click the button.

**Where is my API key stored?**
Only in memory for the current tab. It is never saved to disk, local storage, project files or links. Use a dedicated low-limit key. Details in [SECURITY.md](../SECURITY.md#api-key-handling-optional-claude-assist).

**Are share links private?**
The data lives in the URL `#fragment`, which browsers do not send to web servers. But anyone who has the link can open the data, and links can end up in chat logs or browser history. Treat a link like the file itself.

**Does the website count visitors?**
The app never does. The project website has a slot for cookie-free, aggregate page-view counting (GoatCounter or Plausible) that is **off by default**; if maintainers ever enable it, this answer will say so.

## Data and formats

**Which file formats are supported?**
See [Supported formats](../README.md#supported-formats). If yours is not listed, try exporting to text from the instrument software ([tutorial](tutorials/vendor-export.md)), or use **"My format isn't working"** to map the columns by hand.

**Can you add my instrument's format?**
Probably, with a sample file. Use the [format request form](https://github.com/jschmitt1531/peakly/issues/new?template=format_request.yml); only share files you are allowed to share.

**Why can't Peakly read Thermo `.raw`, Shimadzu `.lcd` or Waters raw folders?**
These are proprietary binary formats without public specifications that can be implemented in a browser without vendor libraries. Export to text, AnDI/netCDF (`.cdf`) or mzML instead ([tutorial](tutorials/binary-files.md)).

**My FPLC data is in mL, not minutes. Is that a problem?**
No. UNICORN and other FPLC exports keep a volume axis (`mL`); all calculations work on volume, and conversion to minutes is available when the flow rate is known ([tutorial](tutorials/fplc-unicorn.md)).

**How big a file can it handle?**
Hundreds of thousands of points per trace are fine on a laptop. Millions of points work but are slow on phones.

## Calculations

**How are areas calculated?**
Trapezoid integration of the signal above the applied baseline between the peak bounds. The baseline depends on the clipping mode (drop, valley, baseline, skims, fit). Click ⓘ next to any value to see every step. Details: [INTEGRATION.md](INTEGRATION.md) and [CALCULATIONS.md](CALCULATIONS.md).

**Why do my areas differ from my CDS by a factor of 60?**
Peakly reports area in y-unit × **minutes** (e.g. mAU·min). ChemStation and many CDSs report mAU·**s**. Multiply by 60.

**Why do my areas differ slightly from my CDS otherwise?**
Integration bounds, baseline construction, smoothing and peak-splitting rules differ between programs. Compare with the same bounds and clipping mode; use the integration audit to see exactly what Peakly did. If you can share the data, it makes a great [validation case](VALIDATION.md).

**Which tailing/plate/resolution formulas are used?**
USP <621> / Ph. Eur. 2.2.46 definitions, listed in [CALCULATIONS.md](CALCULATIONS.md).

**Can I use Peakly for GMP/GLP release testing?**
No. *For research and education use. Not validated for regulated (GMP/GLP) workflows. Digitized data is approximate.* There is no audit trail, access control or electronic signature.

## Digitizing images

**How accurate is digitized data?**
On a clean 900 px wide plot, retention times are within about half a pixel and area-% values within about 0.2 percentage points of the true values in our benchmark; accuracy drops at low resolution and when legends or labels hide peaks. See [DIGITIZER_ACCURACY.md](DIGITIZER_ACCURACY.md). Use digitized data for RT, peak order and area %, not absolute quantitation.

**Can I digitize a photo of a screen or a printout?**
Yes: use 4-corner perspective correction first ([tutorial](tutorials/photo-of-screen.md)). Expect larger errors than with a screenshot.

**Automatic peak detection finds lots of tiny peaks on my digitized trace.**
A digitized curve is a pixel staircase. Turn on smoothing or raise the detection threshold to a few pixels' worth of y before detecting, or integrate peaks by hand.

## Contributing

**How can I help without coding?**
Share sample files and validation data, improve tutorials, report bugs, and tell us how you use Peakly. See [CONTRIBUTING.md](../CONTRIBUTING.md) and [FUNDING.md](../FUNDING.md).

**How do I cite Peakly?**
See [How to cite](../README.md#how-to-cite) or use GitHub's "Cite this repository" button.

## Feedback survey

**Is there a feedback survey? Does the app send anything?**
Yes, there is an optional, anonymous survey (about 4–5 minutes) on Google Forms. It opens only when you click a survey link in the app or on the website. The app itself never sends any data. The survey does not collect your email address or Google account, and you do not need to sign in. Every question except the consent question is optional. Design and scoring: [SURVEY.md](SURVEY.md). Privacy: [PRIVACY.md](PRIVACY.md#4-the-optional-feedback-survey-google-forms).

**Can I be told about future surveys?**
Yes, through a separate sign-up form that asks for your email address and your consent. It is kept apart from the survey, so your survey answers stay anonymous. You get at most one invitation every 3 months, from peaklyfeedback@gmail.com. To unsubscribe, use the link in any invitation or reply "unsubscribe".
