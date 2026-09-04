/* ================================================================================
   STATIC MAP — frozen from a validated generation (connectivity checked, no phantom
   objects, everything reachable). No more procedural generation: edit MAP_DATA or the
   objects below directly instead of tweaking an algorithm.
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

// MAP_DATA isn't a real import: build.js delta-encodes map-data.json's objects array
// and splices it in here at build time, so it only exists post-build.
/*BUILD:MAP_DATA*/
const ZORDER = ['m', 'j', 'v', 'b'];
export const doors = [];
export const primitiveSpots = {};
export const items = [];
export const obstacles = [];
export const obstacleByTile = new Map();
// registry of every sym_plate, independent of objectsMap: a crate pushed onto a plate's
// tile becomes the objectsMap occupant, but the plate needs to stay findable underneath
// to unweigh it later
export const plateByTile = new Map();
export const decorInstances = [];
export const collected = new Set(); // ids of zones whose rune has already been collected

(function loadStaticMap() {
  const [minX, minY, maxX, maxY] = MAP_DATA.bounds;
  // each floor tile's char is its room, optionally fused with the one positional object
  // (vine/crate/lock, no extra data beyond its tile) that sits on it. mirror_surface and
  // sym_plate carry extra data (orientation, pair id), so they go through MAP_DATA.objects
  // below instead. Water gets its own char (WATER_CHAR) since it's a grid tile TYPE, not
  // an object, and its room is never read — the opaque water/ice fill covers the floor.
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
  // decor is cosmetic only: placed by a coordinate hash below instead of a per-instance
  // array, so ~1% of each zone's unoccupied floor tiles get that zone's signature prop.
  // Floor only (a tree/flower on a rock block would float in the air), and deterministic
  // so no gameplay depends on it.
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
      // rocks ('1'-'4', one per zone) don't go into the grid, they're tracked as obstacles.
      // Char is 1-based ('1' = ZORDER[0]); non-digit chars fall through to NaN.
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
      // don't form a visible lattice at this density
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
  // orientation, sym_plate's pair id). vine/crate/lock/water are purely positional and
  // already decoded from gridStr above.
  const pairsById = {}; // pairId -> { pair } — shared marker every plate of that group points to
  // MAP_DATA.objects stores x/y as deltas from the previous entry (placements cluster
  // tightly, so build.js encodes it this way); running sum recovers the real position
  let objPx = 0,
    objPy = 0;
  MAP_DATA.objects.forEach(entry => {
    const [dx, dy, typeCode, extra] = entry;
    objPx += dx;
    objPy += dy;
    const x = objPx,
      y = objPy;
    const tileKey = key(x, y);
    if (typeCode === 1) {
      // sym_plate: plates sharing a pairId point to the same marker, so a group can be
      // any size — a pair, a triple, etc.
      if (extra !== undefined && !pairsById[extra]) pairsById[extra] = { pair: {} };
      const plate = {
        type: 'sym_plate',
        blocksMovement: false,
        weighed: false,
        pair: extra === undefined ? {} : pairsById[extra].pair,
        // a plate only ever activates by being weighed down (see the crate-landing paths
        // in applyEffectsToWorld/settleSlide below) — a spell merely passing over its tile,
        // even a Push, is not the same as a crate resting on it
        reactTo() {},
      };
      objectsMap.set(tileKey, plate);
      plateByTile.set(tileKey, plate);
    } else if (typeCode === 0) {
      // mirror_surface, extra = orientation code 0-3
      objectsMap.set(tileKey, createMirrorSurface(extra));
    } else if (typeCode === 2) {
      // marks a crate already placed via gridStr as starting the level frozen — just a
      // flag on the existing object, not a new one
      const existingCrate = objectsMap.get(tileKey);
      if (existingCrate && existingCrate.type === 'crate') existingCrate.frozen = true;
    } else if (typeCode === 3) {
      // marks a rock wall already placed via gridStr as crackable — every other wall is
      // permanent, so Crack can't be used to tunnel through arbitrary rock (see isCrackableRock)
      const existingObstacle = obstacleByTile.get(tileKey);
      if (existingObstacle) existingObstacle.crackable = true;
    }
  });

  // rebuilds the locks: tied to a pair of plates
  MAP_DATA.verrouLinks.forEach(([lockX, lockY, pairId]) => {
    const lockObj = objectsMap.get(key(lockX, lockY));
    const pairEntry = pairsById[pairId];
    if (!lockObj || !pairEntry) return;
    verrouLinks.push({
      lock: lockObj,
      check: () => isPairResolved(pairEntry.pair),
    });
  });
})();

export const decorByTile = new Map();
decorInstances.forEach(decor => decorByTile.set(key(decor.x, decor.y), decor));
