/* ================================================================================
   STATIC MAP — frozen once and for all from a validated generation
   (strict connectivity verified, zero phantom objects, everything reachable once solved).
   No more procedural generation: changing the map is now done by editing MAP_DATA
   or the objects below directly, not by tweaking an algorithm.
   ================================================================================ */
import { grid, key, objectsMap } from './world-zones.js';
import {
  drawBloomTreeBig,
  drawCrystalClusterBig,
  drawFlowerStalksBig,
  drawMushroomClusterBig,
} from '../core/decor.js';
import {
  createCrate,
  createLock,
  createMirrorSurface,
  createVine,
  isPairResolved,
} from './world-objects.js';
import { verrouLinks } from './spell-shapes.js';

// MAP_DATA isn't a real import: build.js delta-encodes map-data.json's objects array and
// splices the result in here at build time — it only exists post-build, never as a real export.
/*BUILD:MAP_DATA*/
const ZORDER = ['m', 'j', 'v', 'b'];
export const ZONE_SYMBOL = { m: '~', j: '\u2744', v: '\u25b2', b: '\u25a0' };
export const SYMBOL_TO_ZONE = {}; // reverse of ZONE_SYMBOL - ui-panel needs "which zone is this filled rune"
Object.entries(ZONE_SYMBOL).forEach(([zoneId, sym]) => (SYMBOL_TO_ZONE[sym] = zoneId));
export const doors = [];
export const primitiveSpots = {};
export const items = [];
export const obstacles = [];
export const obstacleByTile = new Map();
// permanent registry of every sym_plate, independent of objectsMap: a crate pushed onto
// a plate's tile becomes the tile's objectsMap occupant, but the plate must stay
// findable underneath to unweigh it later
export const plateByTile = new Map();
export const decorInstances = [];
export const collected = new Set(); // ids of zones whose rune has already been collected

(function loadStaticMap() {
  const [minX, minY, maxX, maxY] = MAP_DATA.bounds;
  // each floor tile's char is its room, optionally fused with the one positional object
  // (no extra data beyond its tile) that sits on it — folds vine/crate/lock placement
  // (was ~85% of MAP_DATA.objects) into a single lookup instead of scattering it across
  // gridStr chars, obstacle-style zone maps, and a positional objects array. Measured
  // compressed size is a wash vs. keeping vine/crate/lock in MAP_DATA.objects (Roadroller
  // penalizes the extra distinct gridStr symbols by about what the removed array entries
  // save) — kept anyway because one shared decode path beats four. mirror_surface/
  // sym_plate carry extra data (orientation, pair id) so they still go through
  // MAP_DATA.objects below. Water is its own single char (not room-specific like these):
  // it's a grid tile TYPE, not an object, and its room is cosmetically irrelevant — the
  // opaque water/ice fill always covers the floor tile underneath, so nothing ever reads
  // a water tile's room. See WATER_CHAR below.
  const FLOOR_CHARS = {
    h: ['h'],
    m: ['m'],
    j: ['j'],
    v: ['v'],
    b: ['b'],
    n: ['m', createVine],
    k: ['j', createVine],
    o: ['v', createVine],
    g: ['b', createVine],
    e: ['m', createCrate],
    i: ['j', createCrate],
    p: ['v', createCrate],
    q: ['b', createCrate],
    r: ['m', createLock],
    s: ['j', createLock],
    t: ['v', createLock],
    u: ['b', createLock],
  };
  // rocks ('1'-'4', one per zone) don't go into the grid — tracked separately as
  // obstacles, just stored inline in gridStr instead of their own array
  const OBSTACLE_ZONE = { 1: 'm', 2: 'j', 3: 'v', 4: 'b' };
  const WATER_CHAR = 'w';
  // decor is cosmetic only (no gameplay/connectivity role), so instead of storing a
  // per-instance array it's placed by a coordinate hash below: ~1% of each zone's floor
  // tiles (whichever aren't already occupied by a positional object) get that zone's
  // one signature prop. Floor only — rocks render as solid raised wall blocks, and a
  // tree/flower anchored on one looked like it was growing out of mid-air rather than
  // ground. Deterministic — same seed every load, so it isn't "procedural" in the sense
  // this file's header warns against (nothing about layout, solvability, or
  // connectivity depends on it).
  const ZONE_DECOR_FN = {
    m: drawFlowerStalksBig,
    j: drawCrystalClusterBig,
    v: drawBloomTreeBig,
    b: drawMushroomClusterBig,
  };
  const DECOR_DENSITY = 100; // 1 in DECOR_DENSITY eligible tiles gets decor
  let idx = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const c = MAP_DATA.gridStr[idx++];
      if (c === '.') continue;
      const zoneObs = OBSTACLE_ZONE[c];
      let roomId, occupied;
      if (zoneObs) {
        obstacles.push({ x, y, roomId: zoneObs });
        roomId = zoneObs;
      } else if (c === WATER_CHAR) {
        // roomId here is never read — see the comment above FLOOR_CHARS — 'h' is just a
        // valid, cheap placeholder (every other roomId also needs one anyway)
        grid.set(key(x, y), { type: 'water', roomId: 'h' });
        roomId = 'h';
        occupied = true; // no decor growing out of the middle of a lake
      } else {
        const def = FLOOR_CHARS[c];
        if (!def) continue;
        grid.set(key(x, y), { type: 'floor', roomId: def[0] });
        if (def[1]) objectsMap.set(key(x, y), def[1]());
        roomId = def[0];
        occupied = !!def[1];
      }
      const decorFn = ZONE_DECOR_FN[roomId];
      // large odd multipliers mix x/y into one int so the low bits (what % keys off)
      // don't line up into a visible lattice at this density
      const h = (x * 374761393 + y * 668265263) >>> 0;
      if (!zoneObs && !occupied && decorFn && h % DECOR_DENSITY === 0) {
        decorInstances.push({ x, y, roomId, drawFn: decorFn, seed: h });
      }
    }
  }
  obstacles.forEach(o => obstacleByTile.set(key(o.x, o.y), o));

  MAP_DATA.doors.forEach((d, i) => doors.push({ x: d[0], y: d[1], roomId: ZORDER[i] }));
  ZORDER.forEach((z, i) => {
    const p = MAP_DATA.primitiveSpots[i];
    primitiveSpots[z] = { x: p[0], y: p[1], collected: false };
  });
  MAP_DATA.items.forEach(p => items.push({ x: p[0], y: p[1], zoneId: ZORDER[p[2]] }));

  // rebuilds interactive objects that carry extra data beyond position (mirror_surface's
  // orientation, sym_plate's pair id); symmetric plate pairs share the same "pair" marker
  // (created once per pairId). vine/crate/lock are purely positional and decoded straight
  // from gridStr above instead; water is too, but as a grid tile type rather than an
  // object (see WATER_CHAR above). frozen_crate_marker rides along here since it's just
  // a flag on an already-gridStr-decoded crate, not a placeable type of its own.
  const MIRROR_ORIENTATIONS = ['NE', 'ES', 'SW', 'WN'];
  const pairsById = {}; // pairId -> { pair } — shared marker every plate of that group points to
  // MAP_DATA.objects stores x/y as deltas from the previous entry (encoded by build.js):
  // placements cluster tightly, so this is usually one digit instead of a 2-3 digit
  // absolute coordinate; running sum recovers the real position
  let objPx = 0,
    objPy = 0;
  MAP_DATA.objects.forEach(o => {
    const [dx, dy, typeCode, extra] = o;
    objPx += dx;
    objPy += dy;
    const x = objPx,
      y = objPy;
    const k = key(x, y);
    if (typeCode === 9) {
      // sym_plate: a lone plate gets its own marker; plates sharing a pairId point to
      // the SAME marker, so a group can be any size — a pair, a triple, etc.
      if (extra !== undefined && !pairsById[extra]) pairsById[extra] = { pair: {} };
      const plate = {
        type: 'sym_plate',
        blocksMovement: false,
        weighed: false,
        pair: extra === undefined ? {} : pairsById[extra].pair,
        reactTo() {
          return { effect: 'activated' };
        },
      };
      objectsMap.set(k, plate);
      plateByTile.set(k, plate);
    } else if (typeCode === 8) {
      // mirror_surface, extra = orientation code 0-3
      objectsMap.set(k, createMirrorSurface(MIRROR_ORIENTATIONS[extra] || 'NE'));
    } else if (typeCode === 10) {
      // marks a crate already placed via gridStr (decoded above, so it exists by now)
      // as starting the level frozen — not a new object, just a flag on the existing one
      const c = objectsMap.get(k);
      if (c && c.type === 'crate') c.frozen = true;
    }
  });

  // rebuilds the locks: tied to a pair of plates
  MAP_DATA.verrouLinks.forEach(([vx, vy, pairId]) => {
    const lockObj = objectsMap.get(key(vx, vy));
    if (!lockObj) return;
    const p = pairsById[pairId];
    if (!p) return;
    verrouLinks.push({ lock: lockObj, check: result => isPairResolved(result, { pair: p.pair }) });
  });
})();

export const decorByTile = new Map();
decorInstances.forEach(d => decorByTile.set(key(d.x, d.y), d));
