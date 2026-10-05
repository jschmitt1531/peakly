/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
// Regenerates docs/schemas/*.json from PK.schema.describe() (the single source of truth): node tools/gen-schemas.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
globalThis.PK = {};
for (const f of ['src/config.js', 'src/core.js', 'src/schema.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const BASE = 'https://jschmitt1531.github.io/peakly/schemas/'; // replaced with the real Pages URL when the repo exists
const d = PK.schema.describe(), V = PK.schema.PROJECT_VERSION;
const strip = s => { const o = JSON.parse(JSON.stringify(s)); delete o.$schema; delete o.$id; return o; };
const doc = (file, title, description, body) => Object.assign({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: BASE + file, title, description }, body);
const out = {
  'project.v2.schema.json': Object.assign({}, d.project, { $id: BASE + 'project.v2.schema.json' }),
  'peaks.schema.json': doc('peaks.schema.json', 'Peakly peak table', `Peak table export, schema version ${V}. JSON: an array of peak rows or an object with a "peaks" array. CSV: one column per property, in PK.schema.PEAK_COLUMNS order, after "# " comment lines.`,
    { $defs: { peakRow: strip(d.peakRow) }, oneOf: [{ type: 'array', items: { $ref: '#/$defs/peakRow' } }, { type: 'object', required: ['peaks'], properties: { schema: { type: 'object' }, peaks: { type: 'array', items: { $ref: '#/$defs/peakRow' } } } }] }),
  'traces.schema.json': doc('traces.schema.json', 'Peakly traces export', `Traces export, schema version ${V}: trace summary rows plus long-format data rows (CSV) or per-trace arrays (JSON).`,
    { $defs: { traceRow: strip(d.traceRow), dataRow: strip(d.dataRow) }, type: 'object', properties: { schema: { type: 'object' }, traces: { type: 'array' }, traceRows: { type: 'array', items: { $ref: '#/$defs/traceRow' } }, rows: { type: 'array', items: { $ref: '#/$defs/dataRow' } } } }),
  'calibration.schema.json': doc('calibration.schema.json', 'Peakly calibration export', `Calibration levels export, schema version ${V}.`,
    { $defs: { calibrationRow: strip(d.calibrationRow) }, type: 'array', items: { $ref: '#/$defs/calibrationRow' } })
};
for (const [f, s] of Object.entries(out)) { fs.writeFileSync(path.join(root, 'docs/schemas', f), JSON.stringify(s, null, 2) + '\n'); console.log('docs/schemas/' + f); }
