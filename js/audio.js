// Простые синтезированные звуки через WebAudio
let ctx = null;
let enabled = true;

export function setSound(on) { enabled = on; }
export function soundOn() { return enabled; }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ f = 440, f2 = null, t = 0.12, type = 'square', vol = 0.08, delay = 0 }) {
  if (!enabled) return;
  const a = ac(); if (!a) return;
  const now = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, now);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + t);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + t);
  o.connect(g).connect(a.destination);
  o.start(now);
  o.stop(now + t + 0.02);
}

function noise(t = 0.15, vol = 0.1, delay = 0) {
  if (!enabled) return;
  const a = ac(); if (!a) return;
  const now = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * t);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(a.destination);
  s.start(now);
}

export const sfx = {
  tap: () => tone({ f: 660, t: 0.05, type: 'triangle', vol: 0.05 }),
  place: () => { tone({ f: 200, f2: 120, t: 0.12, type: 'square', vol: 0.06 }); noise(0.08, 0.05); },
  spell: () => { tone({ f: 300, f2: 900, t: 0.25, type: 'sawtooth', vol: 0.04 }); },
  hit: () => { noise(0.1, 0.12); tone({ f: 160, f2: 60, t: 0.1, type: 'square', vol: 0.06 }); },
  coin: () => { tone({ f: 988, t: 0.06, type: 'square', vol: 0.04 }); tone({ f: 1319, t: 0.12, type: 'square', vol: 0.04, delay: 0.06 }); },
  die: () => { tone({ f: 400, f2: 80, t: 0.4, type: 'sawtooth', vol: 0.05 }); },
  scream: () => { tone({ f: 900, f2: 1400, t: 0.15, type: 'sawtooth', vol: 0.035 }); tone({ f: 1400, f2: 500, t: 0.3, type: 'sawtooth', vol: 0.035, delay: 0.15 }); },
  heart: () => { tone({ f: 120, f2: 50, t: 0.3, type: 'sine', vol: 0.2 }); noise(0.2, 0.08); },
  boom: () => { noise(0.4, 0.2); tone({ f: 90, f2: 30, t: 0.4, type: 'sine', vol: 0.2 }); },
  step: () => tone({ f: 220, t: 0.03, type: 'triangle', vol: 0.025 }),
  win: () => { [523, 659, 784, 1046].forEach((f, i) => tone({ f, t: 0.18, type: 'square', vol: 0.05, delay: i * 0.12 })); },
  lose: () => { [392, 330, 262, 196].forEach((f, i) => tone({ f, t: 0.3, type: 'triangle', vol: 0.07, delay: i * 0.2 })); },
  rumor: () => { tone({ f: 500, f2: 450, t: 0.1, type: 'triangle', vol: 0.05 }); tone({ f: 420, f2: 380, t: 0.15, type: 'triangle', vol: 0.05, delay: 0.1 }); },
};
