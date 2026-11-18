# Implementation plan: DepLatch core

- [x] 1. Install-command parser
  - Tokenise, split on shell separators, skip prefixes and value flags, strip versions, skip non-registry specs.
  - Tests: case table for every installer, `echo pip install x`, chained commands.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 2. Registry lookups for npm and PyPI
  - Evidence only; 404 means not found; other errors throw. Injectable fetch.
  - _Requirements: 1.1, 2.1, 2.3, 2.4, 4.1_

- [x] 3. Look-alike detection
  - Levenshtein, PEP 503 normalisation, popular list, minimum length 4.
  - Property test P2 and P3.
  - _Requirements: 1.2, 2.2_

- [x] 4. Pure verdict function with policy
  - Rule order: deny, allow, error, not found, review reasons.
  - Property tests P1, P4, P5.
  - _Requirements: 1.1–1.3, 2.1–2.6, 3.1–3.4, 4.1, 4.2_

- [x] 5. check() and trustfile output
  - De-duplicate, summary counts, generator info, policy echo.
  - _Requirements: 6.8, 7.1, 7.2_

- [x] 6. CLI commands check, scan, guard, hook, init
  - Exit codes 0/1/2/3; hook reads any string inside `tool_input`.
  - _Requirements: 6.1–6.7_

- [x] 7. Python port with identical behaviour
  - Same case tables and properties in `unittest`.
  - _Requirements: 8.1, 8.2_

- [ ] 8. Parity test that runs one shared JSON case file through both implementations
  - _Requirements: 8.1_

- [ ] 9. JSON Schema validation of trustfile output in both test suites
  - _Requirements: 7.1_
