# Technical notes

See [README.md](README.md) for the game itself. This covers the codebase and build.

## Project structure

```
rainbow-vale/
├── src/            Game source, concatenated and minified into dist/ at build time.
│   ├── shell.html    HTML shell + CSS.
│   ├── core/         Engine bits, the player, and the spell bar UI.
│   ├── world/        Zones, spell resolution, and the static map data.
│   └── render/       Everything drawn to the canvas.
├── build.js        Build script — concatenates src/*.js, minifies, and packs into dist/.
├── tools/          Map editor, pony sprite editor, and local dev servers.
└── dist/           Build output — index.html is what you playtest and submit.
```

## Building and running

```
npm run build     # build once, print a size report
npm run dev       # rebuild + serve at http://localhost:8533, reloads on save
npm run editor    # visual map editor at http://localhost:8532
```

No `npm install` needed just to build — `build.js` only uses Node's built-in
`fs`/`path`/`zlib` (Terser and Roadroller, used by the build itself, are dev
dependencies). `npm run dev` is the one to leave open while working: edit anything in
`src/`, save, and the open browser tab reloads on its own.
