// GENERATED — do not edit. Run `node scripts/gen-esm.js` to regenerate.
// Source: packages/npm/src/parse.js

// Turns a shell command into the list of packages it would install.
// Only plain registry names are returned; paths, URLs, git refs and
// tarballs are reported separately so callers can decide what to do.

const NPM_INSTALLERS = [
  ['npm', ['install', 'i', 'add', 'isntall']],
  ['pnpm', ['add', 'install', 'i']],
  ['yarn', ['add']],
  ['bun', ['add', 'install', 'i']],
];

const PIP_INSTALLERS = [
  ['pip', ['install']],
  ['pip3', ['install']],
  ['uv', ['add']],
  ['poetry', ['add']],
  ['pipx', ['install']],
];

// Flags whose next token is a value, not a package.
const VALUE_FLAGS = new Set([
  '-r', '--requirement', '-c', '--constraint', '-e', '--editable',
  '-i', '--index-url', '--extra-index-url', '-f', '--find-links',
  '--target', '-t', '--prefix', '--root', '--registry', '--tag',
  '--python', '-p', '--group', '--source', '--cwd', '--filter',
]);

function tokenize(command) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

// Split on shell separators so "cd x && npm i y" is understood.
function segments(command) {
  return command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
}

function stripNpmVersion(spec) {
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1);
    return at === -1 ? spec : spec.slice(0, at);
  }
  const at = spec.indexOf('@');
  return at === -1 ? spec : spec.slice(0, at);
}

function stripPipVersion(spec) {
  // name[extra]==1.0 ; name>=1 ; name~=1 ; name!=1 ; name<2 ; name @ url
  return spec.split(/[\[=<>!~;@\s]/)[0];
}

function isNonRegistry(spec) {
  return /^(\.|\/|~|file:|git\+|git:|https?:|github:|link:|workspace:)/.test(spec) ||
    /\.(tgz|tar\.gz|whl|zip)$/.test(spec) ||
    (/^[\w.-]+\/[\w.-]+$/.test(spec) && !spec.startsWith('@')); // user/repo shorthand
}

function findInstaller(tokens) {
  // The installer must be the command itself, after harmless prefixes like
  // "sudo" or "NODE_ENV=dev", so "echo pip install x" is not an install.
  let i = 0;
  while (i < tokens.length && (/^(sudo|env|time|command|nohup)$/.test(tokens[i]) || /^\w+=/.test(tokens[i]))) i++;
  {
    let t = tokens[i];
    if (/^python[\d.]*$/.test(t) && tokens[i + 1] === '-m') {
      t = tokens[i + 2];
      if (t === 'pip' || t === 'pip3') {
        const verb = tokens[i + 3];
        if (verb === 'install') return { ecosystem: 'pypi', start: i + 4 };
      }
      return null;
    }
    for (const [bin, verbs] of NPM_INSTALLERS) {
      if (t === bin && verbs.includes(tokens[i + 1])) return { ecosystem: 'npm', start: i + 2 };
    }
    for (const [bin, verbs] of PIP_INSTALLERS) {
      if (t === bin) {
        if (bin === 'uv' && tokens[i + 1] === 'pip' && tokens[i + 2] === 'install') {
          return { ecosystem: 'pypi', start: i + 3 };
        }
        if (verbs.includes(tokens[i + 1])) return { ecosystem: 'pypi', start: i + 2 };
      }
    }
  }
  return null;
}

/**
 * @param {string} command
 * @returns {{ ecosystem: 'npm'|'pypi', name: string }[]}
 */
function parseInstallCommand(command) {
  const found = [];
  for (const seg of segments(command || '')) {
    const tokens = tokenize(seg);
    const hit = findInstaller(tokens);
    if (!hit) continue;
    for (let j = hit.start; j < tokens.length; j++) {
      const tok = tokens[j];
      if (VALUE_FLAGS.has(tok)) { j++; continue; }
      if (tok.startsWith('-')) continue;
      if (isNonRegistry(tok)) continue;
      const name = hit.ecosystem === 'npm' ? stripNpmVersion(tok) : stripPipVersion(tok);
      if (name) found.push({ ecosystem: hit.ecosystem, name });
    }
  }
  return found;
}

export { parseInstallCommand, tokenize };
export default { parseInstallCommand, tokenize };
