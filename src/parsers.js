/* Peakly parsers: pluggable format registry and readers for chromatogram files.
   Every format is a plugin { id, name, extensions, binary, sniff(head, filename, info), parse(input, opts) }.
   All readers here are written from public format descriptions; no third-party parser code. */
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
      var a = +xs[i], b = +ys[i];
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
    for (var i = 0; i < plugins.length; i++) if (plugins[i].id === p.id) { plugins[i] = p; return p; }
    plugins.push(p);
    return p;
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
    res.format = res.format || p.name; res.plugin = p.id;
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
    if (!res.ok && !res.needsMapping && p !== generic && !forced) {
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

  /* ======================= plugin: generic delimited ======================= */
  P.register({
    id: 'delimited', name: 'Delimited text (CSV/TSV)', extensions: ['csv', 'tsv', 'txt', 'dat', 'asc', 'text'], binary: false,
    description: 'Comma, tab, semicolon or space separated columns; decimal comma; optional header; metadata lines kept.',
    sniff: function (head) { var n = 0; splitLines(head).forEach(function (l) { if (/^\s*[+-]?[\d.,]+([eE][+-]?\d+)?\s*[\t,; |]\s*[+-]?[\d.,]/.test(l)) n++; }); return n >= 3 ? 0.3 : 0.1; },
    parse: function (text, opts) { return tableToResult(text, 'Delimited text', opts || {}, {}); }
  });

  /* ======================= plugin: JSON ======================= */
  function isProject(o) { return o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.traces) && o.version != null && (o.method || o.settings || o.images); }
  function jsonTrace(o, hint) {
    var xs, ys, xu, yu, name = hint, meta = {};
    if (Array.isArray(o)) {
      if (!o.length) return null;
      if (Array.isArray(o[0])) { xs = o.map(function (p) { return +p[0]; }); ys = o.map(function (p) { return +p[1]; }); }
      else if (o[0] && typeof o[0] === 'object') {
        var kx = pick(o[0], ['x', 't', 'time', 'rt', 'min']), ky = pick(o[0], ['y', 'value', 'signal', 'intensity', 'absorbance', 'v']);
        if (!kx || !ky) return null;
        xs = o.map(function (p) { return +p[kx]; }); ys = o.map(function (p) { return +p[ky]; }); xu = /time|^t$|rt/i.test(kx) ? null : null;
      } else return null;
    } else if (o && typeof o === 'object') {
      var ax = pick(o, ['x', 't', 'time', 'times', 'rt']), ay = pick(o, ['y', 'values', 'signal', 'intensity', 'intensities', 'absorbance']);
      if (ax && ay && Array.isArray(o[ax]) && Array.isArray(o[ay])) { xs = o[ax]; ys = o[ay]; }
      else if (Array.isArray(o.data)) return jsonTrace(o.data, o.name || hint);
      else return null;
      xu = o.xUnit || o.xunit || o.timeUnit; yu = o.yUnit || o.yunit || o.unit;
      name = o.name || o.label || hint;
      if (o.meta && typeof o.meta === 'object') meta = assign({}, o.meta);
    } else return null;
    var u = normXUnit(xu) || 'min';
    if (xu && !normXUnit(xu)) meta.xUnitOriginal = xu;
    return mkTrace(name, xs, ys, u, yu ? String(yu) : 'a.u.', meta);
  }
  function pick(o, keys) { var ks = Object.keys(o); for (var i = 0; i < keys.length; i++) for (var j = 0; j < ks.length; j++) if (ks[j].toLowerCase() === keys[i]) return ks[j]; return null; }
  P.register({
    id: 'json', name: 'JSON', extensions: ['json', 'peakly'], binary: false,
    description: 'Peakly project, [{x,y}], [[x,y]], {x:[],y:[]}, {traces:[...]}.',
    sniff: function (head) { var s = trim(head); return /^[\[{]/.test(s) ? (/"(x|y|traces|time|version)"\s*:/.test(s) || /^\[\s*\[/.test(s) ? 0.9 : 0.6) : 0; },
    parse: function (text, opts) {
      var obj;
      try { obj = JSON.parse(text); } catch (e) { return fail('JSON', 'This looks like JSON but could not be read (' + e.message + '). The file may be truncated or have a trailing comma.'); }
      if (isProject(obj)) return { ok: true, project: obj, traces: obj.traces, format: 'Peakly project', warnings: [] };
      var base = baseName(opts && opts.filename) || 'Trace', traces = [];
      var list = obj && !Array.isArray(obj) && Array.isArray(obj.traces) ? obj.traces : null;
      if (!list && Array.isArray(obj) && obj.length && obj[0] && typeof obj[0] === 'object' && !Array.isArray(obj[0]) && (pick(obj[0], ['x', 'time', 't']) && Array.isArray(obj[0][pick(obj[0], ['x', 'time', 't'])]))) list = obj;
      if (list) list.forEach(function (o, i) { var t = jsonTrace(o, base + (list.length > 1 ? ' ' + (i + 1) : '')); if (t && t.x.length) traces.push(t); });
      else { var t = jsonTrace(obj, base); if (t && t.x.length) traces.push(t); }
      if (!traces.length) return fail('JSON', 'The JSON was valid but no chromatogram data was found. Expected one of: [{"x":0,"y":1},…], [[0,1],…], {"x":[…],"y":[…]}, {"traces":[{"name":…,"x":[…],"y":[…]}]} or a saved Peakly project.');
      return okRes('JSON', traces, []);
    }
  });

  /* ======================= plugin: Excel (SheetJS) ======================= */
  P.register({
    id: 'xlsx', name: 'Excel workbook', extensions: ['xlsx', 'xls', 'xlsm', 'ods'], binary: true,
    description: 'First sheet with a numeric table (needs the SheetJS library).',
    sniff: function (head, fn) {
      var ext = extOf(fn);
      if (head.slice(0, 4) === 'PK\u0003\u0004') return /xl\/|\[Content_Types\]|mimetypeapplication\/vnd\.oasis/.test(head) || /^(xlsx|xlsm|ods)$/.test(ext) ? 0.9 : 0.2;
      if (head.slice(0, 4) === 'ÐÏ\u0011à') return ext === 'xls' ? 0.9 : 0.1;
      return 0;
    },
    parse: function (buf, opts) {
      var X = glob('XLSX');
      if (!X) return fail('Excel', 'Reading Excel files needs the SheetJS library, which loads from a CDN and isn\'t available right now. Check your internet connection and reload, or save the sheet as CSV and open that.');
      var wb = X.read(new Uint8Array(buf), { type: 'array' }), first = null;
      for (var i = 0; i < wb.SheetNames.length; i++) {
        var sn = wb.SheetNames[i], aoa = X.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, blankrows: false, defval: '' });
        if (!aoa.length) continue;
        var tsv = aoa.map(function (r) { return r.map(function (v) { return v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n');
        var r = P.parseText(tsv, assign({}, opts, { sourceKind: 'file' }));
        if (r.ok) { r.format = 'Excel (' + r.format + ')'; if (wb.SheetNames.length > 1) r.warnings.push('Read sheet "' + sn + '" (first sheet with numeric data).'); return r; }
        if (!first) first = r;
      }
      return first || fail('Excel', 'The workbook has no sheet with numbers. Expected a sheet with a time column and at least one signal column.');
    }
  });

  /* ======================= plugin: JCAMP-DX ======================= */
  var SQZ = { '@': 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, a: -1, b: -2, c: -3, d: -4, e: -5, f: -6, g: -7, h: -8, i: -9 };
  var DIF = { '%': 0, J: 1, K: 2, L: 3, M: 4, N: 5, O: 6, P: 7, Q: 8, R: 9, j: -1, k: -2, l: -3, m: -4, n: -5, o: -6, p: -7, q: -8, r: -9 };
  var DUP = { S: 1, T: 2, U: 3, V: 4, W: 5, X: 6, Y: 7, Z: 8, s: 9 };
  var AFFN_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]\d+)?/;
  /** Decode one ASDF/AFFN data line → { vals, endsDif }. Exponents need an explicit sign (E is also SQZ 5). */
  function decodeAsdf(line) {
    var out = [], i = 0, L = line.length, lastDiff = 0, lastDif = false, endsDif = false;
    while (i < L) {
      var c = line.charAt(i), kind, lead;
      if (c === ' ' || c === ',' || c === '\t' || c === ';') { i++; continue; }
      if (c === '?') { out.push(NaN); lastDif = false; endsDif = false; i++; continue; }
      if (c in SQZ) { kind = 'sqz'; lead = SQZ[c]; } else if (c in DIF) { kind = 'dif'; lead = DIF[c]; } else if (c in DUP) { kind = 'dup'; lead = DUP[c]; }
      else if (/[0-9.+\-]/.test(c)) {
        var m = AFFN_RE.exec(line.slice(i)); if (!m) { i++; continue; }
        out.push(+m[0]); i += m[0].length; lastDif = false; endsDif = false; continue;
      } else { i++; continue; }
      var j = i + 1, ds = ''; while (j < L && /[0-9]/.test(line.charAt(j))) ds += line.charAt(j++);
      var v = (lead < 0 || (lead === 0 && c !== '@' && c !== '%') ? -1 : 1) * parseFloat(String(Math.abs(lead)) + ds);
      if (kind === 'sqz') { out.push(v); lastDif = false; endsDif = false; }
      else if (kind === 'dif') { var prev = out.length ? out[out.length - 1] : 0; out.push(prev + v); lastDiff = v; lastDif = true; endsDif = true; }
      else { for (var k = 1; k < v; k++) { var pv = out[out.length - 1]; out.push(lastDif ? pv + lastDiff : pv); } }
      i = j;
    }
    return { vals: out, endsDif: endsDif };
  }
  function jcampNum(s) { var v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : NaN; }
  function parseJcamp(text, opts) {
    var lines = splitLines(text), blocks = [], cur = null, mode = null, w = [];
    lines.forEach(function (raw) {
      var line = raw.replace(/\$\$.*$/, '');
      var m = /^\s*##([^=]*)=(.*)$/.exec(line);
      if (m) {
        var key = m[1].toUpperCase().replace(/[\s\-\/_]/g, ''), val = trim(m[2]);
        if (key === 'TITLE') { cur = { ldr: {}, data: [], dtype: null }; blocks.push(cur); }
        if (!cur) { cur = { ldr: {}, data: [], dtype: null }; blocks.push(cur); }
        if (key === 'END') { mode = null; return; }
        if (/^(XYDATA|PEAKTABLE|XYPOINTS|DATATABLE)$/.test(key)) { mode = key; cur.dtype = key + ' ' + val; return; }
        mode = null; cur.ldr[key] = val; return;
      }
      if (mode && cur && trim(line)) cur.data.push(line);
    });
    var traces = [];
    blocks.forEach(function (b, bi) {
      if (!b.data.length) return;
      var L = b.ldr, xf = jcampNum(L.XFACTOR) || 1, yf = jcampNum(L.YFACTOR) || 1, xs = [], ys = [];
      var xu = L.XUNITS || '', yu = L.YUNITS || '';
      if (/\(X\+\+\(Y\.\.Y\)\)/i.test(b.dtype.replace(/\s/g, ''))) {
        var raw = [], prevDif = false, firstXs = [];
        b.data.forEach(function (line) {
          var d = decodeAsdf(line); if (!d.vals.length) return;
          var yv = d.vals.slice(1);
          if (prevDif && raw.length && yv.length) {
            if (Math.abs(yv[0] - raw[raw.length - 1]) > 1e-6 * Math.max(1, Math.abs(yv[0]))) w.push('JCAMP Y-check mismatch near X=' + d.vals[0] + ' (data may be corrupted).');
            yv.shift();
          }
          firstXs.push(d.vals[0]);
          for (var k = 0; k < yv.length; k++) raw.push(yv[k]);
          prevDif = d.endsDif;
        });
        var n = raw.length, np = parseInt(L.NPOINTS, 10), fx = jcampNum(L.FIRSTX), lx = jcampNum(L.LASTX);
        if (np && np !== n) w.push('JCAMP NPOINTS=' + np + ' but ' + n + ' values were decoded.');
        if (!isFinite(fx)) fx = (firstXs[0] || 0) * xf;
        var dx = isFinite(lx) && n > 1 ? (lx - fx) / ((np || n) - 1) : (isFinite(jcampNum(L.DELTAX)) ? jcampNum(L.DELTAX) : 1);
        for (var i = 0; i < n; i++) { xs.push(fx + i * dx); ys.push(raw[i] * yf); }
      } else { // (XY..XY) pairs
        var nums = [];
        b.data.forEach(function (line) { var re = /[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|\?/g, m; while ((m = re.exec(line))) nums.push(m[0] === '?' ? NaN : +m[0]); });
        for (var j = 0; j + 1 < nums.length; j += 2) { xs.push(nums[j] * xf); ys.push(nums[j + 1] * yf); }
      }
      var unit = normXUnit(xu.replace(/^time\s*/i, '').replace(/[()]/g, '')) || (/min/i.test(xu) ? 'min' : /sec/i.test(xu) ? 'sec' : null);
      if (!unit) { if (xu) w.push('XUNITS is "' + xu + '", not a time unit; x values are used as-is.'); unit = 'min'; }
      var title = L.TITLE || baseName(opts.filename) || 'JCAMP ' + (bi + 1);
      var yUnit = normYUnit(yu) || (yu ? yu : 'a.u.');
      traces.push(mkTrace(title, xs, ys, unit, yUnit, { header: L, sampleName: L.TITLE, dataType: L.DATATYPE }));
    });
    if (!traces.length) return fail('JCAMP-DX', 'No ##XYDATA, ##XYPOINTS or ##PEAK TABLE block was found in this JCAMP-DX file (NTUPLES/multi-dimensional data are not supported).');
    return okRes('JCAMP-DX', traces, w);
  }
  P.register({
    id: 'jcamp', name: 'JCAMP-DX', extensions: ['jdx', 'dx', 'jcamp', 'jcm'], binary: false,
    description: 'AFFN and ASDF (SQZ/DIF/DUP) compressed XYDATA, XYPOINTS, PEAK TABLE.',
    sniff: function (head) { return /##(TITLE|JCAMP-?DX)\s*=/i.test(head) ? 0.95 : 0; },
    parse: function (text, opts) { return parseJcamp(text, opts || {}); }
  });

  /* ======================= plugin: AnDI / netCDF-3 ======================= */
  /** Minimal netCDF-3 classic (CDF1/CDF2) reader. → { version, numrecs, dims[], attrs{}, vars{}, get(name) } */
  function readNetCDF(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), p = 0, len = u8.length;
    function need(n) { if (p + n > len) throw new Error('the file is truncated (needed ' + n + ' bytes at offset ' + p + ', file has ' + len + ').'); }
    function u32() { need(4); var v = dv.getUint32(p); p += 4; return v; }
    function pad4(n) { return (n + 3) & ~3; }
    function name() { var n = u32(); need(n); var s = latin1(u8, p, n); p += pad4(n); return s; }
    var SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
    function rd(t, o) { switch (t) { case 1: return dv.getInt8(o); case 3: return dv.getInt16(o); case 4: return dv.getInt32(o); case 5: return dv.getFloat32(o); case 6: return dv.getFloat64(o); } return NaN; }
    function values(t, n) {
      var sz = SZ[t]; if (!sz) throw new Error('unknown netCDF data type ' + t + '.');
      need(n * sz); var out;
      if (t === 2) out = latin1(u8, p, n).replace(/\u0000+$/, '');
      else { out = []; for (var i = 0; i < n; i++) out.push(rd(t, p + i * sz)); if (out.length === 1) out = out[0]; }
      p += pad4(n * sz); return out;
    }
    function attList() {
      var tag = u32(), n = u32(), a = {};
      if (tag === 0) return a; if (tag !== 12) throw new Error('bad attribute list tag ' + tag + '.');
      for (var i = 0; i < n; i++) { var nm = name(), t = u32(), k = u32(); a[nm] = values(t, k); }
      return a;
    }
    if (latin1(u8, 0, 3) !== 'CDF') throw new Error('missing "CDF" signature.');
    var ver = u8[3];
    if (ver === 5) throw new Error('this is a 64-bit-data netCDF (CDF5) file; only classic netCDF-3 (AIA/ANDI) is supported.');
    if (ver !== 1 && ver !== 2) throw new Error('unknown netCDF version byte ' + ver + '.');
    p = 4;
    var numrecs = u32(), dims = [], tag = u32(), n = u32(), i;
    if (tag === 10) for (i = 0; i < n; i++) dims.push({ name: name(), len: u32() }); else if (tag !== 0) throw new Error('bad dimension list tag ' + tag + '.');
    var attrs = attList(), vars = {}, order = [];
    tag = u32(); n = u32();
    if (tag === 11) for (i = 0; i < n; i++) {
      var vn = name(), nd = u32(), ids = []; for (var k = 0; k < nd; k++) ids.push(u32());
      var va = attList(), t = u32(), vsize = u32(), begin = ver === 2 ? u32() * 4294967296 + u32() : u32();
      vars[vn] = { name: vn, dimids: ids, attrs: va, type: t, vsize: vsize, begin: begin, isRecord: ids.length > 0 && dims[ids[0]] && dims[ids[0]].len === 0 };
      order.push(vn);
    } else if (tag !== 0) throw new Error('bad variable list tag ' + tag + '.');
    var recVars = order.filter(function (k) { return vars[k].isRecord; });
    var recsize = 0; recVars.forEach(function (k) { recsize += vars[k].vsize; });
    if (recVars.length === 1) { var rv = vars[recVars[0]]; recsize = SZ[rv.type] * rv.dimids.slice(1).reduce(function (a, d) { return a * dims[d].len; }, 1); }
    if (numrecs === 0xFFFFFFFF && recVars.length) numrecs = Math.floor((len - vars[recVars[0]].begin) / Math.max(1, recsize));
    function get(nm) {
      var v = vars[nm]; if (!v) return null;
      var sz = SZ[v.type], cnt = v.dimids.slice(v.isRecord ? 1 : 0).reduce(function (a, d) { return a * dims[d].len; }, 1);
      var nrec = v.isRecord ? numrecs : 1, out = [];
      for (var r = 0; r < nrec; r++) {
        var off = v.begin + (v.isRecord ? r * recsize : 0);
        if (off + cnt * sz > len) throw new Error('variable "' + nm + '" runs past the end of the file (truncated?).');
        if (v.type === 2) { out.push(latin1(u8, off, cnt).replace(/\u0000+$/, '')); continue; }
        for (var j = 0; j < cnt; j++) out.push(rd(v.type, off + j * sz));
      }
      return v.type === 2 ? out.join('') : out;
    }
    return { version: ver, numrecs: numrecs, dims: dims, attrs: attrs, vars: vars, get: get };
  }
  function ncScalar(nc, nm) { var v = nc.get(nm); if (v == null) return NaN; v = Array.isArray(v) ? v[0] : v; return typeof v === 'number' && Math.abs(v) < 1e30 ? v : NaN; }
  function parseAndi(buf, opts) {
    var nc = readNetCDF(buf), A = nc.attrs, w = [], base = baseName(opts.filename);
    var hdr = {}; Object.keys(A).forEach(function (k) { hdr[k] = Array.isArray(A[k]) ? A[k].join(', ') : A[k]; });
    var meta = { header: hdr };
    if (A.sample_name || A.sample_id) meta.sampleName = A.sample_name || A.sample_id;
    if (A.detector_name) meta.channel = A.detector_name;
    if (A.injection_date_time_stamp) meta.injectionDate = A.injection_date_time_stamp;
    var wl = wavelengthOf(String(A.detector_name || '') + ' ' + String(A.detection_method_name || '')); if (wl) meta.wavelength = wl;
    var y = nc.get('ordered_derivative_values');
    if (y) {
      var n = y.length, si = ncScalar(nc, 'actual_sampling_interval'), dl = ncScalar(nc, 'actual_delay_time') || 0, rl = ncScalar(nc, 'actual_run_time_length');
      var ru = String(A.retention_unit || 'seconds').toLowerCase(), unit = /min/.test(ru) ? 'min' : /^ms|milli/.test(ru) ? 'ms' : 'sec';
      var x = null, rt = nc.get('raw_data_retention');
      if (rt && rt.length === n) x = rt;
      else {
        if (!(si > 0) && rl > 0 && n > 1) { si = rl / (n - 1); w.push('No sampling interval stored; derived from the run length.'); }
        if (!(si > 0)) { si = 1; w.push('No sampling interval or run length stored; x is the point index in seconds — set the time axis manually.'); }
        x = []; for (var i = 0; i < n; i++) x.push(dl + i * si);
      }
      var ys = y.map(function (v) { return Math.abs(v) > 1e30 ? NaN : v; });
      var yUnit = A.detector_unit ? (normYUnit(A.detector_unit) || String(A.detector_unit)) : 'a.u.';
      if (!A.detector_unit) w.push('No detector_unit attribute; signal unit set to "a.u.".');
      return okRes('AnDI/AIA netCDF', [mkTrace(meta.sampleName || base || 'AIA trace', x, ys, unit, yUnit, meta)], w);
    }
    var tic = nc.get('total_intensity'), st = nc.get('scan_acquisition_time');
    if (tic && st && tic.length === st.length) {
      meta.role = undefined; delete meta.role;
      return okRes('AnDI-MS netCDF (TIC)', [mkTrace((meta.sampleName || base || 'MS') + ' TIC', st, tic, 'sec', 'counts', meta)], ['Mass-spec AnDI file: showing the total ion chromatogram.']);
    }
    return fail('AnDI/AIA netCDF', 'This netCDF file has no "ordered_derivative_values" (AIA chromatography) or "total_intensity" (AnDI-MS) variable. Variables found: ' + (Object.keys(nc.vars).join(', ') || 'none') + '.');
  }
  P.register({
    id: 'netcdf', name: 'AnDI/AIA netCDF', extensions: ['cdf', 'nc', 'andi', 'aia'], binary: true,
    description: 'ASTM E1947 chromatography netCDF-3 (CDF1/CDF2); AnDI-MS TIC.',
    sniff: function (head) { return /^CDF[\u0001\u0002]/.test(head) ? 0.98 : (/^\u0089HDF/.test(head) ? 0.05 : 0); },
    parse: function (buf, opts) { return parseAndi(buf, opts || {}); }
  });

  /* ======================= plugin: mzML ======================= */
  var B64 = (function () { var t = new Int16Array(128).fill(-1), s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; for (var i = 0; i < 64; i++) t[s.charCodeAt(i)] = i; t[45] = 62; t[95] = 63; return t; })();
  function b64decode(str) {
    var n = 0, out = new Uint8Array(Math.floor(str.length * 3 / 4) + 3), acc = 0, bits = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i), v = c < 128 ? B64[c] : -1; if (v < 0) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 0xFF; }
    }
    return out.subarray(0, n);
  }
  function xattr(tag, nm) { var m = new RegExp('\\s' + nm + '\\s*=\\s*"([^"]*)"').exec(tag); return m ? m[1] : null; }
  function cvParams(xml) {
    var out = [], re = /<cvParam\b[^>]*>/g, m;
    while ((m = re.exec(xml))) out.push({ acc: xattr(m[0], 'accession'), name: xattr(m[0], 'name') || '', value: xattr(m[0], 'value'), unitAcc: xattr(m[0], 'unitAccession'), unitName: xattr(m[0], 'unitName') || '' });
    return out;
  }
  function hasCv(cvs, acc) { for (var i = 0; i < cvs.length; i++) if (cvs[i].acc === acc) return cvs[i]; return null; }
  function decodeBinaryArray(b64, cvs) {
    var bytes = b64decode(b64.replace(/\s+/g, ''));
    if (hasCv(cvs, 'MS:1002312') || hasCv(cvs, 'MS:1002313') || hasCv(cvs, 'MS:1002314') || /numpress/i.test(cvs.map(function (c) { return c.name; }).join(' ')))
      throw new Error('MS-Numpress compressed arrays are not supported. Re-convert with msconvert without --numpress.');
    if (hasCv(cvs, 'MS:1000574')) {
      var pako = glob('pako');
      if (!pako) throw new Error('the data is zlib-compressed and the decompression library (pako) is not loaded. Check your internet connection and reload, or convert with msconvert --noZlib.');
      bytes = pako.inflate(bytes);
    }
    var dvw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [], sz, rdr;
    if (hasCv(cvs, 'MS:1000523')) { sz = 8; rdr = function (o) { return dvw.getFloat64(o, true); }; }
    else if (hasCv(cvs, 'MS:1000519')) { sz = 4; rdr = function (o) { return dvw.getInt32(o, true); }; }
    else if (hasCv(cvs, 'MS:1000522')) { sz = 8; rdr = function (o) { return dvw.getInt32(o, true) + dvw.getInt32(o + 4, true) * 4294967296; }; }
    else { sz = 4; rdr = function (o) { return dvw.getFloat32(o, true); }; }
    for (var o = 0; o + sz <= bytes.length; o += sz) out.push(rdr(o));
    return out;
  }
  function mzTimeUnit(cv) {
    if (!cv) return null;
    if (cv.unitAcc === 'UO:0000031' || /minute/i.test(cv.unitName)) return 'min';
    if (cv.unitAcc === 'UO:0000010' || /^second/i.test(cv.unitName)) return 'sec';
    if (cv.unitAcc === 'UO:0000028' || /millisecond/i.test(cv.unitName)) return 'ms';
    return null;
  }
  function parseMzml(text, opts) {
    var w = [], traces = [], base = baseName(opts.filename), re = /<chromatogram\b([^>]*)>([\s\S]*?)<\/chromatogram>/g, m, count = 0, MAX = 24;
    while ((m = re.exec(text))) {
      count++; if (traces.length >= MAX) continue;
      var id = xattr(' ' + m[1], 'id') || 'chromatogram ' + count, body = m[2];
      var arrays = [], are = /<binaryDataArray\b[^>]*>([\s\S]*?)<\/binaryDataArray>/g, a;
      while ((a = are.exec(body))) { var bm = /<binary>([\s\S]*?)<\/binary>/.exec(a[1]); arrays.push({ cvs: cvParams(a[1]), b64: bm ? bm[1] : '' }); }
      var ccvs = cvParams(body.replace(/<binaryDataArrayList[\s\S]*<\/binaryDataArrayList>/, ''));
      var kind = ccvs.filter(function (c) { return /chromatogram/i.test(c.name); })[0];
      var tArr = arrays.filter(function (x) { return hasCv(x.cvs, 'MS:1000595'); })[0];
      var yArr = arrays.filter(function (x) { return hasCv(x.cvs, 'MS:1000515') || hasCv(x.cvs, 'MS:1000617') === null && x !== tArr && /intensity|absorb|signal/i.test(x.cvs.map(function (c) { return c.name; }).join(' ')); })[0] || arrays.filter(function (x) { return x !== tArr; })[0];
      if (!tArr || !yArr) { w.push('Chromatogram "' + id + '" has no time/intensity arrays; skipped.'); continue; }
      var xs = decodeBinaryArray(tArr.b64, tArr.cvs), ys = decodeBinaryArray(yArr.b64, yArr.cvs);
      var tcv = hasCv(tArr.cvs, 'MS:1000595'), unit = mzTimeUnit(tcv);
      if (!unit) { unit = xs.length && xs[xs.length - 1] > 200 ? 'sec' : 'min'; w.push('Chromatogram "' + id + '" time unit not stated; assumed ' + (unit === 'sec' ? 'seconds' : 'minutes') + '.'); }
      var ycv = yArr.cvs.filter(function (c) { return c.unitName || c.unitAcc; })[0], yUnit = 'counts';
      if (ycv) yUnit = /absorbance/i.test(ycv.unitName) ? 'AU' : /count/i.test(ycv.unitName) ? 'counts' : (ycv.unitName || 'a.u.');
      var kname = kind ? kind.name : '';
      if (/absorption|electromagnetic|emission/i.test(kname) && !ycv) yUnit = 'a.u.';
      var n = Math.min(xs.length, ys.length);
      var meta = { channel: kname || id, chromatogramId: id };
      var wl = wavelengthOf(id + ' ' + kname); if (wl) meta.wavelength = wl;
      traces.push(mkTrace((base ? base + ' ' : '') + (/^TIC$/i.test(id) ? 'TIC' : id), xs.slice(0, n), ys.slice(0, n), unit, yUnit, meta));
    }
    if (count > MAX) w.push('This mzML has ' + count + ' chromatograms; only the first ' + MAX + ' were loaded.');
    if (!traces.length) { // fall back: TIC from spectrum-level cvParams
      var sre = /<spectrum\b[^>]*>([\s\S]*?)<\/spectrum>/g, s, xs2 = [], ys2 = [], su = null;
      while ((s = sre.exec(text))) {
        var cv = cvParams(s[1].replace(/<binaryDataArrayList[\s\S]*<\/binaryDataArrayList>/, ''));
        var lvl = hasCv(cv, 'MS:1000511'); if (lvl && +lvl.value !== 1) continue;
        var st = hasCv(cv, 'MS:1000016'), tic = hasCv(cv, 'MS:1000285');
        if (st && tic) { xs2.push(+st.value); ys2.push(+tic.value); su = su || mzTimeUnit(st); }
      }
      if (xs2.length) { w.push('No <chromatogramList>; built the TIC from MS1 spectrum totals.'); traces.push(mkTrace((base ? base + ' ' : '') + 'TIC', xs2, ys2, su || 'min', 'counts', { channel: 'TIC (from spectra)' })); }
    }
    if (!traces.length) return fail('mzML', 'No chromatograms were found in this mzML (no <chromatogram> entries and no spectrum-level total ion current). Re-convert with msconvert keeping chromatograms.');
    // TIC first
    traces.sort(function (p, q) { return (/TIC$/.test(q.name) ? 1 : 0) - (/TIC$/.test(p.name) ? 1 : 0); });
    return okRes('mzML', traces, w);
  }
  P.register({
    id: 'mzml', name: 'mzML', extensions: ['mzml'], binary: false,
    description: 'TIC/BPC/SRM and UV chromatograms; base64, zlib (pako), 32/64-bit floats.',
    sniff: function (head) { return /<(indexedmzML|mzML)\b/.test(head) ? 0.95 : (/<\?xml/.test(head) && /chromatogram/i.test(head) ? 0.5 : 0); },
    parse: function (text, opts) { return parseMzml(text, opts || {}); }
  });

  /* ======================= plugin: Agilent ChemStation .ch ======================= */
  // Length-prefixed UTF-16LE header string at a fixed offset.
  function chStr(u8, off) {
    if (off >= u8.length) return '';
    var n = u8[off], s = '';
    for (var i = 0; i < n && off + 2 + 2 * i <= u8.length; i++) s += String.fromCharCode(u8[off + 1 + 2 * i] | (u8[off + 2 + 2 * i] << 8));
    return trim(s.replace(/\u0000/g, ''));
  }
  function chVersion(u8) {
    var a = u8.length > 4 ? latin1(u8, 1, u8[0]) : '';
    if (/^\d+$/.test(a)) return a;
    var b = chStr(u8, 0x146); return /^\d+$/.test(b) ? b : null;
  }
  var CH_DATA = 0x1800;
  function parseCh(buf, opts) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), w = [], ver = chVersion(u8), len = u8.length;
    if (!ver) return fail('Agilent ChemStation .ch', 'The file has no ChemStation version tag at the start. It doesn\'t look like a ChemStation .ch file; export the signal as CSV from ChemStation/OpenLab instead.');
    if (['130', '131', '30', '31', '179', '181'].indexOf(ver) < 0) return fail('Agilent ChemStation .ch', 'ChemStation file version ' + ver + ' is not supported (supported: 130/131 LC and 179/181). Export the signal as CSV or AIA/ANDI (.cdf) instead.');
    if (len < CH_DATA + 2) return fail('Agilent ChemStation .ch', 'The file is too short (' + len + ' bytes) to contain data; ChemStation headers alone are 6144 bytes.');
    var units = chStr(u8, 0x104C), signal = ver === '181' ? '' : chStr(u8, 0x1075);
    var meta = { sampleName: chStr(u8, 0x35A) || undefined, date: chStr(u8, 0x957) || undefined, method: chStr(u8, 0xA0E) || undefined,
      instrument: chStr(u8, 0xC11) || undefined, channel: signal || undefined, chVersion: +ver, fileType: chStr(u8, 0x15B) || undefined };
    Object.keys(meta).forEach(function (k) { if (meta[k] === undefined) delete meta[k]; });
    var wl = wavelengthOf(signal); if (wl) meta.wavelength = wl;
    var scale = dv.getFloat64(0x127C, false);
    if (!isFinite(scale) || scale === 0) { scale = 1; w.push('No scaling factor in the header; raw values used.'); }
    var vals = [], t0, t1, p = CH_DATA;
    if (ver === '130' || ver === '131' || ver === '30' || ver === '31') {
      t0 = dv.getUint32(0x11A, false); t1 = dv.getUint32(0x11E, false);
      var acc = 0;
      while (p + 2 <= len) {
        var label = u8[p], cnt = u8[p + 1]; p += 2;
        if (label === 0 && cnt === 0) break;
        if (label !== 16) { w.push('Unexpected data segment marker ' + label + ' at byte ' + (p - 2) + '; stopped reading there.'); break; }
        for (var k = 0; k < cnt && p + 2 <= len; k++) {
          var d = dv.getInt16(p, false); p += 2;
          if (d === -32768) { if (p + 4 > len) break; acc = dv.getInt32(p, false); p += 4; } else acc += d;
          vals.push(acc * scale);
        }
      }
    } else {
      var n = dv.getUint32(0x116, false), room = Math.floor((len - CH_DATA) / 8);
      t0 = dv.getFloat32(0x11A, false); t1 = dv.getFloat32(0x11E, false);
      var asDoubles = ver === '179' || (n > 0 && Math.abs(room - n) <= 1);
      if (asDoubles) {
        if (!n || n > room) { if (n > room) w.push('Header says ' + n + ' points but the file holds ' + room + '; file may be truncated.'); n = room; }
        for (var i = 0; i < n; i++) vals.push(dv.getFloat64(CH_DATA + 8 * i, true) * scale);
      } else { // double-delta: int16 second differences, 0x7FFF escapes a 48-bit absolute value
        var v = 0, dd = 0;
        while (p + 2 <= len && (!n || vals.length < n)) {
          var x = dv.getInt16(p, false); p += 2;
          if (x === 32767) { if (p + 6 > len) break; v = dv.getInt32(p, false) * 65536 + dv.getUint16(p + 4, false); dd = 0; p += 6; }
          else { dd += x; v += dd; }
          vals.push(v * scale);
        }
        w.push('Read with double-delta decoding (181 layout).');
      }
    }
    if (!vals.length) return fail('Agilent ChemStation .ch', 'The header was read (version ' + ver + ') but no data points were found after it.');
    var n2 = vals.length, xs = [];
    if (!(t1 > t0)) { w.push('Start/end times missing in the header; x is the point index.'); for (var j = 0; j < n2; j++) xs.push(j); }
    else for (var q = 0; q < n2; q++) xs.push((t0 + (t1 - t0) * (n2 > 1 ? q / (n2 - 1) : 0)) / 60000);
    var yUnit = normYUnit(units) || units || (ver === '179' || ver === '181' ? 'pA' : 'mAU');
    var name = (meta.sampleName || baseName(opts.filename) || 'ChemStation') + (signal ? ' ' + signal.split(',')[0] : '');
    return okRes('Agilent ChemStation .ch', [mkTrace(name, xs, vals, 'min', yUnit, meta)], w);
  }
  P.register({
    id: 'agilent-ch', name: 'Agilent ChemStation .ch', extensions: ['ch'], binary: true,
    description: 'Binary signal files: 130/131 (delta-encoded LC) and 179/181 (doubles / double-delta).',
    sniff: function (head) {
      var n = head.charCodeAt(0), a = head.substr(1, n);
      if (n >= 2 && n <= 3 && /^(130|131|30|31|179|181)$/.test(a)) return 0.95;
      if (head.length > 0x150) { var b = ''; for (var i = 0; i < head.charCodeAt(0x146) && i < 4; i++) b += head.charAt(0x147 + 2 * i); if (/^(130|131|179|181)$/.test(b)) return 0.9; }
      return 0;
    },
    parse: function (buf, opts) { return parseCh(buf, opts || {}); }
  });

  /* ======================= plugin: unsupported binaries (friendly errors) ======================= */
  P.register({
    id: 'unsupported', name: 'Unsupported binary', extensions: ['raw', 'lcd', 'uv', 'cmbx', 'dat2', 'zip', 'd', 'ms'], binary: true,
    sniff: function (head, fn) {
      var ext = extOf(fn);
      if (/^\u0089HDF/.test(head)) return 0.9;
      if (head.charCodeAt(0) === 1 && head.charCodeAt(1) === 0xA1) return 0.9;
      if (head.slice(0, 4) === 'ÐÏ\u0011à' && ext !== 'xls') return 0.6;
      if (head.slice(0, 4) === 'PK\u0003\u0004' && !/xl\/|\[Content_Types\]/.test(head) && !/^(xlsx|xlsm|ods)$/.test(ext)) return 0.6;
      if (ext === 'uv' || (head.charCodeAt(0) === 3 && head.substr(1, 3) === '131' && ext === 'uv')) return 0.92;
      return 0;
    },
    parse: function (buf, opts) {
      var u8 = new Uint8Array(buf), head = latin1(u8, 0, 8), ext = extOf(opts && opts.filename), msg;
      if (/^\u0089HDF/.test(head)) msg = 'This is an HDF5 / netCDF-4 file. Peakly reads classic netCDF-3 (AIA/ANDI .cdf). Re-export the run as AIA/ANDI from the instrument software.';
      else if (u8[0] === 1 && u8[1] === 0xA1) msg = 'This is a Thermo .raw file (proprietary). Export the chromatogram as text from Chromeleon/FreeStyle, or convert to mzML with msconvert.';
      else if (ext === 'uv') msg = 'This is an Agilent .uv (full DAD spectra) file. Open the matching single-wavelength DAD1A.ch file instead, or export the signal as CSV.';
      else if (head.slice(0, 4) === 'ÐÏ\u0011à') msg = 'This is a Microsoft compound file' + (ext === 'lcd' ? ' (Shimadzu LabSolutions .lcd)' : '') + '. Export the chromatogram as ASCII text (LabSolutions: File > Export Data > ASCII) or as CSV.';
      else if (head.slice(0, 2) === 'PK') msg = 'This is a ZIP archive. Unzip it and open the chromatogram file inside (.ch, .cdf, .csv, .txt…).';
      else msg = 'This binary file type is not supported. Export the chromatogram as CSV/TXT or AIA/ANDI (.cdf).';
      return fail('Unsupported binary', msg);
    }
  });

  /* ======================= vendor text exports ======================= */
  // Agilent ChemStation / OpenLab CSV & TXT (often UTF-16LE, no header, minutes / mAU).
  P.register({
    id: 'agilent-text', name: 'Agilent ChemStation/OpenLab export', extensions: ['csv', 'txt'], binary: false,
    sniff: function (head, fn, info) {
      if (/ChemStation|OpenLab|Agilent|\b(DAD|VWD|MWD|FLD|RID|ADC)\d?\s*[A-Z]?\s*,\s*Sig\s*=/i.test(head)) return 0.8;
      if (/^(DAD|VWD|MWD|FLD|RID|ADC)\d/i.test(baseName(fn))) return 0.7;
      if (info && /^utf-16/.test(info.encoding || '') && /^\s*[+-]?[\d.]+(E[+-]?\d+)?\s*[\t,]\s*[+-]?[\d.]/im.test(head)) return 0.6;
      return 0;
    },
    parse: function (text, opts) {
      var r = tableToResult(text, 'Agilent ChemStation/OpenLab export', opts || {}, { xUnit: 'min', xUnitTrusted: true, yUnit: 'mAU', quietY: true });
      var sig = /\b((?:DAD|VWD|MWD|FLD|RID|ADC)\d?\s*[A-Z]?\s*,\s*Sig\s*=\s*[\d.]+[^\r\n"]*)/i.exec(text) || /^((?:DAD|VWD|MWD|FLD|RID|ADC)\d[A-Z]?)/i.exec(baseName(opts && opts.filename));
      (r.traces || []).forEach(function (t) { if (sig) { t.meta.channel = t.meta.channel || trim(sig[1]); var wl = wavelengthOf(sig[1]); if (wl) t.meta.wavelength = wl; } });
      return r;
    }
  });

  // Thermo Chromeleon ASCII: header key/value block + "Chromatogram Data:" table.
  P.register({
    id: 'chromeleon', name: 'Thermo Chromeleon ASCII', extensions: ['txt', 'csv'], binary: false,
    sniff: function (head) { return /^\s*Chromatogram Data:\s*$/im.test(head) ? 0.95 : (/Chromatogram Data Information:|^\s*Raw Data:\s*$/im.test(head) ? 0.75 : 0); },
    parse: function (text, opts) {
      opts = opts || {};
      var lines = splitLines(text), cut = -1;
      for (var i = 0; i < lines.length; i++) if (/^\s*Chromatogram Data:\s*$/i.test(lines[i])) { cut = i; break; }
      if (cut < 0) return fail('Thermo Chromeleon ASCII', 'Found a Chromeleon header but no "Chromatogram Data:" line followed by a data table. Re-export with "Raw data" / chromatogram data enabled.');
      var hdr = kvMeta(lines.slice(0, cut).filter(function (l) { return !/:\s*$/.test(trim(l)); }));
      var yu = hdr['Signal Unit'] || hdr['Signal Units'];
      var meta = deriveMeta(hdr);
      var r = tableToResult(lines.slice(cut + 1).join('\n'), 'Thermo Chromeleon ASCII', opts, { xUnit: 'min', yUnit: normYUnit(yu) || yu || null }, meta);
      (r.traces || []).forEach(function (t) {
        if (meta.sampleName && r.traces.length === 1) t.name = meta.sampleName + (meta.channel ? ' ' + meta.channel : '');
        if (meta.channel && !t.meta.wavelength) { var wl = wavelengthOf(meta.channel); if (wl) t.meta.wavelength = wl; }
      });
      return r;
    }
  });

  // Shimadzu LabSolutions ASCII: [Section] blocks; chromatogram sections with Multiplier.
  P.register({
    id: 'shimadzu', name: 'Shimadzu LabSolutions ASCII', extensions: ['txt', 'csv'], binary: false,
    sniff: function (head) { return /^\s*\[Header\]/m.test(head) && /LabSolutions|Chromatogram|\[File Information\]/i.test(head) ? 0.95 : (/^\s*\[(LC |PDA |GC )?.*Chromatogram.*\]/im.test(head) ? 0.8 : 0); },
    parse: function (text, opts) {
      opts = opts || {};
      var lines = splitLines(text), secs = [], cur = null, w = [];
      lines.forEach(function (l) { var m = /^\s*\[(.+)\]\s*$/.exec(l); if (m) { cur = { name: m[1], lines: [] }; secs.push(cur); } else if (cur) cur.lines.push(l); });
      var header = {}; secs.forEach(function (s) { if (/^(header|file information|sample information|original files)$/i.test(s.name)) kvMeta(s.lines, header); });
      var base = deriveMeta(header), traces = [];
      secs.forEach(function (s) {
        if (!/chromatogram/i.test(s.name) || /peak|compound|3d|spectrum/i.test(s.name)) return;
        var t = P.parseDelimited(s.lines.join('\n'));
        if (!t.rows.length) return;
        var kv = kvMeta(t.preamble), mult = NaN;
        Object.keys(kv).forEach(function (k) { if (/multiplier/i.test(k)) mult = parseNum(kv[k], t.decimalComma) || parseNum(kv[k], false); });
        if (!isFinite(mult) || mult === 0) mult = 1;
        var yuk = Object.keys(kv).filter(function (k) { return /intensity\s*units?|^units?$/i.test(k); })[0];
        var m = autoMap(t, { xUnit: 'min', xUnitTrusted: true, yUnit: normYUnit(kv[yuk]) || kv[yuk] || 'mV', quietY: true });
        if (!m.ok || m.pairs) { w.push('Section [' + s.name + ']: ' + (m.reason || 'unexpected layout') + ' — skipped.'); return; }
        m.yUnits = m.yUnits.map(function () { return normYUnit(kv[yuk]) || kv[yuk] || 'mV'; });
        var meta = assign({}, base, { section: s.name, sectionHeader: kv, multiplier: mult });
        var wl = parseFloat(kv['Wavelength(nm)'] || kv['Wavelength (nm)']) || wavelengthOf(s.name + ' ' + (kv['Detector Name'] || '')); if (wl) meta.wavelength = wl;
        var ch = /\(([^)]*)\)/.exec(s.name); meta.channel = ch ? ch[1] : s.name;
        P.buildTraces(t, assign({}, m, { yScale: mult, meta: meta, names: [(base.sampleName || baseName(opts.filename) || 'Shimadzu') + ' ' + meta.channel] })).forEach(function (tr) { traces.push(tr); });
      });
      if (!traces.length) return fail('Shimadzu LabSolutions ASCII', 'No [... Chromatogram ...] section with data was found. In LabSolutions, export with "Chromatogram" ticked in the ASCII output options.' + (w.length ? ' ' + w.join(' ') : ''));
      return okRes('Shimadzu LabSolutions ASCII', traces, w);
    }
  });

  // Waters Empower .arw: quoted key line + quoted value line, then 2-column data.
  P.register({
    id: 'waters-arw', name: 'Waters Empower .arw', extensions: ['arw'], binary: false,
    sniff: function (head) { return /^\s*"(SampleName|Sample Name|Channel|Channel Name|Injection|Vial|Sample Set Name|Result Id|Date Acquired)"/i.test(head) ? 0.9 : 0; },
    parse: function (text, opts) {
      opts = opts || {};
      var lines = splitLines(text), i = 0, q = [];
      while (i < lines.length && (/^\s*"/.test(lines[i]) || !trim(lines[i]))) { if (trim(lines[i])) q.push(lines[i]); i++; }
      var hdr = {};
      for (var k = 0; k + 1 < q.length; k += 2) {
        var d = q[k].indexOf('\t') >= 0 ? '\t' : ',', keys = splitLine(q[k], d).map(unquote), vals = splitLine(q[k + 1], d).map(unquote);
        keys.forEach(function (key, j) { if (key) hdr[key] = vals[j] != null ? vals[j] : ''; });
      }
      var meta = deriveMeta(hdr), unitKey = Object.keys(hdr).filter(function (k2) { return /unit/i.test(k2); })[0];
      var yu = (unitKey && (normYUnit(hdr[unitKey]) || hdr[unitKey])) || (meta.wavelength || /pda|uv|tuv|nm/i.test(meta.channel || '') ? 'AU' : null);
      var r = tableToResult(lines.slice(i).join('\n'), 'Waters Empower .arw', opts, { xUnit: 'min', xUnitTrusted: true, yUnit: yu || 'a.u.', quietY: true, parse: { noHeader: true } }, meta);
      if (r.ok && !yu) r.warnings.push('No unit in the Empower header; signal unit set to "a.u.".');
      (r.traces || []).forEach(function (t) { if (r.traces.length === 1) t.name = (meta.sampleName || baseName(opts.filename) || 'Empower') + (meta.channel ? ' ' + meta.channel : ''); });
      return r;
    }
  });

  // Cytiva/GE UNICORN CSV/ASC: name row + units row in (x, y) column pairs; x usually volume (ml).
  function unicornLayout(lines) {
    var d = null, best = 0;
    ['\t', ';', ','].forEach(function (c) { var n = 0; lines.slice(0, 10).forEach(function (l) { n += l.split(c).length - 1; }); if (n > best) { best = n; d = c; } });
    if (!d) return null;
    for (var i = 0; i < Math.min(lines.length, 40); i++) {
      var f = splitLine(lines[i], d).map(unquote), pairs = 0;
      for (var j = 0; j + 1 < f.length; j += 2) if (/^(ml|min|cv)$/i.test(f[j]) && f[j + 1] && isNaN(parseNum(f[j + 1]))) pairs++;
      if (pairs >= 1 && /^(ml|min|cv)$/i.test(f[0])) return { d: d, ui: i, units: f };
    }
    return null;
  }
  function parseUnicorn(text, opts) {
    var lines = splitLines(text), L = unicornLayout(lines);
    if (!L) return fail('Cytiva UNICORN export', 'Couldn\'t find the UNICORN units row (e.g. "ml, mAU, ml, mS/cm"). Re-export from UNICORN Evaluation as CSV/ASC with curve headers.');
    var names = L.ui > 0 ? splitLine(lines[L.ui - 1], L.d).map(unquote) : [], run = L.ui > 1 ? splitLine(lines[L.ui - 2], L.d).map(unquote) : [];
    var np = Math.ceil(L.units.length / 2), curves = [], toks = [];
    for (var k = L.ui + 1; k < lines.length && toks.length < 3000; k++) splitLine(lines[k], L.d).forEach(function (t) { toks.push(t); });
    var dc = L.d === ',' ? false : decideDC(toks);
    for (var j = 0; j < np; j++) curves.push({ name: names[2 * j] || names[2 * j + 1] || 'Curve ' + (j + 1), xu: L.units[2 * j], yu: L.units[2 * j + 1] || '', xs: [], ys: [], ev: [] });
    for (var i = L.ui + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var f = splitLine(lines[i], L.d);
      for (j = 0; j < np; j++) {
        var x = parseNum(f[2 * j] || '', dc); if (!isFinite(x)) continue;
        var ys = unquote(f[2 * j + 1] || ''), y = parseNum(ys, dc);
        if (isFinite(y)) { curves[j].xs.push(x); curves[j].ys.push(y); } else if (ys) curves[j].ev.push({ x: x, label: ys });
      }
    }
    var traces = [], events = [], w = [], flow = +opts.flow, vol = false;
    var base = baseName(opts.filename), runName = run.filter(Boolean)[0];
    curves.forEach(function (c) {
      var xu = normXUnit(c.xu) || 'mL';
      var conv = function (x) { return xu === 'mL' && flow > 0 ? x / flow : xu === 'sec' ? x / 60 : x; };
      c.ev.forEach(function (e) { events.push({ curve: c.name, x: conv(e.x), label: e.label }); });
      if (!c.xs.length) return;
      var yu = normYUnit(c.yu) || c.yu || 'a.u.', role = roleOf(c.name, yu), meta = { column: c.name };
      if (role !== 'signal') meta.role = role;
      if (role === 'gradient' && yu === 'a.u.') yu = '%';
      var wl = wavelengthOf(c.name); if (wl) meta.wavelength = wl;
      if (runName) meta.sampleName = runName;
      var tr = mkTrace((runName || base ? (runName || base) + ' · ' : '') + c.name, c.xs, c.ys, xu, yu, meta, flow);
      if (tr.meta.xIsVolume) vol = true;
      traces.push(tr);
    });
    traces.sort(function (a, b) { return (a.meta.role ? 1 : 0) - (b.meta.role ? 1 : 0); });
    if (events.length && traces[0]) traces[0].meta.events = events;
    if (vol) w.push('The x axis is elution volume (mL). Enter the flow rate to convert to minutes.');
    if (!traces.length) return fail('Cytiva UNICORN export', 'Found the UNICORN header but no numeric curve data under it.');
    return okRes('Cytiva UNICORN export', traces, w, { events: events });
  }
  P.register({
    id: 'unicorn', name: 'Cytiva UNICORN export', extensions: ['asc', 'csv', 'txt'], binary: false,
    description: 'Multi-curve (x, y) column pairs; volume x kept as mL unless flow is given.',
    sniff: function (head) {
      if (/^\s*"?ml"?\s*[\t,;]\s*"?(mAU|mS\/cm|%|MPa|pH|°C|C)"?/im.test(head)) return 0.92;
      return /UNICORN|Chrom\.\d/i.test(head) && /\bml\b/i.test(head) ? 0.6 : 0;
    },
    parse: function (text, opts) { return parseUnicorn(text, opts || {}); }
  });

  // Bio-Rad ChromLab / NGC CSV: metadata lines then multi-column table (time/volume + UV, conductivity, %B ...).
  P.register({
    id: 'biorad', name: 'Bio-Rad ChromLab/NGC export', extensions: ['csv', 'txt'], binary: false,
    sniff: function (head) {
      if (/ChromLab|NGC|Bio-?Rad/i.test(head)) return 0.85;
      return /Volume\s*\(ml\)/i.test(head) && /Conductivity/i.test(head) && /UV/i.test(head) ? 0.55 : 0;
    },
    parse: function (text, opts) {
      opts = opts || {};
      var r = tableToResult(text, 'Bio-Rad ChromLab/NGC export', opts, { xUnit: 'min' });
      if (r.ok && r.traces.some(function (t) { return t.meta.xIsVolume; })) r.warnings.push('The x axis is elution volume (mL). Enter the flow rate to convert to minutes.');
      if (r.ok) r.traces.sort(function (a, b) { return (a.meta.role ? 1 : 0) - (b.meta.role ? 1 : 0); });
      return r;
    }
  });

  // Internals exposed for tests / app helpers.
  P._internal = { parseNum: parseNum, decideDC: decideDC, decodeBytes: decodeBytes, looksText: looksText, decodeAsdf: decodeAsdf, readNetCDF: readNetCDF,
    b64decode: b64decode, kvMeta: kvMeta, xUnitFromHeader: xUnitFromHeader, yUnitFromHeader: yUnitFromHeader, roleOf: roleOf, wavelengthOf: wavelengthOf, latin1: latin1 };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
