/* ============ Background music: a tiny looping melody, raw Web Audio, no library ============ */
// Started on Play (browsers block audio before a user gesture — see render-hud.js's
// pointerdown handler). Every 4th note also gets a major triad (root/major-third/fifth
// ratios) held underneath for the full 4-note group instead of a short pluck.
const actx = new (window.AudioContext || window.webkitAudioContext)();
const NOTES = [
  261.63, 329.63, 392.0, 523.25, 587.33, 523.25, 392.0, 329.63, 349.23, 440.0, 523.25, 659.25,
  587.33, 523.25, 440.0, 261.63,
];
const NOTE_GAP = 0.38;
let noteI = 0;
function playNote(freq, t, dur = 0.4) {
  const o = actx.createOscillator(),
    g = actx.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
export function startMusic() {
  if (actx.state === 'suspended') actx.resume();
  setInterval(() => {
    const freq = NOTES[noteI % NOTES.length];
    const t = actx.currentTime + 0.05;
    playNote(freq, t);
    if (noteI % 4 === 0) {
      const hold = NOTE_GAP * 4;
      playNote(freq * 1.26, t, hold);
      playNote(freq * 1.5, t, hold);
    }
    noteI++;
  }, NOTE_GAP * 1000);
}
// quick bright ascending "ding" — same oscillator/envelope as the melody, just two short
// notes a sixth apart
export function playPickup() {
  const t = actx.currentTime;
  playNote(880, t, 0.12);
  playNote(1318.51, t + 0.08, 0.2);
}
