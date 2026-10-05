# Setting up the Peakly feedback survey (free, no programming)

This folder holds one Google Apps Script, [`create-survey.gs`](create-survey.gs). Running it once builds the whole survey in a Google account:

- the anonymous **survey form**,
- a **results spreadsheet** with a live Dashboard,
- a **"get future surveys"** sign-up form and an **unsubscribe** form,
- a separate **private mailing-list spreadsheet**.

Everything uses Google's free services. Nothing runs on a Peakly server, and the Peakly app never sends data: it only opens the survey link when someone clicks it.

The questions, scoring and rationale are in [docs/SURVEY.md](../../docs/SURVEY.md).

**Account.** Use the dedicated project account **peaklyfeedback@gmail.com**, not a personal one. The forms and sheets are created in that account's Google Drive, and invitations are sent from it.

> **Who does what.** An integrator (a person, or an agent driving the owner's browser) can do steps 1–5. The owner only has to sign in to peaklyfeedback@gmail.com and click **Allow** on Google's permission screen (step 4). Copying the URLs into Peakly (step 7) is done in the repository.

## One-time setup (about 5 minutes)

1. **Sign in** to Google as **peaklyfeedback@gmail.com**. If you use several Google accounts, use a separate Chrome profile or a private window so the script cannot end up in the wrong account.
2. **Create the script.** Go to <https://script.google.com> → **New project**. Click "Untitled project" and rename it **Peakly survey**. Select everything in the editor, delete it, and paste the **entire** contents of `create-survey.gs`. Click **Save** (disk icon, or Ctrl/Cmd+S).
3. **Run setup.** In the toolbar's function menu (next to **Debug**), choose **`setupPeaklySurvey`** and click **Run**.
4. **Approve permissions** (owner). Google shows **Authorization required** → **Review permissions** → choose peaklyfeedback@gmail.com.
   - A screen says **"Google hasn't verified this app."** This appears for **any** script you write yourself. It is not a warning about Peakly. Click **Advanced** → **Go to Peakly survey (unsafe)**.
   - Click **Allow** (or tick **Select all** and then **Continue**). The script asks for:
     - **Google Forms** (create the forms; read sign-ups)
     - **Google Sheets** (results and mailing-list spreadsheets)
     - **Send email as you** (used only when invitations are sent)
     - **Run when you are not present** (used only if the monthly trigger is turned on)
   - The script does not ask for access to your whole Google Drive (unless you later add the optional Drive API service for `allowAnyoneToRespond`).
5. **Read the result.** The **Execution log** opens at the bottom and ends with lines like:
   ```
   ================ Peakly survey is ready ================
   PEAKLY_CONFIG_SNIPPET survey: { url: 'https://forms.gle/…', signupUrl: 'https://forms.gle/…' }
   Paste into src/config.js -> survey.url:       https://forms.gle/…
   Paste into src/config.js -> survey.signupUrl: https://forms.gle/…
   Unsubscribe form (used in invitation emails): https://docs.google.com/forms/d/e/…/viewform
   Results spreadsheet (Dashboard tab):          https://docs.google.com/spreadsheets/d/…
   Mailing list spreadsheet (private):           https://docs.google.com/spreadsheets/d/…
   ```
   The same links are saved in the **README** tab of the "Peakly survey results" spreadsheet in Google Drive, so they are easy to find later.
6. **Check that strangers can answer.** Open the survey link in a **private/incognito window** where you are not signed in.
   - It should show the form **without asking anyone to sign in**. Do the same for the sign-up link.
   - If Google asks for sign-in or says the form is not published: open the form in Google Forms (Drive → "Peakly feedback survey") → click **Publish** (or **Published**) at the top right → **Manage** responders → **Anyone with the link** → Save. Repeat for the other two forms.
   - Alternative: in the script editor, click **Services (+)** → **Drive API** → **Add**, then run `allowAnyoneToRespond`.
   - Optional: submit one test response, look at the Dashboard, then delete the test row from the **Responses** tab, and also under **Responses → ⋮ → Delete all responses** in the form if you want it gone everywhere.
7. **Connect Peakly.** Send the two URLs to the developer, or edit [`src/config.js`](../../src/config.js) yourself:
   ```js
   survey: {
     url: 'https://forms.gle/…',        // survey link from the log
     signupUrl: 'https://forms.gle/…',  // sign-up link from the log
     …
   }
   ```
   Then rebuild the single file with `node build.js`. Until `url` is filled in, Peakly hides every survey link and prompt.

**Running setup again is safe.** The script remembers what it created (Project Settings → Script properties) and reuses it. A re-run only refreshes the Dashboard formulas, the README tab and the links. To start completely over, run `resetPeaklySurvey`, which forgets the IDs but deletes no files.

## Where the results are

Open **Google Drive → "Peakly survey results"**:

| Tab | What it shows |
|---|---|
| **Dashboard** | Live totals: number of responses, SUS score (mean, median, 95% CI), likelihood-to-recommend groups and net score, task-success rate, counts and percentages for every question, a ranked "most wanted additions" list, and charts. It updates by itself as answers arrive. |
| **Scores** | One row per response: SUS score, recommend score and group, task outcome. |
| **Comments** | Every written answer, newest first, with whether the person allowed anonymous quoting. |
| **Responses** | The raw answers from Google Forms. Do not rename its column headers. |
| **README** | The links. |

**Excel.** In the spreadsheet, choose **File → Download → Microsoft Excel (.xlsx)**. Running `exportToExcel` in the script logs a direct download link. Formulas carry over to Excel; most charts do too.

**Sharing results with collaborators.** Share **"Peakly survey results"** only. It contains no email addresses. Keep **"Peakly mailing list (private)"** unshared.

## Sending invitations to people who opted in

People join the list through the sign-up form, which the survey's last page and the thank-you message link to. To invite them:

- **Preview first:** run `previewSurveyInvitations`. The log lists who would be emailed, and nothing is sent.
- **Send now:** run `sendSurveyInvitations`. Each opted-in address that has not unsubscribed and was not invited in the last **90 days** gets one short email from peaklyfeedback@gmail.com. The email contains the survey link, says the survey is anonymous, and explains how to unsubscribe (the unsubscribe form, or reply "unsubscribe").
- **Automatic:** run `installInvitationTrigger` once. Invitations then go out on the 1st of each month, but nobody is emailed more than once every 90 days, so in practice it is quarterly. `removeInvitationTrigger` stops it.
- **Daily limit:** a free Gmail account can email about **100 recipients a day**. The script checks the remaining quota and stops in time. Anyone left over is invited on the next run, or you can run it again the next day.
- The **Invitations** tab in the mailing-list spreadsheet records each address's status, sign-up date, unsubscribe date, last invitation (`invited_at`) and the number of invitations.

**Someone replies "unsubscribe"** to peaklyfeedback@gmail.com: submit the unsubscribe form with their address, or delete them completely (see below).

## Privacy and data-retention practices

These match [docs/PRIVACY.md](../../docs/PRIVACY.md) §4. Keep them in sync if anything changes.

- **Anonymous survey.**
  - The form is set not to collect emails, not to need sign-in, not to let people edit or resubmit, and not to show a summary of other people's answers.
  - Do not add questions asking for names or emails to the survey. Email belongs only in the separate sign-up form.
- **Keep only what is needed.**
  - At least once a year, read the Comments tab and delete anything identifying that someone typed into a text box (names, sample IDs, company names).
  - Publish only **aggregate** results, and quote comments only when the respondent answered "Yes, anonymously".
- **Email retention.** Run `purgeExpiredEmails` a few times a year. It deletes addresses whose last invitation (or sign-up, if never invited) is more than **24 months** old, plus everyone who has unsubscribed.
- **Deletion request.** At the top of the script, set `const EMAIL_TO_FORGET = 'person@example.org';`, then Save and run `forgetEmail`. This deletes the address from the Mailing list, Unsubscribe and Invitations tabs and from the copies Google Forms keeps inside the forms. Afterwards, put `''` back and Save.
- **Survey answers cannot be traced to a person.** Anonymous answers cannot be found for one person, unless that person tells you the exact time they submitted and what they wrote.
- **Google is the service provider.** The data lives in this Google account's Drive under Google's terms. Protect the account with 2-step verification and share the account only with co-maintainers.
- **Changing the privacy policy.** If the setup changes (new questions that could identify people, a different provider, or a different retention period), update PRIVACY.md and the form's first page first.

## Changing questions later

- **Before the first run:** edit `SURVEY_PAGES` near the top of the script.
- **After responses exist:**
  1. Edit the question in the **Google Forms editor**. This keeps the existing answers.
  2. Make the **same** text change in `SURVEY_PAGES`.
  3. Run `rebuildDashboard`.

The Dashboard finds each column by its exact title. A title changed in only one place shows `#N/A` on the Dashboard until both match. Do not re-word the 10 SUS statements, because they are a validated instrument. Checkbox choices must not contain commas.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Exception: You do not have permission…" | Run again and complete the permission screen (step 4). |
| `#N/A` in a Dashboard row | A question title in the form no longer matches `SURVEY_PAGES`. Make them identical, then run `rebuildDashboard`. |
| SUS rows show `#N/A` | Google may have named the SUS grid columns differently from `Question [statement]`. Check the Responses headers and report it to the developer. |
| The form asks respondents to sign in | Do step 6 (Publish → Anyone with the link). |
| "Service invoked too many times: email" | The daily email quota is used up. Run again tomorrow. |
| Links show `docs.google.com/forms/...` instead of `forms.gle/...` | Google's link shortener was unavailable. The long links work just as well. |

## For developers and integrators

- **Script properties:** `SURVEY_FORM_ID`, `SIGNUP_FORM_ID`, `UNSUB_FORM_ID`, `RESULTS_SPREADSHEET_ID`, `MAILING_SPREADSHEET_ID` and the response-sheet IDs.
- **Grep the log** for `PEAKLY_CONFIG_SNIPPET` to get a ready-to-paste `survey: { url, signupUrl }` line.
- **Verifying with a Google Sheets connector:** the results spreadsheet is titled "Peakly survey results". The README tab, rows 2 and 4, holds `survey.url` and `survey.signupUrl`.
- **Syntax check without Google:** `cp tools/survey/create-survey.gs /tmp/cs.js && node --check /tmp/cs.js`
- **APIs used:** FormApp, SpreadsheetApp, MailApp, PropertiesService, LockService and ScriptApp. Drive is optional (advanced service), used only by `allowAnyoneToRespond`. All are free.
