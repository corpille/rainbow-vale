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
  isBlockingFor,
  isVoid,
  isWaterAt,
  key,
  reachableCell,
  validatePhrase,
  worldRunes,
} from './world-zones.js';
import { MIRROR_REFLECT } from './world-objects.js';

// reverse of DIRS4 (vector -> name instead of name -> vector), built once instead of
// hand-duplicating the same 4 pairs
const DIR_NAME_OF_VEC = {};
Object.entries(DIRS4).forEach(([name, [dx, dy]]) => (DIR_NAME_OF_VEC[dx + ',' + dy] = name));
function getCellsLine(px, py, dx, dy, maxRange, withPierce, nature, baseDist, viaMirror) {
  baseDist = baseDist || 0;
  const cells = [];
  for (let i = 1; i <= maxRange; i++) {
    const x = px + dx * i,
      y = py + dy * i;
    // a placed object (mirror_surface, sym_plate, ...) is reachable even without a
    // floor tile of its own, since it's positioned via MAP_DATA.objects independent
    // of gridStr's floor/rock/void code
    if (!worldRunes.inBounds(x, y) && !worldRunes.objectAt(x, y)) {
      // Solidify grows a new floor tile on true void, so the ray keeps going through
      // it by default, chaining across a whole row instead of stopping at the first
      if (nature === Nature.SOLIDIFY && isVoid(x, y)) {
        cells.push({ x, y, dir: [dx, dy], d: baseDist + i });
        continue;
      }
      // Pierce (and a post-mirror-bounce beam) punches through walls too, but true
      // void stops Push dead: unlike a wall, there's nothing there to push through
      if (nature === Nature.PUSH && isVoid(x, y)) break;
      if (withPierce || viaMirror) continue;
      break;
    }
    cells.push({ x, y, dir: [dx, dy], d: baseDist + i });
    if (isBlockingFor(x, y)) {
      const obj = worldRunes.objectAt(x, y);
      if (obj && obj.type === 'mirror_surface') {
        const inDir = DIR_NAME_OF_VEC[dx + ',' + dy];
        const outDir = inDir && MIRROR_REFLECT[obj.orientation][inDir];
        if (outDir) {
          const [ndx, ndy] = DIRS4[outDir];
          return cells.concat(
            getCellsLine(x, y, ndx, ndy, maxRange - i, withPierce, nature, baseDist + i, true)
          );
        }
      }
      // Freeze always clears a water tile, so it never blocks the next thing in line
      if (nature === Nature.FREEZE && isWaterAt(x, y)) continue;
      const reacts = obj && typeof obj.wouldReact === 'function' && obj.wouldReact(nature);
      // Push chains through whatever it just pushed, same as Cut through a vine it just
      // destroyed — only Pierce is needed for obstacles that stay solid regardless (a crate)
      const clearsPath = obj && obj.type === 'vine' && nature === Nature.CUT;
      if ((withPierce || nature === Nature.PUSH || clearsPath) && reacts) continue;
      break;
    }
  }
  return cells;
}
function getCellsArc(px, py, dx, dy, maxRange, angleMaxDeg, nature, withPierce) {
  const cells = [];
  for (let oy = -maxRange; oy <= maxRange; oy++)
    for (let ox = -maxRange; ox <= maxRange; ox++) {
      if (ox === 0 && oy === 0) continue;
      const dist = Math.hypot(ox, oy);
      if (dist > maxRange + 1e-9) continue;
      const dot = (ox * dx + oy * dy) / dist;
      const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      if (angle > angleMaxDeg + 1e-6) continue;
      const x = px + ox,
        y = py + oy;
      // same line-of-sight rule as Cone: a wall between caster and cell blocks it
      // (unless Pierce), so the radius+angle fill can't reach straight through corners
      if (!withPierce && isBlocked({ x: px, y: py }, { x, y }, nature)) continue;
      const reachable = reachableCell(x, y, nature);
      if (!withPierce || reachable) cells.push({ x, y, d: dist });
    }
  return cells;
}
function getCellsDiagonal(px, py, dirName, maxRange, withPierce, nature) {
  const [dx, dy] = DIAG_OF[dirName];
  return getCellsLine(px, py, dx, dy, maxRange, withPierce, nature);
}

export const CONE_PATTERN = [
  { row: 1, offsets: [0] },
  { row: 2, offsets: [-1, 0, 1] },
  { row: 3, offsets: [-2, -1, 0, 1, 2] },
  { row: 4, offsets: [-3, -2, -1, 0, 1, 2, 3] },
];

function getConeCells(playerPos, dir, withPierce, nature) {
  const cells = [];

  for (const { row, offsets } of CONE_PATTERN) {
    for (const offset of offsets) {
      const target = {
        x: playerPos.x + dir.x * row - dir.y * offset,
        y: playerPos.y + dir.y * row + dir.x * offset,
      };
      if (!withPierce && isBlocked(playerPos, target, nature)) continue;
      const reachable = reachableCell(target.x, target.y, nature);
      if (!withPierce || reachable) cells.push({ ...target, d: row });
    }
  }
  return cells;
}

function isBlocked(from, to, nature) {
  const line = bresenhamLine(from, to);
  // skip the starting cell (the caster) — check every cell up to and including the target
  for (let i = 1; i < line.length; i++) {
    const cell = line[i];
    if (
      !worldRunes.inBounds(cell.x, cell.y) &&
      !(nature === Nature.SOLIDIFY && isVoid(cell.x, cell.y))
    )
      return true; // a wall stands before (or at) the target
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

function applyShape(shape, px, py, dirName, nature, withPierce) {
  const [dx, dy] = DIRS4[dirName];
  switch (shape) {
    case Shape.LINE:
      return getCellsLine(px, py, dx, dy, RANGE_LINE, withPierce, nature);
    case Shape.HALF_CIRCLE:
      return getCellsArc(px, py, dx, dy, RANGE_SHORT, 90, nature, withPierce);
    case Shape.CONE:
      return getConeCells({ x: px, y: py }, { x: dx, y: dy }, withPierce, nature);
    case Shape.DIAGONAL:
      return getCellsDiagonal(px, py, dirName, RANGE_DIAGONAL, withPierce, nature);
    default: {
      const x = px + dx,
        y = py + dy;
      return reachableCell(x, y, nature) ? [{ x, y }] : [];
    }
  }
}
function effectDirectionForCell(px, py, cell, shape, dirName) {
  // a mirror_surface reflection changes the ray's direction mid-flight — cells past
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
// keeps only the farthest-from-caster cell(s), using the `d` (distance) each shape
// generator already tags its cells with — one generic filter, not one per shape
function applySnipeModifier(cells) {
  if (cells.length < 2) return cells;
  let max = -Infinity;
  cells.forEach(cell => {
    if (cell.d > max) max = cell.d;
  });
  return cells.filter(cell => Math.abs(cell.d - max) < 1e-6);
}
// type of whatever's at a cell, for Spread's same-type chaining: object's own type,
// or 'void' for a tile Solidify could grow into, 'water' for a tile Freeze could freeze;
// null means nothing to chain through
function spreadTypeAt(x, y, nature) {
  const obj = worldRunes.objectAt(x, y);
  if (obj) return obj.type;
  if (nature === Nature.SOLIDIFY && isVoid(x, y)) return 'void';
  return nature === Nature.FREEZE && isWaterAt(x, y) ? 'water' : null;
}
// 'void' and 'water' are tile types, not objects — nothing to call wouldReact on, and
// reaching one at all already means the nature applies
const TILE_TYPES = new Set(['void', 'water']);
// Spread keeps the base shape's hits, then hops to adjacent cells/objects of that SAME
// type that would ALSO react, chaining outward (e.g. cutting one vine catches the whole
// connected thicket, not just a fixed ring of tiles)
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
  const shape = runes.length >= 2 ? SYMBOL_TO_ROLE[runes[1]].slot2 : Shape.CONTACT_DEFAULT;
  const modifier = runes.length === 3 ? SYMBOL_TO_ROLE[runes[2]].slot3 : Modifier.NONE;
  return { nature, shape, modifier, withPierce: modifier === Modifier.PIERCE };
}
// full set of cells a spell touches: base shape plus any SPREAD/SNIPE modifier — Mirror
// only changes what happens at resolution, not which cells are touched. Shared by
// resolvePhrase and the live range preview
export function computeSpellCells(nature, shape, modifier, withPierce, px, py, dirName) {
  const cells = applyShape(shape, px, py, dirName, nature, withPierce);
  if (modifier === Modifier.SPREAD) return cells.concat(applySpreadModifier(nature, cells));
  if (modifier === Modifier.SNIPE) return applySnipeModifier(cells);
  return cells;
}
export function resolvePhrase(runes, px, py, dirName) {
  if (!validatePhrase(runes)) return { ok: false };
  const { nature, shape, modifier, withPierce } = deriveSpell(runes);
  const cells = computeSpellCells(nature, shape, modifier, withPierce, px, py, dirName);
  // Mirror only means something for Push (→ Pull) and Freeze (→ Thaw a crate); on Cut
  // or Solidify it's a no-op, same as casting with no modifier at all
  const invert =
    modifier === Modifier.MIRROR && (nature === Nature.PUSH || nature === Nature.FREEZE);
  const resolveCell = cell => {
    const obj = worldRunes.objectAt(cell.x, cell.y);
    const dir = effectDirectionForCell(px, py, cell, shape, dirName);
    if (obj) return { cell, obj: obj, dir, ...obj.reactTo(nature, dir, invert) };
    if (nature === Nature.SOLIDIFY && isVoid(cell.x, cell.y))
      return { cell, obj: null, dir, effect: 'solidify_void' };
    // water is a grid tile type, not an object — Mirror never applies here (thaw only
    // ever works on a crate, per invert's definition above), so no `invert` check needed
    if (nature === Nature.FREEZE && isWaterAt(cell.x, cell.y))
      return { cell, obj: null, dir, effect: 'freeze_water' };
    return { cell, obj: null, dir, effect: 'ambiant' };
  };
  const result = cells.map(resolveCell);
  return {
    ok: true,
    nature,
    shape,
    modifier,
    cellsTouched: result.map(entry => entry.cell),
    result,
    runeCount: runes.length,
  };
}
// registry of locks tied to a condition (e.g. a pair of plates activated together, or a
// phrase of at least 2 runes touching a point) — checked after every phrase resolution
export const verrouLinks = []; // { lock, check(result, runeCount) -> bool }
export function checkLocks(result, runeCount) {
  verrouLinks.forEach(link => {
    if (!link.lock.open && link.check(result, runeCount)) link.lock.open = true;
  });
}
