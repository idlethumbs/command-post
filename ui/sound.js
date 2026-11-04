/* Chiptune cues, synthesised on the fly (no audio files). Off unless you turn them on in the Grimoire. */
let ac = null, volume = 0.5, on = false;

export function setSound(enabled, vol) { on = enabled; if (vol !== undefined) volume = vol; }
const ctx = () => {
  if (!on) return null;
  try { ac ??= new AudioContext(); if (ac.state === "suspended") ac.resume(); return ac; } catch { return null; }
};

function tone(a, freq, at, dur, type = "square", gain = 0.12) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime + at);
  g.gain.setValueAtTime(0, a.currentTime + at);
  g.gain.linearRampToValueAtTime(gain * volume, a.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  o.connect(g).connect(a.destination); o.start(a.currentTime + at); o.stop(a.currentTime + at + dur + 0.02);
}
function noise(a, at, dur, from, to) {
  const n = a.createBufferSource(), buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const f = a.createBiquadFilter(), g = a.createGain();
  f.type = "bandpass"; f.Q.value = 2; f.frequency.setValueAtTime(from, a.currentTime + at); f.frequency.exponentialRampToValueAtTime(to, a.currentTime + at + dur);
  g.gain.setValueAtTime(0.18 * volume, a.currentTime + at); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  n.buffer = buf; n.connect(f).connect(g).connect(a.destination); n.start(a.currentTime + at);
}

export const cue = {
  counsel() { const a = ctx(); if (!a) return; tone(a, 784, 0, .12); tone(a, 1047, .1, .22); },              // a mage asks for you
  seal() { const a = ctx(); if (!a) return; tone(a, 392, 0, .09, "triangle", .2); tone(a, 392, .14, .12, "triangle", .2); }, // knock knock
  word() { const a = ctx(); if (!a) return; noise(a, 0, .28, 600, 3200); tone(a, 1319, .12, .12, "triangle"); },          // whoosh
  grant() { const a = ctx(); if (!a) return; [523, 659, 784, 1047].forEach((f, i) => tone(a, f, i * .06, .14)); },
  refuse() { const a = ctx(); if (!a) return; tone(a, 330, 0, .12, "sawtooth", .08); tone(a, 247, .1, .2, "sawtooth", .08); },
  travel() { const a = ctx(); if (!a) return; [392, 523, 659, 880].forEach((f, i) => tone(a, f, i * .045, .1, "triangle", .1)); },
  test() { this.counsel(); },
};
