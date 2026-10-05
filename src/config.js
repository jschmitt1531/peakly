/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly configuration: author/About text, project links, optional services (all OFF by default).
   Edit this block to change what the About panel says. */
(function (PK) {
  'use strict';
  PK.config = {
    appName: 'Peakly',
    version: '1.2.0',
    author: {
      name: 'Jennifer Schmitt, Ph.D.',
      headline: 'Analytical Sciences leader · Ph.D. in Chemistry · MBA, Johns Hopkins Carey Business School',
      bio: [
        'Analytical scientist who has spent a career turning chromatograms into decisions, from graduate research to biotech to analytical sciences leadership in the pharmaceutical industry.',
        'Long-time volunteer with the American Chemical Society Younger Chemists Committee and an associate of the ACS Women Chemists Committee.',
        'Peakly exists because getting HPLC data out of vendor software should not require a license, a login, or a workaround.'
      ],
      linkedin: 'https://www.linkedin.com/in/jschmitt1531/'
    },
    // Set these once the public repository exists (used by About → Cite / Tell us how you used it).
    repoUrl: 'https://github.com/jschmitt1531/peakly',
    discussionsUrl: 'https://github.com/jschmitt1531/peakly/discussions',
    // Public project contact (dedicated Peakly account, not a personal address). Git commits keep using the
    // author's GitHub noreply address so they link to the GitHub profile.
    contactEmail: 'peaklyfeedback@gmail.com',
    contactUrl: 'https://github.com/jschmitt1531/peakly/issues/new/choose',
    // Feedback survey (Google Forms, created by tools/survey/create-survey.gs). Opened only when the user clicks;
    // the app never sends anything itself. Leave '' to hide survey links/prompts.
    survey: {
      url: 'https://forms.gle/Cqr15LVq2gkGEDhP8',        // public survey link (Google Form "Send → link")
      signupUrl: 'https://forms.gle/jeoMRAKqtvpzbnBV9',  // optional short form: "email me future surveys" (opt-in list)
      promptAfter: ['calibration', 'fit', 'digitize', 'compare', 'split'],  // complex features that may show the optional prompt
      maxPrompts: 2,  // per browser, ever; never more than once per session
      minMinutesBetween: 1440
    },
    license: 'Peakly Free-Use License 1.0 (free to use; all other rights reserved)',
    disclaimer: 'For research and education use. Not validated for regulated (GMP/GLP) workflows. Digitized data is approximate.',
    citation: {
      title: 'Peakly: a free, single-file, in-browser HPLC/FPLC chromatogram analyzer',
      authors: ['Schmitt, Jennifer'],
      year: 2026,
      version: '1.2.0',
      doi: '' // filled in after the first Zenodo release
    },
    // Optional extras are built as a separate layer (see src/services.js, docs/SERVICES.md). Core never needs them.
    services: { cloudSave: false, teamSharing: false, accounts: false }
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
