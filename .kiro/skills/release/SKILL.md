---
name: release
description: Prepare a DepLatch release. Use when the user asks to release, ship, publish or bump the version.
---

1. Run the Node tests (`npm test` in packages/npm) and the Python tests (`python -m unittest discover -s tests` with PYTHONPATH=src, in packages/pypi). Stop and report if any fail.
2. Run `node packages/npm/bin/deplatch.js scan` and stop if anything is blocked.
3. Bump the patch version to the same number in packages/npm/package.json, packages/pypi/pyproject.toml and packages/pypi/src/deplatch/__init__.py.
4. Add a CHANGELOG.md entry listing the specs completed since the last release.
5. Show the diff and the exact git and npm commands to run. Do not commit, push or publish: a human does that.
