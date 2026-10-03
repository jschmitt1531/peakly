// Inlines src/*.js, src/parsers/*.js, tests/*.test.js, tests/parsers/*.test.js and shell.html into a single index.html: node build.js
const fs = require('fs'), path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const exists = p => fs.existsSync(path.join(__dirname, p));
const listJs = (dir, suffix, skipUnderscore) => exists(dir) ? fs.readdirSync(path.join(__dirname, dir))
  .filter(f => f.endsWith(suffix) && !(skipUnderscore && f.startsWith('_'))).sort().map(f => dir + '/' + f) : [];
// Parser layer: registry first, then one plugin per format (alphabetical; "_"-prefixed templates are skipped).
const parserFiles = ['src/parsers/registry.js'].concat(listJs('src/parsers', '.js', true).filter(f => !/\/registry\.js$/.test(f)));
const mods = ['config', 'core', 'services', 'testkit', 'schema', 'parsers', 'analysis', 'digitizer', 'app'];
const srcFiles = [].concat(...mods.map(m => m === 'parsers' ? parserFiles : ['src/' + m + '.js'])).filter(f => {
  if (exists(f)) return true; console.warn('build: skipping missing ' + f); return false;
});
const js = srcFiles.map(f => `/* ==== ${f} ==== */\n` + R(f)).join('\n');
const testFiles = listJs('tests', '.test.js').concat(listJs('tests/parsers', '.test.js'));
const tests = testFiles.map(f => `/* ==== ${f} ==== */\n` + R(f)).join('\n');
const guard = s => { if (/<\/script/i.test(s)) throw new Error('literal </script> in source'); return s; };
let html = R('src/shell.html');
html = html.replace('<!--PK:SCRIPTS-->', () => `<script>\n${guard(js)}\n</script>\n<script>\n${guard(tests)}\n</script>`);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('index.html written:', (html.length / 1024).toFixed(1), 'KB');
