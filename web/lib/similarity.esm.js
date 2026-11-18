// GENERATED — do not edit. Run `node scripts/gen-esm.js` to regenerate.
// Source: packages/npm/src/similarity.js

import popular from './popular.esm.js';

function normalize(ecosystem, name) {
  const lower = name.toLowerCase();
  // PyPI treats -, _ and . as the same character (PEP 503).
  return ecosystem === 'pypi' ? lower.replace(/[-_.]+/g, '-') : lower;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function isPopular(ecosystem, name) {
  const n = normalize(ecosystem, name);
  return (popular[ecosystem] || []).some((p) => normalize(ecosystem, p) === n);
}

/**
 * Finds the closest popular package within distance 2.
 * Returns null for popular packages themselves and for very short names,
 * where a one-letter difference is usually just a different package.
 */
function closestPopular(ecosystem, name) {
  const n = normalize(ecosystem, name);
  if (isPopular(ecosystem, name) || n.length < 4) return null;
  let best = null;
  for (const p of popular[ecosystem] || []) {
    const pn = normalize(ecosystem, p);
    if (pn.length < 4) continue;
    const d = levenshtein(n, pn);
    if (d <= 2 && (!best || d < best.distance)) best = { name: p, distance: d };
  }
  return best;
}

export { levenshtein, closestPopular, isPopular, normalize };
export default { levenshtein, closestPopular, isPopular, normalize };
