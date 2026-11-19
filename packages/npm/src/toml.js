'use strict';

// Minimal TOML parser — reads only the subset needed for pyproject.toml and Pipfile:
//   - Standard tables:  [table] and [table.sub]
//   - Array of tables:  [[array.of.tables]]  (parsed but values collected as list)
//   - String values:    "…" and '…'
//   - Inline arrays:    ["a", "b"]  including multiline
//   - Inline tables:    { key = "val" }
//   - Bare key/value pairs
//
// No attempt is made to implement full TOML. The parser is strict enough to
// correctly read the tables DepLatch cares about without misreading anything.
// Throws for syntax errors that would produce wrong results silently.

function parse(src) {
  const lines = src.split(/\r?\n/);
  const root = {};
  let current = root;    // the table object we are currently filling
  let currentKey = [];   // key path of current table, e.g. ['project']

  // Resolve/create a nested object at a dotted path, creating intermediates.
  function at(obj, keys) {
    let cur = obj;
    for (const k of keys) {
      if (!(k in cur)) cur[k] = {};
      // If we hit an array-of-tables entry, work inside the last element.
      if (Array.isArray(cur[k])) cur = cur[k][cur[k].length - 1];
      else cur = cur[k];
    }
    return cur;
  }

  // ---- value parsers ----

  function parseString(s, pos) {
    // Triple-quoted
    if (s.startsWith("'''", pos)) {
      const end = s.indexOf("'''", pos + 3);
      if (end === -1) throw new Error('Unterminated multiline literal string');
      return { val: s.slice(pos + 3, end), next: end + 3 };
    }
    if (s.startsWith('"""', pos)) {
      const end = s.indexOf('"""', pos + 3);
      if (end === -1) throw new Error('Unterminated multiline basic string');
      return { val: s.slice(pos + 3, end).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\'), next: end + 3 };
    }
    if (s[pos] === "'") {
      const end = s.indexOf("'", pos + 1);
      if (end === -1) throw new Error('Unterminated literal string');
      return { val: s.slice(pos + 1, end), next: end + 1 };
    }
    if (s[pos] === '"') {
      let val = '';
      let i = pos + 1;
      while (i < s.length) {
        if (s[i] === '\\') {
          const c = s[i + 1];
          if (c === 'n') { val += '\n'; i += 2; }
          else if (c === 't') { val += '\t'; i += 2; }
          else if (c === '"') { val += '"'; i += 2; }
          else if (c === '\\') { val += '\\'; i += 2; }
          else { val += c; i += 2; }
        } else if (s[i] === '"') {
          return { val, next: i + 1 };
        } else {
          val += s[i++];
        }
      }
      throw new Error('Unterminated basic string');
    }
    throw new Error(`Expected string at position ${pos}, got: ${s[pos]}`);
  }

  function parseValue(s, pos) {
    while (pos < s.length && s[pos] === ' ') pos++;
    if (pos >= s.length) return { val: null, next: pos };

    if (s[pos] === '"' || s[pos] === "'") return parseString(s, pos);

    // Inline array
    if (s[pos] === '[') return parseArray(s, pos);

    // Inline table
    if (s[pos] === '{') return parseInlineTable(s, pos);

    // Boolean
    if (s.startsWith('true', pos)) return { val: true, next: pos + 4 };
    if (s.startsWith('false', pos)) return { val: false, next: pos + 5 };

    // Number / bare value — read until comma, ], }, or comment/EOL
    const m = s.slice(pos).match(/^[^,\]\}#\n]*/);
    return { val: m[0].trim(), next: pos + m[0].length };
  }

  function parseArray(s, pos) {
    // pos points at '['
    // We may need to span multiple lines; we join them before calling.
    pos++; // skip '['
    const vals = [];
    while (true) {
      while (pos < s.length && /[\s,]/.test(s[pos])) pos++;
      if (pos >= s.length) break;
      if (s[pos] === '#') { while (pos < s.length && s[pos] !== '\n') pos++; continue; }
      if (s[pos] === ']') { pos++; break; }
      const { val, next } = parseValue(s, pos);
      if (val !== null) vals.push(val);
      pos = next;
    }
    return { val: vals, next: pos };
  }

  function parseInlineTable(s, pos) {
    pos++; // skip '{'
    const obj = {};
    while (true) {
      while (pos < s.length && s[pos] === ' ') pos++;
      if (pos >= s.length || s[pos] === '}') { pos++; break; }
      if (s[pos] === ',') { pos++; continue; }
      // key
      let key = '';
      if (s[pos] === '"' || s[pos] === "'") {
        const r = parseString(s, pos);
        key = r.val; pos = r.next;
      } else {
        const m = s.slice(pos).match(/^[\w.-]+/);
        if (!m) throw new Error(`Expected key in inline table at pos ${pos}`);
        key = m[0]; pos += m[0].length;
      }
      while (pos < s.length && s[pos] === ' ') pos++;
      if (s[pos] !== '=') throw new Error('Expected = in inline table');
      pos++; // skip '='
      const { val, next } = parseValue(s, pos);
      obj[key] = val;
      pos = next;
    }
    return { val: obj, next: pos };
  }

  // ---- line-level logic ----

  // Accumulate logical lines (handle line-continuation for multiline arrays)
  let i = 0;
  while (i < lines.length) {
    let line = lines[i++];
    const stripped = line.trim();

    // Skip blank and comment lines
    if (!stripped || stripped.startsWith('#')) continue;

    // Array-of-tables header [[a.b]]
    if (stripped.startsWith('[[')) {
      const m = stripped.match(/^\[\[([^\]]+)\]\]/);
      if (!m) { continue; } // malformed, skip
      const keys = m[1].trim().split('.').map((k) => k.trim());
      // Navigate to parent, appending new object to array at final key
      const parent = keys.length > 1 ? at(root, keys.slice(0, -1)) : root;
      const last = keys[keys.length - 1];
      if (!Array.isArray(parent[last])) parent[last] = [];
      const entry = {};
      parent[last].push(entry);
      current = entry;
      currentKey = keys;
      continue;
    }

    // Standard table header [a.b.c]
    if (stripped.startsWith('[')) {
      const m = stripped.match(/^\[([^\]]+)\]/);
      if (!m) { continue; }
      const keys = m[1].trim().split('.').map((k) => k.trim());
      currentKey = keys;
      current = at(root, keys);
      continue;
    }

    // Key = value
    // Handle inline multiline arrays: if the value starts '[' but doesn't close
    // on this line, keep reading lines until it does.
    let eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue; // not a key=value line

    // Accumulate continuation for multiline arrays/strings
    // Count unclosed brackets in value portion
    let valSrc = line.slice(eqIdx + 1);
    let depth = 0;
    for (const ch of valSrc) { if (ch === '[' || ch === '(') depth++; else if (ch === ']' || ch === ')') depth--; }
    while (depth > 0 && i < lines.length) {
      const next = lines[i++];
      valSrc += '\n' + next;
      for (const ch of next) { if (ch === '[' || ch === '(') depth++; else if (ch === ']' || ch === ')') depth--; }
    }

    // Key may be dotted: a.b.c = …  or quoted
    const keyPart = line.slice(0, eqIdx).trim();
    let keySegs;
    if (keyPart.startsWith('"') || keyPart.startsWith("'")) {
      keySegs = [parseString(keyPart, 0).val];
    } else {
      keySegs = keyPart.split('.').map((k) => k.trim());
    }

    // Strip inline comment from value source (but not inside strings/arrays)
    let cleanVal = valSrc.trim();
    // Remove trailing comment (outside of any string/bracket)
    let inStr = false, strChar = '', d2 = 0;
    let commentAt = -1;
    for (let ci = 0; ci < cleanVal.length; ci++) {
      const ch = cleanVal[ci];
      if (!inStr) {
        if (ch === '[' || ch === '{') d2++;
        else if (ch === ']' || ch === '}') d2--;
        else if (ch === '"' || ch === "'") { inStr = true; strChar = ch; }
        else if (ch === '#' && d2 === 0) { commentAt = ci; break; }
      } else {
        if (ch === strChar && cleanVal[ci - 1] !== '\\') inStr = false;
      }
    }
    if (commentAt > 0) cleanVal = cleanVal.slice(0, commentAt).trim();

    const { val } = parseValue(cleanVal, 0);
    // Navigate to parent of the last key segment within current table context
    const target = keySegs.length > 1 ? at(current, keySegs.slice(0, -1)) : current;
    target[keySegs[keySegs.length - 1]] = val;
  }

  return root;
}

module.exports = { parse };
