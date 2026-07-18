// Synthesized SFX + an original looping battle theme, layered with a
// handful of real recorded samples (CC0, Kenney's Sci-Fi Sounds pack —
// see assets/audio/LICENSE.txt) for extra punch. The synthesized layer
// always plays even if the sample files fail to load, so this degrades
// gracefully offline / on a slow connection.

let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

const SAMPLE_FILES = {
  laser: ["assets/audio/laserSmall_000.ogg", "assets/audio/laserSmall_001.ogg", "assets/audio/laserSmall_002.ogg"],
  explosion: ["assets/audio/explosionCrunch_000.ogg", "assets/audio/explosionCrunch_001.ogg", "assets/audio/explosionCrunch_002.ogg"],
  lowBoom: ["assets/audio/lowFrequency_explosion_000.ogg"],
  impact: ["assets/audio/impactMetal_000.ogg", "assets/audio/impactMetal_001.ogg"],
  shutter: ["assets/audio/click_003.ogg"],
  confirm: ["assets/audio/confirmation_002.ogg"],
};
const sampleBuffers = {};
let samplesLoadPromise = null;

function loadSamples() {
  if (samplesLoadPromise) return samplesLoadPromise;
  const c = getCtx();
  samplesLoadPromise = Promise.all(
    Object.entries(SAMPLE_FILES).map(async ([key, files]) => {
      const buffers = await Promise.all(
        files.map(async (url) => {
          const res = await fetch(url);
          const arr = await res.arrayBuffer();
          return c.decodeAudioData(arr);
        })
      );
      sampleBuffers[key] = buffers;
    })
  ).catch((e) => {
    console.warn("[audio] sample pack failed to load, continuing with synth-only SFX:", e);
  });
  return samplesLoadPromise;
}

function playSample(key, { gain = 0.5, rateJitter = 0.06, delay = 0 } = {}) {
  const buffers = sampleBuffers[key];
  if (!buffers || buffers.length === 0) return; // not loaded (yet) — synth layer already covers this
  const c = getCtx();
  const buffer = buffers[Math.floor(Math.random() * buffers.length)];
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * rateJitter;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(c.destination);
  src.start(c.currentTime + delay);
}

let noiseBuffer = null;
function getNoiseBuffer(c) {
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 0.3);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function midiFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function tone({ freq = 440, duration = 0.12, type = "square", gain = 0.15, slideTo = null }) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), c.currentTime + duration);
  }
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration + 0.02);
}

// bright, punchy "blip" used for the satisfying hit/kill chimes
function blip({ freq, duration = 0.09, type = "triangle", gain = 0.2, delay = 0 }) {
  const c = getCtx();
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0006, t + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function sparkle({ delay = 0, gain = 0.12, duration = 0.09 } = {}) {
  const c = getCtx();
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 6000;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + duration);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + duration + 0.02);
}

// low thump + broadband crack — the "boom" half of an explosion, layered
// under the bright chime for a satisfying punch instead of just a sparkle.
function explosionBoom({ delay = 0, gain = 0.3 } = {}) {
  const c = getCtx();
  const t = c.currentTime + delay;

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(32, t + 0.32);
  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(gain, t);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
  osc.connect(oscGain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.38);

  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(4200, t);
  filter.frequency.exponentialRampToValueAtTime(250, t + 0.28);
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(gain * 0.75, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  noise.connect(filter).connect(noiseGain).connect(c.destination);
  noise.start(t);
  noise.stop(t + 0.32);
}

export const sfx = {
  unlock() {
    getCtx();
    loadSamples(); // kick off in the background, well before it's needed
  },
  shoot() {
    tone({ freq: 900, slideTo: 300, duration: 0.08, type: "square", gain: 0.08 });
    playSample("laser", { gain: 0.3 });
  },
  // quick bright "tink" — enemy took a hit but survived
  hit() {
    blip({ freq: 1050, duration: 0.07, gain: 0.16 });
    blip({ freq: 2100, duration: 0.05, gain: 0.06 });
    playSample("impact", { gain: 0.22 });
  },
  // satisfying rising chime + sparkle burst — Block-Blast-style clear feel.
  // Pitch climbs a little with combo (capped) so a streak sounds increasingly
  // triumphant instead of identical every time — a small but effective
  // "dopamine ladder" trick.
  kill(combo = 0) {
    explosionBoom({ gain: 0.3 });
    playSample("explosion", { gain: 0.55 });
    playSample("lowBoom", { gain: 0.4, delay: 0.02 });
    const comboStep = Math.min(combo, 10);
    const base = 1046.5 * Math.pow(2, comboStep / 24); // C6, rising up to ~a fifth over a streak
    const ratios = [1, 1.26, 1.5, 2];
    ratios.forEach((r, i) => {
      blip({ freq: base * r, duration: 0.16, gain: 0.2 - i * 0.02, delay: i * 0.045, type: "triangle" });
    });
    sparkle({ delay: 0.02, gain: 0.14, duration: 0.14 });
    sparkle({ delay: 0.12, gain: 0.08, duration: 0.1 });
  },
  // extra flourish every few kills in a row — bigger ascending run + shimmer
  comboMilestone() {
    explosionBoom({ gain: 0.36 });
    playSample("explosion", { gain: 0.6 });
    playSample("lowBoom", { gain: 0.5, delay: 0.02 });
    const notes = [1, 1.26, 1.5, 1.78, 2, 2.52];
    const base = 784; // G5
    notes.forEach((r, i) => {
      blip({ freq: base * r, duration: 0.2, gain: 0.22 - i * 0.015, delay: i * 0.05, type: "triangle" });
    });
    sparkle({ delay: 0.05, gain: 0.18, duration: 0.2 });
    sparkle({ delay: 0.18, gain: 0.12, duration: 0.16 });
    sparkle({ delay: 0.3, gain: 0.08, duration: 0.12 });
  },
  enemyAttack() {
    tone({ freq: 140, slideTo: 40, duration: 0.3, type: "sawtooth", gain: 0.22 });
  },
  phaseUp() {
    tone({ freq: 440, slideTo: 880, duration: 0.35, type: "triangle", gain: 0.2 });
  },
  gameOver() {
    tone({ freq: 300, slideTo: 40, duration: 0.9, type: "sawtooth", gain: 0.22 });
  },
  // face-capture screen: a snappy shutter click, then a bright "got it!"
  // confirmation chime once the crop is locked in — small moments of
  // positive feedback that make capturing your "enemy" feel satisfying.
  shutter() {
    blip({ freq: 1800, duration: 0.04, gain: 0.14 });
    playSample("shutter", { gain: 0.5, rateJitter: 0 });
  },
  captureConfirm() {
    const ratios = [1, 1.5, 2];
    ratios.forEach((r, i) => {
      blip({ freq: 880 * r, duration: 0.14, gain: 0.16 - i * 0.02, delay: i * 0.05, type: "triangle" });
    });
    playSample("confirm", { gain: 0.45 });
  },
};

// ---------------------------------------------------------------------------
// Battle BGM — an original, epic sci-fi fanfare (brass-style pad chords over
// timpani/snare percussion with a triumphant arpeggio motif). Not a
// reproduction of any existing copyrighted theme — just the same genre
// vibe — built entirely from oscillators via a standard lookahead scheduler.
// ---------------------------------------------------------------------------

const BPM = 172;
const BEAT = 60 / BPM;

// i - VI - III - VII, then i - VI - iv - V (D minor "epic trailer" progression)
const CHORDS = [
  { bass: 38, pad: [62, 65, 69] }, // Dm
  { bass: 34, pad: [58, 62, 65] }, // Bb
  { bass: 41, pad: [53, 57, 60] }, // F
  { bass: 36, pad: [60, 64, 67] }, // C
  { bass: 38, pad: [62, 65, 69] }, // Dm
  { bass: 34, pad: [58, 62, 65] }, // Bb
  { bass: 31, pad: [55, 58, 62] }, // Gm
  { bass: 33, pad: [57, 61, 64] }, // A
];

let bgmGain = null;
function getBgmGain(c) {
  if (!bgmGain) {
    bgmGain = c.createGain();
    bgmGain.gain.value = 0;
    bgmGain.connect(c.destination);
  }
  return bgmGain;
}

class BattleMusic {
  constructor() {
    this._playing = false;
    this._nextBarTime = 0;
    this._barIndex = 0;
    this._timerId = null;
  }

  start() {
    if (this._playing) return;
    const c = getCtx();
    this._playing = true;
    this._gain = getBgmGain(c);
    this._gain.gain.cancelScheduledValues(c.currentTime);
    this._gain.gain.setValueAtTime(this._gain.gain.value, c.currentTime);
    this._gain.gain.linearRampToValueAtTime(0.26, c.currentTime + 0.4);
    this._playOpeningStinger(c.currentTime + 0.05);
    this._barIndex = 0;
    this._nextBarTime = c.currentTime + 1.35; // let the stinger ring out first
    this._scheduler();
  }

  // A big bright unison "movie fanfare" hit the instant battle starts —
  // a wide brass chord across octaves plus a timpani punch underneath.
  _playOpeningStinger(t) {
    const c = getCtx();
    const rootMidi = 62; // D
    const chordMidis = [rootMidi - 12, rootMidi, rootMidi + 4, rootMidi + 7, rootMidi + 12, rootMidi + 16];
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    filter.connect(this._gain);
    for (const m of chordMidis) {
      for (const type of ["sawtooth", "square"]) {
        const osc = c.createOscillator();
        osc.type = type;
        osc.frequency.value = midiFreq(m) * (type === "square" ? 1 : 1.004);
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.32, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.15);
        osc.connect(g).connect(filter);
        osc.start(t);
        osc.stop(t + 1.2);
      }
    }
    this._playTimp(t);
    this._playTimp(t + 0.3);
  }

  stop() {
    if (!this._playing) return;
    this._playing = false;
    clearTimeout(this._timerId);
    const c = getCtx();
    if (this._gain) {
      this._gain.gain.cancelScheduledValues(c.currentTime);
      this._gain.gain.setValueAtTime(this._gain.gain.value, c.currentTime);
      this._gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.7);
    }
  }

  _scheduler() {
    if (!this._playing) return;
    const c = getCtx();
    while (this._nextBarTime < c.currentTime + 0.15) {
      this._scheduleBar(this._barIndex % CHORDS.length, this._nextBarTime);
      this._nextBarTime += BEAT * 4;
      this._barIndex++;
    }
    this._timerId = setTimeout(() => this._scheduler(), 40);
  }

  _scheduleBar(chordIdx, t) {
    const chord = CHORDS[chordIdx];
    this._playPadStabs(chord, t);
    this._playBassPulse(chord.bass, t);
    for (let i = 0; i < 8; i++) this._playHat(t + i * (BEAT / 2), i % 2 === 0 ? 0.1 : 0.05);
    this._playTimp(t);
    this._playTimp(t + BEAT * 2);
    this._playSnare(t + BEAT * 1);
    this._playSnare(t + BEAT * 3);
    if (chordIdx % 2 === 0) this._playFanfare(chord, t);
  }

  // Rhythmic chord stabs on every beat (instead of one long sustained pad
  // per bar) — this is what actually makes the track *feel* fast, since a
  // sustained pad reads as slow no matter the BPM number underneath it.
  _playPadStabs(chord, barTime) {
    const c = getCtx();
    for (let beat = 0; beat < 4; beat++) {
      const t = barTime + beat * BEAT;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + BEAT * 0.85);
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1500;
      g.connect(filter).connect(this._gain);
      for (const m of chord.pad) {
        for (const type of ["sawtooth", "square"]) {
          const osc = c.createOscillator();
          osc.type = type;
          osc.frequency.value = midiFreq(m) * (type === "square" ? 1 : 1.003);
          osc.connect(g);
          osc.start(t);
          osc.stop(t + BEAT * 0.9);
        }
      }
    }
  }

  // Driving 8th-note bass pulse (root-root-fifth-root pattern) instead of one
  // held note per bar.
  _playBassPulse(rootMidi, barTime) {
    const c = getCtx();
    const pattern = [0, 0, 7, 0, 0, 0, 7, 5];
    for (let i = 0; i < 8; i++) {
      const t = barTime + i * (BEAT / 2);
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiFreq(rootMidi + pattern[i]);
      const g = c.createGain();
      g.gain.setValueAtTime(0.32, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + BEAT * 0.42);
      osc.connect(g).connect(this._gain);
      osc.start(t);
      osc.stop(t + BEAT * 0.45);
    }
  }

  // Fast closed-hihat-style tick for a driving, propulsive rhythm bed.
  _playHat(t, gain) {
    const c = getCtx();
    const src = c.createBufferSource();
    src.buffer = getNoiseBuffer(c);
    const filter = c.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.045);
    src.connect(filter).connect(g).connect(this._gain);
    src.start(t);
    src.stop(t + 0.05);
  }

  _playFanfare(chord, t) {
    const c = getCtx();
    const notes = [chord.pad[0], chord.pad[1], chord.pad[2], chord.pad[0] + 12];
    const durs = [BEAT * 0.4, BEAT * 0.4, BEAT * 0.4, BEAT * 0.9];
    let nt = t;
    for (let i = 0; i < notes.length; i++) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiFreq(notes[i]);
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2200;
      const g = c.createGain();
      g.gain.setValueAtTime(0, nt);
      g.gain.linearRampToValueAtTime(0.28, nt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, nt + durs[i]);
      osc.connect(filter).connect(g).connect(this._gain);
      osc.start(nt);
      osc.stop(nt + durs[i] + 0.02);
      nt += durs[i];
    }
  }

  _playTimp(t) {
    const c = getCtx();
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.26);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(this._gain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  _playSnare(t) {
    const c = getCtx();
    const src = c.createBufferSource();
    src.buffer = getNoiseBuffer(c);
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(filter).connect(g).connect(this._gain);
    src.start(t);
    src.stop(t + 0.13);
  }
}

export const battleMusic = new BattleMusic();
