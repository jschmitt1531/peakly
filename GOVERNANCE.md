# Governance

Peakly is a small, source-available project (free to use; all other rights reserved). This document says who decides what, and how that will change as the project grows. It is deliberately simple and will be revised as needed (changes to this file follow the decision process below).

## Today: founder-led (BDFL)

Peakly was created by **Jennifer Schmitt, Ph.D.**, who is currently the sole maintainer and has final say on technical direction, releases and community matters ("benevolent dictator for life", BDFL, in open-source shorthand, though the goal below is to make that role temporary).

Even now, decisions are made in the open:
- Proposals and bugs are discussed in GitHub issues and Discussions.
- Significant changes (new file formats, new calculations, changes to the project file schema, new runtime libraries, anything touching privacy or network access) start as an issue and get at least 7 days for comment before merging.
- Reasons for decisions are written down in the issue or pull request.

## Core principles (not up for a vote)

These keep Peakly trustworthy. Changing them requires the unanimous agreement of all maintainers *and* a 30-day public comment period.

1. **Free to use**: no fee to use Peakly and no paywalled features, ever; the source code stays public for review and citation (see [LICENSE](LICENSE)). Optional hosted services may exist as a separate layer, but everything in the core app stays free.
2. **Private by default**: no telemetry, no tracking, no data leaves the browser unless the user explicitly sends it.
3. **Transparent math**: every reported number has a documented formula and visible inputs.
4. **Single file**: the core app keeps working as one HTML file that can be emailed or used offline (with locally served libraries).

## Path to a maintainer council

When there are **at least three active maintainers** (see below), governance moves from the founder to a **maintainer council**:

- The council is all active maintainers. Jennifer Schmitt remains a council member and project lead, with a tie-breaking vote but no veto beyond it.
- **Lazy consensus** for everyday work: a pull request approved by one maintainer (other than the author) with no outstanding objections may be merged.
- **Significant changes** (as listed above) need approval from two maintainers and no sustained objection after 7 days.
- If consensus fails, the council votes; a simple majority of active maintainers decides, and the project lead breaks ties.
- Governance changes need a two-thirds majority of the council and 14 days of public notice.

## Becoming a maintainer

Maintainers have merge rights and share responsibility for reviews, releases and community health. Anyone can become one through sustained, high-quality contribution, which may be code, review, documentation, validation data, or community support.

- **Nomination:** any maintainer can nominate a contributor (self-nomination is fine) in a private maintainer discussion, citing their contributions.
- **Approval:** while founder-led, Jennifer Schmitt decides after consulting existing contributors. Under the council, a two-thirds majority of active maintainers approves.
- New maintainers are announced publicly and added to the maintainer list below.

## Stepping down and removal

- Maintainers can step down at any time and become **emeritus** maintainers, with thanks. They can return by asking.
- A maintainer who has been inactive for 12 months is moved to emeritus after a friendly check-in.
- A maintainer can be removed for serious or repeated violations of the [Code of Conduct](CODE_OF_CONDUCT.md) or the core principles, by a two-thirds vote of the other maintainers (or, while founder-led, by the founder after a documented review).

## Releases

- Releases follow [Semantic Versioning](https://semver.org/) and the process in [docs/RELEASING.md](docs/RELEASING.md).
- While founder-led, Jennifer Schmitt cuts releases. Under the council, any maintainer can cut a release once another maintainer has approved the release pull request (changelog, version bump, CITATION.cff).
- Every release is archived on Zenodo with a DOI so published work can cite the exact version used.

## Money and services

The project does not currently accept money. If it does in the future (grants, sponsorship), funds will be held transparently through a fiscal host, spending will be decided by the maintainers in public, and no funder gets control over the core principles. See [FUNDING.md](FUNDING.md).

## Maintainers

| Name | Role | Since |
|---|---|---|
| Jennifer Schmitt, Ph.D. ([LinkedIn](https://www.linkedin.com/in/jschmitt1531/)) | Founder, project lead | 2026 |

Emeritus maintainers: none yet.
