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
export function startMusic() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  playPad();
  setInterval(playPad, 5000);
  setTimeout(playPhrase, 3000 + Math.random() * 4000);
}
export function playPickup() {
  const t = audioCtx.currentTime;
  playNote(880, t, 0.12);
  playNote(1318.51, t + 0.08, 0.2);
}
