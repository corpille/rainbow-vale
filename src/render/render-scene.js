/* ============ Per-frame scene draw: tiles, highlights, interactive objects, markers ============ */
import { COLORS, UI_LIGHT } from '../core/colors.js';
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
import { HUB, ZONES, grid, key, objectsMap, unkey, worldRunes } from '../world/world-zones.js';
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
  offscreen,
  renderInteractiveObject,
  renderPuddle,
  tileVariantIndex,
  variantSetFor,
  waveRevealed,
} from './render-world.js';

// draws only tiles in the viewport: a pre-rendered variant blit (gray/color state
// already baked in, see bakeRoomVariants), plus what can't be shared — wall borders
// (depend on neighbors) and decor/ice-puddle (tied to a specific position, not a tile type)
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
        const obs = obstacleByTile.get(key(x, y));
        if (!obs) continue; // true void — the sky-blue background shows through
        ctx.drawImage(variantSetFor(obs.roomId, x, y).wall[variant], destX, destY, TILE, TILE);
        // only edges facing a non-obstacle tile: bordering all four sides double-draws
        // the shared edge between adjacent walls, showing as a double line down what
        // should be one solid wall. Edges run the tile's full length on their own axis,
        // inset only on the perpendicular one — insetting both ends would leave a 2px
        // gap at the corner shared with the next tile.
        ctx.save();
        ctx.strokeStyle = '#00000080';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (!obstacleByTile.has(key(x, y - 1))) {
          ctx.moveTo(destX, destY + 1);
          ctx.lineTo(destX + TILE, destY + 1);
        }
        if (!obstacleByTile.has(key(x, y + 1))) {
          ctx.moveTo(destX, destY + TILE - 1);
          ctx.lineTo(destX + TILE, destY + TILE - 1);
        }
        if (!obstacleByTile.has(key(x - 1, y))) {
          ctx.moveTo(destX + 1, destY);
          ctx.lineTo(destX + 1, destY + TILE);
        }
        if (!obstacleByTile.has(key(x + 1, y))) {
          ctx.moveTo(destX + TILE - 1, destY);
          ctx.lineTo(destX + TILE - 1, destY + TILE);
        }
        ctx.stroke();
        ctx.restore();
        continue;
      }

      ctx.drawImage(variantSetFor(cell.roomId, x, y).floor[variant], destX, destY, TILE, TILE);

      const obj = worldRunes.objectAt(x, y);
      // only the frozen look is drawn here — liquid "water" is animated per-frame
      // instead, see renderPuddleField in drawInteractiveObjects
      if (obj && obj.type === 'puddle' && obj.state === 'frozen') {
        // renderPuddle draws in BASE_TILE-pixel units — scale it to the current TILE
        const ps = TILE / BASE_TILE;
        ctx.save();
        ctx.translate(destX + TILE / 2, destY + TILE / 2);
        ctx.scale(ps, ps);
        renderPuddle(ctx, obj, 0, 0);
        ctx.restore();
      }
    }
  }
}

// decor (trees, mushrooms, ...) gets its own pass, called once drawInteractiveObjects
// has painted the animated water surface. Two reasons it can't just live inside
// drawWorldTiles above: its bitmap (DECOR_BITMAP_SIZE) is wider than one tile, so it
// spills into neighboring columns — drawn inline with the tile loop, a neighbor tile
// drawn later in the same row (or a row below) painted right over that overflow,
// clipping trees/mushrooms with a hard rectangular edge. And liquid water isn't baked
// into the tile bitmaps at all (it animates per-frame via renderPuddleField in
// drawInteractiveObjects, which runs after drawWorldTiles) — so even drawn in its own
// pass at the end of drawWorldTiles, decor overflowing onto a water tile would still
// get painted over once that water redraws. Calling this after drawInteractiveObjects
// instead avoids both.
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
      const d = decorByTile.get(key(x, y));
      if (!d) continue;
      const destX = Math.round(originPxX + x * TILE),
        destY = Math.round(originPxY + y * TILE);
      // pre-baked bitmap (bakeDecorBitmap), same gray/reveal state as the tile
      // underneath, already baked at TILE's resolution — drawn at matching on-screen
      // size, no scaling needed. Anchored near its bottom (DECOR_ANCHOR_Y from its own
      // top), not centered, since drawFns grow upward from a ground point — see
      // DECOR_BITMAP_SIZE. Using explicit destination width/height (not the bitmap's
      // own dims) keeps this correct if a resize lands mid-wave and d.oldBitmap is
      // still sized for the previous TILE — same safety net the floor/wall drawImage
      // calls above rely on.
      const scale = TILE / BASE_TILE;
      const w = DECOR_BITMAP_SIZE * scale;
      const h = DECOR_BITMAP_HEIGHT * scale;
      const anchorY = DECOR_ANCHOR_Y * scale;
      const bmp = waveRevealed(d.roomId, x, y) ? d.bitmap : d.oldBitmap;
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
    lastCast.cellsTouched.forEach(c => {
      ctx.fillRect(originPxX + c.x * TILE, originPxY + c.y * TILE, TILE, TILE);
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
  const k = phraseRunes.join('') + '|' + player.x + ',' + player.y + '|' + player.facing;
  if (_spellPreviewCache.key !== k) {
    const cells = computeSpellPreview(phraseRunes, player.x, player.y, player.facing);
    _spellPreviewCache = { key: k, cells, cellSet: new Set(cells.map(c => c.x + ',' + c.y)) };
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
  previewCells.forEach(c => {
    ctx.fillRect(originPxX + c.x * TILE, originPxY + c.y * TILE, TILE, TILE);
  });
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 14 + pulse * 6;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.globalAlpha = 1;
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -performance.now() / 30;
  ctx.beginPath();
  previewCells.forEach(c => {
    const px = originPxX + c.x * TILE,
      py = originPxY + c.y * TILE;
    if (!cellSet.has(c.x + ',' + (c.y - 1))) {
      ctx.moveTo(px, py);
      ctx.lineTo(px + TILE, py);
    }
    if (!cellSet.has(c.x + ',' + (c.y + 1))) {
      ctx.moveTo(px, py + TILE);
      ctx.lineTo(px + TILE, py + TILE);
    }
    if (!cellSet.has(c.x - 1 + ',' + c.y)) {
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + TILE);
    }
    if (!cellSet.has(c.x + 1 + ',' + c.y)) {
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
  plateByTile.forEach((plate, k) => {
    const [ox, oy] = unkey(k);
    const px = originPxX + ox * TILE + TILE / 2,
      py = originPxY + oy * TILE + TILE / 2;
    if (offscreen(px, py)) return;
    const c = plate.weighed ? COLORS.GREEN : COLORS.PURPLE;
    const s = TILE / BASE_TILE;
    ctx.save();
    if (plate.weighed) {
      ctx.shadowColor = c;
      ctx.shadowBlur = 8 * s;
    }
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.2 * s;
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(px - TILE * 0.46, py - TILE * 0.46, TILE * 0.92, TILE * 0.92);
    ctx.globalAlpha = plate.weighed ? 0.4 : 0.25;
    ctx.fillStyle = c;
    ctx.fillRect(px - TILE * 0.46, py - TILE * 0.46, TILE * 0.92, TILE * 0.92);
    ctx.restore();
  });
}

// interactive objects (Vine, Crate, ...) — rendered dynamically, never frozen into the cache
export function drawInteractiveObjects(originPxX, originPxY) {
  objectsMap.forEach((obj, k) => {
    const [ox, oy] = unkey(k);
    renderInteractiveObject(obj, ox, oy, originPxX, originPxY);
  });
}

// primitive pedestals (1 per zone)
export function drawPrimitivePedestals(originPxX, originPxY) {
  ZONES.forEach(z => {
    const spot = primitiveSpots[z.id];
    const px = originPxX + spot.x * TILE + TILE / 2,
      py = originPxY + spot.y * TILE + TILE / 2;
    if (offscreen(px, py)) return;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    fillEllipse(ctx, px, py + TILE * 0.29, TILE * 0.33, TILE * 0.12);
    ctx.restore();
    const glow = spot.collected ? RUNE_ACCENT[z.id] : COLORS.PINK_SOFT;
    ctx.save();
    ctx.fillStyle = radialFade(
      ctx,
      px,
      py,
      TILE * 1.1,
      spot.collected ? RUNE_ACCENT[z.id] + '4d' : COLORS.PINK_SOFT + '4d'
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
      RUNE_SHAPE[z.id]
    );
  });
}

// item markers (disappear once collected)
export function drawItems(originPxX, originPxY) {
  items.forEach(p => {
    const spotKey = p.zoneId + ':' + p.x + ',' + p.y;
    if (collectedItems.has(spotKey)) return;
    const px = originPxX + p.x * TILE + TILE / 2,
      py = originPxY + p.y * TILE + TILE / 2;
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
    // the star itself: a 4-point sparkle (outer/inner radius alternating every 45deg)
    ctx.fillStyle = '#fff6d8';
    ctx.strokeStyle = COLORS.PINK_DARK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 === 0 ? 7 : 2.4;
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
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
    const a = (i / totalItems) * Math.PI * 2 - Math.PI / 2;
    const px2 = apx + Math.cos(a) * TILE * 0.85,
      py2 = apy + Math.sin(a) * TILE * 0.85;
    ctx.save();
    ctx.fillStyle = i < collectedItems.size ? COLORS.PINK_GLOW : '#ffffff26';
    ctx.strokeStyle = i < collectedItems.size ? '#ffffff' : '#ffffff40';
    ctx.lineWidth = 1;
    if (i < collectedItems.size) {
      ctx.shadowColor = COLORS.PINK_WARM;
      ctx.shadowBlur = 10;
    }
    starPath(ctx, px2, py2, 7 * (TILE / BASE_TILE), 4, 0.28);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// doors: simple entry marker, cosmetic — entering the zone is no longer blocked
export function drawDoors(originPxX, originPxY) {
  doors.forEach(d => {
    const px = originPxX + d.x * TILE + TILE / 2,
      py = originPxY + d.y * TILE + TILE / 2;
    if (offscreen(px, py)) return;
    const done = collected.has(d.roomId);
    const haloColor = done ? RUNE_ACCENT[d.roomId] + '52' : COLORS.PINK_GLOW + '38';
    const glyphColor = done ? '#ffffff' : COLORS.PINK_WARM;
    const glowColor = done ? RUNE_ACCENT[d.roomId] : COLORS.PINK_WARM;
    ctx.save();
    ctx.fillStyle = radialFade(ctx, px, py, TILE * 1.2, haloColor);
    fillCircle(ctx, px, py, TILE * 1.2);
    ctx.restore();
    iconGlyph(ctx, px, py, TILE * 0.28, glyphColor, glowColor, RUNE_SHAPE[d.roomId]);
  });
}

export function drawHubGlyph(originPxX, originPxY) {
  const px = originPxX + HUB.cx * TILE + TILE / 2,
    py = originPxY + HUB.cy * TILE + TILE / 2;
  if (Math.hypot(px - canvas.width / 2, py - canvas.height / 2) < canvas.width) {
    iconGlyph(ctx, px, py, TILE * 0.34, COLORS.CREAM, COLORS.PINK_SOFT, 'heart');
  }
}
