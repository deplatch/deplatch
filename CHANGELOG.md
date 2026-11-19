# Changelog

## 0.2.0 — project-scan

### New features

**project-scan** (`packages/npm`, `packages/pypi`)

- `deplatch` with no arguments now scans the current project, equivalent to `deplatch scan .`. Help is at `deplatch help` or `--help`.
- `deplatch scan` walks the project tree recursively, skipping `node_modules`, `.git`, `.venv`, `venv`, `dist`, `build`, `.deplatch`, and any folder matched by `.gitignore`.
- Supported manifest formats: `package.json` (all four dependency fields), `requirements*.txt`, `pyproject.toml` (`[project].dependencies`, `[project.optional-dependencies]`, `[tool.poetry.dependencies]`), `Pipfile` (`[packages]`, `[dev-packages]`). Pass `--all` to also include transitive dependencies from `package-lock.json`.
- Registry answers are cached in `.deplatch/cache.json` for 24 hours. Use `--fresh` to bypass the cache for a run.
- Up to 8 packages are checked concurrently. A progress counter (`Checking 23/57…`) is shown on stderr when the terminal is interactive.
- Structured scan output: blocked packages listed first with their source file, then review items, then a summary count for verified packages (`--verbose` lists them). A one-line summary and a next-step message follow.
- Existing flags (`--json`, `--out <file>`) and all exit codes are unchanged.

**Playground** (`web/`)

- Static single-page app that runs DepLatch checks in the browser against the npm and PyPI registries directly.
- Accepts package names, install commands, `package.json`, or `requirements.txt`. Auto-detects format.
- Verdict badges (icon + text), summary bar, trustfile download, policy panel (minAgeDays, onReview, requireRepository).
- Mobile-first layout (375 px viewport).

**ESM code-generation** (`scripts/gen-esm.js`)

- `web/lib/*.esm.js` are now generated from `packages/npm/src/*.js` by `node scripts/gen-esm.js`. Hand-written copies removed.
- `--check` mode (used in CI) exits 1 if committed files differ from what the generator would produce.

### Internal

- Minimal TOML parser (`src/toml.js` / `deplatch/toml.py`) covers the subset needed for `pyproject.toml` and `Pipfile`; on Python 3.11+ the stdlib `tomllib` is used instead.
- `src/scan.js` / `deplatch/scan.py`: manifest discovery and per-format parsers, extracted from `index.js` / `cli.py` for independent testing.
- `src/cache.js` / `deplatch/cache.py`: 24-hour on-disk cache with injectable base fetch/get_json for testing.
- `check()` in both packages now runs lookups with a concurrency limit of 8.
- Both test suites extended: 57 Node tests, 37 Python tests.

## 0.1.0 — initial release

npm and PyPI existence checks, age, look-alike names (Levenshtein), deprecation, allow/deny lists, Kiro pre-install hook, CI exit codes, open trustfile format.
