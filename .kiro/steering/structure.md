---
inclusion: always
---

# Project structure

```
packages/npm/        npm package "deplatch" (CLI + library)
  bin/deplatch.js    CLI: check, scan, guard, hook, init
  src/parse.js       install command -> package names
  src/registry.js    npm / PyPI lookups -> evidence
  src/similarity.js  look-alike detection (Levenshtein vs popular.js)
  src/verdict.js     evidence + policy -> verdict   (pure)
  src/index.js       check() -> trustfile, scanProject()
  test/              node:test suites
packages/pypi/       PyPI package "deplatch", same layout under src/deplatch/
schema/              trustfile.schema.json, the open report format
.kiro/specs/         feature specs (requirements, design, tasks)
.kiro/hooks/         agent hooks used while developing DepLatch itself
docs/                demo run-of-show and backup specs
```

New features go in a new spec under `.kiro/specs/<feature>/`. Shared rules (verdict logic, reason codes) must not be duplicated inside features; extend `verdict` instead.
