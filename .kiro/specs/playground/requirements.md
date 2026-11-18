# Requirements: DepLatch Playground

## Introduction

The Playground is a static single-page web app in `web/` that lets anyone try DepLatch from a browser — including from a phone — with no install, no backend, and no build step. It runs the same verdict logic as the CLI by sharing the pure modules (`parse`, `similarity`, `popular`, `verdict`) directly; the browser loads them as ES modules via small UMD-compatible wrappers, while the CLI continues to use them as CommonJS.

Registry calls go from the user's browser directly to `https://registry.npmjs.org` and `https://pypi.org/pypi/<name>/json`, both of which set `Access-Control-Allow-Origin: *`.

## Glossary

- **Input probe:** the text the user types or pastes into the input box — an install command, a bare package name list, a `package.json`, or a `requirements.txt`.
- **Ecosystem selector:** a UI control (npm / PyPI) used only when the input probe cannot be auto-detected as belonging to one ecosystem.
- **Verdict badge:** an icon-and-text label that communicates the verdict without relying on colour alone (`✓ Verified`, `⚠ Review`, `✗ Blocked`).
- **Summary bar:** a one-line count of Verified / Review / Blocked packages.
- **Trustfile download:** the full trustfile JSON, as a file the user can save.
- **Policy panel:** a collapsible section where the user adjusts `minAgeDays`, `onReview`, and optionally `requireRepository`.
- **Module wrapper:** a tiny wrapper around each shared module (`parse`, `similarity`, `popular`, `verdict`) that exports it as an ES module for the browser and also works as CommonJS for Node. No bundler, no transpilation.

## Requirement 1: Accept and auto-detect input

**User story:** As a developer, I want to paste whatever I have — a command, a name, a whole manifest — and have the page figure out what it is, so I do not need to know what format to use.

### Acceptance criteria
1.1 WHEN the input contains a recognised installer prefix (`npm install`, `pip install`, etc.) THEN the system SHALL detect it as an install command and extract package names with `parseInstallCommand`.
1.2 WHEN the input is valid JSON and contains any of `dependencies`, `devDependencies`, `optionalDependencies`, or `peerDependencies` THEN the system SHALL detect it as a `package.json` and extract npm package names from all four fields, skipping non-registry specs (same rules as `scanProject`).
1.3 WHEN the input contains lines that look like `requirements.txt` entries (bare names, `name==version`, `name>=version`, etc.) but is not JSON and contains no installer prefix THEN the system SHALL detect it as a `requirements.txt` and extract PyPI package names (same parsing rules as `scanProject`).
1.4 WHEN none of the above match THEN the system SHALL treat the input as bare package names (one per line, or space-separated on one line) and use the ecosystem selector to determine which registry to query.
1.5 Auto-detection SHALL be re-run on every input change without a form submit.
1.6 A short label next to the input SHALL show which format was detected (e.g. "Detected: npm install command").

## Requirement 2: Display results per package

**User story:** As a developer, I want to see each package's verdict, reasons, and suggestion in one clear row, so I know exactly what to do next.

### Acceptance criteria
2.1 Each package SHALL appear as a row with: ecosystem badge (`npm` / `pypi`), package name, verdict badge, and the reason messages in full sentences.
2.2 Rows SHALL be sorted: Blocked first, then Review, then Verified.
2.3 The verdict badge SHALL use an icon and text, never colour as the sole distinguishing signal (accessibility requirement).
2.4 WHEN a row's verdict is `blocked` THEN the row SHALL be visually prominent.
2.5 Each reason message SHALL be the same plain-language string produced by `verdict.js` / `verdict.py`.
2.6 WHEN a check is in progress THEN each pending package SHALL show a loading indicator.

## Requirement 3: Summary and download

**User story:** As a team lead, I want a one-line count of outcomes and a machine-readable file, so I can share results with my team.

### Acceptance criteria
3.1 WHEN any results are shown THEN a summary bar SHALL display the count of Verified, Review, and Blocked packages.
3.2 The summary counts SHALL equal the number of rows per verdict (correctness property P-S1).
3.3 A "Download trustfile.json" button SHALL be present whenever results exist, and SHALL trigger a download of valid trustfile JSON.
3.4 The downloaded trustfile SHALL validate against `schema/trustfile.schema.json`.
3.5 The generator field in the downloaded trustfile SHALL identify the playground (e.g. `{ "name": "deplatch-playground", "version": "0.1.0" }`).

## Requirement 4: Policy panel

**User story:** As a developer, I want to tweak the policy the same way I would with `deplatch.policy.json`, so I can test what different settings would do.

### Acceptance criteria
4.1 The policy panel SHALL expose `minAgeDays` (number input, default 30), `onReview` (select: `warn` / `block`, default `warn`), and `requireRepository` (checkbox, default unchecked).
4.2 WHEN any policy setting changes THEN the system SHALL re-run all checks with the new policy (no extra click required).
4.3 Policy values SHALL be passed to `decide()` exactly as `deplatch.policy.json` values would be.
4.4 `allow` and `deny` lists are out of scope for this UI (too advanced for the playground's target audience).

## Requirement 5: Ecosystem selector

**User story:** As a developer pasting bare names, I want to pick npm or PyPI, so I am not checking the wrong registry.

### Acceptance criteria
5.1 WHEN auto-detection produces an unambiguous ecosystem (from an install command or manifest format) THEN the ecosystem selector SHALL be hidden or disabled.
5.2 WHEN the detected format is bare names THEN the ecosystem selector SHALL be visible and active, defaulting to npm.
5.3 Changing the ecosystem selector SHALL immediately re-run checks.

## Requirement 6: Share pure modules without duplication

**User story:** As a contributor, I want the browser and the CLI to run exactly the same verdict code, so a fix in one place fixes both.

### Acceptance criteria
6.1 `parse`, `similarity`, `popular`, and `verdict` SHALL NOT be copied into `web/`; instead each module SHALL be wrapped so it can be loaded as an ES module in the browser and as a CommonJS module in Node, using a single file per module (a UMD-style or dual-export pattern that does not require a build step).
6.2 The browser SHALL load those wrappers from relative paths under `packages/npm/src/`, not from a CDN.
6.3 The Node CLI tests (`npm test` in `packages/npm`) SHALL continue to pass unchanged after the wrappers are added.
6.4 For the same `evidence` and `policy` objects, `decide()` in the browser and `decide()` in Node SHALL return the same `verdict` and `reason` codes (correctness property P-S3).

## Requirement 7: Security and correctness

**User story:** As a security-conscious developer, I want the page to be safe to load with arbitrary input, so a malicious package name cannot inject code into the page.

### Acceptance criteria
7.1 ALL package names, reason messages, version strings, and any other untrusted values SHALL be escaped before insertion into the DOM; the page SHALL use `textContent` / `createElement` or equivalent, never `innerHTML` with unsanitised input.
7.2 For any package name, including `<script>alert(1)</script>`, `"onload=alert(1)`, and names containing quotes or angle brackets, the page SHALL contain no unescaped markup derived from that input (correctness property P-S2).
7.3 WHEN a registry call fails (network error or non-200/404 status) THEN the row SHALL display `Review: could not reach the registry` and the verdict SHALL be `review`, never `verified`.
7.4 The page SHALL contain no inline event handlers (`onclick=`, `onerror=`, etc.) in the HTML source.
7.5 The page SHALL load no external scripts, stylesheets, or fonts; all assets SHALL be inline or relative to `web/`.

## Requirement 8: Mobile-first layout

**User story:** As a student on a phone, I want the page to be usable on a small screen, so I can try it without a laptop.

### Acceptance criteria
8.1 The page SHALL be functional and readable at a 375 px viewport width.
8.2 Input, results, summary bar, and policy panel SHALL all be accessible by scrolling on a single column layout at 375 px.
8.3 Verdict badges and reason text SHALL not overflow or overlap at 375 px.
8.4 The page SHALL use a `<meta name="viewport" content="width=device-width, initial-scale=1">` tag.

## Requirement 9: GitHub Pages deployment

**User story:** As a maintainer, I want the playground deployed automatically, so a push to `main` that passes tests also updates the live site.

### Acceptance criteria
9.1 A GitHub Actions workflow `.github/workflows/pages.yml` SHALL run on every push to `main`.
9.2 The workflow SHALL run the Node test suite (`npm test` in `packages/npm`) AND the Python test suite (`python -m unittest discover`) and SHALL deploy only if both pass.
9.3 Deployment SHALL use `actions/upload-pages-artifact` and `actions/deploy-pages` with `web/` as the artifact root.
9.4 The existing `ci.yml` and `publish.yml` workflows SHALL NOT be modified.
9.5 The live URL SHALL be added to `README.md`.
9.6 The workflow SHALL request only the minimum GitHub Actions permissions needed (`pages: write`, `id-token: write`, `contents: read`).

## Correctness properties

- **P-S1 (summary integrity):** For any trustfile produced by the playground, `summary.verified + summary.review + summary.blocked` equals `packages.length`, and each count equals the number of rows with that verdict.
- **P-S2 (XSS safety):** For any string used as a package name or reason message, the rendered HTML page contains no unescaped `<`, `>`, `"`, or `'` derived from that string.
- **P-S3 (verdict parity):** For any `evidence` and `policy` objects, calling `decide()` loaded as an ES module in the browser and calling `decide()` in Node produce the same `verdict` and `reason` codes.
