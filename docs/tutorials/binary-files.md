# Tutorial: binary and open-standard files

Peakly reads three binary/structured formats directly, without vendor software.

## Agilent ChemStation `.ch`

**Sample:** [`samples/data/agilent-ch.ch`](../../samples/data/agilent-ch.ch)

1. In an Agilent `.D` data folder, find the signal files, typically named like `DAD1A.ch`, `VWD1A.ch` or `FID1A.ch` (one per detector signal).
2. Drag the `.ch` file into Peakly (you cannot drop a whole `.D` folder; pick the file).
3. Peakly reads the header (sample name, signal description, units) and the data. File types 130/131 (delta-encoded) and 179/181 are supported.

**Not supported:** `.uv` files (full DAD spectra), `.ms` files. Export a single wavelength as a signal or to text instead.

## AnDI / netCDF (`.cdf`)

**Sample:** [`samples/data/netcdf.cdf`](../../samples/data/netcdf.cdf)

AnDI (ASTM E1947) is an open chromatography interchange format that many systems can export (look for "AIA", "AnDI" or "netCDF" export, typically in the data export or file conversion options).

1. Export the run as `.cdf`.
2. Drag it into Peakly.
3. Peakly reads `ordered_derivative_values`, the sampling interval, run length and detector unit, and metadata such as sample name.

**Not supported:** netCDF-4/HDF5 files (these start with `‰HDF`). Re-export as classic netCDF-3 if your software offers it.

## mzML

**Sample:** [`samples/data/mzml.mzML`](../../samples/data/mzml.mzML)

mzML is the open mass-spectrometry standard; ProteoWizard's msConvert and most MS software can write it.

1. Export or convert to mzML **with chromatograms included** (TIC, BPC, or UV/PDA channels in the `<chromatogramList>`).
2. Drag it into Peakly. Each chromatogram becomes a trace; zlib-compressed 32/64-bit arrays are decoded.

**Not supported:** MS-Numpress compression and extracting chromatograms from spectra (XICs). Convert without Numpress and include chromatograms.

## Unsupported binaries

Files such as Thermo `.raw`, Shimadzu `.lcd` and Waters raw folders get a clear message explaining how to export them instead. Try [`samples/data/unsupported.raw`](../../samples/data/unsupported.raw) to see it. Want direct support? See the [format request form](https://github.com/jschmitt1531/peakly/issues/new?template=format_request.yml) and [ROADMAP.md](../../ROADMAP.md).
