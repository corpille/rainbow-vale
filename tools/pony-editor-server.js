#!/usr/bin/env node
/**
 * Local server for the pony shape editor.
 * Serves tools/pony-shape-editor.html and exposes a tiny API so the editor's
 * "Write to render-player.js" button can save its combined side+down+up export
 * directly to src/render/render-player.js — the same file the game imports.
 * No more manual copy/paste between the two.
 *
 * Usage: node tools/pony-editor-server.js
 * Then open the printed URL in your browser.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RENDER_PLAYER_PATH = path.join(__dirname, '..', 'src', 'render', 'render-player.js');
const PORT = 8534;

// a lightweight syntax sanity check — `import`/`export` aren't valid outside a real ES
// module, so strip just those keywords and try to parse what's left. Catches a
// malformed generator output here instead of silently corrupting the real game file.
function assertParses(source) {
  const stripped = source.replace(/^import\s+.*$/gm, '').replace(/^export\s+function/gm, 'function');
  new Function(stripped); // throws SyntaxError on malformed input
}

function writeRenderPlayer(source) {
  assertParses(source);
  if (!source.includes('export function drawPlayer') || !source.includes('function drawPonySide')) {
    throw new Error('Payload does not look like a full render-player.js (missing drawPlayer/drawPonySide)');
  }
  const backupPath = RENDER_PLAYER_PATH + '.bak';
  if (fs.existsSync(RENDER_PLAYER_PATH)) fs.copyFileSync(RENDER_PLAYER_PATH, backupPath); // one-deep safety net
  fs.writeFileSync(RENDER_PLAYER_PATH, source);
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  if (req.url === '/api/render-player' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        writeRenderPlayer(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        console.log(
          `[saved] ${body.length} bytes -> ${path.relative(process.cwd(), RENDER_PLAYER_PATH)} (backup at render-player.js.bak)`
        );
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
        console.log('[save failed]', e.message);
      }
    });
    return;
  }

  // static files (pony-shape-editor.html and anything else dropped in tools/)
  const safeUrl = req.url === '/' ? '/pony-shape-editor.html' : req.url;
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
    console.log(`A pony editor server is already running at http://localhost:${PORT}`);
    console.log('Open that URL (or refresh your existing tab) — saving works from there.');
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Pony shape editor: http://localhost:${PORT}`);
  console.log(`Saving writes directly to: ${path.relative(process.cwd(), RENDER_PLAYER_PATH)}`);
  console.log('Ctrl+C to stop.');
});
