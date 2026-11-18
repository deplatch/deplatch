# Implementation plan: Trust dashboard

- [ ] 1. Pure `renderPage(trustfile)` with escaping, sorting and summary bar
  - Property tests: counts match rows (P1), hostile names are escaped (P2), order is blocked → review → verified (P3).
  - _Requirements: 3.1–3.4, 4.2, 4.3_
- [ ] 2. Client-side filter and search (inline script, no external assets)
  - _Requirements: 3.5, 4.2_
- [ ] 3. `trustUI()` handler with cached background scan and `?refresh=1`
  - _Requirements: 1.1, 1.2, 2.1–2.3_
- [ ] 4. Production guard
  - _Requirements: 4.1_
- [ ] 5. Export `deplatch/ui` in package.json and add an Express example to the README
  - _Requirements: 1.1, 1.3_
