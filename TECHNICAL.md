# Technical notes

See [README.md](README.md) for the game itself. This covers the codebase and build.

## Project structure

```
rainbow-vale/
├── src/            Game source, concatenated and minified into dist/ at build time.
│   ├── shell.html    HTML shell + CSS — the built JS is injected into it.
│   ├── core/         Engine loop, the player, the spell bar UI, palette, decor, audio.
│   ├── world/        Zones, objects, spell resolution, and the static map data.
│   └── render/       Everything drawn to the canvas.
├── build.js        Build script — concatenates src/, minifies, packs, writes dist/.
├── tools/          Map editor, pony sprite editor, and local dev servers.
└── dist/           Build output — index.html is what you playtest and submit.
```

Nothing is loaded at runtime: `build.js` inlines `src/world/map-data.json` as `MAP_DATA`
and drops the whole bundle into `shell.html`, so `dist/index.html` is the entire game in
one file.

## Building and running

```
npm install       # once — Terser and Roadroller are needed to build
npm run build     # full pipeline (minify + pack), prints a size report
npm run dev       # rebuild + serve at http://localhost:8533, reloads on save
npm run editor    # visual map editor at http://localhost:8532
npm run pony-editor  # unicorn sprite editor at http://localhost:8534
```

`npm run dev` is the one to leave open while working: edit anything in `src/`, save, and
the open browser tab reloads on its own. It rebuilds minify-only by default, since
Roadroller's parameter search costs seconds on every save — run `node tools/dev-server.js
--pack` when you want the real submission size as you go.

Faster build variants, for when you only care about roughly where the budget sits:

```
npm run build:fast   # minify only, skip Roadroller
npm run build:raw    # raw concatenation, no Terser either
npm run watch        # build.js's own watch mode, no server
```

Every build reports raw and zipped size against the js13k limit (13312 bytes). The zip is
a real single-entry DEFLATE zip, so the number matches what a judge would see rather than
a gzip approximation of it. `@gfx/zopfli` squeezes out roughly another 190 bytes and is
the one optional dependency — `build.js` falls back to zlib if it isn't installed. Terser
and Roadroller are not optional.

## Dev-only code

Anything between `/*BUILD:DEV_ONLY_START*/` and `/*BUILD:DEV_ONLY_END*/` is stripped from
the real build, so debug affordances cost zero bytes in the submission. What's in there
today, all in [src/core/player.js](src/core/player.js):

|                  |                                       |
| ---------------- | ------------------------------------- |
| `0`              | unlock all four runes                 |
| `5` – `8`        | pop each rune's pickup card (m/j/v/b) |
| `9`              | jump straight to the ending           |
| `window.T(x, y)` | tile type at a coordinate             |
| `window.P()`     | player x, y, facing                   |

## Housekeeping

```
npm run lint         # eslint
npm run format       # prettier --write
npm run format:check # prettier, no writes
```
