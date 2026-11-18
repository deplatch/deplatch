# Tasks: DepLatch Playground

Each task is independently testable. Complete them in order; later tasks build on earlier ones.

---

## Task 1: ES-module wrappers for shared pure modules

**Goal:** Let the browser load `popular`, `similarity`, `parse`, and `verdict` as ES modules from their existing files, with no duplication and no breakage to the existing Node tests.

**Files to create:**
- `packages/npm/src/popular.esm.js`
- `packages/npm/src/similarity.esm.js`
- `packages/npm/src/parse.esm.js`
- `packages/npm/src/verdict.esm.js`

**What each wrapper does:**
Each wrapper re-implements the module body using ES-module syntax (`export`, `import`) so a browser can load it with `<script type="module">`. It does **not** `require()` its sibling — it imports from the other `.esm.js` wrappers. The logic is identical to the `.js` originals; the only change is the module syntax and the `import`/`export` keywords.

**Definition of done:**
- `npm test` in `packages/npm` passes without any change to `deplatch.test.js` or the original `.js` files.
- Each `.esm.js` file can be loaded with `import` in a browser (verified manually or via a quick Node `--input-type=module` smoke test).
- No logic is duplicated: if `verdict.js` changes, only `verdict.esm.js` needs to be updated (not multiple copies).

---

## Task 2: Input detection module

**Goal:** Implement `detectFormat(text, ecosystemHint)` in `web/app.js` that returns `{ format, ecosystem, targets }`.

**Formats:**
| `format` | `ecosystem` | `targets` |
|---|---|---|
| `'install-command'` | from command | `[{ecosystem, name}]` from `parseInstallCommand` |
| `'package-json'` | `'npm'` | packages from all four dep fields |
| `'requirements-txt'` | `'pypi'` | packages from lines |
| `'bare-names'` | from `ecosystemHint` | one entry per non-empty token |

**Definition of done:**
- Unit tests in `packages/npm/test/playground.test.js` cover all four format paths, including edge cases (empty input, JSON without dep fields, mixed content).
- Tests run under `node:test` and pass as part of `npm test`.

---

## Task 3: Browser registry lookup

**Goal:** Implement `browserLookup(ecosystem, name)` in `web/app.js`, returning the same evidence shape as `registry.js`.

**Behaviour:**
- npm: `fetch('https://registry.npmjs.org/<name>')` → parse response as `lookupNpm` does.
- PyPI: `fetch('https://pypi.org/pypi/<name>/json')` → parse response as `lookupPypi` does.
- 404 → `{ exists: false }`.
- Network error or non-200/non-404 → return `{ exists: null }` and throw or return an `error` string so the caller can set `error` on the check target.

**Definition of done:**
- Tests in `playground.test.js` mock `fetch` and verify the evidence shape for: success, 404, non-200 HTTP error, and network exception.
- For the same mocked response, `browserLookup` returns the same `{ exists, ageDays, latestVersion, repository, deprecated }` as `lookupNpm` / `lookupPypi` from `registry.js`.

---

## Task 4: Core check pipeline in the browser

**Goal:** Wire `detectFormat` → `browserLookup` (parallel) → `decide` → result list.

**Function:** `runChecks(text, ecosystemHint, policy)` → `Promise<TrustfilePackage[]>`

**Behaviour:**
- Calls `detectFormat` to get targets.
- Runs `browserLookup` for all targets in parallel (`Promise.all`).
- Calls `decide()` (from `verdict.esm.js`) for each result.
- Returns the array of package result objects in the trustfile shape.
- Deduplicates by `ecosystem:name` (case-insensitive), same as `check()` in `index.js`.

**Definition of done:**
- Tests mock `fetch` and cover: all-verified, mixed verdicts, registry error, duplicate deduplication.
- `runChecks` with the same mocked evidence produces the same verdict codes as `check()` from `index.js` for the same input.

---

## Task 5: Page skeleton and CSS

**Goal:** Create `web/index.html` with the layout described in the design, mobile-first at 375px.

**What to include:**
- `<meta name="viewport">`, `<meta charset="UTF-8">`.
- `<title>DepLatch Playground</title>`.
- Inline `<style>` block: system-ui font stack, single-column layout, `max-width: 760px`, responsive.
- Semantic HTML landmarks: `<header>`, `<main>`, `<section>` for input, results, policy.
- Textarea for input, label showing detected format, ecosystem `<select>` (initially hidden), policy panel (`<details><summary>`), summary bar placeholder, results list placeholder, download button (initially hidden).
- `<noscript>` message.
- `<script type="module" src="app.js">` at the bottom of `<body>`.
- No external resources; no `onclick=` attributes.

**Definition of done:**
- The page renders correctly in Chrome at 375px and 1280px viewport widths (manual check).
- HTML validates (no unclosed tags, no duplicate IDs).
- No external network requests when the page loads (verified in DevTools).

---

## Task 6: Rendering and interactivity

**Goal:** Implement the event handlers and DOM rendering in `web/app.js`.

**Behaviour:**
- On textarea `input` event: run `detectFormat`, show/hide ecosystem selector, show detected-format label, call `runChecks`, render results.
- On ecosystem `<select>` change: re-run checks.
- On policy panel change: re-run checks.
- `renderResults(results)`:
  - Sort: blocked → review → verified.
  - For each result, create a row with ecosystem badge, name, verdict badge (icon + text), reason messages.
  - All untrusted values set via `textContent`, never `innerHTML`.
  - Show summary bar.
  - Show/hide download button.
- Loading state: replace results list with a spinner/placeholder while checks are in-flight; cancel in-flight checks if input changes before they finish (use a generation counter or `AbortController`).

**Definition of done:**
- Tests in `playground.test.js` cover `renderResults` using JSDOM or a lightweight DOM check: summary counts match row counts (P-S1), no raw `<` or `>` in rendered output for adversarial names (P-S2).
- Rows are sorted correctly for every permutation of verdicts.

---

## Task 7: Trustfile download

**Goal:** Implement the "Download trustfile.json" button.

**Behaviour:**
- Assembles a valid trustfile from current results and policy.
- `generator: { name: 'deplatch-playground', version: '0.1.0' }`.
- Triggers a `Blob` download named `trustfile.json`.
- The downloaded file validates against `schema/trustfile.schema.json`.

**Definition of done:**
- Test: construct a sample results array, call `buildTrustfile(results, policy)`, assert the JSON validates against the schema (use the schema inline in the test, no network).
- Test: `summary` counts equal row counts for a 10-item random result array (P-S1).

---

## Task 8: Verdict parity test

**Goal:** Confirm that `decide()` via the ESM wrapper and `decide()` via CommonJS produce identical output.

**What to add to `playground.test.js`:**
- Import `decide` from `verdict.js` (CJS) in the test file.
- Use `import()` (dynamic) or a Node worker to load `verdict.esm.js` as an ES module.
- For 25 hand-crafted `{ evidence, policy }` combinations covering every reason code, assert that both return the same `verdict` and the same `reasons[*].code` array.

**Definition of done:**
- Test passes under `node:test` without real network calls.
- Covers every reason code: `NOT_FOUND`, `DID_YOU_MEAN`, `TOO_NEW`, `LOOKALIKE`, `NO_REPOSITORY`, `DEPRECATED`, `REGISTRY_ERROR`, `ALLOWLISTED`, `DENYLISTED`.

---

## Task 9: GitHub Pages workflow

**Goal:** Create `.github/workflows/pages.yml`.

**Workflow spec:**
```yaml
name: Deploy Playground to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: npm test --prefix packages/npm
      - run: python -m unittest discover -s tests
        working-directory: packages/pypi
        env: { PYTHONPATH: src }
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with: { path: web/ }
      - id: deploy
        uses: actions/deploy-pages@v4
```

**Definition of done:**
- File is syntactically valid YAML.
- `ci.yml` and `publish.yml` are unchanged.
- The live URL is added to `README.md` (placeholder `https://<org>.github.io/deplatch/` if the repo hasn't published yet).

---

## Task 10: End-to-end smoke test

**Goal:** Verify the complete flow works with mocked registries in a headless Node environment.

**What to add to `playground.test.js`:**
- A test that feeds a full install command (`npm install react ai-super-helper lodash`) through `runChecks` with a mocked `fetch` that returns:
  - `react` → old, real evidence.
  - `lodash` → old, real evidence.
  - `ai-super-helper` → 404.
- Assert: 2 Verified, 0 Review, 1 Blocked; summary counts match row counts; `ai-super-helper` has verdict `blocked` and reason `NOT_FOUND`.
- A second test using `pip install requests fakelib99` with PyPI mock data.

**Definition of done:**
- Both tests pass under `node:test`.
- The full `npm test` suite (original tests + playground tests) passes.
- No real network calls are made during tests.
