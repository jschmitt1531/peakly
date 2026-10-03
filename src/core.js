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
  U.escapeHtml = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
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
