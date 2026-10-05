// SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0
/**
 * Peakly feedback survey: Google Forms + Google Sheets, set up by one script.
 * Copyright (c) 2026 Jennifer Schmitt. All rights reserved; see LICENSE in the Peakly repository.
 *
 * WHAT THIS CREATES (in the Google Drive of whoever runs it; everything is free)
 *   1. Google Form "Peakly feedback survey"            (anonymous; ~4-5 minutes)
 *   2. Google Sheet "Peakly survey results"            (shareable with collaborators; contains no emails)
 *        - Responses : raw answers (filled in by Google Forms automatically)
 *        - Scores    : SUS score, likelihood-to-recommend group and task outcome per response (live formulas)
 *        - Dashboard : counts, percentages, SUS mean/median/95% CI, LTR split, task success, charts (live formulas)
 *        - Comments  : every written answer, newest first, with the respondent's quote permission
 *        - README    : the links to paste into Peakly's src/config.js
 *   3. Google Form "Peakly - get future surveys"      (email + explicit consent; the opt-in list)
 *   4. Google Form "Peakly - unsubscribe"             (email only)
 *   5. Google Sheet "Peakly mailing list (private)"    (kept separate so the results sheet never holds emails)
 *        - Mailing list, Unsubscribe : form responses
 *        - Invitations               : who was invited and when (maintained by sendSurveyInvitations)
 *        - README
 *
 * HOW TO RUN (full non-programmer walkthrough: tools/survey/README.md)
 *   Sign in as the dedicated survey account (peaklyfeedback@gmail.com; see CONFIG.CONTACT_EMAIL), then
 *   script.google.com -> New project -> paste this whole file -> Save -> choose
 *   "setupPeaklySurvey" in the function menu -> Run -> approve permissions -> read the log.
 *   Re-running setupPeaklySurvey is safe: it reuses what it already created (IDs are kept in
 *   Project Settings -> Script properties) and only rebuilds the Dashboard/Scores/Comments formulas.
 *
 * PUBLIC FUNCTIONS (pick them in the editor's function menu)
 *   setupPeaklySurvey()          create or repair everything; logs the URLs for src/config.js
 *   rebuildDashboard()           rebuild Scores/Dashboard/Comments after you edit questions
 *   previewSurveyInvitations()   list who WOULD be emailed, without sending anything
 *   sendSurveyInvitations()      email the survey link to opted-in, not-unsubscribed, not-recently-invited people
 *   installInvitationTrigger()   run sendSurveyInvitations automatically on the 1st of each month
 *                                (each person still gets at most one invitation per MIN_DAYS_BETWEEN_INVITES)
 *   removeInvitationTrigger()    stop the automatic invitations
 *   purgeExpiredEmails()         delete emails past the retention limit (privacy policy: 24 months)
 *   forgetEmail()                delete one person's email everywhere (set EMAIL_TO_FORGET below first)
 *   exportToExcel()              log a direct .xlsx download link for the results sheet
 *   allowAnyoneToRespond()       OPTIONAL; needs the "Drive API" advanced service (see README)
 *   resetPeaklySurvey()          forget the stored IDs (does NOT delete any file) to start over
 *
 * PERMISSIONS GOOGLE WILL ASK FOR (because you run the script under your own account)
 *   - View and manage your forms in Google Drive          (FormApp: create the three forms, read sign-ups)
 *   - See, edit, create and delete your spreadsheets      (SpreadsheetApp: results + mailing-list sheets)
 *   - Send email as you                                   (MailApp: only sendSurveyInvitations uses it)
 *   - Allow this application to run when you are not present (ScriptApp: only for the monthly trigger)
 *   Google shows "Google hasn't verified this app" for any personal script: click Advanced ->
 *   "Go to <project name> (unsafe)". It is your own code running in your own account.
 *
 * QUOTAS (free; https://developers.google.com/apps-script/guides/services/quotas)
 *   - MailApp: consumer (gmail.com) accounts can email about 100 recipients per day; Google Workspace
 *     accounts about 1,500. sendSurveyInvitations checks MailApp.getRemainingDailyQuota(), keeps a
 *     small reserve, stops early and continues with the rest on the next run.
 *   - 6 minutes per execution; setup takes well under one minute.
 *   - Forms and Sheets themselves are free; a Sheet holds 10 million cells (plenty).
 *
 * HOW TO CHANGE QUESTIONS
 *   Before the first run: edit SURVEY_PAGES below (titles, choices, help text) and run setup.
 *   After responses exist: edit the question in the Google Forms editor (keeps the data), make
 *   the SAME text change in SURVEY_PAGES here, then run rebuildDashboard(). The Dashboard finds
 *   columns by their header text, so a title changed in only one place shows "#N/A" until both match.
 *   Rules: titles must be unique; checkbox choices must not contain commas (Google joins multiple
 *   selections with ", "); do not re-word the 10 SUS statements (they are a validated instrument).
 *
 * PRIVACY BY DESIGN
 *   The survey form does not collect emails or Google accounts and does not require sign-in.
 *   Email opt-in lives in a separate form and a separate spreadsheet, so answers are never stored
 *   next to an email address. The Peakly app never sends data; it only opens a link the user clicks.
 */

// ------------------------------------------------------------------------------------------
// Settings you may edit
// ------------------------------------------------------------------------------------------
const CONFIG = {
  REPO_URL: 'https://github.com/jschmitt1531/peakly',
  APP_URL: 'https://jschmitt1531.github.io/peakly/app/',
  PRIVACY_URL: 'https://github.com/jschmitt1531/peakly/blob/main/docs/PRIVACY.md',
  FORMAT_REQUEST_URL: 'https://github.com/jschmitt1531/peakly/issues/new?template=format_request.yml',
  MAINTAINER: 'Jennifer Schmitt, Ph.D.',
  // Dedicated account that owns the forms/sheets and sends invitations. Shown as the contact and reply-to address.
  CONTACT_EMAIL: 'peaklyfeedback@gmail.com',
  SENDER_NAME: 'Peakly feedback',
  SURVEY_TITLE: 'Peakly feedback survey',
  SIGNUP_TITLE: 'Peakly - get future surveys',
  UNSUB_TITLE: 'Peakly - unsubscribe',
  RESULTS_SHEET_TITLE: 'Peakly survey results',
  MAILING_SHEET_TITLE: 'Peakly mailing list (private)',
  MIN_DAYS_BETWEEN_INVITES: 90,   // nobody is invited more often than this
  MAX_INVITES_PER_RUN: 90,        // stays under the consumer daily recipient quota
  QUOTA_RESERVE: 5,               // leave a few emails of daily quota for you
  RETENTION_MONTHS: 24,           // privacy policy: emails kept at most 24 months after the last invitation
  SET_SHEETS_LOCALE_EN_US: true   // formulas below use English function names and comma separators
};

// For forgetEmail(): type the address between the quotes, Save, run forgetEmail, then clear it again.
const EMAIL_TO_FORGET = '';

// ------------------------------------------------------------------------------------------
// The questionnaire (single source of truth for the form AND the dashboard)
//   type: 'mc' (one answer), 'checkbox' (several), 'scale', 'grid', 'paragraph', 'text', 'info'
//   key : internal name used by the dashboard; title: question text (= response sheet header)
// ------------------------------------------------------------------------------------------
const SUS_COLUMNS = ['1 Strongly disagree', '2', '3', '4', '5 Strongly agree'];
const SUS_ROWS = [ // Brooke (1996) System Usability Scale; "system" replaced by "Peakly"
  'I think that I would like to use Peakly frequently.',
  'I found Peakly unnecessarily complex.',
  'I thought Peakly was easy to use.',
  'I think that I would need the support of a technical person to be able to use Peakly.',
  'I found the various functions in Peakly were well integrated.',
  'I thought there was too much inconsistency in Peakly.',
  'I would imagine that most people would learn to use Peakly very quickly.',
  'I found Peakly very cumbersome to use.',
  'I felt very confident using Peakly.',
  'I needed to learn a lot of things before I could get going with Peakly.'
];

const SURVEY_DESCRIPTION = [
  'Thank you for helping improve Peakly, the free chromatogram analyzer by ' + CONFIG.MAINTAINER + '. About 4-5 minutes.',
  '',
  'Before you start:',
  '- Voluntary: every question except the consent question is optional. Skip anything; close the tab to stop. Nothing is saved until you press Submit.',
  '- Anonymous: this form does not collect your name, email address or Google account, and no sign-in is needed. The Peakly app does not send any data with it.',
  '- Please do not type personal or confidential information (names, sample IDs, patient or proprietary data) into the text boxes.',
  '- Use: answers are used only to improve Peakly and to report aggregate results (for example in the README, talks or grant reports). Written comments are quoted only if you allow it on the last page, and never with identifying details.',
  '- Storage: answers are stored in Google Forms/Sheets in the maintainer\'s Google account; Google processes the submission under its own privacy policy. Because answers are anonymous, a single response cannot later be found and deleted.',
  '- Please take part only if you are 16 or older.',
  '',
  'Questions: ' + CONFIG.CONTACT_EMAIL + '. Privacy policy: ' + CONFIG.PRIVACY_URL
].join('\n');

const SURVEY_PAGES = [
  { // page 1 (the form's first page; no page break before it)
    items: [
      { key: 'consent', type: 'mc', required: true,
        title: 'Do you agree to take part?',
        choices: ['Yes, I have read the notice above and agree to take part'] }
    ]
  },
  { title: 'How you used Peakly', help: 'Think about your most recent use of Peakly.',
    items: [
      { key: 'used', type: 'checkbox', other: true, chart: 'What people used Peakly for',
        title: 'What did you use Peakly for? (select all that apply)',
        choices: ['Opening an instrument or data file', 'Digitizing an image, PDF or photo of a chromatogram',
          'Detecting or integrating peaks', 'Adjusting peak clipping or splitting', 'Calibration curve or quantitation',
          'Comparing or overlaying runs', 'Entering a gradient or method', 'Exporting figures, tables or a PDF report',
          'Creating a share link', 'Only exploring the sample data'] },
      { key: 'formats', type: 'checkbox', other: true,
        title: 'Which kinds of files did you open? (select all that apply)',
        choices: ['Generic CSV/TSV/TXT', 'Excel', 'Agilent ChemStation/OpenLab (.ch or export)', 'Thermo Chromeleon export',
          'Shimadzu LabSolutions export', 'Waters Empower export', 'Cytiva UNICORN export', 'Bio-Rad ChromLab/NGC export',
          'JCAMP-DX or AnDI/netCDF or mzML', 'Image or PDF or photo', 'Peakly project file or share link', 'None'] },
      { key: 'task', type: 'mc',
        title: 'Did Peakly do what you needed it to do?',
        choices: ['Yes, completely', 'Partly', 'No', 'I was only exploring'] },
      { key: 'blocker', type: 'paragraph',
        title: 'If partly or no: what got in the way?',
        help: 'For example a file that would not open, a missing feature, a confusing step, or a number you did not trust.' }
    ]
  },
  { title: 'Ease of use',
    help: 'Ten short statements used widely to compare software (the System Usability Scale). Some are positive and some negative on purpose, so please read each one. Answer with your first impression.',
    items: [
      { key: 'sus', type: 'grid', title: 'How much do you agree with each statement about Peakly?',
        rows: SUS_ROWS, columns: SUS_COLUMNS }
    ]
  },
  { title: 'Trust in the results',
    items: [
      { key: 'compared', type: 'mc',
        title: 'Did you compare Peakly\'s numbers with another program (for example your instrument software)?',
        choices: ['Yes, and they agreed closely', 'Yes, with small differences I could explain',
          'Yes, with differences I could not explain', 'No, I did not compare'] },
      { key: 'trust', type: 'scale', low: 1, high: 5, lowLabel: 'Not at all', highLabel: 'Completely',
        title: 'How much do you trust Peakly\'s results for your purpose?' }
    ]
  },
  { title: 'What should come next',
    items: [
      { key: 'wanted', type: 'checkbox', other: true, maxSelect: 3, chart: 'Most wanted additions', top: true,
        title: 'Which additions would be most valuable to you? (choose up to 3)',
        choices: ['More instrument file formats', 'DAD/PDA 3D data (time x wavelength)', 'Batch processing of many files',
          'Method validation tools (linearity and precision reports)', 'LIMS or ELN friendly export',
          'Peak purity or spectral comparison', 'Mass spectrometry beyond TIC', 'Report templates',
          'Better image digitizing', 'Installable offline app', 'Tutorials and videos', 'Other languages'] },
      { key: 'failedFormat', type: 'text',
        title: 'Did a file fail to open? If so, which instrument, software and file type?',
        help: 'If you can share a non-confidential sample file, please open a format request (no sign-in needed to read it; a free GitHub account is needed to post): ' + CONFIG.FORMAT_REQUEST_URL }
    ]
  },
  { title: 'Overall',
    items: [
      { key: 'ltr', type: 'scale', low: 0, high: 10, lowLabel: 'Not at all likely', highLabel: 'Extremely likely',
        title: 'How likely are you to recommend Peakly to a colleague?' },
      { key: 'ltrWhy', type: 'paragraph', title: 'What is the main reason for your answer?' },
      { key: 'cite', type: 'mc',
        title: 'If Peakly contributed to a publication, thesis or report, would you cite it?',
        choices: ['Yes', 'Maybe', 'No', 'Not applicable to me'] },
      { key: 'teach', type: 'mc',
        title: 'Would you use Peakly in teaching or training?',
        choices: ['I already do', 'Yes, I plan to', 'Maybe', 'No', 'Not applicable to me'] },
      { key: 'improve', type: 'paragraph', title: 'What one change would most improve Peakly for you?' }
    ]
  },
  { title: 'About you (optional)',
    help: 'These help us understand who Peakly serves. They are asked last and every one is optional.',
    items: [
      { key: 'role', type: 'mc', other: true, title: 'Which best describes your role?',
        choices: ['Student', 'Academic researcher', 'Industry R&D', 'Industry QC/QA', 'Core facility or service lab',
          'Teacher or instructor', 'Government or regulatory lab'] },
      { key: 'field', type: 'mc', other: true, title: 'What is your main field?',
        choices: ['Pharmaceutical or biopharmaceutical', 'Biochemistry or protein purification', 'Chemistry',
          'Environmental', 'Food or agriculture', 'Clinical or forensic', 'Materials or polymers'] },
      { key: 'vendors', type: 'checkbox', other: true,
        title: 'Which instrument makers do you use? (select all that apply)',
        choices: ['Agilent', 'Waters', 'Thermo Fisher (Dionex)', 'Shimadzu', 'Cytiva (AKTA)', 'Bio-Rad', 'None or not sure'] },
      { key: 'freq', type: 'mc', title: 'How often do you analyze chromatograms?',
        choices: ['Daily', 'Weekly', 'Monthly', 'Less than monthly'] },
      { key: 'quote', type: 'mc',
        title: 'May we quote your written comments anonymously (for example in the README, grant reports or talks)?',
        choices: ['Yes, anonymously', 'No'] },
      { key: 'signupInfo', type: 'info', title: 'Want to hear about future surveys?',
        help: 'To keep this survey anonymous, email sign-up is a separate form, not linked to these answers: {SIGNUP_URL}' }
    ]
  }
];

// Sign-up form questions (the invitation code finds these columns by their titles).
const SIGNUP_EMAIL_TITLE = 'Email address';
const SIGNUP_CONSENT_TITLE = 'Consent';
const SIGNUP_CONSENT_CHOICE = 'I agree that the Peakly maintainer may store this email address in Google Sheets and email me invitations to future Peakly feedback surveys (at most one every 3 months). I can unsubscribe at any time.';
const SIGNUP_RELEASES_TITLE = 'Also tell me about major Peakly releases (optional)';
const SIGNUP_RELEASES_CHOICE = 'Yes, a few emails a year at most';
const SIGNUP_ROLE_TITLE = 'Your role (optional)';
const UNSUB_EMAIL_TITLE = 'Email address to remove';

const P = { // Script property names
  SURVEY_ID: 'SURVEY_FORM_ID', SURVEY_BUILT: 'SURVEY_FORM_BUILT', SIGNUP_ID: 'SIGNUP_FORM_ID',
  SIGNUP_BUILT: 'SIGNUP_FORM_BUILT', UNSUB_ID: 'UNSUB_FORM_ID', UNSUB_BUILT: 'UNSUB_FORM_BUILT',
  RESULTS_ID: 'RESULTS_SPREADSHEET_ID', MAILING_ID: 'MAILING_SPREADSHEET_ID',
  RESP_SHEET: 'RESPONSES_SHEET_ID', LIST_SHEET: 'MAILING_LIST_SHEET_ID', UNSUB_SHEET: 'UNSUB_SHEET_ID'
};
const LAST_COL = 'BZ';      // formulas look for question columns in A..BZ of the Responses sheet
const LAST_COL_NUM = 78;

// ==========================================================================================
// Setup
// ==========================================================================================
function setupPeaklySurvey() {
  const props = PropertiesService.getScriptProperties();

  // 1. Spreadsheets (results without emails; mailing list separate)
  const results = openOrCreateSpreadsheet_(props, P.RESULTS_ID, CONFIG.RESULTS_SHEET_TITLE);
  const mailing = openOrCreateSpreadsheet_(props, P.MAILING_ID, CONFIG.MAILING_SHEET_TITLE);

  // 2. Forms. The unsubscribe and sign-up forms come first so their links can appear in the survey.
  const unsub = openOrCreateForm_(props, P.UNSUB_ID, P.UNSUB_BUILT, CONFIG.UNSUB_TITLE, buildUnsubForm_);
  const signup = openOrCreateForm_(props, P.SIGNUP_ID, P.SIGNUP_BUILT, CONFIG.SIGNUP_TITLE, function (f) {
    buildSignupForm_(f, unsub.getPublishedUrl());
  });
  const signupUrl = signup.getPublishedUrl();
  const survey = openOrCreateForm_(props, P.SURVEY_ID, P.SURVEY_BUILT, CONFIG.SURVEY_TITLE, function (f) {
    buildSurveyForm_(f, signupUrl);
  });

  // 3. Link forms to sheets (only once) and give the response tabs stable names
  const respSheet = linkForm_(props, survey, results, P.RESP_SHEET, 'Responses');
  ensureColumns_(respSheet, LAST_COL_NUM);
  linkForm_(props, signup, mailing, P.LIST_SHEET, 'Mailing list');
  linkForm_(props, unsub, mailing, P.UNSUB_SHEET, 'Unsubscribe');
  getOrCreateSheet_(mailing, 'Invitations');
  ensureInvitationHeader_(mailing.getSheetByName('Invitations'));

  // 4. Live analysis tabs
  rebuildDashboard();

  // 5. Links
  const urls = {
    survey: survey.getPublishedUrl(),
    surveyShort: shorten_(survey),
    signup: signupUrl,
    signupShort: shorten_(signup),
    unsub: unsub.getPublishedUrl()
  };
  writeReadme_(results, mailing, survey, signup, unsub, urls);
  removeDefaultSheet_(results);
  removeDefaultSheet_(mailing);

  const published = [survey, signup, unsub].every(function (f) { return isPublishedSafe_(f); });
  Logger.log('================ Peakly survey is ready ================');
  Logger.log('Owner/contact account expected: ' + CONFIG.CONTACT_EMAIL + ' (files were created in the Drive of the account that ran this).');
  Logger.log('PEAKLY_CONFIG_SNIPPET survey: { url: \'' + urls.surveyShort + '\', signupUrl: \'' + urls.signupShort + '\' }');
  Logger.log('Paste into src/config.js -> survey.url:       ' + urls.surveyShort);
  Logger.log('Paste into src/config.js -> survey.signupUrl: ' + urls.signupShort);
  Logger.log('Unsubscribe form (used in invitation emails): ' + urls.unsub);
  Logger.log('Results spreadsheet (Dashboard tab):          ' + results.getUrl());
  Logger.log('Mailing list spreadsheet (private):           ' + mailing.getUrl());
  Logger.log('Edit the survey form:                         ' + survey.getEditUrl());
  if (!published) {
    Logger.log('WARNING: at least one form reports it is not published. Open each form, click "Publish" ' +
      'and set Responders to "Anyone with the link" (see README step 6).');
  }
  Logger.log('Check: open the survey link in a private/incognito window. It must open WITHOUT asking you to sign in.');
}

/**
 * Updates only the descriptions and thank-you messages of the three existing forms (no questions, settings or
 * responses are touched). Run after editing SURVEY_DESCRIPTION or CONFIG text.
 */
function refreshFormTexts() {
  const props = PropertiesService.getScriptProperties();
  const survey = FormApp.openById(mustGet_(props, P.SURVEY_ID));
  const signup = FormApp.openById(mustGet_(props, P.SIGNUP_ID));
  const unsub = FormApp.openById(mustGet_(props, P.UNSUB_ID));
  const signupUrl = shorten_(signup), unsubUrl = unsub.getPublishedUrl();
  survey.setDescription(SURVEY_DESCRIPTION);
  survey.setConfirmationMessage([
    'Thank you! Your answers were recorded anonymously.',
    'Peakly: ' + CONFIG.REPO_URL,
    'To hear about future surveys (separate, optional): ' + signupUrl,
    'If Peakly helps your work, please cite it: ' + CONFIG.REPO_URL + '#how-to-cite',
    'Questions or feedback by email: ' + CONFIG.CONTACT_EMAIL
  ].join('\n'));
  buildSignupTexts_(signup, unsubUrl);
  Logger.log('Form descriptions and thank-you messages refreshed.');
}

function buildSurveyForm_(form, signupUrl) {
  form.setDescription(SURVEY_DESCRIPTION);
  form.setConfirmationMessage([
    'Thank you! Your answers were recorded anonymously.',
    'Peakly: ' + CONFIG.REPO_URL,
    'To hear about future surveys (separate, optional): ' + signupUrl,
    'If Peakly helps your work, please cite it: ' + CONFIG.REPO_URL + '#how-to-cite',
    'Questions or feedback by email: ' + CONFIG.CONTACT_EMAIL
  ].join('\n'));
  SURVEY_PAGES.forEach(function (page, i) {
    if (i > 0) {
      const pb = form.addPageBreakItem().setTitle(page.title);
      if (page.help) pb.setHelpText(page.help);
    }
    page.items.forEach(function (q) { addItem_(form, q, signupUrl); });
  });
}

function addItem_(form, q, signupUrl) {
  const help = q.help ? q.help.replace('{SIGNUP_URL}', signupUrl) : '';
  let item;
  switch (q.type) {
    case 'mc':
      item = form.addMultipleChoiceItem().setTitle(q.title).setChoiceValues(q.choices);
      if (q.other) item.showOtherOption(true);
      break;
    case 'checkbox':
      item = form.addCheckboxItem().setTitle(q.title).setChoiceValues(q.choices);
      if (q.other) item.showOtherOption(true);
      if (q.maxSelect) {
        item.setValidation(FormApp.createCheckboxValidation()
          .setHelpText('Please choose at most ' + q.maxSelect + '.')
          .requireSelectAtMost(q.maxSelect).build());
      }
      break;
    case 'scale':
      item = form.addScaleItem().setTitle(q.title).setBounds(q.low, q.high).setLabels(q.lowLabel, q.highLabel);
      break;
    case 'grid':
      item = form.addGridItem().setTitle(q.title).setRows(q.rows).setColumns(q.columns);
      break;
    case 'paragraph':
      item = form.addParagraphTextItem().setTitle(q.title);
      break;
    case 'text':
      item = form.addTextItem().setTitle(q.title);
      break;
    case 'info':
      item = form.addSectionHeaderItem().setTitle(q.title);
      break;
    default:
      throw new Error('Unknown question type: ' + q.type);
  }
  if (help) item.setHelpText(help);
  if (q.type !== 'info') item.setRequired(!!q.required);
  return item;
}

function buildSignupTexts_(form, unsubUrl) {
  form.setDescription([
    'Leave your email address to be invited to future Peakly feedback surveys (at most one every 3 months).',
    'This is separate from the survey itself, so your survey answers stay anonymous.',
    'Your address is stored in a private Google Sheet in the maintainer\'s Google account, used only for these emails, never sold or shared, and deleted when you unsubscribe or at most ' + CONFIG.RETENTION_MONTHS + ' months after the last invitation.',
    'Invitations come from ' + CONFIG.CONTACT_EMAIL + '. Unsubscribe at any time: ' + unsubUrl + ' or reply "unsubscribe" to ' + CONFIG.CONTACT_EMAIL + '.',
    'Privacy policy: ' + CONFIG.PRIVACY_URL
  ].join('\n'));
  form.setConfirmationMessage('Thank you. You will receive at most one invitation every 3 months from ' + CONFIG.CONTACT_EMAIL +
    '. Unsubscribe any time: ' + unsubUrl + ' or reply "unsubscribe" to ' + CONFIG.CONTACT_EMAIL + '.');
}

function buildSignupForm_(form, unsubUrl) {
  buildSignupTexts_(form, unsubUrl);
  form.addTextItem().setTitle(SIGNUP_EMAIL_TITLE).setRequired(true)
    .setValidation(FormApp.createTextValidation().setHelpText('Please enter a valid email address.')
      .requireTextIsEmail().build());
  form.addCheckboxItem().setTitle(SIGNUP_CONSENT_TITLE).setChoiceValues([SIGNUP_CONSENT_CHOICE]).setRequired(true);
  form.addCheckboxItem().setTitle(SIGNUP_RELEASES_TITLE).setChoiceValues([SIGNUP_RELEASES_CHOICE]).setRequired(false);
  form.addMultipleChoiceItem().setTitle(SIGNUP_ROLE_TITLE).showOtherOption(true).setRequired(false)
    .setChoiceValues(['Student', 'Academic researcher', 'Industry', 'Core facility or service lab', 'Teacher or instructor']);
}

function buildUnsubForm_(form) {
  form.setDescription('Enter the email address you signed up with. It will receive no more Peakly survey or release emails, and the maintainer will delete it from the mailing list. You can also email ' + CONFIG.CONTACT_EMAIL + ' with the word "unsubscribe". Privacy policy: ' + CONFIG.PRIVACY_URL);
  form.setConfirmationMessage('Done. You will not receive further Peakly invitations. Sorry to see you go, and thank you for your earlier help. Questions: ' + CONFIG.CONTACT_EMAIL);
  form.addTextItem().setTitle(UNSUB_EMAIL_TITLE).setRequired(true)
    .setValidation(FormApp.createTextValidation().setHelpText('Please enter a valid email address.')
      .requireTextIsEmail().build());
}

// ------------------------------------------------------------------------------------------
// Idempotent create/open helpers
// ------------------------------------------------------------------------------------------
function openOrCreateForm_(props, idKey, builtKey, title, buildFn) {
  let form = null;
  const id = props.getProperty(idKey);
  if (id) {
    try { form = FormApp.openById(id); } catch (e) { form = null; }
  }
  if (!form) {
    try { form = FormApp.create(title, true); }       // newer signature: create published
    catch (e) { form = FormApp.create(title); }
    props.setProperty(idKey, form.getId());
    props.deleteProperty(builtKey);
  }
  if (props.getProperty(builtKey) !== 'yes') {
    // A previous run may have stopped half way: start from an empty form.
    form.getItems().forEach(function (it) { form.deleteItem(it); });
    applyAnonymousSettings_(form);
    buildFn(form);
    props.setProperty(builtKey, 'yes');
  }
  return form;
}

function applyAnonymousSettings_(form) {
  // Forms created by scripts after mid-2026 may start unpublished; publish first.
  try { form.setPublished(true); } catch (e) { Logger.log('setPublished not available here: ' + e); }
  form.setCollectEmail(false);                 // never record respondents' email addresses
  form.setLimitOneResponsePerUser(false);      // "true" would force a Google sign-in
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);
  form.setPublishingSummary(false);            // respondents do not see other people's answers
  form.setProgressBar(true);
  form.setShuffleQuestions(false);
  try { form.setAcceptingResponses(true); } catch (e) { Logger.log('setAcceptingResponses: ' + e); }
  // setRequireLogin() is deprecated (it only ever applied to Workspace domains), so it is not used.
}

function isPublishedSafe_(form) {
  try { return form.isPublished(); } catch (e) { return true; }
}

function openOrCreateSpreadsheet_(props, idKey, title) {
  const id = props.getProperty(idKey);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted: create again */ }
  }
  const ss = SpreadsheetApp.create(title);
  if (CONFIG.SET_SHEETS_LOCALE_EN_US) ss.setSpreadsheetLocale('en_US');
  props.setProperty(idKey, ss.getId());
  return ss;
}

/** Links a form to a spreadsheet once, finds the response tab Google created, renames it. */
function linkForm_(props, form, ss, sheetKey, name) {
  const already = existingSheetById_(ss, props.getProperty(sheetKey));
  if (already && destId_(form) === ss.getId()) return already;

  if (destId_(form) !== ss.getId()) {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    SpreadsheetApp.flush();
  }
  const fresh = SpreadsheetApp.openById(ss.getId());   // re-open so the new tab is visible
  const known = [form.getPublishedUrl(), form.getEditUrl()];
  let sheet = fresh.getSheets().filter(function (s) {
    const u = s.getFormUrl();
    return u && (u.indexOf(form.getId()) !== -1 || known.indexOf(u) !== -1);
  })[0];
  if (!sheet) { // fallback: the newest "Form responses N" tab
    const cands = fresh.getSheets().filter(function (s) { return /^form responses/i.test(s.getName()); });
    sheet = cands[cands.length - 1];
  }
  if (!sheet) throw new Error('Could not find the response tab for "' + form.getTitle() + '". Open the form, Responses -> Link to Sheets, then run setup again.');
  if (!fresh.getSheetByName(name)) sheet.setName(name);
  sheet.setFrozenRows(1);
  props.setProperty(sheetKey, String(sheet.getSheetId()));
  return sheet;
}

/** Form.getDestinationId() throws ("no response destination") on a new form; return null instead. */
function destId_(form) {
  try { return form.getDestinationId(); } catch (e) { return null; }
}

function existingSheetById_(ss, id) {
  if (!id) return null;
  return ss.getSheets().filter(function (s) { return String(s.getSheetId()) === String(id); })[0] || null;
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureColumns_(sheet, n) {
  const have = sheet.getMaxColumns();
  if (have < n) sheet.insertColumnsAfter(have, n - have);
}

function removeDefaultSheet_(ss) {
  ['Sheet1', 'Feuille 1', 'Tabelle1', 'Hoja 1', 'Foglio1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s);
  });
}

function shorten_(form) {
  try { return form.shortenFormUrl(form.getPublishedUrl()); }
  catch (e) { return form.getPublishedUrl(); }
}

function writeReadme_(results, mailing, survey, signup, unsub, urls) {
  const rows = [
    ['Peakly survey', ''],
    ['Public survey link (src/config.js survey.url)', urls.surveyShort],
    ['Public survey link (long form)', urls.survey],
    ['Sign-up form for future surveys (src/config.js survey.signupUrl)', urls.signupShort],
    ['Unsubscribe form', urls.unsub],
    ['Survey form editor', survey.getEditUrl()],
    ['Results spreadsheet (this file; contains no emails)', results.getUrl()],
    ['Excel download of this file', xlsxUrl_(results.getId())],
    ['Last setup run', new Date()],
    ['Contact / reply-to address', CONFIG.CONTACT_EMAIL],
    ['src/config.js snippet', "survey: { url: '" + urls.surveyShort + "', signupUrl: '" + urls.signupShort + "' }"],
    ['', ''],
    ['How to read', 'Dashboard = live summary. Scores = per-response SUS/LTR. Comments = written answers. Responses = raw data (do not edit headers).'],
    ['Changing questions', 'Edit in the form editor AND in SURVEY_PAGES in the script, then run rebuildDashboard().'],
    ['Privacy', 'Responses are anonymous. Do not add columns that identify people. Review and prune at least once a year.']
  ];
  const r = getOrCreateSheet_(results, 'README');
  r.clear();
  r.getRange(1, 1, rows.length, 2).setValues(rows);
  r.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  r.setColumnWidth(1, 380); r.setColumnWidth(2, 640);

  const m = getOrCreateSheet_(mailing, 'README');
  const mrows = [
    ['Peakly mailing list (PRIVATE: do not share this file)', ''],
    ['Sign-up form', urls.signup],
    ['Unsubscribe form', urls.unsub],
    ['Sign-up form editor', signup.getEditUrl()],
    ['Unsubscribe form editor', unsub.getEditUrl()],
    ['Rules', 'Only email people whose latest sign-up is newer than their latest unsubscribe (sendSurveyInvitations does this). At most one invitation per ' + CONFIG.MIN_DAYS_BETWEEN_INVITES + ' days.'],
    ['Retention', 'Run purgeExpiredEmails() a few times a year: removes addresses ' + CONFIG.RETENTION_MONTHS + ' months after their last invitation.'],
    ['Deletion request', 'Set EMAIL_TO_FORGET in the script and run forgetEmail(); it deletes the address from all tabs and from the forms\' stored responses.'],
    ['Reply "unsubscribe"', 'Replies arrive at ' + CONFIG.CONTACT_EMAIL + '. Submit the unsubscribe form on the person\'s behalf (or run forgetEmail).']
  ];
  m.clear();
  m.getRange(1, 1, mrows.length, 2).setValues(mrows);
  m.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  m.setColumnWidth(1, 260); m.setColumnWidth(2, 700);
}

function xlsxUrl_(id) {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
}

// ==========================================================================================
// Dashboard (all numbers are live spreadsheet formulas: they update as responses arrive)
// ==========================================================================================
function rebuildDashboard() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(mustGet_(props, P.RESULTS_ID));
  const resp = existingSheetById_(ss, props.getProperty(P.RESP_SHEET)) || ss.getSheetByName('Responses');
  if (!resp) throw new Error('Responses tab not found. Run setupPeaklySurvey first.');
  ensureColumns_(resp, LAST_COL_NUM);
  const R = quoteSheet_(resp.getName());
  const items = allItems_();
  const byKey = {};
  items.forEach(function (q) { byKey[q.key] = q; });

  buildScoresSheet_(ss, R, byKey);
  buildDashboardSheet_(ss, R, items, byKey);
  buildCommentsSheet_(ss, R, items);
  ss.setActiveSheet(ss.getSheetByName('Dashboard'));
  ss.moveActiveSheet(1);
  Logger.log('Dashboard rebuilt: ' + ss.getUrl());
}

/** Column of answers (rows 2..end) for the header that matches `key` exactly (wildcards escaped). */
function col_(R, title) {
  return 'INDEX(' + dataRange_(R, 'A', LAST_COL) + ',0,MATCH("' + fq_(escWild_(title)) + '",' + R + '!$A$1:$' + LAST_COL + '$1,0))';
}
/** Column for one row of a grid question. Google names these "<question title> [<row text>]". */
function gridCol_(R, rowText) {
  return 'INDEX(' + dataRange_(R, 'A', LAST_COL) + ',0,MATCH("*[' + fq_(escWild_(rowText)) + ']",' + R + '!$A$1:$' + LAST_COL + '$1,0))';
}
function tsCol_(R) { return dataRange_(R, 'A', 'A'); }
/**
 * Response data (row 2 down) as INDIRECT("Sheet!A2:BZ"). Google Forms INSERTS each new response as a row, and Sheets
 * shifts ordinary references to that sheet ($A$2 -> $A$3 ...), so the first response would drop out of every
 * formula. References written as text inside INDIRECT are never shifted.
 */
function dataRange_(R, fromCol, toCol) { return 'INDIRECT("' + fq_(R + '!' + fromCol + '2:' + toCol) + '")'; }

function buildScoresSheet_(ss, R, byKey) {
  const s = getOrCreateSheet_(ss, 'Scores');
  s.clear();
  const ts = tsCol_(R);
  const sus = SUS_ROWS.map(function (row) { return gridCol_(R, row); });
  const lens = sus.map(function (c) { return 'LEN(' + c + ')'; }).join('*');
  const terms = sus.map(function (c, i) {
    const v = 'VALUE(LEFT(' + c + ',1))';
    return i % 2 === 0 ? '(' + v + '-1)' : '(5-' + v + ')';   // items 1,3,5,7,9 positive; 2,4,6,8,10 negative
  }).join('+');
  const ltr = col_(R, byKey.ltr.title);
  s.getRange(1, 1, 1, 5).setValues([['Timestamp', 'SUS score (0-100; blank unless all 10 answered)',
    'Likelihood to recommend (0-10)', 'LTR group', 'Task outcome']]);
  s.getRange(2, 1, 1, 5).setFormulas([[
    '=ARRAYFORMULA(IF(LEN(' + ts + ')=0,"",' + ts + '))',
    '=ARRAYFORMULA(IF(LEN(' + ts + ')=0,"",IF(' + lens + '=0,"",(' + terms + ')*2.5)))',
    '=ARRAYFORMULA(IF(LEN(' + ts + ')=0,"",IF(LEN(' + ltr + ')=0,"",VALUE(' + ltr + '))))',
    '=ARRAYFORMULA(IF(C2:C="","",IF(C2:C>=9,"Promoter",IF(C2:C>=7,"Passive","Detractor"))))',
    '=ARRAYFORMULA(IF(LEN(' + ts + ')=0,"",' + col_(R, byKey.task.title) + '))'
  ]]);
  s.setFrozenRows(1);
  s.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  s.getRange('B:B').setNumberFormat('0.0');
  s.getRange(1, 1, 1, 5).setFontWeight('bold').setWrap(true);
  s.setColumnWidths(1, 5, 170);
}

function buildDashboardSheet_(ss, R, items, byKey) {
  const d = getOrCreateSheet_(ss, 'Dashboard');
  d.getCharts().forEach(function (c) { d.removeChart(c); });
  d.clear();
  const rows = [];      // [A, B, C] values or formulas
  const pct = [];       // A1 cells to format as %
  const bold = [];      // row numbers of headings
  const charts = [];    // {row, n, title}
  const add = function (a, b, c) { rows.push([a, b === undefined ? '' : b, c === undefined ? '' : c]); return rows.length; };
  const heading = function (t) { add('', '', ''); bold.push(add(t, '', '')); };

  bold.push(add('Peakly survey dashboard (updates automatically)', '', ''));
  add('Numbers are formulas over the Responses tab. Percentages of "answers" exclude people who skipped the question.', '', '');
  const nRow = add('Responses (total)', '=COUNTA(' + tsCol_(R) + ')');
  const N = '$B$' + nRow;
  add('Responses in the last 30 days', '=COUNTIF(' + tsCol_(R) + ',">="&(TODAY()-30))');

  heading('Usability: System Usability Scale (SUS, 0-100)');
  const susN = add('Complete SUS responses (n)', '=COUNT(Scores!B2:B)');
  add('Mean SUS', '=IFERROR(AVERAGE(Scores!B2:B),"")');
  add('Median SUS', '=IFERROR(MEDIAN(Scores!B2:B),"")');
  add('Standard deviation', '=IFERROR(STDEV.S(Scores!B2:B),"")');
  add('95% CI (low)', '=IF($B$' + susN + '<2,"",AVERAGE(Scores!B2:B)-T.INV.2T(0.05,$B$' + susN + '-1)*STDEV.S(Scores!B2:B)/SQRT($B$' + susN + '))');
  add('95% CI (high)', '=IF($B$' + susN + '<2,"",AVERAGE(Scores!B2:B)+T.INV.2T(0.05,$B$' + susN + '-1)*STDEV.S(Scores!B2:B)/SQRT($B$' + susN + '))');
  pct.push('B' + add('Share of scores at or above 68 (published average)', '=IFERROR(COUNTIF(Scores!B2:B,">=68")/$B$' + susN + ',"")'));

  heading('Likelihood to recommend (0-10)');
  const ltrN = add('Answers (n)', '=COUNT(Scores!C2:C)');
  add('Mean (0-10)', '=IFERROR(AVERAGE(Scores!C2:C),"")');
  bold.push(add('Group', 'Count', '% of answers'));
  const grpStart = rows.length + 1;
  ['Promoter', 'Passive', 'Detractor'].forEach(function (g) {
    const r = add(g + (g === 'Promoter' ? ' (9-10)' : g === 'Passive' ? ' (7-8)' : ' (0-6)'),
      '=COUNTIF(Scores!D2:D,"' + g + '")', '');
    rows[r - 1][2] = '=IFERROR(B' + r + '/$B$' + ltrN + ',0)';
    pct.push('C' + r);
  });
  charts.push({ row: grpStart - 1, n: 4, title: 'Likelihood to recommend', type: 'pie' });
  add('Net score (% 9-10 minus % 0-6; range -100 to +100)', '=IF($B$' + ltrN + '=0,"",ROUND((C' + grpStart + '-C' + (grpStart + 2) + ')*100,0))');

  heading('Task success');
  const task = byKey.task;
  const tcol = col_(R, task.title);
  const yes = add('Yes, completely', '=SUMPRODUCT(--(' + tcol + '="' + fq_(task.choices[0]) + '"))');
  add('Partly', '=SUMPRODUCT(--(' + tcol + '="' + fq_(task.choices[1]) + '"))');
  add('No', '=SUMPRODUCT(--(' + tcol + '="' + fq_(task.choices[2]) + '"))');
  const tN = add('Attempted a task (n = yes + partly + no; excludes "only exploring")', '=SUM(B' + yes + ':B' + (yes + 2) + ')');
  pct.push('B' + add('Task success rate (yes, completely)', '=IFERROR(B' + yes + '/B' + tN + ',"")'));
  pct.push('B' + add('Fully or partly successful', '=IFERROR((B' + yes + '+B' + (yes + 1) + ')/B' + tN + ',"")'));

  heading('Every question');
  items.forEach(function (q) {
    if (q.type === 'info' || q.type === 'grid') return;
    const c = col_(R, q.title);
    add('', '', '');
    bold.push(add(q.title, '', ''));
    if (q.type === 'mc' || q.type === 'checkbox') {
      const isCb = q.type === 'checkbox';
      const ansRow = add('Answered', '=SUMPRODUCT(--(LEN(' + c + ')>0))');
      pct.push('C' + ansRow);
      rows[ansRow - 1][2] = '=IFERROR(B' + ansRow + '/' + N + ',0)';
      const hdr = add('Answer', 'Count', isCb ? '% of all respondents' : '% of answers');
      bold.push(hdr);
      const first = rows.length + 1;
      q.choices.forEach(function (ch) {
        const f = isCb
          ? '=SUMPRODUCT(--REGEXMATCH(' + c + ',"(^|, )' + fq_(escRe_(ch)) + '(,|$)"))'
          : '=SUMPRODUCT(--(' + c + '="' + fq_(ch) + '"))';
        const r = add(ch, f, '');
        rows[r - 1][2] = '=IFERROR(B' + r + '/' + (isCb ? N : '$B$' + ansRow) + ',0)';
        pct.push('C' + r);
      });
      if (q.other) {
        const alt = q.choices.slice().sort(function (a, b) { return b.length - a.length; }).map(escRe_).join('|');
        const f = isCb
          ? '=SUMPRODUCT(--(LEN(TRIM(SUBSTITUTE(REGEXREPLACE(' + c + ',"' + fq_(alt) + '",""),",","")))>0))'
          : '=B' + ansRow + '-SUM(B' + first + ':B' + (first + q.choices.length - 1) + ')';
        const r = add('Other (write-in; read them in Responses)', f, '');
        rows[r - 1][2] = '=IFERROR(B' + r + '/' + (isCb ? N : '$B$' + ansRow) + ',0)';
        pct.push('C' + r);
      }
      if (q.chart && !q.top) charts.push({ row: hdr, n: q.choices.length + 1, title: q.chart, type: 'bar' });
      if (q.top) { // live ranking, highest first (the chart uses this block)
        add('', '', '');
        const th = add('Ranked: ' + (q.chart || q.title), 'Votes', '');
        bold.push(th);
        if (q.chart) charts.push({ row: th, n: q.choices.length + 1, title: q.chart, type: 'bar' });
        add('=SORT(A' + first + ':B' + (first + q.choices.length - 1) + ',2,FALSE)', '', '');
        for (let k = 1; k < q.choices.length; k++) add('', '', '');
      }
    } else if (q.type === 'scale') {
      const n = add('Answers (n)', '=COUNT(' + c + ')');
      add('Mean', '=IFERROR(AVERAGE(' + c + '),"")');
      add('Median', '=IFERROR(MEDIAN(' + c + '),"")');
      bold.push(add('Value', 'Count', '% of answers'));
      for (let v = q.low; v <= q.high; v++) {
        const r = add(String(v) + (v === q.low ? ' (' + q.lowLabel + ')' : v === q.high ? ' (' + q.highLabel + ')' : ''),
          '=COUNTIF(' + c + ',' + v + ')', '');
        rows[r - 1][2] = '=IFERROR(B' + r + '/$B$' + n + ',0)';
        pct.push('C' + r);
      }
    } else { // paragraph / text
      add('Written answers', '=SUMPRODUCT(--(LEN(' + c + ')>0))', 'Read them on the Comments tab');
    }
  });

  // SUS item means (diagnostic: which statements pull the score down)
  heading('SUS statements: mean agreement (1-5)');
  bold.push(add('Statement', 'Mean', 'Answers'));
  SUS_ROWS.forEach(function (row, i) {
    const c = gridCol_(R, row);
    add((i + 1) + '. ' + row + (i % 2 ? '  (negative: lower is better)' : '  (positive: higher is better)'),
      '=IFERROR(AVERAGE(ARRAYFORMULA(IFERROR(VALUE(LEFT(' + c + ',1)),""))),"")',
      '=SUMPRODUCT(--(LEN(' + c + ')>0))');
  });

  d.getRange(1, 1, rows.length, 3).setValues(rows);   // strings starting with "=" become formulas
  bold.forEach(function (r) { d.getRange(r, 1, 1, 3).setFontWeight('bold'); });
  d.getRange(1, 1).setFontSize(14);
  if (pct.length) d.getRangeList(pct).setNumberFormat('0.0%');
  d.setColumnWidth(1, 520); d.setColumnWidth(2, 110); d.setColumnWidth(3, 150);
  d.getRange(1, 1, rows.length, 1).setWrap(true);

  charts.forEach(function (ch) {
    const b = ch.type === 'pie' ? d.newChart().asPieChart() : d.newChart().asBarChart();
    b.addRange(d.getRange(ch.row, 1, ch.n, 2));
    b.setNumHeaders(1);
    b.setPosition(ch.row, 5, 10, 0);
    b.setOption('title', ch.title);
    if (ch.type !== 'pie') b.setOption('legend', { position: 'none' });
    d.insertChart(b.build());
  });
}

function buildCommentsSheet_(ss, R, items) {
  const s = getOrCreateSheet_(ss, 'Comments');
  s.clear();
  const quote = col_(R, itemByKey_('quote').title);
  let colNum = 1;
  items.filter(function (q) { return q.type === 'paragraph' || q.type === 'text'; }).forEach(function (q) {
    const c = col_(R, q.title);
    s.getRange(1, colNum).setValue(q.title).setFontWeight('bold').setWrap(true);
    s.getRange(2, colNum, 1, 3).setValues([['Submitted', 'May quote?', 'Answer']]).setFontWeight('bold');
    s.getRange(3, colNum).setFormula('=IFERROR(SORT(FILTER({' + tsCol_(R) + ',' + quote + ',' + c + '},LEN(' + c + ')>0),1,FALSE),"No answers yet")');
    s.getRange(3, colNum, 998, 1).setNumberFormat('yyyy-mm-dd');
    s.setColumnWidth(colNum, 95); s.setColumnWidth(colNum + 1, 90); s.setColumnWidth(colNum + 2, 380);
    s.getRange(1, colNum + 2, 1000, 1).setWrap(true);
    colNum += 4;
  });
  s.setFrozenRows(2);
}

// ==========================================================================================
// Invitations (opt-in list only)
// ==========================================================================================
function previewSurveyInvitations() { return runInvitations_(true); }
function sendSurveyInvitations() { return runInvitations_(false); }

function runInvitations_(dryRun) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Another invitation run is in progress; try later.'); return; }
  try {
    const props = PropertiesService.getScriptProperties();
    const survey = FormApp.openById(mustGet_(props, P.SURVEY_ID));
    const unsub = FormApp.openById(mustGet_(props, P.UNSUB_ID));
    if (!survey.isAcceptingResponses()) { Logger.log('The survey is closed (not accepting responses); nothing sent.'); return; }
    const surveyUrl = shorten_(survey);
    const unsubUrl = unsub.getPublishedUrl();
    const mailing = SpreadsheetApp.openById(mustGet_(props, P.MAILING_ID));
    const people = currentSubscribers_(mailing, props);
    const inv = loadInvitations_(mailing);
    const now = new Date();
    const minGapMs = CONFIG.MIN_DAYS_BETWEEN_INVITES * 864e5;

    // Record unsubscribes in the log too, so the Invitations tab is a complete picture.
    Object.keys(people).forEach(function (email) {
      const p = people[email];
      const rec = inv.map[email] || (inv.map[email] = { email: email, invited_at: '', invite_count: 0, last_survey_url: '' });
      rec.status = p.subscribed ? 'subscribed' : 'unsubscribed';
      rec.opted_in_at = p.optedIn || '';
      rec.unsubscribed_at = p.unsub || '';
    });

    const due = Object.keys(people).filter(function (email) {
      const rec = inv.map[email];
      if (!people[email].subscribed || !isEmail_(email)) return false;
      return !rec.invited_at || (now - new Date(rec.invited_at)) >= minGapMs;
    }).sort(function (a, b) { return people[a].optedIn - people[b].optedIn; });

    let budget = Math.min(CONFIG.MAX_INVITES_PER_RUN, MailApp.getRemainingDailyQuota() - CONFIG.QUOTA_RESERVE);
    if (dryRun) {
      Logger.log('DRY RUN. Would invite ' + Math.min(due.length, Math.max(budget, 0)) + ' of ' + due.length + ' due address(es) today:');
      due.forEach(function (e) { Logger.log('  ' + e); });
      return;
    }
    let sent = 0;
    for (let i = 0; i < due.length && sent < budget; i++) {
      const email = due[i];
      try {
        MailApp.sendEmail({
          to: email,
          subject: 'Peakly feedback survey (about 5 minutes, optional)',
          name: CONFIG.SENDER_NAME,
          replyTo: CONFIG.CONTACT_EMAIL,
          body: invitationText_(surveyUrl, unsubUrl)
        });
        const rec = inv.map[email];
        rec.invited_at = new Date();
        rec.invite_count = (Number(rec.invite_count) || 0) + 1;
        rec.last_survey_url = surveyUrl;
        sent++;
      } catch (e) {
        Logger.log('Could not email ' + email + ': ' + e);
        if (/too many times|quota/i.test(String(e))) break;
      }
    }
    saveInvitations_(mailing, inv);
    Logger.log('Invitations sent: ' + sent + '. Still due: ' + (due.length - sent) +
      (due.length > sent ? ' (they will be sent on the next run; daily email quota)' : '') + '.');
  } finally {
    lock.releaseLock();
  }
}

function invitationText_(surveyUrl, unsubUrl) {
  return [
    'Hello,',
    '',
    'You signed up to hear about Peakly feedback surveys, so here is the current one:',
    surveyUrl,
    '',
    'It takes about 5 minutes, every question except consent is optional, and it is anonymous:',
    'your answers are not linked to this email address.',
    '',
    'Thank you for helping keep Peakly free and useful.',
    CONFIG.MAINTAINER + ', Peakly maintainer',
    CONFIG.REPO_URL,
    '',
    '---',
    'You receive at most one invitation every ' + Math.round(CONFIG.MIN_DAYS_BETWEEN_INVITES / 30) + ' months.',
    'Unsubscribe: reply "unsubscribe" to ' + CONFIG.CONTACT_EMAIL + ' or use the form ' + unsubUrl,
    'If you did not sign up, use the unsubscribe link and you will not hear from us again.',
    'Privacy policy: ' + CONFIG.PRIVACY_URL
  ].join('\n');
}

/** email -> {optedIn: Date, unsub: Date|null, subscribed: bool}. Latest action wins. */
function currentSubscribers_(mailing, props) {
  const list = existingSheetById_(mailing, props.getProperty(P.LIST_SHEET)) || mailing.getSheetByName('Mailing list');
  const uns = existingSheetById_(mailing, props.getProperty(P.UNSUB_SHEET)) || mailing.getSheetByName('Unsubscribe');
  const out = {};
  readByHeader_(list, [SIGNUP_EMAIL_TITLE, SIGNUP_CONSENT_TITLE]).forEach(function (r) {
    const email = normEmail_(r[SIGNUP_EMAIL_TITLE]);
    if (!email || !String(r[SIGNUP_CONSENT_TITLE] || '').trim()) return;   // no consent, no email
    const t = new Date(r._ts);
    if (!out[email] || t > out[email].optedIn) out[email] = { optedIn: t, unsub: null };
  });
  readByHeader_(uns, [UNSUB_EMAIL_TITLE]).forEach(function (r) {
    const email = normEmail_(r[UNSUB_EMAIL_TITLE]);
    if (!email) return;
    const t = new Date(r._ts || 0);
    if (!out[email]) out[email] = { optedIn: null, unsub: t };
    else if (!out[email].unsub || t > out[email].unsub) out[email].unsub = t;
  });
  Object.keys(out).forEach(function (e) {
    const p = out[e];
    p.subscribed = !!p.optedIn && (!p.unsub || p.unsub < p.optedIn);
  });
  return out;
}

function readByHeader_(sheet, titles) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const head = data[0].map(String);
  const idx = {};
  titles.forEach(function (t) { idx[t] = head.indexOf(t); });
  return data.slice(1).map(function (row) {
    const o = { _ts: row[0] };
    titles.forEach(function (t) { o[t] = idx[t] >= 0 ? row[idx[t]] : ''; });
    return o;
  });
}

const INV_HEADER = ['email', 'status', 'opted_in_at', 'unsubscribed_at', 'invited_at', 'invite_count', 'last_survey_url'];

function ensureInvitationHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, INV_HEADER.length).setValues([INV_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function loadInvitations_(mailing) {
  const sheet = getOrCreateSheet_(mailing, 'Invitations');
  ensureInvitationHeader_(sheet);
  const map = {};
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, INV_HEADER.length).getValues().forEach(function (r) {
      const o = {};
      INV_HEADER.forEach(function (h, i) { o[h] = r[i]; });
      if (o.email) map[normEmail_(o.email)] = o;
    });
  }
  return { sheet: sheet, map: map };
}

function saveInvitations_(mailing, inv) {
  const sheet = inv.sheet;
  const keys = Object.keys(inv.map).sort();
  if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, INV_HEADER.length).clearContent();
  if (!keys.length) return;
  const rows = keys.map(function (k) { return INV_HEADER.map(function (h) { return inv.map[k][h] === undefined ? '' : inv.map[k][h]; }); });
  sheet.getRange(2, 1, rows.length, INV_HEADER.length).setValues(rows);
}

function installInvitationTrigger() {
  removeInvitationTrigger();
  ScriptApp.newTrigger('sendSurveyInvitations').timeBased().onMonthDay(1).atHour(9).create();
  Logger.log('sendSurveyInvitations will run on the 1st of every month (about 9:00, script time zone). ' +
    'Each person is still invited at most once every ' + CONFIG.MIN_DAYS_BETWEEN_INVITES + ' days.');
}

function removeInvitationTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendSurveyInvitations') ScriptApp.deleteTrigger(t);
  });
}

// ==========================================================================================
// Privacy helpers
// ==========================================================================================
/** Deletes addresses whose last invitation (or sign-up, if never invited) is older than RETENTION_MONTHS,
 *  and everyone who unsubscribed (their unsubscribe row is kept only until this runs). */
function purgeExpiredEmails() {
  const props = PropertiesService.getScriptProperties();
  const mailing = SpreadsheetApp.openById(mustGet_(props, P.MAILING_ID));
  const people = currentSubscribers_(mailing, props);
  const inv = loadInvitations_(mailing);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - CONFIG.RETENTION_MONTHS);
  const toForget = Object.keys(people).filter(function (e) {
    const p = people[e];
    if (!p.subscribed) return true;
    const rec = inv.map[e];
    const last = rec && rec.invited_at ? new Date(rec.invited_at) : p.optedIn;
    return last < cutoff;
  });
  toForget.forEach(function (e) { forgetEmailAddress_(e, mailing, props); });
  Logger.log('Purged ' + toForget.length + ' address(es).');
}

function forgetEmail() {
  if (!EMAIL_TO_FORGET) throw new Error('Type the address into EMAIL_TO_FORGET at the top of the script, save, and run again.');
  const props = PropertiesService.getScriptProperties();
  const mailing = SpreadsheetApp.openById(mustGet_(props, P.MAILING_ID));
  const n = forgetEmailAddress_(normEmail_(EMAIL_TO_FORGET), mailing, props);
  Logger.log('Removed ' + n + ' row(s)/response(s). Now clear EMAIL_TO_FORGET in the script and save.');
}

function forgetEmailAddress_(email, mailing, props) {
  let removed = 0;
  // Sheet rows (bottom-up so row numbers stay valid)
  [['Mailing list', SIGNUP_EMAIL_TITLE], ['Unsubscribe', UNSUB_EMAIL_TITLE], ['Invitations', 'email']].forEach(function (pair) {
    const sh = mailing.getSheetByName(pair[0]);
    if (!sh || sh.getLastRow() < 2) return;
    const data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    const c = data[0].map(String).indexOf(pair[1]);
    if (c < 0) return;
    for (let r = data.length - 1; r >= 1; r--) {
      if (normEmail_(data[r][c]) === email) { sh.deleteRow(r + 1); removed++; }
    }
  });
  // Copies Google Forms keeps inside each form
  [[P.SIGNUP_ID, SIGNUP_EMAIL_TITLE], [P.UNSUB_ID, UNSUB_EMAIL_TITLE]].forEach(function (pair) {
    const id = props.getProperty(pair[0]);
    if (!id) return;
    const form = FormApp.openById(id);
    form.getResponses().forEach(function (resp) {
      const hit = resp.getItemResponses().some(function (ir) {
        return ir.getItem().getTitle() === pair[1] && normEmail_(ir.getResponse()) === email;
      });
      if (hit) { form.deleteResponse(resp.getId()); removed++; }
    });
  });
  return removed;
}

// ==========================================================================================
// Misc
// ==========================================================================================
/** Excel: in the spreadsheet use File -> Download -> Microsoft Excel (.xlsx). This logs a direct link
 *  (works while you are signed in to the owning Google account). Formulas come along; charts mostly do. */
function exportToExcel() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('Results (.xlsx): ' + xlsxUrl_(mustGet_(props, P.RESULTS_ID)));
  Logger.log('Mailing list (.xlsx, private): ' + xlsxUrl_(mustGet_(props, P.MAILING_ID)));
}

/** OPTIONAL. Only if the survey link asks respondents to sign in. Requires: Services (+) -> Drive API -> Add.
 *  Grants "anyone with the link" responder access to the three forms (Forms API publishing guide). */
function allowAnyoneToRespond() {
  if (typeof Drive === 'undefined') {
    throw new Error('Add the Drive API advanced service first (left sidebar: Services + -> Drive API -> Add), or set it by hand: open the form -> Publish -> Responders -> Anyone with the link.');
  }
  const props = PropertiesService.getScriptProperties();
  [P.SURVEY_ID, P.SIGNUP_ID, P.UNSUB_ID].forEach(function (k) {
    const id = mustGet_(props, k);
    Drive.Permissions.create({ type: 'anyone', view: 'published', role: 'reader' }, id);
    Logger.log('Anyone with the link can respond: ' + FormApp.openById(id).getPublishedUrl());
  });
}

function resetPeaklySurvey() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(P).forEach(function (k) { props.deleteProperty(P[k]); });
  Logger.log('Stored IDs forgotten. Existing forms and sheets were NOT deleted (remove them in Google Drive if you want). Running setupPeaklySurvey now creates new ones.');
}

function allItems_() {
  return SURVEY_PAGES.reduce(function (acc, p) { return acc.concat(p.items); }, []);
}
function itemByKey_(k) {
  const q = allItems_().filter(function (x) { return x.key === k; })[0];
  if (!q) throw new Error('No question with key ' + k);
  return q;
}
function mustGet_(props, key) {
  const v = props.getProperty(key);
  if (!v) throw new Error('Missing ' + key + '. Run setupPeaklySurvey first.');
  return v;
}
function quoteSheet_(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
function fq_(s) { return String(s).replace(/"/g, '""'); }                  // escape for a formula string
function escWild_(s) { return String(s).replace(/[~*?]/g, '~$&'); }         // MATCH/COUNTIF wildcards
function escRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } // RE2 (REGEXMATCH)
function normEmail_(s) { return String(s || '').trim().toLowerCase(); }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
