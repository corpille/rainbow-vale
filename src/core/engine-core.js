/* ============ Base engine (carried over from the prototypes) ============ */
import { BLACK, TRANSPARENT, WHITE } from './colors.js';

export const BASE_TILE = 42; // tuned against a REF_MIN_DIM-tall/wide viewport — see resizeCanvas
// eslint-disable-next-line prefer-const -- reassigned in render-world.js's resizeCanvas()
export let TILE = BASE_TILE; // recomputed per-viewport so the amount of world visible stays consistent
export let VIEW_COLS, VIEW_ROWS;
// eslint-disable-next-line prefer-const -- reassigned by the pointerdown handler in render-hud.js
export let gameState = 'menu'; // 'menu' | 'playing' — see the start prompt in render-hud.js

// Fixed blob layouts for the mottled/bokeh floor & wall look: [x, y, r, alpha, rotation]
// as fractions of tile size. 3 layouts, one per pre-rendered tile variant (see
// generateTileVariants in render-world.js), so neighboring tiles don't repeat obviously.
export const BLOB_SETS = [
  [
    [0.22, 0.28, 0.28, 0.09, 0.4],
    [0.72, 0.22, 0.22, 0.11, 1.8],
    [0.4, 0.78, 0.32, 0.08, 3.0],
    [0.82, 0.68, 0.2, 0.12, 5.2],
  ],
  [
    [0.7, 0.3, 0.3, 0.1, 1.1],
    [0.25, 0.2, 0.2, 0.09, 2.6],
    [0.6, 0.72, 0.26, 0.11, 0.5],
    [0.18, 0.7, 0.22, 0.08, 4.4],
  ],
  [
    [0.5, 0.15, 0.24, 0.1, 2.2],
    [0.15, 0.55, 0.26, 0.09, 0.9],
    [0.78, 0.45, 0.22, 0.11, 3.6],
    [0.45, 0.82, 0.2, 0.08, 1.5],
  ],
];
export function textureFill(ctx, x, y, w, h, baseLight, baseDark, blobColor, blobs) {
  ctx.fillStyle = linGrad(ctx, x, y, x, y + h, [
    [0, baseLight],
    [1, baseDark],
  ]);
  ctx.fillRect(x, y, w, h);
  if (!blobs) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = blobColor;
  blobs.forEach(([bx, by, br, alpha, rot]) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(x + bx * w, y + by * h, br * w, br * w * 0.75, rot, 0, 7);
    ctx.fill();
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}
// Shared canvas helpers — the beginPath->shape->fill/stroke triplet repeats across
// decor.js/render.js with just the shape args changing.
export function fillEllipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, 7);
  ctx.fill();
}
export function fillCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
}
export function strokeCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.stroke();
}
export function radialFade(ctx, x, y, r, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, TRANSPARENT);
  return gradient;
}
// every other linear gradient in the game is just createLinearGradient + a couple
// addColorStop calls with the offsets/colors changing — shared here so each call site
// is just its own stops list instead of repeating the 2-4 lines of boilerplate
export function linGrad(ctx, x0, y0, x1, y1, stops) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  return gradient;
}
// radialFade+fillCircle recurs for glowing halos (pedestals, hub altar, mirror surfaces,
// sparkle motes) with only x/y/r/color changing — same idea as the triplet above.
export function glowFill(ctx, x, y, r, color) {
  ctx.fillStyle = radialFade(ctx, x, y, r, color);
  fillCircle(ctx, x, y, r);
}
// Much lighter than the original dark-palette version — the same alpha reads as a subtle
// groove on near-black tiles but a harsh stripe against bright pastels.
export function tileAO(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = linGrad(ctx, x, y, x, y + TILE, [
    [0, `${BLACK}14`],
    [0.15, TRANSPARENT],
    [0.9, TRANSPARENT],
    [1, `${WHITE}06`],
  ]);
  ctx.fillRect(x, y, TILE, TILE);
  ctx.restore();
}

// Whimsical rune icons — small filled charms (star/gem/flower/droplet/heart) instead
// of the old abstract carved-line sigils.
export function starPath(ctx, cx, cy, r, points = 5, inset = 0.5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inset;
    const ang = -Math.PI / 2 + (i * Math.PI) / points;
    const x = cx + Math.cos(ang) * rad,
      y = cy + Math.sin(ang) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}
export function gemPath(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.65, cy - r * 0.25);
  ctx.lineTo(cx + r * 0.4, cy + r);
  ctx.lineTo(cx - r * 0.4, cy + r);
  ctx.lineTo(cx - r * 0.65, cy - r * 0.25);
  ctx.closePath();
}
function flowerPath(ctx, cx, cy, r) {
  const petals = 5;
  ctx.beginPath();
  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2;
    const px = cx + Math.cos(angle) * r * 0.62,
      py = cy + Math.sin(angle) * r * 0.62;
    const c1x = cx + Math.cos(angle - 0.35) * r,
      c1y = cy + Math.sin(angle - 0.35) * r;
    const c2x = cx + Math.cos(angle + 0.35) * r,
      c2y = cy + Math.sin(angle + 0.35) * r;
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(c1x, c1y, px, py);
    ctx.quadraticCurveTo(c2x, c2y, cx, cy);
  }
  ctx.closePath();
}
function dropPath(ctx, cx, cy, r) {
  // Tip (cy-r) and round bottom (cy+r*0.55) aren't symmetric around cy, so drawn straight
  // this sits visibly high — shift the whole path down so its midpoint lands on cy.
  const oy = cy + r * 0.225;
  ctx.beginPath();
  ctx.moveTo(cx, oy - r);
  ctx.quadraticCurveTo(cx + r * 0.95, oy - r * 0.1, cx, oy + r * 0.55);
  ctx.quadraticCurveTo(cx - r * 0.95, oy - r * 0.1, cx, oy - r);
  ctx.closePath();
}
function heartPath(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.85);
  ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.15, cx - r * 0.5, cy - r, cx, cy - r * 0.3);
  ctx.bezierCurveTo(cx + r * 0.5, cy - r, cx + r * 1.3, cy - r * 0.15, cx, cy + r * 0.85);
  ctx.closePath();
}
// Numeric keys (star/gem/flower/drop/heart in order) — shorter than spelling names out,
// and safe since shapeKey is only ever compared by identity, never shown as text.
const RUNE_SHAPES = {
  0: starPath,
  1: gemPath,
  2: flowerPath,
  3: dropPath,
  4: heartPath,
};
export function iconGlyph(ctx, cx, cy, size, fillColor, accentColor, shapeKey) {
  ctx.save();
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = size * 0.6;
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  RUNE_SHAPES[shapeKey](ctx, cx, cy, size);
  if (fillColor) ctx.fill();
  ctx.stroke();
  ctx.restore();
}
