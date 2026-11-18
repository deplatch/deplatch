# DepLatch

**Check dependencies before you trust them.**

**[Try the Playground →](https://deplatch.github.io/deplatch/)**  
No install. Paste a package name, an install command, a `package.json`, or a `requirements.txt`. Works on mobile.

AI coding assistants sometimes invent package names that do not exist. Attackers watch for those names, register them, and fill them with malware. This is called *slopsquatting*. DepLatch stops these installs before they happen: in your terminal, inside your AI agent, and in CI.

```
$ deplatch check react ai-super-helper expresss
VERIFIED  npm:react
BLOCKED   npm:ai-super-helper
          - "ai-super-helper" does not exist on npm. AI assistants often invent names like this, and attackers register them later.
REVIEW    npm:expresss
          - Name is 1 character(s) away from the popular package "express".

1 verified, 1 to review, 1 blocked
```

## Three verdicts, not two

| Verdict | Meaning | Default action |
|---|---|---|
| **Verified** | Exists, has history, nothing suspicious | Allow |
| **Review** | Exists but is very new, looks like a popular name, or is deprecated | Warn (or block, by policy) |
| **Blocked** | Does not exist, or your policy denies it | Block |

A new package is not automatically malicious, and an existing package is not automatically safe. DepLatch shows the evidence and lets your policy decide.

## Install

```bash
npm install -g deplatch      # Node 18+
pip install deplatch         # Python 3.9+
```

Both packages have the same commands, zero runtime dependencies, and produce the same report format.

## Use it

```bash
deplatch check <name...>          # check names (npm: or pypi: prefix to choose)
deplatch scan [dir]               # check package.json and requirements*.txt; exit 1 if anything is blocked
deplatch scan --out trustfile.json
deplatch guard npm install x y    # check first, then run the install only if nothing is blocked
deplatch init                     # add a policy file and a Kiro hook to this project
```

### In an AI agent (Kiro)

`deplatch init` writes `.kiro/hooks/deplatch.json`, a Pre Tool Use hook. Before the agent runs any shell command, DepLatch reads the command, finds `npm`/`pip`/`yarn`/`pnpm`/`uv`/`poetry` installs, and blocks them (exit code 2) with a plain explanation the agent can act on.

### In CI

```yaml
- run: npx --yes deplatch scan --out trustfile.json
```

## Policy as code

`deplatch.policy.json`:

```json
{
  "minAgeDays": 30,
  "requireRepository": false,
  "onReview": "warn",
  "onRegistryError": "review",
  "allow": ["npm:my-internal-lib"],
  "deny": ["pypi:some-banned-package"]
}
```

## trustfile: an open report format

Every check can be written as a **trustfile** (`schema/trustfile.schema.json`): a tool-neutral JSON report of each dependency, its verdict, the reasons and the evidence. The idea is the same as OpenAPI for APIs: one shared format that any IDE, agent, CLI or CI system can write and read.

## Status

v0.1.0: npm and PyPI, existence, age, look-alike names, deprecation, allow/deny lists, Kiro hook, CI exit codes. Roadmap: a `/trust` dashboard you can mount in any app, more ecosystems (crates.io, Go, Maven), vulnerability data from OSV.dev, and hooks for other AI agents.

## License

MIT
