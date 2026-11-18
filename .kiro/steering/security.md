---
inclusion: always
---

# Security rules for the agent working on this repo

- Never install a package without first running `deplatch check <name>` on it. The PreToolUse hook in `.kiro/hooks/deplatch.json` enforces this; do not try to bypass it, rename the command, or split the install to avoid it.
- If DepLatch blocks a package, do not look for a similarly named alternative on your own. Explain the block to the user and ask.
- Do not send tokens, cookies or user files to any registry. DepLatch only ever sends package names.
- Do not lower the defaults in `DEFAULT_POLICY` (for example `minAgeDays`) to make a test pass. Change the test or ask the user.
