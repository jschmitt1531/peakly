/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
/* Peakly core: namespace, event bus, utilities. */
(function (PK) {
  'use strict';
  PK.version = '1.0.0';
  var _n = 0;
  PK.uid = function (prefix) { _n++; return (prefix || 'id') + '_' + Date.now().toString(36) + _n.toString(36) + Math.floor(Math.random() * 1e6).toString(36); };

  var handlers = {};
  PK.bus = {
    on: function (e, fn) { (handlers[e] = handlers[e] || []).push(fn); },
    off: function (e, fn) { handlers[e] = (handlers[e] || []).filter(function (f) { return f !== fn; }); },
    emit: function (e, p) { (handlers[e] || []).slice().forEach(function (f) { try { f(p); } catch (err) { console.error(err); } }); }
  };

  var U = PK.util = {};
  U.linspace = function (a, b, n) { var out = new Array(n); if (n === 1) { out[0] = a; return out; } for (var i = 0; i < n; i++) out[i] = a + (b - a) * i / (n - 1); return out; };
  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.bsearch = function (xs, x) { // index i such that xs[i] <= x < xs[i+1]
    var lo = 0, hi = xs.length - 1;
    if (x <= xs[0]) return 0; if (x >= xs[hi]) return hi;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return lo;
  };
  U.interp1 = function (xs, ys, x) {
    var n = xs.length; if (!n) return NaN; if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    var i = U.bsearch(xs, x), x0 = xs[i], x1 = xs[i + 1];
    return x1 === x0 ? ys[i] : ys[i] + (ys[i + 1] - ys[i]) * (x - x0) / (x1 - x0);
  };
  U.resample = function (x, y, xNew) { return Array.prototype.map.call(xNew, function (v) { return U.interp1(x, y, v); }); };
  U.median = function (arr) { var a = Array.prototype.slice.call(arr).filter(function (v) { return isFinite(v); }).sort(function (p, q) { return p - q; }); if (!a.length) return NaN; var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  U.fmt = function (v, digits) {
    if (v === null || v === undefined || typeof v !== 'number' || !isFinite(v)) return '—';
    digits = digits == null ? 4 : digits;
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(Math.max(1, digits - 1));
    return Number(v.toPrecision(digits)).toString();
  };
  U.escapeHtml = function (s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]; }); };
  U.downloadBlob = function (blob, filename) {
    if (typeof document === 'undefined') return;
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  U.downloadText = function (text, filename, mime) { U.downloadBlob(new Blob([text], { type: mime || 'text/plain' }), filename); };
  U.readFileAs = function (file, kind) {
    return new Promise(function (res, rej) {
      var r = new FileReader(); r.onerror = function () { rej(r.error); }; r.onload = function () { res(r.result); };
      if (kind === 'arraybuffer') r.readAsArrayBuffer(file); else if (kind === 'dataurl') r.readAsDataURL(file); else r.readAsText(file);
    });
  };
  U.deepClone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* ---- untrusted-input helpers (see docs/SECURITY_AUDIT.md) ---- */
  /** Keys that must never be copied from untrusted JSON (prototype pollution). */
  U.isSafeKey = function (k) { return k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; };
  /** Deep copy of JSON-like data with __proto__/constructor/prototype keys dropped, functions/undefined dropped,
      typed arrays turned into plain arrays and nesting cut at `maxDepth` (default 64; deeper values become null). */
  U.stripUnsafeKeys = function (v, maxDepth) {
    maxDepth = maxDepth == null ? 64 : maxDepth;
    function walk(o, d) {
      if (o === null || typeof o === 'string' || typeof o === 'number' || typeof o === 'boolean') return o;
      if (typeof o !== 'object') return undefined;
      if (d > maxDepth) return null;
      if (Array.isArray(o)) { var a = new Array(o.length); for (var i = 0; i < o.length; i++) { var w = walk(o[i], d + 1); a[i] = w === undefined ? null : w; } return a; }
      if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(o)) return Array.prototype.slice.call(o);
      var out = {};
      Object.keys(o).forEach(function (k) { if (!U.isSafeKey(k)) return; var w = walk(o[k], d + 1); if (w !== undefined) out[k] = w; });
      return out;
    }
    return walk(v, 0);
  };
  /** String coercion with a length cap (objects/arrays/functions → fallback). */
  U.safeString = function (v, max, fallback) {
    if (v == null || (typeof v === 'object') || typeof v === 'function') return fallback === undefined ? '' : fallback;
    var s = String(v); return max && s.length > max ? s.slice(0, max) : s;
  };
  /** Image data URL accepted from project files: base64 PNG/JPEG/WebP/GIF only. Anything else (http:, javascript:,
      SVG, text/html…) → null, so it can never become an <img src> or a Plotly layout image. */
  U.SAFE_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/;
  U.safeDataImage = function (s) { return typeof s === 'string' && s.length < 64e6 && U.SAFE_IMAGE_RE.test(s) ? s : null; };
  /** CSS/Plotly color from untrusted data: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with numbers, or a plain
      color keyword. Anything else → null (prevents CSS injection through style="background:…"). */
  U.safeColor = function (c) {
    if (typeof c !== 'string') return null;
    var s = c.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
    if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)$/i.test(s)) return s;
    if (/^[a-z]{3,20}$/i.test(s)) return s;
    return null;
  };
  /** Decode XML/HTML character references in text read from XML (attribute values, element text): the five predefined
      entities (&amp; &lt; &gt; &quot; &apos;) and numeric references (&#38; &#x26;). Unknown named entities are left as
      they are; invalid code points become U+FFFD. The result is plain text: escape it again before putting it in HTML. */
  U.decodeXmlEntities = function (s) {
    if (s == null) return '';
    s = String(s); if (s.indexOf('&') < 0) return s;
    var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return s.replace(/&(#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,10}|[a-zA-Z]+);/g, function (m, e) {
      if (e.charAt(0) !== '#') return Object.prototype.hasOwnProperty.call(named, e) ? named[e] : m;
      var cp = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(cp >= 1 && cp <= 0x10FFFF) || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
      return String.fromCodePoint(cp);
    });
  };
  /** Text for Plotly names, titles, annotations and hover templates. Plotly renders a subset of HTML (<a href>, <b>,
      <span style>…) in these strings, and `%{…}` is a template token in hovertemplate. Escape &, <, > and break `%{`
      with a numeric entity (Plotly decodes it back to "{" for display). */
  U.plotlyText = function (s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/%\{/g, '%&#123;');
  };

  PK.palette = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];

  PK.injectCSS = function (id, css) {
    if (typeof document === 'undefined' || document.getElementById(id)) return;
    var s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
  };
  PK.toast = function (msg, kind) {
    if (typeof document === 'undefined') return;
    var host = document.getElementById('pk-toasts');
    if (!host) { host = document.createElement('div'); host.id = 'pk-toasts'; document.body.appendChild(host); }
    var el = document.createElement('div'); el.className = 'pk-toast ' + (kind || 'info'); el.textContent = msg;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    host.appendChild(el); setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 400); }, kind === 'error' ? 7000 : 3500);
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
