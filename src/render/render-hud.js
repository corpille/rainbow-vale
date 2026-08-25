/* ============ Screen effects, start menu, main draw() loop, page-level DOM wiring ============ */
import { COLORS, FONT, TRANSPARENT, UI_LIGHT } from '../core/colors.js';
import { BASE_TILE, TILE, gameState, iconGlyph, starPath } from '../core/engine-core.js';
import { ZONES, isBlockingFor, worldRunes } from '../world/world-zones.js';
import { hubActivated, player, screenFlash } from '../core/player.js';
import { startMusic } from '../core/music.js';
import {
  RUNE_ACCENT,
  RUNE_SHAPE,
  comboOverlay,
  drawComboOverlay,
  inRect,
  panelRect,
} from '../core/ui-panel.js';
import { canvas, ctx, generateTileVariants, renderPonds } from './render-world.js';
import {
  drawCastHighlight,
  drawDecor,
  drawDoors,
  drawHubAltar,
  drawHubGlyph,
  drawInteractiveObjects,
  drawItems,
  drawPlates,
  drawPrimitivePedestals,
  drawSpellPreview,
  drawWorldTiles,
} from './render-scene.js';
import { drawPlayer } from './render-player.js';

// visual flash with no text, at the moment an exit seals
function drawScreenFlash() {
  if (screenFlash && performance.now() < screenFlash.until) {
    const t = 1 - (screenFlash.until - performance.now()) / 500;
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 - t);
    ctx.strokeStyle = screenFlash.color;
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
    ctx.restore();
  }
}

function drawVignette() {
  ctx.save();
  const gradient = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.25,
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.75
  );
  gradient.addColorStop(0, TRANSPARENT);
  gradient.addColorStop(1, '#3a2f5540');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// shared full-bleed background for every non-gameplay screen (menu/ending) — the
// world is never drawn underneath any of them (see draw()'s early return below): this
// gradient is opaque, so it would just hide the world anyway, making that rendering
// pure waste. Only the bottom color stop varies per screen.
function drawDuskBg(bottomColor) {
  const w = canvas.width,
    h = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, COLORS.NEAR_BLACK);
  gradient.addColorStop(0.6, '#5a4a8a');
  gradient.addColorStop(1, bottomColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

// the glowing title text every overlay screen (menu/ending) opens with —
// same pink fill + warm shadow, only the text/position/size/glow amount differ
function glowTitle(x, y, text, fontPx, shadow) {
  ctx.fillStyle = COLORS.PINK_GLOW;
  ctx.shadowColor = COLORS.PINK_WARM;
  ctx.shadowBlur = shadow;
  ctx.font = `700 ${fontPx}px ${FONT}`;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}
// the pill-shaped Play/Start buttons — same look, only the label differs
function drawPillButton(rect, label, scale) {
  panelRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.fillStyle = COLORS.PINK_UI;
  ctx.fill();
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = UI_LIGHT;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_LIGHT;
  ctx.font = `700 ${18 * scale}px ${FONT}`;
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + scale);
}

let menuBtn = null; // {x,y,w,h}, recomputed each frame it's drawn — see the pointerdown handler below
function drawMenuOverlay() {
  // scale (same ratio driving TILE) keeps text/icon sizing consistent across viewports.
  const w = canvas.width,
    h = canvas.height,
    scale = TILE / BASE_TILE;

  drawDuskBg(COLORS.PURPLE);

  // one save/restore for the rest of the frame instead of per-section — each block
  // still sets every property it cares about, so nothing leaks except shadowBlur,
  // which is explicitly zeroed where unwanted
  ctx.save();
  ctx.textAlign = 'center';
  ctx.lineCap = 'round';

  // rainbow arch flourish echoing the vale's name — centered well above the title
  // so its stroke width never dips into the text (used to overlap)
  const archY = h * 0.34;
  COLORS.RAINBOW.forEach((color, i) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 5 * scale;
    ctx.beginPath();
    ctx.arc(w / 2, archY, (30 + i * 7) * scale, Math.PI, 0);
    ctx.stroke();
  });

  const titleY = archY + 90 * scale;
  glowTitle(w / 2, titleY, 'Rainbow Vale', 46 * scale, 16 * scale);

  // the four runes to gather, same icon/color as the combo panel; row width clamped
  // to 80% of viewport so it never overflows on narrow phones
  const iconY = titleY + 50 * scale,
    spacing = Math.min(70 * scale, (w * 0.8) / (ZONES.length - 1)),
    totalW = spacing * (ZONES.length - 1);
  ZONES.forEach((zone, i) => {
    iconGlyph(
      ctx,
      w / 2 - totalW / 2 + spacing * i,
      iconY,
      22 * scale,
      UI_LIGHT,
      RUNE_ACCENT[zone.id],
      RUNE_SHAPE[zone.id]
    );
  });

  // what's going on, and the 3-step goal loop, so a first-time player isn't dropped in
  // with zero context (the phrase-then-cast combo mechanic especially needs a
  // sentence — nothing else hints at it before this)
  ctx.fillStyle = UI_LIGHT;
  ctx.font = `${15 * scale}px ${FONT}`;
  const lineY = iconY + 60 * scale,
    lineGap = 27 * scale;
  const line =
    "Collect each zone's rune, restore the vale's colors and bring hidden treasures back to the altar.";
  ctx.fillText(line, w / 2, lineY);

  // Play button — the outline (not an animated glow) reads as clickable, and is the
  // only way to advance (pointerdown handler below hit-tests against menuBtn, not any
  // key/tap)
  const btnW = 150 * scale,
    btnH = 46 * scale;
  menuBtn = { x: w / 2 - btnW / 2, y: lineY + 1.4 * lineGap, w: btnW, h: btnH };
  drawPillButton(menuBtn, 'Play', scale);
  ctx.restore();
}

// celebration screen once every item's home and the hub lights up. Rainbow stars orbit
// and twinkle around the title using the same starPath/RAINBOW building blocks used
// everywhere else.
function drawEndingOverlay() {
  const w = canvas.width,
    h = canvas.height,
    scale = TILE / BASE_TILE,
    t = performance.now();
  drawDuskBg(COLORS.PINK_UI);

  ctx.save();
  const count = COLORS.RAINBOW.length;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + t / 1800;
    const radius = Math.min(w, h) * (0.32 + 0.05 * Math.sin(t / 500 + i));
    const starX = w / 2 + Math.cos(angle) * radius,
      starY = h / 2 + Math.sin(angle) * radius * 0.6;
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(t / 350 + i * 2) * 0.35;
    ctx.fillStyle = COLORS.RAINBOW[i];
    starPath(ctx, starX, starY, 8 * scale, 4, 0.3);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  const pulse = Math.sin(t / 450);
  ctx.save();
  ctx.textAlign = 'center';
  glowTitle(
    w / 2,
    h / 2 - 20 * scale,
    'The Vale is Restored',
    (38 + pulse * 2) * scale,
    (18 + pulse * 6) * scale
  );
  ctx.fillStyle = UI_LIGHT;
  ctx.font = `${16 * scale}px ${FONT}`;
  ctx.fillText('Thank you for playing', w / 2, h / 2 + 20 * scale);
  ctx.restore();
}

function draw() {
  // menu screen never has the world drawn underneath — see drawDuskBg's comment above
  if (gameState === 'menu') {
    drawMenuOverlay();
    requestAnimationFrame(draw);
    return;
  }
  // visual position continuously eases toward the logical one, independent of keypresses
  const now = performance.now();
  const dt = Math.min(48, now - (draw._last || now));
  draw._last = now;
  const follow = 1 - Math.pow(0.0025, dt / 1000); // ~framerate-independent
  const prevDispX = player.dispX,
    prevDispY = player.dispY;
  player.dispX += (player.x - player.dispX) * follow;
  player.dispY += (player.y - player.dispY) * follow;
  // two quick perpendicular steps (diagonal movement) can land close enough together
  // that the camera glides straight through the corner tile neither step entered. If
  // that corner is a wall, freeze the blocked axis for a few frames instead — a fixed
  // frame count rather than "wait until settled", since a held diagonal keeps advancing
  // the other axis's target and would never count as settled.
  // _hold's sign picks the axis (+ = x, - = y), its magnitude the frames left
  const blocked = (x, y) => !worldRunes.inBounds(x, y) || isBlockingFor(x, y);
  if (draw._hold > 0) {
    player.dispX = prevDispX;
    draw._hold--;
  } else if (draw._hold < 0) {
    player.dispY = prevDispY;
    draw._hold++;
  } else {
    const prevTileX = Math.round(prevDispX),
      prevTileY = Math.round(prevDispY),
      curTileX = Math.round(player.dispX),
      curTileY = Math.round(player.dispY);
    if (prevTileX !== curTileX && prevTileY !== curTileY) {
      if (blocked(curTileX, prevTileY)) {
        player.dispX = prevDispX;
        draw._hold = 8;
      } else if (blocked(prevTileX, curTileY)) {
        player.dispY = prevDispY;
        draw._hold = -8;
      }
    }
  }
  if (Math.abs(player.x - player.dispX) < 0.01) player.dispX = player.x;
  if (Math.abs(player.y - player.dispY) < 0.01) player.dispY = player.y;

  ctx.fillStyle = '#dff0ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const camX = player.dispX,
    camY = player.dispY;
  const originPxX = Math.round(canvas.width / 2 - camX * TILE - TILE / 2);
  const originPxY = Math.round(canvas.height / 2 - camY * TILE - TILE / 2);

  drawWorldTiles(originPxX, originPxY, camX, camY);
  // ground layer, same as the ice inside drawWorldTiles — has to land before any
  // highlight/preview/object draw now that it's opaque, not translucent enough to
  // show through
  renderPonds(originPxX, originPxY);
  drawCastHighlight(originPxX, originPxY);
  drawSpellPreview(originPxX, originPxY);
  drawPlates(originPxX, originPxY);
  drawInteractiveObjects(originPxX, originPxY);
  drawDecor(originPxX, originPxY, camX, camY);
  drawPrimitivePedestals(originPxX, originPxY);
  drawItems(originPxX, originPxY);
  drawHubAltar(originPxX, originPxY);
  drawDoors(originPxX, originPxY);
  // (sealed rune obstacles are already present in the precomputed world canvas)
  drawHubGlyph(originPxX, originPxY);
  drawPlayer();
  drawScreenFlash();
  drawVignette();

  if (hubActivated) {
    comboOverlay.width = 0;
    drawEndingOverlay();
  } else drawComboOverlay();

  requestAnimationFrame(draw);
}
generateTileVariants();

window.addEventListener('pointerdown', e => {
  const x = e.clientX,
    y = e.clientY;
  // declared `let` in engine-core.js so this handler can flip it — imports are
  // technically read-only, but build.js strips import/export before concatenating,
  // so at runtime it's just a plain global assignment.
  if (gameState === 'menu' && inRect(x, y, menuBtn)) {
    gameState = 'playing'; // eslint-disable-line no-import-assign
    startMusic();
  }
});

draw();
