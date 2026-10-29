import * as THREE from 'three';
import type { Road } from './road.ts';
import { WORLD } from '../config.ts';
import { mergeStaticMeshes } from '../vehicle/mergeStatic.ts';

/**
 * Town traffic signals: a pole on the left kerb with an arm over the lane and a three-lamp head
 * facing the bus, a stop line and a zebra crossing. Each signal cycles green → amber → red on sim
 * time with its own phase offset. The game checks the stop line; traffic stops at red/amber too.
 */
export type SignalState = 'green' | 'amber' | 'red';
export interface Signal { s: number; offset: number; state: SignalState; ran: boolean; stoppedOk: boolean; warned: boolean; mats: Record<SignalState, THREE.MeshStandardMaterial>; forced: SignalState | null; }

const GREEN = 14, AMBER = 3, RED = 12, CYCLE = GREEN + AMBER + RED;

export class TrafficSignals {
  readonly group = new THREE.Group();
  readonly signals: Signal[] = [];
  private t = 0;
  constructor(private road: Road, spots: number[]) {
    const pole = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.4 });
    const housing = new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
    const kerbLat = -(WORLD.roadWidth / 2 + 0.6);
    spots.forEach((s, k) => {
      const f = road.sample(s);
      const g = new THREE.Group(); g.position.set(f.x, 0, f.z); g.rotation.y = road.yawAt(s);
      // local frame: +x = right, -z = forward (the bus comes from +z and travels to -z)
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 6.2, 8), pole); post.position.set(kerbLat, 3.1, 0); g.add(post);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 8).rotateZ(Math.PI / 2), pole); arm.position.set(kerbLat + 2.3, 5.85, 0); g.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.75, 0.34), housing); head.position.set(kerbLat + 3.6, 4.9, 0); g.add(head);
      const mats = {} as Record<SignalState, THREE.MeshStandardMaterial>;
      ([['red', 0xff2a1a, 0.56], ['amber', 0xffb020, 0], ['green', 0x25e05a, -0.56]] as [SignalState, number, number][]).forEach(([st, c, y]) => {
        const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, roughness: 0.4 }); mats[st] = m;
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 16).rotateX(Math.PI / 2), m); lamp.position.set(kerbLat + 3.6, 4.9 + y, 0.19); g.add(lamp);
        const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), housing); hood.position.set(kerbLat + 3.6, 4.9 + y + 0.25, 0.26); g.add(hood);
      });
      // a smaller repeater head low on the pole for when the bus is right under the arm
      ([['red', 0.4], ['amber', 0], ['green', -0.4]] as [SignalState, number][]).forEach(([st, y]) => { const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12).rotateX(Math.PI / 2), mats[st]); lamp.position.set(kerbLat + 0.22, 2.6 + y, 0.12); g.add(lamp); });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 0.2), housing); box.position.set(kerbLat + 0.22, 2.6, 0.0); g.add(box);
      // stop line across our lane + zebra stripes beyond it
      const line = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth / 2 - 0.2, 0.4).rotateX(-Math.PI / 2), white); line.position.set(-WORLD.roadWidth / 4, 0.012, 2.6); g.add(line);
      for (let i = 0; i < 8; i++) { const z = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.6).rotateX(-Math.PI / 2), white); z.position.set(-WORLD.roadWidth / 2 + 0.6 + i * 0.9, 0.012, 0.6); g.add(z); }
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type !== 'PlaneGeometry') o.castShadow = true; });
      this.group.add(g); mergeStaticMeshes(g, new Set(), true);
      this.signals.push({ s, offset: (k * 11 + 5) % CYCLE, state: 'green', ran: false, stoppedOk: false, warned: false, mats, forced: null });
    });
    this.update(0);
  }
  private stateAt(sig: Signal): SignalState {
    if (sig.forced) return sig.forced;
    const u = (this.t + sig.offset) % CYCLE;
    return u < GREEN ? 'green' : u < GREEN + AMBER ? 'amber' : 'red';
  }
  update(dt: number) {
    this.t += dt;
    for (const sig of this.signals) {
      const st = this.stateAt(sig);
      if (st !== sig.state) { sig.state = st; (['red', 'amber', 'green'] as SignalState[]).forEach((k) => { sig.mats[k].emissiveIntensity = k === st ? 2.4 : 0.12; }); }
    }
  }
  /** Same-direction traffic must stop at these stop lines (red or amber) */
  stopLines(out: number[] = []): number[] { out.length = 0; for (const sig of this.signals) if (sig.state !== 'green') out.push(sig.s + 2.6); return out; }
  /** Called per step with the bus position; returns an event when the line is crossed on red or a clean stop happened. */
  check(busS: number, kmh: number): { ran?: Signal; stopped?: Signal; ahead?: Signal } {
    const r: { ran?: Signal; stopped?: Signal; ahead?: Signal } = {};
    for (const sig of this.signals) {
      const line = sig.s + 2.6, d = line - busS;
      if (!sig.warned && d > 0 && d < 140) { sig.warned = true; r.ahead = sig; }
      if (d < 0 && d > -6 && !sig.ran && !sig.stoppedOk && sig.state === 'red' && kmh > 4) { sig.ran = true; r.ran = sig; }
      if (!sig.stoppedOk && d > 0 && d < 25 && kmh < 1 && sig.state === 'red') { sig.stoppedOk = true; r.stopped = sig; }
    }
    return r;
  }
  reset() { this.t = 0; for (const sig of this.signals) { sig.ran = false; sig.stoppedOk = false; sig.warned = false; sig.forced = this.pinned; } this.update(0); }
  private pinned: SignalState | null = null;
  set pin(st: SignalState | null) { this.pinned = st; this.pinAll(st); }
  /** pin every signal (tests: ?hazards=0 keeps them green) */
  pinAll(st: SignalState | null) { for (const sig of this.signals) sig.forced = st; this.update(0); }
  /** test hook: pin a signal to a state (null = free running) */
  force(k: number, st: SignalState | null) { const sig = this.signals[k]; if (sig) { sig.forced = st; this.update(0); } }
}
