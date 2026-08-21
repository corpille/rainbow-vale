/* ============ Interactive objects: plates, vine/puddle/crate/mirror/lock, push resolution ============ */
import {
  CARDINAL_OFFSETS,
  Nature,
  RANGE_DIAGONAL,
  RANGE_LINE,
  RANGE_SHORT,
  bumpPuddleEpoch,
  grid,
  isBlockingFor,
  key,
  objectsMap,
  worldRunes,
} from './world-zones.js';
import { CONE_PATTERN, checkLocks, computeSpellCells, deriveSpell } from './spell-shapes.js';
// plateByTile comes from map-loader.js, which imports createVine/createPuddle/etc. back
// from here — same harmless cycle as world-zones.js's obstacleByTile: only touched from
// closures called after every file's top-level setup has run.
import { plateByTile, puddleByTile } from './map-loader.js';

// an uncovered plate goes back to being its tile's own occupant, walkable again
function unweighPlateAt(x, y) {
  const plate = plateByTile.get(key(x, y));
  if (plate && plate.weighed) {
    plate.weighed = false;
    objectsMap.set(key(x, y), plate);
  }
}
// an uncovered puddle goes back to being its tile's own occupant — puddleByTile keeps
// the real object (and its frozen/evaporated state) alive the whole time a crate sits on
// top of it, since that crate is objectsMap's occupant for that tile in the meantime
function unpuddleAt(x, y) {
  const puddle = puddleByTile.get(key(x, y));
  if (puddle) objectsMap.set(key(x, y), puddle);
}
// shapes whose cells sit at varying distances from the caster have a meaningful "far
// end" a pushed crate can slide to. Contact is excluded: its one cell is already at full
// range (1), so its slide budget would always be zero
const RAY_RANGE_FOR_SHAPE = {
  LINE: RANGE_LINE,
  DIAGONAL: RANGE_DIAGONAL,
  HALF_CIRCLE: RANGE_SHORT,
  CONE: CONE_PATTERN.length,
};
// textures a newly-solidified tile with whichever neighbor's room it can find,
// falling back to the caster's own room if the tile is fully isolated
function inferRoomId(x, y, fallback) {
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const cell = grid.get(key(x + dx, y + dy));
    if (cell && cell.roomId) return cell.roomId;
  }
  return fallback;
}
export function applyEffectsToWorld(result, runeCount, shape, px, py) {
  checkLocks(result, runeCount);
  const casterCell = grid.get(key(px, py));
  result.forEach(r => {
    if (r.effect === 'solidify_void') {
      grid.set(key(r.cell.x, r.cell.y), {
        type: 'floor',
        roomId: inferRoomId(r.cell.x, r.cell.y, casterCell && casterCell.roomId),
      });
    }
  });
  const maxSlide = RAY_RANGE_FOR_SHAPE[shape];
  // several crates can line up in one push (e.g. a Line): resolve as a worklist,
  // advancing tile by tile and retrying blocked ones each pass, so the whole train
  // shifts together instead of each crate stopping after a single tile
  let pending = result
    .filter(r => r.effect === 'push' && r.obj && r.obj.type === 'crate')
    .map(r => {
      const [dx, dy] = r.dir;
      const traveled = dx ? (r.cell.x - px) * dx : (r.cell.y - py) * dy;
      return { x: r.cell.x, y: r.cell.y, dx, dy, budget: maxSlide ? maxSlide - traveled : 1 };
    });
  let progress = true;
  while (progress && pending.length) {
    progress = false;
    pending = pending.filter(p => {
      if (p.budget <= 0) return false; // ran out of range — stops here
      const destX = p.x + p.dx,
        destY = p.y + p.dy;
      const destObj = worldRunes.objectAt(destX, destY);
      if (destObj && destObj.type === 'sym_plate') {
        // crate slides onto the plate and weighs it down; plate stays registered
        // in plateByTile so it can be found again once uncovered
        destObj.weighed = true;
        worldRunes.moveObject(p.x, p.y, destX, destY);
        unweighPlateAt(p.x, p.y);
        unpuddleAt(p.x, p.y);
        return false; // stops there, weighing the plate
      } else if (!isBlockingFor(destX, destY) && worldRunes.inBounds(destX, destY)) {
        // a dead obstacle (burnt vine, evaporated puddle, opened lock) still sits in
        // objectsMap but no longer blocks — a crate can slide right over it. A frozen/
        // evaporated puddle underneath stays registered in puddleByTile so it resurfaces
        // once the crate moves on, instead of being lost when the crate overwrites it here
        worldRunes.moveObject(p.x, p.y, destX, destY);
        unweighPlateAt(p.x, p.y);
        unpuddleAt(p.x, p.y);
        p.x = destX;
        p.y = destY;
        p.budget--;
        progress = true;
        return true; // still has budget — try to keep sliding next pass
      }
      return true; // blocked this pass (wall or another crate) — retry later
    });
  }
  // a crate may have just weighed/unweighed a plate — let a satisfied lock open
  // this same cast, not the next one
  checkLocks(result, runeCount);
}

// range preview: same geometry as real resolution, purely for display (no effect
// applied) — recomputed every frame during composition
export function computeSpellPreview(runes, px, py, dirName) {
  if (!runes.length) return [];
  const { nature, shape, modifier, withPierce } = deriveSpell(runes);
  return computeSpellCells(nature, shape, modifier, withPierce, px, py, dirName);
}

/* ---- the 4 interactive objects (one per signature nature) ---- */
export function createVine() {
  const o = {
    type: 'vine',
    destroyed: false,
    get blocksMovement() {
      return !o.destroyed;
    },
    // pure check reused by Spread propagation (and pierce-through checks) so probing
    // "would this react" never mutates state like reactTo does
    wouldReact(nature) {
      return !o.destroyed && nature === Nature.BURN;
    },
    reactTo(nature) {
      if (!o.destroyed && nature === Nature.BURN) {
        o.destroyed = true;
        return { effect: 'destroyed' };
      }
      return { effect: 'none' };
    },
  };
  return o;
}
export function createPuddle() {
  const o = {
    type: 'puddle',
    state: 'water',
    get blocksMovement() {
      return o.state === 'water';
    },
    wouldReact(nature) {
      return o.state !== 'evaporated' && (nature === Nature.FREEZE || nature === Nature.BURN);
    },
    reactTo(nature) {
      if (o.state === 'evaporated') return { effect: 'none' };
      if (nature === Nature.FREEZE) {
        o.state = 'frozen';
        bumpPuddleEpoch();
        return { effect: 'frozen' };
      }
      if (nature === Nature.BURN) {
        o.state = 'evaporated';
        bumpPuddleEpoch();
        return { effect: 'evaporated' };
      }
      return { effect: 'none' };
    },
  };
  return o;
}
export function createCrate() {
  const o = {
    type: 'crate',
    frozen: false,
    blocksMovement: true,
    wouldReact(nature) {
      return (
        (nature === Nature.FREEZE && !o.frozen) ||
        (nature === Nature.BURN && o.frozen) ||
        (nature === Nature.PUSH && !o.frozen)
      );
    },
    reactTo(nature, dir) {
      if (nature === Nature.FREEZE && !o.frozen) {
        o.frozen = true;
        return { effect: 'immobilized' };
      }
      if (nature === Nature.BURN && o.frozen) {
        o.frozen = false;
        return { effect: 'thawed' };
      }
      if (nature === Nature.PUSH && !o.frozen) return { effect: 'push', dir };
      return { effect: 'none' };
    },
  };
  return o;
}
/* ---- secondary objects: give the modifiers a concrete use ---- */
// a mirror surface is just an obstacle that reacts to nothing — enough to serve as a
// Bounce point, otherwise only visually distinct.
// each orientation connects 2 of the 4 cardinal directions, like a 90° corner reflector:
// a spell entering one open face exits the other and keeps its remaining range;
// a closed face just blocks normally
export const MIRROR_REFLECT = {
  NE: { down: 'right', left: 'up' },
  ES: { left: 'down', up: 'right' },
  SW: { up: 'left', right: 'down' },
  WN: { right: 'up', down: 'left' },
};
export function createMirrorSurface(orientation) {
  return {
    type: 'mirror_surface',
    orientation: orientation || 'NE',
    blocksMovement: true,
    reactTo() {
      return { effect: 'none' };
    },
  };
}
export function isPairResolved(result, pairObj) {
  // a plate counts as "touched" either momentarily (hit by this resolution, e.g. via
  // Mirror) or persistently (a crate currently weighing it down)
  const touches = new Set();
  result.forEach(r => {
    if (r.effect === 'activated' && r.obj && r.obj.pair === pairObj.pair) touches.add(r.obj);
  });
  let totalMembers = 0;
  plateByTile.forEach(o => {
    if (o.pair === pairObj.pair) {
      totalMembers++;
      if (o.weighed) touches.add(o);
    }
  });
  return totalMembers > 0 && touches.size >= totalMembers;
}
// a lock never reacts to a nature directly — it opens only when game logic finds
// its condition (e.g. a pair of plates activated together) met
export function createLock() {
  const o = {
    type: 'lock',
    open: false,
    get blocksMovement() {
      return !o.open;
    },
    reactTo() {
      return { effect: 'none' };
    },
  };
  return o;
}
