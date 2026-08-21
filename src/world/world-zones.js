/* ============ World model: zones, coordinate keys, spell vocabulary ============ */
// obstacleByTile comes from map-loader.js, which imports grid/key/objectsMap back from
// here — a real cycle, but harmless: isVoid is a closure, never called until every file
// has already finished its own top-level setup.
import { obstacleByTile } from './map-loader.js';
import { WHITE } from '../core/colors.js';

export const grid = new Map();
export const key = (x, y) => x + ',' + y;
export const unkey = k => k.split(',').map(Number);

export const HUB = {
  id: 'h',
  cx: 0,
  cy: 0,
  w: 13,
  h: 13,
  base: '#ffd6ec',
  dark: '#ff9ecf',
  blob: '#fff0fa',
};
const SLOTS = [
  { cx: 0, cy: -30 }, // N
  { cx: 30, cy: 0 }, // E
  { cx: 0, cy: 30 }, // S
  { cx: -30, cy: 0 }, // O
];
// only cavern/orchard ends up spatially close — an inevitable compromise with 4 slots
const SLOT_ORDER = [0, 2, 1, 3];
// ids are single chars matching FLOOR_CHARS' grid codes in map-loader.js (m/j/v/b already
// mean swamp/cavern/orchard/marsh there) — reusing them as the zone id itself needs no new
// Terser reservation, since those letters are reserved anyway. Public faces: swamp = Clover
// Fields (Breeze), cavern = Cloud Cavern (Frost), orchard = Sunbeam Grove (Bramble —
// grove name predates the Sunbeam/burn -> Bramble/cut rename), marsh = Starlight Marsh
// (Crystal)
const ZONE_DEFS = [
  { id: 'm', base: '#bdf3c9', dark: '#6fcf97', blob: '#e8fff0' }, // swamp
  { id: 'j', base: '#d6ecff', dark: '#8fc9f0', blob: WHITE }, // cavern
  { id: 'v', base: '#ffe1b8', dark: '#ffb066', blob: '#fff3d6' }, // orchard
  { id: 'b', base: '#e3d4ff', dark: '#a98af0', blob: '#f6ecff' }, // marsh
];
export const ZONES = ZONE_DEFS.map((z, i) => ({ ...z, w: 25, h: 25, ...SLOTS[SLOT_ORDER[i]] }));
export const roomById = { h: HUB };
ZONES.forEach(z => (roomById[z.id] = z));

export const Nature = { CUT: 'CUT', FREEZE: 'FREEZE', PUSH: 'PUSH', SOLIDIFY: 'SOLIDIFY' };
export const Shape = {
  LINE: 'LINE',
  HALF_CIRCLE: 'HALF_CIRCLE',
  CONE: 'CONE',
  DIAGONAL: 'DIAGONAL',
  CONTACT_DEFAULT: 'CONTACT_DEFAULT',
};
export const Modifier = {
  PIERCE: 'PIERCE',
  SNIPE: 'SNIPE',
  SPREAD: 'SPREAD',
  MIRROR: 'MIRROR',
  NONE: 'NONE',
};
export const SYMBOL_TO_ROLE = {
  '▲': { slot1: Nature.CUT, slot2: Shape.CONE, slot3: Modifier.SPREAD },
  '❄': { slot1: Nature.FREEZE, slot2: Shape.HALF_CIRCLE, slot3: Modifier.SNIPE },
  '~': { slot1: Nature.PUSH, slot2: Shape.LINE, slot3: Modifier.PIERCE },
  '■': { slot1: Nature.SOLIDIFY, slot2: Shape.DIAGONAL, slot3: Modifier.MIRROR },
};
const ALL_SYMBOLS = ['▲', '❄', '~', '■'];
export const RANGE_LINE = 5;
export const RANGE_SHORT = 3;
export const RANGE_DIAGONAL = 5;
export const DIRS4 = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const DIAG_OF = { up: [1, -1], right: [1, 1], down: [-1, 1], left: [-1, -1] };
// same 4 vectors as DIRS4, just as a plain array for "check every neighbor" scans
// (world-objects.js's inferRoomId, spell-shapes.js's applySpreadModifier) that don't care
// about direction names — order matters for inferRoomId's "first match wins" tie-break,
// so this stays a fixed literal rather than Object.values(DIRS4) (different order)
export const CARDINAL_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function validatePhrase(runes) {
  if (runes.length < 1 || runes.length > 3 || !runes.every(r => ALL_SYMBOLS.includes(r)))
    return false;
  return true;
}

export const objectsMap = new Map(); // "x,y" -> interactive object (Vine, Crate, ...)

// bumped whenever a water tile freezes into ice (see applyEffectsToWorld's
// 'freeze_water' handling in world-objects.js) — lets renderPonds (render-world.js)
// know its cached connected-pond groups need rebuilding, instead of every frame
export let puddleEpoch = 0;
export function bumpPuddleEpoch() {
  puddleEpoch++;
}

export const worldRunes = {
  inBounds: (x, y) => grid.has(key(x, y)),
  objectAt: (x, y) => objectsMap.get(key(x, y)) || null,
  moveObject: (fx, fy, tx, ty) => {
    const o = objectsMap.get(key(fx, fy));
    objectsMap.delete(key(fx, fy));
    objectsMap.set(key(tx, ty), o);
  },
};

// true if this cell is a water tile, whether or not anything's parked on top of it
export function isWaterAt(x, y) {
  const cell = grid.get(key(x, y));
  return !!cell && cell.type === 'water';
}
export function isBlockingFor(x, y) {
  const obj = worldRunes.objectAt(x, y);
  return (obj && obj.blocksMovement) || isWaterAt(x, y);
}
// true void: no floor tile, no obstacle rock — the only thing Solidify can turn into a real floor tile
export const isVoid = (x, y) => !grid.has(key(x, y)) && !obstacleByTile.has(key(x, y));
// a cell is a valid spell destination if it's real ground, OR — Solidify only — true void
export function reachableCell(x, y, nature) {
  return worldRunes.inBounds(x, y) || (nature === Nature.SOLIDIFY && isVoid(x, y));
}
