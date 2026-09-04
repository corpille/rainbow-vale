/* ============ World model: zones, coordinate keys, spell vocabulary ============ */
// obstacleByTile comes from map-loader.js, which imports grid/key/objectsMap back from
// here. Harmless cycle — isVoid is a closure that only runs after every file has loaded.
import { obstacleByTile } from './map-loader.js';
import { COLORS, WHITE } from '../core/colors.js';

export const grid = new Map();
export const key = (x, y) => x + ',' + y;
export const unkey = mapKey => mapKey.split(',').map(Number);

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
// ids match FLOOR_CHARS' grid codes in map-loader.js (m/j/v/b = swamp/cavern/orchard/marsh).
// Public names: swamp=Clover Fields (Breeze), cavern=Cloud Cavern (Frost),
// orchard=Sunbeam Grove (Bramble), marsh=Starlight Marsh (Crystal).
const ZONE_DEFS = [
  { id: 'm', base: '#bdf3c9', dark: '#6fcf97', blob: '#e8fff0' }, // swamp
  { id: 'j', base: '#d6ecff', dark: '#8fc9f0', blob: WHITE }, // cavern
  { id: 'v', base: '#ffe1b8', dark: '#ffb066', blob: COLORS.STAR_CREAM }, // orchard, close enough to STAR_CREAM to reuse it
  { id: 'b', base: '#e3d4ff', dark: '#a98af0', blob: '#f6ecff' }, // marsh
];
export const ZONES = ZONE_DEFS.map((zone, i) => ({
  ...zone,
  w: 25,
  h: 25,
  ...SLOTS[SLOT_ORDER[i]],
}));
export const roomById = { h: HUB };
ZONES.forEach(zone => (roomById[zone.id] = zone));

export const Nature = { CUT: 'CUT', FREEZE: 'FREEZE', PUSH: 'PUSH', CRACK: 'CRACK' };
export const Shape = {
  LINE: 'LINE',
  HALF_CIRCLE: 'HALF_CIRCLE',
  CONE: 'CONE',
  DIAGONAL: 'DIAGONAL',
  CONTACT: 'CONTACT',
};
export const Modifier = {
  THROUGH: 'THROUGH',
  SWITCH: 'SWITCH',
  SPREAD: 'SPREAD',
  MIRROR: 'MIRROR',
  NONE: 'NONE',
};
// keyed by zone id itself (m/j/v/b), not an arbitrary rune glyph — a phrase rune IS the
// zone id it came from, so this also answers "which spell role does this rune play".
export const SYMBOL_TO_ROLE = {
  v: { slot1: Nature.CUT, slot2: Shape.DIAGONAL, slot3: Modifier.SPREAD },
  j: { slot1: Nature.FREEZE, slot2: Shape.HALF_CIRCLE, slot3: Modifier.MIRROR },
  m: { slot1: Nature.PUSH, slot2: Shape.LINE, slot3: Modifier.THROUGH },
  b: { slot1: Nature.CRACK, slot2: Shape.CONE, slot3: Modifier.SWITCH },
};
const ALL_SYMBOLS = ZONE_DEFS.map(zone => zone.id);
export const RANGE_LINE = 5;
export const RANGE_SHORT = 3;
export const RANGE_DIAGONAL = 5;
// direction names are plain numbers (0=up,1=down,2=left,3=right) — internal dispatch
// only, never shown as text.
export const DIRS4 = { 0: [0, -1], 1: [0, 1], 2: [-1, 0], 3: [1, 0] };
export const DIAG_OF = { 0: [1, -1], 3: [1, 1], 1: [-1, 1], 2: [-1, -1] };
// same 4 vectors as DIRS4, as a plain array for "check every neighbor" scans (inferRoomId
// in world-objects.js, applySpreadModifier in spell-shapes.js). Kept as a fixed literal
// rather than Object.values(DIRS4) since inferRoomId's tie-break depends on this order.
export const CARDINAL_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const validatePhrase = runes =>
  runes.length >= 1 && runes.length <= 3 && runes.every(rune => ALL_SYMBOLS.includes(rune));

export const objectsMap = new Map(); // "x,y" -> interactive object (Vine, Crate, ...)

// bumped when a water tile freezes (see world-objects.js's 'freeze' handling), so
// renderPonds (render-world.js) knows to rebuild its cached pond groups instead of
// redoing that every frame.
export let puddleEpoch = 0;
export function bumpPuddleEpoch() {
  puddleEpoch++;
}

export const worldRunes = {
  inBounds: (x, y) => grid.has(key(x, y)),
  objectAt: (x, y) => objectsMap.get(key(x, y)) || null,
  moveObject: (fromX, fromY, toX, toY) => {
    const fk = key(fromX, fromY),
      tk = key(toX, toY);
    trackMap(objectsMap, fk);
    trackMap(objectsMap, tk);
    const obj = objectsMap.get(fk);
    objectsMap.delete(fk);
    objectsMap.set(tk, obj);
  },
};

// ---- Undo: a flat log of inverse closures, plus a stack of boundary marks (one per
// player action) — cheaper than nested per-action arrays.
// track() takes a ready-made closure instead of an (obj,key) pair so property access
// stays plain dot-access — a generic (obj,key) helper would need o[key] bracket access,
// which breaks under build.js's property mangling.
// Always called between a beginAction() and the next one, so track/trackMap don't need
// their own active/inactive guard.
const uLog = [];
export const uMarks = []; // .length > 0 while there's an action to undo — ui-panel.js's undo button reads this
export function beginAction() {
  uMarks.push(uLog.length);
}
// call right before mutating something, with a closure that reverses that mutation —
// doUndo() pops these off in reverse order and runs them.
export function track(fn) {
  uLog.push(fn);
}
// same idea, specialized for a Map entry: snapshots whatever was at key k so undo
// can restore or remove it as needed.
export function trackMap(m, k) {
  // snapshot NOW, not inside the closure: reading m at undo time would just write back
  // whatever is already there (a no-op), which silently broke undo for crate pushes
  const had = m.has(k),
    v = m.get(k);
  uLog.push(() => (had ? m.set(k, v) : m.delete(k)));
}
export function doUndo() {
  if (!uMarks.length) return;
  const mark = uMarks.pop();
  while (uLog.length > mark) uLog.pop()();
  bumpPuddleEpoch();
}

// true if this cell is a water tile, whether or not anything's parked on top of it
export const isWaterAt = (x, y) => grid.get(key(x, y))?.type === 'water';
export const isBlockingFor = (x, y) =>
  !!worldRunes.objectAt(x, y)?.blocksMovement || isWaterAt(x, y);
// true void: no floor tile, no obstacle rock — nobody can stand here, but every
// nature's spells pass straight through it (see getCellsLine).
export const isVoid = (x, y) => !grid.has(key(x, y)) && !obstacleByTile.has(key(x, y));
// a solid rock wall — cracked or not, it's still fully solid until a crate shatters it
export const isRock = (x, y) => obstacleByTile.has(key(x, y));
// only a subset of rock is flagged crackable in the map data (see map-loader.js's
// typeCode 3 marker) — everything else is permanent, no matter how Crack is cast at it
export const isCrackableRock = (x, y) => !!obstacleByTile.get(key(x, y))?.crackable;
// shared by every Crack-specific check across world-zones.js/spell-shapes.js
export const canCrack = (nature, x, y) => nature === Nature.CRACK && isCrackableRock(x, y);
// a cell is a valid spell destination if it's real ground, if it holds a placed object
// (mirror_surface/sym_plate are positioned via MAP_DATA.objects independent of gridStr's
// floor code, so a plain floor check would miss them), if it's true void (nothing blocks
// a spell passing through), or — Crack only — a crackable rock wall.
export const reachableCell = (x, y, nature) =>
  worldRunes.inBounds(x, y) || !!worldRunes.objectAt(x, y) || isVoid(x, y) || canCrack(nature, x, y);
