// Inlines src/*.js, tests/*.test.js and shell.html into a single index.html: node build.js
const fs = require('fs'), path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const mods = ['core', 'testkit', 'parsers', 'analysis', 'digitizer', 'app'];
const js = mods.map(m => `/* ==== src/${m}.js ==== */\n` + R(`src/${m}.js`)).join('\n');
const tests = fs.readdirSync(path.join(__dirname, 'tests')).filter(f => f.endsWith('.test.js')).sort()
  .map(f => `/* ==== tests/${f} ==== */\n` + R('tests/' + f)).join('\n');
const guard = s => { if (/<\/script/i.test(s)) throw new Error('literal </script> in source'); return s; };
let html = R('src/shell.html');
html = html.replace('<!--PK:SCRIPTS-->', () => `<script>\n${guard(js)}\n</script>\n<script>\n${guard(tests)}\n</script>`);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('index.html written:', (html.length / 1024).toFixed(1), 'KB');
