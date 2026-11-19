'use strict';

const fs   = require('fs');
const path = require('path');
const { lookup }         = require('./registry');
const { decide, DEFAULT_POLICY } = require('./verdict');
const { parseInstallCommand }    = require('./parse');
const { findManifests }          = require('./scan');
const pkg = require('../package.json');

const TRUSTFILE_VERSION = '0.1';
const POLICY_FILE       = 'deplatch.policy.json';
const CONCURRENCY       = 8;

function loadPolicy(dir = process.cwd()) {
  const file = path.join(dir, POLICY_FILE);
  if (!fs.existsSync(file)) return { ...DEFAULT_POLICY };
  return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

async function checkOne(target, policy, opts = {}) {
  let evidence = null;
  let error    = null;
  try {
    evidence = await lookup(target.ecosystem, target.name, opts);
  } catch (e) {
    error = e.message;
  }
  const { verdict, reasons } = decide({ ...target, evidence, error }, policy);
  return {
    ecosystem: target.ecosystem,
    name:      target.name,
    verdict,
    reasons,
    evidence:  evidence || { exists: null },
    ...(target.source ? { source: target.source } : {}),
  };
}

/**
 * Checks packages and returns a trustfile object.
 * Runs up to CONCURRENCY lookups in parallel.
 */
async function check(targets, { policy = loadPolicy(), fetchImpl, now, onProgress } = {}) {
  const opts = {};
  if (fetchImpl) opts.fetchImpl = fetchImpl;
  if (now)       opts.now = now;

  // Deduplicate by ecosystem:name (case-insensitive).
  // But preserve all sources — if the same package appears in multiple
  // files, merge the source info so the output can list all files.
  const byKey   = new Map();
  const keyOrder = [];
  for (const t of targets) {
    const k = `${t.ecosystem}:${t.name.toLowerCase()}`;
    if (!byKey.has(k)) { byKey.set(k, { ...t, _sources: [] }); keyOrder.push(k); }
    if (t.source) byKey.get(k)._sources.push(t.source);
  }
  const unique = keyOrder.map((k) => byKey.get(k));

  // Assign merged sources
  for (const t of unique) {
    if (t._sources.length === 1 && !t.source) t.source = t._sources[0];
    else if (t._sources.length > 1)           t.source = [...new Set(t._sources)].join(', ');
    delete t._sources;
  }

  // Run with concurrency limit
  let done = 0;
  const packages = new Array(unique.length);

  async function worker(items) {
    for (const [i, t] of items) {
      packages[i] = await checkOne(t, policy, opts);
      done++;
      if (onProgress) onProgress(done, unique.length);
    }
  }

  // Split into CONCURRENCY buckets
  const buckets = Array.from({ length: CONCURRENCY }, () => []);
  unique.forEach((t, i) => buckets[i % CONCURRENCY].push([i, t]));
  await Promise.all(buckets.map(worker));

  const summary = { verified: 0, review: 0, blocked: 0 };
  for (const p of packages) summary[p.verdict]++;

  return {
    trustfile:   TRUSTFILE_VERSION,
    generatedAt: new Date(now || Date.now()).toISOString(),
    generator:   { name: 'deplatch', version: pkg.version },
    policy,
    summary,
    packages,
  };
}

/**
 * Scans one flat directory for package.json and requirements*.txt.
 * Kept for backward compatibility with the existing tests and CI step.
 */
function scanProject(dir = process.cwd()) {
  return findManifests(dir, { all: false });
}

module.exports = { check, scanProject, loadPolicy, parseInstallCommand, POLICY_FILE, TRUSTFILE_VERSION };
