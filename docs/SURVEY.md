# Peakly feedback survey: design and analysis plan

Peakly asks for feedback through an **optional, anonymous Google Form**. This page explains what the survey asks and why, how the answers are scored, how many responses are needed before the numbers mean much, and how often people are asked.

- **Setup:** [`tools/survey/README.md`](../tools/survey/README.md), a step-by-step guide that needs no programming. [`tools/survey/create-survey.gs`](../tools/survey/create-survey.gs) is the one script that builds everything.
- **Privacy:** [PRIVACY.md §4](PRIVACY.md#4-the-optional-feedback-survey-google-forms).
- **Owner and contact:** the dedicated project account **peaklyfeedback@gmail.com** (maintainer: Jennifer Schmitt, Ph.D.).

## Principles

| Principle | How the survey applies it |
|---|---|
| **The app never sends data** | Peakly only opens the form link in a new tab when someone clicks it (`src/config.js` → `survey.url`). Nothing is submitted from the app. |
| **Anonymous by default** | The form does not collect email addresses, does not need sign-in, and does not record Google accounts. Email sign-up for future surveys is a **separate form stored in a separate spreadsheet**, so answers are never kept next to an email address. |
| **Optional** | Only the consent question is required. Every other question can be skipped. |
| **Short** | About 4–5 minutes, or about 3 minutes if the written questions are skipped. Web-survey research puts the respondent-preferred length at about 10 minutes and finds that data quality drops as surveys get longer ([Revilla & Ochoa 2017](https://doi.org/10.2501/IJMR-2017-039)). Peakly stays well under that. |
| **Consent and privacy up front** | The first page states what is collected, where it is stored (Google Forms/Sheets), how it is used, the minimum age (16), and links to the privacy policy. |
| **Neutral, one-topic questions** | No leading wording, no double-barreled questions, balanced scales, and response options that do not overlap and cover every case, with "Other" where a list cannot be complete ([Pew Research Center](https://www.pewresearch.org/writing-survey-questions/); Dillman, Smyth & Christian 2014). |
| **Demographics last** | Role, field and instruments come at the end so they do not put people off or bias earlier answers ([Pew](https://www.pewresearch.org/writing-survey-questions/)). |
| **Validated instruments, unmodified** | The System Usability Scale is used in its standard wording, with "Peakly" in place of "system". |
| **Free** | Google Forms, Sheets and Apps Script on a free account. No paid survey tool, and no backend. |

## Instruments considered

| Instrument | What it measures | Used? | Notes |
|---|---|---|---|
| **System Usability Scale (SUS)** | Perceived usability, 10 items, scored 0–100 | **Yes** | Brooke (1996); widely benchmarked (mean about 68 across hundreds of studies: [MeasuringU](https://measuringu.com/sus/); Sauro & Lewis 2016). Brooke's [retrospective (2013)](http://uxpajournal.org/wp-content/uploads/pdf/JUS_Brooke_February_2013.pdf) describes it as free to use as long as the source is acknowledged. Putting the product name in place of "system" is common and does not change the scores ([Bangor, Kortum & Miller 2008](https://doi.org/10.1080/10447310802205776)). |
| **UMUX-LITE** | Usability plus usefulness in 2 items | Not in the main survey | [Lewis, Utesch & Maher 2013](https://doi.org/10.1145/2470654.2481287). Kept in reserve for a very short in-app pulse survey. It correlates with SUS (r ≈ 0.8). Approximate SUS = 0.65 × ((item1 + item2 − 2) × 100/12) + 22.9, using 7-point items ([MeasuringU](https://measuringu.com/umux-lite/)). |
| **Likelihood to recommend (LTR), 0–10** | Loyalty and word of mouth | **Yes** | The single 0–10 question popularized by [Reichheld (2003)](https://hbr.org/2003/12/the-one-number-you-need-to-grow). *Net Promoter®, NPS® and Net Promoter Score® are registered trademarks of Bain & Company, Inc., Satmetrix Systems, Inc. (now part of NICE) and Fred Reichheld.* Peakly does not use those names; it reports a "likelihood-to-recommend net score". |
| **CSAT** (satisfaction, 1–5) | Satisfaction with one interaction | No | Overlaps with SUS and LTR. The task-success question measures the outcome more directly. |
| **CES** (customer effort) | Effort needed to get something done | No | [Dixon, Freeman & Toman 2010](https://hbr.org/2010/07/stop-trying-to-delight-your-customers). For a self-serve tool, SUS items 2, 3 and 8 already cover effort. |
| **Task success** | Whether the person got done what they came to do | **Yes** | The most direct sign of whether Peakly is useful. It is followed by an open "what got in the way?" question. |

Commercial template libraries for software and product feedback (SurveyMonkey, Qualtrics, Typeform) follow the same pattern: what you used, did it work, ease of use, likelihood to recommend, what's missing, then an open comment. They were used as a sanity check on coverage, not copied.

## The questionnaire

There are 7 pages and 29 questions: 1 is required (consent), 28 are optional, and 4 are written answers. The **exact wording lives in `SURVEY_PAGES`** in `create-survey.gs`; that file is the single source of truth.

| # | Page / question | Type | Why it is asked |
|---|---|---|---|
| **1** | **Consent and privacy notice** (form description) + "Do you agree to take part?" | single choice, **required** | Informed, voluntary participation. States anonymity, storage, use, age 16+, and contact (peaklyfeedback@gmail.com). |
| **2** | **How you used Peakly** | | |
| 2.1 | What did you use Peakly for? File import, image/photo digitizing, detect/integrate peaks, clipping/splitting, calibration, compare/overlay, gradient/method, export/report, share link, only exploring, Other | checkboxes | Shows which features actually get used, so effort and documentation go where people are. Answers are factual, which avoids opinion bias. |
| 2.2 | Which kinds of files did you open? Generic CSV, Excel, Agilent, Thermo, Shimadzu, Waters, Cytiva UNICORN, Bio-Rad, open standards, image/PDF, project/link, None, Other | checkboxes | Sets parser priorities. |
| 2.3 | Did Peakly do what you needed it to do? Yes completely / Partly / No / Only exploring | single choice | **Task success.** "Only exploring" keeps browsers out of the success rate. |
| 2.4 | If partly or no: what got in the way? | paragraph | The most actionable question in the survey. |
| **3** | **Ease of use**: SUS, 10 statements, 1 = Strongly disagree … 5 = Strongly agree | grid | Standard benchmark. Results can be compared with published norms and tracked from release to release. Positive and negative statements alternate on purpose, which the page text explains. |
| **4** | **Trust in the results** | | |
| 4.1 | Did you compare Peakly's numbers with another program? Agreed closely / small explainable differences / unexplained differences / did not compare | single choice | Checks the accuracy claims against real use. "Unexplained differences" points to possible bugs and validation cases. |
| 4.2 | How much do you trust Peakly's results for your purpose? 1 Not at all … 5 Completely | linear scale | Measures trust separately from usability. A tool can be easy to use and still not be trusted. |
| **5** | **What should come next** | | |
| 5.1 | Which additions would be most valuable? (choose **up to 3**) More file formats, DAD/PDA 3D, batch processing, method-validation tools, LIMS/ELN export, peak purity, MS beyond TIC, report templates, better digitizing, offline app, tutorials, translations, Other | checkboxes, at most 3 | Limiting the picks to 3 forces a priority. If people can tick everything, everything looks wanted. The Dashboard ranks the results live. |
| 5.2 | Did a file fail to open? Which instrument, software and file type? (links to the GitHub format request) | short text | Finds missing formats. The survey **does not ask for contact details**: people who can share a sample are pointed to the public format-request form, which keeps the survey anonymous. |
| **6** | **Overall** | | |
| 6.1 | How likely are you to recommend Peakly to a colleague? 0 Not at all likely … 10 Extremely likely | 0–10 scale | LTR, benchmarkable. |
| 6.2 | What is the main reason for your answer? | paragraph | Explains the LTR number. |
| 6.3 | Would you cite Peakly if it contributed to a publication, thesis or report? Yes / Maybe / No / N/A | single choice | Academic uptake. Useful for grant reports and citation planning. |
| 6.4 | Would you use Peakly in teaching or training? Already do / Plan to / Maybe / No / N/A | single choice | Educational use. |
| 6.5 | What one change would most improve Peakly for you? | paragraph | Asking for one change gets a single, focused answer instead of a list. |
| **7** | **About you (optional)** | | |
| 7.1 | Role: student, academic researcher, industry R&D, industry QC/QA, core facility, teacher, government/regulatory, Other | single choice | Lets results be split by audience. |
| 7.2 | Main field: pharma/biopharma, biochemistry/protein purification, chemistry, environmental, food/agriculture, clinical/forensic, materials/polymers, Other | single choice | |
| 7.3 | Instrument makers used: Agilent, Waters, Thermo Fisher, Shimadzu, Cytiva, Bio-Rad, none/not sure, Other | checkboxes | Parser priorities, compared against 2.2. |
| 7.4 | How often do you analyze chromatograms? Daily / Weekly / Monthly / Less than monthly | single choice | Separates heavy users from occasional users. |
| 7.5 | May we quote your written comments anonymously? Yes, anonymously / No | single choice | Quotes are used only with permission. The Comments tab shows this answer next to every comment. |
| — | "Want to hear about future surveys?" (link to the separate sign-up form) | text only | Email opt-in that stays outside the anonymous survey. |

**Estimated time.** About 23 closed questions at about 5 s each, plus about 60 s for the SUS grid, comes to roughly 2.5 min. The 4 written answers add about 30 s each if answered. **Total: about 4–5 min, or about 3 min without written answers.**

**Wording checks.** No question states an opinion for the respondent to agree with ("How much do you trust…", not "How accurate was…"). Scales are balanced, with labelled ends. "Not applicable" or "only exploring" options keep people from picking a forced answer. The only agree/disagree items are the validated SUS items. Every checkbox list has "Other".

**Mobile.** Google Forms shows the SUS grid as a scrollable matrix on phones. Each statement row needs one tap.

### The separate sign-up and unsubscribe forms

- **"Peakly - get future surveys"** asks for an email address (validated), a **required consent checkbox** with explicit text ("store this address in Google Sheets and email me invitations … at most one every 3 months … unsubscribe at any time"), an optional "also tell me about major releases" checkbox, and an optional role. Its responses go to a **separate private spreadsheet**.
- **"Peakly - unsubscribe"** asks for an email address only. People can also reply "unsubscribe" to **peaklyfeedback@gmail.com**.

## Scoring (all automatic in the Google Sheet)

The results spreadsheet calculates everything with live formulas. Columns are found **by header text** (`MATCH`), so they do not depend on column order.

**SUS score per response** (the `Scores` tab). A response gets a score only if all 10 SUS items are answered:

```
SUS = 2.5 × [ Σ(odd items: response − 1) + Σ(even items: 5 − response) ]      range 0–100
```

The Dashboard shows the mean, median, SD, a **95% confidence interval** (mean ± t₀.₀₂₅,ₙ₋₁ × SD/√n), the share of scores ≥ 68 (the published average), and the mean of each item. The item means show which statements pull the score down; for even items, lower is better.

How to read a SUS score: about 68 is average. On the Sauro–Lewis curved grading scale, about 80 or higher is in the top 10–15% ("A" range), and below about 51 is in the bottom 15% ([MeasuringU](https://measuringu.com/sus/); Sauro & Lewis 2016). SUS scores are **not percentages**.

**Likelihood to recommend.** 9–10 = promoter, 7–8 = passive, 0–6 = detractor. The Dashboard shows the share in each group, the mean, and

```
LTR net score = (% 9–10) − (% 0–6)                                             range −100 … +100
```

**Task success.**

```
success rate         = "Yes, completely" / (Yes + Partly + No)
partial-or-better    = (Yes + Partly) / (Yes + Partly + No)
```

"I was only exploring" is left out of the denominator. With small samples, report the **adjusted-Wald interval**: add 2 successes and 2 failures before computing p̂ ± 1.96·√(p̂(1−p̂)/(n+4)) (Sauro & Lewis 2016).

**Checkbox questions.** Counts and **% of all respondents**. Each person can tick several boxes, so the percentages add up to more than 100%. The "most wanted additions" table is ranked live with `SORT`.

**Single-choice and scale questions.** Counts and **% of the people who answered**. Skipped answers are not counted.

**Written answers.** The `Comments` tab lists every non-empty answer, newest first, with its timestamp and the respondent's quote permission.

## Sample size: when the numbers start to mean something

| Metric | Precision you get | Responses needed |
|---|---|---|
| SUS mean | ±10 points (95% CI), assuming SD ≈ 17–18 | about **12–15** |
| SUS mean | ±5 points | about **50** |
| A percentage (task success, feature use) | ±15 percentage points (worst case p = 0.5) | about **40** |
| A percentage | ±10 percentage points | about **100** |
| LTR net score | ±10 points | about **200–250** (the net score is noisier than a single percentage) |

Practical guidance:

- **Fewer than about 30 responses:** read the comments and look at the direction of the numbers. Do not publish percentages without n and a confidence interval.
- **About 50 responses:** SUS and the task-success rate are reportable with CIs.
- **About 100 or more:** subgroup comparisons (for example academic vs industry) start to be reasonable. Report n for each subgroup.
- Always say that respondents are **self-selected**. They are people who chose to answer, not a random sample of Peakly users.

## Schedule and cadence

| What | When |
|---|---|
| Survey link | **Always open.** Linked from the README, website and Help menu. The in-app prompt is optional and limited (`src/config.js`: at most 2 prompts per browser, ever, never more than once a day, and only after a complex feature such as calibration, fitting, digitizing, comparing or splitting). |
| Invitations to the opt-in list | **At most once every 90 days per person.** `installInvitationTrigger()` runs `sendSurveyInvitations` on the 1st of each month. A person who was invited in the last 90 days is skipped, so the effective cadence is quarterly. New sign-ups get their first invitation at the next monthly run. |
| Dashboard review | Monthly, or after each release. Note the release dates so changes in scores can be compared before and after. |
| Results snapshot | At each minor release, or once a year: copy the Dashboard values into a dated tab or a CSV kept outside the public repository, and summarize **aggregate** results in release notes or grant reports. |
| Data hygiene | At least once a year: review the answers, delete anything identifying that someone typed into a text box, and run `purgeExpiredEmails()` (emails are kept at most 24 months after the last invitation; see PRIVACY.md). |
| Question changes | Change questions rarely, and only between releases. Changing wording breaks comparisons over time. Never re-word the SUS items. |

## Possible future additions (not implemented)

- **App version.** The app could open the survey with the Peakly version already filled in, using a Google Forms prefilled link. The version is not personal data, but this would be a change to the app and the privacy text.
- **UMUX-LITE pulse.** A 2-question version for the in-app prompt, with the full survey kept for the opt-in list.
- **Double opt-in.** A confirmation email before an address joins the list. Currently, every invitation says "if you did not sign up, use the unsubscribe link".

## References

- Bangor, A., Kortum, P. T., & Miller, J. T. (2008). An empirical evaluation of the System Usability Scale. *International Journal of Human–Computer Interaction*, 24(6), 574–594. <https://doi.org/10.1080/10447310802205776>
- Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In P. W. Jordan et al. (Eds.), *Usability Evaluation in Industry* (pp. 189–194). Taylor & Francis.
- Brooke, J. (2013). SUS: A retrospective. *Journal of Usability Studies*, 8(2), 29–40. <http://uxpajournal.org/wp-content/uploads/pdf/JUS_Brooke_February_2013.pdf>
- Dillman, D. A., Smyth, J. D., & Christian, L. M. (2014). *Internet, Phone, Mail, and Mixed-Mode Surveys: The Tailored Design Method* (4th ed.). Wiley.
- Dixon, M., Freeman, K., & Toman, N. (2010). Stop trying to delight your customers. *Harvard Business Review*. <https://hbr.org/2010/07/stop-trying-to-delight-your-customers>
- Finstad, K. (2006). The System Usability Scale and non-native English speakers. *Journal of Usability Studies*, 1(4), 185–188. (Suggests "awkward" as an alternative to "cumbersome" in item 8. Peakly keeps the standard wording.)
- Lewis, J. R., Utesch, B. S., & Maher, D. E. (2013). UMUX-LITE: When there's no time for the SUS. *Proc. CHI 2013*, 2099–2102. <https://doi.org/10.1145/2470654.2481287>
- MeasuringU. Measuring usability with the System Usability Scale (SUS). <https://measuringu.com/sus/>. UMUX-Lite. <https://measuringu.com/umux-lite/>
- Pew Research Center. Writing survey questions. <https://www.pewresearch.org/writing-survey-questions/>
- Reichheld, F. F. (2003). The one number you need to grow. *Harvard Business Review*, 81(12), 46–54. <https://hbr.org/2003/12/the-one-number-you-need-to-grow>
- Revilla, M., & Ochoa, C. (2017). Ideal and maximum length for a web survey. *International Journal of Market Research*, 59(5), 557–565. <https://doi.org/10.2501/IJMR-2017-039>
- Sauro, J., & Lewis, J. R. (2016). *Quantifying the User Experience: Practical Statistics for User Research* (2nd ed.). Morgan Kaufmann.
- Google. Apps Script [Forms service](https://developers.google.com/apps-script/reference/forms), [quotas](https://developers.google.com/apps-script/guides/services/quotas), [publishing forms and managing responders](https://developers.google.com/workspace/forms/api/guides/publish-form).

*Net Promoter®, NPS® and Net Promoter Score® are registered trademarks of Bain & Company, Inc., Satmetrix Systems, Inc. (now part of NICE) and Fred Reichheld. Peakly is not affiliated with them. SUS © John Brooke, used with acknowledgement.*
