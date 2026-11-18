'use strict';

const fs = require('fs');
const path = require('path');
const { lookup } = require('./registry');
const { decide, DEFAULT_POLICY } = require('./verdict');
const { parseInstallCommand } = require('./parse');
const pkg = require('../package.json');

const TRUSTFILE_VERSION = '0.1';
const POLICY_FILE = 'deplatch.policy.json';

function loadPolicy(dir = process.cwd()) {
  const file = path.join(dir, POLICY_FILE);
  if (!fs.existsSync(file)) return { ...DEFAULT_POLICY };
  return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

async function checkOne(target, policy, opts = {}) {
  let evidence = null;
  let error = null;
  try {
    evidence = await lookup(target.ecosystem, target.name, opts);
  } catch (e) {
    error = e.message;
  }
  const { verdict, reasons } = decide({ ...target, evidence, error }, policy);
  return {
    ecosystem: target.ecosystem,
    name: target.name,
    verdict,
    reasons,
    evidence: evidence || { exists: null },
    ...(target.source ? { source: target.source } : {}),
  };
}

/** Checks packages and returns a trustfile object. */
async function check(targets, { policy = loadPolicy(), fetchImpl, now } = {}) {
  const opts = {};
  if (fetchImpl) opts.fetchImpl = fetchImpl;
  if (now) opts.now = now;
  const seen = new Set();
  const unique = targets.filter((t) => {
    const k = `${t.ecosystem}:${t.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const packages = await Promise.all(unique.map((t) => checkOne(t, policy, opts)));
  const summary = { verified: 0, review: 0, blocked: 0 };
  for (const p of packages) summary[p.verdict]++;
  return {
    trustfile: TRUSTFILE_VERSION,
    generatedAt: new Date(now || Date.now()).toISOString(),
    generator: { name: 'deplatch', version: pkg.version },
    policy,
    summary,
    packages,
  };
}

/** Reads dependency names from package.json and requirements*.txt in a folder. */
function scanProject(dir = process.cwd()) {
  const targets = [];
  const pj = path.join(dir, 'package.json');
  if (fs.existsSync(pj)) {
    const doc = JSON.parse(fs.readFileSync(pj, 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, spec] of Object.entries(doc[field] || {})) {
        if (/^(file:|link:|workspace:|git|https?:|github:)/.test(String(spec))) continue;
        targets.push({ ecosystem: 'npm', name, source: `package.json#${field}` });
      }
    }
  }
  for (const file of fs.readdirSync(dir).filter((f) => /^requirements.*\.txt$/.test(f))) {
    for (const raw of fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line || line.startsWith('-') || /^(git\+|https?:|\.|\/)/.test(line)) continue;
      const name = line.split(/[\[=<>!~;@\s]/)[0];
      if (name) targets.push({ ecosystem: 'pypi', name, source: file });
    }
  }
  return targets;
}

module.exports = { check, scanProject, loadPolicy, parseInstallCommand, POLICY_FILE, TRUSTFILE_VERSION };
