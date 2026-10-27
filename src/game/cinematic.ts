import * as THREE from 'three';
import { WORLD } from '../config.ts';
import { Person, VARIANTS, HAWKER_VARIANT, CHADA_VARIANT, POLICE_VARIANTS, makeVariant, type Action } from '../world/people.ts';

/**
 * Keyframe/timeline cinematic system + the ~30 s intro story built from game assets.
 *
 * Timeline format: an ordered array of Shots. Each shot has `at` (seconds), `dur`, an optional
 * `caption`, `enter()` (stage actors / teleport the bus), `update(k)` (k = 0..1 progress; moves the
 * camera via host.setCamera) and `exit()`. The player can skip at any moment (button, Esc, Space,
 * tap). With prefers-reduced-motion every shot is shortened and camera moves become cuts.
 */
export interface CineHost {
  scene: THREE.Scene;
  busBody: THREE.Object3D; busRoot: THREE.Object3D;
  setCamera(pos: THREE.Vector3, look: THREE.Vector3, fov?: number): void;
  teleport(s: number): void;
  drive(throttle: number, brake: number, autopilot: boolean): void;
  setHour(h: number): void;
  people: { add(p: Person): void; remove(p: Person): void };
  driver: Person | null; helper: Person | null;
  blockade: { phase: string; forcePolice(): void; forceDisperse(): void; group: THREE.Object3D };
  setDriverHandTarget(side: 'L' | 'R', worldPoint: THREE.Vector3 | null): void;
  audioSting(kind: 'start' | 'horn'): void;
  roadSample(s: number): { x: number; z: number; tx: number; tz: number; rx: number; rz: number };
  isLowTier: boolean;
  setPassengerPose(action: Action): void;
}

export interface Shot { at: number; dur: number; caption?: string; title?: string; enter?: () => void; update?: (k: number, t: number) => void; exit?: () => void; }

const ease = (k: number) => k * k * (3 - 2 * k);
const _p = new THREE.Vector3(), _l = new THREE.Vector3();

export class Cinematic {
  private shots: Shot[] = [];
  private t = 0; private idx = -1; private running = false;
  private resolve: ((r: 'done' | 'skipped') => void) | null = null;
  private actors: Person[] = [];
  private props: THREE.Object3D[] = [];
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private slides = false;
  private el = { root: document.getElementById('cinematic')!, cap: document.getElementById('cine-caption')!, title: document.getElementById('cine-title')!, skip: document.getElementById('cine-skip')! as HTMLButtonElement, slides: document.getElementById('cine-slides')! };
  private onKey = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'Space') { e.preventDefault(); this.skip(); } };
  private slideCanvas: HTMLCanvasElement | null = null;
  readonly duration: number;
  /** test hook: run the timeline faster than real time */
  timeScale = 1;

  constructor(private host: CineHost) {
    this.shots = this.buildIntro();
    this.duration = this.shots[this.shots.length - 1].at + this.shots[this.shots.length - 1].dur;
    this.el.skip.onclick = () => this.skip();
    this.el.root.addEventListener('pointerdown', (e) => { if (e.target !== this.el.skip) this.skip(); });
  }

  get active() { return this.running; }
  get time() { return this.t; }

  /** Lerp the camera between two bus-local or world poses. */
  private cam(k: number, from: [number, number, number], to: [number, number, number], lookFrom: [number, number, number], lookTo: [number, number, number], local = true, fov = 55) {
    const e = this.reduced ? (k < 0.5 ? 0 : 1) : ease(k);
    _p.set(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e);
    _l.set(lookFrom[0] + (lookTo[0] - lookFrom[0]) * e, lookFrom[1] + (lookTo[1] - lookFrom[1]) * e, lookFrom[2] + (lookTo[2] - lookFrom[2]) * e);
    if (local) { this.host.busBody.updateMatrixWorld(true); _p.applyMatrix4(this.host.busBody.matrixWorld); _l.applyMatrix4(this.host.busBody.matrixWorld); }
    this.host.setCamera(_p, _l, fov);
  }

  private actor(v = VARIANTS[0], action: Action = 'idle', s = 50, lateral = -6, faceRoad = true): Person {
    const p = new Person(v);
    const f = this.host.roadSample(s);
    p.position.set(f.x + f.rx * lateral, 0, f.z + f.rz * lateral);
    if (faceRoad) p.lookAt(f.x, f.z);
    p.setAction(action); p.mesh.frustumCulled = false;
    this.host.scene.add(p.root); this.host.people.add(p); this.actors.push(p);
    return p;
  }
  private clearActors() {
    for (const a of this.actors) { this.host.scene.remove(a.root); this.host.people.remove(a); }
    this.actors = [];
    for (const o of this.props) o.parent?.remove(o);
    this.props = [];
  }

  private buildIntro(): Shot[] {
    const H = this.host;
    const STAND = 48; // Kushtia bus stand s
    const shots: Shot[] = [
      // 0–3 title card: sunrise, bus silhouette, engine start sting
      { at: 0, dur: 3, title: 'চাঁদা পরিবহন', caption: 'কুষ্টিয়া থেকে ঢাকা, একটাই রাস্তা।',
        enter: () => { H.setHour(6.05); H.teleport(STAND); H.drive(0, 1, false); H.audioSting('start'); },
        update: (k) => this.cam(k, [-16, 1.2, 14], [-13, 1.6, 9], [0, 1.8, 0], [0, 2.0, -1], true, 50) },
      // 3–8 bus stand: helper shouting, passengers boarding with bags, hawker at the window, conductor counting notes
      { at: 3, dur: 5, caption: '“ঢাকা ঢাকা! সিট আছে, উঠেন!” — হেল্পার হাঁকছে',
        enter: () => {
          H.setHour(6.4);
          const f = H.roadSample(STAND - 4.0); const doorX = f.x + f.rx * -(1.75 + 1.6), doorZ = f.z + f.rz * -(1.75 + 1.6);
          const bag = makeVariant({ id: 'cine-bag', outfit: 'shirt-pants', top: '#1f6fb5', bottom: '#2a2a2a', prop: 'bag', accent: '#6a3a1a' });
          const a1 = this.actor(bag, 'walk', STAND - 12, -9); a1.walkTo(new THREE.Vector3(doorX - f.rx * 1.2, 0, doorZ - f.rz * 1.2), 'queue');
          const a2 = this.actor(VARIANTS[3], 'walk', STAND - 15, -10); a2.walkSpeed = 0.9; a2.walkTo(new THREE.Vector3(doorX - f.rx * 2.6, 0, doorZ - f.rz * 2.6), 'queue');
          const a3 = this.actor(VARIANTS[6], 'walk', STAND - 9, -11); a3.walkTo(new THREE.Vector3(doorX - f.rx * 4, 0, doorZ - f.rz * 4), 'talk');
          this.actor(HAWKER_VARIANT, 'hawk', STAND + 1.5, -(1.75 + 1.9));
          const cond = this.actor(makeVariant({ id: 'cine-cond', outfit: 'helper', top: '#d8c070', bottom: '#333', accent: '#1f9d55', prop: 'notes' }), 'count', STAND - 7, -(1.75 + 1.9));
          cond.lookAt(doorX, doorZ);
          H.helper?.setAction('hang');
        },
        update: (k, t) => { if (t < 2.6) this.cam(k / 0.52, [-9, 1.9, 2], [-6.5, 1.7, -1.5], [-1.2, 1.6, -4], [-1.3, 1.5, -4.2]); else this.cam((k - 0.52) / 0.48, [-5, 2.4, -10], [-4, 2.2, -7], [-1.2, 2.2, -4.5], [-1.3, 2.0, -3.6]); },
        exit: () => this.clearActors() },
      // 8–13 on the road: interior + driver's hands + speed
      { at: 8, dur: 5, caption: 'রাস্তায় গল্প, গান, ভিডিও — আর ড্রাইভারের হাতে স্টিয়ারিং',
        enter: () => { H.setHour(8.5); H.teleport(330); H.drive(1, 0, true); H.setPassengerPose('talk'); },
        update: (k, t) => {
          if (t < 1.8) this.cam(k / 0.36, [0.1, 2.3, -3.2], [0.1, 2.25, -3.0], [-0.3, 1.9, 2.5], [0.4, 1.9, 2.5], true, 62);
          else if (t < 3.4) this.cam((k - 0.36) / 0.32, [0.3, 2.35, -3.4], [0.5, 2.25, -3.6], [0.85, 1.75, -4.5], [0.85, 1.7, -4.5], true, 58);
          else { const f = H.roadSample(330 + 95); const s = (k - 0.68) / 0.32; this.cam(s, [f.x + f.rx * -7, 1.2, f.z + f.rz * -7], [f.x + f.rx * -7, 1.3, f.z + f.rz * -7], [f.x - f.tx * 20, 2, f.z - f.tz * 20], [f.x + f.tx * 30, 2, f.z + f.tz * 30], false, 70); }
        } },
      // 13–18 chada: man at the roadside waves the bus down, driver hands over cash
      { at: 13, dur: 5, caption: '“প্রতিদিনই এক কাহিনী!” — পেছন থেকে এক যাত্রী',
        enter: () => {
          H.teleport(912); H.drive(0, 1, false); H.setHour(9.2);
          const man = this.actor(CHADA_VARIANT, 'wave', 924, 1.75 + 1.3);
          setTimeout(() => { man.setAction('handover'); }, 1500);
          const f = H.roadSample(924); const w = new THREE.Vector3(f.x + f.rx * 2.2, 2.0, f.z + f.rz * 2.2);
          setTimeout(() => H.setDriverHandTarget('L', w), 1200);
        },
        update: (k, t) => { if (t < 2.2) this.cam(k / 0.44, [9, 2.4, -14], [6, 2.2, -8], [1.2, 2, -5], [1.3, 1.9, -5.2]); else this.cam((k - 0.44) / 0.56, [3.2, 2.1, -6.6], [2.6, 2.0, -5.8], [1.0, 2.0, -5.0], [1.0, 1.9, -4.8], true, 50); },
        exit: () => { H.setDriverHandTarget('L', null); this.clearActors(); } },
      // 18–24 andolon: road blocked, bus brakes; time-lapse
      { at: 18, dur: 6, caption: 'সামনে অবরোধ, টায়ার জ্বলছে — বাস থেমে গেল। ঘণ্টা যায়, রোদ ঘোরে…',
        enter: () => { H.teleport(WORLD.andolonS - 60); H.drive(0.6, 0, true); H.setHour(10); },
        update: (k, t) => {
          if (t > 1.6) H.drive(0, 1, true);
          if (t > 2.2) { H.setHour(10 + (t - 2.2) * 2.2); if (t > 3) H.setPassengerPose(t < 4.3 ? 'fan' : 'sleep'); }
          if (t < 2.4) { const f = H.roadSample(WORLD.andolonS - 12); this.cam(k / 0.4, [f.x + f.rx * 9, 3.5, f.z + f.rz * 9 - f.tz * 10], [f.x + f.rx * 7, 2.5, f.z + f.rz * 7], [f.x, 1.5, f.z], [f.x - f.tx * 8, 1.2, f.z - f.tz * 8], false, 55); }
          else this.cam((k - 0.4) / 0.6, [0.2, 2.3, -2.8], [-0.2, 2.3, -2.6], [0, 1.9, 3], [0.4, 1.8, 3], true, 60);
        } },
      // 24–28 police arrive, crowd walks away, fine slip
      { at: 24, dur: 4, caption: '“সবই কপাল।” — জরিমানা ৫০০ টাকা',
        enter: () => {
          H.blockade.forcePolice();
          setTimeout(() => H.blockade.forceDisperse(), 1400);
          const off = this.actor(makeVariant({ ...POLICE_VARIANTS[1], id: 'cine-officer', prop: 'slip' }), 'walk', WORLD.andolonS - 1, 1.75 + 3);
          const f = H.roadSample(WORLD.andolonS - 13); off.walkTo(new THREE.Vector3(f.x + f.rx * (1.75 + 1.9), 0, f.z + f.rz * (1.75 + 1.9)), 'handover');
          H.setPassengerPose('talk');
          setTimeout(() => this.stamp(), 2600);
        },
        update: (k, t) => { if (t < 1.8) this.cam(k / 0.45, [-6, 3, -22], [-3, 2.4, -14], [0, 1.5, -12], [1.5, 1.6, -8], true, 55); else this.cam((k - 0.45) / 0.55, [3.4, 2.2, -7.2], [2.8, 2.1, -6.0], [1.2, 1.9, -5.0], [1.0, 1.9, -4.9], true, 50); },
        exit: () => { this.clearActors(); this.unstamp(); } },
      // 28–30 driver's seat: your turn
      { at: 28, dur: 2, caption: 'এবার আপনার পালা!', title: 'এবার আপনার পালা!',
        enter: () => { H.setHour(11); H.drive(0, 1, false); },
        update: (k) => this.cam(k, [0.85, 2.18, -3.95], [0.85, 2.18, -3.95], [0.6, 1.0, -34], [0.55, 0.9, -34], true, 60 + k * 8) },
    ];
    if (this.reduced) for (const s of shots) { s.at *= 0.7; s.dur *= 0.7; }
    return shots;
  }

  private stamp() {
    const d = document.createElement('div'); d.id = 'cine-stamp'; d.textContent = 'জরিমানা ৫০০ টাকা';
    Object.assign(d.style, { position: 'absolute', left: '50%', top: '38%', transform: 'translate(-50%,-50%) rotate(-12deg)', color: '#d8262c', border: '6px solid #d8262c', padding: '8px 22px', fontSize: 'clamp(28px,6vw,64px)', fontWeight: '700', background: 'rgba(255,255,255,0.85)', borderRadius: '10px', letterSpacing: '2px' });
    this.el.root.appendChild(d);
  }
  private unstamp() { document.getElementById('cine-stamp')?.remove(); }

  /** Plays the intro; resolves 'done' or 'skipped'. Low tier → illustrated slides with the same captions. */
  play(forceSlides = false): Promise<'done' | 'skipped'> {
    this.t = 0; this.idx = -1; this.running = true;
    this.slides = forceSlides || this.host.isLowTier;
    this.el.root.classList.remove('hidden');
    this.el.title.classList.add('hidden');
    addEventListener('keydown', this.onKey);
    if (this.slides) this.startSlides();
    return new Promise((res) => { this.resolve = res; });
  }

  skip() { if (!this.running) return; this.finish('skipped'); }

  private finish(r: 'done' | 'skipped') {
    this.running = false;
    removeEventListener('keydown', this.onKey);
    const cur = this.shots[this.idx]; cur?.exit?.();
    this.clearActors(); this.unstamp();
    this.el.root.classList.add('hidden'); this.el.slides.classList.add('hidden'); this.el.slides.innerHTML = '';
    this.host.drive(0, 1, false);
    this.host.setPassengerPose('idle');
    this.resolve?.(r); this.resolve = null;
  }

  update(dt: number) {
    if (!this.running) return;
    this.t += dt * this.timeScale;
    if (this.slides) { this.updateSlides(); if (this.t >= this.duration) this.finish('done'); return; }
    // enter new shots
    let next = this.idx;
    while (next + 1 < this.shots.length && this.shots[next + 1].at <= this.t) next++;
    if (next !== this.idx) {
      if (this.idx >= 0) this.shots[this.idx].exit?.();
      this.idx = next;
      const sh = this.shots[this.idx];
      sh.enter?.();
      this.el.cap.textContent = sh.caption ?? ''; this.el.cap.style.opacity = sh.caption ? '1' : '0';
      this.el.title.textContent = sh.title ?? ''; this.el.title.classList.toggle('hidden', !sh.title);
    }
    const sh = this.shots[this.idx];
    if (sh) { const local = this.t - sh.at; sh.update?.(Math.min(1, local / sh.dur), local); if (sh.title && local > 1.6) this.el.title.classList.add('hidden'); }
    if (this.t >= this.duration) this.finish('done');
  }

  // ---- slide fallback ---------------------------------------------------
  private startSlides() {
    this.el.slides.classList.remove('hidden');
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    this.el.slides.appendChild(c); this.slideCanvas = c;
    this.el.cap.style.opacity = '1';
  }
  private updateSlides() {
    const c = this.slideCanvas!; const ctx = c.getContext('2d')!; const W = c.width, H = c.height;
    let i = 0; for (let k = 0; k < this.shots.length; k++) if (this.shots[k].at <= this.t) i = k;
    const sh = this.shots[i]; const k = Math.min(1, (this.t - sh.at) / sh.dur);
    this.el.cap.textContent = sh.caption ?? '';
    // sky
    const sunrise = i === 0, night = i === 4 && k > 0.5;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, sunrise ? '#2a2a5a' : night ? '#3a2a40' : '#8fc4ef'); g.addColorStop(1, sunrise ? '#ff9a4a' : night ? '#e08a50' : '#e9e2c9');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = sunrise ? '#ffd27a' : '#fff4c0'; ctx.beginPath(); ctx.arc(W * (0.2 + 0.6 * (i === 4 ? k : 0.2)), H * 0.3, 60, 0, 7); ctx.fill();
    ctx.fillStyle = '#5c7a2e'; ctx.fillRect(0, H * 0.62, W, H * 0.38);
    ctx.fillStyle = '#4a4a4c'; ctx.fillRect(0, H * 0.7, W, H * 0.16);
    ctx.fillStyle = '#f0e9c8'; for (let x = 0; x < W; x += 120) ctx.fillRect(x, H * 0.78, 60, 6);
    // bus
    const bx = i === 2 ? (W * 0.1 + (k * W * 0.6)) : W * 0.42;
    ctx.fillStyle = '#fff1c9'; ctx.fillRect(bx, H * 0.5, 420, 200);
    ctx.fillStyle = '#d8262c'; ctx.fillRect(bx, H * 0.5, 420, 22); ctx.fillRect(bx, H * 0.66, 420, 34);
    ctx.fillStyle = '#9ac0d8'; for (let w = 0; w < 5; w++) ctx.fillRect(bx + 20 + w * 80, H * 0.54, 60, 60);
    ctx.fillStyle = '#ffcc33'; ctx.fillRect(bx + 60, H * 0.665, 300, 32);
    ctx.fillStyle = '#d8262c'; ctx.font = '700 26px "Hind Siliguri"'; ctx.textAlign = 'center'; ctx.fillText('চাঁদা পরিবহন', bx + 210, H * 0.69);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(bx + 80, H * 0.78, 28, 0, 7); ctx.arc(bx + 340, H * 0.78, 28, 0, 7); ctx.fill();
    // people (simple figures)
    const figure = (x: number, y: number, col: string, raise = false) => { ctx.fillStyle = '#b07a55'; ctx.beginPath(); ctx.arc(x, y - 52, 12, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.fillRect(x - 11, y - 40, 22, 34); ctx.fillStyle = '#333'; ctx.fillRect(x - 10, y - 6, 8, 30); ctx.fillRect(x + 2, y - 6, 8, 30); ctx.fillStyle = col; if (raise) ctx.fillRect(x + 11, y - 60, 7, 26); };
    if (i === 1) [0, 1, 2, 3].forEach((n) => figure(bx - 60 - n * 40, H * 0.7, ['#1f6fb5', '#d8262c', '#1f9d55', '#f2a900'][n]));
    if (i === 3) figure(bx + 480, H * 0.7, '#2a2a2a', true);
    if (i === 4 || i === 5) { for (let n = 0; n < 9; n++) figure(bx + 520 + (n % 5) * 40, H * 0.7 - Math.floor(n / 5) * 30, ['#1f6fb5', '#d8262c', '#1f9d55', '#f2a900', '#6b3fa0'][n % 5], n % 3 === 0); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(bx + 470, H * 0.76, 24, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,${120 + Math.sin(this.t * 20) * 60},40,0.9)`; ctx.beginPath(); ctx.ellipse(bx + 470, H * 0.68, 20, 40 + Math.sin(this.t * 13) * 8, 0, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(60,60,60,0.5)'; ctx.beginPath(); ctx.arc(bx + 480, H * 0.5 - (this.t % 2) * 40, 40, 0, 7); ctx.fill(); }
    if (i === 5) { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(bx + 700, H * 0.55, 180, 140); ctx.fillStyle = this.t % 0.5 < 0.25 ? '#ff2020' : '#2040ff'; ctx.fillRect(bx + 760, H * 0.52, 60, 16); [0, 1, 2].forEach((n) => figure(bx + 660 + n * 36, H * 0.7, '#2c4a7a')); }
    if (i === 6) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#ffcc33'; ctx.font = '700 96px "Hind Siliguri"'; ctx.fillText('এবার আপনার পালা!', W / 2, H / 2); }
    if (i === 0) { ctx.fillStyle = '#ffcc33'; ctx.font = '700 110px "Hind Siliguri"'; ctx.fillText('চাঁদা পরিবহন', W / 2, H * 0.3); }
  }
}
