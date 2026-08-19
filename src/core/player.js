/* ============ Player & camera ============ */
import { COLORS } from './colors.js';
import { gameState } from './engine-core.js';
import { DIRS4, HUB, ZONES, grid, key, objectsMap } from '../world/world-zones.js';
import { collected, items, primitiveSpots } from '../world/map-loader.js';
import { ctx, startColorWave } from '../render/render-world.js';
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
const KEY_MAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
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
  const dir = KEY_MAP[e.key];
  if (!dir) return;
  e.preventDefault();
  if (gameState === 'playing') pressDir(dir);
});
window.addEventListener('keyup', e => {
  const dir = KEY_MAP[e.key];
  if (!dir) return;
  releaseDir(dir);
});

// touch: drag anywhere on the canvas to move, like holding an arrow key in that
// direction — reuses the same grid-step + repeat logic as the keyboard
let touchId = null,
  touchDir = null,
  touchBaseX = 0,
  touchBaseY = 0,
  touchCurX = 0,
  touchCurY = 0;
const TOUCH_DEADZONE = 14;
function dirFromDelta(dx, dy) {
  if (Math.abs(dx) < TOUCH_DEADZONE && Math.abs(dy) < TOUCH_DEADZONE) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}
function endTouch(e) {
  if (e.pointerId !== touchId) return;
  if (touchDir) releaseDir(touchDir);
  touchId = touchDir = null;
}
// canvas isn't declared yet at this point in load order, so grab the element directly
const gameEl = document.getElementById('game');
gameEl.addEventListener('pointerdown', e => {
  if (gameState !== 'playing' || e.pointerType !== 'touch') return;
  touchId = e.pointerId;
  touchBaseX = touchCurX = e.clientX;
  touchBaseY = touchCurY = e.clientY;
  touchDir = null;
});
gameEl.addEventListener('pointermove', e => {
  if (e.pointerId !== touchId) return;
  touchCurX = e.clientX;
  touchCurY = e.clientY;
  const dir = dirFromDelta(touchCurX - touchBaseX, touchCurY - touchBaseY);
  if (dir !== touchDir) {
    if (touchDir) releaseDir(touchDir);
    touchDir = dir;
    if (touchDir) pressDir(touchDir);
  }
});
gameEl.addEventListener('pointerup', endTouch);
gameEl.addEventListener('pointercancel', endTouch);

// minimal on-screen feedback: a dot under the finger while dragging, pink once a direction latches
export function drawTouchStick() {
  if (touchId === null) return;
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = touchDir ? COLORS.PINK_UI : '#e8e4da';
  ctx.beginPath();
  ctx.arc(touchCurX, touchCurY, 20, 0, 7);
  ctx.fill();
  ctx.restore();
}

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
