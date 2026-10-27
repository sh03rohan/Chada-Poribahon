import { bn, bnTime, bnKm } from '../util/bangla.ts';
import type { PassengerEvent } from './passengers.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private root = $('hud');
  private speedNum = $('hud-speed-num');
  private gear = $('hud-gear');
  private moodFill = $('hud-mood-fill');
  private pass = $('hud-pass');
  private time = $('hud-time');
  private dist = $('hud-dist');
  private msg = $('hud-msg');
  private bubbles = $('bubbles');
  private msgTimer: number | null = null;
  private lastSpeed = -1;
  private lastGear = -1;

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  update(kmh: number, gear: number, mood: number, passengers: number, elapsed: number, remaining: number, stopped: boolean) {
    const sp = Math.round(kmh);
    if (sp !== this.lastSpeed) { this.speedNum.textContent = bn(sp); this.lastSpeed = sp; }
    const g = stopped ? 0 : gear + 1;
    if (g !== this.lastGear) { this.gear.textContent = g === 0 ? 'N' : 'D' + bn(g); this.lastGear = g; }
    this.moodFill.style.width = `${mood}%`;
    this.pass.textContent = `যাত্রী: ${bn(passengers)}`;
    this.time.textContent = bnTime(elapsed);
    this.dist.textContent = `বাকি ${bnKm(Math.max(0, remaining))}`;
  }

  message(text: string, good = false, ms = 3000) {
    this.msg.textContent = text;
    this.msg.classList.toggle('good', good);
    this.msg.classList.add('show');
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => this.msg.classList.remove('show'), ms);
  }

  bubble(ev: PassengerEvent) {
    const b = document.createElement('div');
    b.className = 'bubble'; b.textContent = ev.text;
    this.bubbles.appendChild(b);
    while (this.bubbles.children.length > 2) this.bubbles.firstChild?.remove();
    setTimeout(() => b.remove(), 3700);
  }
}
