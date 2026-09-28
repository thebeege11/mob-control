/**
 * Centralised audio. All sounds are synthesised at runtime with WebAudio
 * (no copyrighted assets, tiny download). Each sound has a cooldown so a
 * 200-unit swarm can't produce 200 overlapping pops.
 *
 * To use recorded assets later, implement `play()` with AudioBuffers keyed by
 * the same SoundId — no game code changes needed.
 */
export type SoundId =
  | 'click'
  | 'launch'
  | 'pop'
  | 'hit'
  | 'enemyDie'
  | 'crate'
  | 'gate'
  | 'gateBad'
  | 'coin'
  | 'reward'
  | 'upgrade'
  | 'combo'
  | 'comboBreak'
  | 'perfect'
  | 'boss'
  | 'stomp'
  | 'warn'
  | 'surge'
  | 'victory'
  | 'fail'
  | 'fortressHit'
  | 'destroy'
  | 'chest';

const COOLDOWN: Partial<Record<SoundId, number>> = {
  pop: 0.035,
  hit: 0.05,
  coin: 0.04,
  fortressHit: 0.07,
  enemyDie: 0.04,
  launch: 0.05,
};

type Ctx = AudioContext;

export class AudioManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SoundId, number>();
  private musicOn = false;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private beat = 0;
  private intensity = 0;
  sfxEnabled = true;
  musicEnabled = true;

  /** Must be called from a user gesture (mobile autoplay rules). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    if (this.musicEnabled && this.musicOn) this.startMusicLoop();
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  play(id: SoundId, pitch = 1, volume = 1): void {
    if (!this.sfxEnabled || !this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const cd = COOLDOWN[id];
    if (cd) {
      const l = this.last.get(id) ?? -1;
      if (t - l < cd) return;
      this.last.set(id, t);
    }
    const v = volume;
    switch (id) {
      case 'click':
        this.tone('square', 900, 1200, 0.05, 0.12 * v, t);
        break;
      case 'launch':
        this.tone('sine', 320 * pitch, 720 * pitch, 0.09, 0.18 * v, t);
        break;
      case 'pop':
        this.noiseHit(1800 * pitch, 0.05, 0.12 * v, t, 'bandpass');
        this.tone('sine', 520 * pitch, 180 * pitch, 0.06, 0.08 * v, t);
        break;
      case 'hit':
        this.tone('sine', 150, 70, 0.08, 0.22 * v, t);
        this.noiseHit(900, 0.04, 0.1 * v, t, 'lowpass');
        break;
      case 'enemyDie':
        this.noiseHit(2400 * pitch, 0.09, 0.16 * v, t, 'bandpass');
        this.tone('square', 420 * pitch, 110 * pitch, 0.1, 0.08 * v, t);
        break;
      case 'crate':
        this.noiseHit(700, 0.14, 0.25 * v, t, 'lowpass');
        this.tone('triangle', 1300, 1700, 0.08, 0.1 * v, t + 0.05);
        break;
      case 'gate':
        [0, 4, 7, 12].forEach((s, i) => this.tone('triangle', note(60 + s) * pitch, note(60 + s) * pitch, 0.09, 0.14 * v, t + i * 0.045));
        break;
      case 'gateBad':
        [0, -3, -7].forEach((s, i) => this.tone('sawtooth', note(52 + s), note(51 + s), 0.12, 0.08 * v, t + i * 0.07));
        break;
      case 'coin':
        this.tone('square', 1320, 1320, 0.05, 0.06 * v, t);
        this.tone('square', 1760, 1760, 0.08, 0.06 * v, t + 0.05);
        break;
      case 'reward':
        [0, 4, 7, 12, 16].forEach((s, i) => this.tone('triangle', note(72 + s), note(72 + s), 0.12, 0.12 * v, t + i * 0.06));
        break;
      case 'upgrade':
        [0, 7, 12, 19].forEach((s, i) => this.tone('square', note(60 + s), note(60 + s), 0.1, 0.09 * v, t + i * 0.05));
        this.tone('sine', note(84), note(96), 0.3, 0.06 * v, t + 0.2);
        break;
      case 'combo': {
        const base = 64 + Math.min(12, pitch * 2);
        this.tone('triangle', note(base), note(base + 12), 0.14, 0.16 * v, t);
        this.tone('sine', note(base + 7), note(base + 19), 0.18, 0.1 * v, t + 0.05);
        break;
      }
      case 'comboBreak':
        this.tone('triangle', note(62), note(55), 0.2, 0.1 * v, t);
        break;
      case 'perfect':
        [0, 5, 9, 12].forEach((s, i) => this.tone('sine', note(79 + s), note(79 + s), 0.1, 0.09 * v, t + i * 0.035));
        break;
      case 'boss':
        this.tone('sawtooth', 55, 45, 1.2, 0.25 * v, t, 380);
        this.tone('sawtooth', 82, 70, 1.2, 0.18 * v, t + 0.1, 380);
        break;
      case 'stomp':
        this.tone('sine', 90, 30, 0.45, 0.5 * v, t);
        this.noiseHit(300, 0.35, 0.35 * v, t, 'lowpass');
        break;
      case 'warn':
        this.tone('square', 880, 880, 0.08, 0.06 * v, t);
        this.tone('square', 660, 660, 0.08, 0.06 * v, t + 0.12);
        break;
      case 'surge':
        this.noiseSweep(t, 0.6, 0.2 * v);
        [0, 4, 7, 11, 14].forEach((s, i) => this.tone('sawtooth', note(57 + s), note(57 + s), 0.5, 0.05 * v, t + i * 0.02, 2400));
        break;
      case 'victory':
        [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) => this.tone('square', note(64 + s), note(64 + s), 0.14, 0.08 * v, t + i * 0.09));
        this.tone('triangle', note(40), note(40), 0.8, 0.2 * v, t + 0.36);
        break;
      case 'fail':
        [0, -1, -2, -5].forEach((s, i) => this.tone('sawtooth', note(55 + s), note(54 + s), 0.22, 0.09 * v, t + i * 0.2, 900));
        break;
      case 'fortressHit':
        this.noiseHit(500 * pitch, 0.06, 0.12 * v, t, 'lowpass');
        this.tone('sine', 110, 80, 0.06, 0.12 * v, t);
        break;
      case 'destroy':
        this.noiseHit(400, 0.9, 0.5 * v, t, 'lowpass');
        this.tone('sine', 120, 30, 0.9, 0.4 * v, t);
        break;
      case 'chest':
        [0, 7, 12, 16, 19, 24].forEach((s, i) => this.tone('triangle', note(67 + s), note(67 + s), 0.16, 0.1 * v, t + i * 0.05));
        break;
    }
  }

  // ---------------------------------------------------------------- music

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (on && this.musicEnabled && this.ctx) this.startMusicLoop();
    if (!on || !this.musicEnabled) this.stopMusicLoop();
  }

  /** 0 = calm (menu), 1 = gameplay, 2 = boss. */
  setIntensity(i: number): void {
    this.intensity = i;
  }

  private startMusicLoop(): void {
    if (this.musicTimer || !this.ctx) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 50);
  }

  private stopMusicLoop(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const bpm = this.intensity >= 2 ? 136 : this.intensity >= 1 ? 124 : 100;
    const step = 60 / bpm / 2; // eighth notes
    // Original 4-bar progression (i - VI - III - VII in A minor).
    const roots = [45, 41, 48, 43];
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const t = this.nextBeat;
      const b = this.beat;
      const bar = Math.floor(b / 8) % 4;
      const pos = b % 8;
      const root = roots[bar];
      if (this.intensity >= 1 && (pos === 0 || pos === 4)) this.kick(t);
      if (this.intensity >= 1 && pos % 2 === 1) this.hat(t);
      if (this.intensity >= 2 && pos === 6) this.kick(t);
      const bassNote = pos % 2 === 0 ? root : root + 12;
      this.tone('triangle', note(bassNote), note(bassNote), step * 0.9, this.intensity ? 0.16 : 0.1, t, 0, this.musicBus);
      if (pos === 0 || pos === 3 || pos === 6) {
        const arp = [0, 3, 7, 10, 12][(b + bar) % 5];
        this.tone('square', note(root + 24 + arp), note(root + 24 + arp), step * 0.6, 0.03, t, 1800, this.musicBus);
      }
      this.nextBeat += step;
      this.beat++;
    }
  }

  private kick(t: number): void {
    this.tone('sine', 140, 40, 0.14, 0.35, t, 0, this.musicBus);
  }

  private hat(t: number): void {
    if (!this.ctx || !this.noise || !this.musicBus) return;
    this.noiseHit(8000, 0.03, 0.05, t, 'highpass', this.musicBus);
  }

  // ---------------------------------------------------------------- synth primitives

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, t: number, lowpass = 0, bus?: GainNode | null): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (lowpass > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(bus ?? this.sfxBus!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseHit(freq: number, dur: number, vol: number, t: number, type: BiquadFilterType, bus?: GainNode | null): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  private noiseSweep(t: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

function note(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
