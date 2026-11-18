# Requirements: Trust dashboard (`/trust`), the "Swagger UI for dependencies"

> Backup copy. In class, generate this spec live in Kiro from the prompt in `docs/DEMO.md`, with students choosing the rules. Copy this file into `.kiro/specs/trust-dashboard/` only if live generation runs out of time.

## Introduction
Any web app can mount one line of code and get a `/trust` page showing every dependency's verdict, and a `/trust.json` trustfile, the same way Swagger UI gives every API a `/docs` page from `openapi.json`.

## Requirement 1: One-line mount
**User story:** As a developer, I want to add the dashboard with one line, so that adopting it costs nothing.
1.1 The npm package SHALL export `trustUI(options)` returning a Node `(req, res, next)` handler usable with Express, Connect and plain `http`.
1.2 WHEN mounted at a path THEN `GET <path>` SHALL return the HTML dashboard and `GET <path>.json` (or `<path>/trust.json`) SHALL return the trustfile.
1.3 The handler SHALL have zero runtime dependencies and ship its HTML, CSS and JS inline.

## Requirement 2: Scan once, refresh on demand
2.1 WHEN the app starts THEN the system SHALL scan the project directory (default `process.cwd()`) in the background.
2.2 WHEN `GET <path>.json?refresh=1` is called THEN the system SHALL re-scan.
2.3 WHILE a scan is running THEN the dashboard SHALL show a "Scanning…" state, not an empty list.

## Requirement 3: Readable verdicts
3.1 The dashboard SHALL show a summary bar with counts of verified, review and blocked.
3.2 Each package SHALL show its ecosystem, name, a coloured badge, and its reasons as plain sentences.
3.3 Badges SHALL use text and an icon, not colour alone (accessibility).
3.4 Blocked packages SHALL be listed first, then review, then verified.
3.5 The user SHALL be able to filter by verdict and search by name.

## Requirement 4: Safe by default
4.1 WHEN `NODE_ENV` is `production` AND `options.enableInProduction` is not true THEN the handler SHALL respond 404, so dependency details are not exposed publicly.
4.2 The page SHALL not load any external script, font or stylesheet.
4.3 Package names and messages SHALL be HTML-escaped before rendering.

## Correctness properties
- P1: For any trustfile, the counts in the summary bar equal the number of rows per verdict.
- P2: For any package name, including `<script>` and quotes, the rendered HTML contains no unescaped markup from that name.
- P3: Row order is always blocked, then review, then verified.
