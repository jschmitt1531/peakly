/* SPDX-License-Identifier: MIT */
/* Minimal test harness shared by Node runner and in-app Self-test. */
(function (PK) {
  'use strict';
  var tests = [];
  PK.test = function (name, fn) { tests.push({ name: name, fn: fn }); };
  PK.test.list = tests;
  function T() { this.fails = []; this.count = 0; }
  T.prototype.ok = function (c, m) { this.count++; if (!c) this.fails.push(m || 'assertion failed'); };
  T.prototype.eq = function (a, b, m) { this.count++; if (a !== b) this.fails.push((m || 'eq') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); };
  T.prototype.near = function (a, b, tol, m) { this.count++; if (!(Math.abs(a - b) <= tol)) this.fails.push((m || 'near') + ': got ' + a + ', expected ' + b + ' ±' + tol); };
  T.prototype.throws = function (fn, m) { this.count++; try { fn(); this.fails.push((m || 'throws') + ': did not throw'); } catch (e) { /* ok */ } };
  PK.runTests = function (filter) {
    var results = [];
    return tests.filter(function (t) { return !filter || t.name.indexOf(filter) >= 0; }).reduce(function (p, tc) {
      return p.then(function () {
        var t = new T(), t0 = Date.now();
        return Promise.resolve().then(function () { return tc.fn(t); }).then(function () {
          results.push({ name: tc.name, pass: !t.fails.length, fails: t.fails, assertions: t.count, ms: Date.now() - t0 });
        }, function (err) {
          results.push({ name: tc.name, pass: false, fails: ['threw: ' + (err && err.stack || err)], assertions: t.count, ms: Date.now() - t0 });
        });
      });
    }, Promise.resolve()).then(function () { return results; });
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
