import { bnClock } from '../util/bangla.ts';
import { ROUTE } from '../routes.ts';
import { WORLD } from '../config.ts';
import type { WeatherKind } from '../world/weather.ts';

/**
 * Bus radio: three fictional stations, all synthesised in WebAudio — a folk-ish pentatonic tune,
 * a brighter pop loop, and a news station (drone + time signal) — with text "announcements"
 * (traffic, weather, adverts, news) shown on a HUD ticker every half minute or so.
 */
export interface StationDef { name: string; bpm: number; scale: number[]; root: number; wave: OscillatorType; music: boolean; }
export const STATIONS: StationDef[] = [
  { name: 'রেডিও পদ্মা ৮৯.৬', bpm: 96, scale: [0, 2, 4, 7, 9, 12, 14], root: 220, wave: 'triangle', music: true },      // pentatonic folk
  { name: 'ঢাকা FM ৯৯.২', bpm: 124, scale: [0, 2, 3, 5, 7, 8, 10, 12], root: 196, wave: 'square', music: true },        // minor pop
  { name: 'বাংলা বেতার (খবর)', bpm: 60, scale: [0], root: 110, wave: 'sine', music: false },
];

const ADS = ['📢 মধুমতি চা — এক কাপে সারাদিনের শক্তি!', '📢 হাসি সাবান: ঝকঝকে কাপড়, হাসিখুশি সংসার', '📢 সোনার বাংলা মোটরস — বাসের টায়ার, ব্যাটারি, সবই এক ছাদের নিচে', '📢 নয়ন সিনেমা হলে এই সপ্তাহে: “রাস্তার রাজা” — দুপুর ৩টা, সন্ধ্যা ৬টা', '📢 রূপসী বিস্কুট — চায়ের সাথে, সফরের সাথী'];
const NEWS = ['📰 সংবাদ: দেশের সব মহাসড়কে ঈদের আগে বাড়তি নজরদারি', '📰 সংবাদ: সেতুতে আজ রেকর্ড যানবাহন পারাপার', '📰 সংবাদ: বাস মালিক সমিতি ভাড়া অপরিবর্তিত রাখার ঘোষণা দিয়েছে', '📰 সংবাদ: হাইওয়ে পুলিশের বিশেষ অভিযান — কাগজপত্র সাথে রাখুন', '📰 খেলা: ঘরের মাঠে সিরিজ জয়, সারা দেশে উৎসব'];
const WEATHER: Record<WeatherKind, string> = {
  clear: '☀️ আবহাওয়া: আজ রোদ, তাপমাত্রা ৩১°, বিকেলে হালকা বাতাস',
  rain: '🌧️ আবহাওয়া: বৃষ্টি চলবে সন্ধ্যা পর্যন্ত — রাস্তা পিচ্ছিল, ধীরে চালান',
  fog: '🌫️ আবহাওয়া: ঘন কুয়াশা, দৃষ্টিসীমা ২০০ মিটার — হেডলাইট জ্বালিয়ে চালান',
  storm: '⛈️ সতর্কতা: ঝড় ও বজ্রপাত, নদীপথে ফেরি বন্ধ হতে পারে',
};

export class Radio {
  on = false; station = 0; ticks = 0; notes = 0;
  private ctx: AudioContext | null = null; private out: GainNode | null = null;
  private nextNote = 0; private step = 0; private melody = 0; private tickIn = 6; private duckT = 0;
  private el: HTMLElement; private hideT = 0;
  constructor(el: HTMLElement) { this.el = el; }
  attach(ctx: AudioContext, bus: GainNode) { this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(bus); this.applyGain(); }
  private applyGain() { if (!this.ctx || !this.out) return; this.out.gain.setTargetAtTime(this.on ? (this.duckT > 0 ? 0.3 : 1) : 0, this.ctx.currentTime, 0.15); }
  /** cycle: off → station 0 → 1 → 2 → off; returns the new state's label */
  cycle(): string { if (!this.on) { this.on = true; this.station = 0; } else if (this.station < STATIONS.length - 1) this.station++; else this.on = false; return this.switched(); }
  set(stationIndex: number | null): string { if (stationIndex === null || stationIndex < 0) this.on = false; else { this.on = true; this.station = Math.min(STATIONS.length - 1, stationIndex); } return this.switched(); }
  private switched(): string {
    this.step = 0; this.nextNote = this.ctx?.currentTime ?? 0; this.tickIn = 4; this.applyGain();
    const label = this.on ? `📻 আপনি শুনছেন ${STATIONS[this.station].name}` : '📻 রেডিও বন্ধ';
    this.show(label, 3000);
    return label;
  }
  /** duck under the horn / a crash sting for a moment */
  duck(seconds = 1.5) { this.duckT = Math.max(this.duckT, seconds); this.applyGain(); }
  private show(text: string, ms: number) { this.el.textContent = text; this.el.classList.remove('hidden'); this.hideT = ms / 1000; }

  update(dt: number, ctxInfo: { weather: WeatherKind; hour: number; routeS: number }) {
    if (this.hideT > 0) { this.hideT -= dt; if (this.hideT <= 0) this.el.classList.add('hidden'); }
    if (this.duckT > 0) { this.duckT -= dt; if (this.duckT <= 0) this.applyGain(); }
    if (!this.on || !this.ctx || !this.out) return;
    // announcements
    this.tickIn -= dt;
    if (this.tickIn <= 0) { this.tickIn = 24 + Math.random() * 16; this.ticks++; this.show(this.announcement(ctxInfo), 7000); }
    // music: schedule steps ~0.4 s ahead of the clock
    const st = STATIONS[this.station];
    const stepLen = 60 / st.bpm / 2; // eighth notes
    const t = this.ctx.currentTime;
    while (this.nextNote < t + 0.4) {
      if (this.nextNote >= t - 0.05) this.scheduleStep(st, this.nextNote, stepLen);
      this.nextNote += stepLen; this.step++;
    }
  }
  private scheduleStep(st: StationDef, at: number, len: number) {
    const ctx = this.ctx!, out = this.out!;
    const s = this.step % 16;
    if (!st.music) {
      // news: soft drone with a pip every bar and a three-pip time signal every 16 bars
      if (s === 0) { this.tone(ctx, out, st.root, at, len * 8, 'sine', 0.08); if ((this.step / 16) % 16 === 0) for (let i = 0; i < 3; i++) this.tone(ctx, out, 880, at + i * 0.25, 0.1, 'sine', 0.18); }
      return;
    }
    // percussion: kick on 1 and 3 (steps 0, 8), hat on every even step
    if (s === 0 || s === 8) this.kick(ctx, out, at);
    if (s % 2 === 0) this.hat(ctx, out, at + (s % 4 === 2 ? 0.01 : 0));
    // bass: root on 1, fifth on 3
    if (s === 0 || s === 8) this.tone(ctx, out, st.root / 2 * (s === 8 ? 1.5 : 1), at, len * 3.5, 'sine', 0.22);
    // melody: a random walk over the scale, mostly on-beat, rests sometimes
    if (s % 2 === 0 && Math.random() < 0.8) {
      this.melody += Math.round((Math.random() - 0.5) * 3); this.melody = Math.max(0, Math.min(st.scale.length - 1, this.melody));
      const semis = st.scale[this.melody] + (Math.random() < 0.15 ? 12 : 0);
      this.tone(ctx, out, st.root * Math.pow(2, semis / 12), at, len * (Math.random() < 0.3 ? 3.6 : 1.7), st.wave, 0.16, true);
      this.notes++;
    }
  }
  private tone(ctx: AudioContext, out: AudioNode, hz: number, at: number, len: number, wave: OscillatorType, gain: number, vibrato = false) {
    const o = ctx.createOscillator(); o.type = wave; o.frequency.value = hz;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = wave === 'square' ? 1800 : 3200;
    if (vibrato) { const l = ctx.createOscillator(); l.frequency.value = 5.5; const lg = ctx.createGain(); lg.gain.value = 4; l.connect(lg).connect(o.detune); l.start(at); l.stop(at + len + 0.05); }
    o.connect(f).connect(g).connect(out); o.start(at); o.stop(at + len + 0.05);
  }
  private kick(ctx: AudioContext, out: AudioNode, at: number) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.12); const g = ctx.createGain(); g.gain.setValueAtTime(0.35, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18); o.connect(g).connect(out); o.start(at); o.stop(at + 0.2); }
  private hat(ctx: AudioContext, out: AudioNode, at: number) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000; const g = ctx.createGain(); g.gain.value = 0.08;
    s.connect(f).connect(g).connect(out); s.start(at);
  }
  private announcement(info: { weather: WeatherKind; hour: number; routeS: number }): string {
    const st = STATIONS[this.station];
    const nextStop = WORLD.stops.find((x) => x.s > info.routeS);
    const traffic = [`🚦 ট্রাফিক আপডেট: ${nextStop?.name ?? ROUTE.to} মোড়ে ধীর গতি — ধৈর্য ধরুন`, `🚦 ${ROUTE.names.bridge}-এর টোল প্লাজায় লাইন লম্বা, সময় হাতে নিয়ে বেরোন`, '🚦 হাইওয়ে পুলিশ বলছে: গতি সীমা মানুন, ওভারটেক সাবধানে', `🚦 ${ROUTE.to}মুখী লেনে আজ যানবাহনের চাপ বেশি`];
    const pools = st.music ? [traffic, [WEATHER[info.weather]], ADS, ADS] : [NEWS, NEWS, [WEATHER[info.weather]], traffic, [`🕒 ${st.name} — এখন সময় ${bnClock(info.hour)}`]];
    const pool = pools[Math.floor(Math.random() * pools.length)];
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
