/* ============ Interactive objects: plates, vine/crate/mirror/lock, push resolution ============ */
import {
  CARDINAL_OFFSETS,
  Modifier,
  Nature,
  RANGE_DIAGONAL,
  RANGE_LINE,
  RANGE_SHORT,
  bumpPuddleEpoch,
  grid,
  isBlockingFor,
  key,
  objectsMap,
  track,
  worldRunes,
} from './world-zones.js';
import {
  CONE_PATTERN,
  checkLocks,
  computeSpellCells,
  deriveSpell,
  findSwitchTarget,
} from './spell-shapes.js';
// plateByTile/obstacleByTile come from map-loader.js, which imports createVine/
// createCrate/etc. back from here — same harmless cycle as world-zones.js's own
// obstacleByTile import: only touched from closures called after every file's
// top-level setup has run.
import { obstacleByTile, plateByTile } from './map-loader.js';

// an uncovered plate goes back to being its tile's own occupant, walkable again.
// Every caller invokes this right after worldRunes.moveObject() vacated this same
// (x,y) — that call already snapshotted objectsMap's prior entry here (the object
// that just left), so restoring it on undo is moveObject's job; nothing further to
// track for the objectsMap.set below.
function unweighPlateAt(x, y) {
  const plate = plateByTile.get(key(x, y));
  if (plate && plate.weighed) {
    track(() => (plate.weighed = true));
    plate.weighed = false;
    objectsMap.set(key(x, y), plate);
  }
}
// a sliding crate's new resting tile: move it there, then let its old tile's plate
// (if any) spring back up — shared by every branch of the push-slide loop below
function settleSlide(slide, destX, destY) {
  worldRunes.moveObject(slide.x, slide.y, destX, destY);
  unweighPlateAt(slide.x, slide.y);
}
// max slide distance per shape; Contact has no entry here since it has no ray to
// measure remaining range against — it always gets a flat budget of 1 instead, via
// the ternary's fallback below
const RAY_RANGE_FOR_SHAPE = {
  LINE: RANGE_LINE,
  DIAGONAL: RANGE_DIAGONAL,
  HALF_CIRCLE: RANGE_SHORT,
  CONE: CONE_PATTERN.length,
};
// textures a newly-shattered tile with whichever neighbor's room it can find, falling
// back to the caster's own room (or the wall's own former room) if fully isolated
function inferRoomId(x, y, fallback) {
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const cell = grid.get(key(x + dx, y + dy));
    if (cell && cell.roomId) return cell.roomId;
  }
  return fallback;
}
export function applyEffectsToWorld(result, runeCount, shape, px, py) {
  checkLocks(result, runeCount);
  result.forEach(entry => {
    if (entry.effect === 'crack' || entry.effect === 'mend') {
      // still fully solid (see isBlockingFor/inBounds) — only a crate ramming into it
      // (the push-slide loop below) actually shatters it into floor. Already reversible
      // in-game (cast Mend to un-crack), so not tracked for undo, same as crate freeze.
      const obstacle = obstacleByTile.get(key(entry.cell.x, entry.cell.y));
      if (obstacle) obstacle.cracked = entry.effect === 'crack';
    } else if (entry.effect === 'freeze') {
      // every water tile's roomId is the same fixed placeholder (see WATER_CHAR in
      // map-loader.js) — no need to read it back, just carry it forward. One-way by
      // design (no spell ever un-freezes a water tile back), so left out of the undo
      // log on purpose, same as vine-cutting and wall-shattering below.
      grid.set(key(entry.cell.x, entry.cell.y), { type: 'ice', roomId: 'h' });
      bumpPuddleEpoch();
    } else if (entry.effect === 'switch') {
      // a pure position trade: the crate lands exactly on the caster's tile, and
      // ui-panel.js's castPhrase moves the player to the crate's old tile in turn
      const destPlate = plateByTile.get(key(px, py));
      if (destPlate) {
        track(() => (destPlate.weighed = false));
        destPlate.weighed = true;
      }
      worldRunes.moveObject(entry.cell.x, entry.cell.y, px, py);
      unweighPlateAt(entry.cell.x, entry.cell.y);
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
      // entry.cell.d is the cumulative range already spent reaching this cell (set by
      // every shape tracer in spell-shapes.js), which — unlike a straight-line
      // displacement from px,py — stays correct across a mirror bounce, where the
      // cell's x/y no longer move along the original cast direction.
      // Pull (Mirror on Push, entry.invert) sends the crate back the way it came
      // instead of onward, so "range left ahead on the ray" (maxSlide - d) doesn't
      // apply: it's only ever bounded by the gap back to the caster, capped at d - 1
      // tiles so it can't land on the caster's own tile (the destX/destY === px/py
      // guard below stops it there regardless, this just avoids under/over-budgeting
      // the approach)
      const budget = !maxSlide ? 1 : entry.invert ? entry.cell.d - 1 : maxSlide - entry.cell.d;
      return {
        x: entry.cell.x,
        y: entry.cell.y,
        dx,
        dy,
        budget,
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
      const destWall = obstacleByTile.get(key(destX, destY));
      if (destObj && destObj.type === 'sym_plate') {
        track(() => (destObj.weighed = false));
        destObj.weighed = true;
        settleSlide(slide, destX, destY);
        return false; // stops there, weighing the plate
      } else if (destWall && destWall.cracked) {
        // a cracked wall shatters into floor the instant a crate rams into it, and the
        // crate settles right there rather than sliding on through the gap it just opened
        // — one-way by design (no spell rebuilds a wall), so not tracked for undo
        obstacleByTile.delete(key(destX, destY));
        grid.set(key(destX, destY), {
          type: 'floor',
          roomId: inferRoomId(destX, destY, destWall.roomId),
        });
        settleSlide(slide, destX, destY);
        return false; // stops there, having shattered the wall
      } else if (!isBlockingFor(destX, destY) && worldRunes.inBounds(destX, destY)) {
        // a dead obstacle (cut vine, opened lock) still sits in objectsMap but no longer
        // blocks, so a crate can slide over it
        settleSlide(slide, destX, destY);
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
  const cells = computeSpellCells(nature, shape, modifier, withPierce, px, py, dirName);
  // Switch only ever acts on the one crate it targets — previewing the whole ray
  // (which may keep cracking/freezing past it) reads as "all of this will happen",
  // so show just the actual target instead
  if (modifier === Modifier.SWITCH) {
    const target = findSwitchTarget(cells);
    return target ? [target] : [];
  }
  return cells;
}

/* ---- the 4 interactive objects (one per signature nature) ---- */
export function createVine() {
  return {
    type: 'vine',
    destroyed: false,
    get blocksMovement() {
      return !this.destroyed;
    },
    // pure check reused by Spread propagation (and pierce-through checks) so probing
    // "would this react" never mutates state like reactTo does
    wouldReact(nature) {
      return !this.destroyed && nature === Nature.CUT;
    },
    reactTo(nature) {
      // one-way by design (no spell un-cuts a vine) — not tracked for undo
      if (!this.destroyed && nature === Nature.CUT) this.destroyed = true;
    },
  };
}
export function createCrate() {
  return {
    type: 'crate',
    frozen: false,
    blocksMovement: true,
    // Mirror inverts both natures that touch a crate: FREEZE normally immobilizes, mirrored
    // it thaws instead; PUSH normally shoves away, mirrored it pulls toward the caster
    wouldReact(nature, invert) {
      if (nature === Nature.FREEZE) return invert ? this.frozen : !this.frozen;
      return nature === Nature.PUSH && !this.frozen;
    },
    reactTo(nature, dir, invert) {
      // frozen/thawed is already reversible in-game (cast Mirror+Freeze again to
      // flip it back), so not tracked for undo — same budget trade-off as the
      // one-way effects above
      if (nature === Nature.FREEZE && this.frozen === invert) this.frozen = !invert;
      if (nature === Nature.PUSH && !this.frozen) {
        return { effect: 'push', dir: invert ? [-dir[0], -dir[1]] : dir, invert };
      }
    },
  };
}
/* ---- secondary objects: give the modifiers a concrete use ---- */
// a mirror surface is an obstacle that reacts to nothing, but each orientation acts as
// a 90° corner reflector connecting 2 of the 4 cardinal directions: a ray entering one
// open face exits the other with its remaining range; a closed face just blocks
// direction codes: 0=up, 1=down, 2=left, 3=right (see DIRS4 in world-zones.js)
export const MIRROR_REFLECT = {
  NE: { 1: 3, 2: 0 },
  ES: { 2: 1, 0: 3 },
  SW: { 0: 2, 3: 1 },
  WN: { 3: 0, 1: 2 },
};
export function createMirrorSurface(orientation) {
  return {
    type: 'mirror_surface',
    orientation: orientation || 'NE',
    blocksMovement: true,
    reactTo() {},
  };
}
export function isPairResolved(result, pair) {
  // a plate counts as "touched" either momentarily (hit by this resolution, e.g. a
  // wide shape catching several plates at once) or persistently (a crate weighing it down)
  const touches = new Set();
  result.forEach(entry => {
    if (entry.effect === 'activated' && entry.obj && entry.obj.pair === pair)
      touches.add(entry.obj);
  });
  let totalMembers = 0;
  plateByTile.forEach(plate => {
    if (plate.pair === pair) {
      totalMembers++;
      if (plate.weighed) touches.add(plate);
    }
  });
  return totalMembers > 0 && touches.size >= totalMembers;
}
// a lock never reacts to a nature directly — it opens only when game logic finds
// its condition (e.g. a pair of plates activated together) met
export function createLock() {
  return {
    type: 'lock',
    open: false,
    get blocksMovement() {
      return !this.open;
    },
    reactTo() {},
  };
}
