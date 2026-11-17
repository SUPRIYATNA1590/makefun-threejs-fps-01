// Sound without sound files: every effect in the game is synthesized with the
// Web Audio API, from oscillators and bursts of filtered noise. The context is
// built on the first user gesture, because browsers refuse to start audio
// before one. Nothing here is pre-rendered; each helper builds its sound fresh.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let silenced = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(
        1,
        ctx.sampleRate * 0.5,
        ctx.sampleRate,
      );
      const samples = noiseBuf.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = Math.random() * 2 - 1;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Noise through a low-pass filter, fading out over `duration` seconds.
  function playNoise(duration, cutoff, level, delay = 0) {
    if (!ensure() || silenced) {
      return;
    }
    const at = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(at);
    src.stop(at + duration);
  }

  // One oscillator tone, sliding down to `slideTo` as it fades out.
  function playTone(freq, duration, wave, level, slideTo = null, delay = 0) {
    if (!ensure() || silenced) {
      return;
    }
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + duration);
  }

  // Shots fade with distance: full volume up close, a faint crack at 60 m.
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
      if (weaponId === "sniper") {
        playNoise(0.28, 900, level);
        playTone(120, 0.2, "sine", level * 0.8, 40);
      } else if (weaponId === "pistol") {
        playNoise(0.12, 1800, level * 0.8);
        playTone(220, 0.08, "square", level * 0.25, 90);
      } else {
        playNoise(0.14, 1400, level);
        playTone(160, 0.1, "sawtooth", level * 0.3, 60);
      }
    },
    enemyShot(distance) {
      playNoise(0.12, 1200, loudness(distance) * 0.35);
    },
    dryFire() {
      playTone(1400, 0.03, "square", 0.12);
    },
    reload() {
      playTone(500, 0.04, "square", 0.15);
      playTone(700, 0.04, "square", 0.15, null, 0.35);
    },
    hit() {
      playTone(2400, 0.05, "sine", 0.2);
    },
    kill() {
      playTone(1200, 0.07, "sine", 0.25);
      playTone(1800, 0.09, "sine", 0.25, null, 0.07);
    },
    hurt() {
      playTone(90, 0.18, "sine", 0.5, 50);
      playNoise(0.1, 400, 0.25);
    },
    footstep() {
      playNoise(0.05, 500, 0.06);
    },
    plantBeep() {
      playTone(1100, 0.08, "square", 0.18);
    },
    spikeBeep() {
      playTone(1500, 0.06, "square", 0.12);
    },
    explosion() {
      playNoise(0.9, 300, 0.9);
      playTone(70, 0.8, "sine", 0.8, 28);
    },
    roundWin() {
      playTone(523, 0.14, "triangle", 0.25);
      playTone(659, 0.14, "triangle", 0.25, null, 0.14);
      playTone(784, 0.28, "triangle", 0.3, null, 0.28);
    },
    roundLose() {
      playTone(392, 0.16, "triangle", 0.25);
      playTone(330, 0.16, "triangle", 0.25, null, 0.16);
      playTone(262, 0.34, "triangle", 0.28, null, 0.32);
    },
    buy() {
      playTone(900, 0.06, "sine", 0.2);
      playTone(1350, 0.08, "sine", 0.2, null, 0.06);
    },
    denied() {
      playTone(180, 0.12, "square", 0.15);
    },
  };
}
