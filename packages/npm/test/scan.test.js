'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const { parse: parseTOML }   = require('../src/toml');
const { findManifests, parsePackageJson, parseRequirementsTxt, parsePyprojectToml, parsePipfile } = require('../src/scan');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deplatch-test-'));
}

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

// ---------------------------------------------------------------------------
// TOML parser
// ---------------------------------------------------------------------------

test('TOML: parses basic key-value pairs', () => {
  const doc = parseTOML(`
name = "my-project"
version = "1.0.0"
debug = true
count = 42
`);
  assert.equal(doc.name, 'my-project');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.debug, true);
  assert.equal(doc.count, '42');
});

test('TOML: parses standard tables', () => {
  const doc = parseTOML(`
[project]
name = "my-project"

[project.optional-dependencies]
dev = ["pytest", "black"]
`);
  assert.equal(doc.project.name, 'my-project');
  assert.deepEqual(doc.project['optional-dependencies'].dev, ['pytest', 'black']);
});

test('TOML: parses multiline arrays', () => {
  const doc = parseTOML(`
[project]
dependencies = [
  "requests>=2.0",
  "flask[async]>=3.0",
  "numpy",
]
`);
  assert.deepEqual(doc.project.dependencies, ['requests>=2.0', 'flask[async]>=3.0', 'numpy']);
});

test('TOML: parses poetry-style [tool.poetry.dependencies]', () => {
  const doc = parseTOML(`
[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"
click = { version = "^8.0", optional = false }
`);
  assert.equal(doc.tool.poetry.dependencies.requests, '^2.28');
  assert.equal(doc.tool.poetry.dependencies.python, '^3.9');
  assert.equal(typeof doc.tool.poetry.dependencies.click, 'object');
});

test('TOML: parses Pipfile [packages] section', () => {
  const doc = parseTOML(`
[packages]
requests = "*"
flask = ">=2.0"

[dev-packages]
pytest = "*"
`);
  assert.ok('requests' in doc.packages);
  assert.ok('flask' in doc.packages);
  assert.ok('pytest' in doc['dev-packages']);
});

test('TOML: handles single-quoted and double-quoted strings', () => {
  const doc = parseTOML(`
a = 'single quoted'
b = "double quoted"
c = 'it\\'s fine'
`);
  assert.equal(doc.a, 'single quoted');
  assert.equal(doc.b, 'double quoted');
});

test('TOML: ignores comments', () => {
  const doc = parseTOML(`
# top comment
[project]
name = "foo"  # inline comment
`);
  assert.equal(doc.project.name, 'foo');
});

test('TOML: real-world pyproject.toml (FastAPI-style)', () => {
  const src = `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "fastapi"
version = "0.110.0"
dependencies = [
    "starlette>=0.36.3,<0.37.0",
    "pydantic>=1.7.4",
    "typing-extensions>=4.8.0",
]

[project.optional-dependencies]
all = [
    "httpx>=0.23.0",
    "jinja2>=2.11.2",
]
`;
  const doc = parseTOML(src);
  assert.equal(doc.project.name, 'fastapi');
  assert.ok(doc.project.dependencies.some((d) => d.startsWith('starlette')));
  assert.ok(doc.project['optional-dependencies'].all.some((d) => d.startsWith('httpx')));
});

test('TOML: real-world pyproject.toml (Poetry-style)', () => {
  const src = `
[tool.poetry]
name = "my-app"
version = "1.0.0"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.28"
pydantic = { version = "^2.0", extras = ["email"] }

[tool.poetry.dev-dependencies]
pytest = "^7.0"
`;
  const doc = parseTOML(src);
  assert.equal(doc.tool.poetry.dependencies.requests, '^2.28');
  assert.equal(typeof doc.tool.poetry.dependencies.pydantic, 'object');
});

// ---------------------------------------------------------------------------
// parsePyprojectToml
// ---------------------------------------------------------------------------

test('parsePyprojectToml: extracts [project].dependencies', () => {
  const dir = tmpDir();
  write(dir, 'pyproject.toml', `
[project]
dependencies = [
  "requests>=2.0",
  "flask[async]",
  "numpy==1.24",
]
`);
  const targets = parsePyprojectToml(path.join(dir, 'pyproject.toml'), dir);
  const names = targets.map((t) => t.name);
  assert.ok(names.includes('requests'));
  assert.ok(names.includes('flask'));
  assert.ok(names.includes('numpy'));
  assert.ok(targets.every((t) => t.ecosystem === 'pypi'));
});

test('parsePyprojectToml: extracts [project.optional-dependencies]', () => {
  const dir = tmpDir();
  write(dir, 'pyproject.toml', `
[project.optional-dependencies]
test = ["pytest>=7", "coverage"]
docs = ["sphinx"]
`);
  const targets = parsePyprojectToml(path.join(dir, 'pyproject.toml'), dir);
  const names = targets.map((t) => t.name);
  assert.ok(names.includes('pytest'));
  assert.ok(names.includes('coverage'));
  assert.ok(names.includes('sphinx'));
});

test('parsePyprojectToml: extracts [tool.poetry.dependencies], skips python', () => {
  const dir = tmpDir();
  write(dir, 'pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"
click = "^8.0"
`);
  const targets = parsePyprojectToml(path.join(dir, 'pyproject.toml'), dir);
  const names = targets.map((t) => t.name);
  assert.ok(names.includes('requests'));
  assert.ok(names.includes('click'));
  assert.ok(!names.includes('python'));
});

// ---------------------------------------------------------------------------
// parsePipfile
// ---------------------------------------------------------------------------

test('parsePipfile: extracts [packages] and [dev-packages]', () => {
  const dir = tmpDir();
  write(dir, 'Pipfile', `
[[source]]
url = "https://pypi.org/simple"
name = "pypi"

[packages]
requests = "*"
flask = ">=2.0"

[dev-packages]
pytest = "*"
black = "*"
`);
  const targets = parsePipfile(path.join(dir, 'Pipfile'), dir);
  const names = targets.map((t) => t.name);
  assert.ok(names.includes('requests'));
  assert.ok(names.includes('flask'));
  assert.ok(names.includes('pytest'));
  assert.ok(names.includes('black'));
  assert.ok(targets.every((t) => t.ecosystem === 'pypi'));
});

// ---------------------------------------------------------------------------
// findManifests: manifest discovery and skip rules
// ---------------------------------------------------------------------------

test('findManifests: finds package.json and requirements.txt', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    dependencies: { react: '^19', lodash: '^4' },
  }));
  write(dir, 'requirements.txt', 'requests==2.32\nflask>=3\n');

  const targets = findManifests(dir);
  const npm  = targets.filter((t) => t.ecosystem === 'npm').map((t) => t.name);
  const pypi = targets.filter((t) => t.ecosystem === 'pypi').map((t) => t.name);
  assert.ok(npm.includes('react'));
  assert.ok(npm.includes('lodash'));
  assert.ok(pypi.includes('requests'));
  assert.ok(pypi.includes('flask'));
});

test('findManifests: finds pyproject.toml', () => {
  const dir = tmpDir();
  write(dir, 'pyproject.toml', `
[project]
dependencies = ["httpx>=0.23", "fastapi"]
`);
  const targets = findManifests(dir);
  const names = targets.map((t) => t.name);
  assert.ok(names.includes('httpx'));
  assert.ok(names.includes('fastapi'));
});

test('findManifests: finds Pipfile', () => {
  const dir = tmpDir();
  write(dir, 'Pipfile', `
[packages]
requests = "*"
`);
  const targets = findManifests(dir);
  assert.ok(targets.some((t) => t.name === 'requests'));
});

test('property: files inside node_modules are never scanned', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ dependencies: { react: '^19' } }));
  write(dir, 'node_modules/evil/package.json', JSON.stringify({ dependencies: { malware: '^1' } }));

  const targets = findManifests(dir);
  assert.ok(!targets.some((t) => t.name === 'malware'), 'node_modules must be skipped');
  assert.ok(targets.some((t) => t.name === 'react'));
});

test('property: files inside .git are never scanned', () => {
  const dir = tmpDir();
  write(dir, 'requirements.txt', 'requests\n');
  write(dir, '.git/hooks/requirements.txt', 'evil-pkg\n');

  const targets = findManifests(dir);
  assert.ok(!targets.some((t) => t.name === 'evil-pkg'));
  assert.ok(targets.some((t) => t.name === 'requests'));
});

test('property: .venv and venv are never scanned', () => {
  const dir = tmpDir();
  write(dir, 'requirements.txt', 'requests\n');
  write(dir, '.venv/requirements.txt', 'evil-pkg\n');
  write(dir, 'venv/requirements.txt', 'another-evil\n');

  const targets = findManifests(dir);
  assert.ok(!targets.some((t) => t.name === 'evil-pkg'));
  assert.ok(!targets.some((t) => t.name === 'another-evil'));
});

test('property: dist and build are never scanned', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ dependencies: { react: '^19' } }));
  write(dir, 'dist/package.json', JSON.stringify({ dependencies: { ghost: '^1' } }));
  write(dir, 'build/package.json', JSON.stringify({ dependencies: { ghost2: '^1' } }));

  const targets = findManifests(dir);
  assert.ok(!targets.some((t) => t.name === 'ghost'));
  assert.ok(!targets.some((t) => t.name === 'ghost2'));
});

test('findManifests: .gitignore entries skip matching subdirs', () => {
  const dir = tmpDir();
  write(dir, '.gitignore', 'generated\n*.egg-info\n');
  write(dir, 'requirements.txt', 'requests\n');
  write(dir, 'generated/requirements.txt', 'evil-pkg\n');

  const targets = findManifests(dir);
  assert.ok(!targets.some((t) => t.name === 'evil-pkg'));
  assert.ok(targets.some((t) => t.name === 'requests'));
});

test('findManifests: recursion finds nested manifests', () => {
  const dir = tmpDir();
  write(dir, 'frontend/package.json', JSON.stringify({ dependencies: { vue: '^3' } }));
  write(dir, 'backend/requirements.txt', 'django>=4\n');

  const targets = findManifests(dir);
  assert.ok(targets.some((t) => t.name === 'vue'));
  assert.ok(targets.some((t) => t.name === 'django'));
});

test('property: same package in multiple files produces multiple entries with distinct sources', () => {
  const dir = tmpDir();
  write(dir, 'requirements.txt', 'requests\n');
  write(dir, 'sub/requirements.txt', 'requests\n');

  const targets = findManifests(dir);
  const reqEntries = targets.filter((t) => t.name === 'requests');
  // Each (name, source) pair is distinct
  const sources = reqEntries.map((t) => t.source);
  assert.equal(new Set(sources).size, 2, 'two distinct source entries for requests');
});

test('findManifests --all: includes package-lock.json transitive deps', () => {
  const dir = tmpDir();
  const lockContent = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { react: '^19' } },
      'node_modules/react': { version: '19.0.0', resolved: 'https://registry.npmjs.org/react/-/react-19.0.0.tgz' },
      'node_modules/react-dom': { version: '19.0.0', resolved: 'https://...' },
    },
  });
  write(dir, 'package-lock.json', lockContent);

  const targets = findManifests(dir, { all: true });
  const names = targets.map((t) => t.name);
  assert.ok(names.includes('react'));
  assert.ok(names.includes('react-dom'));
});

test('findManifests: skips non-registry specs in package.json', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    dependencies: {
      react: '^19',
      local: 'file:../local',
      gitpkg: 'git+https://github.com/x/y.git',
    },
  }));
  const targets = findManifests(dir);
  assert.ok(targets.some((t) => t.name === 'react'));
  assert.ok(!targets.some((t) => t.name === 'local'));
  assert.ok(!targets.some((t) => t.name === 'gitpkg'));
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

test('cache: warm cache suppresses network calls', async () => {
  const { makeCachedFetch } = require('../src/cache');
  const os   = require('os');
  const path = require('path');
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'deplatch-cache-test-'));
  const cacheDir = path.join(dir, '.deplatch');
  fs.mkdirSync(cacheDir, { recursive: true });

  // Pre-populate cache with a fresh entry
  const ts = Date.now();
  fs.writeFileSync(
    path.join(cacheDir, 'cache.json'),
    JSON.stringify({
      'https://registry.npmjs.org/react': {
        ts,
        status: 200,
        body: { 'dist-tags': { latest: '19.0.0' }, time: { created: '2011-01-01T00:00:00Z' }, versions: {} },
      },
    }),
  );

  const calls = [];
  const baseFetch = async (url) => { calls.push(url); return { status: 200, ok: true, json: async () => ({}) }; };
  const cachedFetch = makeCachedFetch(baseFetch, dir, { fresh: false });

  const res = await cachedFetch('https://registry.npmjs.org/react');
  const body = await res.json();

  assert.deepEqual(calls, [], 'warm cache must not call base fetch');
  assert.ok(body['dist-tags'], 'cached body returned');
});

test('cache: --fresh bypasses the cache', async () => {
  const { makeCachedFetch } = require('../src/cache');
  const os   = require('os');
  const path = require('path');
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'deplatch-cache-fresh-'));
  const cacheDir = path.join(dir, '.deplatch');
  fs.mkdirSync(cacheDir, { recursive: true });

  const ts = Date.now();
  fs.writeFileSync(
    path.join(cacheDir, 'cache.json'),
    JSON.stringify({
      'https://registry.npmjs.org/react': { ts, status: 200, body: { cached: true } },
    }),
  );

  const calls = [];
  const liveBody = { 'dist-tags': { latest: '19.0.0' }, time: { created: '2011-01-01T00:00:00Z' }, versions: {} };
  const baseFetch = async (url) => { calls.push(url); return { status: 200, ok: true, json: async () => liveBody }; };
  const cachedFetch = makeCachedFetch(baseFetch, dir, { fresh: true });

  const res = await cachedFetch('https://registry.npmjs.org/react');
  const body = await res.json();

  assert.equal(calls.length, 1, '--fresh must call through to the network');
  assert.equal(body['dist-tags'].latest, '19.0.0');
});
