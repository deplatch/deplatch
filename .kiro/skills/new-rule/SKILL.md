---
name: new-rule
description: Add a new detection rule (reason code) to DepLatch. Use when the user wants DepLatch to detect, flag, warn about or block a new kind of package risk.
---

1. Start with a feature spec in .kiro/specs/, named after the rule. Do not write code until the requirements are approved.
2. Add the new reason code to the `code` enum in schema/trustfile.schema.json.
3. Put the decision logic in packages/npm/src/verdict.js. It must stay pure: no network calls. If the rule needs new facts from the registry, collect them in registry.js as evidence only.
4. Make the identical change in packages/pypi/src/deplatch/core.py: same code, severity and message text.
5. Regenerate the web/lib ESM files with the generator in scripts/, so the playground uses the new rule.
6. Tests in both suites: one per acceptance criterion, plus at least one property-based test. Tests must use a fake registry, never the real one.
7. Run both test suites, then add the rule to the README and CHANGELOG.
