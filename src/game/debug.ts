import { PHYSICS } from '../config.ts';

/** Debug overlay (F3 / ` / ?debug=1): fps, frame spikes, measured 0–60 and top speed. */
export class DebugOverlay {
  private el = document.getElementById('debug')!;
  visible = false;
  fps = 0; private frames = 0; private acc = 0;
  worstFrame = 0; spikes = 0; frameCount = 0; avgFrame = 0; private avgAcc = 0; private avgN = 0;
  /** Measured performance */
  zeroToSixty: number | null = null; private launchT: number | null = null;
  topSpeed = 0;
  private lines: string[] = [];

  constructor() {
    if (new URLSearchParams(location.search).get('debug') === '1') this.visible = true;
    this.el.classList.toggle('hidden', !this.visible);
  }

  toggle() { this.visible = !this.visible; this.el.classList.toggle('hidden', !this.visible); }

  /** Feed each physics step so the measurement is frame-rate independent. */
  physicsSample(kmh: number, throttle: number, t: number) {
    if (kmh < 0.5 && throttle > 0.5 && this.launchT === null) this.launchT = t;
    if (kmh < 0.5 && throttle < 0.1) this.launchT = null;
    if (this.launchT !== null && kmh >= 60 && this.zeroToSixty === null) this.zeroToSixty = t - this.launchT;
    if (kmh > this.topSpeed) this.topSpeed = kmh;
  }

  resetMeasure() { this.zeroToSixty = null; this.launchT = null; this.topSpeed = 0; this.spikes = 0; this.worstFrame = 0; this.avgAcc = 0; this.avgN = 0; }

  frame(dt: number, extra: Record<string, string | number>) {
    this.frames++; this.acc += dt; this.frameCount++; this.avgAcc += dt; this.avgN++; this.avgFrame = this.avgAcc / this.avgN; if (this.avgN >= 120) { this.avgAcc = 0; this.avgN = 0; }
    if (dt > 0.05) this.spikes++;
    if (dt > this.worstFrame) this.worstFrame = dt;
    if (this.acc >= 0.5) { this.fps = this.frames / this.acc; this.frames = 0; this.acc = 0; }
    if (!this.visible) return;
    this.lines.length = 0;
    this.lines.push(`fps ${this.fps.toFixed(0)}  worst ${(this.worstFrame * 1000).toFixed(0)}ms  spikes(>50ms) ${this.spikes}`);
    this.lines.push(`0-60: ${this.zeroToSixty === null ? '—' : this.zeroToSixty.toFixed(2) + 's'} (target ${PHYSICS.target0to60s}s)   top: ${this.topSpeed.toFixed(1)} km/h (target ${PHYSICS.targetTopSpeedKmh})`);
    for (const [k, v] of Object.entries(extra)) this.lines.push(`${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`);
    this.el.textContent = this.lines.join('\n');
  }
}
