# Design: Trust dashboard

## Shape
```
packages/npm/src/ui/
  handler.js   trustUI(options) -> (req, res, next)
  render.js    renderPage(trustfile) -> HTML string   (pure, property-tested)
```

`trustUI({ dir = process.cwd(), policy, enableInProduction = false })`
- On first call, starts `check(scanProject(dir), { policy })` and caches the promise.
- Routes, relative to the mount path: `/` → HTML, `/trust.json` → trustfile (`?refresh=1` re-scans). Anything else → `next()`.
- Production guard per Req 4.1.

## Rendering
- One HTML string with inline `<style>` and a tiny inline `<script>` for filter and search.
- `escapeHtml()` on every name, message and evidence value (Req 4.3).
- Sort key: `{blocked: 0, review: 1, verified: 2}`.
- Badges: `⛔ Blocked`, `⚠ Review`, `✓ Verified`, plus colour.

## Example use
```js
const express = require('express');
const { trustUI } = require('deplatch/ui');
const app = express();
app.use('/trust', trustUI());
app.listen(3000); // open http://localhost:3000/trust
```

## Testing
- `render.js` is pure: property tests for P1–P3 with generated trustfiles and hostile names.
- Handler tests with a fake request/response and an injected `check`.
