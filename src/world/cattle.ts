import * as THREE from 'three';
import type { Road } from './road.ts';
import type { Circle, Contact } from './collision.ts';
import { Person, PeopleManager, VARIANTS } from './people.ts';
import { WORLD } from '../config.ts';
import { mergeStaticMeshes } from '../vehicle/mergeStatic.ts';

/**
 * Cattle crossing: at village spots a herder walks three cows across the road from the left
 * field to the right. The crossing starts when the bus is ~220 m away so the player has to slow
 * or wait; cows are solid (circles) and hitting one costs compensation to the owner.
 */
export type CattleState = 'idle' | 'crossing' | 'done';
export interface Cow { root: THREE.Group; legs: THREE.Mesh[]; lat: number; sOff: number; speed: number; delay: number; phase: number; }
export interface CattleSpot { s: number; state: CattleState; t: number; cows: Cow[]; herder: Person; herderLat: number; }

const COLOURS = [0xe9e2d4, 0x6b4a2b, 0x2a2622, 0xc9b79c];

function buildCow(colour: number): { root: THREE.Group; legs: THREE.Mesh[] } {
  const root = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8 });
  const horn = new THREE.MeshStandardMaterial({ color: 0xd9cfb8, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 1.6), hide); body.position.set(0, 0.95, 0); root.add(body);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.5), hide); neck.position.set(0, 1.15, -0.95); neck.rotation.x = 0.5; root.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.5), hide); head.position.set(0, 1.0, -1.25); root.add(head);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.12), dark); nose.position.set(0, 0.88, -1.52); root.add(nose);
  for (const x of [-0.14, 0.14]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.25, 6), horn); h.position.set(x * 1.6, 1.25, -1.18); h.rotation.z = -x * 4; root.add(h);
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.12), hide); ear.position.set(x * 1.9, 1.12, -1.15); root.add(ear);
  }
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.24, -0.55], [0.24, -0.55], [-0.24, 0.55], [0.24, 0.55]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16).translate(0, -0.3, 0), hide); l.position.set(x, 0.6, z); root.add(l); legs.push(l);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.6, 5), dark); tail.position.set(0, 0.95, 0.85); tail.rotation.x = 0.3; root.add(tail);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  mergeStaticMeshes(root, new Set(legs), true);
  return { root, legs };
}

export class CattleCrossing {
  readonly group = new THREE.Group();
  readonly spots: CattleSpot[] = [];
  private tmp = new THREE.Vector3();
  constructor(private road: Road, people: PeopleManager, spotsS: number[]) {
    const fromLat = -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 2.2);
    spotsS.forEach((s, k) => {
      const cows: Cow[] = [];
      for (let i = 0; i < 3; i++) {
        const c = buildCow(COLOURS[(k * 3 + i) % COLOURS.length]);
        cows.push({ root: c.root, legs: c.legs, lat: fromLat - i * 0.9, sOff: (i - 1) * 2.2 + (k % 2 ? 0.6 : -0.6), speed: 0.75 + i * 0.08, delay: i * 1.1, phase: i * 1.7 });
        this.group.add(c.root);
      }
      const herder = new Person(VARIANTS[(2 + k * 5) % VARIANTS.length]); herder.setAction('idle');
      this.group.add(herder.root); people.add(herder);
      this.spots.push({ s, state: 'idle', t: 0, cows, herder, herderLat: fromLat - 2.6 });
      this.place(this.spots[k]);
    });
  }
  private place(sp: CattleSpot) {
    for (const c of sp.cows) {
      const f = this.road.sample(sp.s + c.sOff);
      c.root.position.set(f.x + f.rx * c.lat, 0, f.z + f.rz * c.lat);
      c.root.rotation.y = Math.atan2(f.rx, f.rz); // face across the road (+lateral)
    }
    const f = this.road.sample(sp.s - 1.5);
    sp.herder.position.set(f.x + f.rx * sp.herderLat, 0, f.z + f.rz * sp.herderLat);
    sp.herder.root.rotation.y = Math.atan2(f.rx, f.rz);
  }
  /** Start the crossing when the bus approaches; walk the cows across; stop them on the far side. */
  update(dt: number, busS: number): { started: CattleSpot | null } {
    let started: CattleSpot | null = null;
    const toLat = WORLD.roadWidth / 2 + WORLD.shoulderWidth + 2.5;
    for (const sp of this.spots) {
      const d = sp.s - busS;
      if (sp.state === 'idle' && d > 0 && d < 220) { sp.state = 'crossing'; sp.t = 0; started = sp; sp.herder.setAction('wave'); }
      if (sp.state !== 'crossing') continue;
      sp.t += dt;
      let allAcross = true;
      for (const c of sp.cows) {
        if (sp.t < c.delay) { allAcross = false; continue; }
        if (c.lat < toLat) { c.lat += c.speed * dt; allAcross = false; c.phase += dt * 6; c.legs.forEach((l, i) => { l.rotation.x = Math.sin(c.phase + (i % 2 ? Math.PI : 0)) * 0.45; }); }
        else c.legs.forEach((l) => { l.rotation.x = 0; });
      }
      // the herder follows the last cow, a little behind
      const last = sp.cows[sp.cows.length - 1];
      if (sp.t > 1.5 && sp.herderLat < last.lat - 1.2) { sp.herderLat += 0.9 * dt; sp.herder.setAction('walk'); } else if (sp.herderLat >= last.lat - 1.2 && allAcross) sp.herder.setAction('idle');
      this.place(sp);
      if (allAcross) { sp.state = 'done'; sp.herder.setAction('idle'); }
    }
    return { started };
  }
  /** Solid cows on or near the road (only while a crossing is in progress nearby). */
  circles(busS: number, out: Circle[]) {
    for (const sp of this.spots) {
      if (sp.state !== 'crossing' || Math.abs(sp.s - busS) > 40) continue;
      for (const c of sp.cows) { if (Math.abs(c.lat) > WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.5) continue; this.tmp.copy(c.root.position); out.push({ x: this.tmp.x, z: this.tmp.z, r: 0.75, mass: 450, tag: c, vx: 0, vz: 0 }); }
    }
  }
  /** A hit cow is shoved sideways (it is light next to the bus) and stumbles on; the bus keeps most of its speed. */
  applyContacts(contacts: Contact[]) {
    for (const ct of contacts) {
      const cow = ct.circle.tag as Cow; const sp = this.spots.find((x) => x.cows.includes(cow)); if (!sp) continue;
      const f = this.road.sample(sp.s + cow.sOff);
      const sideways = -(ct.nx * f.rx + ct.nz * f.rz);           // +lateral component of the shove
      cow.lat += sideways * (ct.push + Math.min(3, ct.dv) * 0.35) + (Math.abs(sideways) < 0.3 ? 0.9 : 0); // head-on: nudge it off the lane
      cow.phase += 1;
    }
  }
  /** Is any cow currently on the carriageway near s? */
  onRoadNear(busS: number): boolean { return this.spots.some((sp) => sp.state === 'crossing' && Math.abs(sp.s - busS) < 60 && sp.cows.some((c) => Math.abs(c.lat) < WORLD.roadWidth / 2 + 0.6)); }
  isCow(tag: unknown): boolean { return this.spots.some((sp) => sp.cows.includes(tag as Cow)); }
  reset() { const fromLat = -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 2.2); for (const sp of this.spots) { sp.state = 'idle'; sp.t = 0; sp.cows.forEach((c, i) => { c.lat = fromLat - i * 0.9; }); sp.herderLat = fromLat - 2.6; sp.herder.setAction('idle'); this.place(sp); } }
  /** test hook */
  force(k = 0) { const sp = this.spots[k]; if (sp) { sp.state = 'crossing'; sp.t = 0; } }
}
