# Design: DepLatch Playground

## Overview

The Playground is a zero-dependency, zero-build static page that makes DepLatch's verdict logic runnable in any browser. It reuses the pure Node modules from `packages/npm/src/` through ES-module wrappers and calls the npm and PyPI registries directly from the browser.

```
web/
  index.html          single HTML file; all CSS inline in <style>
  app.js              page logic (input detection, fetch, render)
packages/npm/src/
  popular.js          (unchanged CommonJS; wrapped via esm-shim below)
  similarity.js       (unchanged CommonJS; wrapped)
  parse.js            (unchanged CommonJS; wrapped)
  verdict.js          (unchanged CommonJS; wrapped)
  popular.esm.js      thin ES-module re-export  (new)
  similarity.esm.js   thin ES-module re-export  (new)
  parse.esm.js        thin ES-module re-export  (new)
  verdict.esm.js      thin ES-module re-export  (new)
```

The `.esm.js` wrappers are the only new files in `packages/npm/src/`. They use a guard pattern so the same content also passes `require()` in Node, keeping the existing tests working unchanged.

## Module sharing strategy

Each wrapper follows this pattern (using `verdict.esm.js` as the example):

```js
// verdict.esm.js — loads as ES module in browser, ignored by Node's require()
import popular from './popular.esm.js';
import { closestPopular, normalize } from './similarity.esm.js';

// --- paste the body of verdict.js here, replacing require() calls ---
// (or, cleaner: define everything and re-export)

export { decide, DEFAULT_POLICY };
```

Because the browser uses `<script type="module">` and Node's `require()` only reads `.js` files via the `main` field (which stays pointed at `src/index.js`), neither side is affected by the other's loading mechanism.

`app.js` imports only the `.esm.js` wrappers:

```js
import { parseInstallCommand } from '../packages/npm/src/parse.esm.js';
import { decide, DEFAULT_POLICY }   from '../packages/npm/src/verdict.esm.js';
```

## Input detection algorithm

```
detectFormat(text):
  if parseInstallCommand(text) finds ≥1 package → "install-command"
  else if JSON.parse(text) succeeds and any dep field present → "package-json"
  else if lines match requirements.txt pattern and no installer keyword → "requirements-txt"
  else → "bare-names"
```

`package.json` and `requirements.txt` parsing mirrors `scanProject()` from `index.js` (re-implemented inline in `app.js` since `index.js` uses `fs`).

## Registry calls

`lookupNpm` and `lookupPypi` from `registry.js` are **not** shared — they already use `fetch` with injectable `fetchImpl`, but they also use `Date.now()` and throw structured errors. `app.js` contains a minimal browser-side equivalent (`browserLookup`) that:

1. Calls `fetch()` directly.
2. Returns the same evidence shape (`{ exists, ageDays, latestVersion, repository, deprecated }`).
3. On network error or non-200/404, returns `{ exists: null }` and sets `error` so `decide()` produces `REGISTRY_ERROR → review`.

This keeps `registry.js` free of browser/Node coupling and avoids duplicating its logic elsewhere in the Node package.

## Rendering model

No framework. The page is built with plain DOM APIs.

```
render(results):
  sort: blocked → review → verified
  for each result:
    row = createElement(...)
    row.querySelector('.name').textContent = result.name   // safe
    row.querySelector('.message').textContent = reason.message  // safe
    // never innerHTML with untrusted data
```

All user-visible strings go through `textContent` or `setAttribute` on safe attributes. The only `innerHTML` calls set static, developer-controlled HTML strings (e.g. the page skeleton).

## Trustfile download

```js
function downloadTrustfile(results, policy) {
  const tf = {
    trustfile: '0.1',
    generatedAt: new Date().toISOString(),
    generator: { name: 'deplatch-playground', version: '0.1.0' },
    policy,
    summary: countVerdicts(results),
    packages: results,
  };
  const blob = new Blob([JSON.stringify(tf, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trustfile.json';
  a.click();
}
```

## Layout (mobile-first)

```
┌─────────────────────────────────────┐  375px
│  DepLatch Playground                │
│  ─────────────────────────────────  │
│  [textarea: paste names/command/…]  │
│  Detected: npm install command  [?] │
│  [Ecosystem: npm ▾]  (if bare names)│
│  ─────────────────────────────────  │
│  ▸ Policy  (collapsed by default)   │
│    minAgeDays [30]                  │
│    onReview   [warn ▾]              │
│    requireRepository [ ]            │
│  ─────────────────────────────────  │
│  2 Verified  1 Review  1 Blocked    │
│  [Download trustfile.json]          │
│  ─────────────────────────────────  │
│  ✗ Blocked                          │
│    npm  ai-super-helper             │
│    Not found on npm. AI assistants… │
│  ─────────────────────────────────  │
│  ⚠ Review                           │
│    npm  new-auth-utils              │
│    First published 2 days ago…      │
│  ─────────────────────────────────  │
│  ✓ Verified                         │
│    npm  react                       │
└─────────────────────────────────────┘
```

CSS uses `max-width: 760px; margin: auto; padding: 1rem` on a single column. No grid, no flexbox tricks that break at 375px. Font stack: system-ui.

## GitHub Pages workflow

`.github/workflows/pages.yml`:

1. Trigger: `push` to `main`.
2. Steps: checkout → setup-node → setup-python → `npm test` → `python -m unittest` → upload-pages-artifact (`web/`) → deploy-pages.
3. Permissions: `pages: write`, `id-token: write`, `contents: read`.
4. `ci.yml` is not touched; it continues to run on every push and PR.

## Security model

- No `eval`, no `innerHTML` with untrusted data, no `document.write`.
- No external resources; the `Content-Security-Policy` (set by GitHub Pages' default headers) is not violated.
- Registry calls are GET-only; no credentials are sent.
- The page works fully without JavaScript disabled (it shows a `<noscript>` message).

## Test plan

Tests live in `packages/npm/test/playground.test.js` and run under `node:test`.

| Test | Covers |
|---|---|
| `detectFormat` returns correct type for each input variant | Req 1 |
| `browserLookup` mock: 404 → `exists: false`, error → `error` set | Req 7.3 |
| `decide()` via ESM wrapper equals `decide()` via CJS for 20 evidence/policy combos | Req 6.4 / P-S3 |
| `countVerdicts(results)` equals manual count for random result arrays | Req 3.1 / P-S1 |
| `escapeHtml('<script>') === '&lt;script&gt;'` and similar | Req 7.1 / P-S2 |
| Existing `deplatch.test.js` suite passes without modification | Req 6.3 |

Property-style tests run inline in `playground.test.js` over generated inputs.
