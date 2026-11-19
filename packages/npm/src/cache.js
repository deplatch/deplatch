'use strict';

const fs   = require('fs');
const path = require('path');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_DIR    = '.deplatch';
const CACHE_FILE   = 'cache.json';

/**
 * Load the on-disk cache object, returning {} on any error.
 */
function loadCache(dir) {
  try {
    const file = path.join(dir, CACHE_DIR, CACHE_FILE);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Persist the cache object to .deplatch/cache.json.
 * Silent on failure (read-only fs, permissions, etc.).
 */
function saveCache(dir, cache) {
  try {
    const cacheDir = path.join(dir, CACHE_DIR);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, CACHE_FILE), JSON.stringify(cache, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
}

/**
 * Returns a fetchImpl wrapper that caches responses.
 * When `fresh` is true, the cache is ignored for reads (but still written to).
 */
function makeCachedFetch(baseFetch, dir, { fresh = false } = {}) {
  const cache   = loadCache(dir);
  const written = new Set(); // track if we need to save at the end
  const now     = Date.now();

  async function cachedFetch(url, init) {
    const key = url;

    if (!fresh && cache[key] && (now - cache[key].ts) < CACHE_TTL_MS) {
      // Replay the cached response as a minimal Response-like object
      const entry = cache[key];
      return {
        status: entry.status,
        ok:     entry.status >= 200 && entry.status < 300,
        json:   async () => entry.body,
      };
    }

    const res  = await baseFetch(url, init);
    const body = await res.json();

    // Store the synthetic object so callers calling .json() again get the same body.
    // We replace res with a replay object — registry.js calls .json() once per lookup.
    cache[key] = { ts: now, status: res.status, body };
    written.add(key);

    return {
      status: res.status,
      ok:     res.ok,
      json:   async () => body,
    };
  }

  cachedFetch.persist = () => { if (written.size > 0) saveCache(dir, cache); };
  return cachedFetch;
}

module.exports = { loadCache, saveCache, makeCachedFetch };
