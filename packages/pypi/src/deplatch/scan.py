"""Manifest discovery and parsing for deplatch project-scan.

Mirrors packages/npm/src/scan.js exactly.
Standard library only.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Generator, Iterator

from .toml import parse as parse_toml

ALWAYS_SKIP = frozenset([
    'node_modules', '.git', '.venv', 'venv', 'dist', 'build',
    '.deplatch', '.npm', '__pycache__', '.tox', '.mypy_cache',
])

# ------------------------------------------------------------------
# .gitignore reader
# ------------------------------------------------------------------

def _read_gitignore(root: Path):
    """Return a function that returns True when a relative path should be skipped."""
    gi = root / '.gitignore'
    if not gi.exists():
        return lambda rel: False
    patterns = [
        line.strip() for line in gi.read_text(encoding='utf-8').splitlines()
        if line.strip() and not line.startswith('#')
    ]

    def is_ignored(rel: str) -> bool:
        name = os.path.basename(rel)
        for pat in patterns:
            bare = pat.rstrip('/')
            if name == bare:
                return True
            if bare.startswith('*') and name.endswith(bare[1:]):
                return True
            if rel == bare or rel.startswith(bare + os.sep) or rel.startswith(bare + '/'):
                return True
        return False

    return is_ignored


# ------------------------------------------------------------------
# Recursive directory walk
# ------------------------------------------------------------------

def _walk(directory: Path, root: Path, is_ignored) -> Iterator[Path]:
    try:
        entries = sorted(directory.iterdir())
    except PermissionError:
        return
    for entry in entries:
        rel = str(entry.relative_to(root))
        if entry.is_dir():
            if entry.name in ALWAYS_SKIP or is_ignored(rel):
                continue
            yield from _walk(entry, root, is_ignored)
        elif entry.is_file():
            if not is_ignored(rel):
                yield entry


# ------------------------------------------------------------------
# Per-manifest parsers
# ------------------------------------------------------------------

def _src(abs_file: Path, root: Path) -> str:
    return str(abs_file.relative_to(root)).replace(os.sep, '/')


def _parse_package_json(abs_file: Path, root: Path) -> list[dict]:
    try:
        doc = json.loads(abs_file.read_text(encoding='utf-8'))
    except Exception:
        return []
    targets = []
    src = _src(abs_file, root)
    for field in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
        for name, spec in (doc.get(field) or {}).items():
            if re.match(r'^(file:|link:|workspace:|git|https?:|github:)', str(spec)):
                continue
            targets.append({'ecosystem': 'npm', 'name': name, 'source': src})
    return targets


def _parse_package_lock(abs_file: Path, root: Path) -> list[dict]:
    try:
        doc = json.loads(abs_file.read_text(encoding='utf-8'))
    except Exception:
        return []
    targets = []
    src = _src(abs_file, root)
    for pkg_path, entry in (doc.get('packages') or {}).items():
        if not pkg_path:
            continue
        if entry.get('dev') or entry.get('extraneous') or entry.get('link'):
            continue
        name = pkg_path.removeprefix('node_modules/')
        if name and name != pkg_path:
            targets.append({'ecosystem': 'npm', 'name': name, 'source': src})
    return targets


def _parse_requirements_txt(abs_file: Path, root: Path) -> list[dict]:
    try:
        content = abs_file.read_text(encoding='utf-8')
    except Exception:
        return []
    targets = []
    src = _src(abs_file, root)
    for raw in content.splitlines():
        line = re.sub(r'#.*', '', raw).strip()
        if not line or line.startswith('-') or re.match(r'^(git\+|https?:|\.|/)', line):
            continue
        name = re.split(r'[\[=<>!~;@\s]', line)[0]
        if name:
            targets.append({'ecosystem': 'pypi', 'name': name, 'source': src})
    return targets


def _parse_pyproject_toml(abs_file: Path, root: Path) -> list[dict]:
    try:
        content = abs_file.read_text(encoding='utf-8')
        doc = parse_toml(content)
    except Exception:
        return []

    targets = []
    src = _src(abs_file, root)

    # [project].dependencies
    project_deps = (doc.get('project') or {}).get('dependencies') or []
    if isinstance(project_deps, list):
        for spec in project_deps:
            name = re.split(r'[\[=<>!~;@\s]', str(spec))[0].strip()
            if name:
                targets.append({'ecosystem': 'pypi', 'name': name, 'source': src})

    # [project.optional-dependencies].*
    opt_deps = ((doc.get('project') or {}).get('optional-dependencies')) or {}
    if isinstance(opt_deps, dict):
        for specs in opt_deps.values():
            if not isinstance(specs, list):
                continue
            for spec in specs:
                name = re.split(r'[\[=<>!~;@\s]', str(spec))[0].strip()
                if name:
                    targets.append({'ecosystem': 'pypi', 'name': name, 'source': src})

    # [tool.poetry.dependencies]
    poetry_deps = (((doc.get('tool') or {}).get('poetry') or {}).get('dependencies')) or {}
    if isinstance(poetry_deps, dict):
        for name, spec in poetry_deps.items():
            if name.lower() == 'python':
                continue
            if isinstance(spec, dict) and spec.get('optional'):
                continue
            targets.append({'ecosystem': 'pypi', 'name': name, 'source': src})

    return targets


def _parse_pipfile(abs_file: Path, root: Path) -> list[dict]:
    try:
        content = abs_file.read_text(encoding='utf-8')
        doc = parse_toml(content)
    except Exception:
        return []

    targets = []
    src = _src(abs_file, root)
    for section in ('packages', 'dev-packages'):
        entries = doc.get(section) or {}
        if not isinstance(entries, dict):
            continue
        for name in entries:
            if name.lower() in ('python_version', 'python_full_version'):
                continue
            targets.append({'ecosystem': 'pypi', 'name': name, 'source': src})
    return targets


# ------------------------------------------------------------------
# Main export
# ------------------------------------------------------------------

def find_manifests(directory: str | Path, all_deps: bool = False) -> list[dict]:
    """Walk directory, parse all supported manifests, return targets.

    Deduplicates by (ecosystem, name, source) so the same package in
    two files produces two entries — one per source file.
    """
    root = Path(directory).resolve()
    is_ignored = _read_gitignore(root)
    targets: list[dict] = []
    seen: set[str] = set()

    def add(items: list[dict]) -> None:
        for t in items:
            k = f'{t["ecosystem"]}:{t["name"].lower()}:{t["source"]}'
            if k not in seen:
                seen.add(k)
                targets.append(t)

    for abs_file in _walk(root, root, is_ignored):
        name = abs_file.name
        if name == 'package.json':
            add(_parse_package_json(abs_file, root))
        elif name == 'package-lock.json' and all_deps:
            add(_parse_package_lock(abs_file, root))
        elif re.match(r'^requirements.*\.txt$', name):
            add(_parse_requirements_txt(abs_file, root))
        elif name == 'pyproject.toml':
            add(_parse_pyproject_toml(abs_file, root))
        elif name == 'Pipfile':
            add(_parse_pipfile(abs_file, root))

    return targets
