const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

// src/*.js use real import/export (sourceType: module below) for IDE navigation and
// no-undef/no-unused-vars checking — build.js strips it all before concatenating (see
// JS_ORDER), so at runtime every top-level const/let/function is still a plain global,
// same as if the import/export lines never existed.
//
// This list is a safety net now, not the main mechanism — mostly just covers MAP_DATA,
// which map-loader.js gets via the /*BUILD:MAP_DATA*/ splice, not a real import (build.js
// injects a delta-encoded transform, not a verbatim copy, so `import { MAP_DATA }` would
// lie). Everything else should have a real import/export pair.
function listJsFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFilesRecursive(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
function collectSharedGlobals() {
  const files = listJsFilesRecursive(path.join(__dirname, 'src'));
  const names = new Set();
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let line of lines) {
      const commentIdx = line.indexOf('//');
      if (commentIdx !== -1) line = line.slice(0, commentIdx);

      let m = line.match(/^function\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        names.add(m[1]);
        continue;
      }

      m = line.match(/^(?:const|let)\s+(.+)/);
      if (!m) continue;
      let rest = m[1];
      const semi = rest.indexOf(';');
      if (semi !== -1) rest = rest.slice(0, semi);

      // split declarators on top-level commas only (skip commas inside (), [], {})
      let depth = 0,
        parts = [],
        cur = '';
      for (const ch of rest) {
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) {
          parts.push(cur);
          cur = '';
          continue;
        }
        cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        const dm = p.match(/^\s*([A-Za-z_$][\w$]*)/);
        if (dm) names.add(dm[1]);
      }
    }
  }
  return Object.fromEntries([...names].map(n => [n, 'writable']));
}

module.exports = [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...collectSharedGlobals(),
      },
    },
    rules: {
      eqeqeq: 'warn',
      'no-var': 'error',
      'prefer-const': 'warn',
      // real imports mean an unused import/top-level const is worth flagging now (the old
      // globals-only setup couldn't tell "unused" from "implicitly exported") —
      // builtinGlobals: false below still covers names from the safety-net list above
      'no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_' }],
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  {
    files: ['build.js', 'eslint.config.js', 'tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  // must stay last: turns off any ESLint stylistic rule that could fight Prettier's output
  prettier,
];
