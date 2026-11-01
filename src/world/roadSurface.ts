import * as THREE from 'three';
import type { Road } from './road.ts';
import { WORLD } from '../config.ts';
import { mergeStaticMeshes } from '../vehicle/mergeStatic.ts';

/**
 * Road surface features that the bus actually feels: speed breakers (গতিরোধক) across the road on
 * the way into and out of every town, with a warning sign 45 m ahead, and potholes (গর্ত) on the
 * open stretches. Heights are sampled under each axle every physics step and drive the heave and
 * pitch springs; crossing one too fast is reported as an event for mood / damage / audio.
 */
export interface Breaker { s: number }
export interface Pothole { s: number; lat: number; r: number; depth: number }
export type SurfaceEvent = { kind: 'breaker'; kmh: number; s: number } | { kind: 'pothole'; kmh: number; s: number };

const BREAKER_H = 0.09;      // m
const BREAKER_HALF = 0.75;   // m along the road (cosine profile)

export class RoadSurface {
  readonly breakers: Breaker[] = [];
  readonly potholes: Pothole[] = [];
  readonly group = new THREE.Group();
  /** counters for stats / results */
  crossed = 0; fast = 0; potholeHits = 0;
  private prevS = -1; private lastPothole = -1;

  constructor(private road: Road, seed = 1, enabled = true) {
    if (!enabled) return;
    // one breaker 70 m before each stop zone (entering town) and 40 m after it (leaving), where the road is straight
    for (const st of WORLD.stops) {
      if (st.waiting <= 0 && st.getOff <= 0) continue;
      for (const s of [st.s - 70, st.s + WORLD.stopZoneLength + 40]) if (this.okSpot(s)) this.breakers.push({ s });
    }
    // potholes: a seeded scatter on the open road, 1–3 per cluster, never in towns, on the bridge or at the start
    let r = seed * 9301 + 49297;
    const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
    for (let s = 350; s < this.road.length - 300; s += 90 + rnd() * 160) {
      if (!this.okSpot(s, true)) continue;
      const n = 1 + Math.floor(rnd() * 3), lat0 = -3 + rnd() * 6;
      for (let i = 0; i < n; i++) this.potholes.push({ s: s + i * (1.4 + rnd() * 2.2), lat: THREE.MathUtils.clamp(lat0 + (rnd() - 0.5) * 1.6, -2.9, 2.9), r: 0.4 + rnd() * 0.4, depth: 0.05 + rnd() * 0.04 });
    }
    this.build();
  }

  /** straight, flat road: not in a town kerb range, not on the bridge / toll / rail / roundabout bulge */
  private okSpot(s: number, forPothole = false): boolean {
    if (s < 150 || s > this.road.length - 100) return false;
    if (this.road.bulge(s) > 0.05) return false;
    if (s > WORLD.bridgeStartS - 40 && s < WORLD.bridgeEndS + 40) return false;
    if (Math.abs(s - WORLD.railS) < 40 || Math.abs(s - WORLD.tollS) < 80 || Math.abs(s - WORLD.accidentS) < 60 || Math.abs(s - WORLD.andolonS) < 60) return false;
    if (forPothole) {
      for (const [a, b] of WORLD.kerbRanges) if (s > a - 30 && s < b + 30) return false;
      for (const st of WORLD.stops) if (Math.abs(s - st.s) < 120) return false;
      if (Math.abs(s - WORLD.pumpS) < 40 || Math.abs(s - WORLD.checkpointS) < 40) return false;
    }
    return true;
  }

  private build() {
    const g = new THREE.Group();
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c21c, roughness: 0.85 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });
    const pole = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.6, metalness: 0.3 });
    const signMat = new THREE.MeshStandardMaterial({ map: this.signTexture(), roughness: 0.7, side: THREE.DoubleSide });
    const hole = new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 1 });
    const rim = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 1 });
    // breaker: a row of striped hump segments across the road (cosine profile, 8 slices)
    const hump = (w: number) => {
      const slices = 8, geo = new THREE.BufferGeometry(); const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
      for (let i = 0; i <= slices; i++) { const t = -1 + 2 * i / slices; const z = t * BREAKER_HALF, y = BREAKER_H * 0.5 * (1 + Math.cos(Math.PI * t)); for (const x of [-w / 2, w / 2]) { pos.push(x, y, z); const ny = Math.cos(Math.atan2(-BREAKER_H * 0.5 * Math.PI * Math.sin(Math.PI * t) / BREAKER_HALF, 1)); nrm.push(0, ny, Math.sqrt(Math.max(0, 1 - ny * ny)) * Math.sign(t)); } }
      for (let i = 0; i < slices; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setIndex(idx); return geo;
    };
    const segW = 0.6, humpGeo = hump(segW);
    for (const b of this.breakers) {
      const f = this.road.sample(b.s); const yaw = Math.atan2(-f.tx, -f.tz);
      const w = WORLD.roadWidth + 2 * this.road.bulge(b.s) + 0.4, n = Math.ceil(w / segW);
      for (let i = 0; i < n; i++) {
        const lat = -w / 2 + segW * (i + 0.5);
        const m = new THREE.Mesh(humpGeo, i % 2 === 0 ? yellow : black); m.position.set(f.x + f.rx * lat, 0.005, f.z + f.rz * lat); m.rotation.y = yaw; m.receiveShadow = true; g.add(m);
      }
      // warning sign 45 m before, on the left shoulder, facing the bus
      const sf = this.road.sample(b.s - 45); const sYaw = Math.atan2(-sf.tx, -sf.tz);
      const lat = -(WORLD.roadWidth / 2 + this.road.bulge(b.s - 45) + WORLD.shoulderWidth + 0.5);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 6), pole); p.position.set(sf.x + sf.rx * lat, 1.2, sf.z + sf.rz * lat); p.castShadow = true; g.add(p);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), signMat); board.position.set(sf.x + sf.rx * lat, 2.35, sf.z + sf.rz * lat); board.rotation.y = sYaw + Math.PI; board.castShadow = true; g.add(board);
    }
    // potholes: a dark disc sunk into the tarmac with a rough rim ring
    for (const h of this.potholes) {
      const f = this.road.sample(h.s);
      const d = new THREE.Mesh(new THREE.CircleGeometry(h.r, 10).rotateX(-Math.PI / 2), hole); d.position.set(f.x + f.rx * h.lat, 0.014, f.z + f.rz * h.lat); d.rotation.y = h.s; g.add(d);
      const ring = new THREE.Mesh(new THREE.RingGeometry(h.r, h.r + 0.16, 10).rotateX(-Math.PI / 2), rim); ring.position.set(f.x + f.rx * h.lat, 0.013, f.z + f.rz * h.lat); ring.rotation.y = h.s; g.add(ring);
    }
    this.group.add(g); mergeStaticMeshes(g, new Set(), true);
  }

  private signTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = 128; c.height = 176; const x = c.getContext('2d')!;
    x.fillStyle = '#f2c21c'; x.fillRect(0, 0, 128, 176);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(5, 5, 118, 166);
    // two humps pictogram
    x.fillStyle = '#111'; x.beginPath(); x.moveTo(14, 96); for (let i = 0; i <= 100; i++) { const t = i / 100; x.lineTo(14 + t * 100, 96 - 22 * Math.abs(Math.sin(t * Math.PI * 2))); } x.lineTo(114, 104); x.lineTo(14, 104); x.closePath(); x.fill();
    x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.fillText('গতিরোধক', 64, 140); x.font = 'bold 18px sans-serif'; x.fillText('আস্তে', 64, 162);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  /** surface height (m) under a wheel at (s, lateral): + for a hump, − inside a pothole */
  height(s: number, lat: number): number {
    let h = 0;
    for (const b of this.breakers) { const d = s - b.s; if (d > -BREAKER_HALF && d < BREAKER_HALF) { h = Math.max(h, BREAKER_H * 0.5 * (1 + Math.cos(Math.PI * d / BREAKER_HALF))); } }
    if (h > 0) return h;
    for (const p of this.potholes) { const ds = s - p.s; if (ds < -1.2 || ds > 1.2) continue; const dl = lat - p.lat; const q = Math.sqrt(ds * ds + dl * dl) / p.r; if (q < 1) h = Math.min(h, -p.depth * (1 - q * q)); }
    return h;
  }

  /** distance to the next breaker ahead of s (Infinity if none) */
  nextBreaker(s: number): number {
    let best = Infinity; for (const b of this.breakers) { const d = b.s - s; if (d > -2 && d < best) best = d; } return best;
  }

  /** Advance the crossing detector with the front axle position; returns the events crossed this step. */
  update(frontS: number, lateral: number, kmh: number, simTime: number): SurfaceEvent[] {
    const out: SurfaceEvent[] = [];
    if (this.prevS >= 0 && frontS > this.prevS && frontS - this.prevS < 20) {
      for (const b of this.breakers) if (b.s > this.prevS && b.s <= frontS) { this.crossed++; if (kmh > 40) this.fast++; out.push({ kind: 'breaker', kmh, s: b.s }); }
      for (const p of this.potholes) if (p.s > this.prevS && p.s <= frontS) {
        const left = Math.abs(lateral - 1.05 - p.lat) < p.r + 0.25, right = Math.abs(lateral + 1.05 - p.lat) < p.r + 0.25;
        if ((left || right) && simTime - this.lastPothole > 0.8) { this.lastPothole = simTime; this.potholeHits++; out.push({ kind: 'pothole', kmh, s: p.s }); }
      }
    }
    this.prevS = frontS;
    return out;
  }
  reset() { this.prevS = -1; this.crossed = 0; this.fast = 0; this.potholeHits = 0; this.lastPothole = -1; }
}
