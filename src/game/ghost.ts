import * as THREE from 'three';
import type { Road } from '../world/road.ts';
import { bn } from '../util/bangla.ts';

/**
 * Ghost bus: the fastest finished run on this route is kept (position every half second) and
 * replayed next time as a translucent bus you can race. The HUD shows the time delta against it
 * at your current position, and the results card says whether you beat it.
 */
export interface GhostRun { v: 1; t: number[]; s: number[]; lat: number[]; time: number; income: number; date: string; bus: string }
const KEY = (route: string) => `cp-ghost-${route}`;

export function loadGhost(route: string): GhostRun | null {
  try { const raw = localStorage.getItem(KEY(route)); if (!raw) return null; const g = JSON.parse(raw) as GhostRun; return g && g.v === 1 && g.t.length > 2 ? g : null; } catch { return null; }
}
export function clearGhost(route: string) { try { localStorage.removeItem(KEY(route)); } catch { /* ignore */ } }

export class Ghost {
  readonly mesh: THREE.Group;
  best: GhostRun | null;
  /** samples of the run in progress */
  private rec: { t: number[]; s: number[]; lat: number[] } = { t: [], s: [], lat: [] };
  private lastRec = -1;
  /** seconds you are behind (+) or ahead (−) of the ghost at your current s; null without a ghost */
  delta: number | null = null;
  enabled = true;
  newBest = false;
  private cursor = 0;

  constructor(private road: Road, private route: string, dims: { length: number; width: number; height: number }) {
    this.best = loadGhost(route);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4fc8ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(dims.width, dims.height - 0.9, dims.length), mat); body.position.y = 0.9 + (dims.height - 0.9) / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(dims.width * 0.7, 0.4, dims.length * 0.55), mat); roof.position.y = dims.height + 0.2; g.add(roof);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xbff1ff, transparent: true, opacity: 0.7 })); edge.position.copy(body.position); g.add(edge);
    // a floating label so the ghost reads as "your best run" and not as traffic
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(10, 40, 70, 0.75)'; x.beginPath(); x.roundRect(4, 4, 248, 56, 14); x.fill(); x.fillStyle = '#bff1ff'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('👻 সেরা ট্রিপ', 128, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })); label.scale.set(3.2, 0.8, 1); label.position.y = dims.height + 1.1; g.add(label);
    g.renderOrder = 5; g.visible = false;
    this.mesh = g;
  }

  /** a run starts */
  begin() { this.rec = { t: [], s: [], lat: [] }; this.lastRec = -1; this.delta = null; this.newBest = false; this.cursor = 0; this.mesh.visible = false; }

  /** called from the physics step: keep a sample every half second of driving */
  record(elapsed: number, s: number, lat: number) {
    if (elapsed - this.lastRec < 0.5) return;
    this.lastRec = elapsed; this.rec.t.push(+elapsed.toFixed(2)); this.rec.s.push(+s.toFixed(1)); this.rec.lat.push(+lat.toFixed(2));
  }

  /** ghost time at position s (linear between samples); null past the end */
  timeAt(s: number): number | null {
    const b = this.best; if (!b) return null;
    if (s <= b.s[0]) return b.t[0];
    if (s >= b.s[b.s.length - 1]) return null;
    let i = Math.min(this.cursor, b.s.length - 2);
    while (i > 0 && b.s[i] > s) i--;
    while (i < b.s.length - 2 && b.s[i + 1] < s) i++;
    this.cursor = i;
    const span = b.s[i + 1] - b.s[i];
    return span > 0.01 ? b.t[i] + (b.t[i + 1] - b.t[i]) * (s - b.s[i]) / span : b.t[i];
  }

  /** frame update: place the ghost at the time the player has been driving, and compute the delta */
  update(elapsed: number, playerS: number, driving: boolean) {
    const b = this.best;
    if (!b || !this.enabled || !driving) { this.mesh.visible = false; this.delta = null; return; }
    // position of the ghost at `elapsed`
    let i = 0; while (i < b.t.length - 2 && b.t[i + 1] < elapsed) i++;
    const t0 = b.t[i], t1 = b.t[i + 1], k = elapsed >= t1 ? 1 : elapsed <= t0 ? 0 : (elapsed - t0) / Math.max(0.01, t1 - t0);
    const gs = b.s[i] + (b.s[i + 1] - b.s[i]) * k, gl = b.lat[i] + (b.lat[i + 1] - b.lat[i]) * k;
    const f = this.road.sample(Math.max(0, Math.min(this.road.length - 1, gs)));
    this.mesh.position.set(f.x + f.rx * gl, 0, f.z + f.rz * gl); this.mesh.rotation.y = Math.atan2(-f.tx, -f.tz);
    // do not draw the ghost through the player's own bus
    this.mesh.visible = Math.abs(gs - playerS) > 4 && elapsed < b.time + 1;
    const gt = this.timeAt(playerS);
    this.delta = gt === null ? null : elapsed - gt;
  }

  /** run finished: keep it if it is the first or the fastest; returns the results line */
  finish(elapsed: number, income: number, bus: string, countable: boolean): { text: string; newBest: boolean } {
    const prev = this.best;
    const faster = !prev || elapsed < prev.time - 0.5;
    if (countable && this.rec.t.length > 4 && faster) {
      this.rec.t.push(+elapsed.toFixed(2)); this.rec.s.push(+(this.road.length).toFixed(1)); this.rec.lat.push(this.rec.lat[this.rec.lat.length - 1] ?? -1.75);
      const run: GhostRun = { v: 1, t: this.rec.t, s: this.rec.s, lat: this.rec.lat, time: elapsed, income, date: new Date().toISOString().slice(0, 10), bus };
      try { localStorage.setItem(KEY(this.route), JSON.stringify(run)); } catch { /* storage full or blocked: the ghost just is not kept */ }
      this.best = run; this.newBest = true;
    }
    const mm = (t: number) => `${bn(Math.floor(t / 60))}:${bn(Math.floor(t % 60)).padStart(2, '০')}`;
    if (!prev) return { text: countable ? `👻 প্রথম সম্পূর্ণ ট্রিপ (${mm(elapsed)}) — পরের বার এই ভূত-বাসের সাথে রেস হবে` : '', newBest: this.newBest };
    const d = elapsed - prev.time;
    return { text: faster && countable ? `👻 নতুন সেরা সময়! ভূত-বাসের চেয়ে ${mm(-d)} দ্রুত (আগের সেরা ${mm(prev.time)})` : `👻 ভূত-বাস ${mm(Math.abs(d))} ${d > 0 ? 'আগে' : 'পরে'} পৌঁছেছিল (সেরা ${mm(prev.time)})`, newBest: this.newBest };
  }
}
