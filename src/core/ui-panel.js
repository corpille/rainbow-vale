/* ============ Always-on spell bar — Nature (slot1) / Shape (slot2) / Modifier (slot3) ============ */
import { COLORS, FONT, WHITE } from './colors.js';
import { gameState, iconGlyph } from './engine-core.js';
import { SYMBOL_TO_ROLE, ZONES } from '../world/world-zones.js';
import { resolvePhrase } from '../world/spell-shapes.js';
import { applyEffectsToWorld } from '../world/world-objects.js';
import { SYMBOL_TO_ZONE, ZONE_SYMBOL, collected } from '../world/map-loader.js';
import { player } from './player.js';
import { canvas } from '../render/render-world.js';

const RUNE_KEYS = ZONES.map(z => z.id); // '1'->swamp(m), '2'->cavern(j), '3'->orchard(v), '4'->marsh(b)
export const RUNE_SHAPE = { m: 'star', j: 'gem', v: 'flower', b: 'drop' }; // icon per zone
// vivid (not pastel) per-zone accent for the rune glyphs — brighter/more saturated than
// the zone's own soft tile palette so it reads against the bar's light background:
// Breeze mint, Frost sky-blue, Sunbeam hot pink, Crystal violet
export const RUNE_ACCENT = {
  m: '#5eeb9c',
  j: '#66d1ff',
  v: '#ff6fa8',
  b: '#c48aff',
};
// plain-language names shown under a slot once it's filled
const DESC_NATURE = { FREEZE: 'Frost', PUSH: 'Breeze', BURN: 'Sunbeam', SOLIDIFY: 'Crystal' };
const DESC_SHAPE = { LINE: 'Line', HALF_CIRCLE: 'Half-circle', CONE: 'Cone', DIAGONAL: 'Diagonal' };
const DESC_MODIFIER = { PIERCE: 'Pierce', BOUNCE: 'Bounce', SPREAD: 'Spread', MIRROR: 'Mirror' };
// which table applies depends on which slot a rune lands in, not the rune itself —
// slot1 = nature, slot2 = shape, slot3 = modifier (see SYMBOL_TO_ROLE in world-zones.js)
const DESC_BY_SLOT = [
  sym => DESC_NATURE[SYMBOL_TO_ROLE[sym].slot1],
  sym => DESC_SHAPE[SYMBOL_TO_ROLE[sym].slot2],
  sym => DESC_MODIFIER[SYMBOL_TO_ROLE[sym].slot3],
];
export let phraseRunes = []; // up to 3 symbols ▲❄~■, in the chosen order, repetition allowed
// tap targets for the bar, recomputed every frame it's drawn — lets one pointerdown
// handler double as "press a rune" / "cast" / "erase" on touch
const comboHit = { runes: [], cast: null, erase: null };
export let lastCast = null; // { cellsTouched, until } — highlight of the last spell cast
export const comboOverlay = document.getElementById('o');
const comboCtx = comboOverlay.getContext('2d');
const PANEL_INK = '#453a5c'; // dark ink for icons/text on the bar's light cloud background

export function panelRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function cloudPill(c, x, y, w, h, r) {
  c.save();
  c.fillStyle = '#fff9f2ee';
  c.strokeStyle = WHITE;
  c.lineWidth = 1.5;
  panelRect(c, x, y, w, h, r);
  c.fill();
  c.stroke();
  c.restore();
}

// drawComboOverlay's output only depends on the phrase, unlocked zones, and canvas
// size, none of which change between frames on their own — so skip the redraw
// entirely when none of those changed, instead of repainting 60x/sec while idle
let _comboSig = null;
export function drawComboOverlay() {
  const sig =
    canvas.width + 'x' + canvas.height + '|' + phraseRunes.join('') + '|' + collected.size;
  if (sig === _comboSig) return;
  _comboSig = sig;

  // same shrink-on-small-screens / grow-past-1080p scale as before, now measured off
  // the real game canvas — this overlay's own size IS the bar now, not the whole screen
  const shrink = Math.min(1, canvas.height / 720, canvas.width / 480);
  const grow = Math.max(1, Math.min(canvas.width, canvas.height) / 1080);
  const scale = Math.max(0.55, shrink * grow);

  const runeR = 27 * scale,
    slotR = 30 * scale,
    itemGap = 16 * scale,
    groupGap = 32 * scale,
    padX = 20 * scale;
  // vertical centering is anchored to the CIRCLES, not the whole icon+caption block —
  // the caption row is free to sit off-center below them. So the empty margin above the
  // circles has to equal the caption's own footprint (gap + text + bottom margin) below
  // them, which is what keeps cy sitting at the exact vertical middle of the bar.
  const capGap = 17 * scale,
    capTextH = 16 * scale,
    padBottom = 4 * scale;
  const topMargin = capGap + capTextH + padBottom;
  const cy = topMargin + slotR, // icon row, vertically centered in the bar
    capY = cy + slotR + capGap, // caption row underneath (numbers / slot titles)
    barH = cy * 2;

  // lay everything out left-to-right first so the canvas is sized to fit exactly what
  // gets drawn — a fixed guessed width previously clipped the erase icon right off
  // the edge the moment the layout changed
  let dx = padX;
  const runeX = [];
  ZONES.forEach(() => {
    runeX.push(dx + runeR);
    dx += runeR * 2 + itemGap;
  });
  const dividerX1 = dx - itemGap / 2 + groupGap / 2;
  dx += groupGap;
  const slotX = [];
  for (let i = 0; i < 3; i++) {
    slotX.push(dx + slotR);
    dx += slotR * 2 + itemGap;
  }
  const dividerX2 = dx - itemGap / 2 + groupGap / 2;
  dx += groupGap;
  const castX = dx + runeR;
  dx += runeR * 2 + itemGap;
  const eraseX = dx + runeR;
  dx += runeR * 2 + padX;
  const barW = dx;

  comboOverlay.width = Math.round(barW);
  comboOverlay.height = Math.round(barH);
  comboCtx.clearRect(0, 0, comboOverlay.width, comboOverlay.height);
  // centered against the actual game canvas in pixels, not CSS `left: 50%` — 100vw can
  // differ from canvas.width (window.innerWidth) by a scrollbar's width or more on some
  // browsers, which was throwing this off; measuring off the same canvas.width the rest
  // of the game already uses for its own layout keeps it exactly centered
  comboOverlay.style.left = Math.round((canvas.width - barW) / 2) + 'px';

  cloudPill(comboCtx, 0, 0, barW, barH, 22 * scale);

  // --- left: the 4 runes, each with its number key underneath ---
  comboHit.runes = [];
  ZONES.forEach((z, i) => {
    const cx = runeX[i];
    const has = collected.has(z.id);
    if (has) comboHit.runes.push({ x: cx, y: cy, r: runeR * 1.3, zoneId: z.id });
    const sym = ZONE_SYMBOL[z.id];
    const count = phraseRunes.filter(p => p === sym).length;
    const color = !has ? '#8a7fa0' : count > 0 ? COLORS.PINK_UI : RUNE_ACCENT[z.id];

    comboCtx.save();
    comboCtx.globalAlpha = !has ? 0.14 : count > 0 ? 0.3 : 0.16;
    comboCtx.fillStyle = color;
    comboCtx.beginPath();
    comboCtx.arc(cx, cy, runeR, 0, 7);
    comboCtx.fill();
    comboCtx.restore();
    if (count > 0) {
      comboCtx.save();
      comboCtx.strokeStyle = color;
      comboCtx.lineWidth = 2.4 * scale;
      comboCtx.globalAlpha = 0.8;
      comboCtx.beginPath();
      comboCtx.arc(cx, cy, runeR * 1.05, 0, 7);
      comboCtx.stroke();
      comboCtx.restore();
    }
    iconGlyph(
      comboCtx,
      cx,
      cy,
      runeR * 0.62,
      has ? PANEL_INK : '#c9c0d6',
      has ? color : '#b0a5c0',
      RUNE_SHAPE[z.id]
    );
    if (has) {
      comboCtx.save();
      comboCtx.font = `500 ${16 * scale}px ${FONT}`;
      comboCtx.fillStyle = '#8a7d9c';
      comboCtx.textAlign = 'center';
      comboCtx.fillText(String(i + 1), cx, capY);
      comboCtx.restore();
    }
  });

  function divider(x) {
    comboCtx.save();
    comboCtx.strokeStyle = '#00000018';
    comboCtx.lineWidth = 1.4 * scale;
    comboCtx.beginPath();
    comboCtx.moveTo(x, 18 * scale);
    comboCtx.lineTo(x, barH - 18 * scale);
    comboCtx.stroke();
    comboCtx.restore();
  }
  divider(dividerX1);

  // --- middle: the 3 phrase slots, each labeled underneath once filled ---
  for (let i = 0; i < 3; i++) {
    const cx = slotX[i];
    const filled = phraseRunes[i];
    const zoneId = filled && SYMBOL_TO_ZONE[filled];
    comboCtx.save();
    comboCtx.strokeStyle = filled ? RUNE_ACCENT[zoneId] : '#c8a8c060';
    comboCtx.lineWidth = (filled ? 2.6 : 1.8) * scale;
    if (!filled) comboCtx.setLineDash([4 * scale, 4 * scale]);
    comboCtx.beginPath();
    comboCtx.arc(cx, cy, slotR, 0, 7);
    comboCtx.stroke();
    comboCtx.restore();
    if (filled) {
      iconGlyph(comboCtx, cx, cy, slotR * 0.6, PANEL_INK, RUNE_ACCENT[zoneId], RUNE_SHAPE[zoneId]);
      comboCtx.save();
      comboCtx.font = `500 ${16 * scale}px ${FONT}`;
      comboCtx.fillStyle = '#8a7d9c';
      comboCtx.textAlign = 'center';
      comboCtx.fillText(DESC_BY_SLOT[i](filled), cx, capY);
      comboCtx.restore();
    }
  }
  divider(dividerX2);

  // --- right: cast (checkmark) / erase (arrow) — same weight/shape treatment so the two
  // read as one matched pair; cast gets its own saturated-but-dark green (not the pale
  // COLORS.GREEN used for "activated" glows elsewhere, which washed out against the
  // bar's cream background) so "confirm" still reads at a glance. Cast used to share the
  // swamp rune's own star shape (just recolored), easy to mistake for a 5th rune. Drawn
  // as a stroked path, not a text glyph — a checkmark character's actual size/weight
  // varies wildly across fonts (and can silently fall back to an emoji-style glyph), so
  // a path is the only way to guarantee it matches the arrow's thin, geometric look ---
  // stale comboHit.cast/erase rects left over from the last non-empty frame stay
  // clickable but harmless — castPhrase() and the erase pop() are both no-ops on an
  // empty phraseRunes, so there's no need to null the rects out when hiding the icons
  if (phraseRunes.length) {
    comboCtx.save();
    comboCtx.translate(castX, cy);
    comboCtx.strokeStyle = '#2f9e5b';
    comboCtx.lineWidth = 3.2 * scale;
    comboCtx.lineCap = 'round';
    comboCtx.lineJoin = 'round';
    comboCtx.beginPath();
    comboCtx.moveTo(-runeR * 0.55, -runeR * 0.05);
    comboCtx.lineTo(-runeR * 0.15, runeR * 0.4);
    comboCtx.lineTo(runeR * 0.6, -runeR * 0.45);
    comboCtx.stroke();
    comboCtx.restore();
    comboHit.cast = { x: castX - runeR, y: cy - runeR, w: runeR * 2, h: runeR * 2 };

    comboCtx.save();
    comboCtx.font = `700 ${30 * scale}px ${FONT}`;
    comboCtx.fillStyle = '#7d6f92';
    comboCtx.textAlign = 'center';
    comboCtx.textBaseline = 'middle';
    comboCtx.fillText('←', eraseX, cy + 1);
    comboCtx.restore();
    comboHit.erase = { x: eraseX - runeR, y: cy - runeR, w: runeR * 2, h: runeR * 2 };
  }
}

function addToPhrase(zoneId) {
  if (!collected.has(zoneId)) return;
  if (phraseRunes.length >= 3) return;
  phraseRunes.push(ZONE_SYMBOL[zoneId]);
}

function castPhrase() {
  if (!phraseRunes.length) return;
  const r = resolvePhrase(phraseRunes, player.x, player.y, player.facing);
  if (r.ok) {
    applyEffectsToWorld(r.result, r.runeCount, r.shape, player.x, player.y);
    lastCast = { cellsTouched: r.cellsTouched, until: performance.now() + 500 };
  }
  phraseRunes = [];
}

// touch: tap a rune to add it, tap cast/erase to act on the phrase — same actions as
// the keyboard path below. No open/close step: the bar is always live.
export function inRect(x, y, r) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
comboOverlay.addEventListener('pointerdown', e => {
  const x = e.offsetX,
    y = e.offsetY;
  const rune = comboHit.runes.find(r => Math.hypot(x - r.x, y - r.y) < r.r);
  if (rune) {
    addToPhrase(rune.zoneId);
    return;
  }
  if (inRect(x, y, comboHit.cast)) {
    castPhrase();
    return;
  }
  if (inRect(x, y, comboHit.erase)) {
    phraseRunes.pop();
  }
});

window.addEventListener('keydown', e => {
  if (gameState !== 'playing') return;
  if (e.key === 'Escape') {
    e.preventDefault();
    phraseRunes = [];
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    phraseRunes.pop();
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    castPhrase();
    return;
  }
  // e.code is the key's physical position, not the character produced — avoids needing
  // Shift on AZERTY while staying valid on QWERTY
  const DIGIT_CODES = [
    'Digit1',
    'Digit2',
    'Digit3',
    'Digit4',
    'Numpad1',
    'Numpad2',
    'Numpad3',
    'Numpad4',
  ];
  let idx = DIGIT_CODES.indexOf(e.code);
  if (idx >= 4) idx -= 4;
  if (idx < 0) idx = '1234'.indexOf(e.key);
  if (idx >= 0 && idx < RUNE_KEYS.length) {
    e.preventDefault();
    addToPhrase(RUNE_KEYS[idx]);
  }
});
