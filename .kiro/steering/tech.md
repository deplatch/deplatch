---
inclusion: always
---

# Tech rules

- **Zero runtime dependencies** in both packages. Node: built-ins and global `fetch` only (Node 18+). Python: standard library only (3.9+). Do not add a dependency to solve a problem; write the small function instead. Dev-only tools for tests are fine.
- **Two implementations, one behaviour.** `packages/npm` (JavaScript, CommonJS) and `packages/pypi` (Python) must give the same verdicts, reasons, exit codes and trustfile output for the same input. When you change one, change the other in the same task.
- **The verdict function is pure.** `decide()` takes evidence and policy and returns a verdict. It never touches the network, so it can be property-tested.
- **Registry access is injectable.** `fetchImpl` (Node) and `get_json` (Python) can be replaced in tests. Tests must never call real registries.
- **Exit codes are a contract:** 0 clean, 1 something blocked (check/scan/guard), 2 blocked in hook mode, 3 usage error. Do not change them without a spec change.
- **Messages are for humans.** Write reasons as full sentences a beginner understands. No jargon without an explanation.
- **Tests:** Node uses `node:test` (`npm test` in `packages/npm`). Python uses `unittest` (`python -m unittest discover -s tests` with `PYTHONPATH=src`). Every requirement in a spec needs at least one test, and every correctness property needs a property-style test.
