/* ============ Spell targeting: shapes, modifiers, phrase resolution ============ */
import {
  CARDINAL_OFFSETS,
  DIAG_OF,
  DIRS4,
  DIR_INVERSE,
  Modifier,
  Nature,
  RANGE_DIAGONAL,
  RANGE_LINE,
  RANGE_SHORT,
  SYMBOL_TO_ROLE,
  Shape,
  isBlockingFor,
  isVoid,
  key,
  reachableCell,
  validatePhrase,
  worldRunes,
} from './world-zones.js';
import { MIRROR_REFLECT } from './world-objects.js';

const DIR_NAME_OF_VEC = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right' };
function getCellsLine(px, py, dx, dy, maxRange, withPierce, nature) {
  const cells = [];
  for (let i = 1; i <= maxRange; i++) {
    const x = px + dx * i,
      y = py + dy * i;
    if (!worldRunes.inBounds(x, y)) {
      // Solidify grows a new floor tile on true void — that tile is no longer a dead
      // end once grown, so (like Pierce/Push/burn below) the ray keeps going through
      // it by default, chaining across a whole row of void instead of stopping at the
      // first tile grown
      if (nature === Nature.SOLIDIFY && isVoid(x, y)) {
        cells.push({ x, y, dir: [dx, dy] });
        continue;
      }
      // Pierce punches through walls too: skip the solid tile and keep the ray going
      if (withPierce) continue;
      break;
    }
    cells.push({ x, y, dir: [dx, dy] });
    if (isBlockingFor(x, y)) {
      const obj = worldRunes.objectAt(x, y);
      if (obj && obj.type === 'mirror_surface') {
        const inDir = DIR_NAME_OF_VEC[dx + ',' + dy];
        const outDir = inDir && MIRROR_REFLECT[obj.orientation][inDir];
        if (outDir) {
          const [ndx, ndy] = DIRS4[outDir];
          return cells.concat(getCellsLine(x, y, ndx, ndy, maxRange - i, withPierce, nature));
        }
      }
      const reacts = obj && typeof obj.wouldReact === 'function' && obj.wouldReact(nature);
      // a Push beam doesn't stop at what it just pushed — it keeps going to chain
      // through whatever's lined up behind it. A vine burning away, or a puddle
      // freezing/evaporating, are the same story: once the reaction lands neither one
      // still blocks (see their blocksMovement getters), so they never really blocked
      // the NEXT object in line either — only Pierce should be needed for obstacles
      // that stay solid no matter what they react to (a crate, frozen or not)
      const clearsPath =
        (obj.type === 'vine' && nature === Nature.BURN) ||
        (obj.type === 'puddle' && (nature === Nature.FREEZE || nature === Nature.BURN));
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
      if (!withPierce || reachable) cells.push({ x, y });
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
      if (!withPierce || reachable) cells.push(target);
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
function bresenhamLine(a, b) {
  const points = [];
  let x0 = a.x,
    y0 = a.y;
  const x1 = b.x,
    y1 = b.y;
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
function effectDirectionForCell(px, py, c, shape, dirName) {
  // a Mirror bounce (or the Bounce modifier) changes the ray's direction mid-flight —
  // cells past that point carry their own travel direction, not the cast's original
  if (c.dir) return c.dir;
  if (shape === Shape.LINE) return DIRS4[dirName];
  if (shape === Shape.DIAGONAL) return DIAG_OF[dirName];
  const dx = c.x - px,
    dy = c.y - py;
  if (dx === 0 && dy === 0) return DIRS4[dirName];
  if (Math.abs(dx) >= Math.abs(dy)) return [Math.sign(dx), 0];
  return [0, Math.sign(dy)];
}
function applyBounceModifier(shape, px, py, dirName, nature, initialCells) {
  if (shape !== Shape.LINE && shape !== Shape.DIAGONAL) return [];
  const [dx0, dy0] = shape === Shape.LINE ? DIRS4[dirName] : DIAG_OF[dirName];
  let hitX = null,
    hitY = null,
    steps = 0;
  for (const c of initialCells) {
    steps++;
    if (isBlockingFor(c.x, c.y)) {
      hitX = c.x;
      hitY = c.y;
      break;
    }
  }
  if (hitX === null) return [];
  let ndx = dx0,
    ndy = dy0;
  if (Math.abs(dx0) >= Math.abs(dy0)) ndx = -dx0;
  else ndy = -dy0;
  const remainingRange = Math.max(0, (shape === Shape.LINE ? RANGE_LINE : RANGE_DIAGONAL) - steps);
  return getCellsLine(hitX, hitY, ndx, ndy, remainingRange, false, nature);
}
// type of whatever's at a cell, for Spread's same-type chaining: object's own type,
// or 'void' for a tile Solidify could grow into; null means nothing to chain through
function spreadTypeAt(x, y, nature) {
  const obj = worldRunes.objectAt(x, y);
  if (obj) return obj.type;
  return nature === Nature.SOLIDIFY && isVoid(x, y) ? 'void' : null;
}
// Spread keeps the base shape's hits, then hops to adjacent cells/objects of that SAME
// type that would ALSO react, chaining outward (e.g. burning one vine catches the whole
// connected thicket, not just a fixed ring of tiles)
function applySpreadModifier(nature, initialCells) {
  const visited = new Set(initialCells.map(c => key(c.x, c.y)));
  const extra = [];
  let frontier = initialCells
    .map(c => ({ x: c.x, y: c.y, type: spreadTypeAt(c.x, c.y, nature) }))
    .filter(f => {
      if (f.type === 'void') return true;
      const obj = worldRunes.objectAt(f.x, f.y);
      return obj && typeof obj.wouldReact === 'function' && obj.wouldReact(nature);
    });
  while (frontier.length) {
    const next = [];
    frontier.forEach(f => {
      CARDINAL_OFFSETS.forEach(([dx, dy]) => {
        const x = f.x + dx,
          y = f.y + dy,
          k = key(x, y);
        if (visited.has(k)) return;
        visited.add(k);
        const type = spreadTypeAt(x, y, nature);
        if (type !== f.type) return;
        const obj = worldRunes.objectAt(x, y);
        if (type !== 'void' && !obj.wouldReact(nature)) return;
        extra.push({ x, y });
        next.push({ x, y, type });
      });
    });
    frontier = next;
  }
  return extra;
}
function applyMirrorModifier(shape, px, py, dirName, nature, withPierce) {
  return applyShape(shape, px, py, DIR_INVERSE[dirName], nature, withPierce);
}
// derives nature/shape/modifier from the phrase's runes; slot2/slot3 default when the
// phrase is shorter than 3
export function deriveSpell(runes) {
  const nature = SYMBOL_TO_ROLE[runes[0]].slot1;
  const shape = runes.length >= 2 ? SYMBOL_TO_ROLE[runes[1]].slot2 : Shape.CONTACT_DEFAULT;
  const modifier = runes.length === 3 ? SYMBOL_TO_ROLE[runes[2]].slot3 : Modifier.NONE;
  return { nature, shape, modifier, withPierce: modifier === Modifier.PIERCE };
}
// full set of cells a spell touches: base shape plus any BOUNCE/SPREAD/MIRROR modifier.
// Shared by resolvePhrase and the live range preview (computeSpellPreview) — same
// geometry, only what's done with the cells differs
export function computeSpellCells(nature, shape, modifier, withPierce, px, py, dirName) {
  const cells = applyShape(shape, px, py, dirName, nature, withPierce);
  if (modifier === Modifier.BOUNCE)
    return cells.concat(applyBounceModifier(shape, px, py, dirName, nature, cells));
  if (modifier === Modifier.SPREAD) return cells.concat(applySpreadModifier(nature, cells));
  if (modifier === Modifier.MIRROR)
    return cells.concat(applyMirrorModifier(shape, px, py, dirName, nature, withPierce));
  return cells;
}
export function resolvePhrase(runes, px, py, dirName) {
  if (!validatePhrase(runes)) return { ok: false };
  const { nature, shape, modifier, withPierce } = deriveSpell(runes);
  const cells = computeSpellCells(nature, shape, modifier, withPierce, px, py, dirName);
  const resolveCell = c => {
    const obj = worldRunes.objectAt(c.x, c.y);
    const dir = effectDirectionForCell(px, py, c, shape, dirName);
    if (obj) return { cell: c, obj: obj, dir, ...obj.reactTo(nature, dir, c.x, c.y) };
    if (nature === Nature.SOLIDIFY && isVoid(c.x, c.y))
      return { cell: c, obj: null, dir, effect: 'solidify_void' };
    return { cell: c, obj: null, dir, effect: 'ambiant' };
  };
  const result = cells.map(resolveCell);
  return {
    ok: true,
    nature,
    shape,
    modifier,
    cellsTouched: result.map(r => r.cell),
    result,
    runeCount: runes.length,
  };
}
// registry of locks tied to a condition (e.g. a pair of plates activated together, or a
// phrase of at least 2 runes touching a point) — checked after every phrase resolution
export const verrouLinks = []; // { lock, check(result, runeCount) -> bool }
export function checkLocks(result, runeCount) {
  verrouLinks.forEach(v => {
    if (!v.lock.open && v.check(result, runeCount)) v.lock.open = true;
  });
}
