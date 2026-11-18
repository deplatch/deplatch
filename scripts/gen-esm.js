#!/usr/bin/env node
// scripts/gen-esm.js
// Generates web/lib/*.esm.js from packages/npm/src/{popular,similarity,parse,verdict}.js
// by rewriting CommonJS require/module.exports to ES-module import/export.
//
// Usage:
//   node scripts/gen-esm.js          writes web/lib/*.esm.js to disk
//   node scripts/gen-esm.js --check  exits 1 if committed files differ from what would be generated
//
// Built-in modules only. No dependencies.

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration: which source files to process, in dependency order
// ---------------------------------------------------------------------------

const ROOT    = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'packages', 'npm', 'src');
const OUT_DIR = path.join(ROOT, 'web', 'lib');

const MODULES = ['popular', 'similarity', 'parse', 'verdict'];

const GENERATED_HEADER =
  '// GENERATED — do not edit. Run `node scripts/gen-esm.js` to regenerate.\n' +
  '// Source: packages/npm/src/{name}.js\n';

// ---------------------------------------------------------------------------
// Transform: CJS source → ES-module source
// ---------------------------------------------------------------------------

/**
 * Rewrites one CJS source file to ES-module syntax.
 * Rules applied, in order:
 *   1. Remove `'use strict';` line (and one following blank line if present).
 *   2. `const { a, b } = require('./X')` → `import { a, b } from './X.esm.js'`
 *   3. `const X = require('./X')`         → `import X from './X.esm.js'`
 *   4. `module.exports = { a, b, ... };`  → `export { a, b, ... };\nexport default { a, b, ... };`
 *
 * All other lines are kept verbatim.
 */
function transform(src, moduleName) {
  const lines = src.split('\n');
  const out   = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Rule 1: drop 'use strict'; and the blank line that follows it
    if (/^'use strict';$/.test(line.trim())) {
      if (i + 1 < lines.length && lines[i + 1].trim() === '') i++;
      continue;
    }

    // Rule 2: const { a, b } = require('./X')
    {
      const m = line.match(/^(\s*)const\s+(\{[^}]+\})\s*=\s*require\(['"]\.\/([^'"]+)['"]\);?\s*$/);
      if (m) {
        const [, indent, names, dep] = m;
        out.push(`${indent}import ${names} from './${dep}.esm.js';`);
        continue;
      }
    }

    // Rule 3: const X = require('./X')
    {
      const m = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\(['"]\.\/([^'"]+)['"]\);?\s*$/);
      if (m) {
        const [, indent, binding, dep] = m;
        out.push(`${indent}import ${binding} from './${dep}.esm.js';`);
        continue;
      }
    }

    // Rule 4: module.exports = { ... };   (must be on a single line)
    {
      const m = line.match(/^module\.exports\s*=\s*(\{[^}]+\});?\s*$/);
      if (m) {
        // Extract the names from the object literal: { a, b, c }
        const inner = m[1].replace(/^\{|\}$/g, '').trim();
        const names = inner
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ');
        out.push(`export { ${names} };`);
        out.push(`export default { ${names} };`);
        continue;
      }
    }

    out.push(line);
  }

  const header = GENERATED_HEADER.replace('{name}', moduleName);
  return header + '\n' + out.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const checkMode = process.argv.includes('--check');
const failures  = [];

for (const mod of MODULES) {
  const srcFile = path.join(SRC_DIR, `${mod}.js`);
  const outFile = path.join(OUT_DIR, `${mod}.esm.js`);

  const src       = fs.readFileSync(srcFile, 'utf8');
  const generated = transform(src, mod);

  if (checkMode) {
    if (!fs.existsSync(outFile)) {
      failures.push(`${outFile}: file does not exist (run node scripts/gen-esm.js)`);
      continue;
    }
    const committed = fs.readFileSync(outFile, 'utf8');
    if (committed !== generated) {
      failures.push(`${outFile}: differs from what gen-esm.js would generate (run node scripts/gen-esm.js)`);
    }
  } else {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(outFile, generated, 'utf8');
    console.log(`wrote ${path.relative(ROOT, outFile)}`);
  }
}

if (checkMode) {
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
  console.log('OK: all web/lib/*.esm.js files are up to date');
}
