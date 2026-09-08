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
  trackMap,
  worldRunes,
} from './world-zones.js';
import {
  CONE_ROWS,
  checkLocks,
  computeSpellCells,
  deriveSpell,
  findSwitchTarget,
} from './spell-shapes.js';
// plateByTile/obstacleByTile come from map-loader.js, which imports createVine/
// createCrate/etc. back from here. Same harmless cycle as world-zones.js's own
// obstacleByTile import — only touched from closures called after setup finishes.
import { obstacleByTile, plateByTile } from './map-loader.js';

// an uncovered plate goes back to being its tile's own occupant, walkable again.
// Every caller runs this right after moveObject() vacated this (x,y), and that call
// already snapshotted the prior objectsMap entry, so undo is moveObject's job here.
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
// max slide distance per shape. Contact has no ray to measure range against, so it's
// missing here and just gets a flat budget of 1 via the ternary's fallback below.
const RAY_RANGE_FOR_SHAPE = {
  LINE: RANGE_LINE,
  DIAGONAL: RANGE_DIAGONAL,
  HALF_CIRCLE: RANGE_SHORT,
  CONE: CONE_ROWS,
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
export function applyEffectsToWorld(result, shape, px, py) {
  checkLocks();
  result.forEach(entry => {
    if (entry.effect === 'crack' || entry.effect === 'mend') {
      // still fully solid — only a crate ramming into it (push-slide loop below) actually
      // shatters it. Reversible in-game (Mend un-cracks it), so no undo tracking needed.
      const obstacle = obstacleByTile.get(key(entry.cell.x, entry.cell.y));
      if (obstacle) obstacle.cracked = entry.effect === 'crack';
    } else if (entry.effect === 'freeze' || entry.effect === 'thaw') {
      // every water tile shares the same fixed roomId placeholder (see WATER_CHAR in
      // map-loader.js), so no need to read it back. Tracked, unlike the one-way effects:
      // thawing turns walkable ice back into blocking water, so an undo that rewinds the
      // player onto that tile would otherwise leave them standing in a pond. doUndo()
      // bumps the puddle epoch itself once it's done, so the snapshot needn't.
      const tileKey = key(entry.cell.x, entry.cell.y);
      trackMap(grid, tileKey);
      grid.set(tileKey, { type: entry.effect === 'thaw' ? 'water' : 'ice', roomId: 'h' });
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
  // advancing tile by tile and retrying blocked ones, so the whole train moves together.
  let pending = result
    .filter(entry => entry.effect === 'push' && entry.obj && entry.obj.type === 'crate')
    .map(entry => {
      const [dx, dy] = entry.dir;
      // entry.cell.d is the range already spent reaching this cell — stays correct across
      // a mirror bounce, unlike a straight-line distance from px,py.
      // Pull sends the crate back toward the caster instead of onward, so its budget is
      // the gap back to the caster (capped at d - 1 so it can't land on the caster's tile).
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
        // a cracked wall shatters into floor the instant a crate rams into it; the crate
        // settles right there rather than sliding through the new gap. One-way, no undo.
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
  checkLocks();
}

// range preview: same geometry as real resolution, purely for display (no effect
// applied) — recomputed every frame during composition
export function computeSpellPreview(runes, px, py, dirName) {
  if (!runes.length) return [];
  const { nature, shape, modifier, withThrough } = deriveSpell(runes);
  const cells = computeSpellCells(nature, shape, modifier, withThrough, px, py, dirName);
  // Switch only ever acts on the one crate it targets — previewing the whole ray
  // would look like everything on it is about to happen, so show just the target.
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
    // pure check reused by Spread propagation (and through checks) so probing
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
    // Reverse inverts both natures that touch a crate: FREEZE normally immobilizes, mirrored
    // it thaws instead; PUSH normally shoves away, mirrored it pulls toward the caster
    wouldReact(nature, invert) {
      if (nature === Nature.FREEZE) return invert ? this.frozen : !this.frozen;
      return nature === Nature.PUSH && !this.frozen;
    },
    reactTo(nature, dir, invert) {
      // routed through wouldReact's own truthy check rather than `this.frozen === invert`
      // on purpose: Terser's booleans_as_integers pass (build.js) turns the `frozen: false`
      // literal (and map-loader.js's `existingCrate.frozen = true`) into a plain *number*
      // (0/1), while `invert` stays a real boolean from spell-shapes.js's comparison chain —
      // `1 === true` is strictly false, so a map-authored frozen crate could never thaw.
      if (nature === Nature.FREEZE && this.wouldReact(nature, invert)) {
        // wouldReact only passes when the flag actually flips, so the value being replaced
        // was always `invert` itself — no need to snapshot it first
        track(() => (this.frozen = invert));
        this.frozen = !invert;
      }
      if (nature === Nature.PUSH && !this.frozen) {
        return { effect: 'push', dir: invert ? [-dir[0], -dir[1]] : dir, invert };
      }
    },
  };
}
/* ---- secondary objects: give the modifiers a concrete use ---- */
// a mirror surface reacts to nothing, but each orientation acts as a 90° corner
// reflector connecting 2 of the 4 cardinal directions: a ray entering one open face
// exits the other with its remaining range; a closed face just blocks.
// direction codes: 0=up, 1=down, 2=left, 3=right (see DIRS4 in world-zones.js)
// indexed by the orientation code the map already stores (0=NE, 1=ES, 2=SW, 3=WN)
export const MIRROR_REFLECT = [
  { 1: 3, 2: 0 },
  { 2: 1, 0: 3 },
  { 0: 2, 3: 1 },
  { 3: 0, 1: 2 },
];
export function createMirrorSurface(orientation) {
  return {
    type: 'mirror_surface',
    orientation: orientation ?? 0,
    blocksMovement: true,
    reactTo() {},
  };
}
export function isPairResolved(pair) {
  // a plate is only "touched" persistently — a crate actually weighing it down (via
  // the push-slide/switch paths above), never merely by a spell passing over its tile
  let totalMembers = 0,
    weighedMembers = 0;
  plateByTile.forEach(plate => {
    if (plate.pair === pair) {
      totalMembers++;
      if (plate.weighed) weighedMembers++;
    }
  });
  return totalMembers > 0 && weighedMembers >= totalMembers;
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
