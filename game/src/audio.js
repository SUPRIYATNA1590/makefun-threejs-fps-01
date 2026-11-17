// Every sound in the game is synthesized with the Web Audio API: oscillators and
// bursts of filtered noise, no audio files and no network. The context is built on
// the first user gesture, because a browser will not start audio before one. Each
// helper below builds one short sound from scratch; nothing is pre-rendered.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let silenced = false;

  // Build (or wake) the context, plus the half-second white-noise buffer every
  // percussive sound shares. Returns false when audio is unavailable at all.
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const samples = noiseBuf.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  // A burst of noise through a low-pass filter, fading out over `duration`.
  function burst(duration, cutoff, level, delay = 0) {
    if (!ensure() || silenced) return;
    const at = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(at);
    src.stop(at + duration);
  }

  // A single oscillator tone, optionally sliding down to `slideTo` as it fades.
  function beep(freq, duration, wave, level, slideTo = null, delay = 0) {
    if (!ensure() || silenced) return;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + duration);
  }

  // Shots fade with distance: full volume up close, a faint crack at 60 metres.
  function loudness(distance) {
    return Math.max(0.05, 1 - distance / 60);
  }

  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      silenced = !silenced;
      return silenced;
    },
    shot(weaponId, distance = 0) {
      const level = loudness(distance) * 0.5;
      if (weaponId === 'sniper') {
        burst(0.28, 900, level);
        beep(120, 0.2, 'sine', level * 0.8, 40);
      } else if (weaponId === 'pistol') {
        burst(0.12, 1800, level * 0.8);
        beep(220, 0.08, 'square', level * 0.25, 90);
      } else {
        burst(0.14, 1400, level);
        beep(160, 0.1, 'sawtooth', level * 0.3, 60);
      }
    },
    enemyShot(distance) {
      burst(0.12, 1200, loudness(distance) * 0.35);
    },
    dryFire() {
      beep(1400, 0.03, 'square', 0.12);
    },
    reload() {
      beep(500, 0.04, 'square', 0.15);
      beep(700, 0.04, 'square', 0.15, null, 0.35);
    },
    hit() {
      beep(2400, 0.05, 'sine', 0.2);
    },
    kill() {
      beep(1200, 0.07, 'sine', 0.25);
      beep(1800, 0.09, 'sine', 0.25, null, 0.07);
    },
    hurt() {
      beep(90, 0.18, 'sine', 0.5, 50);
      burst(0.1, 400, 0.25);
    },
    footstep() {
      burst(0.05, 500, 0.06);
    },
    plantBeep() {
      beep(1100, 0.08, 'square', 0.18);
    },
    spikeBeep() {
      beep(1500, 0.06, 'square', 0.12);
    },
    explosion() {
      burst(0.9, 300, 0.9);
      beep(70, 0.8, 'sine', 0.8, 28);
    },
    roundWin() {
      beep(523, 0.14, 'triangle', 0.25);
      beep(659, 0.14, 'triangle', 0.25, null, 0.14);
      beep(784, 0.28, 'triangle', 0.3, null, 0.28);
    },
    roundLose() {
      beep(392, 0.16, 'triangle', 0.25);
      beep(330, 0.16, 'triangle', 0.25, null, 0.16);
      beep(262, 0.34, 'triangle', 0.28, null, 0.32);
    },
    buy() {
      beep(900, 0.06, 'sine', 0.2);
      beep(1350, 0.08, 'sine', 0.2, null, 0.06);
    },
    denied() {
      beep(180, 0.12, 'square', 0.15);
    },
  };
}
