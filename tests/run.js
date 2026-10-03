// Node test runner: node tests/run.js [filter]
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const order = ['core', 'testkit', 'parsers', 'analysis', 'digitizer'];
globalThis.PK = {};
for (const m of order) { const f = path.join(root, 'src', m + '.js'); if (fs.existsSync(f)) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f }); }
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), { filename: f });
PK.runTests(process.argv[2]).then(rs => {
  let fail = 0;
  for (const r of rs) { if (!r.pass) fail++; console.log((r.pass ? '  ok  ' : ' FAIL ') + r.name + ` (${r.assertions} assertions, ${r.ms}ms)`); r.fails.forEach(f => console.log('        - ' + f)); }
  console.log(`\n${rs.length - fail}/${rs.length} tests passed`); process.exit(fail ? 1 : 0);
});
