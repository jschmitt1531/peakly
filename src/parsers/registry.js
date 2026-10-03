/* SPDX-License-Identifier: MIT */
/* Peakly parser registry: plugin registration, sniff-based dispatch, and the shared helpers every format plugin uses.
   Load order: this file first, then every src/parsers/<format>.js (alphabetical; files starting with "_" are templates
   and are not loaded). All readers are written from public format descriptions; no third-party parser code.

   PLUGIN SHAPE (PK.parsers.register):
     { id, name, extensions:['csv',...], binary:bool, description?, order?:number (lower = listed/tie-broken first),
       sniff(head, filename, info) -> 0..1,   // head = first 4 KB (latin1 for binary); info = {size, textLike, encoding}
       parse(input, opts) -> ParseResult | Promise,   // input = text (binary:false) or ArrayBuffer (binary:true)
       sniffJSON?(obj) -> 0..1, parseJSON?(obj, opts) -> ParseResult }   // JSON dialects: see json.js
   ParseResult = { ok, traces:[{name, x, y, xUnit, yUnit, meta, peaks?}], format, warnings[], error?, needsMapping?,
     table?, rawText?, project?, events? }.
   traces[i].peaks (optional, imported integrations) = [{ start, apex, end, label?, area?, areaSE?, source, ...extra }],
     times in the trace's x unit (minutes); area in yUnit*min. The app shows them as imported peaks.

   SHARED HELPERS: PK.parsers._h (stable for plugin authors; not for app code)
     text/bytes : cleanText(text), decodeBytes(u8) -> {text, encoding}, looksText(u8), latin1(u8, start, len),
                  utf16(u8, start, le), utf8(u8, start), splitLines, trim, unquote, clip(text, n)
     numbers    : parseNum(s, decimalComma), decideDC(tokens) -> bool, MISSING (regexp of n.a./NaN/-- cells)
     units/meta : normXUnit(u) -> 'min'|'sec'|'ms'|'h'|'mL'|'CV'|null, X_FACTOR (to minutes), xUnitFromHeader(h),
                  normYUnit(u), yUnitFromHeader(h), isTimeHeader(h), isVolumeHeader(h), bracketUnit(h),
                  roleOf(header, unit) -> 'signal'|'gradient'|'conductivity'|'pH'|'pressure'|'temperature'|'flow',
                  wavelengthOf(text) -> nm|undefined, kvMeta(lines, into), deriveMeta(header, extraText), SKIP_COL
     tables     : splitLine(line, delim), autoMap(table, defaults) (= PK.parsers.guessMapping), colStats(rows, col)
     traces     : mkTrace(name, xs, ys, xUnit, yUnit, meta, flow) (converts x to minutes, sorts, drops NaN),
                  finishXY, convertX(v, unit, flow) (one value to minutes), normPeaks(list, unit, source)
     results    : fail(format, error, extra), okRes(format, traces, warnings, extra), noTableError(format, text),
                  tableToResult(text, format, opts, defaults, meta) (whole text table -> traces or needsMapping)
     json       : parseJSONLoose(text) (JSON.parse that accepts Python NaN/Infinity as null)
     misc       : glob(name) (browser/Node global lookup), extOf(filename), baseName(filename), assign, toArr,
                  plugins() -> registered plugin objects (ordered) */
(function (PK) {
  'use strict';
  var P = PK.parsers = PK.parsers || {};
  var plugins = [];

  /* ======================= small helpers ======================= */
  function glob(name) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof window !== 'undefined' && window[name]) return window[name];
    return null;
  }
  function extOf(fn) { var m = /\.([A-Za-z0-9]+)$/.exec(String(fn || '')); return m ? m[1].toLowerCase() : ''; }
  function baseName(fn) { return String(fn || '').replace(/^.*[\\\/]/, '').replace(/\.[^.]*$/, ''); }
  function trim(s) { return String(s == null ? '' : s).replace(/^[\s﻿ ]+|[\s ]+$/g, ''); }
  function unquote(s) {
    s = trim(s);
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') s = s.slice(1, -1).replace(/""/g, '"');
    return trim(s);
  }
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; }
  function clip(text, n) { n = n || 400000; return text.length > n ? text.slice(0, n) : text; }
  function splitLines(text) { return text.split(/\r\n|\n|\r/); }
  function toArr(a) { return Array.prototype.slice.call(a); }

  // Text cleanup: strip BOM, drop stray NULs from UTF-16 read as 8-bit.
  function cleanText(text) {
    text = String(text == null ? '' : text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.indexOf('\u0000') >= 0) text = text.replace(/\u0000/g, '');
    return text;
  }

  /* ---------- byte decoding ---------- */
  function latin1(u8, start, len) {
    start = start || 0; var end = Math.min(u8.length, len == null ? u8.length : start + len), s = '';
    for (var i = start; i < end; i += 8192) s += String.fromCharCode.apply(null, toArr(u8.subarray(i, Math.min(end, i + 8192))));
    return s;
  }
  function utf16(u8, start, le) {
    var n = (u8.length - start) >> 1, out = '', chunk = [];
    for (var i = 0; i < n; i++) {
      var o = start + 2 * i;
      chunk.push(le ? (u8[o] | (u8[o + 1] << 8)) : ((u8[o] << 8) | u8[o + 1]));
      if (chunk.length === 8192) { out += String.fromCharCode.apply(null, chunk); chunk = []; }
    }
    return out + String.fromCharCode.apply(null, chunk);
  }
  function utf8(u8, start) {
    var TD = glob('TextDecoder');
    if (TD) return new TD('utf-8', { fatal: true }).decode(u8.subarray(start || 0));
    return decodeURIComponent(escape(latin1(u8, start || 0)));
  }
  // Detect BOM / BOM-less UTF-16 / UTF-8 / Windows-1252 and decode.
  function decodeBytes(u8) {
    if (u8[0] === 0xFF && u8[1] === 0xFE) return { text: utf16(u8, 2, true), encoding: 'utf-16le' };
    if (u8[0] === 0xFE && u8[1] === 0xFF) return { text: utf16(u8, 2, false), encoding: 'utf-16be' };
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) { try { return { text: utf8(u8, 3), encoding: 'utf-8' }; } catch (e) { /* fall through */ } }
    var n = Math.min(u8.length, 4000), zo = 0, ze = 0;
    for (var i = 0; i < n; i++) if (!u8[i]) { if (i & 1) zo++; else ze++; }
    if (n > 8 && zo > n * 0.3 && ze < n * 0.05) return { text: utf16(u8, 0, true), encoding: 'utf-16le' };
    if (n > 8 && ze > n * 0.3 && zo < n * 0.05) return { text: utf16(u8, 0, false), encoding: 'utf-16be' };
    try { return { text: utf8(u8, 0), encoding: 'utf-8' }; } catch (e) { return { text: latin1(u8, 0), encoding: 'latin1' }; }
  }
  function looksText(u8) {
    if ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF) || (u8[0] === 0xEF && u8[1] === 0xBB)) return true;
    var n = Math.min(u8.length, 4096), zo = 0, ze = 0, ctl = 0;
    for (var i = 0; i < n; i++) {
      var b = u8[i];
      if (!b) { if (i & 1) zo++; else ze++; } else if (b < 9 || (b > 13 && b < 32 && b !== 27)) ctl++;
    }
    if ((zo > n * 0.3 && ze < n * 0.05) || (ze > n * 0.3 && zo < n * 0.05)) return true; // UTF-16 without BOM
    return (zo + ze + ctl) <= n * 0.02;
  }

  /* ---------- numbers ---------- */
  var MISSING = /^(n\.?a\.?|n\/a|nan|null|none|-+|#n\/a|\?|inf|-inf)$/i;
  var NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  var THOUS_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?([eE][+-]?\d+)?$/;
  // Parse a cell; dc = decimal comma. Thousands commas ("1,234.5") accepted when not dc.
  function parseNum(s, dc) {
    if (typeof s === 'number') return s;
    s = String(s).trim();
    if (s.charCodeAt(0) === 34) s = unquote(s);
    if (dc) { if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); }
    else if (s.indexOf(',') > 0 && THOUS_RE.test(s)) s = s.replace(/,/g, '');
    return NUM_RE.test(s) ? +s : NaN;
  }
  // Vote on decimal-comma usage from a token sample.
  function decideDC(tokens) {
    var dc = 0, th = 0, amb = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].trim(); if (t.charCodeAt(0) === 34) t = unquote(t);
      var c = t.indexOf(','), d = t.indexOf('.');
      if (c < 0) continue;
      if (d >= 0) { if (/^[+-]?[\d.]+,\d+$/.test(t) && d < c) dc++; else if (THOUS_RE.test(t)) th++; continue; }
      if (!/^[+-]?\d*,\d+([eE][+-]?\d+)?$/.test(t)) continue;
      if (/^[+-]?\d{1,3},\d{3}$/.test(t)) amb++; else dc++;
    }
    if (dc > th) return true;
    if (th > 0) return false;
    return amb > 0;
  }

  /* ---------- units, roles, metadata ---------- */
  var X_FACTOR = { min: 1, sec: 1 / 60, ms: 1 / 60000, h: 60 };
  function bracketUnit(h) { var m = /[\(\[]\s*([^\)\]]*?)\s*[\)\]]/.exec(h); return m ? m[1] : null; }
  function normXUnit(u) {
    if (u == null) return null;
    var s = String(u).toLowerCase().replace(/[.\s]/g, '');
    if (/^(min|mins|minute|minutes|m)$/.test(s)) return 'min';
    if (/^(s|sec|secs|second|seconds)$/.test(s)) return 'sec';
    if (/^(ms|msec|millisecond|milliseconds)$/.test(s)) return 'ms';
    if (/^(h|hr|hrs|hour|hours)$/.test(s)) return 'h';
    if (/^(ml|millilitre|milliliter|millilitres|milliliters)$/.test(s)) return 'mL';
    if (/^(cv|columnvolumes?)$/.test(s)) return 'CV';
    return null;
  }
  function isTimeHeader(h) { h = String(h || '').toLowerCase(); return /time|^\s*rt\s*($|\(|\[)|\bret\b|retention|^\s*(min|minutes|sec|seconds|t|x)\s*$/.test(h) && !/step/.test(h); }
  function isVolumeHeader(h) { h = String(h || '').toLowerCase(); return (/volume|^\s*(ml|cv|vol)\s*$|\(ml\)|\[ml\]/.test(h)) && !/ml\s*\/\s*min|flow|injection/.test(h); }
  function xUnitFromHeader(h) {
    h = String(h || '');
    var u = normXUnit(bracketUnit(h)); if (u) return u;
    var m = /[\/_\s,]\s*(min|minutes|sec|seconds|s|ms|h|ml|mL)\s*$/i.exec(h); if (m) return normXUnit(m[1]);
    u = normXUnit(h); if (u) return u;
    if (/minutes/i.test(h)) return 'min';
    if (/seconds/i.test(h)) return 'sec';
    if (isVolumeHeader(h)) return 'mL';
    return null;
  }
  var Y_UNITS = [
    [/^mau$/i, 'mAU'], [/^au$/i, 'AU'], [/^(mv)$/i, 'mV'], [/^(uv|µv|μv)$/i, 'µV'], [/^v$/i, 'V'],
    [/^pa$/i, 'pA'], [/^na$/i, 'nA'], [/^(counts?|cts)$/i, 'counts'], [/^cps$/i, 'cps'],
    [/^ms\/cm$/i, 'mS/cm'], [/^(us|µs|μs)\/cm$/i, 'µS/cm'], [/^%\s*b?$/i, '%'], [/^nriu$/i, 'nRIU'], [/^µ?riu$/i, 'RIU'],
    [/^lsu$/i, 'LSU'], [/^lu$/i, 'LU'], [/^eu$/i, 'EU'], [/^mpa$/i, 'MPa'], [/^bar$/i, 'bar'], [/^psi$/i, 'psi'],
    [/^(°c|degc|c)$/i, '°C'], [/^ph$/i, 'pH'], [/^ml\/min$/i, 'mL/min'], [/^(a\.?u\.?|arb\.?\s*units?)$/i, 'a.u.']
  ];
  function normYUnit(u) {
    if (u == null) return null; u = trim(u);
    for (var i = 0; i < Y_UNITS.length; i++) if (Y_UNITS[i][0].test(u)) return Y_UNITS[i][1];
    return null;
  }
  function yUnitFromHeader(h) {
    h = String(h || '');
    var b = bracketUnit(h), u = normYUnit(b); if (u) return u;
    var toks = h.split(/[\s,_\/;:]+|(?=\()/);
    for (var i = toks.length - 1; i >= 0; i--) { u = normYUnit(toks[i].replace(/[\(\)\[\]]/g, '')); if (u && u !== '°C' && u !== 'V') return u; }
    if (/ms\/cm/i.test(h)) return 'mS/cm';
    if (/%\s*b|%b/i.test(h)) return '%';
    return b && b.length <= 12 && !normXUnit(b) ? b : null;
  }
  // FPLC channel role from name + unit.
  function roleOf(h, unit) {
    var s = String(h || '').toLowerCase();
    if (/cond/.test(s) || unit === 'mS/cm' || unit === 'µS/cm') return 'conductivity';
    if (/%\s*b|\bconc\b|concentration|gradient|\bgp\b|buffer\s*b|^b\s*\(/.test(s) || (unit === '%' && !/uv|abs/.test(s))) return 'gradient';
    if (/\bph\b/.test(s) || unit === 'pH') return 'pH';
    if (/press|delta\s*c|pre-?column|post-?column/.test(s) || unit === 'MPa' || unit === 'psi' || unit === 'bar') return 'pressure';
    if (/temp/.test(s) || unit === '°C') return 'temperature';
    if (/flow/.test(s) || unit === 'mL/min') return 'flow';
    return 'signal';
  }
  function wavelengthOf(s) {
    var m = /sig\s*=\s*(\d{3}(?:\.\d+)?)/i.exec(s) || /(\d{3}(?:\.\d+)?)\s*nm\b/i.exec(s) || /(?:uv|abs|wl|λ)\s*\d?[\s_]+(\d{3})\b/i.exec(s);
    var v = m ? parseFloat(m[1]) : NaN;
    return v >= 150 && v <= 1100 ? v : undefined;
  }
  var SKIP_COL = /^\s*(step|index|no\.?|#|point|points|pt|scan|row|sample\s*#|fraction|fractions|frac|injection|logbook|run\s*log|event)\b/i;

  // "Key: value" / "Key<TAB>value" / "Key","Value" preamble lines → object.
  function kvMeta(lines, into) {
    var meta = into || {};
    (lines || []).forEach(function (l) {
      var s = trim(l), parts;
      if (!s || s.charAt(0) === '[' || /^#+$/.test(s)) return;
      s = s.replace(/^#+\s+(?!of\b)/, '');
      if (s.indexOf('\t') >= 0) parts = s.split('\t');
      else if (s.charAt(0) === '"') parts = splitLine(s, s.indexOf('";"') >= 0 ? ';' : ',');
      else { var m = /^([^:=]{1,60}?)\s*[:=]\s*(.*)$/.exec(s); if (m) parts = [m[1], m[2]]; else if (/[;,]/.test(s)) parts = s.split(/[;,]/); else return; }
      var k = unquote(parts[0]).replace(/:$/, ''), v = '';
      for (var i = 1; i < parts.length; i++) { var p = unquote(unquote(parts[i]).replace(/^[,;\s]+|[,;\s]+$/g, '')); if (p !== '') { v = p; break; } }
      if (k && k.length <= 60 && !(k in meta)) meta[k] = v;
    });
    return meta;
  }
  // Promote well-known header fields into canonical meta keys.
  function deriveMeta(hdr, extraText) {
    var out = {}, keys = Object.keys(hdr || {});
    function find(re) { for (var i = 0; i < keys.length; i++) if (re.test(keys[i]) && hdr[keys[i]] !== '') return hdr[keys[i]]; }
    var sn = find(/^(sample\s*name|samplename|sample|injection\s*name|sample\s*id|run\s*name)$/i); if (sn) out.sampleName = sn;
    var ins = find(/instrument|system\s*name/i); if (ins) out.instrument = ins;
    var ch = find(/^(channel|signal|detector|signal\s*name|channel\s*name)$/i); if (ch) out.channel = ch;
    var wl = find(/^(wavelength|wavelength\s*\(nm\)|wavelength\(nm\)|wave\s*length)$/i);
    var w = wl != null ? parseFloat(String(wl).replace(',', '.')) : NaN;
    if (!(w > 0)) w = wavelengthOf(String(ch || '') + ' ' + (extraText || ''));
    if (w > 0) out.wavelength = w;
    if (keys.length) out.header = hdr;
    return out;
  }

  /* ======================= delimited text ======================= */
  var DELIMS = ['\t', ';', ',', '|', 'ws'];
  function splitLine(line, d) {
    if (d === 'ws') {
      if (line.indexOf('"') < 0) { var t = line.trim(); return t ? t.split(/\s+/) : []; }
      var o = [], m, re = /"((?:[^"]|"")*)"|(\S+)/g;
      while ((m = re.exec(line))) o.push(m[1] != null ? m[1].replace(/""/g, '"') : m[2]);
      return o;
    }
    if (line.indexOf('"') < 0) return line.split(d);
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (q) { if (c === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === d) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  }
  function lineInfo(line, d, dc) {
    var f = splitLine(line, d);
    while (f.length && !f[f.length - 1].trim()) f.pop();
    var n = 0, bad = 0;
    for (var i = 0; i < f.length; i++) {
      var s = f[i].trim(); if (!s || MISSING.test(s)) continue;
      if (isNaN(parseNum(s, dc))) bad++; else n++;
    }
    return { f: f, n: n, bad: bad };
  }
  function isDataLine(li, minN) { return li.n >= minN && li.bad * 3 <= li.n; }
  // Best run of consecutive data lines (blank lines don't break a run), scored by numeric cell count.
  function bestRun(lines, d, dc, minN) {
    var best = null, cur = null;
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i] || !lines[i].trim()) continue;
      var li = lineInfo(lines[i], d, dc);
      if (isDataLine(li, minN)) {
        if (!cur) cur = { a: i, b: i + 1, cells: 0, ncols: 0 };
        cur.b = i + 1; cur.cells += li.n; if (li.f.length > cur.ncols) cur.ncols = li.f.length;
      } else if (cur) { if (!best || cur.cells > best.cells) best = cur; cur = null; }
    }
    if (cur && (!best || cur.cells > best.cells)) best = cur;
    return best;
  }
  function sniffDelimiter(lines) {
    var sample = lines.length > 2000 ? lines.slice(0, 1500).concat(lines.slice(-500)) : lines;
    var joined = sample.join('\n'), best = null;
    DELIMS.forEach(function (d, rank) {
      if (d !== 'ws' && joined.indexOf(d) < 0) return;
      var toks = [];
      for (var i = 0; i < sample.length && toks.length < 4000; i++) { var f = splitLine(sample[i], d); for (var j = 0; j < f.length; j++) toks.push(f[j]); }
      var dc = d === ',' ? false : decideDC(toks);
      var run = bestRun(sample, d, dc, 2), score = run ? run.cells : 0;
      if (score > 0 && (!best || score > best.score)) best = { d: d, dc: dc, score: score, rank: rank };
    });
    return best;
  }
  function headerFields(line, d, ncols) {
    var f = splitLine(line, d).map(unquote);
    while (f.length > ncols && !f[f.length - 1]) f.pop();
    if (d === 'ws' && f.length !== ncols) {
      var merged = []; // re-attach "(min)" / "[mAU]" unit tokens
      f.forEach(function (t) { if (merged.length && /^[\(\[]/.test(t)) merged[merged.length - 1] += ' ' + t; else merged.push(t); });
      f = merged;
      if (f.length !== ncols) { var alt = trim(line).split(/\t|\s{2,}/).map(unquote); if (alt.length === ncols) f = alt; }
    }
    return f;
  }
  function looksUnitRow(f) { return f.length && f.every(function (t) { return !t || (t.length <= 8 && (normXUnit(t.replace(/[\(\)\[\]]/g, '')) || normYUnit(t.replace(/[\(\)\[\]]/g, '')))); }); }

  /**
   * Parse delimited numeric text. opts: { delimiter, decimalComma, noHeader }.
   * → { header, rows, delimiter, decimalComma, skipped, preamble, ncols, startLine }
   */
  P.parseDelimited = function (text, opts) {
    opts = opts || {};
    var lines = splitLines(cleanText(text));
    var cfg;
    if (opts.delimiter) {
      var d0 = opts.delimiter === ' ' ? 'ws' : opts.delimiter;
      cfg = { d: d0, dc: opts.decimalComma != null ? !!opts.decimalComma : (d0 === ',' ? false : decideDC(lines.slice(0, 500).join(d0 === 'ws' ? ' ' : d0).split(d0 === 'ws' ? /\s+/ : d0))) };
    } else cfg = sniffDelimiter(lines);
    var run = cfg ? bestRun(lines, cfg.d, cfg.dc, 2) : null;
    if (!run) { // single numeric column?
      cfg = { d: 'ws', dc: decideDC(lines.slice(0, 500)) };
      run = bestRun(lines, 'ws', cfg.dc, 1);
      if (run && run.b - run.a < 3) run = null;
    }
    var nonBlank = lines.filter(function (l) { return l.trim(); });
    if (!run) return { header: null, rows: [], delimiter: cfg ? cfg.d : null, decimalComma: !!(cfg && cfg.dc), skipped: nonBlank.length, preamble: nonBlank.map(trim), ncols: 0, startLine: -1 };
    var rows = [], nc = run.ncols, skippedIn = 0;
    for (var i = run.a; i < run.b; i++) {
      if (!lines[i].trim()) continue;
      var li = lineInfo(lines[i], cfg.d, cfg.dc);
      if (!isDataLine(li, 1)) { skippedIn++; continue; }
      var r = new Array(nc);
      for (var c = 0; c < nc; c++) { var s = li.f[c]; r[c] = s == null ? NaN : parseNum(s, cfg.dc); }
      rows.push(r);
    }
    // header = nearest non-blank, non-numeric line above the run
    var header = null, hi = run.a - 1;
    while (hi >= 0 && !lines[hi].trim()) hi--;
    if (!opts.noHeader && hi >= 0) {
      var hl = lineInfo(lines[hi], cfg.d, cfg.dc), hs = trim(lines[hi]);
      var isComment = /^(#|\/\/|;|%)/.test(hs) || (cfg.d === 'ws' && /^[^\t,;"]{1,40}:\s+\S/.test(hs));
      if (!isDataLine(hl, 1) && !isComment) {
        var hf = headerFields(lines[hi], cfg.d, nc);
        if (hf.length >= Math.min(2, nc) && hf.length <= nc + 1 && hf.length >= nc - 1) {
          var up = hi - 1; while (up >= 0 && !lines[up].trim()) up--;
          if (looksUnitRow(hf.filter(Boolean)) && up >= 0) { // two-line header: names row + units row
            var nf = headerFields(lines[up], cfg.d, nc);
            if (nf.length === hf.length) { hf = nf.map(function (n, k) { return hf[k] ? n + ' (' + hf[k] + ')' : n; }); hi = up; }
          }
          header = []; for (var k = 0; k < nc; k++) header.push(hf[k] || '');
        }
      }
    }
    var preEnd = header ? hi : run.a, preamble = [];
    for (var j = 0; j < preEnd; j++) if (lines[j].trim()) preamble.push(trim(lines[j]));
    var after = 0; for (var q = run.b; q < lines.length; q++) if (lines[q].trim()) after++;
    return { header: header, rows: rows, delimiter: cfg.d === 'ws' ? ' ' : cfg.d, decimalComma: !!cfg.dc, skipped: preamble.length + after + skippedIn,
      preamble: preamble, ncols: nc, startLine: run.a };
  };

  /* ======================= mapping & trace building ======================= */
  function colStats(rows, c) {
    var up = 0, down = 0, prev = NaN, n = 0, mn = Infinity, mx = -Infinity;
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][c]; if (!isFinite(v)) continue;
      n++; if (v < mn) mn = v; if (v > mx) mx = v;
      if (isFinite(prev)) { if (v >= prev) up++; if (v <= prev) down++; }
      prev = v;
    }
    var steps = Math.max(1, n - 1);
    return { n: n, min: mn, max: mx, mono: n >= 3 && mx > mn && (up / steps >= 0.98 || down / steps >= 0.98) };
  }

  /** Guess a column mapping for a table. → { ok, xCol, yCols, xUnit, yUnits, pairs?, warnings, reason? } */
  function autoMap(t, defs) {
    defs = defs || {};
    var H = t.header, nc = t.ncols, R = t.rows, w = [];
    var res = { ok: false, warnings: w, xCol: 0, yCols: [], xUnit: defs.xUnit || 'min', yUnits: [] };
    if (!R.length) { res.reason = 'No rows of numbers were found.'; return res; }
    if (nc < 2) { res.xCol = -1; res.yCols = [0]; res.reason = 'Only one column of numbers was found, so there is no time axis. Use "Map columns" and enter the sampling interval.'; return res; }
    var stats = []; for (var c = 0; c < nc; c++) stats.push(colStats(R, c));
    var isT = [], isV = [];
    for (c = 0; c < nc; c++) { isT[c] = !!H && isTimeHeader(H[c]); isV[c] = !!H && !isT[c] && isVolumeHeader(H[c]); }
    // FPLC pair layout: Volume, UV, Volume, Cond, ...
    var xs = []; for (c = 0; c < nc; c++) if (isT[c] || isV[c]) xs.push(c);
    if (H && xs.length >= 2 && xs.length >= Math.floor(nc / 2) - 1 && xs.every(function (k) { return k % 2 === xs[0] % 2 && !isT[k + 1] && !isV[k + 1]; })) {
      res.pairs = [];
      xs.forEach(function (xc) {
        var yc = xc + 1; if (yc >= nc || !stats[yc].n || SKIP_COL.test(H[yc])) return;
        res.pairs.push({ xCol: xc, yCol: yc, xUnit: xUnitFromHeader(H[xc]) || (isV[xc] ? 'mL' : defs.xUnit || 'min'), yUnit: yUnitFromHeader(H[yc]) || null, name: H[yc] });
      });
      if (res.pairs.length) { res.ok = true; return res; }
      delete res.pairs;
    }
    var xCol = -1;
    for (c = 0; c < nc && xCol < 0; c++) if (isT[c] && stats[c].n) xCol = c;
    for (c = 0; c < nc && xCol < 0; c++) if (isV[c] && stats[c].n) xCol = c;
    if (xCol < 0) for (c = 0; c < Math.min(nc, 2) && xCol < 0; c++) if (stats[c].mono) xCol = c;
    if (xCol < 0) { res.reason = 'None of the columns looks like a time axis (steadily increasing numbers)' + (H ? ' and no header says "Time"' : '') + '. Pick the time and signal columns manually.'; return res; }
    res.xCol = xCol;
    if (!stats[xCol].mono) { res.reason = 'Column "' + ((H && H[xCol]) || 'Column ' + (xCol + 1)) + '" was expected to be time but its values are not steadily increasing. Pick the time column manually.'; return res; }
    var xu = H ? xUnitFromHeader(H[xCol]) : null;
    if (!xu && isV[xCol]) xu = 'mL';
    if (!xu) {
      xu = defs.xUnit || 'min';
      if (!defs.xUnitTrusted) {
        if (!H) w.push('No column headers found: assumed column ' + (xCol + 1) + ' is time in minutes and the other columns are signals.');
        else w.push('The time column "' + H[xCol] + '" has no unit: assumed minutes.');
        if (stats[xCol].max > 300 && !H) w.push('Times go up to ' + stats[xCol].max + '; if these are seconds, use "Map columns" to change the unit.');
      }
    }
    res.xUnit = xu;
    var unknownY = false;
    for (c = 0; c < nc; c++) {
      if (c === xCol || !stats[c].n) continue;
      if (H && (SKIP_COL.test(H[c]) || isT[c] || isV[c])) continue;
      if (!H && nc > 6) { res.reason = 'This table has ' + nc + ' columns and no headers; Peakly can\'t tell which ones are signals. Pick them manually.'; return res; }
      var yu = (H && yUnitFromHeader(H[c])) || defs.yUnit || null;
      if (!yu) { unknownY = true; yu = 'a.u.'; }
      res.yCols.push(c); res.yUnits.push(yu);
    }
    if (!res.yCols.length) { res.reason = 'Found a time column but no signal columns next to it.'; return res; }
    if (unknownY && !defs.quietY && H) w.push('Signal unit not found in the header; using "a.u.".');
    res.ok = true;
    return res;
  }
  P.guessMapping = function (table, defs) { return autoMap(table, defs); };

  // Convert x to minutes (or keep volume), drop non-finite pairs, sort ascending.
  function finishXY(xs, ys, xUnit, flow) {
    var unit = normXUnit(xUnit) || xUnit || 'min', f = X_FACTOR[unit], outUnit = 'min', vol = false;
    if (unit === 'mL' || unit === 'CV') { if (unit === 'mL' && flow > 0) f = 1 / flow; else { f = 1; outUnit = unit; vol = true; } }
    if (f == null) { f = 1; outUnit = unit; }
    var x = [], y = [], sorted = true;
    for (var i = 0; i < xs.length; i++) {
      var a = xs[i] === null ? NaN : +xs[i], b = ys[i] === null ? NaN : +ys[i];
      if (!isFinite(a) || !isFinite(b)) continue;
      a *= f; if (x.length && a < x[x.length - 1]) sorted = false;
      x.push(a); y.push(b);
    }
    if (!sorted) {
      var idx = x.map(function (_, k) { return k; }).sort(function (p, q) { return x[p] - x[q] || p - q; });
      x = idx.map(function (k) { return x[k]; }); y = idx.map(function (k) { return y[k]; });
    }
    return { x: x, y: y, xUnit: outUnit, xIsVolume: vol };
  }
  function mkTrace(name, xs, ys, xUnit, yUnit, meta, flow) {
    var r = finishXY(xs, ys, xUnit, flow);
    meta = assign({}, meta);
    if (r.xIsVolume) meta.xIsVolume = true;
    return { name: name || 'Trace', x: r.x, y: r.y, xUnit: r.xUnit, yUnit: yUnit || 'a.u.', source: { kind: 'file' }, meta: meta };
  }

  /**
   * Build Trace-partials from a table. mapping = { xCol, yCols:[], xUnit, yUnit, yScale, yUnits?, names?, dt?, flow?,
   *   baseName?, meta?, pairs?:[{xCol,yCol,xUnit,yUnit,name}] }. xCol = -1 uses dt (in xUnit) as sampling interval.
   */
  P.buildTraces = function (table, m) {
    m = m || {};
    var H = table.header || [], R = table.rows || [], scale = m.yScale == null ? 1 : +m.yScale, out = [];
    var meta0 = m.meta || {}, prefix = meta0.sampleName || m.baseName || '';
    var specs = m.pairs ? m.pairs.map(function (p) { return { x: p.xCol, y: p.yCol, xu: p.xUnit, yu: p.yUnit, name: p.name }; })
      : (m.yCols || []).map(function (c, k) { return { x: m.xCol, y: c, xu: m.xUnit, yu: (m.yUnits && m.yUnits[k]) || m.yUnit, name: m.names && m.names[k] }; });
    specs.forEach(function (s) {
      var xs = [], ys = [], dt = +m.dt || 1;
      for (var i = 0; i < R.length; i++) { xs.push(s.x == null || s.x < 0 ? i * dt : R[i][s.x]); ys.push(R[i][s.y] * scale); }
      var h = H[s.y] || '', yu = s.yu || yUnitFromHeader(h) || 'a.u.', role = roleOf(h || s.name, yu);
      var name = s.name || (specs.length === 1 ? (prefix || h || 'Trace') : (prefix ? prefix + ' · ' : '') + (h || 'Column ' + (s.y + 1)));
      var meta = assign({}, meta0, { column: h || undefined });
      if (role !== 'signal') meta.role = role;
      var wl = wavelengthOf(h); if (wl) meta.wavelength = wl;
      if (meta.column === undefined) delete meta.column;
      if (role === 'gradient' && yu === 'a.u.') yu = '%';
      var tr = mkTrace(name, xs, ys, s.xu || 'min', yu, meta, m.flow);
      if (tr.x.length) out.push(tr);
    });
    return out;
  };

  /* ======================= results ======================= */
  function fail(format, error, extra) { return assign({ ok: false, traces: [], format: format, warnings: [], error: error }, extra); }
  function okRes(format, traces, warnings, extra) {
    var r = assign({ ok: traces.length > 0, traces: traces, format: format, warnings: warnings || [] }, extra);
    if (!traces.length && !r.error) r.error = 'The file was read as ' + format + ' but contained no usable data points.';
    return r;
  }
  function noTableError(format, text) {
    var n = splitLines(text).filter(function (l) { return l.trim(); }).length;
    return fail(format, 'Couldn\'t find a table of numbers. Expected at least two columns (time and signal) with one data point per line, e.g. "0.00, 1.23". ' +
      'Found ' + n + ' line' + (n === 1 ? '' : 's') + ' of text, none of which look like data rows. Try exporting the chromatogram as CSV/TXT from the instrument software, or paste the two columns copied from Excel.');
  }
  // Shared tabular reader for text exports: table → auto-map → traces, or needsMapping.
  function tableToResult(text, format, opts, defs, meta) {
    var t = P.parseDelimited(text, defs && defs.parse);
    if (!t.rows.length) return noTableError(format, text);
    var hdr = kvMeta(t.preamble, assign({}, meta && meta.header));
    var m = autoMap(t, defs);
    var md = assign(deriveMeta(hdr, t.preamble.join(' ')), meta);
    if (Object.keys(hdr).length) md.header = hdr;
    if (!m.ok) return fail(format, m.reason, { needsMapping: true, table: t, rawText: clip(text), mapping: m, warnings: m.warnings });
    var traces = P.buildTraces(t, assign({}, m, { baseName: baseName(opts.filename), meta: md, flow: opts.flow }));
    var w = m.warnings.slice();
    if (t.skipped && t.preamble.length) w.push('Skipped ' + t.preamble.length + ' header/metadata line' + (t.preamble.length === 1 ? '' : 's') + ' (kept in trace metadata).');
    return okRes(format, traces, w, { table: t });
  }

  /* ======================= registry & dispatch ======================= */
  P.register = function (p) {
    if (!p || !p.id || typeof p.sniff !== 'function' || typeof p.parse !== 'function') throw new Error('parser plugin needs id, sniff() and parse()');
    p.extensions = (p.extensions || []).map(function (e) { return String(e).toLowerCase().replace(/^\./, ''); });
    var replaced = false;
    for (var i = 0; i < plugins.length; i++) if (plugins[i].id === p.id) { plugins[i] = p; replaced = true; }
    if (!replaced) plugins.push(p);
    // Keep a stable, documented order (load order is alphabetical by file name, so plugins declare `order`).
    var seq = plugins.map(function (q, k) { return { q: q, k: k }; });
    seq.sort(function (a, b) { return ((a.q.order == null ? 1000 : a.q.order) - (b.q.order == null ? 1000 : b.q.order)) || a.k - b.k; });
    plugins.length = 0; seq.forEach(function (e) { plugins.push(e.q); });
    return p;
  };
  /** Remove a plugin by id (tests, or apps that want to disable a format). → true if it was registered. */
  P.unregister = function (id) {
    for (var i = 0; i < plugins.length; i++) if (plugins[i].id === id) { plugins.splice(i, 1); return true; }
    return false;
  };
  P.list = function () { return plugins.map(function (p) { return { id: p.id, name: p.name, extensions: p.extensions.slice(), binary: !!p.binary, description: p.description || '' }; }); };
  P.get = function (id) { for (var i = 0; i < plugins.length; i++) if (plugins[i].id === id) return plugins[i]; return null; };

  var GENERIC_EXT = { csv: 1, txt: 1, tsv: 1, dat: 1, asc: 1, text: 1 };
  function rank(head, filename, binary, info) {
    var ext = extOf(filename), out = [];
    plugins.forEach(function (p, order) {
      if (binary != null && !!p.binary !== binary) return;
      var s = 0;
      try { s = +p.sniff(head, filename || '', info || {}) || 0; } catch (e) { s = 0; }
      if (ext && p.extensions.indexOf(ext) >= 0) s += GENERIC_EXT[ext] ? 0.05 : 0.3;
      out.push({ p: p, s: s, order: order });
    });
    return out.sort(function (a, b) { return b.s - a.s || a.order - b.order; });
  }
  P.rank = function (head, filename, binary) { return rank(head, filename, binary).map(function (r) { return { id: r.p.id, score: r.s }; }); };

  function friendly(plugin, e) {
    var msg = (e && e.message) || String(e);
    return 'Could not read this file as ' + plugin.name + ': ' + msg;
  }
  function runPlugin(p, input, opts) {
    try { return p.parse(input, opts); } catch (e) { return fail(p.name, friendly(p, e)); }
  }
  function finalize(res, p, opts) {
    res = res || fail(p.name, 'Parser returned nothing.');
    res.format = res.format || p.name; res.plugin = res.plugin || p.id;
    res.warnings = res.warnings || []; res.traces = res.traces || [];
    if (res.project) { res.ok = true; return res; }
    var kind = opts.sourceKind || (opts.filename ? 'file' : 'paste');
    res.traces.forEach(function (t) {
      t.source = assign({ kind: kind }, opts.filename ? { filename: opts.filename } : null, { format: res.format });
      t.xUnit = t.xUnit || 'min'; t.yUnit = t.yUnit || 'a.u.'; t.meta = t.meta || {};
      t.x = toArr(t.x); t.y = toArr(t.y);
      if (!t.name) t.name = baseName(opts.filename) || 'Trace';
      if (t.x.length < 3) res.warnings.push('Trace "' + t.name + '" has only ' + t.x.length + ' point' + (t.x.length === 1 ? '' : 's') + '.');
    });
    res.ok = !!res.ok && res.traces.length > 0;
    if (!res.ok && !res.error) res.error = 'No usable traces found in this ' + res.format + ' file.';
    return res;
  }

  /** Parse text (file content or clipboard). Sync. opts: { filename, format (plugin id to force), flow, sourceKind } */
  P.parseText = function (text, opts) {
    opts = opts || {};
    text = cleanText(text);
    var generic = P.get('delimited');
    if (!trim(text)) return finalize(fail('text', opts.filename ? 'The file "' + opts.filename + '" is empty.' : 'Nothing to read: the pasted text is empty.'), generic, opts);
    var forced = opts.format ? P.get(opts.format) : null;
    var ranked = rank(text.slice(0, 4096), opts.filename, false, opts);
    var p = forced || (ranked[0] && ranked[0].s >= 0.15 ? ranked[0].p : generic);
    var res = runPlugin(p, text, opts);
    if (res && typeof res.then === 'function') return fail(p.name, 'This format needs asynchronous reading; use parseArrayBuffer().');
    // JSON documents never fall back to the generic table reader (its "table" would be the JSON's number lines).
    if (!res.ok && !res.needsMapping && p !== generic && !forced && !/^\s*(\{|\[\s*[\[{\d"\-\]])/.test(text)) {
      var g = runPlugin(generic, text, opts);
      if (g.ok) { g.warnings.unshift(p.name + ' reader failed (' + res.error + '); read as a generic table instead.'); res = g; p = generic; }
      else if (g.needsMapping) { g.error = res.error + ' ' + (g.error || ''); res = g; p = generic; }
    }
    return finalize(res, p, opts);
  };

  /** Parse an ArrayBuffer (any format). → Promise<ParseResult> */
  P.parseArrayBuffer = function (buf, opts) {
    opts = assign({}, opts);
    return Promise.resolve().then(function () {
      var u8 = new Uint8Array(buf);
      if (!u8.length) return finalize(fail('file', 'The file' + (opts.filename ? ' "' + opts.filename + '"' : '') + ' is empty (0 bytes).'), P.get('delimited'), opts);
      var head = latin1(u8, 0, Math.min(u8.length, 4096)), textLike = looksText(u8);
      var rb = rank(head, opts.filename, true, { size: u8.length, textLike: textLike });
      if (rb.length && (rb[0].s >= 0.5 || (!textLike && rb[0].s >= 0.3))) {
        var p = rb[0].p;
        return Promise.resolve(runPlugin(p, buf, opts)).then(function (r) { return finalize(r, p, opts); }, function (e) { return finalize(fail(p.name, friendly(p, e)), p, opts); });
      }
      if (!textLike) {
        var ext = extOf(opts.filename);
        return finalize(fail('binary', 'This looks like a binary file' + (ext ? ' (.' + ext + ')' : '') + ' that Peakly doesn\'t recognize. Binary formats read directly: Agilent ChemStation .ch, AIA/ANDI netCDF (.cdf), mzML and Excel. ' +
          'For other vendor raw files, export the chromatogram as CSV/TXT or AIA/ANDI (.cdf) from the instrument software.'), P.get('unsupported'), opts);
      }
      var dec = decodeBytes(u8);
      return P.parseText(dec.text, assign({}, opts, { encoding: dec.encoding }));
    });
  };

  var IMAGE_EXT = { png: 1, jpg: 1, jpeg: 1, webp: 1, gif: 1, bmp: 1, pdf: 1 };
  /** True for images/PDFs (routed to the digitizer). Accepts File/Blob or a filename string. */
  P.isImage = function (file) {
    if (!file) return false;
    if (typeof file === 'string') return !!IMAGE_EXT[extOf(file)];
    if (file.name && IMAGE_EXT[extOf(file.name)]) return true;
    var t = String(file.type || '');
    return /^image\/(png|jpe?g|webp|gif|bmp)$/.test(t) || t === 'application/pdf';
  };

  /** Parse a browser File/Blob. → Promise<ParseResult> */
  P.parseFile = function (file) {
    var name = (file && file.name) || '';
    if (P.isImage(file)) return Promise.resolve({ ok: false, isImage: true, traces: [], format: 'image', warnings: [], error: '"' + name + '" is an image/PDF. Open it in the digitizer to trace the chromatogram.' });
    var get = file && typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : PK.util.readFileAs(file, 'arraybuffer');
    return Promise.resolve(get).then(function (buf) { return P.parseArrayBuffer(buf, { filename: name }); },
      function (e) { return fail('file', 'Could not read "' + name + '" from disk: ' + ((e && e.message) || e) + '. Try saving a copy locally and opening that.'); });
  };

  /* ======================= helpers for plugins ======================= */
  /** One x value to minutes (or unchanged for volume without flow / unknown units). */
  function convertX(v, unit, flow) {
    var u = normXUnit(unit) || unit || 'min', f = X_FACTOR[u];
    if (u === 'mL') return flow > 0 ? v / flow : v;
    return f == null ? v : v * f;
  }
  /** Normalize imported peaks: convert times to minutes, drop entries without a finite apex, sort by apex. */
  function normPeaks(list, unit, source, flow) {
    var out = [];
    (list || []).forEach(function (p) {
      if (!p) return;
      var q = assign({}, p), apex = convertX(+p.apex, unit, flow);
      if (!isFinite(apex)) return;
      q.apex = apex;
      q.start = isFinite(+p.start) && p.start !== null ? convertX(+p.start, unit, flow) : apex;
      q.end = isFinite(+p.end) && p.end !== null ? convertX(+p.end, unit, flow) : apex;
      if (q.start > q.end) { var tmp = q.start; q.start = q.end; q.end = tmp; }
      if (q.area != null && !isFinite(+q.area)) delete q.area;
      if (q.areaSE != null && !isFinite(+q.areaSE)) delete q.areaSE;
      q.source = q.source || source || 'import';
      out.push(q);
    });
    return out.sort(function (a, b) { return a.apex - b.apex; });
  }

  /** JSON.parse that also accepts Python's json.dump extensions NaN / Infinity / -Infinity (read as null). Throws like JSON.parse. */
  function parseJSONLoose(text) {
    try { return JSON.parse(text); } catch (e) {
      if (!/NaN|Infinity/.test(text)) throw e;
      var out = '', i = 0, n = text.length, inStr = false;
      while (i < n) {
        var c = text.charAt(i);
        if (inStr) { out += c; if (c === '\\') { out += text.charAt(i + 1); i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
        if (c === '"') { inStr = true; out += c; i++; continue; }
        if (text.substr(i, 3) === 'NaN') { out += 'null'; i += 3; continue; }
        if (text.substr(i, 9) === '-Infinity') { out += 'null'; i += 9; continue; }
        if (text.substr(i, 8) === 'Infinity') { out += 'null'; i += 8; continue; }
        out += c; i++;
      }
      return JSON.parse(out);
    }
  }

  P._h = {
    parseJSONLoose: parseJSONLoose,
    glob: glob, extOf: extOf, baseName: baseName, trim: trim, unquote: unquote, assign: assign, clip: clip, splitLines: splitLines,
    toArr: toArr, cleanText: cleanText, latin1: latin1, utf16: utf16, utf8: utf8, decodeBytes: decodeBytes, looksText: looksText,
    MISSING: MISSING, parseNum: parseNum, decideDC: decideDC, X_FACTOR: X_FACTOR, bracketUnit: bracketUnit, normXUnit: normXUnit,
    isTimeHeader: isTimeHeader, isVolumeHeader: isVolumeHeader, xUnitFromHeader: xUnitFromHeader, normYUnit: normYUnit,
    yUnitFromHeader: yUnitFromHeader, roleOf: roleOf, wavelengthOf: wavelengthOf, SKIP_COL: SKIP_COL, kvMeta: kvMeta,
    deriveMeta: deriveMeta, splitLine: splitLine, autoMap: autoMap, colStats: colStats, finishXY: finishXY, mkTrace: mkTrace,
    convertX: convertX, normPeaks: normPeaks, fail: fail, okRes: okRes, noTableError: noTableError, tableToResult: tableToResult,
    plugins: function () { return plugins.slice(); }
  };

  // Internals exposed for tests / app helpers (format plugins add decodeAsdf, readNetCDF, b64decode).
  P._internal = assign(P._internal || {}, { parseNum: parseNum, decideDC: decideDC, decodeBytes: decodeBytes, looksText: looksText,
    kvMeta: kvMeta, xUnitFromHeader: xUnitFromHeader, yUnitFromHeader: yUnitFromHeader, roleOf: roleOf, wavelengthOf: wavelengthOf, latin1: latin1 });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
