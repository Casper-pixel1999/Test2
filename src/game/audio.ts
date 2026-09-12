/** Lightweight WebAudio SFX — no external assets */
export type SfxId = 'ready' | 'pick' | 'assemble' | 'serve' | 'pay' | 'clean' | 'buy' | 'angry' | 'click';

const MUTE_KEY = 'burger_rush_muted';

export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private unlocked = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch (_) {}
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (_) {}
  }

  toggle() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Call from first user gesture so AudioContext can start */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ensure();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    return this.ctx;
  }

  play(id: SfxId) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    switch (id) {
      case 'ready':
        this.tone(ctx, 660, t0, 0.07, 'triangle', 0.09);
        this.tone(ctx, 880, t0 + 0.07, 0.1, 'triangle', 0.1);
        break;
      case 'pick':
        this.tone(ctx, 520, t0, 0.05, 'square', 0.05);
        break;
      case 'assemble':
        this.tone(ctx, 280, t0, 0.06, 'triangle', 0.07);
        this.tone(ctx, 360, t0 + 0.05, 0.07, 'triangle', 0.05);
        break;
      case 'serve':
        this.tone(ctx, 440, t0, 0.05, 'sine', 0.06);
        this.tone(ctx, 660, t0 + 0.06, 0.08, 'sine', 0.07);
        break;
      case 'pay':
        this.tone(ctx, 784, t0, 0.06, 'sine', 0.08);
        this.tone(ctx, 988, t0 + 0.07, 0.08, 'sine', 0.09);
        this.tone(ctx, 1175, t0 + 0.15, 0.12, 'sine', 0.07);
        break;
      case 'clean':
        this.noise(ctx, t0, 0.12, 0.05);
        this.tone(ctx, 900, t0 + 0.04, 0.06, 'sine', 0.04);
        break;
      case 'buy':
        this.tone(ctx, 392, t0, 0.06, 'triangle', 0.07);
        this.tone(ctx, 523, t0 + 0.07, 0.07, 'triangle', 0.08);
        this.tone(ctx, 659, t0 + 0.15, 0.12, 'triangle', 0.09);
        break;
      case 'angry':
        this.tone(ctx, 180, t0, 0.15, 'sawtooth', 0.05);
        this.tone(ctx, 140, t0 + 0.12, 0.18, 'sawtooth', 0.04);
        break;
      case 'click':
        this.tone(ctx, 700, t0, 0.03, 'square', 0.035);
        break;
    }
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    when: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private noise(ctx: AudioContext, when: number, dur: number, gain: number) {
    const n = Math.max(1, (ctx.sampleRate * dur) | 0);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(g);
    g.connect(ctx.destination);
    src.start(when);
    src.stop(when + dur + 0.02);
  }
}

export const sfx = new Sfx();
