// audio.js — effetti sonori sintetizzati con la Web Audio API (nessun file audio esterno necessario).

let ctx = null;
let masterGain = null;
let heartbeatTimer = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.35;
  masterGain.connect(ctx.destination);
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function tone(freq, duration, { type = 'sine', peak = 0.5, attack = 0.005, freqEnd = null, delay = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const len = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function noiseBurst(duration, { peak = 0.4, filterFreq = 1200, filterType = 'bandpass', delay = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  src.connect(filter).connect(gain).connect(masterGain);
  src.start(t0);
  src.stop(t0 + duration + 0.03);
}

export function sfxGather() {
  tone(520, 0.09, { type: 'triangle', peak: 0.3 });
  tone(760, 0.07, { type: 'triangle', peak: 0.22, delay: 0.05 });
}
export function sfxCraft() {
  tone(440, 0.1, { type: 'square', peak: 0.16 });
  tone(660, 0.14, { type: 'square', peak: 0.2, delay: 0.08 });
}
export function sfxBuild() {
  noiseBurst(0.12, { peak: 0.28, filterFreq: 300, filterType: 'lowpass' });
  tone(120, 0.15, { type: 'sine', peak: 0.28 });
}
export function sfxHit() {
  noiseBurst(0.08, { peak: 0.32, filterFreq: 1800 });
  tone(200, 0.1, { type: 'sawtooth', peak: 0.22, freqEnd: 80 });
}
export function sfxHurt() {
  tone(160, 0.22, { type: 'sawtooth', peak: 0.28, freqEnd: 60 });
}
export function sfxBowShot() {
  noiseBurst(0.1, { peak: 0.22, filterFreq: 2600, filterType: 'highpass' });
}
export function sfxMolotovThrow() {
  noiseBurst(0.2, { peak: 0.2, filterFreq: 900, filterType: 'lowpass' });
}
export function sfxNightFall() {
  tone(220, 1.4, { type: 'sine', peak: 0.2, freqEnd: 90 });
  tone(110, 1.6, { type: 'sine', peak: 0.14, delay: 0.15, freqEnd: 55 });
}
export function sfxDayBreak() {
  tone(440, 0.5, { type: 'sine', peak: 0.18 });
  tone(660, 0.6, { type: 'sine', peak: 0.16, delay: 0.12 });
}

export function setLowHpHeartbeat(active) {
  if (active && !heartbeatTimer) {
    const beat = () => tone(58, 0.18, { type: 'sine', peak: 0.26 });
    beat();
    heartbeatTimer = setInterval(beat, 900);
  } else if (!active && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
