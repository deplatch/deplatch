# Design: DepLatch core

## Overview

A small pipeline with one pure decision step in the middle:

```
command / manifest / names
        │  parse.js  (Req 5)       scanProject()  (Req 6.2)
        ▼
  targets [{ecosystem, name}]
        │  registry.js  (network, injectable)
        ▼
  evidence {exists, createdAt, ageDays, latestVersion, repository, deprecated}
        │  verdict.js  decide(evidence, policy)   ← pure (Req 1–4)
        ▼
  {verdict, reasons[]}
        │  index.js  check()
        ▼
  trustfile  (Req 7)  →  CLI output, exit code, hook stderr, CI artifact
```

## Components

### parse (Req 5)
- Splits the command on `&&`, `||`, `;`, `|`; tokenises each segment (quotes respected).
- Skips leading prefixes (`sudo`, `env`, `time`, `command`, `nohup`, `VAR=value`), then requires an installer as the command (Req 5.5).
- Skips value-taking flags with their value (`-r file`, `--registry url`, ...), other flags, and non-registry specs (Req 5.3).
- Strips versions per ecosystem (Req 5.2).

### registry (evidence only, no judgement)
- npm: `GET https://registry.npmjs.org/<name>` (scoped `/` encoded as `%2F`). `time.created`, `dist-tags.latest`, `versions[latest].repository` / `.deprecated`.
- PyPI: `GET https://pypi.org/pypi/<name>/json`. Earliest `upload_time_iso_8601` across all releases is the creation date; repository is the first GitHub/GitLab/Bitbucket/Codeberg URL in `project_urls` or `home_page`; `info.yanked` is deprecation.
- 404 → `{exists: false}`. Any other failure throws, and `check()` turns it into `REGISTRY_ERROR` (Req 4).

### similarity
- Levenshtein distance against the popular list for the same ecosystem.
- PyPI names normalised per PEP 503 before comparing.
- Names shorter than 4 characters, and popular names themselves, are never look-alikes (keeps P2 true and avoids noise like `ws` vs `ai`).

### verdict (Req 1–4), order of rules
1. deny list → `blocked`
2. allow list → `verified`
3. registry error → `review` (or `blocked` by policy)
4. not found → `blocked` (+ `DID_YOU_MEAN`)
5. collect review reasons: `TOO_NEW`, `LOOKALIKE`, `NO_REPOSITORY` (if required), `DEPRECATED`
6. no review reasons → `verified`; otherwise `review`, or `blocked` if `onReview: block`

### CLI (Req 6)
| Command | Output | Exit |
|---|---|---|
| `check` | report or `--json` trustfile | 0 / 1 |
| `scan` | report, `--json`, `--out file` | 0 / 1 |
| `guard` | report on stderr, then runs the command | 1 if blocked, else the command's code |
| `hook` | stderr only | 0 / 2 |
| `init` | creates files | 0 |

Hook mode collects every string inside `tool_input`, because different agents name the shell field differently (`command`, `cmd`, `script`). This keeps the hook agent-neutral.

## Data model: trustfile 0.1
See `schema/trustfile.schema.json`. Reason codes: `NOT_FOUND`, `DID_YOU_MEAN`, `TOO_NEW`, `LOOKALIKE`, `NO_REPOSITORY`, `DEPRECATED`, `REGISTRY_ERROR`, `ALLOWLISTED`, `DENYLISTED`. Severities: `info`, `review`, `block`.

## Error handling
- Network failures and non-404 HTTP errors: `REGISTRY_ERROR`, never silent trust.
- Invalid JSON on hook stdin: treated as raw text, still parsed for install commands.
- Unknown CLI command or missing arguments: help text on stderr, exit 3.

## Testing strategy
- Unit tests per requirement, with a fake registry (`fetchImpl` / `get_json`).
- Property tests for P1–P5 using generated names.
- Parity: the same case tables run in both the Node and Python suites (Req 8.1).
- Live smoke test (manual, not in CI): `deplatch check react ai-super-helper`.

## Known limits (v0.1)
- Only npm and PyPI.
- The popular list is small and hand-curated; look-alikes of less popular packages are not detected.
- Age uses first publish date, so a hijacked old package can still pass. OSV.dev malware data is on the roadmap.
