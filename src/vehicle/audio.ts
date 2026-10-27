import { AUDIO, PHYSICS } from '../config.ts';

/**
 * WebAudio for the bus. Everything is synthesised for now; `EngineSource` is an interface so a
 * sample-based engine (granular / looped recordings) can be dropped in later without touching
 * the game loop.
 */
export interface EngineSource {
  update(rpm: number, throttle: number, dt: number): void;
  connect(dest: AudioNode): void;
}

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;   // brown-ish
    d[i] = last * 3.5;
  }
  return buf;
}

/**
 * Synth diesel for a 12-tonne bus: low firing fundamental (rpm/60 × 1.5), a slow "chug" that
 * modulates gain at firing rate, sub-bass, heavy low-pass and lots of exhaust noise. Everything
 * sits below ~600 Hz so it rumbles instead of buzzing like a two-wheeler.
 */
class SynthEngine implements EngineSource {
  private out: GainNode;
  private osc1: OscillatorNode; private osc2: OscillatorNode; private sub: OscillatorNode; private chug: OscillatorNode;
  private chugGain: GainNode; private filt: BiquadFilterNode; private filt2: BiquadFilterNode;
  private noiseGain: GainNode; private noiseFilt: BiquadFilterNode;
  private smoothed = PHYSICS.idleRpm;

  constructor(private ctx: AudioContext, noise: AudioBuffer) {
    this.out = ctx.createGain(); this.out.gain.value = 0;
    // two cascaded low-pass stages = 24 dB/oct roll-off above the rumble
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 220; this.filt.Q.value = 1.1;
    this.filt2 = ctx.createBiquadFilter(); this.filt2.type = 'lowpass'; this.filt2.frequency.value = 420; this.filt2.Q.value = 0.7;
    // chug: amplitude modulation at firing rate so each "bang" is audible at idle
    this.chug = ctx.createOscillator(); this.chug.type = 'square';
    this.chugGain = ctx.createGain(); this.chugGain.gain.value = 0.35;
    const amp = ctx.createGain(); amp.gain.value = 0.65;
    this.chug.connect(this.chugGain).connect(amp.gain);
    this.filt.connect(this.filt2).connect(amp).connect(this.out);
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'triangle';
    this.sub = ctx.createOscillator(); this.sub.type = 'sine';
    const g1 = ctx.createGain(); g1.gain.value = 0.5; this.osc1.connect(g1).connect(this.filt);
    const g2 = ctx.createGain(); g2.gain.value = 0.35; this.osc2.connect(g2).connect(this.filt);
    const g3 = ctx.createGain(); g3.gain.value = 0.9; this.sub.connect(g3).connect(this.filt);
    const ns = ctx.createBufferSource(); ns.buffer = noise; ns.loop = true;
    this.noiseFilt = ctx.createBiquadFilter(); this.noiseFilt.type = 'bandpass'; this.noiseFilt.frequency.value = 110; this.noiseFilt.Q.value = 0.6;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0.6;
    ns.connect(this.noiseFilt).connect(this.noiseGain).connect(this.filt);
    this.osc1.start(); this.osc2.start(); this.sub.start(); this.chug.start(); ns.start();
  }

  connect(dest: AudioNode) { this.out.connect(dest); }

  update(rpm: number, throttle: number, dt: number) {
    this.smoothed += (rpm - this.smoothed) * Math.min(1, dt * 6);
    const t = this.ctx.currentTime;
    const rps = this.smoothed / 60;
    const fire = rps * 1.5;                   // perceived firing rate of a big slow diesel
    this.osc1.frequency.setTargetAtTime(fire, t, 0.03);
    this.osc2.frequency.setTargetAtTime(fire * 2.01, t, 0.03);
    this.sub.frequency.setTargetAtTime(Math.max(20, fire * 0.5), t, 0.03);
    this.chug.frequency.setTargetAtTime(Math.max(8, fire), t, 0.03);
    const load = 0.3 + throttle * 0.7;
    this.filt.frequency.setTargetAtTime(140 + this.smoothed * 0.09 + throttle * 160, t, 0.08);
    this.filt2.frequency.setTargetAtTime(300 + this.smoothed * 0.12 + throttle * 220, t, 0.08);
    this.chugGain.gain.setTargetAtTime(0.45 - Math.min(0.35, this.smoothed / PHYSICS.redlineRpm * 0.4), t, 0.1);
    this.noiseFilt.frequency.setTargetAtTime(90 + this.smoothed * 0.06, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(0.4 + throttle * 0.7, t, 0.08);
    this.out.gain.setTargetAtTime(AUDIO.engineGain * (0.5 + 0.5 * load) * (0.7 + 0.3 * this.smoothed / PHYSICS.redlineRpm), t, 0.06);
  }
}

export class BusAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine!: EngineSource;
  private hornOsc: OscillatorNode[] = [];
  private hornGain!: GainNode;
  private roadGain!: GainNode; private windGain!: GainNode; private rainGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private hornOn = false;
  private muted = false;

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = AUDIO.masterGain;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const noise = noiseBuffer(ctx);

    this.engine = new SynthEngine(ctx, noise);
    this.engine.connect(this.master);

    // Horn: Bangladeshi bus air-horn-ish two-tone
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1400;
    this.hornGain.connect(hf).connect(this.master);
    for (const [f, type] of [[311, 'sawtooth'], [370, 'square'], [155, 'sawtooth']] as [number, OscillatorType][]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.3; o.connect(g).connect(this.hornGain); o.start();
      this.hornOsc.push(o);
    }

    // Road / tyre noise
    const rs = ctx.createBufferSource(); rs.buffer = noise; rs.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 500;
    this.roadGain = ctx.createGain(); this.roadGain.gain.value = 0;
    rs.connect(rf).connect(this.roadGain).connect(this.master); rs.start();

    // Wind: filtered white noise, pitch up with speed
    const wbuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const wd = wbuf.getChannelData(0); for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const ws = ctx.createBufferSource(); ws.buffer = wbuf; ws.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 600; this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    ws.connect(this.windFilter).connect(this.windGain).connect(this.master); ws.start();

    // Rain hiss
    const rn = ctx.createBufferSource(); rn.buffer = wbuf; rn.loop = true;
    const rnf = ctx.createBiquadFilter(); rnf.type = 'highpass'; rnf.frequency.value = 3000;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    rn.connect(rnf).connect(this.rainGain).connect(this.master); rn.start();
  }

  get ready(): boolean { return !!this.ctx; }

  update(dt: number, rpm: number, throttle: number, kmh: number, horn: boolean, onRoad: boolean, rain: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.update(rpm, throttle, dt);
    if (horn !== this.hornOn) {
      this.hornOn = horn;
      this.hornGain.gain.cancelScheduledValues(t);
      this.hornGain.gain.setTargetAtTime(horn ? AUDIO.hornGain : 0, t, horn ? 0.03 : 0.08);
    }
    const sp = Math.min(1, kmh / 120);
    this.roadGain.gain.setTargetAtTime(AUDIO.roadGain * sp * (onRoad ? 1 : 2.2) * (0.3 + rain * 0.7 + 0.5), t, 0.1);
    this.windGain.gain.setTargetAtTime(AUDIO.windGain * sp * sp, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + sp * 1400, t, 0.1);
    this.rainGain.gain.setTargetAtTime(AUDIO.rainGain * rain, t, 0.3);
  }

  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); if (this.master && !this.muted) this.master.gain.value = AUDIO.masterGain * this.volume; }
  private volume = 1;
  /** Short synthesised stings for the intro. */
  sting(kind: 'start' | 'horn') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'horn') { this.hornGain.gain.cancelScheduledValues(t); this.hornGain.gain.setValueAtTime(AUDIO.hornGain, t); this.hornGain.gain.setTargetAtTime(0, t + 0.6, 0.1); return; }
    // engine start: crank then rev
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(18, t); o.frequency.linearRampToValueAtTime(70, t + 1.2); o.frequency.exponentialRampToValueAtTime(140, t + 2.2);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 2.7);
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : AUDIO.masterGain * this.volume;
  }
  get isMuted() { return this.muted; }
}
