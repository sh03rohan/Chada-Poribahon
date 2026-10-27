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
const GLASS = 0x1c2a36, CHROME = 0xcfd4d8, DARK = 0x151515, LIGHT = 0xfff2cc, TAIL = 0xd82020;
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const hubcap = (x: number, z: number, r: number, w: number) => colored(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2).translate(x, r, z), 0xb8bcc0);
const arch = (x: number, z: number, r: number, w: number, c: number) => colored(new THREE.CylinderGeometry(r + 0.1, r + 0.1, w, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2 * 0).translate(x, r, z), c);

function buildCar(body: number): THREE.BufferGeometry {
  const dark = 0x0f0f10;
  return mergeGeometries([
    box(1.74, 0.42, 4.3, 0, 0.62, 0, body),                             // lower body
    box(1.7, 0.3, 1.5, 0, 0.98, -1.1, body),                            // hood
    box(1.7, 0.26, 1.1, 0, 0.96, 1.5, body),                            // trunk
    colored(new THREE.BoxGeometry(1.5, 0.5, 2.1).translate(0, 1.33, 0.05), body),   // cabin
    colored(new THREE.BoxGeometry(1.52, 0.36, 1.9).translate(0, 1.33, 0.05), GLASS),  // window band
    box(1.4, 0.36, 0.06, 0, 1.3, -1.02, GLASS), box(1.3, 0.3, 0.06, 0, 1.3, 1.1, GLASS),   // windshield / rear glass
    box(0.5, 0.05, 1.8, -0.75, 1.1, 0.05, body), box(0.5, 0.05, 1.8, 0.75, 1.1, 0.05, body),   // sills
    box(1.8, 0.16, 0.2, 0, 0.42, -2.18, 0x2a2a2a), box(1.8, 0.16, 0.2, 0, 0.42, 2.18, 0x2a2a2a), // bumpers
    box(0.34, 0.14, 0.05, -0.6, 0.74, -2.16, LIGHT), box(0.34, 0.14, 0.05, 0.6, 0.74, -2.16, LIGHT),
    box(0.34, 0.12, 0.05, -0.6, 0.78, 2.16, TAIL), box(0.34, 0.12, 0.05, 0.6, 0.78, 2.16, TAIL),
    box(0.12, 0.08, 0.16, -0.92, 1.12, -0.6, body), box(0.12, 0.08, 0.16, 0.92, 1.12, -0.6, body),  // mirrors
    box(0.5, 0.06, 0.02, 0, 0.6, -2.19, 0x202020),                      // grille
    arch(-0.8, -1.35, 0.33, 0.3, dark), arch(0.8, -1.35, 0.33, 0.3, dark), arch(-0.8, 1.35, 0.33, 0.3, dark), arch(0.8, 1.35, 0.33, 0.3, dark),
    wheel(-0.8, -1.35), wheel(0.8, -1.35), wheel(-0.8, 1.35), wheel(0.8, 1.35),
    hubcap(-0.9, -1.35, 0.33, 0.22), hubcap(0.9, -1.35, 0.33, 0.22), hubcap(-0.9, 1.35, 0.33, 0.22), hubcap(0.9, 1.35, 0.33, 0.22),
  ])!;
}
function buildBike(body: number): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.18, 0.22, 0.9, 0, 0.62, 0.05, 0x202020),                      // frame
    colored(new THREE.SphereGeometry(0.17, 8, 6).scale(1, 0.75, 1.5).translate(0, 0.82, -0.15), body),  // tank
    box(0.24, 0.08, 0.5, 0, 0.84, 0.3, 0x111111),                       // seat
    box(0.62, 0.04, 0.04, 0, 1.02, -0.52, CHROME), box(0.06, 0.3, 0.06, 0, 0.9, -0.55, 0x202020), // handlebar + stem
    colored(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0.86, -0.68), LIGHT),
    box(0.1, 0.06, 0.05, 0, 0.8, 0.72, TAIL),
    colored(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 6).rotateX(Math.PI / 2 - 0.15).translate(0.14, 0.42, 0.35), CHROME),  // exhaust
    box(0.14, 0.04, 0.5, 0, 0.66, -0.72, body), box(0.14, 0.04, 0.5, 0, 0.66, 0.72, body),       // mudguards
    wheel(0, -0.72, 0.3, 0.08), wheel(0, 0.72, 0.3, 0.08),
    colored(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 8).rotateZ(Math.PI / 2).translate(0, 0.3, -0.72), 0x8a8e92),
    colored(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 8).rotateZ(Math.PI / 2).translate(0, 0.3, 0.72), 0x8a8e92),
  ])!;
}
function buildBus(body: number, stripe: number): THREE.BufferGeometry {
  const parts = [
    box(2.45, 2.55, 10.5, 0, 1.8, 0, body),
    box(2.48, 0.38, 10.52, 0, 1.35, 0, stripe), box(2.48, 0.12, 10.52, 0, 2.95, 0, stripe),
    box(2.1, 0.12, 10.0, 0, 3.12, 0, 0xdddddd),                         // roof
    box(0.05, 0.05, 8.6, -0.9, 3.35, 0.2, CHROME), box(0.05, 0.05, 8.6, 0.9, 3.35, 0.2, CHROME), // roof rack rails
    box(2.2, 1.0, 0.05, 0, 2.3, -5.26, GLASS), box(2.0, 0.8, 0.05, 0, 2.3, 5.26, GLASS),  // front / rear glass
    box(1.8, 0.3, 0.04, 0, 2.95, -5.27, 0x101418),                      // destination board
    box(2.5, 0.3, 0.3, 0, 0.55, -5.3, CHROME), box(2.5, 0.3, 0.3, 0, 0.55, 5.3, CHROME), // bumpers
    box(1.4, 0.4, 0.05, 0, 1.0, -5.27, 0x202020),                       // grille
    box(0.35, 0.22, 0.05, -0.8, 1.0, -5.28, LIGHT), box(0.35, 0.22, 0.05, 0.8, 1.0, -5.28, LIGHT),
    box(0.35, 0.22, 0.05, -0.8, 1.0, 5.28, TAIL), box(0.35, 0.22, 0.05, 0.8, 1.0, 5.28, TAIL),
    box(0.06, 0.45, 0.3, -1.5, 2.3, -4.9, 0x202020), box(0.06, 0.45, 0.3, 1.5, 2.3, -4.9, 0x202020), // mirrors
    box(0.05, 1.9, 1.1, -1.24, 1.5, -3.6, 0x3a3a3a),                    // door
    arch(-1.0, -3.3, 0.5, 0.35, 0x0f0f10), arch(1.0, -3.3, 0.5, 0.35, 0x0f0f10), arch(-1.0, 2.8, 0.5, 0.35, 0x0f0f10), arch(1.0, 2.8, 0.5, 0.35, 0x0f0f10),
    wheel(-1.0, -3.3, 0.5, 0.3), wheel(1.0, -3.3, 0.5, 0.3), wheel(-1.0, 2.8, 0.5, 0.3), wheel(1.0, 2.8, 0.5, 0.3),
  ];
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) parts.push(box(0.05, 0.9, 1.3, sx * 1.24, 2.3, -4 + i * 1.6, GLASS));
  return mergeGeometries(parts)!;
}
function buildTruck(cab: number, cargo: number): THREE.BufferGeometry {
  const parts = [
    box(2.3, 2.1, 2.2, 0, 1.65, -3.4, cab),
    box(2.0, 0.85, 0.06, 0, 2.15, -4.52, GLASS), box(0.06, 0.7, 0.9, -1.16, 2.1, -3.5, GLASS), box(0.06, 0.7, 0.9, 1.16, 2.1, -3.5, GLASS),
    box(2.4, 0.3, 0.5, 0, 2.85, -3.4, 0xffcc33),                        // cab visor
    box(2.4, 0.5, 7.6, 0, 0.9, 1.4, 0x3a3a3a),                          // chassis
    box(2.4, 1.9, 6.0, 0, 2.1, 1.6, cargo),
    box(2.42, 0.25, 6.02, 0, 2.95, 1.6, 0xffcc33), box(2.42, 0.25, 6.02, 0, 1.3, 1.6, 0x1f9d55),
    box(2.44, 0.12, 6.04, 0, 1.75, 1.6, 0xd8262c), box(2.44, 0.12, 6.04, 0, 2.5, 1.6, 0xd8262c), // painted planks
    box(2.5, 0.3, 0.3, 0, 0.5, -4.55, CHROME),
    box(0.35, 0.2, 0.05, -0.8, 0.85, -4.52, LIGHT), box(0.35, 0.2, 0.05, 0.8, 0.85, -4.52, LIGHT),
    box(0.3, 0.2, 0.05, -0.9, 0.9, 4.62, TAIL), box(0.3, 0.2, 0.05, 0.9, 0.9, 4.62, TAIL),
    box(0.06, 0.5, 0.3, -1.4, 2.2, -4.2, 0x202020), box(0.06, 0.5, 0.3, 1.4, 2.2, -4.2, 0x202020),
    arch(-1.0, -3.0, 0.5, 0.36, 0x0f0f10), arch(1.0, -3.0, 0.5, 0.36, 0x0f0f10),
    box(0.4, 0.08, 1.9, -1.1, 1.08, 2.8, 0x2a2a2a), box(0.4, 0.08, 1.9, 1.1, 1.08, 2.8, 0x2a2a2a), // rear mudguards
    wheel(-1.0, -3.0, 0.5, 0.3), wheel(1.0, -3.0, 0.5, 0.3), wheel(-1.0, 2.2, 0.5, 0.3), wheel(1.0, 2.2, 0.5, 0.3), wheel(-1.0, 3.4, 0.5, 0.3), wheel(1.0, 3.4, 0.5, 0.3),
  ];
  return mergeGeometries(parts)!;
}
function buildAuto(): THREE.BufferGeometry {
  const green = 0x1f8a4a;
  return mergeGeometries([
    box(1.3, 0.55, 2.4, 0, 0.62, 0.2, green),
    colored(new THREE.CylinderGeometry(0.66, 0.66, 1.35, 10, 1, false, Math.PI, Math.PI).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.7, -1.0), green), // rounded nose
    colored(new THREE.CylinderGeometry(1.42, 1.42, 1.42, 10, 1, false, Math.PI * 1.08, Math.PI * 0.84).rotateX(Math.PI / 2).scale(1, 1, 1).translate(0, 0.45, 0.25), 0x111111), // canopy (segment)
    box(1.36, 0.08, 2.6, 0, 1.78, 0.15, 0x111111),
    box(0.06, 0.95, 0.06, -0.62, 1.3, -0.95, 0x202020), box(0.06, 0.95, 0.06, 0.62, 1.3, -0.95, 0x202020),
    box(0.06, 0.95, 0.06, -0.62, 1.3, 1.35, 0x202020), box(0.06, 0.95, 0.06, 0.62, 1.3, 1.35, 0x202020),
    box(1.2, 0.8, 0.05, 0, 1.3, -1.22, GLASS),
    box(1.24, 0.5, 0.05, 0, 1.0, 1.42, 0xffcc33),                        // rear sign panel
    box(0.05, 0.6, 1.0, -0.66, 1.1, 0.5, green), box(0.05, 0.6, 1.0, 0.66, 1.1, 0.5, green), // doors
    colored(new THREE.SphereGeometry(0.11, 7, 6).translate(0, 0.95, -1.38), LIGHT),
    box(0.28, 0.06, 0.5, 0, 0.62, -1.1, green),                         // front mudguard
    wheel(0, -1.1, 0.25, 0.1), wheel(-0.6, 0.9, 0.25, 0.12), wheel(0.6, 0.9, 0.25, 0.12),
  ])!;
}

const SPEC: Record<VType, { count: number; speed: [number, number]; len: number; colors: number[][] }> = {
  car: { count: 14, speed: [55, 85], len: 4.3, colors: [[0xe8e8e8], [0x1b1b1b], [0xb0b8c0], [0x8a1f2a], [0x1f4a8a], [0xd8a020]] },
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

  /** Collision circles of vehicles near route distance s (each vehicle = a row of circles along its length). */
  nearbyCircles(s: number, range: number, out: { x: number; z: number; r: number }[] = []) {
    if (!this.enabled) return out;
    for (const vh of this.vehicles) {
      if (Math.abs(vh.s - s) > range) continue;
      const f = this.road.sample(vh.s);
      const lat = vh.lateral + vh.swerve - vh.dir * this.road.bulge(vh.s);
      const cx = f.x + f.rx * lat, cz = f.z + f.rz * lat;
      const r = vh.type === 'bike' ? 0.45 : vh.type === 'auto' ? 0.7 : 1.15;
      const n = Math.max(1, Math.round(vh.len / (r * 1.6)));
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * (vh.len - r * 2) / Math.max(1, n - 1);
        out.push({ x: cx + f.tx * o, z: cz + f.tz * o, r });
      }
    }
    return out;
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
    const lat = vh.lateral + vh.swerve - vh.dir * this.road.bulge(vh.s);
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
      // target speed: the fastest speed from which we can still slow to the leader's speed
      // within (gap − margin) at a comfortable 4.5 m/s², plus a time headway
      let target = vh.maxSpeed;
      if (gap < Infinity) {
        const margin = 4 + vh.speed * 0.9;
        const room = gap - margin;
        const allowed = room <= 0 ? Math.min(leadSpeed, Math.max(0, gap - 2) * 0.5) : Math.sqrt(leadSpeed * leadSpeed + 2 * 4.5 * room);
        target = Math.min(target, Math.max(0, allowed));
        if (gap < 1.5) target = 0;
      }
      // oncoming swerve when the player sits in their lane
      let swerveT = 0;
      if (playerActive && vh.dir === -1) {
        const d = vh.s - playerS - 5.6 - vh.len / 2; // distance from the oncoming vehicle's nose to the bus front
        const overlap = Math.abs(playerLateral - vh.lateral) < 3.2;
        if (d > -4 && d < 70 && overlap) swerveT = 3.2;
        // brake only while the bus front is still ahead of our nose; once level, roll on past it
        if (d > 0.5 && d < 70 && overlap) {
          const room = d - 6;
          const allowed = room <= 0 ? 0 : Math.sqrt(2 * 4.5 * room);
          target = Math.min(target, Math.max(0, allowed), 9);
          if (d < 2.5) target = 0;
        } else if (d <= 0.5 && d > -vh.len - 12 && overlap) target = Math.min(target, 4); // creeping past the bus
      }
      // an oncoming vehicle that has come to a stop next to / in front of the bus always edges aside
      if (playerActive && vh.dir === -1 && vh.speed < 0.5 && Math.abs(vh.s - playerS) < 14 && Math.abs(vh.lateral + vh.swerve - playerLateral) < 3.5) swerveT = Math.max(swerveT, 3.2);
      // move aside while rolling; a vehicle that had to stop for the bus still edges over slowly
      if (vh.speed > 1.5 || swerveT > 0) vh.swerve += (swerveT - vh.swerve) * Math.min(1, dt * (vh.speed > 1.5 ? 1.5 : 0.5));
      const accel = target > vh.speed ? 2.2 : 7.5;
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
        const r = this.riders[vh.idx]; if (r) { const f = this.road.sample(vh.s); const lat = vh.lateral + vh.swerve - vh.dir * this.road.bulge(vh.s); r.position.set(f.x + f.rx * lat, 0.52, f.z + f.rz * lat); r.root.rotation.y = yaw + Math.PI; }
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
      const plat = pd.lat + Math.sign(pd.lat) * this.road.bulge(pd.s);
      pd.p.position.set(f.x + f.rx * plat, 0, f.z + f.rz * plat);
      pd.p.root.rotation.y = Math.atan2(f.tx, f.tz) + (pd.dir === 1 ? 0 : Math.PI);
      if (pd.p.action !== 'walk') pd.p.setAction('walk');
    }
    void camPos;
  }
}
