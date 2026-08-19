#!/usr/bin/env node
/**
 * Local server for the map editor.
 * Serves tools/map-editor.html and exposes a tiny API so the editor's
 * "Save to project" button writes directly to src/world/map-data.json — the same
 * file build.js reads. No more manual copy/paste between the two tools.
 *
 * Usage: node tools/editor-server.js
 * Then open the printed URL in your browser.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MAP_DATA_PATH = path.join(__dirname, '..', 'src', 'world', 'map-data.json');
const PORT = 8532;

function readMapData() {
  return fs.readFileSync(MAP_DATA_PATH, 'utf8');
}

// plain `JSON.stringify(obj, null, 2)` would put every single number in doors/items/
// objects/verrouLinks on its own line, turning a coordinate pair like [3, -6] into 4
// lines and making the tuple shape impossible to scan. Keep each tuple compact on one
// line instead; only the top-level keys get their own line. gridStr is one giant string
// either way — no formatting makes that scannable, so it's left alone.
function formatMapData(obj) {
  const keys = Object.keys(obj);
  const lines = ['{'];
  keys.forEach((k, i) => {
    const v = obj[k];
    const comma = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v) && v.length && Array.isArray(v[0])) {
      lines.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((item, j) => lines.push(`    ${JSON.stringify(item)}${j < v.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

function writeMapData(jsonStr) {
  const parsed = JSON.parse(jsonStr); // throws on invalid JSON — never write garbage
  if (!parsed.gridStr || !Array.isArray(parsed.doors)) {
    throw new Error('Payload does not look like valid map data (missing gridStr/doors)');
  }
  const backupPath = MAP_DATA_PATH + '.bak';
  if (fs.existsSync(MAP_DATA_PATH)) fs.copyFileSync(MAP_DATA_PATH, backupPath); // one-deep safety net
  // formatted for readability/diffing in the editor — this file never ships (build.js
  // JSON.parses it regardless of whitespace), so formatting here has zero effect on the
  // built game.
  fs.writeFileSync(MAP_DATA_PATH, formatMapData(parsed));
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  if (req.url === '/api/map-data' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(readMapData());
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.url === '/api/map-data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        writeMapData(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        console.log(
          `[saved] ${body.length} bytes -> ${path.relative(process.cwd(), MAP_DATA_PATH)} (backup at map-data.json.bak)`
        );
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
        console.log('[save failed]', e.message);
      }
    });
    return;
  }

  // static files (map-editor.html and anything else dropped in tools/)
  const safeUrl = req.url === '/' ? '/map-editor.html' : req.url;
  const filePath = path.join(ROOT, path.normalize(safeUrl).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    // a previous run is still alive and serving fine — only one process can bind the
    // port, but that's not broken. Point at the existing instance instead of crashing
    // with a stack trace that makes it look like saving itself is broken.
    console.log(`A map editor server is already running at http://localhost:${PORT}`);
    console.log('Open that URL (or refresh your existing tab) — saving works from there.');
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Map editor:  http://localhost:${PORT}`);
  console.log(`Saving writes directly to: ${path.relative(process.cwd(), MAP_DATA_PATH)}`);
  console.log('Ctrl+C to stop.');
});
