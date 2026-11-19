"""DepLatch core: parse install commands, look packages up, decide a verdict.

Standard library only, on purpose: a tool that guards your dependencies
should not add any of its own. Mirrors packages/npm/src exactly.
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import shlex
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Optional

from . import __version__
from .popular import NPM, PYPI

CONCURRENCY = 8

TRUSTFILE_VERSION = "0.1"
DEFAULT_POLICY = {
    "minAgeDays": 30,
    "requireRepository": False,
    "onReview": "warn",
    "onRegistryError": "review",
    "allow": [],
    "deny": [],
}

# ---------------------------------------------------------------- parsing

_NPM = {"npm": {"install", "i", "add", "isntall"}, "pnpm": {"add", "install", "i"},
        "yarn": {"add"}, "bun": {"add", "install", "i"}}
_PIP = {"pip": {"install"}, "pip3": {"install"}, "uv": {"add"}, "poetry": {"add"}, "pipx": {"install"}}
_VALUE_FLAGS = {"-r", "--requirement", "-c", "--constraint", "-e", "--editable", "-i", "--index-url",
                "--extra-index-url", "-f", "--find-links", "--target", "-t", "--prefix", "--root",
                "--registry", "--tag", "--python", "-p", "--group", "--source", "--cwd", "--filter"}
_PREFIX = re.compile(r"^(sudo|env|time|command|nohup)$|^\w+=")
_NON_REGISTRY = re.compile(r"^(\.|/|~|file:|git\+|git:|https?:|github:|link:|workspace:)|\.(tgz|tar\.gz|whl|zip)$")


def _tokens(segment: str) -> list[str]:
    try:
        return shlex.split(segment)
    except ValueError:
        return segment.split()


def _installer(tokens: list[str]):
    i = 0
    while i < len(tokens) and _PREFIX.search(tokens[i]):
        i += 1
    t = tokens[i:]
    if not t:
        return None
    if re.fullmatch(r"python[\d.]*", t[0]) and t[1:4] in (["-m", "pip", "install"], ["-m", "pip3", "install"]):
        return "pypi", i + 4
    if t[0] == "uv" and t[1:3] == ["pip", "install"]:
        return "pypi", i + 3
    if len(t) > 1 and t[0] in _NPM and t[1] in _NPM[t[0]]:
        return "npm", i + 2
    if len(t) > 1 and t[0] in _PIP and t[1] in _PIP[t[0]]:
        return "pypi", i + 2
    return None


def _strip_npm(spec: str) -> str:
    at = spec.find("@", 1 if spec.startswith("@") else 0)
    return spec if at == -1 else spec[:at]


def parse_install_command(command: str) -> list[dict]:
    found = []
    for segment in re.split(r"&&|\|\||;|\|", command or ""):
        tokens = _tokens(segment.strip())
        hit = _installer(tokens)
        if not hit:
            continue
        eco, j = hit
        while j < len(tokens):
            tok = tokens[j]
            j += 1
            if tok in _VALUE_FLAGS:
                j += 1
                continue
            if tok.startswith("-") or _NON_REGISTRY.search(tok):
                continue
            if re.fullmatch(r"[\w.-]+/[\w.-]+", tok):  # user/repo shorthand
                continue
            name = _strip_npm(tok) if eco == "npm" else re.split(r"[\[=<>!~;@\s]", tok)[0]
            if name:
                found.append({"ecosystem": eco, "name": name})
    return found

# ------------------------------------------------------------- similarity


def normalize(eco: str, name: str) -> str:
    low = name.lower()
    return re.sub(r"[-_.]+", "-", low) if eco == "pypi" else low


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _popular(eco: str) -> list[str]:
    return NPM if eco == "npm" else PYPI


def closest_popular(eco: str, name: str):
    n = normalize(eco, name)
    pops = [normalize(eco, p) for p in _popular(eco)]
    if n in pops or len(n) < 4:
        return None
    best = None
    for p, pn in zip(_popular(eco), pops):
        if len(pn) < 4:
            continue
        d = levenshtein(n, pn)
        if d <= 2 and (best is None or d < best["distance"]):
            best = {"name": p, "distance": d}
    return best

# --------------------------------------------------------------- registry

def _age_days(iso, now):
    if not iso:
        return None
    try:
        t = _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=_dt.timezone.utc)
    return (now - t).days


def _get_json(url: str):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": f"deplatch/{__version__}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise RuntimeError(f"registry answered HTTP {e.code}") from e


def lookup(eco: str, name: str, now=None, get_json=_get_json) -> dict:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    if eco == "npm":
        doc = get_json("https://registry.npmjs.org/" + name.replace("/", "%2F"))
        if doc is None:
            return {"exists": False}
        latest = (doc.get("dist-tags") or {}).get("latest")
        ldoc = (doc.get("versions") or {}).get(latest) or {}
        repo = ldoc.get("repository") or doc.get("repository")
        created = (doc.get("time") or {}).get("created")
        return {"exists": True, "latestVersion": latest, "createdAt": created,
                "ageDays": _age_days(created, now),
                "repository": repo if isinstance(repo, str) else (repo or {}).get("url"),
                "deprecated": bool(ldoc.get("deprecated"))}
    if eco == "pypi":
        doc = get_json("https://pypi.org/pypi/" + urllib.parse.quote(name) + "/json")
        if doc is None:
            return {"exists": False}
        first = None
        for files in (doc.get("releases") or {}).values():
            for f in files:
                t = f.get("upload_time_iso_8601") or f.get("upload_time")
                if t and (first is None or t < first):
                    first = t
        info = doc.get("info") or {}
        urls = list((info.get("project_urls") or {}).values()) + [info.get("home_page") or ""]
        repo = next((u for u in urls if re.search(r"github\.com|gitlab\.com|bitbucket\.org|codeberg\.org", u or "", re.I)), None)
        return {"exists": True, "latestVersion": info.get("version"), "createdAt": first,
                "ageDays": _age_days(first, now), "repository": repo, "deprecated": bool(info.get("yanked"))}
    raise ValueError(f"Unsupported ecosystem: {eco}")

# ---------------------------------------------------------------- verdict


def _in_list(entries, eco, name):
    key = f"{eco}:{normalize(eco, name)}"
    for e in entries or []:
        e_eco, _, e_name = str(e).partition(":")
        if f"{e_eco}:{normalize(e_eco, e_name)}" == key:
            return True
    return False


def decide(eco: str, name: str, evidence=None, error=None, policy=None) -> dict:
    policy = {**DEFAULT_POLICY, **(policy or {})}
    reasons = []

    def add(code, severity, message):
        reasons.append({"code": code, "severity": severity, "message": message})

    if _in_list(policy["deny"], eco, name):
        add("DENYLISTED", "block", "Your policy denies this package.")
        return {"verdict": "blocked", "reasons": reasons}
    if _in_list(policy["allow"], eco, name):
        add("ALLOWLISTED", "info", "Your policy allows this package.")
        return {"verdict": "verified", "reasons": reasons}
    if error:
        add("REGISTRY_ERROR", "review", f"Could not reach the registry: {error}")
        return {"verdict": "blocked" if policy["onRegistryError"] == "block" else "review", "reasons": reasons}
    if not evidence or not evidence.get("exists"):
        add("NOT_FOUND", "block", f'"{name}" does not exist on {"npm" if eco == "npm" else "PyPI"}. '
            "AI assistants often invent names like this, and attackers register them later.")
        near = closest_popular(eco, name)
        if near:
            add("DID_YOU_MEAN", "info", f'Did you mean "{near["name"]}"?')
        return {"verdict": "blocked", "reasons": reasons}

    age = evidence.get("ageDays")
    if age is not None and age < policy["minAgeDays"]:
        add("TOO_NEW", "review", f"First published {age} day(s) ago (policy minimum: {policy['minAgeDays']}).")
    near = closest_popular(eco, name)
    if near:
        add("LOOKALIKE", "review", f'Name is {near["distance"]} character(s) away from the popular package "{near["name"]}".')
    if policy["requireRepository"] and not evidence.get("repository"):
        add("NO_REPOSITORY", "review", "No source repository is linked.")
    if evidence.get("deprecated"):
        add("DEPRECATED", "review", "The latest version is deprecated or yanked.")

    if not any(r["severity"] == "review" for r in reasons):
        return {"verdict": "verified", "reasons": reasons}
    return {"verdict": "blocked" if policy["onReview"] == "block" else "review", "reasons": reasons}


def check(targets: list[dict], policy=None, now=None, get_json=_get_json,
          on_progress: Optional[Callable] = None) -> dict:
    policy = {**DEFAULT_POLICY, **(policy or {})}
    now = now or _dt.datetime.now(_dt.timezone.utc)

    # Deduplicate, merging sources
    by_key: dict[str, dict] = {}
    key_order: list[str] = []
    for t in targets:
        k = f'{t["ecosystem"]}:{t["name"].lower()}'
        if k not in by_key:
            by_key[k] = {**t, '_sources': []}
            key_order.append(k)
        if t.get('source'):
            by_key[k]['_sources'].append(t['source'])

    unique: list[dict] = []
    for k in key_order:
        t = by_key[k]
        srcs = list(dict.fromkeys(t.pop('_sources')))  # dedupe while preserving order
        if len(srcs) == 1 and not t.get('source'):
            t['source'] = srcs[0]
        elif len(srcs) > 1:
            t['source'] = ', '.join(srcs)
        unique.append(t)

    done_count = 0
    packages: list[Optional[dict]] = [None] * len(unique)

    def check_one(idx: int, t: dict) -> tuple[int, dict]:
        evidence, error = None, None
        try:
            evidence = lookup(t['ecosystem'], t['name'], now=now, get_json=get_json)
        except Exception as e:
            error = str(e)
        d = decide(t['ecosystem'], t['name'], evidence, error, policy)
        entry = {'ecosystem': t['ecosystem'], 'name': t['name'], **d,
                 'evidence': evidence or {'exists': None}}
        if t.get('source'):
            entry['source'] = t['source']
        return idx, entry

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futures = {ex.submit(check_one, i, t): i for i, t in enumerate(unique)}
        for fut in as_completed(futures):
            idx, entry = fut.result()
            packages[idx] = entry
            done_count += 1
            if on_progress:
                on_progress(done_count, len(unique))

    summary = {'verified': 0, 'review': 0, 'blocked': 0}
    for p in packages:
        summary[p['verdict']] += 1  # type: ignore[index]

    return {'trustfile': TRUSTFILE_VERSION, 'generatedAt': now.isoformat().replace('+00:00', 'Z'),
            'generator': {'name': 'deplatch', 'version': __version__},
            'policy': policy, 'summary': summary, 'packages': packages}
