'use strict';

// Looks a package up on its public registry and returns plain evidence.
// No judgement happens here; see verdict.js for that.

const DAY_MS = 24 * 60 * 60 * 1000;

function ageDays(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((now - t) / DAY_MS);
}

function repoFromNpm(doc) {
  const r = doc && doc.repository;
  if (!r) return null;
  return typeof r === 'string' ? r : r.url || null;
}

async function lookupNpm(name, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`npm registry answered HTTP ${res.status}`);
  const doc = await res.json();
  const latest = doc['dist-tags'] && doc['dist-tags'].latest;
  const latestDoc = (doc.versions && latest && doc.versions[latest]) || {};
  const createdAt = (doc.time && doc.time.created) || null;
  return {
    exists: true,
    latestVersion: latest || null,
    createdAt,
    ageDays: ageDays(createdAt, now),
    repository: repoFromNpm(latestDoc) || repoFromNpm(doc),
    deprecated: Boolean(latestDoc.deprecated),
  };
}

function repoFromPypi(info) {
  const urls = Object.values((info && info.project_urls) || {});
  if (info && info.home_page) urls.push(info.home_page);
  return urls.find((u) => /github\.com|gitlab\.com|bitbucket\.org|codeberg\.org/i.test(u || '')) || null;
}

async function lookupPypi(name, { fetchImpl = fetch, now = Date.now() } = {}) {
  const res = await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`PyPI answered HTTP ${res.status}`);
  const doc = await res.json();
  let first = null;
  for (const files of Object.values(doc.releases || {})) {
    for (const f of files) {
      const t = f.upload_time_iso_8601 || f.upload_time;
      if (t && (!first || t < first)) first = t;
    }
  }
  return {
    exists: true,
    latestVersion: (doc.info && doc.info.version) || null,
    createdAt: first,
    ageDays: ageDays(first, now),
    repository: repoFromPypi(doc.info),
    deprecated: Boolean(doc.info && doc.info.yanked),
  };
}

async function lookup(ecosystem, name, opts) {
  if (ecosystem === 'npm') return lookupNpm(name, opts);
  if (ecosystem === 'pypi') return lookupPypi(name, opts);
  throw new Error(`Unsupported ecosystem: ${ecosystem}`);
}

module.exports = { lookup, lookupNpm, lookupPypi, ageDays };
