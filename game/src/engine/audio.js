// Tiny synthesized sound kit (no audio files): engine drone, nitro hiss and a few one-shots.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /** Must be called from a user gesture (key press / click) before the browser allows audio. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    this.oscA.connect(this.engineFilter);
    this.oscB.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.oscA.start();
    this.oscB.start();

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 1400;
    this.hissFilter.Q.value = 0.7;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(this.hissFilter).connect(this.hissGain).connect(this.master);
    hiss.start();
  }

  stop() {
    this.ctx?.close();
    this.ctx = null;
  }

  engine(level, nitro, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = 42 + level * 120;
    this.oscA.frequency.setTargetAtTime(f, t, 0.06);
    this.oscB.frequency.setTargetAtTime(f * 1.505, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + level * 1500 + (nitro ? 1400 : 0), t, 0.08);
    this.engineGain.gain.setTargetAtTime(on ? 0.035 + level * 0.035 : 0, t, 0.12);
    this.hissGain.gain.setTargetAtTime(on && nitro ? 0.1 : 0, t, 0.08);
  }

  tone(freq, start, dur, type, vol) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  sweep(dur, from, to, vol, type = 'bandpass') {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [988, 1319, 1976].forEach((f, i) => this.tone(f, t + i * 0.055, 0.16, 'triangle', 0.12));
  }
  laser(own) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(own ? 1500 : 1100, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.12);
    g.gain.setValueAtTime(own ? 0.045 : 0.025, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }
  hit() { this.ctx && this.sweep(0.18, 2500, 400, 0.25); }
  alarm() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this.tone(i % 2 ? 520 : 760, t + i * 0.22, 0.2, 'sawtooth', 0.05);
  }
  boost() { this.ctx && this.sweep(0.7, 400, 4000, 0.35); }
  crash() { this.ctx && this.sweep(0.6, 900, 80, 0.6, 'lowpass'); }
  bump() { this.ctx && this.sweep(0.18, 300, 120, 0.3, 'lowpass'); }
  countdown(go) { this.ctx && this.tone(go ? 1047 : 523, this.ctx.currentTime, go ? 0.6 : 0.2, 'square', 0.08); }
  finish() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.1, 0.35, 'square', 0.07));
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }
}
