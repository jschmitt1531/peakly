# Supporting Peakly

Peakly is free and will stay free. **No feature of the app will ever be paywalled.** Hosting is free too: the app and website are static files served by GitHub Pages, and all analysis runs in the user's own browser, so there are no server costs to cover.

What the project actually needs is not money for infrastructure but **time, data and recognition**.

## What the project needs

1. **Maintainer time.** Reviewing contributions, answering questions, fixing bugs, and keeping up with browser and library changes. This is the scarcest resource.
2. **Validation datasets.** Chromatograms paired with the peak tables a validated chromatography data system produced for them (RT, area, height, tailing, plates, resolution). These let us test Peakly's math against references beyond synthetic data. Synthetic and non-confidential data are perfect.
3. **Vendor format samples.** Small example files from instruments and software versions we do not yet read, shared with permission. One file per software version is a big help.
4. **Digitizing test images.** Screenshots, scans and phone photos of chromatograms *with the original data*, so the digitizer can be benchmarked on real images (see [docs/DIGITIZER_ACCURACY.md](docs/DIGITIZER_ACCURACY.md)).
5. **Teaching feedback.** If you use Peakly in a course, tell us what worked and what confused students.
6. **Accessibility and translation help.**

## How institutions can help

- **Give staff time.** Allowing a scientist or developer a few hours a month to contribute (parsers, validation, docs) is the most valuable support possible.
- **Share reference data** under an open license (CC0 or CC-BY), or run Peakly side by side with your CDS on non-confidential samples and report the differences.
- **Write a letter of support** for grant applications that fund open research software. A template is in [docs/templates/letter-of-support.md](docs/templates/letter-of-support.md).
- **Cite Peakly** in papers, theses and teaching materials ([CITATION.cff](CITATION.cff)). Citations are how research software justifies its existence to funders.
- **Tell us** in [Discussions](https://github.com/jschmitt1531/peakly/discussions) that you use it. Usage stories matter in grant applications.
- **Include Peakly in grant proposals** as a budget line for maintenance or features you need (for example a vendor format your lab depends on). Contributions funded this way are welcome as long as they are MIT-licensed and follow the [core principles](GOVERNANCE.md#core-principles-not-up-for-a-vote).

## Money

The project does not accept donations yet. If it does in future, it will be through a transparent fiscal host (for example Open Collective or a fiscal sponsor such as NumFOCUS), with public accounts. Funding will pay for maintainer time, validation work and accessibility audits. It will never buy features locked away from other users, and funders do not get control over the roadmap's core principles. See [GOVERNANCE.md](GOVERNANCE.md#money-and-services).

An optional, separately hosted services layer (for example cloud save for teams) could one day help sustain the project. If it exists, it will be clearly separate from the free core, which will keep working fully offline with no account. See [docs/SERVICES.md](docs/SERVICES.md).
