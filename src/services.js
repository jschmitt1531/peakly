/* SPDX-License-Identifier: MIT */
/* Optional services interface. The core app runs fully offline with zero accounts; extras such as cloud save,
   team sharing or accounts plug in here as separate modules and are OFF unless enabled in PK.config.services.
   A service is a plain object: { id, name, capabilities:['save'|'load'|'share'|'auth'], configKey,
   save(project)→Promise<{ref}>, load(ref)→Promise<project>, share(project)→Promise<{url}>, signIn()/signOut() }. */
(function (PK) {
  'use strict';
  var registry = {};
  var CAPS = ['save', 'load', 'share', 'auth'];
  PK.services = {
    register: function (svc) {
      if (!svc || !svc.id) throw new Error('Service needs an id');
      (svc.capabilities || []).forEach(function (c) { if (CAPS.indexOf(c) < 0) throw new Error('Unknown capability: ' + c); });
      registry[svc.id] = svc; return svc;
    },
    get: function (id) { return registry[id] || null; },
    list: function () { return Object.keys(registry).map(function (k) { return registry[k]; }); },
    // Enabled only if the module is registered AND its config flag is explicitly true.
    isEnabled: function (id) {
      var s = registry[id], flags = (PK.config && PK.config.services) || {};
      return !!(s && s.configKey && flags[s.configKey] === true);
    },
    enabled: function (cap) { return PK.services.list().filter(function (s) { return PK.services.isEnabled(s.id) && (!cap || (s.capabilities || []).indexOf(cap) >= 0); }); },
    CAPABILITIES: CAPS
  };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
