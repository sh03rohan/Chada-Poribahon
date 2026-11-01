import { bn } from '../util/bangla.ts';

/**
 * Driver fatigue (ক্লান্তি), 0–100. It climbs while driving — faster at night and in a storm —
 * and only a chai break brings it down. Past 60 the steering goes lazy and the edges of the view
 * darken; past 85 the passengers notice; at 100 the driver nods off for a second every so often
 * (steering drops to zero, the view blinks shut) until a break is taken.
 */
export const CHAI_BREAK_SECONDS = 180;
export const CHAI_BREAK_COST = 30;        // ৳ tea + biscuits for the crew
export const CHAI_BREAK_RELIEF = 65;      // fatigue points removed

export interface FatigueView { veil: HTMLElement; bar: HTMLElement; fill: HTMLElement; btn: HTMLButtonElement }

export class Fatigue {
  value = 0;
  breaks = 0; microsleeps = 0;
  /** seconds left of the current micro-sleep (0 = awake) */
  asleep = 0;
  private sinceSleep = 0; private warned = { tired: false, sleepy: false };
  private drift = 0; private steerF = 0;
  constructor(private view: FatigueView) {}

  /** 0..1 how much the steering lags / drifts */
  get lazy() { return Math.max(0, Math.min(1, (this.value - 60) / 40)); }

  update(dt: number, kmh: number, night: boolean, storm: boolean, driving: boolean): { shout?: 'sleepy'; msg?: string } {
    const out: { shout?: 'sleepy'; msg?: string } = {};
    if (!driving) return out;
    if (this.asleep > 0) { this.asleep -= dt; if (this.asleep <= 0) { this.asleep = 0; this.view.veil.classList.remove('blink'); } }
    const rate = kmh > 3 ? (100 / 480) * (night ? 1.6 : 1) * (storm ? 1.25 : 1) : 0;   // a full 8 minutes of day driving = 100
    this.value = Math.min(100, this.value + rate * dt);
    if (this.value >= 60 && !this.warned.tired) { this.warned.tired = true; out.msg = '🥱 চোখ ভারী হয়ে আসছে — থেমে একটু চা খেয়ে নিন'; }
    if (this.value >= 85 && !this.warned.sleepy) { this.warned.sleepy = true; out.shout = 'sleepy'; out.msg = '😴 ড্রাইভার ঝিমাচ্ছে! চা-বিরতি নিন, নইলে ঘুমিয়ে পড়বেন'; }
    if (this.value >= 100 && this.asleep === 0) {
      this.sinceSleep += dt;
      if (this.sinceSleep > 10 && kmh > 5) { this.sinceSleep = 0; this.asleep = 1.3; this.microsleeps++; this.view.veil.classList.add('blink'); out.shout = 'sleepy'; out.msg = '😴 এক মুহূর্ত ঘুমিয়ে পড়েছিলেন!'; }
    }
    this.draw(kmh);
    return out;
  }

  /** filter the steering input through tiredness: lag plus a slow wander; zero while asleep */
  steer(raw: number, dt: number, t: number): number {
    if (this.asleep > 0) return 0;
    const k = this.lazy; if (k <= 0) { this.steerF = raw; return raw; }
    this.steerF += (raw - this.steerF) * Math.min(1, dt * (12 - 9.5 * k));
    this.drift = Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1.3) * 0.16 * k;
    return Math.max(-1, Math.min(1, this.steerF + this.drift));
  }

  /** chai break taken (the caller charges the ledger and advances the clock) */
  rest() { this.value = Math.max(0, this.value - CHAI_BREAK_RELIEF); this.breaks++; this.asleep = 0; this.sinceSleep = 0; this.warned = { tired: false, sleepy: false }; this.view.veil.classList.remove('blink'); this.draw(0); }

  reset() { this.value = 0; this.breaks = 0; this.microsleeps = 0; this.asleep = 0; this.sinceSleep = 0; this.warned = { tired: false, sleepy: false }; this.steerF = 0; this.drift = 0; this.view.veil.classList.remove('blink'); this.draw(0); }

  /** the break button shows whenever the bus is standing still and the driver is at least a little tired */
  showButton(stopped: boolean) { this.view.btn.classList.toggle('hidden', !(stopped && this.value >= 20)); }

  private draw(_kmh: number) {
    const v = this.value;
    this.view.bar.classList.toggle('hidden', v < 15);
    this.view.fill.style.width = `${Math.round(v)}%`; this.view.fill.classList.toggle('high', v >= 60); this.view.fill.classList.toggle('max', v >= 85);
    this.view.bar.title = `ক্লান্তি ${bn(Math.round(v))}%`;
    this.view.veil.style.opacity = String(Math.max(0, (v - 55) / 45) * 0.6);
  }
}
