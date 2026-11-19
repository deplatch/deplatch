# DepLatch: instructions for Claude Code

This project is built with Kiro. Kiro's project rules apply to you too. Read and follow these files before making changes:

@.kiro/steering/product.md
@.kiro/steering/tech.md
@.kiro/steering/structure.md
@.kiro/steering/security.md

## Specs
Feature specs live in .kiro/specs/<feature>/ as requirements.md, design.md and tasks.md. When asked to continue a feature, read all three, implement the first unchecked task in tasks.md, run both test suites, then tick that task (`- [x]`). Do not change requirements without asking.

## Skills
Reusable procedures live in .kiro/skills/. For a release, follow .kiro/skills/release/SKILL.md. For a new detection rule, follow .kiro/skills/new-rule/SKILL.md.

## Tests
- Node: `npm test --prefix packages/npm`
- Python: in packages/pypi, set PYTHONPATH=src (PowerShell: `$env:PYTHONPATH="src"`), then `python -m unittest discover -s tests`

## Hooks
Kiro's hooks (.kiro/hooks/) do not run in Claude Code. The DepLatch install check runs here through .claude/settings.json instead. After changing packages/npm/src, run the Node tests yourself and mirror the change in the Python package.
