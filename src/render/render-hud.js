/* ============ Screen effects, start menu, main draw() loop, page-level DOM wiring ============ */
import { COLORS, FONT, TRANSPARENT, UI_LIGHT } from '../core/colors.js';
import { BASE_TILE, TILE, gameState, iconGlyph, starPath } from '../core/engine-core.js';
import { ZONES } from '../world/world-zones.js';
import { drawTouchStick, hubActivated, player, screenFlash } from '../core/player.js';
import { startMusic } from '../core/music.js';
import { RUNE_ACCENT, RUNE_SHAPE, drawComboOverlay, inRect, panelRect } from '../core/ui-panel.js';
import { canvas, ctx, generateTileVariants } from './render-world.js';
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
  const vg = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.25,
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.75
  );
  vg.addColorStop(0, TRANSPARENT);
  vg.addColorStop(1, '#3a2f5540');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// shared full-bleed background for every non-gameplay screen (menu/intro/ending) — the
// world is never drawn underneath any of them (see draw()'s early return below): this
// gradient is opaque, so it would just hide the world anyway, making that rendering
// pure waste. Only the bottom color stop varies per screen.
function drawDuskBg(bottomColor) {
  const w = canvas.width,
    h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, COLORS.NEAR_BLACK);
  g.addColorStop(0.6, '#5a4a8a');
  g.addColorStop(1, bottomColor);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
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
  COLORS.RAINBOW.forEach((c, i) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 5 * scale;
    ctx.beginPath();
    ctx.arc(w / 2, archY, (30 + i * 7) * scale, Math.PI, 0);
    ctx.stroke();
  });

  const titleY = archY + 90 * scale;
  ctx.fillStyle = COLORS.PINK_GLOW;
  ctx.shadowColor = COLORS.PINK_WARM;
  ctx.shadowBlur = 16 * scale;
  ctx.font = `700 ${46 * scale}px ${FONT}`;
  ctx.fillText('Rainbow Vale', w / 2, titleY);
  ctx.shadowBlur = 0;

  // the four runes to gather, same icon/color as the combo panel; row width clamped
  // to 80% of viewport so it never overflows on narrow phones
  const iconY = titleY + 50 * scale,
    spacing = Math.min(70 * scale, (w * 0.8) / (ZONES.length - 1)),
    totalW = spacing * (ZONES.length - 1);
  ZONES.forEach((z, i) => {
    iconGlyph(
      ctx,
      w / 2 - totalW / 2 + spacing * i,
      iconY,
      22 * scale,
      UI_LIGHT,
      RUNE_ACCENT[z.id],
      RUNE_SHAPE[z.id]
    );
  });

  // Play button — the outline (not an animated glow) reads as clickable, and is the
  // only way to advance (pointerdown handler below hit-tests against menuBtn, not any
  // key/tap)
  const btnW = 150 * scale,
    btnH = 46 * scale;
  menuBtn = { x: w / 2 - btnW / 2, y: iconY + 55 * scale, w: btnW, h: btnH };
  drawPillButton(menuBtn, 'Play', scale);
  ctx.restore();
}

let introBtn = null; // {x,y,w,h} — see the pointerdown handler below
// between menu and gameplay: what's going on, and the 3-step goal loop, so a first-time
// player isn't dropped in with zero context (the C-key combo mechanic especially needs
// a sentence — nothing else hints at it before this)
function drawIntroOverlay() {
  const w = canvas.width,
    h = canvas.height,
    scale = TILE / BASE_TILE;

  drawDuskBg(COLORS.PURPLE);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.PINK_GLOW;
  ctx.shadowColor = COLORS.PINK_WARM;
  ctx.shadowBlur = 12 * scale;
  ctx.font = `700 ${26 * scale}px ${FONT}`;
  ctx.fillText('The Vale has lost its color', w / 2, h * 0.28);
  ctx.shadowBlur = 0;

  ctx.fillStyle = UI_LIGHT;
  ctx.font = `${15 * scale}px ${FONT}`;
  const lineY = h * 0.28 + 40 * scale,
    lineGap = 27 * scale;
  [
    "Collect each zone's rune, then press C to cast spells and clear your path.",
    'Bring hidden treasures back to the altar.',
  ].forEach((line, i) => ctx.fillText(line, w / 2, lineY + i * lineGap));

  const btnW = 150 * scale,
    btnH = 46 * scale;
  introBtn = { x: w / 2 - btnW / 2, y: lineY + 2.4 * lineGap, w: btnW, h: btnH };
  drawPillButton(introBtn, 'Start', scale);
  ctx.restore();
}

// celebration screen once every item's home and the hub lights up. Rainbow stars orbit
// and twinkle around the title (same starPath/RAINBOW building blocks used everywhere
// else — orbit math borrowed from drawHubAltar's progress stars, pulse from
// renderLockGate's glow) instead of the plain static text the first draft had.
function drawEndingOverlay() {
  const w = canvas.width,
    h = canvas.height,
    scale = TILE / BASE_TILE,
    t = performance.now();
  drawDuskBg(COLORS.PINK_UI);

  ctx.save();
  const n = COLORS.RAINBOW.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t / 1800;
    const r = Math.min(w, h) * (0.32 + 0.05 * Math.sin(t / 500 + i));
    const sx = w / 2 + Math.cos(a) * r,
      sy = h / 2 + Math.sin(a) * r * 0.6;
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(t / 350 + i * 2) * 0.35;
    ctx.fillStyle = COLORS.RAINBOW[i];
    starPath(ctx, sx, sy, 8 * scale, 4, 0.3);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  const pulse = Math.sin(t / 450);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.PINK_GLOW;
  ctx.shadowColor = COLORS.PINK_WARM;
  ctx.shadowBlur = (18 + pulse * 6) * scale;
  ctx.font = `700 ${(38 + pulse * 2) * scale}px ${FONT}`;
  ctx.fillText('The Vale is Restored', w / 2, h / 2 - 20 * scale);
  ctx.shadowBlur = 0;
  ctx.fillStyle = UI_LIGHT;
  ctx.font = `${16 * scale}px ${FONT}`;
  ctx.fillText('Thank you for playing', w / 2, h / 2 + 20 * scale);
  ctx.restore();
}

function draw() {
  // neither screen ever has the world drawn underneath — see drawDuskBg's comment above
  if (gameState === 'menu' || gameState === 'intro') {
    if (gameState === 'menu') drawMenuOverlay();
    else drawIntroOverlay();
    requestAnimationFrame(draw);
    return;
  }
  // visual position continuously eases toward the logical one, independent of keypresses
  const now0 = performance.now();
  const dt0 = Math.min(48, now0 - (draw._last || now0));
  draw._last = now0;
  const follow = 1 - Math.pow(0.0025, dt0 / 1000); // ~framerate-independent
  player.dispX += (player.x - player.dispX) * follow;
  player.dispY += (player.y - player.dispY) * follow;
  if (Math.abs(player.x - player.dispX) < 0.01) player.dispX = player.x;
  if (Math.abs(player.y - player.dispY) < 0.01) player.dispY = player.y;

  ctx.fillStyle = '#dff0ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const camX = player.dispX,
    camY = player.dispY;
  const originPxX = Math.round(canvas.width / 2 - camX * TILE - TILE / 2);
  const originPxY = Math.round(canvas.height / 2 - camY * TILE - TILE / 2);

  drawWorldTiles(originPxX, originPxY, camX, camY);
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
  drawTouchStick();

  if (hubActivated) drawEndingOverlay();
  else drawComboOverlay();

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
    gameState = 'intro'; // eslint-disable-line no-import-assign
  } else if (gameState === 'intro' && inRect(x, y, introBtn)) {
    gameState = 'playing'; // eslint-disable-line no-import-assign
    startMusic();
  }
});

draw();
