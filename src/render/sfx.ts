// Mini-Synth mit WebAudio – kein einziges Audio-Asset nötig.

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let muted = false;

function ac(): AudioContext | undefined {
  if (muted) return undefined;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      return undefined;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio() { ac(); }
export function toggleMute(): boolean { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.35; return muted; }

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number) {
  const c = ac();
  if (!c || !master) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start();
}

export const sfx = {
  cut(combo: number) {
    noise(0.25, 0.5, 2400);
    tone('triangle', 520 + combo * 90, 1400 + combo * 120, 0.12, 0.25);
  },
  shatter() { noise(0.45, 0.6, 900); },
  hit() { tone('sine', 140, 40, 0.35, 0.8); noise(0.2, 0.4, 600); },
  bounce() { tone('sine', 300, 180, 0.08, 0.15); },
  snap() { tone('sawtooth', 900, 60, 0.4, 0.25); noise(0.15, 0.3, 3000); },
  link() { tone('sine', 300, 900, 0.18, 0.25); tone('sine', 600, 1800, 0.18, 0.12, 0.05); },
  wave() { [0, 0.1, 0.2].forEach((d, i) => tone('triangle', 440 * [1, 1.25, 1.5][i], 440 * [1, 1.25, 1.5][i], 0.25, 0.2, d)); },
  sling() {
    tone('sawtooth', 180, 1200, 0.45, 0.12);
    tone('sine', 400, 1600, 0.35, 0.2, 0.05);
    noise(0.4, 0.25, 4000);
  },
  impact() { tone('sine', 90, 30, 0.5, 0.7); noise(0.5, 0.5, 500); },
  planet() { tone('sine', 60, 120, 1.2, 0.35); tone('triangle', 220, 330, 1.0, 0.08, 0.2); },
  over() { [0, 0.18, 0.36].forEach((d, i) => tone('triangle', 330 / [1, 1.19, 1.5][i], 330 / [1, 1.19, 1.5][i] * 0.98, 0.4, 0.25, d)); },
};
