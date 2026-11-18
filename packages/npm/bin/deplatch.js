#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, scanProject, loadPolicy, parseInstallCommand, POLICY_FILE } = require('../src');
const { DEFAULT_POLICY } = require('../src/verdict');
const { version } = require('../package.json');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const BADGE = {
  verified: paint('32', 'VERIFIED'),
  review: paint('33', 'REVIEW  '),
  blocked: paint('31', 'BLOCKED '),
};

const HELP = `deplatch ${version} - check dependencies before you trust them

Usage:
  deplatch check <name...> [--pypi] [--json]   Check package names (npm by default; prefix "pypi:" works too)
  deplatch scan [dir] [--json] [--out file]    Check package.json and requirements*.txt (CI gate)
  deplatch guard <install command...>          Check an install command, then run it only if nothing is blocked
  deplatch hook                                Agent hook mode: reads tool-call JSON on stdin, exit 2 blocks
  deplatch init                                Create ${POLICY_FILE} and a Kiro hook in this project

Exit codes: 0 clean, 1 something blocked, 2 blocked (hook mode), 3 usage error.`;

function printReport(tf, stream = process.stdout) {
  for (const p of tf.packages) {
    stream.write(`${BADGE[p.verdict]}  ${p.ecosystem}:${p.name}\n`);
    for (const r of p.reasons) stream.write(`          - ${r.message}\n`);
  }
  const s = tf.summary;
  stream.write(`\n${s.verified} verified, ${s.review} to review, ${s.blocked} blocked\n`);
}

function targetsFromNames(names, pypi) {
  return names.map((n) => {
    const m = /^(npm|pypi):(.+)$/.exec(n);
    if (m) return { ecosystem: m[1], name: m[2] };
    return { ecosystem: pypi ? 'pypi' : 'npm', name: n };
  });
}

// Collects every string inside the tool input, so the hook works whatever
// field name an agent uses for the shell command ("command", "cmd", ...).
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

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const outValue = rest.indexOf('--out') !== -1 ? rest.indexOf('--out') + 1 : -1;
  const args = rest.filter((a, i) => !a.startsWith('--') && i !== outValue);
  const json = flags.has('--json');

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === '--version' || cmd === '-v') { console.log(version); return 0; }

  if (cmd === 'check') {
    if (!args.length) { console.error('Give at least one package name.'); return 3; }
    const tf = await check(targetsFromNames(args, flags.has('--pypi')));
    json ? console.log(JSON.stringify(tf, null, 2)) : printReport(tf);
    return tf.summary.blocked ? 1 : 0;
  }

  if (cmd === 'scan') {
    const dir = path.resolve(args[0] || '.');
    const targets = scanProject(dir);
    const tf = await check(targets, { policy: loadPolicy(dir) });
    const outIdx = rest.indexOf('--out');
    if (outIdx !== -1 && rest[outIdx + 1]) fs.writeFileSync(rest[outIdx + 1], JSON.stringify(tf, null, 2) + '\n');
    json ? console.log(JSON.stringify(tf, null, 2)) : printReport(tf);
    return tf.summary.blocked ? 1 : 0;
  }

  if (cmd === 'guard') {
    const command = rest.join(' ');
    const targets = parseInstallCommand(command);
    if (targets.length) {
      const tf = await check(targets);
      printReport(tf, process.stderr);
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
    const targets = commands.flatMap(parseInstallCommand);
    if (!targets.length) return 0;
    const tf = await check(targets);
    const blocked = tf.packages.filter((p) => p.verdict === 'blocked');
    const review = tf.packages.filter((p) => p.verdict === 'review');
    const lines = (list) => list.map((p) => `- ${p.ecosystem}:${p.name}: ${p.reasons.map((r) => r.message).join(' ')}`).join('\n');
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
          name: 'DepLatch: check packages before install',
          description: 'Blocks installs of packages that do not exist or look like impostors.',
          trigger: 'PreToolUse',
          matcher: 'shell',
          action: { type: 'command', command: 'npx --yes deplatch hook' },
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
  (err) => { console.error(`deplatch: ${err.message}`); process.exitCode = 3; },
);
