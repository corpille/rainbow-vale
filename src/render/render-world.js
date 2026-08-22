/* ============ Canvas setup, per-tile bitmap cache, interactive-object shapes ============ */
import { COLORS, VIOLET, WHITE } from '../core/colors.js';
import {
  BASE_TILE,
  BLOB_SETS,
  TILE,
  // only ever reassigned here (resizeCanvas); drawWorldTiles in render-scene.js does
  // the actual reading, hence the unused-vars warning
  VIEW_COLS, // eslint-disable-line no-unused-vars
  VIEW_ROWS, // eslint-disable-line no-unused-vars
  fillCircle,
  fillEllipse,
  gemPath,
  radialFade,
  starPath,
  strokeCircle,
  textureFill,
  tileAO,
} from '../core/engine-core.js';
import { CARDINAL_OFFSETS, grid, key, puddleEpoch, roomById, unkey } from '../world/world-zones.js';
import { collected, decorInstances, obstacles } from '../world/map-loader.js';
// player.js imports ctx/startColorWave from this file — a genuine but harmless import
// cycle. resizeCanvas() below only reaches these via grayFilter inside
// generateTileVariants(), and by then player.js has already declared both (JS_ORDER,
// the real runtime authority once build.js concatenates, lists player.js first).
import { collectedItems, totalItems } from '../core/player.js';

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');
// 3 floor + 3 wall bitmaps per room, see generateTileVariants. Declared before the first
// resizeCanvas() call below, since that call can trigger generateTileVariants() synchronously.
let tileVariants = {};
// All 5 decor drawFns grow upward from a ground point at (0,0), so the canvas is anchored
// near its bottom (DECOR_ANCHOR_Y from the top) instead of centered. Sized for the tallest
// sprite — drawBloomTreeBig reaches 75px up / 22px down, way more than the others (~30px
// either way).
export const DECOR_BITMAP_SIZE = 90; // width
export const DECOR_BITMAP_HEIGHT = 108;
export const DECOR_ANCHOR_Y = 80;
// viewport culling: true once a point (plus a tile of padding) falls outside the visible canvas
export function offscreen(px, py, pad = TILE) {
  return px < -pad || py < -pad || px > canvas.width + pad || py > canvas.height + pad;
}

// BASE_TILE (42px) was tuned for a 1080px viewport; scaling it by the current viewport's
// shorter side keeps the amount of world visible consistent across phone/1080p/4K
const REF_MIN_DIM = 500; // lower = bigger TILE = camera feels closer to the player
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const newTile = Math.max(
    16,
    Math.round((BASE_TILE * Math.min(canvas.width, canvas.height)) / REF_MIN_DIM)
  );
  const tileChanged = newTile !== TILE;
  // declared `let` in engine-core.js so this file can reassign on resize — imports are
  // technically read-only, but build.js strips import/export before concatenating, so at
  // runtime it's just a plain global assignment.
  TILE = newTile; // eslint-disable-line no-import-assign
  VIEW_COLS = Math.ceil(canvas.width / TILE); // eslint-disable-line no-import-assign
  VIEW_ROWS = Math.ceil(canvas.height / TILE); // eslint-disable-line no-import-assign
  // cheap (~30 small bitmaps, not the whole map), so a resize can redo it directly
  // instead of debouncing or chunking the way a full-map rebuild would need
  if (tileChanged) generateTileVariants();
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

/* ============ Tile variants: 3 floor + 3 wall bitmaps per room, pre-rendered once.
   The per-frame loop below just blits a variant by tile position. ============ */

// the mirror surface and the lock's crystal both use this same amethyst-to-violet
// gradient, just aimed along a different line each time
function gemGradient(x0, y0, x1, y1) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, '#e8a8f0');
  gradient.addColorStop(1, VIOLET);
  return gradient;
}

function renderVine(obj, px, py) {
  ctx.save();
  ctx.strokeStyle = '#4caf6b';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px - BASE_TILE * 0.3, py + BASE_TILE * 0.35);
  ctx.quadraticCurveTo(px, py, px + BASE_TILE * 0.25, py - BASE_TILE * 0.35);
  ctx.stroke();
  ctx.fillStyle = '#7fd99a';
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    const lx = px - BASE_TILE * 0.3 + t * BASE_TILE * 0.55,
      ly = py + BASE_TILE * 0.35 - t * BASE_TILE * 0.7;
    fillEllipse(ctx, lx, ly, 4, 7, 0.3);
  }
  ctx.restore();
}

// ice look — fully opaque, so the floor tile underneath is skipped entirely rather than
// drawn and then covered (see drawWorldTiles). The liquid "water" state is animated
// separately, see renderPonds below, since it needs to shimmer/drift as a shared pond.
export function renderPuddle(ctx, px, py) {
  ctx.save();
  const grad = ctx.createLinearGradient(
    px - BASE_TILE * 0.5,
    py - BASE_TILE * 0.5,
    px + BASE_TILE * 0.5,
    py + BASE_TILE * 0.5
  );
  grad.addColorStop(0, WHITE);
  grad.addColorStop(1, '#bfe0ff');
  ctx.fillStyle = grad;
  ctx.fillRect(px - BASE_TILE * 0.5, py - BASE_TILE * 0.5, BASE_TILE, BASE_TILE);
  ctx.strokeStyle = '#ffffff80';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const oy = py + (i - 1) * BASE_TILE * 0.25;
    ctx.beginPath();
    ctx.moveTo(px - BASE_TILE * 0.4, oy);
    ctx.quadraticCurveTo(px, oy + (i % 2 ? 3 : -3), px + BASE_TILE * 0.4, oy);
    ctx.stroke();
  }
  ctx.restore();
}

// flood-fills connected water tiles into one shared pond: one fill call and a handful
// of ripples/sparkles scaled to the pond's size, instead of a full set per tile.
// Rebuilt only when a puddle's state actually changes (puddleEpoch), not every frame.
let pondGroups = [];
let pondGroupsEpoch = -1;
function computePondGroups() {
  pondGroups = [];
  const visited = new Set();
  grid.forEach((cell, tileKey) => {
    if (cell.type !== 'water' || visited.has(tileKey)) return;
    const tiles = [];
    const stack = [tileKey];
    visited.add(tileKey);
    while (stack.length) {
      const currentKey = stack.pop();
      const [tileX, tileY] = unkey(currentKey);
      tiles.push({ x: tileX, y: tileY });
      CARDINAL_OFFSETS.forEach(([dx, dy]) => {
        const neighborKey = key(tileX + dx, tileY + dy);
        if (visited.has(neighborKey)) return;
        const neighborCell = grid.get(neighborKey);
        if (neighborCell && neighborCell.type === 'water') {
          visited.add(neighborKey);
          stack.push(neighborKey);
        }
      });
    }
    // ripples and sparkles both scaled to the pond's size (capped) and placed off an
    // anchor tile's own coordinates, so positions/phases stay stable across rebuilds
    // without needing a stored RNG seed
    const tileCount = tiles.length;
    const ripples = [];
    for (let i = 0; i < Math.min(3, 1 + Math.floor(tileCount / 8)); i++) {
      ripples.push(tiles[(i * 11 + 5) % tileCount]);
    }
    const sparkles = [];
    for (let i = 0; i < Math.min(10, 3 + Math.floor(tileCount / 3)); i++) {
      const tile = tiles[(i * 7 + 3) % tileCount];
      const hash1 = Math.abs(Math.sin(tile.x * 12.9898 + tile.y * 78.233 + i * 37.1));
      const hash2 = Math.abs(Math.sin(hash1 * 6180.5 + i));
      sparkles.push({
        x: tile.x,
        y: tile.y,
        ox: (hash1 - 0.5) * BASE_TILE * 0.7,
        oy: (hash2 - 0.5) * BASE_TILE * 0.7,
        r: 1 + hash1 * 0.7,
        phase: hash2 * Math.PI * 6,
      });
    }
    pondGroups.push({ tiles, ripples, sparkles });
  });
}
// draws every currently-'water' pond as one shared sheet — see computePondGroups
export function renderPonds(originPxX, originPxY) {
  if (puddleEpoch !== pondGroupsEpoch) {
    computePondGroups();
    pondGroupsEpoch = puddleEpoch;
  }
  const t = performance.now();
  const scale = TILE / BASE_TILE;
  const half = TILE / 2;
  pondGroups.forEach(group => {
    // fixed blue-violet, never keyed by position or time, so the pool reads as one sheet.
    // Opaque since water skips its floor tile entirely (see drawWorldTiles)
    ctx.save();
    ctx.fillStyle = 'hsl(220, 35%, 75%)';
    ctx.beginPath();
    group.tiles.forEach(({ x, y }) =>
      ctx.rect(originPxX + x * TILE, originPxY + y * TILE, TILE, TILE)
    );
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#ffffff90';
    ctx.lineWidth = 1.3 * scale;
    group.ripples.forEach((ripple, i) => {
      const px = originPxX + ripple.x * TILE + half,
        py = originPxY + ripple.y * TILE + half;
      ctx.beginPath();
      ctx.moveTo(px - half, py);
      ctx.quadraticCurveTo(px, py + Math.sin(t / 800 + i * 2) * 3 * scale, px + half, py);
      ctx.stroke();
    });
    ctx.restore();

    // whimsical twinkles, drifting slowly upward
    group.sparkles.forEach(sparkle => {
      const baseX = originPxX + sparkle.x * TILE + half + sparkle.ox * scale,
        baseY = originPxY + sparkle.y * TILE + half;
      const yy = ((((sparkle.oy * scale + half - t / 90) % TILE) + TILE) % TILE) - half;
      const alpha = 0.55 + Math.sin(sparkle.phase + t / 380) * 0.35;
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, alpha);
      ctx.fillStyle = '#fff9ff';
      starPath(ctx, baseX, baseY + yy, sparkle.r * 2.3 * scale, 4, 0.3);
      ctx.fill();
      ctx.restore();
    });
  });
}

// a pushable gift box, not a plain crate — ribbon + bow sell the theme at a glance,
// still readable at small scale
function renderCrate(obj, px, py) {
  const half = BASE_TILE * 0.32;
  ctx.save();
  const grad = ctx.createLinearGradient(px - half, py - half, px + half, py + half);
  grad.addColorStop(0, obj.frozen ? '#cfe9ff' : '#c9a0f0');
  grad.addColorStop(1, obj.frozen ? '#7fb8e0' : '#8a5ad0');
  ctx.fillStyle = grad;
  ctx.strokeStyle = obj.frozen ? COLORS.ICE_BLUE : COLORS.PINK_WARM;
  ctx.lineWidth = 2;
  ctx.shadowColor = obj.frozen ? COLORS.ICE_BLUE : COLORS.PINK_WARM;
  ctx.shadowBlur = 6;
  ctx.fillRect(px - half, py - half, half * 2, half * 2);
  ctx.strokeRect(px - half, py - half, half * 2, half * 2);
  ctx.restore();
  ctx.save();
  const ribbon = obj.frozen ? WHITE : COLORS.PINK;
  ctx.strokeStyle = ribbon;
  ctx.lineWidth = half * 0.28;
  ctx.beginPath();
  ctx.moveTo(px - half, py);
  ctx.lineTo(px + half, py);
  ctx.moveTo(px, py - half);
  ctx.lineTo(px, py + half);
  ctx.stroke();
  ctx.fillStyle = ribbon;
  fillCircle(ctx, px - half * 0.35, py - half * 1.05, half * 0.32);
  fillCircle(ctx, px + half * 0.35, py - half * 1.05, half * 0.32);
  ctx.restore();
}

// corner each orientation occupies, matching MIRROR_REFLECT in world-objects.js: NE/SW
// bounce along a "\" line, ES/WN along a "/" line, clipped into the named corner
const MIRROR_CORNER = { NE: [1, -1], SW: [-1, 1], ES: [1, 1], WN: [-1, -1] };
function renderMirror(px, py, orientation) {
  const [sxs0, sys0] = MIRROR_CORNER[orientation] || MIRROR_CORNER.NE;
  // solid glass fills the FAR corner (plus its two edge-adjacent corners), leaving
  // the named corner open — inverted from MIRROR_CORNER's own named corner
  const sxs = -sxs0,
    sys = -sys0;
  const half = BASE_TILE * 0.5;
  // half the tile split along the true diagonal: named corner + its two edge-adjacent
  // corners is the solid side, the hypotenuse is the reflecting surface, far corner open
  const cornerX = px + sxs * half,
    cornerY = py + sys * half;
  const p1x = px - sxs * half,
    p1y = cornerY;
  const p2x = cornerX,
    p2y = py - sys * half;
  ctx.save();
  ctx.fillStyle = gemGradient(p1x, p1y, p2x, p2y);
  ctx.beginPath();
  ctx.moveTo(cornerX, cornerY);
  ctx.lineTo(p1x, p1y);
  ctx.lineTo(p2x, p2y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.ICE_BLUE;
  ctx.lineWidth = 2;
  ctx.shadowColor = COLORS.ICE_BLUE;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(p1x, p1y);
  ctx.lineTo(p2x, p2y);
  ctx.stroke();
  ctx.restore();
}

// a corroded wall's crack: a jagged line hinting it'll shatter the next time a crate
// rams into it. Drawn directly in tile-pixel space rather than baked into the room's
// variant bitmaps, since cracked is a per-tile toggle (obstacleByTile), not room-wide
export function drawWallCrack(destX, destY) {
  const cx = destX + TILE / 2,
    cy = destY + TILE / 2,
    s = TILE * 0.28;
  ctx.save();
  ctx.strokeStyle = '#00000090';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s * 1.2);
  ctx.lineTo(cx - s * 0.2, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.6, cy + s * 0.3);
  ctx.lineTo(cx + s * 0.3, cy + s * 1.1);
  ctx.stroke();
  ctx.restore();
}

// a glowing crystal set in a rune-ring seal, not prison bars — hairline cracks hint
// it's meant to shatter, and it vanishes once the paired plates satisfy the lock
function renderLockGate(px, py) {
  const t = performance.now();
  const pulse = Math.sin(t / 500);
  ctx.save();
  ctx.fillStyle = radialFade(ctx, px, py, BASE_TILE * 0.5, COLORS.PURPLE + '55');
  fillCircle(ctx, px, py, BASE_TILE * 0.5);
  ctx.restore();
  // rune ring: a solid outer band plus a dashed inner one, like a seal of light
  ctx.save();
  ctx.strokeStyle = '#f7e9c9';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  strokeCircle(ctx, px, py, BASE_TILE * 0.4);
  ctx.setLineDash([4, 5]);
  strokeCircle(ctx, px, py, BASE_TILE * 0.33);
  ctx.restore();
  // sparkles slowly orbiting the ring
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + t / 1400;
    const sparkleX = px + Math.cos(angle) * BASE_TILE * 0.4,
      sparkleY = py + Math.sin(angle) * BASE_TILE * 0.4;
    ctx.save();
    ctx.fillStyle = '#fff6d8';
    starPath(ctx, sparkleX, sparkleY, 3.4, 4, 0.3);
    ctx.fill();
    ctx.restore();
  }
  // the crystal itself
  ctx.save();
  ctx.shadowColor = COLORS.ICE_BLUE;
  ctx.shadowBlur = 12 + pulse * 4;
  ctx.fillStyle = gemGradient(
    px - BASE_TILE * 0.18,
    py - BASE_TILE * 0.18,
    px + BASE_TILE * 0.18,
    py + BASE_TILE * 0.22
  );
  gemPath(ctx, px, py, BASE_TILE * 0.21);
  ctx.fill();
  ctx.strokeStyle = '#ffffffaa';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
  // hairline cracks hinting at the shatter — scaled to the crystal's own radius
  // (BASE_TILE * 0.21 from gemPath above) so they stay inside the gem, not poking past it
  ctx.save();
  ctx.strokeStyle = '#ffffff70';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px - 2, py - 5);
  ctx.lineTo(px + 1.5, py - 0.5);
  ctx.lineTo(px - 2.5, py + 4.5);
  ctx.moveTo(px + 1.5, py - 0.5);
  ctx.lineTo(px + 5, py + 2);
  ctx.stroke();
  ctx.restore();
}

// the 4 interactive objects: rendered dynamically (never frozen into the world cache),
// one signature color per type to stay recognizable at a glance
export function renderInteractiveObject(obj, x, y, originPxX, originPxY) {
  const px = originPxX + x * TILE + TILE / 2,
    py = originPxY + y * TILE + TILE / 2;
  if (offscreen(px, py)) return;
  // drawn in BASE_TILE-pixel units, relative to (0,0) — scale+translate once here
  // instead of tying every shape's numbers to the current (viewport-scaled) TILE
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(TILE / BASE_TILE, TILE / BASE_TILE);
  if (obj.type === 'vine') {
    if (!obj.destroyed) renderVine(obj, 0, 0);
  } else if (obj.type === 'crate') {
    renderCrate(obj, 0, 0);
  } else if (obj.type === 'mirror_surface') {
    renderMirror(0, 0, obj.orientation);
    // sym_plate renders separately (plateByTile loop in draw()) so it stays visible
    // under a crate weighing it down in the same tile slot
  } else if (obj.type === 'lock') {
    if (!obj.open) renderLockGate(0, 0);
  }
  ctx.restore(); // matches the outer translate/scale
}

// the vale starts colorless: a zone renders gray until its rune is collected; the hub
// fades in gradually as returned items raise collectedItems/totalItems. One canvas
// filter covers the whole tile paint — floor, puddle, scar, decor — instead of
// hand-blending each color drawn onto it
function grayFilter(roomId) {
  const maxGray = 0.9;
  const t =
    roomId === 'h'
      ? totalItems > 0
        ? collectedItems.size / totalItems
        : maxGray
      : collected.has(roomId)
        ? maxGray
        : 0;
  return t >= maxGray ? 'none' : 'grayscale(' + (maxGray - t) + ')';
}

// 3 floor + 3 wall bitmaps per room, baked once (or once per resize, since it's tied to
// TILE's pixel size). AO is baked in too (doesn't depend on neighbors); wall borders
// can't be — which edges get one depends on neighboring tiles, so those are drawn
// dynamically per visible tile, see drawWorldTiles below.
//
// Gray/color state is baked in here too rather than a live per-frame ctx.filter, since
// a non-'none' canvas filter is much slower and a room's gray level only changes at
// rare discrete moments (rune collected, item returned) — see bakeRoomVariants/player.js.
export function generateTileVariants() {
  tileVariants = {};
  Object.keys(roomById).forEach(bakeRoomVariants);
}
// decor (flowers, mushrooms, crystals, ...) is baked into a small per-instance bitmap,
// same gray/color filter and rare rebake-on-event approach as floor/wall. Baked at the
// CURRENT TILE resolution, not a fixed size — stretching a fixed-size bake at draw
// time would look soft/blocky whenever TILE != BASE_TILE.
function bakeDecorBitmap(decorInstance, filter) {
  const scale = TILE / BASE_TILE;
  const w = Math.round(DECOR_BITMAP_SIZE * scale);
  const h = Math.round(DECOR_BITMAP_HEIGHT * scale);
  const canvasEl = document.createElement('canvas');
  canvasEl.width = w;
  canvasEl.height = h;
  const dctx = canvasEl.getContext('2d');
  dctx.filter = filter;
  dctx.translate(w / 2, DECOR_ANCHOR_Y * scale);
  dctx.scale(scale, scale);
  decorInstance.drawFn(dctx, 0, 0, decorInstance.seed);
  return canvasEl;
}
function bakeRoomVariants(roomId) {
  const room = roomById[roomId];
  const filter = grayFilter(roomId);
  const floor = [],
    wall = [];
  for (let variant = 0; variant < BLOB_SETS.length; variant++) {
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = floorCanvas.height = TILE;
    const floorCtx = floorCanvas.getContext('2d');
    floorCtx.filter = filter;
    textureFill(floorCtx, 0, 0, TILE, TILE, room.base, room.dark, room.blob, BLOB_SETS[variant]);
    tileAO(floorCtx, 0, 0);
    floor.push(floorCanvas);

    const wallCanvas = document.createElement('canvas');
    wallCanvas.width = wallCanvas.height = TILE;
    const wallCtx = wallCanvas.getContext('2d');
    wallCtx.filter = filter;
    textureFill(
      wallCtx,
      0,
      0,
      TILE,
      TILE,
      room.dark,
      COLORS.NEAR_BLACK,
      room.blob,
      BLOB_SETS[variant]
    );
    wall.push(wallCanvas);
  }
  tileVariants[roomId] = { floor, wall };
  decorInstances.forEach(decorInstance => {
    if (decorInstance.roomId === roomId)
      decorInstance.bitmap = bakeDecorBitmap(decorInstance, filter);
  });
}

// active per-room color reveals: roomId -> { originX, originY, start, maxD, oldFloor, oldWall }.
// Keeps the previous ("before") bitmap set around for ~900ms next to the freshly-baked
// ("after") one in tileVariants; drawWorldTiles picks per-tile by distance from the
// origin, giving a wave-outward reveal.
const activeWaves = {};
export function startColorWave(roomId, originX, originY) {
  const oldFloor = tileVariants[roomId].floor,
    oldWall = tileVariants[roomId].wall;
  // stash each decor instance's "before" bitmap too, since bakeRoomVariants below is
  // about to overwrite its bitmap with the "after" one
  decorInstances.forEach(decorInstance => {
    if (decorInstance.roomId === roomId) decorInstance.oldBitmap = decorInstance.bitmap;
  });
  bakeRoomVariants(roomId); // tileVariants[roomId] now holds the "after" bitmaps
  let maxD = 1;
  grid.forEach((cell, tileKey) => {
    if (cell.roomId === roomId) {
      const [x, y] = unkey(tileKey);
      maxD = Math.max(maxD, Math.hypot(x - originX, y - originY));
    }
  });
  obstacles.forEach(obstacle => {
    if (obstacle.roomId === roomId)
      maxD = Math.max(maxD, Math.hypot(obstacle.x - originX, obstacle.y - originY));
  });
  activeWaves[roomId] = { originX, originY, start: performance.now(), maxD, oldFloor, oldWall };
}
// which of the 3 variants a tile uses — a cheap position-keyed pick, not per-tile
// randomness, so it's stable but doesn't look like a repeating grid
export function tileVariantIndex(x, y) {
  return Math.abs(x * 7 + y * 13) % BLOB_SETS.length;
}
// true once enough time has passed, by distance from the wave's origin, to show the
// "after" state — same staggered, spreading-outward reveal used for tile and decor
// bitmaps (see drawWorldTiles)
export function waveRevealed(roomId, x, y) {
  const wave = activeWaves[roomId];
  if (!wave) return true;
  const elapsed = performance.now() - wave.start;
  if (elapsed >= 900) {
    delete activeWaves[roomId];
    return true;
  }
  const dist = Math.hypot(x - wave.originX, y - wave.originY);
  return elapsed >= (dist / wave.maxD) * 900;
}
// bitmap set a tile draws from: normally tileVariants[roomId], but during an active
// wave (startColorWave) it keeps drawing the "before" set until waveRevealed flips it
export function variantSetFor(roomId, x, y) {
  const wave = activeWaves[roomId];
  if (!wave || waveRevealed(roomId, x, y)) return tileVariants[roomId];
  return { floor: wave.oldFloor, wall: wave.oldWall };
}
