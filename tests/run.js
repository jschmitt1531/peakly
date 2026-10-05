/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
// Node test runner: node tests/run.js [filter]
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const order = ['config', 'core', 'services', 'testkit', 'schema', 'parsers', 'analysis', 'digitizer'];
// Parser layer: registry first, then every src/parsers/*.js plugin (alphabetical; "_"-prefixed templates are skipped).
const pdir = path.join(root, 'src', 'parsers');
const parserFiles = fs.existsSync(pdir) ? ['registry.js'].concat(fs.readdirSync(pdir).filter(f => f.endsWith('.js') && f !== 'registry.js' && !f.startsWith('_')).sort()).map(f => path.join(pdir, f)) : [];
const srcFiles = [].concat(...order.map(m => m === 'parsers' ? parserFiles : [path.join(root, 'src', m + '.js')]));
globalThis.PK = {};
for (const f of srcFiles) if (fs.existsSync(f)) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
const tdirs = [__dirname, path.join(__dirname, 'parsers')].filter(d => fs.existsSync(d));
for (const d of tdirs) for (const f of fs.readdirSync(d).filter(f => f.endsWith('.test.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(d, f), 'utf8'), { filename: path.join(d, f) });
PK.runTests(process.argv[2]).then(rs => {
  let fail = 0;
  for (const r of rs) { if (!r.pass) fail++; console.log((r.pass ? '  ok  ' : ' FAIL ') + r.name + ` (${r.assertions} assertions, ${r.ms}ms)`); r.fails.forEach(f => console.log('        - ' + f)); }
  console.log(`\n${rs.length - fail}/${rs.length} tests passed`); process.exit(fail ? 1 : 0);
});
