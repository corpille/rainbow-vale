/* ============ Screen effects, start menu, main draw() loop, page-level DOM wiring ============ */
import { COLORS, FONT, TRANSPARENT, UI_LIGHT } from '../core/colors.js';
import {
  BASE_TILE,
  TILE,
  gameState,
  iconGlyph,
  linGrad,
  runeCard,
  starPath,
} from '../core/engine-core.js';
import { SYMBOL_TO_ROLE, ZONES, isBlockingFor, worldRunes } from '../world/world-zones.js';
import { hubActivated, player } from '../core/player.js';
import { startMusic } from '../core/music.js';
import {
  RUNE_ACCENT,
  RUNE_SHAPE,
  comboOverlay,
  desc,
  drawComboOverlay,
  inRect,
  panelRect,
} from '../core/ui-panel.js';
import { canvas, ctx, generateTileVariants, renderPonds } from './render-world.js';
import {
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
  gradient.addColorStop(1, `${COLORS.NEAR_BLACK}40`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// shared full-bleed background for every non-gameplay screen (menu/ending) — the world
// is never drawn underneath them anyway (see draw()'s early return below). Only the
// bottom color stop varies per screen.
function drawDuskBg(bottomColor) {
  const w = canvas.width,
    h = canvas.height;
  ctx.fillStyle = linGrad(ctx, 0, 0, 0, h, [
    [0, COLORS.NEAR_BLACK],
    [0.6, '#5a4a8a'],
    [1, bottomColor],
  ]);
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

  // one save/restore for the whole frame instead of per-section — each block sets
  // what it needs, only shadowBlur is explicitly zeroed where unwanted
  ctx.save();
  ctx.textAlign = 'center';
  ctx.lineCap = 'round';

  // vertical layout: title/icons/description/button each offset from the one above, so
  // centering the block just means solving for titleY. titleFontPx*0.8 approximates how
  // far the title's ascenders reach above its (baseline-anchored) titleY.
  const titleFontPx = 46 * scale,
    titleTop = titleFontPx * 0.8,
    toIcons = 50 * scale,
    toLine = 60 * scale,
    lineGap = 27 * scale,
    toBtn = 1.4 * lineGap,
    btnH = 46 * scale;
  const contentH = titleTop + toIcons + toLine + toBtn + btnH;
  const titleY = h / 2 - contentH / 2 + titleTop;
  glowTitle(w / 2, titleY, 'Rainbow Vale', titleFontPx, 16 * scale);

  // the four runes to gather, same icon/color as the combo panel; row width clamped
  // to 80% of viewport so it never overflows on narrow phones
  const iconY = titleY + toIcons,
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

  // spells out what's going on and the 3-step goal loop so a first-time player isn't
  // lost — the phrase-then-cast combo mechanic especially needs a sentence somewhere
  ctx.fillStyle = UI_LIGHT;
  ctx.font = `${15 * scale}px ${FONT}`;
  const lineY = iconY + toLine;
  const line = 'Gather every rune, bring each treasure home, free the colors.';
  ctx.fillText(line, w / 2, lineY);

  // Play button — the outline (not a glow) reads as clickable, and it's the only way
  // to advance (pointerdown handler below hit-tests against menuBtn, not any key/tap)
  const btnW = 150 * scale;
  menuBtn = { x: w / 2 - btnW / 2, y: lineY + toBtn, w: btnW, h: btnH };
  drawPillButton(menuBtn, 'Play', scale);
  ctx.restore();
}

// celebration screen once every item's home and the hub lights up — rainbow stars
// orbit and twinkle around the title using the same starPath/RAINBOW building blocks.
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

// ---- Rune teaching card ----
// The bar only names a role once the rune is already sitting in a slot, which makes each
// rune read as one fixed spell. This fires on pickup and shows it filling all three.
const SLOT_TITLES = ['POWER', 'SHAPE', 'EFFECT'];
// plain-language gloss per rune, per slot. Keyed by zone id and indexed by slot rather
// than keyed by the enum values — m/j/v/b are already in build.js's property-mangling
// reserve list, PUSH/THROUGH/... are not.
const RUNE_HINTS = {
  m: ['Shoves things', 'Straight ahead', 'Through walls'],
  j: ['Water to ice', 'All around', 'Reverses the power'],
  v: ['Cuts vines', 'Diagonally', 'Spreads out'],
  b: ['Splits rock', 'Widening fan', 'Trade places'],
};
function drawRuneCard() {
  const w = canvas.width,
    h = canvas.height,
    scale = TILE / BASE_TILE,
    accent = RUNE_ACCENT[runeCard],
    role = SYMBOL_TO_ROLE[runeCard],
    // read straight off SYMBOL_TO_ROLE: the bar's DESC_BY_SLOT folds Freeze+Reverse into
    // "Thaw", true only for that pairing and misleading on a card about the rune alone
    labels = [desc(role.slot1), desc(role.slot2), desc(role.slot3)];

  ctx.save();
  ctx.fillStyle = `${COLORS.NEAR_BLACK}e8`;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';

  const cy = h / 2;
  iconGlyph(ctx, w / 2, cy - 86 * scale, 30 * scale, UI_LIGHT, accent, RUNE_SHAPE[runeCard]);
  ctx.fillStyle = UI_LIGHT;
  ctx.font = `700 ${17 * scale}px ${FONT}`;
  ctx.fillText('New rune unlocked', w / 2, cy - 30 * scale);

  const colW = 150 * scale; // three columns; scale already tracks the viewport
  for (let i = 0; i < 3; i++) {
    const cx = w / 2 + (i - 1) * colW;
    ctx.fillStyle = accent;
    ctx.font = `700 ${11 * scale}px ${FONT}`;
    ctx.fillText(SLOT_TITLES[i], cx, cy + 6 * scale);
    ctx.fillStyle = UI_LIGHT;
    ctx.font = `700 ${16 * scale}px ${FONT}`;
    ctx.fillText(labels[i], cx, cy + 30 * scale);
    ctx.fillStyle = COLORS.CREAM;
    ctx.font = `${12 * scale}px ${FONT}`;
    ctx.fillText(RUNE_HINTS[runeCard][i], cx, cy + 50 * scale);
  }

  ctx.fillStyle = COLORS.CREAM;
  ctx.font = `${13 * scale}px ${FONT}`;
  ctx.fillText('Its slot in the phrase picks which one', w / 2, cy + 86 * scale);
  ctx.fillStyle = accent;
  ctx.fillText('Press any key to continue', w / 2, cy + 112 * scale);
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
  // two quick perpendicular steps (diagonal movement) can land close enough that the
  // camera glides through the corner tile neither step entered. If that corner's a wall,
  // freeze the blocked axis for a few frames instead of waiting for things to settle.
  // _hold's sign picks the axis (+ = x, - = y), its magnitude is the frames left.
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

  const originPx = {x: originPxX, y: originPxY};

  drawWorldTiles(originPx, camX, camY);
  // ground layer, same as the ice inside drawWorldTiles — has to draw before any
  // highlight/preview/object now that it's opaque, not translucent enough to show through
  renderPonds(originPx.x, originPx.y);
  drawSpellPreview(originPx);
  drawPlates(originPx);
  drawDecor(originPx, camX, camY);
  drawPrimitivePedestals(originPx);
  drawItems(originPx);
  drawHubAltar(originPx);
  drawDoors(originPx);
  // (sealed rune obstacles are already present in the precomputed world canvas)
  drawHubGlyph(originPx);
  // objects (crate/vine/mirror/lock) drawn this late so a crate standing in front of a
  // tree/mushroom's tall canopy reads as in front of it, not swallowed behind the decor
  drawInteractiveObjects(originPx);
  drawPlayer();
  drawVignette();

  if (hubActivated) {
    comboOverlay.width = 0;
    drawEndingOverlay();
  } else {
    drawComboOverlay();
    // after the bar's own redraw, which fades itself out to match (see drawComboOverlay)
    if (gameState === 'card') {
      drawRuneCard();
      cardArmed = 1;
    }
  }

  requestAnimationFrame(draw);
}
generateTileVariants();

window.addEventListener('pointerdown', e => {
  const x = e.clientX,
    y = e.clientY;
  // declared `let` in engine-core.js so this handler can flip it — imports are normally
  // read-only, but build.js strips import/export before concatenating, so this is
  // really just a plain global assignment at runtime.
  if (gameState === 'menu' && inRect(x, y, menuBtn)) {
    gameState = 'playing'; // eslint-disable-line no-import-assign
    startMusic();
  } else dismissCard();
});
// Any key or click dismisses the card, except the keypress that opened it: the pickup
// runs in player.js's keydown, registered earlier in the concat order, so this listener
// fires on that same event. cardArmed only goes up once draw() has painted the card.
let cardArmed = 0;
function dismissCard() {
  if (gameState !== 'card' || !cardArmed) return;
  cardArmed = 0;
  gameState = 'playing'; // eslint-disable-line no-import-assign
}
// e.repeat skips the browser's auto-repeat — you walk onto a pedestal with the movement
// key still held, and the repeats would close the card half a second after it appeared
window.addEventListener('keydown', e => {
  if (!e.repeat) dismissCard();
});

draw();
Wavedash.init();
