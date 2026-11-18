"""Command line entry point. Same commands and exit codes as the npm package."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from . import __version__
from .core import DEFAULT_POLICY, check, parse_install_command

POLICY_FILE = "deplatch.policy.json"
HELP = f"""deplatch {__version__} - check dependencies before you trust them

Usage:
  deplatch check <name...> [--npm] [--json]    Check package names (PyPI by default here; prefix "npm:" works too)
  deplatch scan [dir] [--json] [--out file]    Check package.json and requirements*.txt (CI gate)
  deplatch guard <install command...>          Check an install command, then run it only if nothing is blocked
  deplatch hook                                Agent hook mode: reads tool-call JSON on stdin, exit 2 blocks
  deplatch init                                Create {POLICY_FILE} and a Kiro hook in this project

Exit codes: 0 clean, 1 something blocked, 2 blocked (hook mode), 3 usage error."""

_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
_BADGE = {
    "verified": "\x1b[32mVERIFIED\x1b[0m" if _COLOR else "VERIFIED",
    "review": "\x1b[33mREVIEW  \x1b[0m" if _COLOR else "REVIEW  ",
    "blocked": "\x1b[31mBLOCKED \x1b[0m" if _COLOR else "BLOCKED ",
}


def _report(tf, stream=sys.stdout):
    for p in tf["packages"]:
        stream.write(f'{_BADGE[p["verdict"]]}  {p["ecosystem"]}:{p["name"]}\n')
        for r in p["reasons"]:
            stream.write(f'          - {r["message"]}\n')
    s = tf["summary"]
    stream.write(f'\n{s["verified"]} verified, {s["review"]} to review, {s["blocked"]} blocked\n')


def load_policy(directory="."):
    f = Path(directory) / POLICY_FILE
    return {**DEFAULT_POLICY, **(json.loads(f.read_text()) if f.exists() else {})}


def scan_project(directory="."):
    d, targets = Path(directory), []
    pj = d / "package.json"
    if pj.exists():
        doc = json.loads(pj.read_text())
        for field in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
            for name, spec in (doc.get(field) or {}).items():
                if re.match(r"^(file:|link:|workspace:|git|https?:|github:)", str(spec)):
                    continue
                targets.append({"ecosystem": "npm", "name": name, "source": f"package.json#{field}"})
    for f in sorted(d.glob("requirements*.txt")):
        for raw in f.read_text().splitlines():
            line = re.sub(r"#.*", "", raw).strip()
            if not line or line.startswith("-") or re.match(r"^(git\+|https?:|\.|/)", line):
                continue
            name = re.split(r"[\[=<>!~;@\s]", line)[0]
            if name:
                targets.append({"ecosystem": "pypi", "name": name, "source": f.name})
    return targets


def _strings(value, out):
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, list):
        for v in value:
            _strings(v, out)
    elif isinstance(value, dict):
        for v in value.values():
            _strings(v, out)
    return out


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("help", "--help", "-h"):
        print(HELP)
        return 0
    if argv[0] in ("--version", "-v"):
        print(__version__)
        return 0
    cmd, rest = argv[0], argv[1:]
    flags = {a for a in rest if a.startswith("--")}
    out_value = rest.index("--out") + 1 if "--out" in rest else -1
    args = [a for i, a in enumerate(rest) if not a.startswith("--") and i != out_value]
    as_json = "--json" in flags

    if cmd == "check":
        if not args:
            print("Give at least one package name.", file=sys.stderr)
            return 3
        targets = []
        for n in args:
            m = re.match(r"^(npm|pypi):(.+)$", n)
            targets.append({"ecosystem": m.group(1), "name": m.group(2)} if m
                           else {"ecosystem": "npm" if "--npm" in flags else "pypi", "name": n})
        tf = check(targets, load_policy())
        print(json.dumps(tf, indent=2)) if as_json else _report(tf)
        return 1 if tf["summary"]["blocked"] else 0

    if cmd == "scan":
        directory = args[0] if args else "."
        out_file = rest[out_value] if 0 < out_value < len(rest) else None
        tf = check(scan_project(directory), load_policy(directory))
        if out_file:
            Path(out_file).write_text(json.dumps(tf, indent=2) + "\n")
        print(json.dumps(tf, indent=2)) if as_json else _report(tf)
        return 1 if tf["summary"]["blocked"] else 0

    if cmd == "guard":
        command = " ".join(rest)
        targets = parse_install_command(command)
        if targets:
            tf = check(targets, load_policy())
            _report(tf, sys.stderr)
            if tf["summary"]["blocked"]:
                print("\ndeplatch: install stopped.", file=sys.stderr)
                return 1
        return subprocess.call(command, shell=True)

    if cmd == "hook":
        raw = sys.stdin.read()
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            payload = {"tool_input": raw}
        commands = _strings(payload.get("tool_input", payload) if isinstance(payload, dict) else payload, [])
        targets = [t for c in commands for t in parse_install_command(c)]
        if not targets:
            return 0
        tf = check(targets, load_policy())

        def lines(lst):
            return "\n".join(f'- {p["ecosystem"]}:{p["name"]}: ' + " ".join(r["message"] for r in p["reasons"]) for p in lst)

        blocked = [p for p in tf["packages"] if p["verdict"] == "blocked"]
        review = [p for p in tf["packages"] if p["verdict"] == "review"]
        if blocked:
            sys.stderr.write(f"deplatch blocked this install.\n{lines(blocked)}\n"
                             "Do not install these packages. Use a real, well-known package instead, or ask the user.\n")
            return 2
        if review:
            sys.stderr.write(f"deplatch: review before trusting:\n{lines(review)}\n")
        return 0

    if cmd == "init":
        policy = Path(POLICY_FILE)
        if not policy.exists():
            policy.write_text(json.dumps(DEFAULT_POLICY, indent=2) + "\n")
            print(f"Created {POLICY_FILE}")
        else:
            print(f"{POLICY_FILE} already exists, left as is")
        hook = Path(".kiro/hooks/deplatch.json")
        if not hook.exists():
            hook.parent.mkdir(parents=True, exist_ok=True)
            hook.write_text(json.dumps({"version": "v1", "hooks": [{
                "name": "DepLatch: check packages before install",
                "description": "Blocks installs of packages that do not exist or look like impostors.",
                "trigger": "PreToolUse", "matcher": "shell",
                "action": {"type": "command", "command": "deplatch hook"}, "timeout": 30}]}, indent=2) + "\n")
            print("Created .kiro/hooks/deplatch.json")
        else:
            print(".kiro/hooks/deplatch.json already exists, left as is")
        return 0

    print(f'Unknown command "{cmd}".\n\n{HELP}', file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main())
