"""Minimal TOML parser for pyproject.toml and Pipfile.

Handles the subset DepLatch needs:
  - Standard tables: [table] and [table.sub.key]
  - Array-of-tables: [[array.of.tables]]
  - Inline arrays: ["a", "b", ...] including multiline
  - Inline tables: { key = "val" }
  - String values: "..." and '...'
  - Bare scalars (numbers, booleans)
  - Dotted keys: a.b.c = "val"

No attempt is made to cover all of TOML. Use tomllib on 3.11+ when available.
"""
from __future__ import annotations

import re
import sys
from typing import Any


def parse(src: str) -> dict:
    """Parse a TOML string and return a plain dict."""
    # Prefer stdlib tomllib on Python 3.11+
    if sys.version_info >= (3, 11):
        import tomllib  # type: ignore[import]
        return tomllib.loads(src)

    lines = src.splitlines()
    root: dict = {}
    current: dict = root
    current_key: list[str] = []

    def deep_get(obj: dict, keys: list[str]) -> dict:
        cur = obj
        for k in keys:
            if k not in cur:
                cur[k] = {}
            node = cur[k]
            # Walk into last element of array-of-tables
            if isinstance(node, list):
                cur = node[-1]
            else:
                cur = node
        return cur

    def parse_string(s: str, pos: int) -> tuple[str, int]:
        # Triple-quoted
        if s.startswith("'''", pos):
            end = s.find("'''", pos + 3)
            if end == -1:
                raise ValueError("Unterminated multiline literal string")
            return s[pos + 3:end], end + 3
        if s.startswith('"""', pos):
            end = s.find('"""', pos + 3)
            if end == -1:
                raise ValueError("Unterminated multiline basic string")
            raw = s[pos + 3:end]
            raw = raw.replace(r'\\', '\x00').replace(r'\n', '\n').replace(r'\t', '\t').replace(r'\"', '"').replace('\x00', '\\')
            return raw, end + 3
        if s[pos] == "'":
            end = s.find("'", pos + 1)
            if end == -1:
                raise ValueError("Unterminated literal string")
            return s[pos + 1:end], end + 1
        if s[pos] == '"':
            val, i = [], pos + 1
            while i < len(s):
                if s[i] == '\\':
                    c = s[i + 1] if i + 1 < len(s) else ''
                    val.append({'n': '\n', 't': '\t', '"': '"', '\\': '\\'}.get(c, c))
                    i += 2
                elif s[i] == '"':
                    return ''.join(val), i + 1
                else:
                    val.append(s[i]); i += 1
            raise ValueError("Unterminated basic string")
        raise ValueError(f"Expected string at pos {pos}, got: {s[pos]!r}")

    def parse_value(s: str, pos: int) -> tuple[Any, int]:
        while pos < len(s) and s[pos] == ' ':
            pos += 1
        if pos >= len(s):
            return None, pos
        if s[pos] in ('"', "'"):
            return parse_string(s, pos)
        if s[pos] == '[':
            return parse_array(s, pos)
        if s[pos] == '{':
            return parse_inline_table(s, pos)
        if s.startswith('true', pos):
            return True, pos + 4
        if s.startswith('false', pos):
            return False, pos + 5
        # bare scalar
        m = re.match(r'[^,\]\}#\n]*', s[pos:])
        return (m.group(0).strip() if m else ''), pos + len(m.group(0) if m else '')

    def parse_array(s: str, pos: int) -> tuple[list, int]:
        pos += 1  # skip '['
        vals: list = []
        while True:
            while pos < len(s) and s[pos] in (' ', '\t', '\n', ','):
                pos += 1
            if pos >= len(s):
                break
            if s[pos] == '#':
                while pos < len(s) and s[pos] != '\n':
                    pos += 1
                continue
            if s[pos] == ']':
                pos += 1
                break
            val, pos = parse_value(s, pos)
            if val is not None:
                vals.append(val)
        return vals, pos

    def parse_inline_table(s: str, pos: int) -> tuple[dict, int]:
        pos += 1  # skip '{'
        obj: dict = {}
        while True:
            while pos < len(s) and s[pos] == ' ':
                pos += 1
            if pos >= len(s) or s[pos] == '}':
                pos += 1
                break
            if s[pos] == ',':
                pos += 1
                continue
            if s[pos] in ('"', "'"):
                key, pos = parse_string(s, pos)
            else:
                m = re.match(r'[\w.\-]+', s[pos:])
                if not m:
                    break
                key = m.group(0)
                pos += len(key)
            while pos < len(s) and s[pos] == ' ':
                pos += 1
            if pos < len(s) and s[pos] == '=':
                pos += 1
            val, pos = parse_value(s, pos)
            obj[key] = val
        return obj, pos

    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        # Array-of-tables [[a.b]]
        if stripped.startswith('[['):
            m = re.match(r'^\[\[([^\]]+)\]\]', stripped)
            if not m:
                continue
            keys = [k.strip() for k in m.group(1).split('.')]
            parent = deep_get(root, keys[:-1]) if len(keys) > 1 else root
            last = keys[-1]
            if not isinstance(parent.get(last), list):
                parent[last] = []
            entry: dict = {}
            parent[last].append(entry)
            current = entry
            current_key = keys
            continue

        # Standard table [a.b.c]
        if stripped.startswith('['):
            m = re.match(r'^\[([^\]]+)\]', stripped)
            if not m:
                continue
            keys = [k.strip() for k in m.group(1).split('.')]
            current_key = keys
            current = deep_get(root, keys)
            continue

        # Key = value
        eq = line.find('=')
        if eq == -1:
            continue

        # Accumulate multiline arrays/strings by counting open brackets
        val_src = line[eq + 1:]
        depth = sum(1 if c in '[(' else -1 if c in '])' else 0 for c in val_src)
        while depth > 0 and i < len(lines):
            next_line = lines[i]
            i += 1
            val_src += '\n' + next_line
            depth += sum(1 if c in '[(' else -1 if c in '])' else 0 for c in next_line)

        key_part = line[:eq].strip()
        # Parse key (may be dotted or quoted)
        if key_part.startswith('"') or key_part.startswith("'"):
            key_segs = [parse_string(key_part, 0)[0]]
        else:
            key_segs = [k.strip() for k in key_part.split('.')]

        # Strip trailing inline comment (outside strings/brackets)
        clean_val = val_src.strip()
        in_str, str_char, depth2, comment_at = False, '', 0, -1
        for ci, ch in enumerate(clean_val):
            if not in_str:
                if ch in '[{':
                    depth2 += 1
                elif ch in ']}':
                    depth2 -= 1
                elif ch in ('"', "'"):
                    in_str, str_char = True, ch
                elif ch == '#' and depth2 == 0:
                    comment_at = ci
                    break
            else:
                if ch == str_char and (ci == 0 or clean_val[ci - 1] != '\\'):
                    in_str = False
        if comment_at > 0:
            clean_val = clean_val[:comment_at].strip()

        val, _ = parse_value(clean_val, 0)
        target = deep_get(current, key_segs[:-1]) if len(key_segs) > 1 else current
        target[key_segs[-1]] = val

    return root
