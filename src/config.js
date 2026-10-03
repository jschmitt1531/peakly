/* SPDX-License-Identifier: MIT */
/* Peakly configuration: author/About text, project links, optional services (all OFF by default).
   Edit this block to change what the About panel says. */
(function (PK) {
  'use strict';
  PK.config = {
    appName: 'Peakly',
    version: '1.1.0',
    author: {
      name: 'Jennifer Schmitt, Ph.D.',
      headline: 'Analytical Sciences leader · Ph.D. in Chemistry · MBA, Johns Hopkins Carey Business School',
      bio: [
        'Analytical scientist who has spent a career turning chromatograms into decisions, from graduate research in inorganic and bioinorganic chemistry to analytical sciences leadership in the pharmaceutical industry.',
        'Long-time volunteer with the American Chemical Society Younger Chemists Committee and an associate of the ACS Women Chemists Committee.',
        'Peakly exists because getting HPLC data out of vendor software should not require a license, a login, or a workaround.'
      ],
      linkedin: 'https://www.linkedin.com/in/jschmitt1531/'
    },
    // Set these once the public repository exists (used by About → Cite / Tell us how you used it).
    repoUrl: 'https://github.com/jschmitt1531/peakly',
    discussionsUrl: 'https://github.com/jschmitt1531/peakly/discussions',
    license: 'MIT',
    disclaimer: 'For research and education use. Not validated for regulated (GMP/GLP) workflows. Digitized data is approximate.',
    citation: {
      title: 'Peakly: a free, single-file, in-browser HPLC/FPLC chromatogram analyzer',
      authors: ['Schmitt, Jennifer'],
      year: 2026,
      version: '1.1.0',
      doi: '' // filled in after the first Zenodo release
    },
    // Optional extras are built as a separate layer (see src/services.js, docs/SERVICES.md). Core never needs them.
    services: { cloudSave: false, teamSharing: false, accounts: false }
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
