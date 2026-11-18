---
inclusion: always
---

# Product: DepLatch

DepLatch checks dependencies before anyone trusts them. Its main job is to stop AI-hallucinated packages (slopsquatting) and look-alike names (typosquatting) from being installed, wherever installs happen: a developer's terminal, an AI coding agent, or CI.

## Who it is for
- Developers who use AI coding assistants (Kiro, Cursor, Claude Code, Copilot).
- Teams who want the same dependency rules everywhere, written down as policy.
- Students and beginners, who are least likely to notice a fake package name.

## Principles
1. **Three verdicts, never two.** `verified`, `review`, `blocked`. A new package is not automatically malicious and an existing one is not automatically safe.
2. **Explain every verdict in plain language.** Each reason must tell a human, or an agent, what to do next.
3. **Fail safe, not silent.** If a registry cannot be reached, the result is `review`, never `verified`.
4. **Policy belongs to the user.** Allow and deny lists always win over DepLatch's own judgement.
5. **Open format first.** Every result can be written as a `trustfile` (see `schema/trustfile.schema.json`) so other tools can read it. DepLatch is the reference implementation, not the only one.
6. **Adds no risk of its own.** Zero runtime dependencies.
