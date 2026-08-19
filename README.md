# Rainbow Vale — js13k project

A top-down exploration game for the [js13k](https://js13kgames.com/) competition (13,312
bytes zipped, no libraries). The vale has lost its color — play as a unicorn restoring it
by exploring four themed zones around a central hub, gathering each zone's rune (which
brings that zone's colors back) and returning hidden items to the hub (which gradually
brings the hub itself back to life). Along the way, cast spells by combining Nature +
Shape + Modifier runes to solve the environmental puzzles blocking your path (freezing
water, pushing crates onto plates, bouncing a spell off a mirror, growing new ground with
Solidify...).

Controls: arrow keys to move, "C" to open the spell-phrase panel.

## Structure

```
project/
├── src/            Game source — see below.
│   ├── shell.html    HTML shell + CSS.
│   ├── core/         Shared engine, entities (player), and UI panel.
│   ├── world/        Zones, spell logic, and the static map data.
│   └── render/       Everything drawn to the canvas.
├── build.js          Build script — concatenates src/*.js, minifies, and packs into dist/.
├── tools/            Map editor + local dev servers.
└── dist/             Build output — index.html is the file you playtest and submit.
```

## Running it

```
npm run build       # build once, print size report
npm run dev          # rebuild + serve at http://localhost:8533, browser reloads on save
npm run editor        # visual map editor at http://localhost:8532
```

No `npm install` needed to build — `build.js` only uses Node's built-in `fs`/`path`/`zlib`
(Terser and Roadroller are dev dependencies used by the build itself).

`npm run dev` is the one to leave open while working: edit any file in `src/`, save, and
the open browser tab reloads itself automatically.
