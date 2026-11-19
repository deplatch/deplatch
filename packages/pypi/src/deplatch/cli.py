"""Command line entry point. Same commands and exit codes as the npm package."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional

from . import __version__
from .cache import make_cached_get_json
from .core import DEFAULT_POLICY, _get_json, check, parse_install_command
from .scan import find_manifests

POLICY_FILE = "deplatch.policy.json"
HELP = f"""deplatch {__version__} - check dependencies before you trust them

Usage:
  deplatch                               Scan the current project (same as: deplatch scan .)
  deplatch scan [dir] [opts]             Scan manifests recursively; report problems
  deplatch check <name...> [--npm]       Check package names (PyPI default; prefix "npm:" works too)
  deplatch guard <install command...>    Check, then run only if nothing is blocked
  deplatch hook                          Agent hook mode: reads tool-call JSON on stdin, exit 2 blocks
  deplatch init                          Create {POLICY_FILE} and a Kiro hook
  deplatch help                          Show this message

Scan options:
  --all        Also check transitive deps from package-lock.json
  --fresh      Ignore the 24-hour registry cache
  --verbose    List all verified packages (not just the count)
  --json       Print the full trustfile JSON
  --out FILE   Write trustfile JSON to a file

Exit codes: 0 clean, 1 something blocked, 2 blocked (hook mode), 3 usage error."""

_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
_ERR_COLOR = sys.stderr.isatty() and not os.environ.get("NO_COLOR")


def _paint(code: str, s: str, color: bool = True) -> str:
    return f"\x1b[{code}m{s}\x1b[0m" if color else s


_BADGE = {
    "verified": _paint("32", "VERIFIED", _COLOR),
    "review":   _paint("33", "REVIEW  ", _COLOR),
    "blocked":  _paint("31", "BLOCKED ", _COLOR),
}


def _report_flat(tf: dict, stream=None) -> None:
    stream = stream or sys.stdout
    for p in tf["packages"]:
        stream.write(f'{_BADGE[p["verdict"]]}  {p["ecosystem"]}:{p["name"]}\n')
        for r in p["reasons"]:
            stream.write(f'          - {r["message"]}\n')
    s = tf["summary"]
    stream.write(f'\n{s["verified"]} verified, {s["review"]} to review, {s["blocked"]} blocked\n')


def _report_scan(tf: dict, verbose: bool = False) -> None:
    packages = tf["packages"]
    summary  = tf["summary"]
    blocked  = [p for p in packages if p["verdict"] == "blocked"]
    review   = [p for p in packages if p["verdict"] == "review"]
    verified = [p for p in packages if p["verdict"] == "verified"]

    # 1. Problems
    if blocked:
        sys.stdout.write(f'\n{_paint("31", "✗ Problems", _COLOR)}\n')
        for p in blocked:
            src = _paint("2", f' ({p["source"]})', _COLOR) if p.get("source") else ""
            sys.stdout.write(f'  {_paint("31", "✗", _COLOR)} {p["ecosystem"]}:{p["name"]}{src}\n')
            for r in p["reasons"]:
                sys.stdout.write(f'      {r["message"]}\n')

    # 2. Review
    if review:
        sys.stdout.write(f'\n{_paint("33", "⚠ Review", _COLOR)}\n')
        for p in review:
            src = _paint("2", f' ({p["source"]})', _COLOR) if p.get("source") else ""
            sys.stdout.write(f'  {_paint("33", "⚠", _COLOR)} {p["ecosystem"]}:{p["name"]}{src}\n')
            for r in p["reasons"]:
                sys.stdout.write(f'      {r["message"]}\n')

    # 3. Good
    sys.stdout.write(f'\n{_paint("32", "✓ Good", _COLOR)}\n')
    if verbose:
        for p in verified:
            src = _paint("2", f' ({p["source"]})', _COLOR) if p.get("source") else ""
            sys.stdout.write(f'  {_paint("32", "✓", _COLOR)} {p["ecosystem"]}:{p["name"]}{src}\n')
    else:
        n = summary["verified"]
        sys.stdout.write(f'  {n} package{"s" if n != 1 else ""} look fine\n')

    # Count distinct source files
    files = {p["source"] for p in packages if p.get("source")}
    total  = len(packages)
    n_files = len(files)
    sys.stdout.write(
        f'\n{total} package{"s" if total != 1 else ""} in {n_files} file{"s" if n_files != 1 else ""}: '
        f'{summary["verified"]} good, {summary["review"]} to review, {summary["blocked"]} blocked\n'
    )

    # 5. Next step
    if blocked:
        sys.stdout.write(
            f'\n{_paint("33", "Next step:", _COLOR)} Remove or replace the blocked packages, '
            f'or add them to {POLICY_FILE} allow list if they are internal.\n'
        )


def _make_progress():
    if not (sys.stderr.isatty() and not os.environ.get("NO_COLOR")):
        return lambda done, total: None
    lock = threading.Lock()

    def progress(done: int, total: int) -> None:
        with lock:
            sys.stderr.write(f"\rChecking {done}/{total}…\x1b[K")
            sys.stderr.flush()
            if done >= total:
                sys.stderr.write("\r\x1b[K")
                sys.stderr.flush()

    return progress


def load_policy(directory: str = ".") -> dict:
    f = Path(directory) / POLICY_FILE
    return {**DEFAULT_POLICY, **(json.loads(f.read_text()) if f.exists() else {})}


def scan_project(directory: str = ".") -> list[dict]:
    return find_manifests(directory)


def _strings(value, out: list) -> list:
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
    flags = {a for a in argv if a.startswith("--")}
    out_value = argv.index("--out") + 1 if "--out" in argv else -1
    # args = positional tokens (non-flag, not the value after --out)
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and i != out_value]
    out_file: Optional[str] = argv[out_value] if 0 < out_value < len(argv) else None
    as_json = "--json" in flags
    verbose  = "--verbose" in flags
    fresh    = "--fresh" in flags
    all_deps = "--all" in flags

    cmd = args[0] if args else None

    # ---- no-arg: scan . ----
    if cmd is None or cmd == "scan":
        directory = args[1] if cmd == "scan" and len(args) > 1 else "."
        policy  = load_policy(directory)
        targets = find_manifests(directory, all_deps=all_deps)
        if not targets:
            sys.stdout.write("No manifests found.\n")
            return 0

        cached_get = make_cached_get_json(_get_json, directory, fresh=fresh)
        on_progress = _make_progress()
        tf = check(targets, policy=policy, get_json=cached_get, on_progress=on_progress)
        cached_get.persist()

        if as_json:
            print(json.dumps(tf, indent=2))
        else:
            _report_scan(tf, verbose=verbose)
        if out_file:
            Path(out_file).write_text(json.dumps(tf, indent=2) + "\n")
        return 1 if tf["summary"]["blocked"] else 0

    if cmd in ("help", "--help", "-h"):
        print(HELP)
        return 0
    if cmd in ("--version", "-v"):
        print(__version__)
        return 0

    if cmd == "check":
        names = args[1:]
        if not names:
            print("Give at least one package name.", file=sys.stderr)
            return 3
        targets = []
        for n in names:
            m = re.match(r"^(npm|pypi):(.+)$", n)
            targets.append({"ecosystem": m.group(1), "name": m.group(2)} if m
                           else {"ecosystem": "npm" if "--npm" in flags else "pypi", "name": n})
        tf = check(targets, load_policy())
        print(json.dumps(tf, indent=2)) if as_json else _report_flat(tf)
        return 1 if tf["summary"]["blocked"] else 0

    if cmd == "guard":
        command = " ".join(argv[1:])
        targets = parse_install_command(command)
        if targets:
            tf = check(targets, load_policy())
            _report_flat(tf, sys.stderr)
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
        targets  = [t for c in commands for t in parse_install_command(c)]
        if not targets:
            return 0
        tf = check(targets, load_policy())

        def lines(lst: list) -> str:
            return "\n".join(
                f'- {p["ecosystem"]}:{p["name"]}: ' + " ".join(r["message"] for r in p["reasons"])
                for p in lst
            )

        blocked = [p for p in tf["packages"] if p["verdict"] == "blocked"]
        review  = [p for p in tf["packages"] if p["verdict"] == "review"]
        if blocked:
            sys.stderr.write(
                f"deplatch blocked this install.\n{lines(blocked)}\n"
                "Do not install these packages. Use a real, well-known package instead, or ask the user.\n"
            )
            return 2
        if review:
            sys.stderr.write(f"deplatch: review before trusting:\n{lines(review)}\n")
        return 0

    if cmd == "init":
        policy_path = Path(POLICY_FILE)
        if not policy_path.exists():
            policy_path.write_text(json.dumps(DEFAULT_POLICY, indent=2) + "\n")
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
                "action": {"type": "command", "command": "deplatch hook"}, "timeout": 30,
            }]}, indent=2) + "\n")
            print("Created .kiro/hooks/deplatch.json")
        else:
            print(".kiro/hooks/deplatch.json already exists, left as is")
        return 0

    print(f'Unknown command "{cmd}".\n\n{HELP}', file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main())
