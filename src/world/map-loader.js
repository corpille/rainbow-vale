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
  MIRROR_REFLECT,
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
  // (vine/crate/lock — no extra data beyond its tile) that sits on it. mirror_surface/
  // sym_plate carry extra data (orientation, pair id) so they still go through
  // MAP_DATA.objects below. Water gets its own char (WATER_CHAR): it's a grid tile
  // TYPE, not an object, and its room is never read since the opaque water/ice fill
  // always covers the floor underneath.
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
  const WATER_CHAR = 'w';
  // decor is cosmetic only: instead of a per-instance array, it's placed by a coordinate
  // hash below — ~1% of each zone's unoccupied floor tiles get that zone's signature
  // prop. Floor only, since a tree/flower anchored on a rock block would float in the
  // air. Deterministic (same seed every load), so no gameplay/connectivity depends on it.
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
      const gridChar = MAP_DATA.gridStr[idx++];
      if (gridChar === '.') continue;
      // rocks ('1'-'4', one per zone) don't go into the grid — tracked as obstacles
      // instead. Char is 1-based ('1' = ZORDER[0]); non-digit chars fall through to NaN.
      const zoneObs = ZORDER[gridChar - 1];
      let roomId, occupied;
      if (zoneObs) {
        obstacles.push({ x, y, roomId: zoneObs });
        roomId = zoneObs;
      } else if (gridChar === WATER_CHAR) {
        // roomId is never read for water — 'h' is just a cheap placeholder
        grid.set(key(x, y), { type: 'water', roomId: 'h' });
        roomId = 'h';
        occupied = true; // no decor growing out of the middle of a lake
      } else {
        const def = FLOOR_CHARS[gridChar];
        if (!def) continue;
        grid.set(key(x, y), { type: 'floor', roomId: def[0] });
        if (def[1]) objectsMap.set(key(x, y), def[1]());
        roomId = def[0];
        occupied = !!def[1];
      }
      const decorFn = ZONE_DECOR_FN[roomId];
      // large odd multipliers mix x/y into one int so the low bits (what % keys off)
      // don't line up into a visible lattice at this density
      const hash = (x * 374761393 + y * 668265263) >>> 0;
      if (!zoneObs && !occupied && decorFn && hash % DECOR_DENSITY === 0) {
        decorInstances.push({ x, y, roomId, drawFn: decorFn, seed: hash });
      }
    }
  }
  obstacles.forEach(obstacle => obstacleByTile.set(key(obstacle.x, obstacle.y), obstacle));

  MAP_DATA.doors.forEach((doorEntry, i) =>
    doors.push({ x: doorEntry[0], y: doorEntry[1], roomId: ZORDER[i] })
  );
  ZORDER.forEach((zoneId, i) => {
    const spot = MAP_DATA.primitiveSpots[i];
    primitiveSpots[zoneId] = { x: spot[0], y: spot[1], collected: false };
  });
  MAP_DATA.items.forEach(itemEntry =>
    items.push({ x: itemEntry[0], y: itemEntry[1], zoneId: ZORDER[itemEntry[2]] })
  );

  // rebuilds interactive objects that carry extra data beyond position (mirror_surface's
  // orientation, sym_plate's pair id) — vine/crate/lock/water are purely positional and
  // already decoded from gridStr above.
  // same 4 orientation codes as MIRROR_REFLECT's own keys — reused via Object.keys
  // instead of re-typed, so relies on that object's key insertion order
  const MIRROR_ORIENTATIONS = Object.keys(MIRROR_REFLECT);
  const pairsById = {}; // pairId -> { pair } — shared marker every plate of that group points to
  // MAP_DATA.objects stores x/y as deltas from the previous entry (build.js encodes
  // them this way since placements cluster tightly); running sum recovers real position
  let objPx = 0,
    objPy = 0;
  MAP_DATA.objects.forEach(entry => {
    const [dx, dy, typeCode, extra] = entry;
    objPx += dx;
    objPy += dy;
    const x = objPx,
      y = objPy;
    const tileKey = key(x, y);
    if (typeCode === 9) {
      // sym_plate: plates sharing a pairId point to the same marker, so a group
      // can be any size — a pair, a triple, etc.
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
      objectsMap.set(tileKey, plate);
      plateByTile.set(tileKey, plate);
    } else if (typeCode === 8) {
      // mirror_surface, extra = orientation code 0-3
      objectsMap.set(tileKey, createMirrorSurface(MIRROR_ORIENTATIONS[extra] || 'NE'));
    } else if (typeCode === 10) {
      // marks a crate already placed via gridStr (decoded above, so it exists by now)
      // as starting the level frozen — not a new object, just a flag on the existing one
      const existingCrate = objectsMap.get(tileKey);
      if (existingCrate && existingCrate.type === 'crate') existingCrate.frozen = true;
    }
  });

  // rebuilds the locks: tied to a pair of plates
  MAP_DATA.verrouLinks.forEach(([lockX, lockY, pairId]) => {
    const lockObj = objectsMap.get(key(lockX, lockY));
    if (!lockObj) return;
    const pairEntry = pairsById[pairId];
    if (!pairEntry) return;
    verrouLinks.push({
      lock: lockObj,
      check: result => isPairResolved(result, pairEntry.pair),
    });
  });
})();

export const decorByTile = new Map();
decorInstances.forEach(decor => decorByTile.set(key(decor.x, decor.y), decor));
