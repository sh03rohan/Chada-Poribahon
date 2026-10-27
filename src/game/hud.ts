import { bn, bnTime, bnKm, bnTaka } from '../util/bangla.ts';
import { GAMEPLAY } from '../config.ts';
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
  private money = $('hud-money-val');
  private banner = $('hud-banner'); private bannerTitle = $('hud-banner-title'); private bannerSub = $('hud-banner-sub');
  private hint = $('hud-hint-text');
  private msg = $('hud-msg');
  private bubbles = $('bubbles');
  private msgTimer: number | null = null;
  private lastSpeed = -1;
  private lastGear = -1;

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  update(kmh: number, gear: number, mood: number, passengers: number, elapsed: number, remaining: number, stopped: boolean, income = 0) {
    const sp = Math.round(kmh);
    if (sp !== this.lastSpeed) { this.speedNum.textContent = bn(sp); this.lastSpeed = sp; }
    const g = stopped ? 0 : gear + 1;
    if (g !== this.lastGear) { this.gear.textContent = g === 0 ? 'N' : 'D' + bn(g); this.lastGear = g; }
    this.moodFill.style.width = `${mood}%`;
    this.pass.textContent = `${bn(passengers)} / ${bn(GAMEPLAY.seats)}`;
    this.money.textContent = bnTaka(income);
    this.time.textContent = bnTime(elapsed);
    this.dist.textContent = `বাকি ${bnKm(Math.max(0, remaining))}`;
  }

  /** Persistent banner under the top bar (e.g. "বাস স্টপ সামনে"); null hides it. */
  setBanner(title: string | null, sub = '', warn = false) {
    if (!title) { this.banner.classList.add('hidden'); return; }
    this.banner.classList.remove('hidden'); this.banner.classList.toggle('warn', warn);
    this.bannerTitle.textContent = title; this.bannerSub.textContent = sub;
  }
  setHint(text: string) { this.hint.textContent = text; }

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
