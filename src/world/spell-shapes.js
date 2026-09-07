/* ============ Spell targeting: shapes, modifiers, phrase resolution ============ */
import {
  CARDINAL_OFFSETS,
  DIAG_OF,
  DIRS4,
  Modifier,
  Nature,
  RANGE_DIAGONAL,
  RANGE_LINE,
  RANGE_SHORT,
  SYMBOL_TO_ROLE,
  Shape,
  canCrack,
  isBlockingFor,
  isVoid,
  isIceAt,
  isWaterAt,
  key,
  reachableCell,
  track,
  worldRunes,
} from './world-zones.js';
import { MIRROR_REFLECT } from './world-objects.js';

// reverse of DIRS4 (vector -> name), built once instead of duplicating the 4 pairs
const DIR_NAME_OF_VEC = {};
Object.entries(DIRS4).forEach(([name, [dx, dy]]) => (DIR_NAME_OF_VEC[key(dx, dy)] = name));
function getCellsLine(px, py, dx, dy, maxRange, withThrough, nature, baseDist) {
  baseDist = baseDist || 0;
  const cells = [];
  for (let i = 1; i <= maxRange; i++) {
    const x = px + dx * i,
      y = py + dy * i;
    // a placed object (mirror_surface, sym_plate, ...) is reachable even without its own
    // floor tile, since it's positioned via MAP_DATA.objects, independent of gridStr
    if (!worldRunes.inBounds(x, y) && !worldRunes.objectAt(x, y)) {
      // Crack marks a crackable wall cracked but still fully solid until a crate shatters
      // it, so the ray keeps going through it by default, chaining across a whole row of
      // crackable rock. A permanent (non-crackable) wall falls through to the ordinary
      // wall-blocking logic below, same as any other nature.
      if (canCrack(nature, x, y)) {
        cells.push({ x, y, dir: [dx, dy], d: baseDist + i });
        continue;
      }
      // true void never blocks a spell, with or without Through — only a real wall needs
      // Through to cross. Nothing can ever stand in void either, so this just lets an
      // effect reach past the gap, not occupy it
      if (isVoid(x, y)) {
        cells.push({ x, y, dir: [dx, dy], d: baseDist + i });
        continue;
      }
      if (withThrough) continue;
      break;
    }
    cells.push({ x, y, dir: [dx, dy], d: baseDist + i });
    if (isBlockingFor(x, y)) {
      const obj = worldRunes.objectAt(x, y);
      if (obj && obj.type === 'mirror_surface') {
        const inDir = DIR_NAME_OF_VEC[key(dx, dy)];
        const outDir = inDir === undefined ? undefined : MIRROR_REFLECT[obj.orientation][inDir];
        if (outDir !== undefined) {
          const [ndx, ndy] = DIRS4[outDir];
          return cells.concat(
            getCellsLine(x, y, ndx, ndy, maxRange - i, withThrough, nature, baseDist + i)
          );
        }
      }
      // Freeze always clears a water tile, so it never blocks the next thing in line
      if (nature === Nature.FREEZE && isWaterAt(x, y)) continue;
      const reacts = obj && typeof obj.wouldReact === 'function' && obj.wouldReact(nature);
      // Push chains through whatever it just pushed, same as Cut through a vine it just
      // destroyed. Through alone goes through obstacles that stay solid (crate under Crack)
      const clearsPath = obj && obj.type === 'vine' && nature === Nature.CUT;
      if (withThrough || ((nature === Nature.PUSH || clearsPath) && reacts)) continue;
      break;
    }
  }
  return cells;
}
// shared by getCellsArc and getConeCells: a wall (or blocking object) between caster and
// cell blocks it, unless Through, which still requires the cell be reachable at all
function pushIfReachable(cells, from, x, y, d, nature, withThrough) {
  if (!withThrough && isBlocked(from, { x, y }, nature)) return;
  if (!withThrough || reachableCell(x, y, nature)) cells.push({ x, y, d });
}
function getCellsArc(px, py, dx, dy, maxRange, angleMaxDeg, nature, withThrough) {
  const cells = [];
  for (let oy = -maxRange; oy <= maxRange; oy++)
    for (let ox = -maxRange; ox <= maxRange; ox++) {
      if (ox === 0 && oy === 0) continue;
      const dist = Math.hypot(ox, oy);
      if (dist > maxRange + 1e-9) continue;
      const dot = (ox * dx + oy * dy) / dist;
      const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      if (angle > angleMaxDeg + 1e-6) continue;
      pushIfReachable(cells, { x: px, y: py }, px + ox, py + oy, dist, nature, withThrough);
    }
  return cells;
}
function getCellsDiagonal(px, py, dirName, maxRange, withThrough, nature) {
  const [dx, dy] = DIAG_OF[dirName];
  return getCellsLine(px, py, dx, dy, maxRange, withThrough, nature);
}

// the cone widens by one cell each side per row, so row r spans offsets -(r-1)..(r-1) —
// cheaper to walk than to spell out as a table
export const CONE_ROWS = 4;

function getConeCells(playerPos, dir, withThrough, nature) {
  const cells = [];

  for (let row = 1; row <= CONE_ROWS; row++) {
    for (let offset = 1 - row; offset < row; offset++) {
      pushIfReachable(
        cells,
        playerPos,
        playerPos.x + dir.x * row - dir.y * offset,
        playerPos.y + dir.y * row + dir.x * offset,
        row,
        nature,
        withThrough
      );
    }
  }
  return cells;
}

function isBlocked(from, to, nature) {
  const line = bresenhamLine(from, to);
  // skip the starting cell (the caster), check every cell up to and including the target
  for (let i = 1; i < line.length; i++) {
    const cell = line[i];
    if (
      !worldRunes.inBounds(cell.x, cell.y) &&
      !canCrack(nature, cell.x, cell.y) &&
      !isVoid(cell.x, cell.y)
    )
      return true; // a wall stands before (or at) the target
    // a blocking object (mirror, crate, vine, ...) only blocks cells beyond it, not the
    // object's own cell, same as a LINE cast still hits what it runs into
    if (i < line.length - 1 && isBlockingFor(cell.x, cell.y)) return true;
  }
  return false;
}

// Bresenham classic
function bresenhamLine(from, to) {
  const points = [];
  let x0 = from.x,
    y0 = from.y;
  const x1 = to.x,
    y1 = to.y;
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

function applyShape(shape, px, py, dirName, nature, withThrough) {
  const [dx, dy] = DIRS4[dirName];
  switch (shape) {
    case Shape.LINE:
      return getCellsLine(px, py, dx, dy, RANGE_LINE, withThrough, nature);
    case Shape.HALF_CIRCLE:
      return getCellsArc(px, py, dx, dy, RANGE_SHORT, 90, nature, withThrough);
    case Shape.CONE:
      return getConeCells({ x: px, y: py }, { x: dx, y: dy }, withThrough, nature);
    case Shape.DIAGONAL:
      return getCellsDiagonal(px, py, dirName, RANGE_DIAGONAL, withThrough, nature);
    default: {
      const x = px + dx,
        y = py + dy;
      return reachableCell(x, y, nature) ? [{ x, y }] : [];
    }
  }
}
function effectDirectionForCell(px, py, cell, shape, dirName) {
  // a mirror_surface reflection changes the ray's direction mid-flight, so cells past
  // that point carry their own travel direction, not the cast's original
  if (cell.dir) return cell.dir;
  if (shape === Shape.LINE) return DIRS4[dirName];
  if (shape === Shape.DIAGONAL) return DIAG_OF[dirName];
  const dx = cell.x - px,
    dy = cell.y - py;
  if (dx === 0 && dy === 0) return DIRS4[dirName];
  if (Math.abs(dx) >= Math.abs(dy)) return [Math.sign(dx), 0];
  return [0, Math.sign(dy)];
}
// nearest cell in a cast that holds a crate — Switch's target, i.e. the first crate the
// caster would reach, not one further along that Push's chaining could reach past it
export function findSwitchTarget(cells) {
  let target = null;
  cells.forEach(cell => {
    const obj = worldRunes.objectAt(cell.x, cell.y);
    if (obj && obj.type === 'crate' && (!target || cell.d < target.d)) target = cell;
  });
  return target;
}
// type of whatever's at a cell, for Spread's same-type chaining: object's own type,
// 'rock' for a wall Crack could crack, 'water' for a tile Freeze could freeze, else null
function spreadTypeAt(x, y, nature) {
  const obj = worldRunes.objectAt(x, y);
  if (obj) return obj.type;
  if (canCrack(nature, x, y)) return 'rock';
  return nature === Nature.FREEZE && isWaterAt(x, y) ? 'water' : null;
}
// 'rock' and 'water' are tile types, not objects, so there's no wouldReact to call —
// reaching one at all already means the nature applies
const TILE_TYPES = new Set(['rock', 'water']);
// Spread keeps the base shape's hits, then hops to adjacent cells/objects of the SAME
// type that would ALSO react, chaining outward (cutting one vine catches the whole thicket)
function applySpreadModifier(nature, initialCells) {
  const visited = new Set(initialCells.map(cell => key(cell.x, cell.y)));
  const extra = [];
  let frontier = initialCells
    .map(cell => ({ x: cell.x, y: cell.y, type: spreadTypeAt(cell.x, cell.y, nature) }))
    .filter(frontierCell => {
      if (TILE_TYPES.has(frontierCell.type)) return true;
      const obj = worldRunes.objectAt(frontierCell.x, frontierCell.y);
      return obj && typeof obj.wouldReact === 'function' && obj.wouldReact(nature);
    });
  while (frontier.length) {
    const next = [];
    frontier.forEach(frontierCell => {
      CARDINAL_OFFSETS.forEach(([dx, dy]) => {
        const x = frontierCell.x + dx,
          y = frontierCell.y + dy,
          tileKey = key(x, y);
        if (visited.has(tileKey)) return;
        visited.add(tileKey);
        const type = spreadTypeAt(x, y, nature);
        if (type !== frontierCell.type) return;
        const obj = worldRunes.objectAt(x, y);
        if (!TILE_TYPES.has(type) && !obj.wouldReact(nature)) return;
        extra.push({ x, y });
        next.push({ x, y, type });
      });
    });
    frontier = next;
  }
  return extra;
}
// derives nature/shape/modifier from the phrase's runes; slot2/slot3 default when the
// phrase is shorter than 3
export function deriveSpell(runes) {
  const nature = SYMBOL_TO_ROLE[runes[0]].slot1;
  const shape = runes.length >= 2 ? SYMBOL_TO_ROLE[runes[1]].slot2 : Shape.CONTACT;
  const modifier = runes.length === 3 ? SYMBOL_TO_ROLE[runes[2]].slot3 : Modifier.NONE;
  return { nature, shape, modifier, withThrough: modifier === Modifier.THROUGH };
}
// full set of cells a spell touches: base shape plus any SPREAD modifier. Switch and
// Reverse only change what happens at resolution, not which cells are touched. Shared
// by resolvePhrase and the live range preview
export function computeSpellCells(nature, shape, modifier, withThrough, px, py, dirName) {
  const cells = applyShape(shape, px, py, dirName, nature, withThrough);
  if (modifier === Modifier.SPREAD) return cells.concat(applySpreadModifier(nature, cells));
  return cells;
}
export function resolvePhrase(runes, px, py, dirName) {
  const { nature, shape, modifier, withThrough } = deriveSpell(runes);
  const cells = computeSpellCells(nature, shape, modifier, withThrough, px, py, dirName);
  // Switch swaps the caster with the nearest crate along the cast, regardless of nature,
  // and nothing else — every other cell the ray passes through is ignored entirely
  let result;
  if (modifier === Modifier.SWITCH) {
    const target = findSwitchTarget(cells);
    result = target
      ? [
          {
            cell: target,
            obj: worldRunes.objectAt(target.x, target.y),
            dir: effectDirectionForCell(px, py, target, shape, dirName),
            effect: 'switch',
          },
        ]
      : [];
  } else {
    // Reverse only means something for Push (→ Pull), Freeze (→ Thaw a crate), and Crack
    // (→ mend a wall back to solid). On Cut it's still a no-op, same as no modifier
    const invert =
      modifier === Modifier.REVERSE &&
      (nature === Nature.PUSH || nature === Nature.FREEZE || nature === Nature.CRACK);
    const resolveCell = cell => {
      const obj = worldRunes.objectAt(cell.x, cell.y);
      const dir = effectDirectionForCell(px, py, cell, shape, dirName);
      if (obj) return { cell, obj: obj, dir, ...obj.reactTo(nature, dir, invert) };
      if (canCrack(nature, cell.x, cell.y))
        return { cell, obj: null, dir, effect: invert ? 'mend' : 'crack' };
      // water/ice are grid tiles, not objects — a crate parked on ice is caught by the
      // `obj` branch above and thaws the crate instead, so this only sees bare tiles.
      // Reverse picks which way the tile goes, never both in one cast: plain Freeze only
      // freezes water, Reverse only melts ice.
      if (nature === Nature.FREEZE) {
        const match = invert ? isIceAt : isWaterAt;
        if (match(cell.x, cell.y))
          return { cell, obj: null, dir, effect: invert ? 'thaw' : 'freeze' };
      }
      return { cell, obj: null, dir };
    };
    result = cells.map(resolveCell);
  }
  // shape feeds world-objects' per-shape slide budget; result is the cell/effect list
  return { shape, result };
}
// registry of locks tied to a condition (currently only "this pair of plates is all
// weighed down") — checked after every phrase resolution
export const verrouLinks = []; // { lock, check() -> bool }
export function checkLocks() {
  verrouLinks.forEach(link => {
    const lock = link.lock,
      wasOpen = lock.open;
    track(() => (lock.open = wasOpen));
    lock.open = link.check();
  });
}
