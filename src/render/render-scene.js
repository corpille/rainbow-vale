/* ============ Per-frame scene draw: tiles, highlights, interactive objects, markers ============ */
import { COLORS, UI_LIGHT, WHITE } from '../core/colors.js';
import {
  BASE_TILE,
  TILE,
  VIEW_COLS,
  VIEW_ROWS,
  fillCircle,
  fillEllipse,
  iconGlyph,
  radialFade,
  starPath,
  strokeCircle,
} from '../core/engine-core.js';
import { HUB, ZONES, grid, key, objectsMap, unkey } from '../world/world-zones.js';
import { computeSpellPreview } from '../world/world-objects.js';
import {
  collected,
  decorByTile,
  doors,
  items,
  obstacleByTile,
  plateByTile,
  primitiveSpots,
} from '../world/map-loader.js';
import { collectedItems, hubActivated, player, totalItems } from '../core/player.js';
// lastCast (ui-panel.js) is reassigned below too (drawCastHighlight) — same
// import-is-really-a-global caveat as above.
import { RUNE_ACCENT, RUNE_SHAPE, lastCast, phraseRunes } from '../core/ui-panel.js';
import {
  DECOR_ANCHOR_Y,
  DECOR_BITMAP_HEIGHT,
  DECOR_BITMAP_SIZE,
  canvas,
  ctx,
  drawWallCrack,
  offscreen,
  renderInteractiveObject,
  renderPuddle,
  tileVariantIndex,
  variantSetFor,
  waveRevealed,
} from './render-world.js';

// draws only tiles in the viewport: a pre-rendered variant blit (gray/color state
// already baked in, see bakeRoomVariants) for plain floor, or a per-tile draw for
// anything that isn't ('ice' — see below — and wall borders, which depend on neighbors)
export function drawWorldTiles(originPxX, originPxY, camX, camY) {
  const colsHalf = Math.ceil(VIEW_COLS / 2) + 1,
    rowsHalf = Math.ceil(VIEW_ROWS / 2) + 1;
  const x0 = Math.floor(camX - colsHalf),
    x1 = Math.ceil(camX + colsHalf);
  const y0 = Math.floor(camY - rowsHalf),
    y1 = Math.ceil(camY + rowsHalf);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const destX = Math.round(originPxX + x * TILE),
        destY = Math.round(originPxY + y * TILE);
      const cell = grid.get(key(x, y));
      const variant = tileVariantIndex(x, y);

      if (!cell) {
        const obstacle = obstacleByTile.get(key(x, y));
        if (!obstacle) continue; // true void — the sky-blue background shows through
        ctx.drawImage(variantSetFor(obstacle.roomId, x, y).wall[variant], destX, destY, TILE, TILE);
        if (obstacle.cracked) drawWallCrack(destX, destY);
        // only draw edges facing a non-obstacle tile, else adjacent walls double-draw
        // their shared edge as a double line. [dx, dy, vertical, offset] per edge
        ctx.save();
        ctx.strokeStyle = '#00000080';
        ctx.lineWidth = 2;
        ctx.beginPath();
        [
          [0, -1, 0, 1],
          [0, 1, 0, TILE - 1],
          [-1, 0, 1, 1],
          [1, 0, 1, TILE - 1],
        ].forEach(([dx, dy, vertical, off]) => {
          if (obstacleByTile.has(key(x + dx, y + dy))) return;
          if (vertical) {
            ctx.moveTo(destX + off, destY);
            ctx.lineTo(destX + off, destY + TILE);
          } else {
            ctx.moveTo(destX, destY + off);
            ctx.lineTo(destX + TILE, destY + off);
          }
        });
        ctx.stroke();
        ctx.restore();
        continue;
      }

      // water/ice both paint fully opaque (ice right here, water later via renderPonds —
      // see draw() in render-hud.js), so the floor underneath never shows. Skip drawing
      // it for those two instead of drawing it just to cover it back up.
      if (cell.type === 'floor') {
        ctx.drawImage(variantSetFor(cell.roomId, x, y).floor[variant], destX, destY, TILE, TILE);
      } else if (cell.type === 'ice') {
        // renderPuddle draws in BASE_TILE-pixel units — scale it to the current TILE
        const ps = TILE / BASE_TILE;
        ctx.save();
        ctx.translate(destX + TILE / 2, destY + TILE / 2);
        ctx.scale(ps, ps);
        renderPuddle(ctx, 0, 0);
        ctx.restore();
      }
    }
  }
}

// decor (trees, mushrooms, ...) gets its own pass, called well after drawWorldTiles,
// since its bitmap (DECOR_BITMAP_SIZE) is wider than one tile and would otherwise get
// clipped by a neighboring tile drawn later in the same tile loop
export function drawDecor(originPxX, originPxY, camX, camY) {
  const colsHalf = Math.ceil(VIEW_COLS / 2) + 1,
    rowsHalf = Math.ceil(VIEW_ROWS / 2) + 1;
  const x0 = Math.floor(camX - colsHalf),
    x1 = Math.ceil(camX + colsHalf);
  const y0 = Math.floor(camY - rowsHalf),
    y1 = Math.ceil(camY + rowsHalf);

  // row-major top-to-bottom so decor in a lower row (closer to camera) draws over
  // decor spilling down from the row above it
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const decor = decorByTile.get(key(x, y));
      if (!decor) continue;
      const destX = Math.round(originPxX + x * TILE),
        destY = Math.round(originPxY + y * TILE);
      // pre-baked bitmap (bakeDecorBitmap), anchored near its bottom (DECOR_ANCHOR_Y
      // from its own top) since drawFns grow upward from a ground point. Explicit
      // destination width/height (not the bitmap's own dims) stays correct if a resize
      // lands mid-wave and decor.oldBitmap is still sized for the previous TILE.
      const scale = TILE / BASE_TILE;
      const w = DECOR_BITMAP_SIZE * scale;
      const h = DECOR_BITMAP_HEIGHT * scale;
      const anchorY = DECOR_ANCHOR_Y * scale;
      const bmp = waveRevealed(decor.roomId, x, y) ? decor.bitmap : decor.oldBitmap;
      ctx.drawImage(bmp, destX + TILE / 2 - w / 2, destY + TILE / 2 - anchorY, w, h);
    }
  }
}

// highlight of the cells touched by the last cast spell (fades over 500ms)
export function drawCastHighlight(originPxX, originPxY) {
  if (lastCast && performance.now() < lastCast.until) {
    const t = 1 - (lastCast.until - performance.now()) / 500;
    ctx.save();
    ctx.globalAlpha = 0.32 * (1 - t);
    ctx.fillStyle = COLORS.PINK_GLOW;
    lastCast.cellsTouched.forEach(cell => {
      ctx.fillRect(originPxX + cell.x * TILE, originPxY + cell.y * TILE, TILE, TILE);
    });
    ctx.restore();
    // eslint-disable-next-line no-import-assign -- see the lastCast import comment up top
  } else if (lastCast) lastCast = null;
}

// range preview during composition: shape depends only on phrase + player position/facing,
// none of which change between frames while the combo panel is open — cache it instead
// of recomputing cells and rebuilding the lookup Set 60x/sec while idle-composing
let _spellPreviewCache = { key: null, cells: [], cellSet: null };
function getSpellPreviewCells() {
  const cacheKey = phraseRunes.join('') + '|' + player.x + ',' + player.y + '|' + player.facing;
  if (_spellPreviewCache.key !== cacheKey) {
    const cells = computeSpellPreview(phraseRunes, player.x, player.y, player.facing);
    _spellPreviewCache = {
      key: cacheKey,
      cells,
      cellSet: new Set(cells.map(cell => cell.x + ',' + cell.y)),
    };
  }
  return _spellPreviewCache;
}

export function drawSpellPreview(originPxX, originPxY) {
  if (!phraseRunes.length) return;
  const { cells: previewCells, cellSet } = getSpellPreviewCells();
  const t = performance.now() / 450;
  const pulse = Math.sin(t);
  ctx.save();
  ctx.globalAlpha = 0.4 + pulse * 0.12;
  ctx.fillStyle = COLORS.PINK_GLOW;
  previewCells.forEach(cell => {
    ctx.fillRect(originPxX + cell.x * TILE, originPxY + cell.y * TILE, TILE, TILE);
  });
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 14 + pulse * 6;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 1;
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -performance.now() / 30;
  ctx.beginPath();
  previewCells.forEach(cell => {
    const px = originPxX + cell.x * TILE,
      py = originPxY + cell.y * TILE;
    if (!cellSet.has(cell.x + ',' + (cell.y - 1))) {
      ctx.moveTo(px, py);
      ctx.lineTo(px + TILE, py);
    }
    if (!cellSet.has(cell.x + ',' + (cell.y + 1))) {
      ctx.moveTo(px, py + TILE);
      ctx.lineTo(px + TILE, py + TILE);
    }
    if (!cellSet.has(cell.x - 1 + ',' + cell.y)) {
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + TILE);
    }
    if (!cellSet.has(cell.x + 1 + ',' + cell.y)) {
      ctx.moveTo(px + TILE, py);
      ctx.lineTo(px + TILE, py + TILE);
    }
  });
  ctx.stroke();
  ctx.restore();
}

// symmetric plates: always drawn at their fixed spot, whether or not a crate currently
// covers them — a weighed plate glows green
export function drawPlates(originPxX, originPxY) {
  plateByTile.forEach((plate, tileKey) => {
    const [tileX, tileY] = unkey(tileKey);
    const px = originPxX + tileX * TILE + TILE / 2,
      py = originPxY + tileY * TILE + TILE / 2;
    if (offscreen(px, py)) return;
    const color = plate.weighed ? COLORS.GREEN : COLORS.PURPLE;
    const scale = TILE / BASE_TILE;
    ctx.save();
    if (plate.weighed) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * scale;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2 * scale;
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(px - TILE * 0.46, py - TILE * 0.46, TILE * 0.92, TILE * 0.92);
    ctx.globalAlpha = plate.weighed ? 0.4 : 0.25;
    ctx.fillStyle = color;
    ctx.fillRect(px - TILE * 0.46, py - TILE * 0.46, TILE * 0.92, TILE * 0.92);
    ctx.restore();
  });
}

// interactive objects (Vine, Crate, ...) — rendered dynamically, never frozen into the cache.
export function drawInteractiveObjects(originPxX, originPxY) {
  objectsMap.forEach((obj, tileKey) => {
    const [tileX, tileY] = unkey(tileKey);
    renderInteractiveObject(obj, tileX, tileY, originPxX, originPxY);
  });
}

// primitive pedestals (1 per zone)
export function drawPrimitivePedestals(originPxX, originPxY) {
  ZONES.forEach(zone => {
    const spot = primitiveSpots[zone.id];
    const px = originPxX + spot.x * TILE + TILE / 2,
      py = originPxY + spot.y * TILE + TILE / 2;
    if (offscreen(px, py)) return;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    fillEllipse(ctx, px, py + TILE * 0.29, TILE * 0.33, TILE * 0.12);
    ctx.restore();
    const glow = spot.collected ? RUNE_ACCENT[zone.id] : COLORS.PINK_SOFT;
    ctx.save();
    ctx.fillStyle = radialFade(
      ctx,
      px,
      py,
      TILE * 1.1,
      spot.collected ? RUNE_ACCENT[zone.id] + '4d' : COLORS.PINK_SOFT + '4d'
    );
    fillCircle(ctx, px, py, TILE * 1.1);
    ctx.restore();
    iconGlyph(
      ctx,
      px,
      py,
      TILE * 0.34,
      spot.collected ? UI_LIGHT : COLORS.CREAM,
      glow,
      RUNE_SHAPE[zone.id]
    );
  });
}

// item markers (disappear once collected)
export function drawItems(originPxX, originPxY) {
  items.forEach(item => {
    const spotKey = item.zoneId + ':' + item.x + ',' + item.y;
    if (collectedItems.has(spotKey)) return;
    const px = originPxX + item.x * TILE + TILE / 2,
      py = originPxY + item.y * TILE + TILE / 2;
    if (offscreen(px, py)) return;
    const t = performance.now() / 500;
    // shape below is drawn in BASE_TILE-pixel units — scale it to the current TILE
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(TILE / BASE_TILE, TILE / BASE_TILE);
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.sin(t) * 0.1;
    ctx.fillStyle = COLORS.PINK_GLOW;
    fillEllipse(ctx, 0, BASE_TILE * 0.28, 10, 4);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = COLORS.PINK_WARM;
    ctx.shadowBlur = 8 + Math.sin(t) * 3;
    // fading trail behind the star, selling the "shooting" motion
    for (let i = 3; i >= 1; i--) {
      ctx.save();
      ctx.globalAlpha = 0.4 - i * 0.1;
      ctx.fillStyle = '#fff6f0';
      fillCircle(ctx, -i * 3.2, -i * 2.2, 2.6 - i * 0.5);
      ctx.restore();
    }
    // the star itself: a 4-point sparkle — same alternating-radius shape as starPath,
    // just traced starting from a different vertex around the same closed octagon,
    // so it's the identical fill either way
    ctx.fillStyle = COLORS.STAR_CREAM;
    ctx.strokeStyle = COLORS.PINK_DARK;
    ctx.lineWidth = 1.2;
    starPath(ctx, 0, 0, 7, 4, 2.4 / 7);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore(); // matches the outer translate/scale
  });
}

// hub altar: lights up progressively as objects are brought back
export function drawHubAltar(originPxX, originPxY) {
  if (totalItems <= 0) return;
  const apx = originPxX + HUB.cx * TILE + TILE / 2,
    apy = originPxY + HUB.cy * TILE + TILE / 2;
  if (offscreen(apx, apy, TILE * 2)) return;
  const ratio = collectedItems.size / totalItems;
  const t = performance.now() / 600;
  ctx.save();
  ctx.globalAlpha = 0.25 + ratio * 0.35 + (hubActivated ? Math.sin(t) * 0.15 : 0);
  const ac = hubActivated ? '#fff' : COLORS.PINK_GLOW;
  ctx.fillStyle = radialFade(ctx, apx, apy, TILE * 1.6, ac);
  fillCircle(ctx, apx, apy, TILE * 1.6);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = ac;
  ctx.lineWidth = 2 * (TILE / BASE_TILE);
  ctx.globalAlpha = 0.6 + ratio * 0.4;
  strokeCircle(ctx, apx, apy, TILE * 0.5);
  ctx.restore();
  // stars indicating progress, no text
  for (let i = 0; i < totalItems; i++) {
    const angle = (i / totalItems) * Math.PI * 2 - Math.PI / 2;
    const starX = apx + Math.cos(angle) * TILE * 0.85,
      starY = apy + Math.sin(angle) * TILE * 0.85;
    ctx.save();
    ctx.fillStyle = i < collectedItems.size ? COLORS.PINK_GLOW : '#ffffff26';
    ctx.strokeStyle = i < collectedItems.size ? WHITE : '#ffffff40';
    ctx.lineWidth = 1;
    if (i < collectedItems.size) {
      ctx.shadowColor = COLORS.PINK_WARM;
      ctx.shadowBlur = 10;
    }
    starPath(ctx, starX, starY, 7 * (TILE / BASE_TILE), 4, 0.28);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// doors: simple entry marker, cosmetic — entering the zone is no longer blocked
export function drawDoors(originPxX, originPxY) {
  doors.forEach(door => {
    const px = originPxX + door.x * TILE + TILE / 2,
      py = originPxY + door.y * TILE + TILE / 2;
    if (offscreen(px, py)) return;
    const done = collected.has(door.roomId);
    const haloColor = done ? RUNE_ACCENT[door.roomId] + '52' : COLORS.PINK_GLOW + '38';
    const glyphColor = done ? WHITE : COLORS.PINK_WARM;
    const glowColor = done ? RUNE_ACCENT[door.roomId] : COLORS.PINK_WARM;
    ctx.save();
    ctx.fillStyle = radialFade(ctx, px, py, TILE * 1.2, haloColor);
    fillCircle(ctx, px, py, TILE * 1.2);
    ctx.restore();
    iconGlyph(ctx, px, py, TILE * 0.28, glyphColor, glowColor, RUNE_SHAPE[door.roomId]);
  });
}

export function drawHubGlyph(originPxX, originPxY) {
  const px = originPxX + HUB.cx * TILE + TILE / 2,
    py = originPxY + HUB.cy * TILE + TILE / 2;
  if (Math.hypot(px - canvas.width / 2, py - canvas.height / 2) < canvas.width) {
    iconGlyph(ctx, px, py, TILE * 0.34, COLORS.CREAM, COLORS.PINK_SOFT, 4); // 4 = heart, see RUNE_SHAPES
  }
}
