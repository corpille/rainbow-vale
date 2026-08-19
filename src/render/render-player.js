/* ============ Player sprite: side view and front/back view, walk cycle ============ */
import { COLORS, PONY_OUTLINE, UI_LIGHT } from '../core/colors.js';
import { BASE_TILE, TILE, fillCircle, fillEllipse } from '../core/engine-core.js';
import { player } from '../core/player.js';
import { canvas, ctx } from './render-world.js';

// mane/tail gradients all use the same 6-color rainbow at the same relative stops —
// only the gradient LINE (start/end point) differs per shape — so they share one
// offset scheme (previously the tail used its own [0,.1,.3,.5,.8,1]; unified onto
// the mane's here) instead of each call re-declaring its own addColorStop list
const RAINBOW_STOPS = [0, 0.3, 0.5, 0.7, 0.8, 1];
function rainbowGradient(x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  COLORS.RAINBOW.forEach((c, i) => g.addColorStop(RAINBOW_STOPS[i], c));
  return g;
}
// the horn's gold-to-orange gradient is identical in all 3 views, just aimed along
// a different line each time
function hornGradient(x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#ffd980');
  g.addColorStop(1, '#ff9d5c');
  return g;
}
// down/up share the same walk-cycle lift formula for their legs/hooves (side view's
// fore/aft swing is only ever used once, so it stays inline in drawPonySide)
function legLift(moving, walkPhase, i) {
  return moving ? ((1 - Math.cos(walkPhase + i * Math.PI)) / 2) * 2.5 : 0;
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

  // up/down get a dedicated front/back sprite (drawPonyFrontBack) instead of rotating
  // the side view — rotating it to face up/down used to swing the horn under the face,
  // reading as a tail instead of a horn
  if (player.visualFacing === 'down') {
    drawPonyDown(moving, walkPhase);
  } else if (player.visualFacing === 'up') {
    drawPonyUp(moving, walkPhase);
    // drawPonyFrontBack(player.visualFacing === 'down', moving, walkPhase);
  } else {
    ctx.save();
    ctx.scale(player.flip, 1);
    drawPonySide(moving, walkPhase);
    ctx.restore();
  }

  ctx.restore(); // matches the outer translate/scale
}

// the down (facing camera) and up (facing away) views share the exact same legs,
// hooves, and head — seen from directly in front or behind, the pony's silhouette
// there doesn't change — so they're factored out once instead of duplicated in
// both draw functions below. Body/mane/tail/horn/face differ between the two and
// stay inline in each.
function drawFrontBackLegs(lift0, lift1) {
  // --- Leg (left) ---
  ctx.save();
  ctx.strokeStyle = UI_LIGHT;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-3.7, 5.4);
  ctx.quadraticCurveTo(-3.6, 8.8, -3.7, 12.4 - lift0);
  ctx.stroke();
  ctx.restore();

  // --- Leg (right) ---
  ctx.save();
  ctx.strokeStyle = UI_LIGHT;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(3.7, 5.1);
  ctx.quadraticCurveTo(3.5, 8.8, 3.7, 12.1 - lift1);
  ctx.stroke();
  ctx.restore();
}
function drawFrontBackHooves(lift0, lift1) {
  // --- Left Hoof ---
  ctx.save();
  ctx.fillStyle = '#ffb3e6';
  ctx.beginPath();
  ctx.moveTo(-2.4, 12.1 - lift0);
  ctx.quadraticCurveTo(-2.5, 12.7 - lift0, -2.7, 13.6 - lift0);
  ctx.quadraticCurveTo(-3.9, 13.8 - lift0, -4.7, 13.6 - lift0);
  ctx.quadraticCurveTo(-4.9, 12.8 - lift0, -4.9, 12.1 - lift0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Right Hoof ---
  ctx.save();
  ctx.fillStyle = '#ffb3e6';
  ctx.beginPath();
  ctx.moveTo(4.9, 11.9 - lift1);
  ctx.quadraticCurveTo(5, 12.5 - lift1, 4.6, 13.4 - lift1);
  ctx.quadraticCurveTo(3.4, 13.6 - lift1, 2.6, 13.4 - lift1);
  ctx.quadraticCurveTo(2.4, 12.6 - lift1, 2.4, 11.9 - lift1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawFrontBackBody() {
  ctx.save();
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 6;
  ctx.fillStyle = UI_LIGHT;
  ctx.strokeStyle = PONY_OUTLINE;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(3.3, -3.5);
  ctx.quadraticCurveTo(6.3, -2.1, 4.6, 5.2);
  ctx.quadraticCurveTo(0.4, 8.9, -4.8, 5.4);
  ctx.quadraticCurveTo(-6.4, -1.7, -3.5, -3.3);
  ctx.quadraticCurveTo(-0.4, -5.4, 3.3, -3.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
function drawFrontBackHead() {
  ctx.save();
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 6;
  ctx.fillStyle = UI_LIGHT;
  ctx.strokeStyle = PONY_OUTLINE;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(1.9, -11.3);
  ctx.quadraticCurveTo(4.2, -16.7, 5, -10.7);
  ctx.quadraticCurveTo(5.7, -6.9, 4.4, -3.4);
  ctx.quadraticCurveTo(-0.1, 3.4, -4.8, -3.4);
  ctx.quadraticCurveTo(-6.3, -6.2, -5.7, -10.9);
  ctx.quadraticCurveTo(-4.3, -16.3, -3, -11.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPonyDown(moving, walkPhase) {
  const lift0 = legLift(moving, walkPhase, 0);
  const lift1 = legLift(moving, walkPhase, 1);

  drawFrontBackLegs(lift0, lift1);

  drawFrontBackBody();

  drawFrontBackHead();

  // --- Ear (right) ---
  ctx.save();
  ctx.fillStyle = '#d9c8f5';
  ctx.beginPath();
  ctx.moveTo(4.4, -10.7);
  ctx.quadraticCurveTo(4, -15.4, 2.5, -11.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Ear (left) ---
  ctx.save();
  ctx.fillStyle = '#d9c8f5';
  ctx.beginPath();
  ctx.moveTo(-3.5, -10.8);
  ctx.quadraticCurveTo(-4.2, -15.1, -5.3, -10.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Blush ---
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = COLORS.PINK;
  fillCircle(ctx, -3.4, -3.4, 0.7);
  ctx.fillStyle = COLORS.PINK;
  fillCircle(ctx, 3, -3.5, 0.7);
  ctx.restore();

  // --- Top Mane ---
  ctx.save();
  ctx.fillStyle = rainbowGradient(-7.6, -12.8, 5.3, -13.3);
  ctx.beginPath();
  ctx.moveTo(0.6, -12.5);
  ctx.quadraticCurveTo(1.7, -11.9, 2.9, -11.1);
  ctx.quadraticCurveTo(5.3, -10.3, 5.8, -11.9);
  ctx.quadraticCurveTo(5.9, -9.6, 4.7, -8.9);
  ctx.quadraticCurveTo(3.5, -8, 2.5, -8.9);
  ctx.quadraticCurveTo(1.4, -7.1, -1.2, -7.8);
  ctx.quadraticCurveTo(-0.1, -8.8, -0.8, -9.6);
  ctx.quadraticCurveTo(-2.8, -8.1, -5.5, -7.9);
  ctx.quadraticCurveTo(-7.1, -8.1, -7, -10.1);
  ctx.quadraticCurveTo(-6.4, -9.1, -5.4, -10.2);
  ctx.quadraticCurveTo(-3.8, -12.3, -1, -12.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Left eye ---
  ctx.save();
  ctx.strokeStyle = '#3a3050';
  ctx.lineWidth = 0.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-3.3, -6.3);
  ctx.quadraticCurveTo(-2.3, -5, -1.4, -6.3);
  ctx.stroke();
  ctx.restore();

  // --- Right Eye ---
  ctx.save();
  ctx.strokeStyle = '#3a3050';
  ctx.lineWidth = 0.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0.9, -6.3);
  ctx.quadraticCurveTo(1.9, -5, 2.7, -6.4);
  ctx.stroke();
  ctx.restore();

  // --- Left Nose ---
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#b0b0b0';
  fillCircle(ctx, -0.7, -2.2, 0.3);
  ctx.restore();

  // --- Right Nose ---
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#b0b0b0';
  fillCircle(ctx, 0.3, -2.2, 0.3);
  ctx.restore();

  // --- Side Mane ---
  ctx.save();
  const custom7Grad = ctx.createLinearGradient(-6.3, -6.5, -4.7, -0.3);
  custom7Grad.addColorStop(0, '#66c7e8');
  custom7Grad.addColorStop(1, '#9d7bff');
  ctx.fillStyle = custom7Grad;
  ctx.beginPath();
  ctx.moveTo(-5.5, -4.3);
  ctx.quadraticCurveTo(-6.3, -4, -5.6, -1.3);
  ctx.quadraticCurveTo(-5.3, 0, -6.3, 0.9);
  ctx.quadraticCurveTo(-3.7, 1.2, -3.2, -1.1);
  ctx.quadraticCurveTo(-5, -3, -5.2, -3.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawFrontBackHooves(lift0, lift1);

  // --- Horn ---
  ctx.save();
  ctx.fillStyle = hornGradient(-7.7, -13, -7.8, -9.8);
  ctx.beginPath();
  ctx.moveTo(0, -17.6);
  ctx.lineTo(1.1, -10.8);
  ctx.quadraticCurveTo(-0.9, -10.8, -0.9, -11.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPonySide(moving, walkPhase) {
  const swing0 = moving ? Math.sin(walkPhase + 0 * Math.PI) * 2.6 : 0;

  const swing1 = moving ? Math.sin(walkPhase + 1 * Math.PI) * 2.6 : 0;

  // --- Leg (back) ---
  ctx.save();
  ctx.strokeStyle = UI_LIGHT;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(1, 5.2);
  ctx.quadraticCurveTo(0 + swing0 * 0.4, 8.7, 1 + swing0, 12.2);
  ctx.stroke();
  ctx.restore();

  // --- Leg (front) ---
  ctx.save();
  ctx.strokeStyle = UI_LIGHT;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8.5, 5.4);
  ctx.quadraticCurveTo(-9.2 + swing1 * 0.4, 9.5, -8.5 + swing1, 12.4);
  ctx.stroke();
  ctx.restore();

  // --- Hoof (back) ---
  ctx.save();
  ctx.fillStyle = '#f7c5ee';
  ctx.beginPath();
  ctx.moveTo(2.3 + swing0, 11.8);
  ctx.quadraticCurveTo(3.7 + swing0, 13.7, 2.7 + swing0, 13.9);
  ctx.quadraticCurveTo(1.6 + swing0, 14.3, 0 + swing0, 14.1);
  ctx.quadraticCurveTo(-0.7 + swing0, 13.2, -0.6 + swing0, 12.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Hoof (front) ---
  ctx.save();
  ctx.fillStyle = '#f7c5ee';
  ctx.beginPath();
  ctx.moveTo(-7.2 + swing1, 11.8);
  ctx.quadraticCurveTo(-5.8 + swing1, 13.7, -6.8 + swing1, 13.9);
  ctx.quadraticCurveTo(-7.9 + swing1, 14.3, -9.5 + swing1, 14.1);
  ctx.quadraticCurveTo(-10.2 + swing1, 13.2, -10.1 + swing1, 12.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Tail ---
  ctx.save();
  ctx.fillStyle = rainbowGradient(-10.5, -0.5, -17.1, 6.8);
  ctx.beginPath();
  ctx.moveTo(-10.3, 2.8);
  ctx.quadraticCurveTo(-11.5, 4.3, -13.2, 6.1);
  ctx.quadraticCurveTo(-17.8, 9.3, -20.2, 5.5);
  ctx.quadraticCurveTo(-21.1, 2.2, -16.7, 1.4);
  ctx.quadraticCurveTo(-18.9, 1.9, -18.7, 3.6);
  ctx.quadraticCurveTo(-17.3, 6.7, -14.2, 1.1);
  ctx.quadraticCurveTo(-12.8, -3.4, -9, -2.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Body ---
  ctx.save();
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 6;
  ctx.fillStyle = UI_LIGHT;
  ctx.strokeStyle = PONY_OUTLINE;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(4.5, 2);
  ctx.quadraticCurveTo(4.9, 5.6, 1.6, 7.1);
  ctx.quadraticCurveTo(-3.1, 8.3, -7.1, 7.4);
  ctx.quadraticCurveTo(-11.1, 6.9, -11.7, 1.3);
  ctx.quadraticCurveTo(-12.1, -3, -7.4, -2.7);
  ctx.quadraticCurveTo(-4.5, -2.4, 0.1, -2.9);
  ctx.quadraticCurveTo(2.9, -2.1, 4.2, -0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // --- Head ---
  ctx.save();
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 6;
  ctx.fillStyle = UI_LIGHT;
  ctx.strokeStyle = PONY_OUTLINE;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(5.3, -12.2);
  ctx.quadraticCurveTo(8.3, -17.3, 8.4, -12.8);
  ctx.quadraticCurveTo(10, -11.3, 10.2, -9.2);
  ctx.quadraticCurveTo(10.2, -6.4, 12.4, -4.5);
  ctx.quadraticCurveTo(12.4, -0.9, 8.1, 0.6);
  ctx.quadraticCurveTo(6.5, 1, 2, -0.5);
  ctx.quadraticCurveTo(-1.1, -1.9, -0.8, -4.8);
  ctx.quadraticCurveTo(-0.9, -7.3, -0.2, -9.9);
  ctx.quadraticCurveTo(-2.6, -17.4, 4, -11.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // --- Ear (back) ---
  ctx.save();
  ctx.fillStyle = '#d9c8f5';
  ctx.beginPath();
  ctx.moveTo(0.3, -10.1);
  ctx.quadraticCurveTo(-1.7, -15.8, 3.5, -11.6);
  ctx.quadraticCurveTo(2.8, -10.4, 0.5, -10.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Ear front (outer) ---
  ctx.save();
  ctx.fillStyle = '#d9c8f5';
  ctx.beginPath();
  ctx.moveTo(5.9, -11.9);
  ctx.quadraticCurveTo(8, -16.6, 8, -11.8);
  ctx.quadraticCurveTo(7, -10.8, 6.1, -11.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Mane ---
  ctx.save();
  ctx.fillStyle = rainbowGradient(2.3, -15.6, -6.7, -5.9);
  ctx.beginPath();
  ctx.moveTo(6.1, -10.2);
  ctx.quadraticCurveTo(3.6, -8, 0.8, -8.3);
  ctx.quadraticCurveTo(-1.3, -4.4, -0.1, -2.4);
  ctx.quadraticCurveTo(3.7, -0.8, 4.1, 0.8);
  ctx.quadraticCurveTo(4.6, 3.4, 2.4, 4.5);
  ctx.quadraticCurveTo(2.4, 2.6, 0.4, 1.4);
  ctx.quadraticCurveTo(-7.5, -3.4, -1.1, -11.1);
  ctx.quadraticCurveTo(4.1, -15, 9.3, -12.2);
  ctx.quadraticCurveTo(11.5, -11.4, 12.1, -12.9);
  ctx.quadraticCurveTo(12.4, -10.1, 8.3, -10.2);
  ctx.quadraticCurveTo(8.5, -8.9, 5.1, -8.4);
  ctx.quadraticCurveTo(6.4, -9.4, 6.1, -10.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Horn ---
  ctx.save();
  ctx.fillStyle = hornGradient(4.7, -14.1, 2.8, -12);
  ctx.beginPath();
  ctx.moveTo(8.9, -16.7);
  ctx.lineTo(6.5, -10.8);
  ctx.quadraticCurveTo(4.9, -10.8, 4.6, -11.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Eye (+ lash) ---
  ctx.save();
  ctx.strokeStyle = '#3a3050';
  ctx.lineWidth = 0.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8.8, -7);
  ctx.quadraticCurveTo(7.8, -5.6, 6.2, -6.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8.1, -1.6);
  ctx.quadraticCurveTo(9.2, -1.1, 9.6, -2.1);
  ctx.stroke();
  ctx.restore();

  // --- Blush ---
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#ff9ad0';
  fillCircle(ctx, 4.8, -3.4, 0.9);
  ctx.restore();
}

function drawPonyUp(moving, walkPhase) {
  const lift0 = legLift(moving, walkPhase, 0);
  const lift1 = legLift(moving, walkPhase, 1);

  drawFrontBackLegs(lift0, lift1);

  // --- Horn ---
  ctx.save();
  ctx.fillStyle = hornGradient(-8.3, -13, -8.4, -9.8);
  ctx.beginPath();
  ctx.moveTo(-0.6, -17.6);
  ctx.lineTo(0.5, -10.8);
  ctx.quadraticCurveTo(-1.7, -10.8, -1.5, -11.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawFrontBackHooves(lift0, lift1);

  drawFrontBackHead();

  // --- Mane ---
  ctx.save();
  ctx.fillStyle = rainbowGradient(9.5, -14.2, 9.8, -4.5);
  ctx.beginPath();
  ctx.moveTo(3.7, -2.9);
  ctx.quadraticCurveTo(-0.2, -2.3, -4.2, -2.9);
  ctx.quadraticCurveTo(-6.1, -6.8, -3.5, -10.9);
  ctx.quadraticCurveTo(-2.8, -11.8, -1.3, -12);
  ctx.quadraticCurveTo(1.2, -12.6, 2.7, -11.1);
  ctx.quadraticCurveTo(3.8, -10.1, 4.1, -8.7);
  ctx.quadraticCurveTo(4.5, -7, 3.8, -5.5);
  ctx.quadraticCurveTo(3.4, -4.5, 4.3, -4);
  ctx.quadraticCurveTo(5.2, -3.5, 5.9, -4.8);
  ctx.quadraticCurveTo(6.4, -3, 4.7, -2.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawFrontBackBody();

  // --- Tail ---
  ctx.save();
  ctx.fillStyle = rainbowGradient(-1.3, -4.2, -0.5, 1.2);
  ctx.beginPath();
  ctx.moveTo(0.5, -1.4);
  ctx.quadraticCurveTo(1.3, -0.8, 1.4, -0.2);
  ctx.quadraticCurveTo(1.6, 2.8, -0.8, 3.2);
  ctx.quadraticCurveTo(-2.4, 3.2, -2.6, 0.8);
  ctx.quadraticCurveTo(-1.3, 1.7, -0.7, 1.3);
  ctx.quadraticCurveTo(0.2, 0.4, -1.6, -0.8);
  ctx.quadraticCurveTo(-2.9, -2, -2.6, -3.5);
  ctx.quadraticCurveTo(-2.6, -4.2, -1.7, -4.9);
  ctx.quadraticCurveTo(0.1, -5.7, 0.7, -4.3);
  ctx.quadraticCurveTo(1.2, -3, 0.7, -2.4);
  ctx.quadraticCurveTo(0, -2.1, 0.4, -1.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
