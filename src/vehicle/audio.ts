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
 * Smooth bus engine hum: a low fundamental (2 × rps) with soft harmonics, a slow vibrato for life,
 * a gentle noise bed, and a resonant low-pass that opens with throttle. No amplitude chopping —
 * the sound rises smoothly with rpm instead of putt-putting.
 */
class SynthEngine implements EngineSource {
  private out: GainNode;
  private osc1: OscillatorNode; private osc2: OscillatorNode; private osc3: OscillatorNode; private sub: OscillatorNode;
  private lfo: OscillatorNode; private lfoGain: GainNode;
  private filt: BiquadFilterNode; private filt2: BiquadFilterNode;
  private noiseGain: GainNode; private noiseFilt: BiquadFilterNode;
  private smoothed = PHYSICS.idleRpm;

  constructor(private ctx: AudioContext, noise: AudioBuffer) {
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 320; this.filt.Q.value = 0.9;
    this.filt2 = ctx.createBiquadFilter(); this.filt2.type = 'lowpass'; this.filt2.frequency.value = 900; this.filt2.Q.value = 0.5;
    this.filt.connect(this.filt2).connect(this.out);
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'triangle';
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'sine';
    this.sub = ctx.createOscillator(); this.sub.type = 'sine';
    const g1 = ctx.createGain(); g1.gain.value = 0.22; this.osc1.connect(g1).connect(this.filt);
    const g2 = ctx.createGain(); g2.gain.value = 0.3; this.osc2.connect(g2).connect(this.filt);
    const g3 = ctx.createGain(); g3.gain.value = 0.18; this.osc3.connect(g3).connect(this.filt);
    const g4 = ctx.createGain(); g4.gain.value = 0.55; this.sub.connect(g4).connect(this.filt);
    // slow vibrato on the harmonics (±0.6 %) so the hum does not sound like a test tone
    this.lfo = ctx.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = 4.5;
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = 0.4;
    this.lfo.connect(this.lfoGain); this.lfoGain.connect(this.osc1.detune); this.lfoGain.connect(this.osc2.detune);
    const ns = ctx.createBufferSource(); ns.buffer = noise; ns.loop = true;
    this.noiseFilt = ctx.createBiquadFilter(); this.noiseFilt.type = 'bandpass'; this.noiseFilt.frequency.value = 180; this.noiseFilt.Q.value = 0.5;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0.25;
    ns.connect(this.noiseFilt).connect(this.noiseGain).connect(this.filt);
    this.osc1.start(); this.osc2.start(); this.osc3.start(); this.sub.start(); this.lfo.start(); ns.start();
  }

  connect(dest: AudioNode) { this.out.connect(dest); }

  update(rpm: number, throttle: number, dt: number) {
    this.smoothed += (rpm - this.smoothed) * Math.min(1, dt * 4);
    const t = this.ctx.currentTime;
    const f0 = this.smoothed / 60 * 2;             // 22 Hz idle → 90 Hz redline
    this.osc1.frequency.setTargetAtTime(f0 * 2, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f0 * 3.0, t, 0.05);
    this.osc3.frequency.setTargetAtTime(f0 * 4.0, t, 0.05);
    this.sub.frequency.setTargetAtTime(Math.max(24, f0), t, 0.05);
    this.lfoGain.gain.setTargetAtTime(6 + throttle * 6, t, 0.2);
    this.filt.frequency.setTargetAtTime(260 + this.smoothed * 0.12 + throttle * 260, t, 0.12);
    this.filt2.frequency.setTargetAtTime(700 + this.smoothed * 0.25 + throttle * 500, t, 0.12);
    this.noiseFilt.frequency.setTargetAtTime(150 + this.smoothed * 0.1, t, 0.15);
    this.noiseGain.gain.setTargetAtTime(0.18 + throttle * 0.3, t, 0.12);
    const load = 0.35 + throttle * 0.65;
    this.out.gain.setTargetAtTime(AUDIO.engineGain * (0.55 + 0.45 * load) * (0.75 + 0.25 * this.smoothed / PHYSICS.redlineRpm), t, 0.1);
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
  // ambience layers (all synthesised): crowd murmur, rail-crossing bell, passing train, police siren, river water
  private crowdGain!: GainNode; private crowdLfo!: GainNode; private trainGain!: GainNode; private trainHornGain!: GainNode; private sirenGain!: GainNode; private sirenOsc!: OscillatorNode; private waterGain!: GainNode;
  private bellGain!: GainNode; private bellNext = 0;
  readonly levels = { crowd: 0, bell: 0, train: 0, siren: 0, water: 0 };
  private sirenT = 0;
  private hornOn = false;
  private hornKind: 'stock' | 'air' = 'stock';
  /** garage horn upgrade: deeper, louder three-tone air horn */
  setHorn(kind: 'stock' | 'air') { this.hornKind = kind; const f = kind === 'air' ? [262, 330, 131] : [311, 370, 155]; this.hornOsc.forEach((o, i) => { if (this.ctx) o.frequency.setTargetAtTime(f[i], this.ctx.currentTime, 0.01); }); }
  private muted = false;

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = AUDIO.masterGain;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.radioBus = ctx.createGain(); this.radioBus.gain.value = AUDIO.radioGain; this.radioBus.connect(this.master);
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
    this.setHorn(this.hornKind);

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

    // Crowd murmur: band-passed noise, amplitude wobbled by a slow LFO so it breathes like a bus stand
    const cs = ctx.createBufferSource(); cs.buffer = wbuf; cs.loop = true;
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 700; cf.Q.value = 0.7;
    const cf2 = ctx.createBiquadFilter(); cf2.type = 'lowpass'; cf2.frequency.value = 1600;
    this.crowdLfo = ctx.createGain(); this.crowdLfo.gain.value = 0.7;
    const clfo = ctx.createOscillator(); clfo.type = 'sine'; clfo.frequency.value = 0.37; const clg = ctx.createGain(); clg.gain.value = 0.3; clfo.connect(clg).connect(this.crowdLfo.gain); clfo.start();
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    cs.connect(cf).connect(cf2).connect(this.crowdLfo).connect(this.crowdGain).connect(this.master); cs.start();

    // Rail bell: a bright sine struck on a timer while the gates are down (see update)
    this.bellGain = ctx.createGain(); this.bellGain.gain.value = 0; this.bellGain.connect(this.master);

    // Train: deep rumble + two-tone horn, both faded by distance
    const ts = ctx.createBufferSource(); ts.buffer = noise; ts.loop = true;
    const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 140;
    this.trainGain = ctx.createGain(); this.trainGain.gain.value = 0;
    ts.connect(tf).connect(this.trainGain).connect(this.master); ts.start();
    this.trainHornGain = ctx.createGain(); this.trainHornGain.gain.value = 0;
    const thf = ctx.createBiquadFilter(); thf.type = 'lowpass'; thf.frequency.value = 1200;
    this.trainHornGain.connect(thf).connect(this.master);
    for (const f of [311, 415]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.25; o.connect(g).connect(this.trainHornGain); o.start(); }

    // Police siren: a square-ish tone whose pitch sweeps up and down (see update)
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle'; this.sirenOsc.frequency.value = 700;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2200;
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(sf).connect(this.sirenGain).connect(this.master); this.sirenOsc.start();

    // River water: soft low-passed noise for the ferry crossing and the big bridges
    const wsrc = ctx.createBufferSource(); wsrc.buffer = wbuf; wsrc.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 900;
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0;
    wsrc.connect(wf).connect(this.waterGain).connect(this.master); wsrc.start();
  }

  /** Set the ambience mix (0..1 each); gains glide so layers fade in and out. */
  setAmbience(a: Partial<typeof this.levels>) {
    Object.assign(this.levels, a);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(AUDIO.crowdGain * this.levels.crowd, t, 0.5);
    this.trainGain.gain.setTargetAtTime(AUDIO.trainGain * this.levels.train, t, 0.3);
    this.trainHornGain.gain.setTargetAtTime(AUDIO.trainGain * 0.5 * this.levels.train * this.levels.train, t, 0.3);
    this.sirenGain.gain.setTargetAtTime(AUDIO.sirenGain * this.levels.siren, t, 0.3);
    this.waterGain.gain.setTargetAtTime(AUDIO.waterGain * this.levels.water, t, 0.8);
  }

  get ready(): boolean { return !!this.ctx; }
  /** a bus into the master mix for the radio (created on init) */
  get context() { return this.ctx; }
  radioBus!: GainNode;
  get ctxState() { return this.ctx?.state ?? 'none'; }

  update(dt: number, rpm: number, throttle: number, kmh: number, horn: boolean, onRoad: boolean, rain: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.update(rpm, throttle, dt);
    if (horn !== this.hornOn) {
      this.hornOn = horn;
      this.hornGain.gain.cancelScheduledValues(t);
      this.hornGain.gain.setTargetAtTime(horn ? AUDIO.hornGain * (this.hornKind === 'air' ? 1.5 : 1) : 0, t, horn ? 0.03 : 0.08);
    }
    const sp = Math.min(1, kmh / 120);
    this.roadGain.gain.setTargetAtTime(AUDIO.roadGain * sp * (onRoad ? 1 : 2.2) * (0.3 + rain * 0.7 + 0.5), t, 0.1);
    this.windGain.gain.setTargetAtTime(AUDIO.windGain * sp * sp, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + sp * 1400, t, 0.1);
    this.rainGain.gain.setTargetAtTime(AUDIO.rainGain * rain, t, 0.3);
    // rail bell: strike every 0.6 s while the gate layer is up
    if (this.levels.bell > 0.01 && t >= this.bellNext) {
      this.bellNext = t + 0.6;
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1180;
      const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 1180 * 2.76;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(AUDIO.bellGain * this.levels.bell, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      const g2 = this.ctx.createGain(); g2.gain.value = 0.3;
      o.connect(g); o2.connect(g2).connect(g); g.connect(this.master); o.start(t); o2.start(t); o.stop(t + 0.55); o2.stop(t + 0.55);
    }
    // siren: pitch sweeps 600 → 1000 Hz and back about once a second
    if (this.levels.siren > 0.01) { this.sirenT += dt; const k = 0.5 - 0.5 * Math.cos(this.sirenT * Math.PI * 1.6); this.sirenOsc.frequency.setTargetAtTime(620 + 380 * k, t, 0.02); }
  }

  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); if (this.master && !this.muted) this.master.gain.value = AUDIO.masterGain * this.volume; }
  private volume = 1;
  /** Short synthesised stings for the intro. */
  sting(kind: 'start' | 'horn' | 'crash' | 'thunder' | 'cash' | 'fail' | 'badge' | 'levelup' | 'ding') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'cash' || kind === 'fail' || kind === 'badge' || kind === 'levelup' || kind === 'ding') { this.playNotes(kind, t); return; }
    if (kind === 'thunder') {
      // low rumble: filtered noise swelling in, plus a sub-bass sine that decays over ~2.5 s
      const src = this.ctx.createBufferSource(); src.buffer = noiseBuffer(this.ctx, 3); src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(90, t + 2.4);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.12); g.gain.exponentialRampToValueAtTime(0.25, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 3);
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(48, t); o.frequency.exponentialRampToValueAtTime(28, t + 2);
      const og = this.ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.45, t + 0.1); og.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(og).connect(this.master); o.start(t); o.stop(t + 2.3);
      return;
    }
    if (kind === 'crash') {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.35);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 0.45);
      return;
    }
    if (kind === 'horn') { this.hornGain.gain.cancelScheduledValues(t); this.hornGain.gain.setValueAtTime(AUDIO.hornGain, t); this.hornGain.gain.setTargetAtTime(0, t + 0.6, 0.1); return; }
    // engine start: crank then rev
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(18, t); o.frequency.linearRampToValueAtTime(70, t + 1.2); o.frequency.exponentialRampToValueAtTime(140, t + 2.2);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 2.7);
  }
  /** Little melodic stings: cash (two quick high notes), fail (two falling notes), badge (rising triad), levelup (fanfare), ding (one soft chime). */
  private playNotes(kind: 'cash' | 'fail' | 'badge' | 'levelup' | 'ding', t: number) {
    if (!this.ctx) return;
    const seq: [number, number, number][] = kind === 'cash' ? [[1318, 0, 0.12], [1760, 0.1, 0.25]]
      : kind === 'fail' ? [[440, 0, 0.22], [311, 0.2, 0.4]]
      : kind === 'badge' ? [[523, 0, 0.18], [659, 0.14, 0.18], [784, 0.28, 0.4]]
      : kind === 'levelup' ? [[523, 0, 0.15], [659, 0.12, 0.15], [784, 0.24, 0.15], [1047, 0.36, 0.6]]
      : [[988, 0, 0.5]];
    const type: OscillatorType = kind === 'fail' ? 'sawtooth' : 'triangle';
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'fail' ? 900 : 3200; f.connect(this.master);
    for (const [hz, at, len] of seq) {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = hz;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(AUDIO.stingGain, t + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      o.connect(g).connect(f); o.start(t + at); o.stop(t + at + len + 0.05);
    }
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : AUDIO.masterGain * this.volume;
  }
  get isMuted() { return this.muted; }
}
