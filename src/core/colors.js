/* ============ Shared color palette — Rainbow Vale ============ */
/* Colors reused across two or more files. Zone palettes (HUB, ZONE_DEFS, RUNES
   in world-zones.js) stay inline — that's one-off, colocated data, not duplication. */
export const COLORS = {
  PINK_GLOW: '#ffb3e6', // signature warm-pink glow: pickup flash, cast/spell highlights, hub & door halos, pony sprite outline
  PINK_UI: '#e0609c', // filled-slot/active-rune accent, touch-stick indicator, buttons, ending-screen background
  PINK_WARM: '#ff7ac2', // menu/title text glow, item sparkle, crate/door "active" stroke+glow
  PINK_SOFT: '#ffa8dc', // uncollected-pedestal glow, hub heart-glyph accent
  CREAM: '#f0e6cf', // glyph base tone — pedestals (until collected) and the hub's heart icon
  PINK: '#ff9ad0', // crate ribbon/bow, pony blush
  PURPLE: '#c080f0', // unweighed-plate color, lock-gate glow, menu dusk background
  ICE_BLUE: '#9fd6f5', // frozen-object glow, mirror surface, lock-gate crystal accents
  NEAR_BLACK: '#392f5c', // deep shading: wall texture, and the top of every dusk-background gradient
  RAINBOW: ['#ff6b81', '#ffab5e', '#ffe066', '#69db7c', '#66c7e8', '#9d7bff'], // mane/tail gradients, menu arch, ending celebration stars
  STAR_CREAM: '#fff6d8', // lock-gate orbiting sparkles, hub-progress stars
};

export const FONT = 'Helvetica, Arial, sans-serif';
// bright off-white for icon/text on dark or colored backgrounds (pony sprite, HUD
// buttons/overlays, collected-pedestal glyph). Kept as a plain top-level const so
// Terser's toplevel mangling can shrink its many call sites to a single character.
export const UI_LIGHT = '#fffdfa';
export const TRANSPARENT = '#00000000'; // fade-to-nothing gradient stop, reused by several glows
export const PONY_OUTLINE = '#e0a8c8'; // pony body/head highlight stroke, shared by both sprite views
export const WHITE = '#ffffff'; // pure white — highlights, strokes, "revealed" states across several files
export const BLACK = '#000000'; // pure black — ground shadows, and a base for alpha-suffixed outline strokes
export const VIOLET = '#9d7bff'; // amethyst accent — rainbow's last stop, gem/crystal gradients, mane highlights
