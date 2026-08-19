#!/usr/bin/env node
/**
 * Build script for Rainbow Vale (js13k).
 * Concatenates src/*.js in the correct order, injects MAP_DATA, and writes
 * a single dist/index.html — then reports raw and gzip size so you can
 * watch the js13k budget (13312 bytes zipped) as you work.
 *
 * Pipeline stages (each optional, see flags below):
 *   1. concatenate         — always runs
 *   2. minify + mangle      — Terser: shortens every top-level name, strips
 *                            dead code/whitespace/comments
 *   3. pack                — Roadroller: re-encodes the minified JS as a
 *                            self-decoding blob, usually smaller than plain
 *                            gzip on top of it for code this repetitive
 *
 * Usage:
 *   node build.js                 — full pipeline: minify + pack (the build to zip and submit)
 *   node build.js --no-pack       — minify only, skip Roadroller (fast, still close to final size)
 *   node build.js --no-minify     — skip Terser too (raw concatenation, old behavior)
 *   node build.js --watch         — rebuild on every save; defaults to minify-only (no pack) so saves stay fast
 *   node build.js --watch --pack  — same, but runs the full (slow) pipeline on every save
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { minify } = require('terser');

// roadroller ships ESM only (its .cjs wrapper drags in the old `esm` shim, which doesn't
// run on modern Node) — load it via dynamic import instead.
let PackerPromise;
function loadPacker() {
  if (!PackerPromise) PackerPromise = import('roadroller').then(m => m.Packer);
  return PackerPromise;
}

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const LIMIT_BYTES = 13312; // js13k zip size limit

// CRC32 via zlib's own gzip footer instead of hand-rolling the table — RFC 1952
// guarantees a gzip stream ends with a 4-byte CRC32 + 4-byte size trailer
function crc32(buf) {
  const gz = zlib.gzipSync(buf, { level: 0 });
  return gz.readUInt32LE(gz.length - 8);
}

// builds a minimal single-entry DEFLATE zip — the actual js13k submission format — so
// the reported size matches what the judge sees, not a gzip approximation of it
function makeZip(filename, content) {
  const nameBuf = Buffer.from(filename, 'utf8');
  const crc = crc32(content);
  const compressed = zlib.deflateRawSync(content, { level: 9 });
  const size = content.length,
    csize = compressed.length;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(8, 8); // method: deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(csize, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localEntry = Buffer.concat([local, nameBuf, compressed]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central directory header signature
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(8, 10); // method: deflate
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(csize, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const centralEntry = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16); // central dir offset = size of the (only) local entry before it

  return Buffer.concat([localEntry, centralEntry, eocd]);
}

// src/*.js use real import/export for IDE navigation only — no bundler, browser never
// sees it. Stripped here before concatenation, so shipped code is identical to plain
// globals, same as always (see README).
function stripModuleSyntax(src) {
  // `import { A, B } from '../x/y.js';` — single- or multi-line, dropped whole-line
  src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?[ \t]*\r?\n?/gm, '');
  // `export const X = ...` / `export function f() {}` — keep the declaration, drop
  // only the `export ` keyword
  src = src.replace(/^export (?=(const|let|function)\b)/gm, '');
  return src;
}

// Order matters: mirrors the original single-file layout — each group below used to be
// one file (world.js, render.js), now split into same-topic files under src/core,
// src/world, src/render, still concatenated back-to-back (paths relative to SRC).
const JS_ORDER = [
  'core/colors.js',
  'core/engine-core.js',
  'core/decor.js',
  'world/world-zones.js',
  'world/spell-shapes.js',
  'world/world-objects.js',
  'world/map-loader.js', // contains a /*BUILD:MAP_DATA*/ marker, filled in below
  'core/player.js',
  'core/ui-panel.js',
  'core/music.js',
  'render/render-world.js',
  'render/render-scene.js',
  'render/render-player.js',
  'render/render-hud.js',
];

const TERSER_OPTIONS = {
  ecma: 2020,
  compress: {
    ecma: 2020,
    passes: 5, // 4->5 saves ~45B; 6 converges to the same output as 5, so 5 is the ceiling
    toplevel: true,
    unsafe: true,
    unsafe_arrows: true,
    unsafe_math: true,
    unsafe_methods: true,
    unsafe_undefined: true,
    unsafe_proto: true,
    unsafe_regexp: true,
    unsafe_comps: true,
    booleans_as_integers: true,
  },
  // Property mangling is on but scoped to this reserved list: the codebase does a lot of
  // dynamic string-keyed dispatch (roomById[id], RUNE_SHAPES[shapeKey], CHAR_TO_CELL[char],
  // DIRS4[dirName], etc.) where an object-literal key would get renamed while the matching
  // string value baked into map data/zone ids/direction names wouldn't — Terser can't
  // connect the two, so it breaks silently (no build error, just undefined at runtime).
  // Every name here was found by grepping for literal keys that also flow into a dynamic
  // `obj[someVar]` access elsewhere. Anything else is fair game for Terser to rename
  // (player.x, obj.roomId, spot.collected, ...). Verified with a Node harness exercising
  // menu render, all 4 move directions, and every spell nature/shape/modifier — the
  // harness itself isn't checked into the repo.
  mangle: {
    toplevel: true,
    properties: {
      reserved: [
        // zone/room ids
        'hub',
        'swamp',
        'cavern',
        'orchard',
        'marsh',
        // rune shapes (engine-core RUNE_SHAPES / ui-panel RUNE_SHAPE)
        'star',
        'gem',
        'flower',
        'drop',
        'heart',
        // direction names (DIRS4, DIAG_OF, DIR_INVERSE, doMove's deltas, ...)
        'up',
        'down',
        'left',
        'right',
        // mirror orientation codes (MIRROR_REFLECT, MIRROR_CORNER)
        'NE',
        'ES',
        'SW',
        'WN',
        // Nature / Shape / Modifier enum values (world.js) and their DESC_* dictionaries
        'BURN',
        'FREEZE',
        'PUSH',
        'SOLIDIFY',
        'LINE',
        'HALF_CIRCLE',
        'CONE',
        'DIAGONAL',
        'CONTACT_DEFAULT',
        'PIERCE',
        'BOUNCE',
        'SPREAD',
        'MIRROR',
        'NONE',
        // map-encoding characters (map-loader.js FLOOR_CHARS, keyed by gridStr's literal
        // chars — same failure mode as KEY_MAP below: a renamed key here just means
        // FLOOR_CHARS[c] silently returns undefined for that tile at runtime, so anything
        // added to FLOOR_CHARS's keys must be added here too. Caught once already when this
        // list only had the plain floor letters (h/m/j/v/b) and FLOOR_CHARS grew puddle's
        // uppercase variants (M/J/V/B) plus vine/crate/lock's dedicated letters
        // (n/k/o/g, e/i/p/q, r/s/t/u) without updating this list — silently lost every
        // puddle tile and half the vine/crate/lock tiles to property mangling.
        'h',
        'm',
        'j',
        'v',
        'b',
        'M',
        'J',
        'V',
        'B',
        'n',
        'k',
        'o',
        'g',
        'e',
        'i',
        'p',
        'q',
        'r',
        's',
        't',
        'u',
        // rune symbol glyphs (SYMBOL_TO_ROLE) and direction-vector string keys
        // (DIR_NAME_OF_VEC) — likely immune anyway (not valid unquoted identifiers),
        // reserved since it costs nothing
        '▲',
        '❄',
        '~',
        '■',
        '0,-1',
        '0,1',
        '-1,0',
        '1,0',
        // player.js KEY_MAP, keyed by the browser's own e.key strings (ArrowUp) — e.key is
        // native so these can't be mangled, meaning KEY_MAP's own keys must match exactly.
        // Missed this once: broke all keyboard movement silently, since KEY_MAP[e.key] just
        // returned undefined and the handler quietly no-op'd.
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ],
    },
  },
  format: {
    ecma: 2020,
    comments: false,
  },
};

async function build(opts = {}) {
  const { minifyJs = true, pack = true } = opts;
  if (pack && !minifyJs)
    console.warn(
      'Roadroller works best on already-minified input — consider dropping --no-minify.'
    );

  // MAP_DATA.objects (171 entries) comes in tight clusters (rock formations, vine
  // patches, ...), so consecutive x/y are usually close — delta-encoding against the
  // previous entry turns most 2-3 digit coordinates into single digits. ~13-20% smaller
  // (measured via gzip/brotli as a proxy for Roadroller). Decoded back to absolute
  // coordinates by a running-sum accumulator in map-loader.js's MAP_DATA.objects.forEach.
  const mapDataObj = JSON.parse(fs.readFileSync(path.join(SRC, 'world', 'map-data.json'), 'utf8'));
  let prevX = 0,
    prevY = 0;
  mapDataObj.objects = mapDataObj.objects.map(([x, y, ...rest]) => {
    const d = [x - prevX, y - prevY, ...rest];
    prevX = x;
    prevY = y;
    return d;
  });
  const mapData = 'const MAP_DATA=' + JSON.stringify(mapDataObj) + ';';

  const rawJs = JS_ORDER.map(name => {
    let content = fs.readFileSync(path.join(SRC, name), 'utf8');
    content = stripModuleSyntax(content);
    if (content.includes('/*BUILD:MAP_DATA*/')) {
      content = content.replace('/*BUILD:MAP_DATA*/', mapData);
    }
    return content;
  }).join('\n');

  let js = rawJs;
  if (minifyJs) {
    const result = await minify(js, TERSER_OPTIONS);
    if (result.error) throw result.error;
    js = result.code;
  }

  let scriptContent = js;
  if (pack) {
    const Packer = await loadPacker();
    const packer = new Packer([{ data: js, type: 'js', action: 'eval' }], { allowFreeVars: true });
    await packer.optimize(2);
    const { firstLine, secondLine } = packer.makeDecoder();
    scriptContent = firstLine + secondLine;
    // Packed output is high-entropy and could contain "</script", truncating the
    // <script> block — fail loudly instead of shipping a broken build.
    if (/<\/script/i.test(scriptContent)) {
      throw new Error(
        'Roadroller output contains a "</script" sequence — rebuild (parameter search is randomized) to get a different pack.'
      );
    }
  }

  // minify the STATIC shell only, never the injected script: swap the marker for a plain
  // placeholder first, so comment-stripping below can't eat into the packed JS blob. Bit us
  // once already — stripping comments before injecting ate the marker itself (it's a block
  // comment too), silently shipping a build with no game in it.
  const MARKER_PLACEHOLDER = 'JSINJECTPLACEHOLDER';
  let shell = fs.readFileSync(path.join(SRC, 'shell.html'), 'utf8');
  shell = shell
    .replace('/*BUILD:INJECT_JS*/', MARKER_PLACEHOLDER)
    // <style> only: unlike the surrounding HTML, CSS needs no whitespace around
    // { } : ; , at all (only real token separators like the space in `calc(a + b)`
    // survive, since those aren't adjacent to a stripped character) — so this can
    // safely go further than the generic HTML whitespace pass below.
    .replace(/<style>([\s\S]*?)<\/style>/, (_, css) =>
      '<style>' +
      css
        .replace(/\/\*[\s\S]*?\*\//g, '') // CSS comments
        .replace(/\s*([{}:;,])\s*/g, '$1')
        .replace(/;\}/g, '}') // last declaration in a block never needs its semicolon
        .replace(/\n/g, '')
        .trim() +
      '</style>'
    )
    .replace(/\/\*[\s\S]*?\*\//g, '') // remaining (non-CSS) comments
    .replace(/>\s+</g, '><') // whitespace-only text nodes between tags
    .replace(/\n\s*/g, '\n') // leading indentation on every line
    .replace(/\n+/g, '\n') // blank lines left behind by the above
    .replace(/\s*\/>/g, '>') // HTML5 doesn't need the self-closing slash on void elements
    .trim();
  const html = shell.replace(MARKER_PLACEHOLDER, () => scriptContent);

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
  const outPath = path.join(DIST, 'index.html');
  fs.writeFileSync(outPath, html);

  const htmlBuf = Buffer.from(html, 'utf8');
  const zipBuf = makeZip('index.html', htmlBuf);
  const zipPath = path.join(DIST, 'game.zip');
  fs.writeFileSync(zipPath, zipBuf);

  const raw = htmlBuf.length;
  const zipSize = zipBuf.length; // the actual submission artifact's size, not a gzip approximation of it
  const pct = ((zipSize / LIMIT_BYTES) * 100).toFixed(1);
  const bar = renderBar(zipSize, LIMIT_BYTES);
  const stages = ['concat', minifyJs && 'minify+mangle', pack && 'roadroller']
    .filter(Boolean)
    .join(' -> ');

  console.log(`\nBuilt ${path.relative(process.cwd(), outPath)}  [${stages}]`);
  console.log(`       ${path.relative(process.cwd(), zipPath)}`);
  console.log(`  raw:  ${raw.toLocaleString()} B`);
  console.log(
    `  zip:  ${zipSize.toLocaleString()} B  (${pct}% of ${LIMIT_BYTES.toLocaleString()} B js13k limit)`
  );
  console.log(`  ${bar}`);
  if (zipSize > LIMIT_BYTES) {
    console.log(`  \x1b[31mOVER BUDGET by ${(zipSize - LIMIT_BYTES).toLocaleString()} B\x1b[0m`);
  } else {
    console.log(`  \x1b[32m${(LIMIT_BYTES - zipSize).toLocaleString()} B of headroom left\x1b[0m`);
  }

  return { raw, zipSize };
}

function renderBar(value, max, width = 40) {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  const over = value > max;
  const color = over ? '\x1b[31m' : value / max > 0.85 ? '\x1b[33m' : '\x1b[32m';
  return (
    color + '█'.repeat(filled) + '\x1b[90m' + '░'.repeat(Math.max(0, width - filled)) + '\x1b[0m'
  );
}

module.exports = { build, SRC, DIST };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const has = flag => argv.includes(flag);
  const watch = has('--watch');
  const minifyJs = !has('--no-minify');
  // watch mode skips the slow Roadroller pass by default unless asked for explicitly
  const pack = has('--pack') ? true : has('--no-pack') ? false : !watch;

  const run = () =>
    build({ minifyJs, pack }).catch(e => {
      console.error('Build error:', e);
      if (!watch) process.exitCode = 1;
    });

  run();
  if (watch) {
    console.log('\nWatching src/ for changes... (Ctrl+C to stop)\n');
    let timer = null;
    let building = false;
    fs.watch(SRC, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (building) return;
        building = true;
        run().finally(() => {
          building = false;
        });
      }, 150); // debounce rapid saves
    });
  }
}
