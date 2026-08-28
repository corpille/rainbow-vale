/* ============ Per-frame scene draw: tiles, highlights, interactive objects, markers ============ */
import { BLACK, COLORS, UI_LIGHT, WHITE } from '../core/colors.js';
import {
  BASE_TILE,
  TILE,
  VIEW_COLS,
  VIEW_ROWS,
  fillEllipse,
  glowFill,
  iconGlyph,
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
// import-is-really-a-global caveat as above.
import { RUNE_ACCENT, RUNE_SHAPE, phraseRunes } from '../core/ui-panel.js';
import {
  DECOR_ANCHOR_Y,
  DECOR_BITMAP_HEIGHT,
  DECOR_BITMAP_SIZE,
  ctx,
  drawWallCrack,
  offscreen,
  renderInteractiveObject,
  renderPuddle,
  tileVariantIndex,
  variantSetFor,
  waveRevealed,
} from './render-world.js';

// visible tile-grid range around the camera, padded by 1 so edge tiles don't clip
// mid-scroll. Shared by drawWorldTiles and drawDecor below.
function viewBounds(camX, camY) {
  const colsHalf = Math.ceil(VIEW_COLS / 2) + 1,
    rowsHalf = Math.ceil(VIEW_ROWS / 2) + 1;
  return [
    Math.floor(camX - colsHalf),
    Math.ceil(camX + colsHalf),
    Math.floor(camY - rowsHalf),
    Math.ceil(camY + rowsHalf),
  ];
}


export const getPxPy = (origin, item) => [ 
  origin.x + item.x * TILE + TILE / 2,
  origin.y + item.y * TILE + TILE / 2
];

// draws only viewport tiles: a pre-rendered variant blit (baked in bakeRoomVariants)
// for plain floor, or a per-tile draw for anything else (ice, and wall borders since
// those depend on neighbors)
export function drawWorldTiles(originPx, camX, camY) {
  const [x0, x1, y0, y1] = viewBounds(camX, camY);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const destX = Math.round(originPx.x + x * TILE),
        destY = Math.round(originPx.y + y * TILE);
      const cell = grid.get(key(x, y));
      const variant = tileVariantIndex(x, y);

      if (!cell) {
        const obstacle = obstacleByTile.get(key(x, y));
        if (!obstacle) continue; // true void — the sky-blue background shows through
        // crackable wall's tell: draw this exact same baked wall bitmap through a hue-rotate
        // filter — the wall's own texture/shading/AO untouched, just shifted off the zone's
        // normal wall hue, same filter mechanism grayFilter already uses for the
        // uncollected-zone grayscale bake (see bakeTile below). Only kicks in once the
        // zone's rune is collected — before that it stays indistinguishable from every
        // other wall, same as the rest of the zone, so finding it is part of exploring
        // the zone rather than a hint visible from the very first glance.
        const tinted = obstacle.crackable && collected.has(obstacle.roomId);
        if (tinted) ctx.filter = 'hue-rotate(40deg)';
        ctx.drawImage(variantSetFor(obstacle.roomId, x, y).wall[variant], destX, destY, TILE, TILE);
        if (tinted) ctx.filter = 'none';
        if (obstacle.cracked) drawWallCrack(destX, destY);
        // only draw edges facing a non-obstacle tile, else adjacent walls double-draw
        // the shared edge. [dx, dy, vertical, offset] per edge
        ctx.save();
        ctx.strokeStyle = `${BLACK}80`;
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

      // water/ice both paint fully opaque (ice here, water later via renderPonds in
      // render-hud.js), so the floor underneath never shows — skip drawing it for those two.
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

// decor (trees, mushrooms, ...) gets its own pass after drawWorldTiles, since its
// bitmap (DECOR_BITMAP_SIZE) is wider than one tile and would get clipped by a
// neighboring tile drawn later in the same loop otherwise
export function drawDecor(originPx, camX, camY) {
  const [x0, x1, y0, y1] = viewBounds(camX, camY);

  // row-major top-to-bottom so decor in a lower row (closer to camera) draws over
  // decor spilling down from the row above it
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const decor = decorByTile.get(key(x, y));
      if (!decor) continue;
      const [ destX, destY ] = getPxPy(originPx, {x, y})
      // pre-baked bitmap (bakeDecorBitmap), anchored near its bottom (DECOR_ANCHOR_Y from
      // its own top) since drawFns grow upward from a ground point. Explicit destination
      // width/height keeps this correct if a resize lands mid-wave and decor.oldBitmap is
      // still sized for the previous TILE.
      const scale = TILE / BASE_TILE;
      const w = DECOR_BITMAP_SIZE * scale;
      const h = DECOR_BITMAP_HEIGHT * scale;
      const anchorY = DECOR_ANCHOR_Y * scale;
      const bmp = waveRevealed(decor.roomId, x, y) ? decor.bitmap : decor.oldBitmap;
      ctx.drawImage(bmp, destX - w / 2, destY - anchorY, w, h);
    }
  }
}

// range preview shape only depends on phrase + player position/facing, which don't change
// while the combo panel is open — cache it instead of recomputing 60x/sec while idle-composing
let _spellPreviewCache = { key: null, cells: [], cellSet: null };
function getSpellPreviewCells() {
  const cacheKey = phraseRunes.join('') + '|' + key(player.x, player.y) + '|' + player.facing;
  if (_spellPreviewCache.key !== cacheKey) {
    const cells = computeSpellPreview(phraseRunes, player.x, player.y, player.facing);
    _spellPreviewCache = {
      key: cacheKey,
      cells,
      cellSet: new Set(cells.map(cell => key(cell.x, cell.y))),
    };
  }
  return _spellPreviewCache;
}

export function drawSpellPreview(originPx) {
  if (!phraseRunes.length) return;
  const { cells: previewCells, cellSet } = getSpellPreviewCells();
  const t = performance.now() / 450;
  const pulse = Math.sin(t);
  ctx.save();
  ctx.globalAlpha = 0.4 + pulse * 0.12;
  ctx.fillStyle = COLORS.PINK_GLOW;
  const cellP = previewCells.map(cell => [originPx.x + cell.x * TILE, originPx.y + cell.y * TILE, cell.x, cell.y]);
  cellP.forEach(([px, py]) => ctx.fillRect(px, py, TILE, TILE));
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 14 + pulse * 6;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 1;
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -performance.now() / 30;
  ctx.beginPath();
  cellP.forEach(([px, py, x, y]) => {
    if (!cellSet.has(key(x, y - 1))) {
      ctx.moveTo(px, py);
      ctx.lineTo(px + TILE, py);
    }
    if (!cellSet.has(key(x, y + 1))) {
      ctx.moveTo(px, py + TILE);
      ctx.lineTo(px + TILE, py + TILE);
    }
    if (!cellSet.has(key(x - 1, y))) {
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + TILE);
    }
    if (!cellSet.has(key(x + 1, y))) {
      ctx.moveTo(px + TILE, py);
      ctx.lineTo(px + TILE, py + TILE);
    }
  });
  ctx.stroke();
  ctx.restore();
}

// symmetric plates: always drawn at their fixed spot whether or not a crate covers
// them — a weighed plate glows green
export function drawPlates(originPx) {
  plateByTile.forEach((plate, tileKey) => {
    const [x, y] = unkey(tileKey);
    const [px, py] = getPxPy(originPx, {x, y});
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
export function drawInteractiveObjects(originPx) {
  objectsMap.forEach((obj, tileKey) => {
    const [x, y] = unkey(tileKey);
    const [px, py] = getPxPy(originPx, { x, y });

    renderInteractiveObject(obj, px, py);
  });
}

// primitive pedestals (1 per zone)
export function drawPrimitivePedestals(originPx) {
  ZONES.forEach(zone => {
    const spot = primitiveSpots[zone.id];
    const [px, py] = getPxPy(originPx, spot);
    if (offscreen(px, py)) return;
    ctx.save();
    glowFill(
      ctx,
      px,
      py,
      TILE * 1.1,
      spot.collected ? RUNE_ACCENT[zone.id] + '4d' : COLORS.PINK_SOFT + '4d'
    );
    ctx.restore();
    iconGlyph(
      ctx,
      px,
      py,
      TILE * 0.34,
      spot.collected ? UI_LIGHT : COLORS.CREAM,
      spot.collected ? RUNE_ACCENT[zone.id] : COLORS.PINK_SOFT,
      RUNE_SHAPE[zone.id]
    );
  });
}

// item markers (disappear once collected)
export function drawItems(originPx) {
  items.forEach(item => {
    const spotKey = item.zoneId + ':' + key(item.x, item.y);
    if (collectedItems.has(spotKey)) return;
    const [px, py] = getPxPy(originPx, item);

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
    // the star itself: a 4-point sparkle, same alternating-radius shape as starPath just
    // traced from a different vertex — identical fill either way
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
export function drawHubAltar(originPx) {
  if (totalItems <= 0) return;
  const [px, py] = getPxPy(originPx, {x: HUB.cx, y: HUB.cy});

  if (offscreen(px, py, TILE * 2)) return;
  const ratio = collectedItems.size / totalItems;
  const t = performance.now() / 600;
  ctx.save();
  ctx.globalAlpha = 0.25 + ratio * 0.35 + (hubActivated ? Math.sin(t) * 0.15 : 0);
  const ac = hubActivated ? '#fff' : COLORS.PINK_GLOW;
  glowFill(ctx, px, py, TILE * 1.6, ac);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = ac;
  ctx.lineWidth = 2 * (TILE / BASE_TILE);
  ctx.globalAlpha = 0.6 + ratio * 0.4;
  strokeCircle(ctx, px, py, TILE * 0.5);
  ctx.restore();
  // stars indicating progress, no text
  for (let i = 0; i < totalItems; i++) {
    const angle = (i / totalItems) * Math.PI * 2 - Math.PI / 2;
    const starX = px + Math.cos(angle) * TILE * 0.85,
      starY = py + Math.sin(angle) * TILE * 0.85;
    ctx.save();
    ctx.fillStyle = i < collectedItems.size ? COLORS.PINK_GLOW : `${WHITE}26`;
    ctx.strokeStyle = i < collectedItems.size ? WHITE : `${WHITE}40`;
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

export function drawDoors(originPx) {
  doors.forEach(door => {
    const [px, py] = getPxPy(originPx, door);
    if (offscreen(px, py)) return;
    iconGlyph(ctx, px, py, TILE * 0.2, undefined, `${WHITE}a0`, RUNE_SHAPE[door.roomId]);
  });
}

export function drawHubGlyph(originPx) {
  const [px, py] = getPxPy(originPx, {x: HUB.cx, y: HUB.cy});
  if (!offscreen(px, py)) {
    iconGlyph(ctx, px, py, TILE * 0.34, COLORS.CREAM, COLORS.PINK_SOFT, 4); // 4 = heart, see RUNE_SHAPES
  }
}
