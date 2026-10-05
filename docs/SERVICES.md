# Optional services layer

Peakly's core is, and will stay, a free single-file app that works with **no server, no account and no network** beyond its pinned libraries. Some users will want extras such as saving projects to the cloud, sharing them with a team, or signing in. This page describes how such extras plug in **without touching the core**, and the rules they must follow.

> **Status (1.1.0):** the interface (`PK.services`, in [`src/services.js`](../src/services.js)) exists. **No services are shipped.** All service flags in `PK.config.services` are `false`, and the UI shows no service buttons.

## Design principles

1. **Off by default.** A service runs only if its module is loaded **and** its flag in `PK.config.services` is explicitly `true`. The default build has neither.
2. **Separate layer.** Services live in their own files and builds. Core modules (`parsers`, `analysis`, `digitizer`, `app`) never import or require a service; they only ask `PK.services` whether one is enabled for a capability.
3. **Core never degrades.** Every feature works identically with all services off. Services only *add* buttons (for example "Save to cloud" next to "Save project file").
4. **Same data format.** Services save and load the standard project file ([SCHEMA.md](SCHEMA.md)), so users can always export and leave.
5. **User-initiated only.** No background sync, no automatic uploads. Every network action follows a click that clearly says where the data goes.

## Interface

```js
PK.services.register(service)   // add a service module (throws on unknown capabilities)
PK.services.list()              // all registered services
PK.services.get(id)             // one service or null
PK.services.isEnabled(id)       // true only if registered AND PK.config.services[service.configKey] === true
PK.services.enabled(cap)        // enabled services offering a capability ('save'|'load'|'share'|'auth')
PK.services.CAPABILITIES        // ['save', 'load', 'share', 'auth']
```

A service is a plain object:

```js
{
  id: 'mycloud',                       // unique id
  name: 'My Cloud',                    // shown on buttons and in About
  capabilities: ['save', 'load', 'share', 'auth'],
  configKey: 'cloudSave',              // which PK.config.services flag enables it
  save:  function (project) { return Promise.resolve({ ref: '…' }); },     // store a project file
  load:  function (ref)     { return Promise.resolve(project); },          // fetch one back
  share: function (project) { return Promise.resolve({ url: '…' }); },     // create a share URL
  signIn:  function () { return Promise.resolve(); },
  signOut: function () { return Promise.resolve(); }
}
```

The app calls only these methods, and only after a user click. Projects passed in are deep copies; services must not mutate app state directly. Projects returned by `load` go through `PK.schema.migrate` and `validateProject` like any opened file.

## Building a cloud-save module (example)

Build it as a separate file that is appended to a **separate build** (for example `build-services.js` that writes `peakly-cloud.html`), never to the default `index.html`:

```js
/* SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0 */
(function (PK) {
  'use strict';
  if (!PK.services) return;
  var ENDPOINT = 'https://api.example.org/peakly/projects';   // your service, documented to users
  PK.services.register({
    id: 'example-cloud', name: 'Example Cloud', capabilities: ['save', 'load'], configKey: 'cloudSave',
    save: function (project) {
      return fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project), credentials: 'include' })
        .then(function (r) { if (!r.ok) throw new Error('Save failed: ' + r.status); return r.json(); })
        .then(function (j) { return { ref: j.id }; });
    },
    load: function (ref) {
      return fetch(ENDPOINT + '/' + encodeURIComponent(ref), { credentials: 'include' })
        .then(function (r) { if (!r.ok) throw new Error('Load failed: ' + r.status); return r.json(); });
    }
  });
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
```

and set the flag in that build's config:

```js
PK.config.services = { cloudSave: true, teamSharing: false, accounts: false };
```

Test it with a fake service in Node (see `tests/services.test.js`): register, check `isEnabled` is false until the flag is set, and check the core still works with it disabled.

## Privacy and security requirements

Any service that is to be listed in Peakly's docs or distributed by the project must:

- **Say what leaves the browser, and where.** A one-screen notice before the first use, naming the operator, the endpoint, the data sent (the project file, which may include embedded images) and the retention period.
- **Collect the minimum.** No analytics, telemetry or tracking pixels, in the service module or in pages it opens. Authentication data is used only to authenticate.
- **Encrypt in transit** (HTTPS only) and **at rest**. Prefer client-side encryption (the user holds the key) for stored projects.
- **Let users leave.** Export everything in the standard project format, and delete on request, including backups within a stated period.
- **Store no secrets in the browser persistently** without consent; tokens in memory or in HttpOnly cookies scoped to the service, never in project files or share links.
- **Respect regulated data rules.** State plainly that the service is not validated for GMP/GLP use, and is not for patient-identifiable data unless the operator has the appropriate agreements in place.
- **Pass review.** Service modules are reviewed like core code (license, no telemetry, CSP-compatible) and must follow [SECURITY.md](../SECURITY.md).

## Governance

Services are optional and separately hosted. Their existence never changes the core principles in [GOVERNANCE.md](../GOVERNANCE.md#core-principles-not-up-for-a-vote): the core stays free, private and fully functional offline, and no feature is moved behind a service.
