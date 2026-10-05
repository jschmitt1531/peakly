# Releasing Peakly

Releases are cut from `main` by a maintainer (see [GOVERNANCE.md](../GOVERNANCE.md#releases)). Every release is a git tag, a GitHub release with the single-file app attached, and a Zenodo archive with a DOI.

## Versioning (SemVer)

Peakly follows [Semantic Versioning 2.0.0](https://semver.org/). For Peakly, the "public API" is:

1. the **project file format** and its migration (`PK.schema`, [SCHEMA.md](SCHEMA.md)),
2. the **export schemas** (peak table, trace data column keys and meanings),
3. the **parser plugin interface** (`PK.parsers.register`), and
4. the **numbers**: what a documented formula computes for the same input and settings.

| Bump | When | Examples |
|---|---|---|
| **MAJOR** (x.0.0) | A saved project can no longer be opened, an export column is removed or changes meaning, the plugin interface breaks, or a default calculation changes results for existing projects without migration | Removing `area_pct`; changing area units in exports |
| **MINOR** (1.x.0) | New features, formats, columns (appended), clip modes; new project format version **with automatic migration**; changed defaults that apply only to new work | 1.1.0: clip modes, calibration, project v2 |
| **PATCH** (1.1.x) | Bug fixes, docs, performance, parser robustness, no change to documented formulas except to fix a bug | Fixing a JCAMP edge case |

A bug fix that changes numerical results is still a PATCH, but it must be called out under **Fixed** in the changelog with the size of the change, so users can judge whether to re-run analyses.

## Checklist

1. **Changelog.** Move entries from `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) into a new `## [X.Y.Z] - YYYY-MM-DD` section; update the compare links at the bottom.
2. **Version numbers** — all must match:
   - `src/config.js` → `version` and `citation.version`
   - `package.json` → `version`
   - `CITATION.cff` → `version` and `date-released`
   - `.zenodo.json` → `version`
3. **Build and test** on a clean checkout:
   ```sh
   node tests/run.js && node build.js && node tools/validate.js
   node tools/digitizer-accuracy.js   # if the digitizer or analysis changed; commit the updated report
   git status                          # index.html must be committed and unchanged after build
   ```
4. **Smoke test** the built `index.html` in Chrome, Firefox and Safari (or Edge): load the sample data, detect peaks, open the digitizer sample, export a PDF, run Help → Run self-tests.
5. **Release PR.** Open a pull request titled `Release vX.Y.Z` with the above. Once approved and merged:
6. **Tag** the merge commit:
   ```sh
   git tag -a vX.Y.Z -m "Peakly vX.Y.Z"
   git push origin vX.Y.Z
   ```
7. **GitHub release.** Create a release from the tag (title `Peakly vX.Y.Z`), paste the changelog section, and attach `index.html` renamed to `peakly-X.Y.Z.html` so users can download an exact version.
8. **Zenodo DOI** (automatic once set up, below). Publishing the GitHub release triggers Zenodo to archive the tagged source and mint a **version DOI**. Check the Zenodo record: title, creators, license, version.
9. **Record the DOI.** In a follow-up PR:
   - `CITATION.cff` → add `doi:` (use the **concept DOI**, which always resolves to the latest version, or the version DOI if you prefer exact citation; see below)
   - `src/config.js` → `citation.doi`
   - README DOI badge (replace the "pending" badge with the Zenodo badge)
   - rebuild `index.html`
10. **Pages** deploys automatically from `main` (`.github/workflows/pages.yml`). Confirm the website and `app/` show the new version (Help → About).
11. **Announce** in Discussions.

## One-time setup

- **GitHub Pages:** repository *Settings → Pages → Build and deployment → Source: GitHub Actions*.
- **Zenodo:** sign in to [zenodo.org](https://zenodo.org) with GitHub, open *Account → GitHub*, and switch the repository **on**. From then on, every *published* GitHub release (not drafts, not plain tags) is archived. Zenodo reads metadata from `.zenodo.json` if present (it takes precedence over `CITATION.cff`), so keep both in sync. Check the first record's preview carefully. `.zenodo.json` has no license field because Peakly is not open source: in the Zenodo form choose a non-open license (for example "Other (Not Open)") and link the repository LICENSE. Adjust `.zenodo.json` if Zenodo rejects or ignores a field.
- **Concept vs version DOI:** Zenodo creates a *concept DOI* for the project (all versions) and a *version DOI* per release. Put the concept DOI in the README badge; ask users to cite the version DOI of the release they used.
- **Private vulnerability reporting:** *Settings → Code security → Private vulnerability reporting → Enable* (referenced by [SECURITY.md](../SECURITY.md)).
- **Discussions:** *Settings → General → Features → Discussions* (referenced by the issue template config).

## Hotfixes

For an urgent fix to a released version, branch from the tag (`git checkout -b hotfix/X.Y.Z+1 vX.Y.Z`), fix, bump PATCH, and follow the checklist. Merge the fix back into `main`.
