// Lightweight synthesized SFX (no audio assets needed).

let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
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

export const sfx = {
  unlock() {
    getCtx();
  },
  shoot() {
    tone({ freq: 900, slideTo: 300, duration: 0.08, type: "square", gain: 0.08 });
  },
  hit() {
    tone({ freq: 220, slideTo: 60, duration: 0.15, type: "sawtooth", gain: 0.18 });
  },
  kill() {
    tone({ freq: 660, slideTo: 1200, duration: 0.18, type: "triangle", gain: 0.16 });
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
};
