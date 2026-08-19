/* ============ Shared color palette — Rainbow Vale ============ */
/* Colors reused across two or more files. Zone palettes (HUB, ZONE_DEFS, RUNES
   in world-zones.js) stay inline — that's one-off, colocated data, not duplication. */
export const COLORS = {
  PINK_GLOW: '#ffb3e6', // item pickup flash, collected-rune glow
  PINK_UI: '#e0609c', // spell bar accent (filled slot, active rune)
  PINK_WARM: '#ff7ac2', // rune icon glow, cast-highlight accents
  PINK_DARK: '#8a2a6a', // item sparkle-marker outline
  PINK_SOFT: '#ffa8dc', // uncollected item glyph
  CREAM: '#f0e6cf', // item glyph base tone
  PINK: '#ff9ad0', // Breeze theme / crate outline
  PURPLE: '#c080f0', // mirror & lock accents
  ICE_BLUE: '#9fd6f5', // mirror surface / crystal accents
  GREEN: '#5aff9a', // "activated"/"done" state
  NEAR_BLACK: '#392f5c', // deep tile texture shading — dusky twilight instead of black
  RAINBOW: ['#ff6b81', '#ffab5e', '#ffe066', '#69db7c', '#66c7e8', '#9d7bff'], // mane/arch accents
};

export const FONT = 'Helvetica, Arial, sans-serif';
// bright off-white for icon/text on dark backgrounds (rune glyphs, C badge, menu
// button) — a plain top-level const, not a COLORS property, so Terser's toplevel
// mangling can shrink its many call sites to a single character
export const UI_LIGHT = '#fffdfa';
export const TRANSPARENT = '#00000000'; // fade-to-nothing gradient stop, reused by several glows
export const PONY_OUTLINE = '#e0a8c8'; // pony body/head highlight stroke, shared by both sprite views
