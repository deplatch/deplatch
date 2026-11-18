# Requirements: DepLatch core (v0.1.0)

## Introduction

DepLatch checks npm and PyPI packages before they are installed and gives each one of three verdicts: `verified`, `review` or `blocked`. It runs as a CLI, as a pre-install guard, as a hook inside AI coding agents, and as a CI gate. Results can be written in the open `trustfile` format.

## Glossary

- **Evidence:** facts from the registry: whether the package exists, when it was first published, its latest version, linked repository, deprecation.
- **Policy:** the user's rules in `deplatch.policy.json`.
- **Popular list:** a small embedded list of very popular packages used to spot look-alike names.
- **Look-alike:** a name 1 or 2 edits away from a popular package that is not itself popular.

## Requirement 1: Detect packages that do not exist

**User story:** As a developer using an AI assistant, I want installs of non-existent packages stopped, so that an attacker cannot later register that name and run code on my machine.

### Acceptance criteria
1.1 WHEN a package is not found on its registry (HTTP 404) THEN the system SHALL give the verdict `blocked` with reason `NOT_FOUND`, regardless of `onReview`.
1.2 WHEN a missing name is within 2 edits of a popular package THEN the system SHALL add reason `DID_YOU_MEAN` naming that package.
1.3 The `NOT_FOUND` message SHALL explain in plain language why a missing package is dangerous.

## Requirement 2: Flag packages that need a human look

**User story:** As a developer, I want suspicious but real packages flagged for review, so that I am warned without being blocked from legitimate new packages.

### Acceptance criteria
2.1 WHEN a package was first published fewer than `minAgeDays` days ago THEN the system SHALL add reason `TOO_NEW`.
2.2 WHEN a package name is a look-alike of a popular package THEN the system SHALL add reason `LOOKALIKE` naming the popular package and the distance.
2.3 WHEN `requireRepository` is true AND no source repository is linked THEN the system SHALL add reason `NO_REPOSITORY`.
2.4 WHEN the latest version is deprecated (npm) or yanked (PyPI) THEN the system SHALL add reason `DEPRECATED`.
2.5 WHEN any review reason is present THEN the verdict SHALL be `review`, or `blocked` if `onReview` is `block`.
2.6 WHEN no review reason is present THEN the verdict SHALL be `verified`.

## Requirement 3: Respect the user's policy

**User story:** As a team lead, I want to write our dependency rules once, so that every developer, agent and pipeline applies the same rules.

### Acceptance criteria
3.1 WHEN a package matches the `deny` list THEN the system SHALL give `blocked` with reason `DENYLISTED`, before any other rule.
3.2 WHEN a package matches the `allow` list THEN the system SHALL give `verified` with reason `ALLOWLISTED`, even if the package does not exist on the public registry.
3.3 List entries SHALL use the form `ecosystem:name`, and PyPI names SHALL be compared after PEP 503 normalisation (`-`, `_` and `.` are equal, case-insensitive).
3.4 WHEN `deplatch.policy.json` is missing THEN the system SHALL use the defaults: `minAgeDays` 30, `requireRepository` false, `onReview` `warn`, `onRegistryError` `review`, empty lists.

## Requirement 4: Fail safe

**User story:** As a developer, I want network problems to be visible, so that an outage never makes a package look safe.

### Acceptance criteria
4.1 WHEN the registry cannot be reached or answers with an error other than 404 THEN the system SHALL give `review` with reason `REGISTRY_ERROR`, or `blocked` if `onRegistryError` is `block`.
4.2 The system SHALL never return `verified` for a package whose registry lookup failed, unless the package is allow-listed.

## Requirement 5: Understand install commands

**User story:** As an AI agent hook, I want to find the packages inside any shell command, so that installs are checked however they are written.

### Acceptance criteria
5.1 The system SHALL recognise installs by `npm install|i|add`, `pnpm add|install|i`, `yarn add`, `bun add|install|i`, `pip install`, `pip3 install`, `python -m pip install`, `uv add`, `uv pip install`, `poetry add` and `pipx install`.
5.2 The system SHALL strip version specifiers (`react@19`, `requests==2.32`, `flask[async]>=3`) and keep scoped npm names (`@types/node`).
5.3 The system SHALL skip local paths, URLs, git references, tarballs and `user/repo` shorthands.
5.4 The system SHALL understand commands joined by `&&`, `||`, `;` and `|`.
5.5 The installer SHALL only be recognised as the command itself (after prefixes like `sudo` or `VAR=value`), so `echo pip install x` is not an install.

## Requirement 6: Command line interface

**User story:** As a developer, I want simple commands that also work in scripts and CI.

### Acceptance criteria
6.1 `deplatch check <name...>` SHALL check names; npm is the default in the npm package and PyPI in the PyPI package; `npm:` and `pypi:` prefixes SHALL override the default.
6.2 `deplatch scan [dir]` SHALL check dependencies in `package.json` (all four dependency fields) and `requirements*.txt`, skipping non-registry specs.
6.3 `deplatch guard <command>` SHALL check the install command and run it only if nothing is `blocked`.
6.4 `deplatch hook` SHALL read a tool-call JSON payload on stdin, check any install commands found in any string inside `tool_input`, exit 2 with an explanation on stderr if anything is blocked, print review warnings on stderr, and otherwise exit 0.
6.5 `deplatch init` SHALL create `deplatch.policy.json` and `.kiro/hooks/deplatch.json` without overwriting existing files.
6.6 `--json` SHALL print a trustfile; `scan --out <file>` SHALL write one.
6.7 Exit codes SHALL be 0 clean, 1 blocked, 2 blocked in hook mode, 3 usage error.
6.8 Duplicate packages in one run SHALL be checked once.

## Requirement 7: Open report format

**User story:** As a tool builder, I want a standard report, so that my IDE or pipeline can read DepLatch results, or produce its own.

### Acceptance criteria
7.1 Every run SHALL be representable as a trustfile that validates against `schema/trustfile.schema.json` version `0.1`.
7.2 The trustfile SHALL include the generator name and version, the policy used, a summary count, and per-package verdict, reasons and evidence.

## Requirement 8: Same behaviour everywhere

8.1 The npm and PyPI packages SHALL produce the same verdicts, reason codes, messages and exit codes for the same inputs.
8.2 Neither package SHALL have runtime dependencies.

## Correctness properties (for property-based tests)

- P1: For any name the registry does not know, and any policy without an allow entry for it, the verdict is `blocked`.
- P2: No package on the popular list is ever a look-alike, and with old, normal evidence each one is `verified`.
- P3: `levenshtein(a, b) == levenshtein(b, a)`, and it is 0 only when `a == b`.
- P4: A deny entry always produces `blocked`; an allow entry always produces `verified`.
- P5: A registry error never produces `verified` (unless allow-listed).
