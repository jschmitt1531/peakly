/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
// Inlines src/*.js, src/parsers/*.js, tests/*.test.js, tests/parsers/*.test.js and shell.html into a single index.html: node build.js
// Then computes the sha256 of every inline <script> and writes them into the Content-Security-Policy <meta>
// (placeholder PK_SCRIPT_HASHES in src/shell.html), so the CSP needs no 'unsafe-inline' for scripts.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
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
// The HTML parser turns CRLF/CR into LF before scripts run, and the CSP hash is taken over that text: normalize first.
html = html.replace(/\r\n?/g, '\n');

/* ---- Copyright banner + provenance fingerprint (deterministic: hash of the inlined app code) ----
   A unique ID in every built file makes verbatim copies easy to find and to prove (docs/PROTECTING_PEAKLY.md). */
const provenance = 'PEAKLY-' + require('crypto').createHash('sha256').update(js, 'utf8').digest('hex').slice(0, 16).toUpperCase();
const banner = '<!--\n  Peakly (c) 2026 Jennifer Schmitt. All rights reserved.\n' +
  '  Free to use under the Peakly Free-Use License: https://github.com/jschmitt1531/peakly/blob/main/LICENSE\n' +
  '  Copying, modifying, redistributing, selling, scraping or using this file to train or prompt AI systems is not permitted.\n' +
  '  Provenance: ' + provenance + '\n-->\n';
html = html.replace(/^<!doctype html>\n/i, m => m + banner);
html = html.replace('<meta name="tdm-reservation"', '<meta name="peakly-provenance" content="' + provenance + '">\n<meta name="tdm-reservation"');

/* ---- Content-Security-Policy script hashes ---- */
const cspHashes = cspScriptHashes(html);
if (html.indexOf('PK_SCRIPT_HASHES') < 0) throw new Error('build: CSP placeholder PK_SCRIPT_HASHES missing from src/shell.html');
html = html.replace('PK_SCRIPT_HASHES', () => cspHashes.join(' '));
checkNoInlineHandlers(html);

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('provenance ' + provenance + ';', 'index.html written:', (html.length / 1024).toFixed(1), 'KB;', cspHashes.length, 'inline script hash(es) in the CSP');

/** sha256 (base64) of the text of every <script> without a src attribute, as CSP source expressions. */
function cspScriptHashes(doc) {
  const out = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(doc))) {
    if (/\bsrc\s*=/i.test(m[1])) { if (m[2].trim()) throw new Error('build: <script src> with inline content'); continue; }
    out.push("'sha256-" + crypto.createHash('sha256').update(m[2], 'utf8').digest('base64') + "'");
  }
  if (!out.length) throw new Error('build: no inline scripts found');
  return out;
}
/** Inline event-handler attributes (onclick="…") and javascript: URLs are not covered by script hashes: refuse to build. */
function checkNoInlineHandlers(doc) {
  const markup = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
  const bad = markup.match(/<[a-z][^>]*\son[a-z]+\s*=[^>]*>/gi) || [];
  if (bad.length) throw new Error('build: inline event handler attribute(s) are blocked by the CSP: ' + bad.slice(0, 3).join(' | '));
  if (/(href|src|action)\s*=\s*["']?\s*javascript:/i.test(markup)) throw new Error('build: javascript: URL in markup');
}
