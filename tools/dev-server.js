#!/usr/bin/env node
/**
 * Dev server: serves the built game and live-reloads the browser on every
 * change in src/ — like "npm run watch" plus an actual server, so you just
 * leave a tab open and it updates itself.
 *
 * Usage: node tools/dev-server.js         — fast rebuilds: minify only, no Roadroller
 *        node tools/dev-server.js --pack  — full pipeline incl. Roadroller on every save,
 *                                           for checking the real submission size as you go
 * Then open the printed URL. Ctrl+C to stop.
 *
 * The live-reload script is injected only into what this server sends over
 * HTTP — dist/index.html on disk stays exactly what build.js produces, so
 * it's still the file you'd zip and submit.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { build, DIST } = require('../build.js');

const SRC = path.join(__dirname, '..', 'src');
const DIST_HTML = path.join(DIST, 'index.html');
const PORT = 8533;
// Roadroller's optimize() is a randomized parameter search — seconds per save, and it
// was blocking every request until the rebuild finished. build.js's own --watch mode
// already skips it by default for exactly this reason; the dev server just wasn't
// following that convention. Run with --pack when you actually need the real zip size.
const pack = process.argv.includes('--pack');

const sseClients = [];

let building = false;
let pending = false;
async function rebuild() {
  if (building) {
    pending = true; // a save landed mid-build — re-run once this one is done
    return;
  }
  building = true;
  try {
    await build({ minifyJs: true, pack, dev: true });
    sseClients.forEach(res => res.write('data: reload\n\n'));
  } catch (e) {
    console.error('Build error:', e.message);
  } finally {
    building = false;
    if (pending) {
      pending = false;
      rebuild();
    }
  }
}

const RELOAD_CLIENT = `
<script>
(function(){
  var es = new EventSource('/__events');
  es.onmessage = function(){ location.reload(); };
  es.onerror = function(){ /* server restarting or stopped — just retry silently */ };
})();
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/__events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    sseClients.push(res);
    req.on('close', () => {
      const i = sseClients.indexOf(res);
      if (i >= 0) sseClients.splice(i, 1);
    });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(DIST_HTML, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500);
        res.end('Build output missing — check the terminal for build errors.');
        return;
      }
      const withReload = html.replace('</body>', RELOAD_CLIENT + '</body>');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(withReload);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

rebuild();
server.listen(PORT, () => {
  console.log(`Dev server: http://localhost:${PORT}`);
  console.log(
    pack
      ? 'Watching src/ — the page reloads itself on every change (full pipeline incl. Roadroller, a few seconds per save).'
      : 'Watching src/ — the page reloads itself on every change (minify only, no Roadroller — pass --pack for the full pipeline).'
  );
  console.log('Ctrl+C to stop.\n');
});

let timer = null;
fs.watch(SRC, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 150); // debounce rapid saves
});
