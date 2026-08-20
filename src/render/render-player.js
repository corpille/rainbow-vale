/* ============ Player sprite: side view and front/back view, walk cycle ============ */
import { COLORS, PONY_OUTLINE, UI_LIGHT, VIOLET } from '../core/colors.js';
import { BASE_TILE, TILE, fillCircle, fillEllipse } from '../core/engine-core.js';
import { player } from '../core/player.js';
import { canvas, ctx } from './render-world.js';

// mane/tail gradients all use the same 6-color rainbow at the same relative stops —
// only the gradient LINE (start/end point) differs per shape — so they share one
// offset scheme instead of each call re-declaring its own addColorStop list
const RAINBOW_STOPS = [0, 0.3, 0.5, 0.7, 0.8, 1];
// repeated 4x/3x below (ears, eye outlines) — local consts so Terser's toplevel
// mangling shrinks each call site to a single-char reference instead of the literal
const EAR_LILAC = '#d9c8f5';
const EYE_INK = '#3a3050';
function rainbowGradient(x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  COLORS.RAINBOW.forEach((c, i) => g.addColorStop(RAINBOW_STOPS[i], c));
  return g;
}
// the horn's gold-to-orange gradient is identical in all 3 views, just aimed along a
// different line each time
function hornGradient(x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#ffd980');
  g.addColorStop(1, '#ff9d5c');
  return g;
}
// walk-cycle offset formulas: down/up legs/hooves lift straight up, the side view's
// legs/hooves swing fore/aft instead
function legLift(moving, walkPhase, i) {
  return moving ? ((1 - Math.cos(walkPhase + i * Math.PI)) / 2) * 2.5 : 0;
}
function legSwing(moving, walkPhase, i) {
  return moving ? Math.sin(walkPhase + i * Math.PI) * 2.6 : 0;
}
// a point is [x, y] (moveTo the first entry, lineTo any later one) or [cx, cy, x, y]
// (quadraticCurveTo) — this replaces the moveTo/lineTo/quadraticCurveTo chain every
// shape below would otherwise repeat call-by-call
function tracePath(pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 2) ctx.lineTo(p[0], p[1]);
    else ctx.quadraticCurveTo(p[0], p[1], p[2], p[3]);
  }
}

// most shapes below are just "set a style, trace a path, fill (and maybe stroke) it" —
// these hold that boilerplate once so each shape below is just its style + its points
function fillStrokeGlow(fill, stroke, pts) {
  ctx.save();
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 6;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  tracePath(pts);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
function fillShape(fill, pts) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  tracePath(pts);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
// almost every call is one beginPath/tracePath/stroke, so a plain points array is
// enough — except the eye (+ lash), which strokes 2 independent subpaths in the same
// save/restore, so a callback is still accepted there
function strokeShape(color, width, ptsOrFn) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (typeof ptsOrFn === 'function') ptsOrFn();
  else {
    ctx.beginPath();
    tracePath(ptsOrFn);
    ctx.stroke();
  }
  ctx.restore();
}
function filledDot(fill, x, y, r, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  fillCircle(ctx, x, y, r);
  ctx.restore();
}

// the player token, always drawn dead-center of the screen
export function drawPlayer() {
  const px = canvas.width / 2,
    py = canvas.height / 2;
  // drawn in BASE_TILE-pixel units below — scale to the current TILE, plus a bit
  // extra so the character reads bigger than one bare tile
  ctx.save();
  ctx.translate(px, py);
  ctx.scale((1.2 * TILE) / BASE_TILE, (1.2 * TILE) / BASE_TILE);

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000000';
  fillEllipse(ctx, 0, 15, 9, 3);
  ctx.restore();

  const moving = Math.hypot(player.x - player.dispX, player.y - player.dispY) > 0.02;
  const walkPhase = performance.now() / 110;

  if (player.visualFacing === 'left') player.flip = -1;
  else if (player.visualFacing === 'right') player.flip = 1;

  if (player.visualFacing === 'down') {
    drawPonyDown(moving, walkPhase);
  } else if (player.visualFacing === 'up') {
    drawPonyUp(moving, walkPhase);
  } else {
    ctx.save();
    ctx.scale(player.flip, 1);
    drawPonySide(moving, walkPhase);
    ctx.restore();
  }

  ctx.restore(); // matches the outer translate/scale
}

// the down (facing camera) and up (facing away) views share the exact same legs,
// hooves, head, and body — seen from directly in front or behind, the pony's
// silhouette there doesn't change — so they're factored out once instead of
// duplicated in both draw functions below. Mane/tail/horn/face differ between
// the two and stay inline in each.
function drawFrontBackLegs(lift0, lift1) {
  // --- Leg (left) ---
  strokeShape(UI_LIGHT, 2.5, [
    [-3.7, 5.4],
    [-3.6, 8.8, -3.7, 12.4 - lift0],
  ]);

  // --- Leg (right) ---
  strokeShape(UI_LIGHT, 2.5, [
    [3.7, 5.1],
    [3.5, 8.8, 3.7, 12.1 - lift1],
  ]);
}
function drawFrontBackHooves(lift0, lift1) {
  // --- Left Hoof --- (translate instead of offsetting every point — equivalent, simpler)
  ctx.save();
  ctx.translate(0, -lift0);
  fillShape('#ffb3e6', [
    [-2.4, 12.1],
    [-2.5, 12.7, -2.7, 13.6],
    [-3.9, 13.8, -4.7, 13.6],
    [-4.9, 12.8, -4.9, 12.1],
  ]);
  ctx.restore();

  // --- Right Hoof ---
  ctx.save();
  ctx.translate(0, -lift1);
  fillShape('#ffb3e6', [
    [4.9, 11.9],
    [5, 12.5, 4.6, 13.4],
    [3.4, 13.6, 2.6, 13.4],
    [2.4, 12.6, 2.4, 11.9],
  ]);
  ctx.restore();
}
function drawFrontBackBody() {
  fillStrokeGlow(UI_LIGHT, PONY_OUTLINE, [
    [3.3, -3.5],
    [6.3, -2.1, 4.6, 5.2],
    [0.4, 8.9, -4.8, 5.4],
    [-6.4, -1.7, -3.5, -3.3],
    [-0.4, -5.4, 3.3, -3.5],
  ]);
}
function drawFrontBackHead() {
  fillStrokeGlow(UI_LIGHT, PONY_OUTLINE, [
    [1.9, -11.3],
    [4.2, -16.7, 5, -10.7],
    [5.7, -6.9, 4.4, -3.4],
    [-0.1, 3.4, -4.8, -3.4],
    [-6.3, -6.2, -5.7, -10.9],
    [-4.3, -16.3, -3, -11.3],
  ]);
}

function drawPonyDown(moving, walkPhase) {
  const lift0 = legLift(moving, walkPhase, 0);
  const lift1 = legLift(moving, walkPhase, 1);

  drawFrontBackLegs(lift0, lift1);

  drawFrontBackBody();

  drawFrontBackHead();

  // --- Ear (right) ---
  fillShape(EAR_LILAC, [
    [4.4, -10.7],
    [4, -15.4, 2.5, -11.2],
  ]);

  // --- Ear (left) ---
  fillShape(EAR_LILAC, [
    [-3.5, -10.8],
    [-4.2, -15.1, -5.3, -10.7],
  ]);

  // --- Blush ---
  filledDot(COLORS.PINK, -3.4, -3.4, 0.7, 0.5);
  filledDot(COLORS.PINK, 3, -3.5, 0.7, 0.5);

  // --- Top Mane ---
  fillShape(rainbowGradient(-7.6, -12.8, 5.3, -13.3), [
    [0.6, -12.5],
    [1.7, -11.9, 2.9, -11.1],
    [5.3, -10.3, 5.8, -11.9],
    [5.9, -9.6, 4.7, -8.9],
    [3.5, -8, 2.5, -8.9],
    [1.4, -7.1, -1.2, -7.8],
    [-0.1, -8.8, -0.8, -9.6],
    [-2.8, -8.1, -5.5, -7.9],
    [-7.1, -8.1, -7, -10.1],
    [-6.4, -9.1, -5.4, -10.2],
    [-3.8, -12.3, -1, -12.6],
  ]);

  // --- Left eye ---
  strokeShape(EYE_INK, 0.4, [
    [-3.3, -6.3],
    [-2.3, -5, -1.4, -6.3],
  ]);

  // --- Right Eye ---
  strokeShape(EYE_INK, 0.4, [
    [0.9, -6.3],
    [1.9, -5, 2.7, -6.4],
  ]);

  // --- Left Nose ---
  filledDot('#b0b0b0', -0.7, -2.2, 0.3);

  // --- Right Nose ---
  filledDot('#b0b0b0', 0.3, -2.2, 0.3);

  // --- Side Mane ---
  const sideManeGrad = ctx.createLinearGradient(-6.3, -6.5, -4.7, -0.3);
  sideManeGrad.addColorStop(0, '#66c7e8');
  sideManeGrad.addColorStop(1, VIOLET);
  fillShape(sideManeGrad, [
    [-5.5, -4.3],
    [-6.3, -4, -5.6, -1.3],
    [-5.3, 0, -6.3, 0.9],
    [-3.7, 1.2, -3.2, -1.1],
    [-5, -3, -5.2, -3.6],
  ]);

  drawFrontBackHooves(lift0, lift1);

  // --- Horn ---
  fillShape(hornGradient(-7.7, -13, -7.8, -9.8), [
    [0, -17.6],
    [1.1, -10.8],
    [-0.9, -10.8, -0.9, -11.4],
  ]);
}

function drawPonySide(moving, walkPhase) {
  const swing0 = legSwing(moving, walkPhase, 0);
  const swing1 = legSwing(moving, walkPhase, 1);

  // --- Leg (back) ---
  strokeShape(UI_LIGHT, 3, [
    [1, 5.2],
    [0 + swing0 * 0.4, 8.7, 1 + swing0, 12.2],
  ]);

  // --- Leg (front) ---
  strokeShape(UI_LIGHT, 3, [
    [-8.5, 5.4],
    [-9.2 + swing1 * 0.4, 9.5, -8.5 + swing1, 12.4],
  ]);

  // --- Hoof (back) --- (translate instead of offsetting every point)
  ctx.save();
  ctx.translate(swing0, 0);
  fillShape('#f7c5ee', [
    [2.3, 11.8],
    [3.7, 13.7, 2.7, 13.9],
    [1.6, 14.3, 0, 14.1],
    [-0.7, 13.2, -0.6, 12.1],
  ]);
  ctx.restore();

  // --- Hoof (front) ---
  ctx.save();
  ctx.translate(swing1, 0);
  fillShape('#f7c5ee', [
    [-7.2, 11.8],
    [-5.8, 13.7, -6.8, 13.9],
    [-7.9, 14.3, -9.5, 14.1],
    [-10.2, 13.2, -10.1, 12.1],
  ]);
  ctx.restore();

  // --- Tail ---
  fillShape(rainbowGradient(-10.5, -0.5, -17.1, 6.8), [
    [-10.3, 2.8],
    [-11.5, 4.3, -13.2, 6.1],
    [-17.8, 9.3, -20.2, 5.5],
    [-21.1, 2.2, -16.7, 1.4],
    [-18.9, 1.9, -18.7, 3.6],
    [-17.3, 6.7, -14.2, 1.1],
    [-12.8, -3.4, -9, -2.7],
  ]);

  // --- Body ---
  fillStrokeGlow(UI_LIGHT, PONY_OUTLINE, [
    [4.5, 2],
    [4.9, 5.6, 1.6, 7.1],
    [-3.1, 8.3, -7.1, 7.4],
    [-11.1, 6.9, -11.7, 1.3],
    [-12.1, -3, -7.4, -2.7],
    [-4.5, -2.4, 0.1, -2.9],
    [2.9, -2.1, 4.2, -0.6],
  ]);

  // --- Head ---
  fillStrokeGlow(UI_LIGHT, PONY_OUTLINE, [
    [5.3, -12.2],
    [8.3, -17.3, 8.4, -12.8],
    [10, -11.3, 10.2, -9.2],
    [10.2, -6.4, 12.4, -4.5],
    [12.4, -0.9, 8.1, 0.6],
    [6.5, 1, 2, -0.5],
    [-1.1, -1.9, -0.8, -4.8],
    [-0.9, -7.3, -0.2, -9.9],
    [-2.6, -17.4, 4, -11.7],
  ]);

  // --- Ear (back) ---
  fillShape(EAR_LILAC, [
    [0.3, -10.1],
    [-1.7, -15.8, 3.5, -11.6],
    [2.8, -10.4, 0.5, -10.2],
  ]);

  // --- Ear front (outer) ---
  fillShape(EAR_LILAC, [
    [5.9, -11.9],
    [8, -16.6, 8, -11.8],
    [7, -10.8, 6.1, -11.8],
  ]);

  // --- Mane ---
  fillShape(rainbowGradient(2.3, -15.6, -6.7, -5.9), [
    [6.1, -10.2],
    [3.6, -8, 0.8, -8.3],
    [-1.3, -4.4, -0.1, -2.4],
    [3.7, -0.8, 4.1, 0.8],
    [4.6, 3.4, 2.4, 4.5],
    [2.4, 2.6, 0.4, 1.4],
    [-7.5, -3.4, -1.1, -11.1],
    [4.1, -15, 9.3, -12.2],
    [11.5, -11.4, 12.1, -12.9],
    [12.4, -10.1, 8.3, -10.2],
    [8.5, -8.9, 5.1, -8.4],
    [6.4, -9.4, 6.1, -10.1],
  ]);

  // --- Horn ---
  fillShape(hornGradient(4.7, -14.1, 2.8, -12), [
    [8.9, -16.7],
    [6.5, -10.8],
    [4.9, -10.8, 4.6, -11.4],
  ]);

  // --- Eye (+ lash) ---
  strokeShape(EYE_INK, 0.3, () => {
    ctx.beginPath();
    tracePath([
      [8.8, -7],
      [7.8, -5.6, 6.2, -6.5],
    ]);
    ctx.stroke();
    ctx.beginPath();
    tracePath([
      [8.1, -1.6],
      [9.2, -1.1, 9.6, -2.1],
    ]);
    ctx.stroke();
  });

  // --- Blush ---
  filledDot('#ff9ad0', 4.8, -3.4, 0.9, 0.55);

  // --- Ear front (inner) --- (a degenerate single-point path — fills nothing, kept
  // faithful to the original hand-drawn sprite rather than "fixed")
  fillShape('#ff9ad0', [[-14.5, -5.5]]);
}

function drawPonyUp(moving, walkPhase) {
  const lift0 = legLift(moving, walkPhase, 0);
  const lift1 = legLift(moving, walkPhase, 1);

  drawFrontBackLegs(lift0, lift1);

  // --- Horn ---
  fillShape(hornGradient(-8.3, -13, -8.4, -9.8), [
    [-0.6, -17.6],
    [0.5, -10.8],
    [-1.7, -10.8, -1.5, -11.4],
  ]);

  drawFrontBackHooves(lift0, lift1);

  drawFrontBackHead();

  // --- Mane ---
  fillShape(rainbowGradient(9.5, -14.2, 9.8, -4.5), [
    [3.7, -2.9],
    [-0.2, -2.3, -4.2, -2.9],
    [-6.1, -6.8, -3.5, -10.9],
    [-2.8, -11.8, -1.3, -12],
    [1.2, -12.6, 2.7, -11.1],
    [3.8, -10.1, 4.1, -8.7],
    [4.5, -7, 3.8, -5.5],
    [3.4, -4.5, 4.3, -4],
    [5.2, -3.5, 5.9, -4.8],
    [6.4, -3, 4.7, -2.4],
  ]);

  drawFrontBackBody();

  // --- Tail ---
  fillShape(rainbowGradient(-1.3, -4.2, -0.5, 1.2), [
    [0.5, -1.4],
    [1.3, -0.8, 1.4, -0.2],
    [1.6, 2.8, -0.8, 3.2],
    [-2.4, 3.2, -2.6, 0.8],
    [-1.3, 1.7, -0.7, 1.3],
    [0.2, 0.4, -1.6, -0.8],
    [-2.9, -2, -2.6, -3.5],
    [-2.6, -4.2, -1.7, -4.9],
    [0.1, -5.7, 0.7, -4.3],
    [1.2, -3, 0.7, -2.4],
    [0, -2.1, 0.4, -1.5],
  ]);
}
