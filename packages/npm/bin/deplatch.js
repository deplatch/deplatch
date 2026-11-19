#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync }      = require('child_process');
const { check, loadPolicy, parseInstallCommand, POLICY_FILE } = require('../src');
const { findManifests }  = require('../src/scan');
const { makeCachedFetch } = require('../src/cache');
const { DEFAULT_POLICY } = require('../src/verdict');
const { version }        = require('../package.json');

// ---------------------------------------------------------------------------
// Colour / TTY helpers
// ---------------------------------------------------------------------------

const isTTY   = process.stdout.isTTY;
const isErrTTY = process.stderr.isTTY;
const noColor = !isTTY || !!process.env.NO_COLOR;
const paint   = (code, s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `deplatch ${version} - check dependencies before you trust them

Usage:
  deplatch                               Scan the current project (same as: deplatch scan .)
  deplatch scan [dir] [opts]             Scan manifests recursively; report problems
  deplatch check <name...> [--pypi]      Check package names (npm default; prefix "pypi:" works too)
  deplatch guard <install command...>    Check, then run only if nothing is blocked
  deplatch hook                          Agent hook mode: reads tool-call JSON on stdin, exit 2 blocks
  deplatch init                          Create ${POLICY_FILE} and a Kiro hook
  deplatch help                          Show this message

Scan options:
  --all        Also check transitive deps from package-lock.json
  --fresh      Ignore the 24-hour registry cache
  --verbose    List all verified packages (not just the count)
  --json       Print the full trustfile JSON
  --out <file> Write trustfile JSON to a file

Exit codes: 0 clean, 1 something blocked, 2 blocked (hook mode), 3 usage error.`;

// ---------------------------------------------------------------------------
// Old-style flat report (used by 'check' and 'guard')
// ---------------------------------------------------------------------------

const BADGE = {
  verified: paint('32', 'VERIFIED'),
  review:   paint('33', 'REVIEW  '),
  blocked:  paint('31', 'BLOCKED '),
};

function printFlatReport(tf, stream = process.stdout) {
  for (const p of tf.packages) {
    stream.write(`${BADGE[p.verdict]}  ${p.ecosystem}:${p.name}\n`);
    for (const r of p.reasons) stream.write(`          - ${r.message}\n`);
  }
  const s = tf.summary;
  stream.write(`\n${s.verified} verified, ${s.review} to review, ${s.blocked} blocked\n`);
}

// ---------------------------------------------------------------------------
// New structured scan report
// ---------------------------------------------------------------------------

function printScanReport(tf, { verbose = false } = {}) {
  const { packages, summary } = tf;
  const blocked  = packages.filter((p) => p.verdict === 'blocked');
  const review   = packages.filter((p) => p.verdict === 'review');
  const verified = packages.filter((p) => p.verdict === 'verified');

  // 1. Problems
  if (blocked.length) {
    process.stdout.write(`\n${paint('31', '✗ Problems')}\n`);
    for (const p of blocked) {
      const src = p.source ? paint('2', ` (${p.source})`) : '';
      process.stdout.write(`  ${paint('31', '✗')} ${p.ecosystem}:${p.name}${src}\n`);
      for (const r of p.reasons) process.stdout.write(`      ${r.message}\n`);
    }
  }

  // 2. Review
  if (review.length) {
    process.stdout.write(`\n${paint('33', '⚠ Review')}\n`);
    for (const p of review) {
      const src = p.source ? paint('2', ` (${p.source})`) : '';
      process.stdout.write(`  ${paint('33', '⚠')} ${p.ecosystem}:${p.name}${src}\n`);
      for (const r of p.reasons) process.stdout.write(`      ${r.message}\n`);
    }
  }

  // 3. Good
  process.stdout.write(`\n${paint('32', '✓ Good')}\n`);
  if (verbose) {
    for (const p of verified) {
      const src = p.source ? paint('2', ` (${p.source})`) : '';
      process.stdout.write(`  ${paint('32', '✓')} ${p.ecosystem}:${p.name}${src}\n`);
    }
  } else {
    process.stdout.write(`  ${summary.verified} package${summary.verified === 1 ? '' : 's'} look fine\n`);
  }

  // Count distinct source files
  const files = new Set(packages.map((p) => p.source).filter(Boolean));

  // 4. Summary line
  const total  = packages.length;
  const nFiles = files.size;
  process.stdout.write(
    `\n${total} package${total === 1 ? '' : 's'} in ${nFiles} file${nFiles === 1 ? '' : 's'}: ` +
    `${summary.verified} good, ${summary.review} to review, ${summary.blocked} blocked\n`,
  );

  // 5. Next step
  if (blocked.length) {
    process.stdout.write(
      `\n${paint('33', 'Next step:')} Remove or replace the blocked packages, ` +
      `or add them to ${POLICY_FILE} allow list if they are internal.\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function targetsFromNames(names, pypi) {
  return names.map((n) => {
    const m = /^(npm|pypi):(.+)$/.exec(n);
    if (m) return { ecosystem: m[1], name: m[2] };
    return { ecosystem: pypi ? 'pypi' : 'npm', name: n };
  });
}

function stringsIn(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringsIn(v, out));
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Progress counter on stderr (only when stderr is a TTY)
// ---------------------------------------------------------------------------

function makeProgress() {
  if (!isErrTTY || process.env.NO_COLOR) return () => {};
  return (done, total) => {
    process.stderr.write(`\rChecking ${done}/${total}…\x1b[K`);
    if (done >= total) process.stderr.write('\r\x1b[K'); // clear line when done
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv) {
  const [cmd, ...rest] = argv;

  // ---- parse flags ----
  const flags    = new Set(rest.filter((a) => a.startsWith('--')));
  const outIdx   = rest.indexOf('--out');
  const outFile  = outIdx !== -1 ? rest[outIdx + 1] : null;
  // skipIdx is the index of the value that follows --out; -1 when --out is absent.
  // Using outIdx + 1 directly when outIdx === -1 gives 0, which silently drops
  // the first positional argument (the package name in `check <name> --json`).
  const skipIdx  = outIdx !== -1 ? outIdx + 1 : -1;
  const args     = rest.filter((a, i) => !a.startsWith('--') && i !== skipIdx);
  const json     = flags.has('--json');
  const verbose  = flags.has('--verbose');
  const fresh    = flags.has('--fresh');
  const all      = flags.has('--all');

  // ---- no-arg: treat as scan . ----
  if (!cmd || cmd === 'scan') {
    const dir  = path.resolve((cmd === 'scan' ? args[0] : null) || '.');
    const policy = loadPolicy(dir);
    const targets = findManifests(dir, { all });

    if (!targets.length) {
      process.stdout.write('No manifests found.\n');
      return 0;
    }

    const fetchImpl = makeCachedFetch(fetch, dir, { fresh });
    const onProgress = makeProgress();

    const tf = await check(targets, { policy, fetchImpl, onProgress });
    fetchImpl.persist();

    if (json) {
      console.log(JSON.stringify(tf, null, 2));
    } else {
      printScanReport(tf, { verbose });
    }
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(tf, null, 2) + '\n');
    return tf.summary.blocked ? 1 : 0;
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === '--version' || cmd === '-v')                { console.log(version); return 0; }

  if (cmd === 'check') {
    if (!args.length) { console.error('Give at least one package name.'); return 3; }
    const tf = await check(targetsFromNames(args, flags.has('--pypi')));
    json ? console.log(JSON.stringify(tf, null, 2)) : printFlatReport(tf);
    return tf.summary.blocked ? 1 : 0;
  }

  if (cmd === 'guard') {
    const command = rest.join(' ');
    const targets = parseInstallCommand(command);
    if (targets.length) {
      const tf = await check(targets);
      printFlatReport(tf, process.stderr);
      if (tf.summary.blocked) { console.error('\ndeplatch: install stopped.'); return 1; }
    }
    const r = spawnSync(command, { stdio: 'inherit', shell: true });
    return r.status ?? 1;
  }

  if (cmd === 'hook') {
    const raw = await readStdin();
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch { payload = { tool_input: raw }; }
    const commands = stringsIn(payload.tool_input ?? payload);
    const targets  = commands.flatMap(parseInstallCommand);
    if (!targets.length) return 0;
    const tf = await check(targets);
    const blocked = tf.packages.filter((p) => p.verdict === 'blocked');
    const review  = tf.packages.filter((p) => p.verdict === 'review');
    const lines   = (list) => list.map((p) => `- ${p.ecosystem}:${p.name}: ${p.reasons.map((r) => r.message).join(' ')}`).join('\n');
    if (blocked.length) {
      process.stderr.write(
        `deplatch blocked this install.\n${lines(blocked)}\n` +
        'Do not install these packages. Use a real, well-known package instead, or ask the user.\n');
      return 2;
    }
    if (review.length) process.stderr.write(`deplatch: review before trusting:\n${lines(review)}\n`);
    return 0;
  }

  if (cmd === 'init') {
    const policyPath = path.resolve(POLICY_FILE);
    if (!fs.existsSync(policyPath)) {
      fs.writeFileSync(policyPath, JSON.stringify(DEFAULT_POLICY, null, 2) + '\n');
      console.log(`Created ${POLICY_FILE}`);
    } else console.log(`${POLICY_FILE} already exists, left as is`);
    const hookPath = path.resolve('.kiro/hooks/deplatch.json');
    if (!fs.existsSync(hookPath)) {
      fs.mkdirSync(path.dirname(hookPath), { recursive: true });
      fs.writeFileSync(hookPath, JSON.stringify({
        version: 'v1',
        hooks: [{
          name:        'DepLatch: check packages before install',
          description: 'Blocks installs of packages that do not exist or look like impostors.',
          trigger: 'PreToolUse', matcher: 'shell',
          action:  { type: 'command', command: 'npx --yes deplatch hook' },
          timeout: 30,
        }],
      }, null, 2) + '\n');
      console.log('Created .kiro/hooks/deplatch.json');
    } else console.log('.kiro/hooks/deplatch.json already exists, left as is');
    return 0;
  }

  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  return 3;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err)  => { console.error(`deplatch: ${err.message}`); process.exitCode = 3; },
);
