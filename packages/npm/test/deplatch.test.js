'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInstallCommand } = require('../src/parse');
const { decide, DEFAULT_POLICY } = require('../src/verdict');
const { closestPopular, levenshtein } = require('../src/similarity');
const popular = require('../src/popular');
const { check } = require('../src');

const NOW = Date.parse('2026-11-18T00:00:00Z');
const old = { exists: true, ageDays: 3000, repository: 'https://github.com/x/y', latestVersion: '1.0.0' };

// A fake registry so tests never touch the network.
function fakeFetch(db) {
  return async (url) => {
    const name = decodeURIComponent(url.split('/').filter(Boolean).slice(url.includes('pypi.org') ? -2 : -1)[0]);
    const entry = db[name];
    if (!entry) return { status: 404, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => entry };
  };
}

test('parses common install commands', () => {
  const cases = [
    ['npm install react lodash@4', ['npm:react', 'npm:lodash']],
    ['npm i -D @types/node@20', ['npm:@types/node']],
    ['yarn add axios', ['npm:axios']],
    ['pnpm add zod --save-exact', ['npm:zod']],
    ['pip install requests==2.32 "flask[async]>=3"', ['pypi:requests', 'pypi:flask']],
    ['python3 -m pip install -r req.txt numpy', ['pypi:numpy']],
    ['uv pip install httpx', ['pypi:httpx']],
    ['cd app && npm install ai-super-helper', ['npm:ai-super-helper']],
    ['npm install ./local-lib git+https://x/y.git user/repo', []],
    ['npm run build', []],
    ['echo pip install is cool', []],
  ];
  for (const [cmd, want] of cases) {
    const got = parseInstallCommand(cmd).map((t) => `${t.ecosystem}:${t.name}`);
    assert.deepEqual(got, want, cmd);
  }
});

test('a package that does not exist is always blocked', () => {
  for (const onReview of ['warn', 'block']) {
    const r = decide({ ecosystem: 'npm', name: 'ai-super-helper', evidence: { exists: false } }, { onReview });
    assert.equal(r.verdict, 'blocked');
    assert.equal(r.reasons[0].code, 'NOT_FOUND');
  }
});

test('an old, real, popular package is verified', () => {
  const r = decide({ ecosystem: 'npm', name: 'react', evidence: old }, DEFAULT_POLICY);
  assert.equal(r.verdict, 'verified');
});

test('a brand-new package goes to review, or is blocked when the policy says so', () => {
  const fresh = { ...old, ageDays: 2 };
  assert.equal(decide({ ecosystem: 'npm', name: 'new-auth-utils', evidence: fresh }).verdict, 'review');
  assert.equal(decide({ ecosystem: 'npm', name: 'new-auth-utils', evidence: fresh }, { onReview: 'block' }).verdict, 'blocked');
});

test('look-alike names are flagged, with a suggestion', () => {
  const near = closestPopular('pypi', 'reqeusts');
  assert.equal(near.name, 'requests');
  const r = decide({ ecosystem: 'pypi', name: 'reqeusts', evidence: old });
  assert.equal(r.verdict, 'review');
  assert.ok(r.reasons.some((x) => x.code === 'LOOKALIKE'));
});

test('allow and deny lists win over evidence', () => {
  assert.equal(decide({ ecosystem: 'npm', name: 'my-internal', evidence: { exists: false } }, { allow: ['npm:my-internal'] }).verdict, 'verified');
  assert.equal(decide({ ecosystem: 'npm', name: 'react', evidence: old }, { deny: ['npm:react'] }).verdict, 'blocked');
});

test('registry outages are reviewed, never silently trusted', () => {
  assert.equal(decide({ ecosystem: 'npm', name: 'x-pkg', error: 'timeout' }).verdict, 'review');
});

// Property: no popular package is ever treated as a look-alike of another.
test('property: popular packages are never flagged as look-alikes', () => {
  for (const eco of ['npm', 'pypi']) {
    for (const name of popular[eco]) {
      assert.equal(closestPopular(eco, name), null, `${eco}:${name}`);
      assert.equal(decide({ ecosystem: eco, name, evidence: old }).verdict, 'verified', `${eco}:${name}`);
    }
  }
});

// Property: randomly generated missing names are always blocked.
test('property: any name the registry does not know is blocked', () => {
  const letters = 'abcdefghijklmnopqrstuvwxyz-';
  for (let i = 0; i < 500; i++) {
    let name = 'x';
    const len = 3 + Math.floor(Math.random() * 20);
    for (let j = 0; j < len; j++) name += letters[Math.floor(Math.random() * letters.length)];
    const r = decide({ ecosystem: i % 2 ? 'npm' : 'pypi', name, evidence: { exists: false } }, { onReview: 'warn' });
    assert.equal(r.verdict, 'blocked', name);
  }
});

test('property: levenshtein is symmetric and zero only for equal strings', () => {
  const words = ['react', 'reakt', 'requests', 'reqeusts', 'lodash', 'l0dash', 'a', ''];
  for (const a of words) for (const b of words) {
    assert.equal(levenshtein(a, b), levenshtein(b, a));
    assert.equal(levenshtein(a, b) === 0, a === b);
  }
});

test('check() builds a valid trustfile from registry answers', async () => {
  const db = {
    react: { 'dist-tags': { latest: '19.0.0' }, time: { created: '2011-10-26T17:46:21Z' }, versions: { '19.0.0': { repository: { url: 'git+https://github.com/facebook/react.git' } } } },
    requests: { info: { version: '2.32.0', project_urls: { Source: 'https://github.com/psf/requests' } }, releases: { '0.2.0': [{ upload_time_iso_8601: '2011-02-14T00:00:00Z' }] } },
  };
  const tf = await check(
    [{ ecosystem: 'npm', name: 'react' }, { ecosystem: 'npm', name: 'ai-super-helper' }, { ecosystem: 'pypi', name: 'requests' }, { ecosystem: 'npm', name: 'react' }],
    { policy: DEFAULT_POLICY, fetchImpl: fakeFetch(db), now: NOW },
  );
  assert.equal(tf.trustfile, '0.1');
  assert.equal(tf.packages.length, 3, 'duplicates are removed');
  assert.deepEqual(tf.summary, { verified: 2, review: 0, blocked: 1 });
  const ghost = tf.packages.find((p) => p.name === 'ai-super-helper');
  assert.equal(ghost.verdict, 'blocked');
});
