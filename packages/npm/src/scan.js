'use strict';

const fs   = require('fs');
const path = require('path');
const { parse: parseTOML } = require('./toml');

// Folders always skipped when walking the tree.
const ALWAYS_SKIP = new Set([
  'node_modules', '.git', '.venv', 'venv', 'dist', 'build',
  '.deplatch', '.npm', '__pycache__', '.tox', '.mypy_cache',
]);

// --------------------------------------------------------------------
// .gitignore reader — simple line-based, no glob library
// --------------------------------------------------------------------

/**
 * Returns a function that returns true when a path segment (or relative path
 * from the .gitignore's directory) should be ignored.
 * Only handles simple directory-name and simple prefix patterns; that is
 * sufficient for typical .gitignore "dist/", "build/", "*.egg-info", etc.
 */
function readGitignore(dir) {
  const file = path.join(dir, '.gitignore');
  if (!fs.existsSync(file)) return () => false;
  const patterns = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  return function isIgnored(rel) {
    const name = path.basename(rel);
    for (const pat of patterns) {
      // Exact directory name match (e.g. "dist" or "dist/")
      const bare = pat.replace(/\/$/, '');
      if (name === bare) return true;
      // Simple prefix match for patterns like "*.egg-info"
      if (bare.startsWith('*') && name.endsWith(bare.slice(1))) return true;
      // Relative path match
      if (rel === bare || rel.startsWith(bare + path.sep)) return true;
    }
    return false;
  };
}

// --------------------------------------------------------------------
// Recursive directory walk
// --------------------------------------------------------------------

/**
 * Yields absolute paths of files matching the predicate, skipping
 * ALWAYS_SKIP dirs and anything matched by .gitignore at `root`.
 */
function* walk(dir, root, isIgnored) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    const abs  = path.join(dir, entry.name);
    const rel  = path.relative(root, abs);

    if (entry.isDirectory()) {
      if (ALWAYS_SKIP.has(entry.name) || isIgnored(rel)) continue;
      yield* walk(abs, root, isIgnored);
    } else if (entry.isFile()) {
      if (!isIgnored(rel)) yield abs;
    }
  }
}

// --------------------------------------------------------------------
// Per-manifest parsers
// Return Array<{ ecosystem, name, source }>
// `source` is the path relative to the scan root.
// --------------------------------------------------------------------

function sourceRel(absFile, root) {
  return path.relative(root, absFile).replace(/\\/g, '/');
}

function parsePackageJson(absFile, root, includeAll) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(absFile, 'utf8')); }
  catch { return []; }

  const targets = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(doc[field] || {})) {
      if (/^(file:|link:|workspace:|git|https?:|github:)/.test(String(spec))) continue;
      targets.push({ ecosystem: 'npm', name, source: sourceRel(absFile, root) });
    }
  }
  return targets;
}

function parsePackageLock(absFile, root) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(absFile, 'utf8')); }
  catch { return []; }

  const targets = [];
  const pkgs = doc.packages || {};
  for (const [pkgPath, entry] of Object.entries(pkgs)) {
    if (!pkgPath || pkgPath === '' || entry.dev === true) continue;
    if (entry.extraneous || entry.link) continue;
    // pkgPath is "node_modules/foo" or "node_modules/@scope/pkg"
    const name = pkgPath.replace(/^node_modules\//, '');
    if (!name) continue;
    targets.push({ ecosystem: 'npm', name, source: sourceRel(absFile, root) });
  }
  return targets;
}

function parseRequirementsTxt(absFile, root) {
  let content;
  try { content = fs.readFileSync(absFile, 'utf8'); }
  catch { return []; }

  const targets = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || line.startsWith('-') || /^(git\+|https?:|\.|\/)/.test(line)) continue;
    const name = line.split(/[\[=<>!~;@\s]/)[0];
    if (name) targets.push({ ecosystem: 'pypi', name, source: sourceRel(absFile, root) });
  }
  return targets;
}

function parsePyprojectToml(absFile, root) {
  let content;
  try { content = fs.readFileSync(absFile, 'utf8'); }
  catch { return []; }

  let doc;
  try { doc = parseTOML(content); }
  catch { return []; }

  const targets = [];
  const src = sourceRel(absFile, root);

  // [project].dependencies  — list of PEP 508 strings: "requests>=2.0"
  const projectDeps = (doc.project || {}).dependencies;
  if (Array.isArray(projectDeps)) {
    for (const spec of projectDeps) {
      const name = String(spec).split(/[\[=<>!~;@\s]/)[0].trim();
      if (name) targets.push({ ecosystem: 'pypi', name, source: src });
    }
  }

  // [project.optional-dependencies].*  — dict of lists
  const optDeps = ((doc.project || {})['optional-dependencies']) || {};
  for (const specs of Object.values(optDeps)) {
    if (!Array.isArray(specs)) continue;
    for (const spec of specs) {
      const name = String(spec).split(/[\[=<>!~;@\s]/)[0].trim();
      if (name) targets.push({ ecosystem: 'pypi', name, source: src });
    }
  }

  // [tool.poetry.dependencies]  — dict: { requests = "^2.0" }
  const poetryDeps = (((doc.tool || {}).poetry || {}).dependencies) || {};
  for (const [name, spec] of Object.entries(poetryDeps)) {
    if (name.toLowerCase() === 'python') continue;  // skip python version constraint
    if (!spec || (typeof spec === 'object' && spec.optional === true)) continue;
    targets.push({ ecosystem: 'pypi', name, source: src });
  }

  return targets;
}

function parsePipfile(absFile, root) {
  let content;
  try { content = fs.readFileSync(absFile, 'utf8'); }
  catch { return []; }

  // Pipfile is TOML-compatible
  let doc;
  try { doc = parseTOML(content); }
  catch { return []; }

  const targets = [];
  const src = sourceRel(absFile, root);

  for (const section of ['packages', 'dev-packages']) {
    const entries = doc[section] || {};
    if (typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const name of Object.keys(entries)) {
      if (name.toLowerCase() === 'python_version' || name.toLowerCase() === 'python_full_version') continue;
      targets.push({ ecosystem: 'pypi', name, source: src });
    }
  }
  return targets;
}

// --------------------------------------------------------------------
// Main export
// --------------------------------------------------------------------

/**
 * Walk `dir` recursively, parse all supported manifests, and return
 * an array of { ecosystem, name, source } targets deduplicated by
 * (ecosystem, name, source) — the same package in two files produces
 * two entries so the caller knows all files it appears in.
 *
 * @param {string} dir  Root directory to scan.
 * @param {{ all?: boolean }} opts
 */
function findManifests(dir, opts = {}) {
  const root      = path.resolve(dir);
  const isIgnored = readGitignore(root);
  const targets   = [];
  const seen      = new Set(); // (eco:name:source) triples for dedup

  function add(list) {
    for (const t of list) {
      const k = `${t.ecosystem}:${t.name.toLowerCase()}:${t.source}`;
      if (!seen.has(k)) { seen.add(k); targets.push(t); }
    }
  }

  for (const absFile of walk(root, root, isIgnored)) {
    const name = path.basename(absFile);

    if (name === 'package.json')      { add(parsePackageJson(absFile, root)); continue; }
    if (name === 'package-lock.json' && opts.all) { add(parsePackageLock(absFile, root)); continue; }
    if (/^requirements.*\.txt$/.test(name)) { add(parseRequirementsTxt(absFile, root)); continue; }
    if (name === 'pyproject.toml')    { add(parsePyprojectToml(absFile, root)); continue; }
    if (name === 'Pipfile')           { add(parsePipfile(absFile, root)); continue; }
  }

  return targets;
}

module.exports = { findManifests, parsePackageJson, parseRequirementsTxt, parsePyprojectToml, parsePipfile, parsePackageLock, readGitignore };
