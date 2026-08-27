/* ============ Player & camera ============ */
import { COLORS, WHITE } from './colors.js';
import { gameState } from './engine-core.js';
import {
  DIRS4,
  HUB,
  ZONES,
  beginAction,
  doUndo,
  grid,
  isBlockingFor,
  key,
  track,
} from '../world/world-zones.js';
import { collected, items, primitiveSpots } from '../world/map-loader.js';
import { startColorWave } from '../render/render-world.js';
import { playPickup } from './music.js';

export const player = {
  x: HUB.cx,
  y: HUB.cy,
  dispX: HUB.cx,
  dispY: HUB.cy,
  facing: 3, // 0=up, 1=down, 2=left, 3=right (see DIRS4 in world-zones.js)
  visualFacing: 3, // sprite-only facing, see dirStack below — stabler than `facing` when moving diagonally
  flip: 1, // -1 when last facing left, 1 otherwise — see drawPlayer
};
export let screenFlash = null;
function flashScreen(color, dur) {
  screenFlash = { color, until: performance.now() + dur };
}
export const collectedItems = new Set(); // "zoneId:x,y" of already-collected spots
export const totalItems = items.length;
export let hubActivated = false;
// snapshots the player's tile so undo can restore it later — used by doMove
// below and by ui-panel.js's castPhrase (the Switch modifier's teleport)
export function snapPos() {
  const px = player.x,
    py = player.y;
  track(() => ((player.x = px), (player.y = py)));
}
const keysDown = {};
// keyed by e.code (physical key position) so WASD/ZQSD work regardless of keyboard
// layout, same trick as DIGIT_CODES in ui-panel.js
const KEY_MAP = {
  ArrowUp: 0,
  ArrowDown: 1,
  ArrowLeft: 2,
  ArrowRight: 3,
  KeyW: 0,
  KeyS: 1,
  KeyA: 2,
  KeyD: 3,
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
  // longer than a tap so a brief press can't trigger a second step
  repeatTimers[dir] = setTimeout(function tick() {
    if (keysDown[dir]) {
      doMove(dir);
      repeatTimers[dir] = setTimeout(tick, 95);
    }
  }, 240);
}

// tracks key press order so visualFacing sticks to the most recent direction
// instead of flickering when two perpendicular keys are held together
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
  dirStack = dirStack.filter(entry => entry !== dir);
  if (dirStack.length) player.visualFacing = dirStack[dirStack.length - 1];
}
window.addEventListener('keydown', e => {
  /*BUILD:DEV_ONLY_START*/
  // DEBUG: unlocks all 4 runes — dev-server only, stripped from the real build
  if (e.key === '0') {
    ZONES.forEach(zone => collected.add(zone.id));
    return;
  }
  /*BUILD:DEV_ONLY_END*/
  if (e.code === 'KeyB') {
    if (gameState === 'playing') doUndo();
    return;
  }
  const dir = KEY_MAP[e.code];
  if (dir === undefined) return;
  e.preventDefault();
  if (gameState === 'playing') pressDir(dir);
});
window.addEventListener('keyup', e => {
  const dir = KEY_MAP[e.code];
  if (dir === undefined) return;
  releaseDir(dir);
});

// logical movement is instant; dispX/dispY animate toward it separately
function doMove(dir) {
  const [dx, dy] = DIRS4[dir];
  const targetX = player.x + dx,
    targetY = player.y + dy;
  player.facing = dir;

  const targetCell = grid.get(key(targetX, targetY));
  if (!targetCell) return;
  if (isBlockingFor(targetX, targetY)) return;
  beginAction();
  snapPos();
  player.x = targetX;
  player.y = targetY;
  // item/rune pickups and hub activation are one-way progress, not puzzle state, so
  // they're left out of the undo log (walking back onto a collected spot is a no-op)
  ZONES.forEach(zone => {
    const spot = primitiveSpots[zone.id];
    if (!spot.collected && targetX === spot.x && targetY === spot.y) {
      spot.collected = true;
      collected.add(zone.id);
      startColorWave(zone.id, spot.x, spot.y);
      flashScreen(COLORS.PINK_GLOW, 500);
    }
  });

  items.forEach(item => {
    const spotKey = item.zoneId + ':' + item.x + ',' + item.y;
    if (!collectedItems.has(spotKey) && targetX === item.x && targetY === item.y) {
      collectedItems.add(spotKey);
      startColorWave('h', HUB.cx, HUB.cy);
      flashScreen(COLORS.PINK_GLOW, 500);
      playPickup();
    }
  });

  if (
    !hubActivated &&
    collectedItems.size >= totalItems &&
    totalItems > 0 &&
    targetX === HUB.cx &&
    targetY === HUB.cy
  ) {
    hubActivated = true;
    flashScreen(WHITE, 900);
  }
}
