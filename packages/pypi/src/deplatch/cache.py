"""24-hour registry response cache stored in .deplatch/cache.json.

Mirrors packages/npm/src/cache.js exactly.
Standard library only.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable, Optional

CACHE_TTL = 24 * 60 * 60  # seconds
CACHE_DIR  = '.deplatch'
CACHE_FILE = 'cache.json'


def _load(directory: str | Path) -> dict:
    try:
        return json.loads((Path(directory) / CACHE_DIR / CACHE_FILE).read_text(encoding='utf-8'))
    except Exception:
        return {}


def _save(directory: str | Path, cache: dict) -> None:
    try:
        d = Path(directory) / CACHE_DIR
        d.mkdir(parents=True, exist_ok=True)
        (d / CACHE_FILE).write_text(json.dumps(cache, indent=2) + '\n', encoding='utf-8')
    except Exception:
        pass  # best-effort


def make_cached_get_json(base_get_json: Callable, directory: str | Path, fresh: bool = False):
    """Return a get_json wrapper that caches results for 24 hours.

    When *fresh* is True, the cache is bypassed for reads but still written.
    The returned function has a `.persist()` method to flush writes to disk.
    """
    cache  = _load(directory)
    now    = int(time.time())
    dirty: set[str] = set()

    def cached_get_json(url: str) -> Optional[Any]:
        entry = cache.get(url)
        if not fresh and entry and (now - entry.get('ts', 0)) < CACHE_TTL:
            # Replay: raise HTTPError-equivalent if cached status was 404
            if entry['status'] == 404:
                return None  # registry.py treats None as 404 for PyPI
            return entry['body']

        body = base_get_json(url)
        status = 404 if body is None else 200
        cache[url] = {'ts': now, 'status': status, 'body': body}
        dirty.add(url)
        return body

    def persist() -> None:
        if dirty:
            _save(directory, cache)

    cached_get_json.persist = persist  # type: ignore[attr-defined]
    return cached_get_json
