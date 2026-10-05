/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
(function (PK) {
  'use strict';
  PK.test('services: registered extras stay OFF unless explicitly enabled', function (t) {
    var S = PK.services, saved = PK.config.services.cloudSave;
    S.register({ id: 'demo-cloud', name: 'Demo', capabilities: ['save'], configKey: 'cloudSave' });
    t.eq(S.isEnabled('demo-cloud'), false, 'off by default');
    t.eq(S.enabled('save').length, 0, 'no enabled save services');
    PK.config.services.cloudSave = true; t.eq(S.isEnabled('demo-cloud'), true, 'on when flagged');
    PK.config.services.cloudSave = saved;
    t.throws(function () { S.register({ id: 'x', capabilities: ['telemetry'] }); }, 'unknown capability rejected');
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
