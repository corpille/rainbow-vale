/* ============ Player sprite: side view and front/back view, walk cycle ============ */
import { COLORS, PONY_OUTLINE, UI_LIGHT } from '../core/colors.js';
import { BASE_TILE, TILE, fillCircle, fillEllipse } from '../core/engine-core.js';
import { player } from '../core/player.js';
import { canvas, ctx } from './render-world.js';

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
  if (player.visualFacing === 'up' || player.visualFacing === 'down') {
    drawPonyFrontBack(player.visualFacing === 'down', moving, walkPhase);
  } else {
    ctx.save();
    ctx.scale(player.flip, 1);
    drawPonySide(moving, walkPhase);
    ctx.restore();
  }

  ctx.restore(); // matches the outer translate/scale
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
  const hg = ctx.createLinearGradient(-10.5, -0.5, -17.1, 6.8);
  hg.addColorStop(0, '#ff6b81');
  hg.addColorStop(0.1, '#ffab5e');
  hg.addColorStop(0.3, '#ffe066');
  hg.addColorStop(0.5, '#69db7c');
  hg.addColorStop(0.8, '#66c7e8');
  hg.addColorStop(1, '#9d7bff');
  ctx.fillStyle = hg;
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
  ctx.moveTo(6.5, -10.1);
  ctx.quadraticCurveTo(9.5, -15.2, 9.6, -10.7);
  ctx.quadraticCurveTo(11.2, -9.2, 11.4, -7.1);
  ctx.quadraticCurveTo(11.4, -4.3, 14.7, -1.6);
  ctx.quadraticCurveTo(14.6, 1.5, 10.3, 2.8);
  ctx.quadraticCurveTo(7.7, 3.1, 3.2, 1.6);
  ctx.quadraticCurveTo(0.1, 0.2, 0.4, -2.7);
  ctx.quadraticCurveTo(0.3, -5.2, 1, -7.8);
  ctx.quadraticCurveTo(-1.4, -15.3, 5.2, -9.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // --- Ear (back) ---
  ctx.save();
  ctx.fillStyle = '#d9c8f5';
  ctx.beginPath();
  ctx.moveTo(1.5, -8);
  ctx.quadraticCurveTo(-0.5, -13.7, 4.7, -9.5);
  ctx.quadraticCurveTo(4, -8.3, 1.7, -8.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Ear front (outer) ---
  ctx.save();
  ctx.fillStyle = '#d9c8f5';
  ctx.beginPath();
  ctx.moveTo(7.1, -9.8);
  ctx.quadraticCurveTo(9.2, -14.5, 9.2, -9.7);
  ctx.quadraticCurveTo(8.2, -8.7, 7.3, -9.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Mane ---
  ctx.save();
  const lg = ctx.createLinearGradient(3.5, -13.5, -5.5, -3.8);
  lg.addColorStop(0, '#ff6b81');
  lg.addColorStop(0.3, '#ffab5e');
  lg.addColorStop(0.5, '#ffe066');
  lg.addColorStop(0.7, '#69db7c');
  lg.addColorStop(0.8, '#66c7e8');
  lg.addColorStop(1, '#9d7bff');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.moveTo(8.1, -7.9);
  ctx.quadraticCurveTo(3.6, -6.3, 1.9, -6.3);
  ctx.quadraticCurveTo(-0.2, -1.8, 1.1, -0.3);
  ctx.quadraticCurveTo(4.9, 1.3, 5.3, 2.9);
  ctx.quadraticCurveTo(5.8, 5.5, 3.6, 6.6);
  ctx.quadraticCurveTo(3.6, 4.7, 1.6, 3.5);
  ctx.quadraticCurveTo(-6.3, -1.3, 0.1, -9);
  ctx.quadraticCurveTo(5.3, -12.9, 11.7, -9.9);
  ctx.quadraticCurveTo(13.2, -9.3, 13.3, -10.8);
  ctx.quadraticCurveTo(13.4, -8, 9.5, -8.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Horn ---
  ctx.save();
  const hornGradient = ctx.createLinearGradient(6.7, -8.5, 13.9, -15.1);
  hornGradient.addColorStop(0, '#ffd980');
  hornGradient.addColorStop(1, '#ff9d5c');
  ctx.fillStyle = hornGradient;
  ctx.beginPath();
  ctx.moveTo(13.9, -15.1);
  ctx.lineTo(9.2, -7.2);
  ctx.quadraticCurveTo(7.2, -7.2, 6.7, -8.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- Eye (+ lash) ---
  ctx.save();
  ctx.strokeStyle = '#3a3050';
  ctx.lineWidth = 0.42;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10.2, -4.8);
  ctx.quadraticCurveTo(9, -3, 7.1, -4.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9.4, 1);
  ctx.quadraticCurveTo(10.5, 1.5, 10.9, 0.5);
  ctx.stroke();
  ctx.restore();

  // --- Blush ---
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#ff9ad0';
  fillCircle(ctx, 4.6, -1.6, 1.3);
  ctx.restore();

  // --- Ear front (inner) ---
  ctx.save();
  ctx.fillStyle = '#ff9ad0';
  ctx.beginPath();
  ctx.moveTo(-14.5, -5.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// front/back pony (up/down): a dedicated symmetric sprite instead of reshaping the
// side view — legs/body/head/ears/horn are shared between up and down; only tail+mane
// placement and the (front-only) face differ
function drawPonyFrontBack(facingDown, moving, walkPhase) {
  // marching lift (alternating legs raise/plant), not the side view's fore-aft stride —
  // toward/away from the camera, a sideways swing wouldn't read as walking
  const feet = [-4, 4].map((lx, i) => ({
    lx,
    // (1 - cos(x)) / 2 stays non-negative (legs only lift, never dip below ground) but
    // keeps the side view's 2π period — Math.abs(Math.sin(x)) has half that period,
    // which made the front/back gait cycle run twice as fast
    fy: 13 - (moving ? ((1 - Math.cos(walkPhase + i * Math.PI)) / 2) * 2.5 : 0),
  }));
  ctx.save();
  ctx.strokeStyle = UI_LIGHT;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  feet.forEach(f => {
    ctx.beginPath();
    ctx.moveTo(f.lx, 6);
    ctx.quadraticCurveTo(f.lx * 1.15, 9.5, f.lx, f.fy);
    ctx.stroke();
  });
  ctx.restore();
  ctx.save();
  ctx.fillStyle = '#f7e3c4';
  feet.forEach(f => fillCircle(ctx, f.lx, f.fy, 1.7));
  ctx.restore();

  ctx.save();
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 6;
  ctx.fillStyle = UI_LIGHT;
  ctx.strokeStyle = PONY_OUTLINE;
  ctx.lineWidth = 0.5;
  fillEllipse(ctx, 0, 3, 6.2, 5.6);
  ctx.stroke();
  ctx.restore();

  // tail: hidden when facing the camera; hangs down the center back when seen from
  // behind
  if (!facingDown) {
    for (let i = 0; i < COLORS.RAINBOW.length; i++) {
      const t = i / (COLORS.RAINBOW.length - 1);
      ctx.save();
      ctx.fillStyle = COLORS.RAINBOW[COLORS.RAINBOW.length - 1 - i];
      fillCircle(ctx, 0, t * 11, 3.2 - t * 1.6);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.shadowColor = COLORS.PINK_GLOW;
  ctx.shadowBlur = 6;
  ctx.fillStyle = UI_LIGHT;
  ctx.strokeStyle = PONY_OUTLINE;
  ctx.lineWidth = 0.5;
  fillEllipse(ctx, 0, -4, 6, 5.5);
  ctx.stroke();
  ctx.restore();

  // mane: rainbow fringe across the forehead facing the camera, full cascade down
  // the back of the head/neck from behind — drawn after the head (unlike the side
  // view) so it isn't tucked out of sight
  if (facingDown) {
    for (let i = 0; i < COLORS.RAINBOW.length; i++) {
      const t = i / (COLORS.RAINBOW.length - 1);
      ctx.save();
      ctx.fillStyle = COLORS.RAINBOW[i];
      fillCircle(ctx, -4.5 + t * 9, -8.5 + Math.abs(t - 0.5) * 5, 2.6);
      ctx.restore();
    }
  } else {
    // same tapered-stroke ribbon as the side view: thick near the head, narrowing
    // to a point toward the body
    ctx.save();
    const maneGrad = ctx.createLinearGradient(0, -7, 0, 4);
    COLORS.RAINBOW.forEach((c, i) => maneGrad.addColorStop(i / (COLORS.RAINBOW.length - 1), c));
    ctx.strokeStyle = maneGrad;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(0, -3);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(0, 1);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(0, 4);
    ctx.stroke();
    ctx.restore();
  }

  // ears
  ctx.save();
  ctx.fillStyle = '#ffeaf5';
  [-1, 1].forEach(sx => {
    ctx.beginPath();
    ctx.moveTo(sx * 2.5, -8);
    ctx.lineTo(sx * 4, -12.5);
    ctx.lineTo(sx * 5.5, -8.3);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();

  // horn: centered and upright, since both front and back face the camera dead-on
  ctx.save();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(-1.4, -8.5);
  ctx.lineTo(0, -15);
  ctx.lineTo(1.4, -8.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // face: only visible from the front
  if (facingDown) {
    ctx.save();
    ctx.fillStyle = '#3a3050';
    fillCircle(ctx, -2.2, -4, 1.1);
    fillCircle(ctx, 2.2, -4, 1.1);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = COLORS.PINK;
    fillCircle(ctx, -3.6, -1, 1.4);
    fillCircle(ctx, 3.6, -1, 1.4);
    ctx.restore();
  }
}
