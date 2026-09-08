/* ============ Background music: soft pad bed + occasional short phrase ============ */
// Started on Play (browsers require a user gesture, see render-hud.js's pointerdown).
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const freq = n => 440 * 2 ** (n / 12); // n = semitones from A4
const IDS = 'mvjb'; // zone id -> MELODIES index; 'h' (hub) matches none, see setZone
const MELODIES = [
  [-9, -5, -2, 0, 3, 0], // swamp
  [-4, 0, 3, 5, 8, 5], // orchard: swamp shape, a fourth up
  [-12, -9, -7, -5, -7, -9], // cavern
  [-9, -6, -4, -2, -4, -6], // marsh: cavern shape, shifted
];
const PHRASE_GAP = 1.1;
let zone = 'h';
export function setZone(zoneId) {
  zone = zoneId;
}
// attack scales with dur so the short pickup ding stays snappy while long phrase/pad notes swell in
function playNote(f, t, dur = 0.65, vol = 0.09) {
  const osc = audioCtx.createOscillator(),
    gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = f;
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
function playPhrase() {
  if (zone === 'h') return setTimeout(playPhrase, 5000);
  const zoneNotes = MELODIES[Math.floor(Math.random() * MELODIES.length)],
    hold = PHRASE_GAP * 1.8;
  zoneNotes.forEach((n, i) => {
    const f = freq(n),
      t = audioCtx.currentTime + i * PHRASE_GAP;
    playNote(f, t, hold, 0.07);
    playNote(f * 1.26, t, hold, 0.04);
    playNote(f * 1.5, t, hold, 0.04);
  });
  setTimeout(playPhrase, zoneNotes.length * PHRASE_GAP * 1000 + 15000 + Math.random() * 20000);
}
let padIdx = 0;
function playPad() {
  const notes = MELODIES[IDS.indexOf(zone)] || MELODIES[0],
    f = freq(notes[padIdx++ % notes.length]),
    t = audioCtx.currentTime;
  playNote(f, t, 9, 0.035);
  playNote(f * 1.5, t, 9, 0.025);
}
let padTimer;
export function startMusic() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  playPad();
  padTimer = setInterval(playPad, 5000);
  setTimeout(playPhrase, 3000 + Math.random() * 4000);
}
// Every one-shot cue is the same shape — a root note with a fifth chasing it — so they
// share one function and differ only in pitch: treasure 880, rune a fifth above that, and
// a cast pitched by which rune is in slot 1, so Push/Freeze/Cut/Crack are audibly distinct
// (the lesson the pickup card teaches, reinforced on every cast).
export function playCue(f) {
  const t = audioCtx.currentTime;
  playNote(f, t, 0.2, 0.08);
  playNote(f * 1.5, t + 0.06, 0.18, 0.05);
}
// takes ui-panel's RUNE_SHAPE index, so a stack of fifths replaces a per-rune lookup table
export const playCast = i => playCue(freq(i * 7 - 7));
// Ending fanfare. Deliberately not built from playCue like the pickups are — same shape at
// any length just reads as "collected something nice". A rising run resolving into a chord
// that rings out for several seconds is the part that makes it land as an ending.
export function playFanfare() {
  const t = audioCtx.currentTime,
    notes = [0, 4, 7, 12, 16, 19];
  // the pad would otherwise drone straight through the finale and flatten it
  clearInterval(padTimer);
  notes.forEach((n, i) => playNote(freq(n), t + i * 0.13, 0.45, 0.09));
  notes.forEach(n => playNote(freq(n), t + 0.85, 4.5, 0.055));
}
