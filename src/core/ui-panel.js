/* ============ Always-on spell bar — Nature (slot1) / Shape (slot2) / Modifier (slot3) ============ */
import { BLACK, COLORS, FONT, WHITE } from './colors.js';
import { gameState, iconGlyph } from './engine-core.js';
import {
  Modifier,
  Nature,
  SYMBOL_TO_ROLE,
  ZONES,
  beginAction,
  doUndo,
  uMarks,
} from '../world/world-zones.js';
import { resolvePhrase } from '../world/spell-shapes.js';
import { applyEffectsToWorld } from '../world/world-objects.js';
import { collected } from '../world/map-loader.js';
import { player, snapPos } from './player.js';
import { canvas } from '../render/render-world.js';

const RUNE_KEYS = ZONES.map(zone => zone.id); // '1'->swamp(m), '2'->cavern(j), '3'->orchard(v), '4'->marsh(b)
export const RUNE_SHAPE = { m: 0, j: 1, v: 2, b: 3 }; // RUNE_SHAPES index per zone (see engine-core.js)
// vivid per-zone accent for the rune glyphs — brighter than the zone's tile
// palette so it stands out against the bar's light background
export const RUNE_ACCENT = {
  m: '#5eeb9c',
  j: '#66d1ff',
  v: '#ff6fa8',
  b: '#c48aff',
};
// shared muted grayish-purple for inactive UI states — caption text and the
// not-yet-collected rune tint were close enough to just merge into one color
const fontColor = '#8a7d9c';
// erase-arrow fill and undo-icon stroke/fill — same muted ink, one shared constant
const inkColor = '#7d6f92';
// plain-language name for a Nature/Shape/Modifier enum value, shown under a slot
// once it's filled — just the key title-cased (HALF_CIRCLE -> Half-circle)
const desc = value => value[0] + value.slice(1).toLowerCase().replace('_', '-');
// Mirror is the only modifier whose effect depends on the nature it's paired with
// (Pull for Push, Thaw for Freeze, Mend for Crack). Cut has no invert (it's a no-op
// there), so that case — and the no-nature-yet case — falls through to a plain '-'.
const DESC_MIRROR_INVERT = {
  [Nature.PUSH]: 'Pull',
  [Nature.FREEZE]: 'Thaw',
  [Nature.CRACK]: 'Mend',
};
// which slot a rune lands in picks the enum it's describing (nature/shape/modifier),
// not the rune itself — see SYMBOL_TO_ROLE in world-zones.js
const DESC_BY_SLOT = [
  sym => desc(SYMBOL_TO_ROLE[sym].slot1),
  sym => desc(SYMBOL_TO_ROLE[sym].slot2),
  (sym, natureSym) => {
    const modifier = SYMBOL_TO_ROLE[sym].slot3;
    if (modifier === Modifier.MIRROR) {
      const invert = natureSym && DESC_MIRROR_INVERT[SYMBOL_TO_ROLE[natureSym].slot1];
      return invert || '-';
    }
    return desc(modifier);
  },
];
export let phraseRunes = []; // up to 3 zone ids (m/j/v/b), in the chosen order, repetition allowed
// tap targets for the bar, recomputed every frame — lets one pointerdown handler
// cover "press a rune" / "cast" / "erase" on touch
const comboHit = { runes: [], cast: null, erase: null, undo: null };
export const comboOverlay = document.getElementById('o');
const comboCtx = comboOverlay.getContext('2d');
const PANEL_INK = '#453a5c'; // dark ink for icons/text on the bar's light cloud background

export function panelRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function cloudPill(ctx, x, y, w, h, r) {
  ctx.save();
  ctx.fillStyle = '#fff9f2ee';
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1.5;
  panelRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// output only depends on the phrase, unlocked zones, canvas size, and undo state —
// skip the redraw when none of those changed instead of repainting 60x/sec while idle
let _comboSig = null;
export function drawComboOverlay() {
  const sig =
    canvas.width +
    'x' +
    canvas.height +
    '|' +
    phraseRunes.join('') +
    '|' +
    collected.size +
    '|' +
    uMarks.length;
  if (sig === _comboSig) return;
  _comboSig = sig;

  const shrink = Math.min(1, canvas.height / 720, canvas.width / 480);
  const grow = Math.max(1, Math.min(canvas.width, canvas.height) / 1080);
  const scale = Math.max(0.55, shrink * grow);

  const runeRadius = 22 * scale,
    slotRadius = 25 * scale,
    itemGap = 16 * scale,
    padX = 15 * scale,
    topMargin = 14 * scale,
    font = `500 ${14 * scale}px ${FONT}`;

  const cy = topMargin + slotRadius, // icon row, vertically centered in the bar
    capY = cy + slotRadius + itemGap, // caption row underneath (numbers / slot titles)
    barH = cy * 2 + 10 * scale;

  // lay out left-to-right first so the canvas is sized to fit exactly what gets drawn
  let dx = padX;
  const runeX = [];
  ZONES.forEach(() => {
    runeX.push(dx + runeRadius);
    dx += runeRadius * 2 + itemGap;
  });
  const dividerX1 = dx;
  dx += itemGap;
  const slotX = [];
  for (let i = 0; i < 3; i++) {
    slotX.push(dx + slotRadius);
    dx += slotRadius * 2 + itemGap;
  }
  const dividerX2 = dx;
  dx += itemGap;
  const castX = dx + runeRadius;
  dx += runeRadius * 2 + itemGap;
  const eraseX = dx + runeRadius;
  dx += runeRadius * 2 + itemGap;
  const undoX = dx + runeRadius;
  dx += runeRadius * 2 + padX;
  const barW = dx;

  comboOverlay.width = Math.round(barW);
  comboOverlay.height = Math.round(barH);
  comboCtx.clearRect(0, 0, comboOverlay.width, comboOverlay.height);
  // centered against the actual canvas width, not CSS `left: 50%` — 100vw can differ
  // by a scrollbar's width
  comboOverlay.style.left = Math.round((canvas.width - barW) / 2) + 'px';

  cloudPill(comboCtx, 0, 0, barW, barH, 22 * scale);

  // --- left: the 4 runes, each with its number key underneath ---
  comboHit.runes = [];
  ZONES.forEach((zone, i) => {
    const cx = runeX[i];
    const has = collected.has(zone.id);
    if (has) comboHit.runes.push({ x: cx, y: cy, r: runeRadius * 1.3, zoneId: zone.id });
    const count = phraseRunes.filter(rune => rune === zone.id).length;
    const color = !has ? fontColor : count > 0 ? COLORS.PINK_UI : RUNE_ACCENT[zone.id];

    comboCtx.save();
    comboCtx.globalAlpha = !has ? 0.14 : count > 0 ? 0.3 : 0.16;
    comboCtx.fillStyle = color;
    comboCtx.beginPath();
    comboCtx.arc(cx, cy, runeRadius, 0, 7);
    comboCtx.fill();
    comboCtx.restore();
    if (count > 0) {
      comboCtx.save();
      comboCtx.strokeStyle = color;
      comboCtx.lineWidth = 2.4 * scale;
      comboCtx.globalAlpha = 0.8;
      comboCtx.beginPath();
      comboCtx.arc(cx, cy, runeRadius * 1.05, 0, 7);
      comboCtx.stroke();
      comboCtx.restore();
    }
    iconGlyph(
      comboCtx,
      cx,
      cy,
      runeRadius * 0.62,
      has ? PANEL_INK : '#c9c0d6',
      has ? color : '#b0a5c0',
      RUNE_SHAPE[zone.id]
    );
    if (has) drawCaption(String(i + 1), cx);
  });

  function drawCaption(text, cx) {
    comboCtx.save();
    comboCtx.font = font;
    comboCtx.fillStyle = fontColor;
    comboCtx.textAlign = 'center';
    comboCtx.fillText(text, cx, capY);
    comboCtx.restore();
  }
  // square tap target for an action icon (cast/erase/undo) — same size and y,
  // only the x differs per caller
  function hitRect(x) {
    return { x: x - runeRadius, y: cy - runeRadius, w: runeRadius * 2, h: runeRadius * 2 };
  }
  function divider(x) {
    comboCtx.save();
    comboCtx.strokeStyle = `${BLACK}18`;
    comboCtx.lineWidth = 1.4 * scale;
    comboCtx.beginPath();
    comboCtx.moveTo(x, padX);
    comboCtx.lineTo(x, barH - padX);
    comboCtx.stroke();
    comboCtx.restore();
  }
  divider(dividerX1);

  // --- middle: the 3 phrase slots, each labeled underneath once filled ---
  for (let i = 0; i < 3; i++) {
    const cx = slotX[i];
    const filled = phraseRunes[i];
    comboCtx.save();
    comboCtx.strokeStyle = filled ? RUNE_ACCENT[filled] : '#c8a8c060';
    comboCtx.lineWidth = (filled ? 2.6 : 1.8) * scale;
    if (!filled) comboCtx.setLineDash([4 * scale, 4 * scale]);
    comboCtx.beginPath();
    comboCtx.arc(cx, cy, slotRadius, 0, 7);
    comboCtx.stroke();
    comboCtx.restore();
    if (filled) {
      iconGlyph(
        comboCtx,
        cx,
        cy,
        slotRadius * 0.6,
        PANEL_INK,
        RUNE_ACCENT[filled],
        RUNE_SHAPE[filled]
      );
      drawCaption(DESC_BY_SLOT[i](filled, phraseRunes[0]), cx);
    }
  }
  divider(dividerX2);

  // right: cast (checkmark, drawn as a path rather than a font glyph) and erase
  // (arrow). Stale hit rects from the last frame are harmless no-ops.
  if (phraseRunes.length) {
    comboCtx.save();
    comboCtx.translate(castX, cy);
    comboCtx.strokeStyle = '#2f9e5b';
    comboCtx.lineWidth = 3.2 * scale;
    comboCtx.lineCap = 'round';
    comboCtx.lineJoin = 'round';
    comboCtx.beginPath();
    comboCtx.moveTo(-runeRadius * 0.55, -runeRadius * 0.05);
    comboCtx.lineTo(-runeRadius * 0.15, runeRadius * 0.4);
    comboCtx.lineTo(runeRadius * 0.6, -runeRadius * 0.45);
    comboCtx.stroke();
    comboCtx.restore();
    comboHit.cast = hitRect(castX);

    comboCtx.save();
    comboCtx.font = `700 ${30 * scale}px ${FONT}`;
    comboCtx.fillStyle = inkColor;
    comboCtx.textAlign = 'center';
    comboCtx.textBaseline = 'middle';
    comboCtx.fillText('←', eraseX, cy + 1);
    comboCtx.restore();
    comboHit.erase = hitRect(eraseX);
  }

  // undo: independent of the current phrase, shown only once there's something to
  // undo. Rewind icon (270° arc + arrowhead), drawn as strokes/fills like the checkmark above.
  if (uMarks.length) {
    const r = runeRadius * 0.46,
      a0 = -Math.PI * 0.65,
      a1 = a0 + Math.PI * 1.5,
      hx = r * Math.cos(a0),
      hy = r * Math.sin(a0),
      tx = -Math.sin(a0),
      ty = Math.cos(a0);
    comboCtx.save();
    comboCtx.translate(undoX, cy);
    comboCtx.strokeStyle = inkColor;
    comboCtx.fillStyle = inkColor;
    comboCtx.lineWidth = 3 * scale;
    comboCtx.lineCap = 'round';
    comboCtx.beginPath();
    comboCtx.arc(0, 0, r, a0, a1);
    comboCtx.stroke();
    comboCtx.beginPath();
    comboCtx.moveTo(hx - tx * r * 0.55, hy - ty * r * 0.55);
    comboCtx.lineTo(hx + ty * r * 0.4, hy - tx * r * 0.4);
    comboCtx.lineTo(hx - ty * r * 0.4, hy + tx * r * 0.4);
    comboCtx.closePath();
    comboCtx.fill();
    comboCtx.restore();
    comboHit.undo = hitRect(undoX);
  } else {
    comboHit.undo = null;
  }
}

function addToPhrase(zoneId) {
  if (!collected.has(zoneId)) return;
  if (phraseRunes.length >= 3) return;
  phraseRunes.push(zoneId);
}

// resolvePhrase trusts its input: addToPhrase above is the only way a rune reaches
// phraseRunes, and it already rejects uncollected zone ids and caps the length at 3 —
// with the empty case handled on the next line. Keep those three checks together if you
// ever add another way to compose a phrase.
function castPhrase() {
  if (!phraseRunes.length) return;
  const result = resolvePhrase(phraseRunes, player.x, player.y, player.facing);
  beginAction();
  applyEffectsToWorld(result.result, result.shape, player.x, player.y);
  // Switch: the crate's side of the trade already happened above (it's on the
  // caster's old tile now) — snap the player onto the crate's old tile too, no
  // glide since this is a teleport, not a walk
  const switchEntry = result.result.find(entry => entry.effect === 'switch');
  if (switchEntry) {
    snapPos();
    player.x = player.dispX = switchEntry.cell.x;
    player.y = player.dispY = switchEntry.cell.y;
  }
  phraseRunes = [];
}

// touch: tap a rune to add it, tap cast/erase to act on the phrase, same as the
// keyboard path below. No open/close step, the bar is always live.
export const inRect = (x, y, rect) =>
  rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
comboOverlay.addEventListener('pointerdown', e => {
  const x = e.offsetX,
    y = e.offsetY;
  const rune = comboHit.runes.find(hit => Math.hypot(x - hit.x, y - hit.y) < hit.r);
  if (rune) {
    addToPhrase(rune.zoneId);
    return;
  }
  if (inRect(x, y, comboHit.cast)) {
    castPhrase();
    return;
  }
  if (inRect(x, y, comboHit.undo)) {
    doUndo();
    return;
  }
  if (inRect(x, y, comboHit.erase)) {
    phraseRunes.pop();
  }
});

window.addEventListener('keydown', e => {
  if (gameState !== 'playing') return;
  if (e.key === 'Backspace') {
    e.preventDefault();
    phraseRunes.pop();
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    castPhrase();
    return;
  }
  // e.code is the key's physical position, not the character produced — avoids needing
  // Shift on AZERTY while staying valid on QWERTY. Anything else (incl. Digit5+) falls
  // through to e.key, which only matches for the literal characters 1-4.
  const idx = /^(Digit|Numpad)[1-4]$/.test(e.code)
    ? e.code.slice(-1) - 1
    : '1234'.indexOf(e.key);
  if (idx >= 0 && idx < RUNE_KEYS.length) {
    e.preventDefault();
    addToPhrase(RUNE_KEYS[idx]);
  }
});
