/* ============ Player & camera ============ */
import { COLORS } from './colors.js';
import { gameState } from './engine-core.js';
import { DIRS4, HUB, ZONES, grid, key, objectsMap } from '../world/world-zones.js';
import { collected, items, primitiveSpots } from '../world/map-loader.js';
import { startColorWave } from '../render/render-world.js';
import { playPickup } from './music.js';

export const player = {
  x: HUB.cx,
  y: HUB.cy,
  dispX: HUB.cx,
  dispY: HUB.cy,
  facing: 'right',
  visualFacing: 'right', // sprite-only facing, see dirStack below — stabler than `facing` when moving diagonally
  flip: 1, // -1 when last facing left, 1 otherwise — see drawPlayer
};
export let screenFlash = null;
export const collectedItems = new Set(); // "zoneId:x,y" of already-collected spots
export const totalItems = items.length;
export let hubActivated = false;
const keysDown = {};
// keyed by e.code (the key's physical position, not the character produced) so
// WASD on QWERTY and ZQSD on AZERTY — same physical keys — both work from one
// map, with no separate character list per layout (same trick DIGIT_CODES uses
// for the rune keys in ui-panel.js)
const KEY_MAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const repeatTimers = {};
function clearRepeat(dir) {
  if (repeatTimers[dir]) {
    clearTimeout(repeatTimers[dir]);
    repeatTimers[dir] = null;
  }
}
function startRepeat(dir) {
  clearRepeat(dir);
  // deliberately longer than a normal tap so a brief press doesn't trigger a second
  // step (was the cause of "double movement")
  repeatTimers[dir] = setTimeout(function tick() {
    if (keysDown[dir]) {
      doMove(dir);
      repeatTimers[dir] = setTimeout(tick, 95);
    }
  }, 240);
}

// two perpendicular keys held together still step independently (true diagonal
// movement), but that used to make the sprite flicker between both facings every
// step. dirStack tracks press order and drives visualFacing instead, only changing
// when the currently-shown direction's key is released — so it holds steady on
// whichever was pressed more recently.
let dirStack = [];

function pressDir(dir) {
  if (!keysDown[dir]) {
    keysDown[dir] = true;
    dirStack.push(dir);
    player.visualFacing = dir;
    doMove(dir);
    startRepeat(dir);
  }
}
function releaseDir(dir) {
  keysDown[dir] = false;
  clearRepeat(dir);
  dirStack = dirStack.filter(d => d !== dir);
  if (dirStack.length) player.visualFacing = dirStack[dirStack.length - 1];
}
window.addEventListener('keydown', e => {
  // DEBUG: unlocks all 4 runes instantly for testing spell combos — remove before submission
  if (e.key === '0') {
    ZONES.forEach(z => collected.add(z.id));
    return;
  }
  const dir = KEY_MAP[e.code];
  if (!dir) return;
  e.preventDefault();
  if (gameState === 'playing') pressDir(dir);
});
window.addEventListener('keyup', e => {
  const dir = KEY_MAP[e.code];
  if (!dir) return;
  releaseDir(dir);
});


// instant logical movement: never blocked, never a lost keypress.
// visual tracking (dispX/dispY) is a separate animation that catches up independently.
function doMove(dir) {
  const [dx, dy] = DIRS4[dir];
  const tx = player.x + dx,
    ty = player.y + dy;
  player.facing = dir; // always look in the last direction taken, even if the step fails

  const targetCell = grid.get(key(tx, ty));
  if (!targetCell) return; // rock: impassable
  const blockingObj = objectsMap.get(key(tx, ty));
  if (blockingObj && blockingObj.blocksMovement) return; // an interactive object still blocks the path
  player.x = tx;
  player.y = ty;
  // collects the primitive if we arrive on its zone's pedestal
  ZONES.forEach(z => {
    const spot = primitiveSpots[z.id];
    if (!spot.collected && tx === spot.x && ty === spot.y) {
      spot.collected = true;
      collected.add(z.id);
      startColorWave(z.id, spot.x, spot.y); // color spreads out from the pedestal where the rune was gathered
      screenFlash = { color: COLORS.PINK_GLOW, until: performance.now() + 500 };
    }
  });

  // picking up an item (only once unlocked)
  items.forEach(p => {
    const spotKey = p.zoneId + ':' + p.x + ',' + p.y;
    if (!collectedItems.has(spotKey) && tx === p.x && ty === p.y) {
      collectedItems.add(spotKey);
      startColorWave('hub', HUB.cx, HUB.cy); // and from the altar, a little more with each item
      screenFlash = { color: COLORS.PINK_GLOW, until: performance.now() + 500 };
      playPickup();
    }
  });

  // hub altar: once all objects are collected, activates by walking onto it
  if (
    !hubActivated &&
    collectedItems.size >= totalItems &&
    totalItems > 0 &&
    tx === HUB.cx &&
    ty === HUB.cy
  ) {
    hubActivated = true;
    screenFlash = { color: '#ffffff', until: performance.now() + 900 };
  }
}
