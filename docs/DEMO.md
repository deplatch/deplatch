# Live class: building DepLatch with Kiro

**Story for the session:** "AI writes code fast. Specs, tests and hooks make it correct. Today a disciplined AI (Kiro) builds a seatbelt against an undisciplined one: AI assistants that invent package names."

Planned for about 60 minutes. Timings are a guide.

---

## Tonight: dry run checklist

- [ ] Open the `deplatch` folder in Kiro. Confirm Kiro shows the 4 steering files and the `deplatch-core` spec.
- [ ] In Kiro chat, ask: *"Run `npm install ai-super-helper` in the terminal."* Confirm the **PreToolUse hook blocks it**. Kiro's docs don't spell out exit-code behaviour for PreToolUse. DepLatch exits with code 2 and writes the reason to stderr, which is the common convention. If Kiro doesn't block on exit 2, try changing `matcher` to the exact shell tool name (ask Kiro: *"what are your tool names?"*).
- [ ] Ask Kiro to edit `packages/npm/src/verdict.js` (any small change). Confirm the "Run tests" hook fires.
- [ ] Run `npm test` in `packages/npm` once so it's warm.
- [ ] Check your credits on the Kiro plan. Specs and property tests use more than chat.
- [ ] Open https://chatgpt.com (or Gemini) in a browser tab for the live hallucination moment.
- [ ] Have `docs/backup-specs/trust-dashboard/` ready to copy in if live spec generation is slow.

---

## 0:00–0:05 | Hook: AI is confidently wrong

1. Ask a student to suggest an unusual task, e.g. *"Node code to convert Excel files to PDF and email them"*.
2. Paste it into ChatGPT on the projector and ask for the code with `npm install` commands.
3. Copy the install line and run, in a terminal:
   ```
   node packages/npm/bin/deplatch.js check <the packages it suggested>
   ```
4. Usually at least one is `BLOCKED: does not exist`. If all are real, run the canned example:
   `check react ai-super-helper expresss`.

**Say:** "If this name doesn't exist today, an attacker can publish it tomorrow. Studies have found anywhere from about 5% to 20% of AI-suggested package names were made up, depending on the model."

## 0:05–0:15 | Tour: what makes Kiro different

Open the repo in Kiro and show, in this order:

| Show | Say |
|---|---|
| `.kiro/steering/*.md` | "Standing rules the AI always follows: no dependencies, two implementations must match, never bypass the security hook." |
| `.kiro/specs/deplatch-core/requirements.md` | "Requirements in EARS format: WHEN … THEN the system SHALL. Anyone can read them." |
| `design.md` | "The architecture, decided before code." |
| `tasks.md` | "Each task links back to requirements. Tasks 8 and 9 are still open." |
| "Correctness properties" at the bottom of requirements | "Not one example, but rules that must hold for any input. Kiro turns them into property-based tests." |
| `.kiro/hooks/deplatch.json` | "Automation that runs on events: before a tool runs, and after a file is saved." |

## 0:15–0:22 | The seatbelt in action (hooks)

1. In Kiro chat: *"Install the package `ai-super-helper` and use it to add a hello route."*
2. The PreToolUse hook blocks the install. Kiro reads the reason and changes course.
3. **Say:** "The AI tried to do something dangerous and the project's own rules stopped it. No human had to notice."

## 0:22–0:45 | Students design a feature: the `/trust` dashboard

**Pitch:** "Swagger UI gives every API a `/docs` page. Let's give every app a `/trust` page."

1. **Students set the rules (5 min).** Ask the room and write answers on the board:
   - What should the page show first? (blocked first)
   - Should it be visible in production? (no, by default)
   - How should colour-blind users tell verdicts apart? (icons + text)
2. **Create the spec live.** In Kiro: new Spec, then paste:
   > Create a feature spec "trust-dashboard": a one-line `trustUI()` handler for Express and plain Node http that serves an HTML dashboard of DepLatch verdicts at the mount path and a trustfile at `<path>/trust.json`. Rules from the class: [paste the board]. Zero dependencies, no external assets, HTML-escape everything, hidden in production unless enabled. Include correctness properties.
3. **Review the requirements together.** Ask the room: "Is anything missing? Anything contradictory?" Edit one requirement live.
4. Approve and show `design.md`, then `tasks.md`.
5. Run task 1 (the pure render function). Show the **property-based tests** Kiro generates: e.g. "for any package name, even `<script>`, the HTML is escaped."
6. If time is short, copy `docs/backup-specs/trust-dashboard/*` into `.kiro/specs/trust-dashboard/` and continue from there.

## 0:45–0:52 | Break it, fix it, prove it

1. Ask students for package names that might fool DepLatch: `reqeusts`, `l0dash`, `python-dateutils`, `@types/nodee`.
2. Run `check` on each. For any wrong verdict, create a **Bugfix spec** in Kiro: Kiro writes the root cause and the fix, plus tests proving the bug existed, that it's fixed, and that nothing else changed.
3. If an agent change goes wrong, use a **checkpoint** to rewind.

## 0:52–0:58 | It works everywhere, not just in Kiro

```
deplatch guard npm install some-package   # terminal firewall
deplatch scan --out trustfile.json        # CI gate (exit 1 blocks the pipeline)
pip install deplatch                       # same tool for Python
```
Show `schema/trustfile.schema.json`: "Swagger UI is the tool, OpenAPI is the standard. DepLatch is the tool, trustfile is the standard."

## 0:58–1:00 | Close

- "Kiro's strength isn't writing code faster. It's that specs, steering, hooks and tests make AI-written code trustworthy."
- Invite contributions: the open tasks in `tasks.md`, more ecosystems, more agent integrations.

---

## Honest answers for Q&A

- **"Isn't spec-driven slower?"** For a quick script, yes; use plain chat (vibe mode). For anything you maintain or share, the time comes back in fewer bugs and clearer reviews.
- **"Does this replace npm audit / Snyk / Socket?"** No. Those look at known vulnerabilities and malware in real packages. DepLatch's main job is the step before: stopping names that shouldn't be installed at all, especially from AI agents. They work well together.
- **"Can a real but malicious old package pass?"** Yes, in v0.1. OSV.dev malware data is on the roadmap. That's why there's a `review` state and a policy file.
- **"Why not just trust the AI?"** Point back to the opening demo.
