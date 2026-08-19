/* ============ Real decor per zone (carried over from the prototypes, TILE=42 scale) ============ */
import { COLORS } from './colors.js';
import { BASE_TILE, fillCircle, fillEllipse, radialFade } from './engine-core.js';

// blurred elliptical shadow shared by several decors, factored out here
function softShadow(ctx, x, y, rx, ry, alpha, color) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  fillEllipse(ctx, x, y, rx, ry);
  ctx.restore();
}

const PETAL_PALETTE = ['#ff8fa8', '#ffd166', '#9d7bff', '#66d9c2'];
export function drawFlowerStalksBig(ctx, x, y) {
  softShadow(ctx, x, y + 3, 14, 5, 0.15, '#4a9a5f');
  for (let i = 0; i < 5; i++) {
    const ox = (i - 2) * 4,
      h = 20 + (i % 2) * 6,
      lean = (i - 2) * 2;
    ctx.save();
    ctx.strokeStyle = '#4fb86a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + ox, y);
    ctx.quadraticCurveTo(x + ox + lean * 0.5, y - h * 0.6, x + ox + lean, y - h);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = PETAL_PALETTE[i % PETAL_PALETTE.length];
    fillEllipse(ctx, x + ox + lean, y - h, 2.6, 3.2);
    ctx.restore();
  }
}
const MUSHROOM_PALETTES = [
  { cap: '#ff8fb0', glow: '#ffc2d6', hi: '#fff0f5' },
  { cap: '#9d7bff', glow: '#c9b3ff', hi: '#efe6ff' },
  { cap: '#66d9c2', glow: '#a3f5e0', hi: '#eafff9' },
  { cap: '#ffd166', glow: '#ffe9a3', hi: '#fff7e0' },
];

export function drawMushroomClusterBig(ctx, x, y, seed) {
  const pal = MUSHROOM_PALETTES[seed % MUSHROOM_PALETTES.length];
  const baseY = y + 8;
  softShadow(ctx, x, baseY + 2, 18, 7, 0.16, pal.glow);
  const caps = 3;
  for (let c = 0; c < caps; c++) {
    const ox = (c - (caps - 1) / 2) * 10;
    const h = 16 + (c % 2) * 6;
    ctx.save();
    ctx.strokeStyle = '#8a6aa5';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + ox, baseY);
    ctx.lineTo(x + ox, baseY - h);
    ctx.stroke();
    ctx.restore();
    const capY = baseY - h;
    softShadow(ctx, x + ox, capY, 11, 11, 0.3, pal.glow);
    ctx.save();
    ctx.fillStyle = pal.cap;
    ctx.strokeStyle = '#6a4a7a';
    ctx.lineWidth = 1.4;
    fillEllipse(ctx, x + ox, capY, 6.5, 4);
    ctx.stroke();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = pal.hi;
    fillCircle(ctx, x + ox - 2, capY - 1.5, 2);
    ctx.restore();
  }
}

const GEM_PALETTE = ['#ff8fa3', '#9d7bff', '#66d9c2'];
export function drawCrystalClusterBig(ctx, x, y) {
  const cy = y + 8;
  softShadow(ctx, x, cy + 4, 18, 6, 0.18, '#e0c8ff');
  for (let i = 0; i < 3; i++) {
    const h = 24 + (i % 2) * 10,
      w = 11;
    const ox = (i - 1) * 10;
    const rot = (i - 1) * 0.15;
    ctx.save();
    ctx.translate(x + ox, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(w / 2, -h * 0.3);
    ctx.lineTo(0, 0);
    ctx.lineTo(-w / 2, -h * 0.3);
    ctx.closePath();
    ctx.fillStyle = GEM_PALETTE[i % GEM_PALETTE.length];
    ctx.fill();
    ctx.strokeStyle = '#5a4a7a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(0, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
}
export function drawBloomTreeBig(ctx, x, y) {
  function branch(px, py, angle, len, depth) {
    if (depth <= 0) return;
    const nx = px + Math.cos(angle) * len,
      ny = py + Math.sin(angle) * len;
    ctx.lineWidth = Math.max(1.2, 4 * (depth / 4));
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    if (depth === 1) {
      ctx.save();
      ctx.fillStyle = PETAL_PALETTE[Math.floor(len) % PETAL_PALETTE.length];
      fillCircle(ctx, nx, ny, 2.2);
      ctx.restore();
    }
    branch(nx, ny, angle - 0.65, len * 0.66, depth - 1);
    branch(nx, ny, angle + 0.65, len * 0.66, depth - 1);
  }
  ctx.save();
  ctx.strokeStyle = '#a2805c';
  ctx.lineCap = 'round';
  const by = y + 10;
  branch(x, by, -Math.PI / 2, BASE_TILE * 0.9, 4);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = radialFade(ctx, x, by, 12, COLORS.PINK_WARM);
  fillCircle(ctx, x, by, 12);
  ctx.restore();
}
