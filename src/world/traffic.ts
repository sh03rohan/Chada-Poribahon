import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD, type QualityTier } from '../config.ts';
import type { Road } from './road.ts';
import { Person, PeopleManager, VARIANTS, HAWKER_VARIANT, makeVariant } from './people.ts';

/**
 * Ambient traffic + footpath pedestrians.
 * Vehicles are low-poly merged geometries drawn with one InstancedMesh per type; they follow the
 * road spline in both lanes, keep spacing, queue behind the player / blockade, and oncoming
 * traffic swerves onto its shoulder when the player drifts into its lane.
 * Pedestrians reuse the humanoid factory and are recycled around the player.
 */

type VType = 'car' | 'bike' | 'bus' | 'truck' | 'auto';
interface Vehicle { type: VType; idx: number; s: number; dir: 1 | -1; speed: number; maxSpeed: number; lateral: number; swerve: number; len: number; }

const LANE = WORLD.laneWidth / 2;

function colored(g: THREE.BufferGeometry, c: THREE.ColorRepresentation) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c); const n = geo.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); geo.deleteAttribute('uv');
  return geo;
}
const wheel = (x: number, z: number, r = 0.33, w = 0.22) => colored(new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2).translate(x, r, z), 0x151515);

/** Geometry builders — vehicles face -Z (forward), origin at ground centre. */
function buildCar(body: number): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.7, 0.55, 4.2).translate(0, 0.6, 0), body),
    colored(new THREE.BoxGeometry(1.5, 0.5, 2.2).translate(0, 1.12, 0.1), body),
    colored(new THREE.BoxGeometry(1.46, 0.42, 2.0).translate(0, 1.12, 0.1), 0x9ac0d8),
    colored(new THREE.BoxGeometry(0.3, 0.12, 0.05).translate(-0.55, 0.65, -2.1), 0xfff2cc), colored(new THREE.BoxGeometry(0.3, 0.12, 0.05).translate(0.55, 0.65, -2.1), 0xfff2cc),
    colored(new THREE.BoxGeometry(0.3, 0.12, 0.05).translate(-0.55, 0.65, 2.1), 0xd82020), colored(new THREE.BoxGeometry(0.3, 0.12, 0.05).translate(0.55, 0.65, 2.1), 0xd82020),
    wheel(-0.8, -1.35), wheel(0.8, -1.35), wheel(-0.8, 1.35), wheel(0.8, 1.35),
  ])!;
}
function buildBike(body: number): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.3, 0.3, 1.1).translate(0, 0.65, 0), body),
    colored(new THREE.BoxGeometry(0.25, 0.1, 0.6).translate(0, 0.85, 0.2), 0x202020),
    colored(new THREE.BoxGeometry(0.6, 0.05, 0.05).translate(0, 1.0, -0.55), 0x303030),
    colored(new THREE.BoxGeometry(0.16, 0.14, 0.08).translate(0, 0.95, -0.7), 0xfff2cc),
    wheel(0, -0.72, 0.3, 0.08), wheel(0, 0.72, 0.3, 0.08),
  ])!;
}
function buildBus(body: number, stripe: number): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.BoxGeometry(2.45, 2.6, 10.5).translate(0, 1.75, 0), body),
    colored(new THREE.BoxGeometry(2.48, 0.35, 10.52).translate(0, 1.4, 0), stripe),
    colored(new THREE.BoxGeometry(2.1, 0.1, 10.0).translate(0, 3.1, 0), 0xdddddd),
    colored(new THREE.BoxGeometry(2.2, 0.9, 0.05).translate(0, 2.3, -5.26), 0x9ac0d8),
    colored(new THREE.BoxGeometry(0.35, 0.2, 0.05).translate(-0.8, 0.9, -5.26), 0xfff2cc), colored(new THREE.BoxGeometry(0.35, 0.2, 0.05).translate(0.8, 0.9, -5.26), 0xfff2cc),
    colored(new THREE.BoxGeometry(0.35, 0.2, 0.05).translate(-0.8, 0.9, 5.26), 0xd82020), colored(new THREE.BoxGeometry(0.35, 0.2, 0.05).translate(0.8, 0.9, 5.26), 0xd82020),
    wheel(-1.0, -3.3, 0.5, 0.3), wheel(1.0, -3.3, 0.5, 0.3), wheel(-1.0, 2.8, 0.5, 0.3), wheel(1.0, 2.8, 0.5, 0.3),
  ];
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) parts.push(colored(new THREE.BoxGeometry(0.05, 0.9, 1.3).translate(sx * 1.24, 2.3, -4 + i * 1.6), 0x9ac0d8));
  return mergeGeometries(parts)!;
}
function buildTruck(cab: number, cargo: number): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(2.3, 2.2, 2.2).translate(0, 1.6, -3.4), cab),
    colored(new THREE.BoxGeometry(2.0, 0.8, 0.05).translate(0, 2.1, -4.51), 0x9ac0d8),
    colored(new THREE.BoxGeometry(2.4, 0.5, 7.6).translate(0, 0.9, 1.4), 0x3a3a3a),
    colored(new THREE.BoxGeometry(2.4, 1.9, 6.0).translate(0, 2.1, 1.6), cargo),
    colored(new THREE.BoxGeometry(2.42, 0.25, 6.02).translate(0, 2.9, 1.6), 0xffcc33),
    colored(new THREE.BoxGeometry(2.42, 0.25, 6.02).translate(0, 1.3, 1.6), 0x1f9d55),
    colored(new THREE.BoxGeometry(0.35, 0.2, 0.05).translate(-0.8, 0.8, -4.51), 0xfff2cc), colored(new THREE.BoxGeometry(0.35, 0.2, 0.05).translate(0.8, 0.8, -4.51), 0xfff2cc),
    wheel(-1.0, -3.0, 0.5, 0.3), wheel(1.0, -3.0, 0.5, 0.3), wheel(-1.0, 2.2, 0.5, 0.3), wheel(1.0, 2.2, 0.5, 0.3), wheel(-1.0, 3.4, 0.5, 0.3), wheel(1.0, 3.4, 0.5, 0.3),
  ])!;
}
function buildAuto(): THREE.BufferGeometry {
  const green = 0x1f8a4a;
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.3, 0.6, 2.6).translate(0, 0.65, 0.1), green),
    colored(new THREE.BoxGeometry(1.35, 0.1, 2.7).translate(0, 1.75, 0.1), green),
    colored(new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(-0.62, 1.3, -1.1), 0x202020), colored(new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(0.62, 1.3, -1.1), 0x202020),
    colored(new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(-0.62, 1.3, 1.3), 0x202020), colored(new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(0.62, 1.3, 1.3), 0x202020),
    colored(new THREE.BoxGeometry(1.2, 0.8, 0.05).translate(0, 1.3, -1.2), 0x9ac0d8),
    colored(new THREE.BoxGeometry(1.2, 0.5, 0.05).translate(0, 1.0, 1.4), 0xffcc33),
    colored(new THREE.SphereGeometry(0.1, 6, 5).translate(0, 0.95, -1.35), 0xfff2cc),
    wheel(0, -1.1, 0.25, 0.1), wheel(-0.6, 0.9, 0.25, 0.12), wheel(0.6, 0.9, 0.25, 0.12),
  ])!;
}

const SPEC: Record<VType, { count: number; speed: [number, number]; len: number; colors: number[][] }> = {
  car: { count: 14, speed: [55, 85], len: 4.2, colors: [[0xe8e8e8], [0x1b1b1b], [0xb0b8c0], [0x8a1f2a], [0x1f4a8a]] },
  bike: { count: 10, speed: [45, 75], len: 1.6, colors: [[0xd8262c], [0x1b1b1b], [0x1f6fb5]] },
  bus: { count: 5, speed: [55, 75], len: 10.5, colors: [[0xf2e2b0, 0x1f6fb5], [0xd8e8d0, 0xd8262c], [0xffffff, 0x1f9d55]] },
  truck: { count: 6, speed: [40, 60], len: 8.4, colors: [[0x2a5a9a, 0xc8a050], [0xd8262c, 0x3a7a3a], [0x1f9d55, 0xa04040]] },
  auto: { count: 9, speed: [35, 50], len: 2.8, colors: [[0x1f8a4a]] },
};

export class Traffic {
  readonly group = new THREE.Group();
  private vehicles: Vehicle[] = [];
  private meshes: Record<VType, THREE.InstancedMesh[]> = { car: [], bike: [], bus: [], truck: [], auto: [] };
  private slots: Record<VType, { mesh: number; idx: number }[]> = { car: [], bike: [], bus: [], truck: [], auto: [] };
  private riders: Person[] = [];
  private peds: { p: Person; s: number; dir: 1 | -1; lat: number }[] = [];
  private hawkers: Person[] = [];
  private density: number;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(1, 1, 1);
  /** set by the game: barrier s (Infinity when clear) */
  barrierS = Infinity;
  /** last collision info for the game loop */
  collisionS = Infinity;
  /** test hook: freeze traffic and ignore it for walls */
  enabled = true;

  constructor(private road: Road, tier: QualityTier, private people: PeopleManager) {
    this.density = tier === 'low' ? 0.55 : tier === 'medium' ? 0.8 : 1;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
    for (const type of Object.keys(SPEC) as VType[]) {
      const sp = SPEC[type];
      const count = Math.max(1, Math.round(sp.count * this.density));
      // one InstancedMesh per colour variant
      const per = Math.ceil(count / sp.colors.length);
      sp.colors.forEach((c, ci) => {
        const geo = type === 'car' ? buildCar(c[0]) : type === 'bike' ? buildBike(c[0]) : type === 'bus' ? buildBus(c[0], c[1]) : type === 'truck' ? buildTruck(c[0], c[1]) : buildAuto();
        geo.computeVertexNormals();
        const mesh = new THREE.InstancedMesh(geo, mat, per);
        mesh.castShadow = true; mesh.frustumCulled = false;
        this.meshes[type].push(mesh); this.group.add(mesh);
        for (let i = 0; i < per; i++) this.slots[type].push({ mesh: ci, idx: i });
      });
      for (let i = 0; i < count; i++) {
        const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
        const maxSpeed = (sp.speed[0] + Math.random() * (sp.speed[1] - sp.speed[0])) / 3.6;
        // keep the first 250 m clear so the player is not boxed in at the start
        let s0 = 250 + Math.random() * (road.length - 300);
        if (dir === -1 && s0 < 400) s0 += 400;
        this.vehicles.push({ type, idx: i, s: s0, dir, speed: maxSpeed, maxSpeed, lateral: -dir * LANE, swerve: 0, len: sp.len });
      }
    }
    // Bike riders (humanoids in a riding pose), one per bike
    for (const vh of this.vehicles) if (vh.type === 'bike') {
      const p = new Person(VARIANTS[(vh.idx * 3 + 1) % VARIANTS.length]); p.setAction('ride'); p.mesh.castShadow = false;
      this.group.add(p.root); people.add(p); this.riders.push(p);
    }
    // Footpath pedestrians near the player (recycled) + hawkers at shop clusters
    const nPed = tier === 'low' ? 8 : tier === 'medium' ? 12 : 16;
    for (let i = 0; i < nPed; i++) {
      const p = new Person(VARIANTS[(i * 5 + 2) % VARIANTS.length]);
      const dir: 1 | -1 = i % 2 ? 1 : -1;
      const lat = (i % 4 < 2 ? -1 : 1) * (WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.6 + Math.random() * 1.2);
      this.peds.push({ p, s: 0, dir, lat });
      p.walkSpeed = 0.9 + Math.random() * 0.5;
      this.group.add(p.root); people.add(p);
    }
    const hawkSpots = [WORLD.rajbariStopS - 40, WORLD.rajbariStopS + 60, 1150, WORLD.finishS - 300, WORLD.finishS - 420, WORLD.andolonS - 300];
    hawkSpots.forEach((s, i) => {
      const p = new Person(i % 2 ? HAWKER_VARIANT : makeVariant({ id: 'hawker2', outfit: 'lungi-shirt', top: '#f2e2b0', bottom: '#2a4a2a', hair: 'cap', accent: '#d8262c', prop: 'basket', height: 1.68 }));
      const side = i % 2 ? -1 : 1;
      const f = road.sample(s); const lat = side * (WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.8);
      p.position.set(f.x + f.rx * lat, 0, f.z + f.rz * lat); p.lookAt(f.x, f.z); p.setAction('hawk');
      this.group.add(p.root); people.add(p); this.hawkers.push(p);
    });
  }

  /** Distance from the player's front to the nearest same-direction vehicle directly ahead in the same lane. */
  aheadDistance(playerS: number, playerLateral: number): number {
    let best = Infinity;
    for (const vh of this.vehicles) {
      if (vh.dir !== 1) continue;
      const d = vh.s - vh.len / 2 - playerS;
      if (d > -2 && d < best && Math.abs(vh.lateral - playerLateral) < 2.2) best = d;
    }
    return best;
  }

  private place(vh: Vehicle) {
    const f = this.road.sample(vh.s);
    const lat = vh.lateral + vh.swerve;
    this.v.set(f.x + f.rx * lat, 0, f.z + f.rz * lat);
    const yaw = Math.atan2(-f.tx, -f.tz) + (vh.dir === 1 ? 0 : Math.PI);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.m.compose(this.v, this.q, this.sc);
    const slot = this.slots[vh.type][vh.idx];
    this.meshes[vh.type][slot.mesh].setMatrixAt(slot.idx, this.m);
    return yaw;
  }

  update(dt: number, playerS: number, playerLateral: number, playerSpeed: number, camPos: THREE.Vector3, playerActive: boolean) {
    const L = this.road.length;
    const vs = this.vehicles;
    if (!this.enabled) { this.collisionS = Infinity; return; }
    // Sort by s for neighbour lookups
    vs.sort((a, b) => a.s - b.s);
    this.collisionS = Infinity;
    for (let i = 0; i < vs.length; i++) {
      const vh = vs[i];
      // vehicle ahead in the same direction/lane
      let gap = Infinity, leadSpeed = Infinity;
      for (let j = 1; j < vs.length; j++) {
        const o = vs[(i + j * vh.dir + vs.length * 4) % vs.length];
        if (o.dir !== vh.dir) continue;
        let d = (o.s - vh.s) * vh.dir; if (d < 0) d += L;
        gap = d - o.len / 2 - vh.len / 2; leadSpeed = o.speed; break;
      }
      // the player bus as a lead vehicle (same direction only)
      if (playerActive && vh.dir === 1) {
        const d = playerS - vh.s - 5.6 - vh.len / 2;
        if (d > -1 && d < gap && Math.abs(playerLateral - vh.lateral) < 2.4) { gap = d; leadSpeed = Math.max(0, playerSpeed); }
      }
      // barrier (blockade) ahead
      const toBarrier = (this.barrierS - vh.s) * vh.dir - vh.len / 2 - 3;
      if (this.barrierS !== Infinity && toBarrier > -5 && toBarrier < gap) { gap = toBarrier; leadSpeed = 0; }
      // target speed: keep ~2 s headway, hard stop at 2 m
      let target = vh.maxSpeed;
      if (gap < Infinity) {
        const safe = 3 + leadSpeed * 1.4;
        if (gap < safe) target = Math.min(target, Math.max(0, leadSpeed * (gap / safe) + (gap < 2 ? 0 : 0)));
        if (gap < 2) target = 0;
      }
      // oncoming swerve when the player sits in their lane
      let swerveT = 0;
      if (playerActive && vh.dir === -1) {
        const d = vh.s - playerS; // positive = player ahead of (i.e. in front of) the oncoming vehicle
        if (d > 0 && d < 55 && playerLateral > 0.2) { swerveT = 3.0; target = Math.min(target, 7); }
      }
      vh.swerve += (swerveT - vh.swerve) * Math.min(1, dt * 1.5);
      const accel = target > vh.speed ? 2.2 : 5.5;
      vh.speed += THREE.MathUtils.clamp(target - vh.speed, -accel * dt, accel * dt);
      vh.s += vh.speed * vh.dir * dt;
      if (vh.s > L - 20) { vh.s -= L - 40; } else if (vh.s < 20) { vh.s += L - 40; }
      // keep traffic around the player: anything far away is recycled into a window ahead/behind
      if (playerActive && Math.abs(vh.s - playerS) > 650) {
        vh.s = vh.dir === 1 ? (Math.random() < 0.5 ? playerS - 120 - Math.random() * 60 : playerS + 150 + Math.random() * 200) : playerS + 250 + Math.random() * 350;
        vh.s = Math.max(30, Math.min(L - 30, vh.s)); vh.speed = vh.maxSpeed;
      }
      // player rear-ending a same-direction vehicle → report nearest for a wall
      if (playerActive && vh.dir === 1 && Math.abs(vh.lateral + vh.swerve - playerLateral) < 2.2) {
        const d = vh.s - vh.len / 2 - (playerS + 5.6);
        if (d > -3 && d < this.collisionS) this.collisionS = d;
      }
      const yaw = this.place(vh);
      if (vh.type === 'bike') {
        const r = this.riders[vh.idx]; if (r) { const f = this.road.sample(vh.s); const lat = vh.lateral + vh.swerve; r.position.set(f.x + f.rx * lat, 0.52, f.z + f.rz * lat); r.root.rotation.y = yaw; }
      }
    }
    for (const type of Object.keys(this.meshes) as VType[]) for (const mesh of this.meshes[type]) mesh.instanceMatrix.needsUpdate = true;

    // Pedestrians: walk along the footpath, recycle around the player
    for (const pd of this.peds) {
      const far = pd.s < playerS - 90 || pd.s > playerS + 160;
      if (far || pd.s === 0) {
        pd.s = playerS + 40 + Math.random() * 110;
        if (pd.s > L - 60 || (pd.s > WORLD.andolonS - 40 && pd.s < WORLD.andolonS + 40)) pd.s = playerS - 60;
      }
      pd.s += pd.dir * pd.p.walkSpeed * dt;
      const f = this.road.sample(pd.s);
      pd.p.position.set(f.x + f.rx * pd.lat, 0, f.z + f.rz * pd.lat);
      pd.p.root.rotation.y = Math.atan2(-f.tx, -f.tz) + (pd.dir === 1 ? 0 : Math.PI);
      if (pd.p.action !== 'walk') pd.p.setAction('walk');
    }
    void camPos;
  }
}
