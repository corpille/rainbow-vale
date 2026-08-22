/* ============ Interactive objects: plates, vine/crate/mirror/lock, push resolution ============ */
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
// plateByTile comes from map-loader.js, which imports createVine/createCrate/etc. back
// from here — same harmless cycle as world-zones.js's obstacleByTile: only touched from
// closures called after every file's top-level setup has run.
import { plateByTile } from './map-loader.js';

// an uncovered plate goes back to being its tile's own occupant, walkable again
function unweighPlateAt(x, y) {
  const plate = plateByTile.get(key(x, y));
  if (plate && plate.weighed) {
    plate.weighed = false;
    objectsMap.set(key(x, y), plate);
  }
}
// max slide distance per shape; Contact is excluded since its one cell is already at
// range 1, so its slide budget would always be zero
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
  result.forEach(entry => {
    if (entry.effect === 'solidify_void') {
      grid.set(key(entry.cell.x, entry.cell.y), {
        type: 'floor',
        roomId: inferRoomId(entry.cell.x, entry.cell.y, casterCell && casterCell.roomId),
      });
    } else if (entry.effect === 'freeze_water') {
      // every water tile's roomId is the same fixed placeholder (see WATER_CHAR in
      // map-loader.js) — no need to read it back, just carry it forward
      grid.set(key(entry.cell.x, entry.cell.y), { type: 'ice', roomId: 'h' });
      bumpPuddleEpoch();
    }
  });
  const maxSlide = RAY_RANGE_FOR_SHAPE[shape];
  // several crates can line up in one push (e.g. a Line): resolve as a worklist,
  // advancing tile by tile and retrying blocked ones each pass, so the whole train
  // shifts together instead of each crate stopping after a single tile
  let pending = result
    .filter(entry => entry.effect === 'push' && entry.obj && entry.obj.type === 'crate')
    .map(entry => {
      const [dx, dy] = entry.dir;
      const traveled = dx ? (entry.cell.x - px) * dx : (entry.cell.y - py) * dy;
      return {
        x: entry.cell.x,
        y: entry.cell.y,
        dx,
        dy,
        budget: maxSlide ? maxSlide - traveled : 1,
      };
    });
  let progress = true;
  while (progress && pending.length) {
    progress = false;
    pending = pending.filter(slide => {
      if (slide.budget <= 0) return false; // ran out of range — stops here
      const destX = slide.x + slide.dx,
        destY = slide.y + slide.dy;
      // Pull drags a crate toward the caster — the player isn't a blocker like a wall,
      // so stop it explicitly rather than letting it slide onto/through that tile
      if (destX === px && destY === py) return true; // blocked this pass — retry later
      const destObj = worldRunes.objectAt(destX, destY);
      if (destObj && destObj.type === 'sym_plate') {
        destObj.weighed = true;
        worldRunes.moveObject(slide.x, slide.y, destX, destY);
        unweighPlateAt(slide.x, slide.y);
        return false; // stops there, weighing the plate
      } else if (!isBlockingFor(destX, destY) && worldRunes.inBounds(destX, destY)) {
        // a dead obstacle (cut vine, opened lock) still sits in objectsMap but no longer
        // blocks, so a crate can slide over it
        worldRunes.moveObject(slide.x, slide.y, destX, destY);
        unweighPlateAt(slide.x, slide.y);
        slide.x = destX;
        slide.y = destY;
        slide.budget--;
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
  const vine = {
    type: 'vine',
    destroyed: false,
    get blocksMovement() {
      return !vine.destroyed;
    },
    // pure check reused by Spread propagation (and pierce-through checks) so probing
    // "would this react" never mutates state like reactTo does
    wouldReact(nature) {
      return !vine.destroyed && nature === Nature.CUT;
    },
    reactTo(nature) {
      if (!vine.destroyed && nature === Nature.CUT) {
        vine.destroyed = true;
        return { effect: 'destroyed' };
      }
      return { effect: 'none' };
    },
  };
  return vine;
}
export function createCrate() {
  const crate = {
    type: 'crate',
    frozen: false,
    blocksMovement: true,
    // Mirror inverts both natures that touch a crate: FREEZE normally immobilizes, mirrored
    // it thaws instead; PUSH normally shoves away, mirrored it pulls toward the caster
    wouldReact(nature, invert) {
      if (nature === Nature.FREEZE) return invert ? crate.frozen : !crate.frozen;
      return nature === Nature.PUSH && !crate.frozen;
    },
    reactTo(nature, dir, invert) {
      if (nature === Nature.FREEZE) {
        if (invert && crate.frozen) {
          crate.frozen = false;
          return { effect: 'thawed' };
        }
        if (!invert && !crate.frozen) {
          crate.frozen = true;
          return { effect: 'immobilized' };
        }
      }
      if (nature === Nature.PUSH && !crate.frozen) {
        return { effect: 'push', dir: invert ? [-dir[0], -dir[1]] : dir };
      }
      return { effect: 'none' };
    },
  };
  return crate;
}
/* ---- secondary objects: give the modifiers a concrete use ---- */
// a mirror surface is an obstacle that reacts to nothing, but each orientation acts as
// a 90° corner reflector connecting 2 of the 4 cardinal directions: a ray entering one
// open face exits the other with its remaining range; a closed face just blocks
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
  // a plate counts as "touched" either momentarily (hit by this resolution, e.g. a
  // wide shape catching several plates at once) or persistently (a crate weighing it down)
  const touches = new Set();
  result.forEach(entry => {
    if (entry.effect === 'activated' && entry.obj && entry.obj.pair === pairObj.pair)
      touches.add(entry.obj);
  });
  let totalMembers = 0;
  plateByTile.forEach(plate => {
    if (plate.pair === pairObj.pair) {
      totalMembers++;
      if (plate.weighed) touches.add(plate);
    }
  });
  return totalMembers > 0 && touches.size >= totalMembers;
}
// a lock never reacts to a nature directly — it opens only when game logic finds
// its condition (e.g. a pair of plates activated together) met
export function createLock() {
  const lock = {
    type: 'lock',
    open: false,
    get blocksMovement() {
      return !lock.open;
    },
    reactTo() {
      return { effect: 'none' };
    },
  };
  return lock;
}
