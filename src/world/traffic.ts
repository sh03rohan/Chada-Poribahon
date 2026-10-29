import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD, type QualityTier } from '../config.ts';
import type { Road } from './road.ts';
import type { Circle, Contact } from './collision.ts';
import { ROUTE } from '../routes.ts';
import { Person, PeopleManager, VARIANTS, HAWKER_VARIANT, makeVariant } from './people.ts';

/**
 * Ambient traffic + footpath pedestrians.
 * Vehicles are low-poly merged geometries drawn with one InstancedMesh per type; they follow the
 * road spline in both lanes, keep spacing, queue behind the player / blockade, and oncoming
 * traffic swerves onto its shoulder when the player drifts into its lane.
 * Pedestrians reuse the humanoid factory and are recycled around the player.
 */

type VType = 'car' | 'bike' | 'bus' | 'truck' | 'auto' | 'rickshaw' | 'van';
interface Vehicle { type: VType; idx: number; s: number; dir: 1 | -1; speed: number; maxSpeed: number; lateral: number; swerve: number; len: number; overtake: number; cutin: number;
  /** seconds left in the "just got hit" state: brake, pull to the kerb, then resume */
  hitT: number;
  /** night hazard: no working lamps (dark body, no glow) */
  unlit: boolean; }

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

/** Side-profile silhouette (points are [z, y], z<0 = front) extruded across the width → a real
 *  car/bus/truck outline (bonnet, raked windscreen, roof, boot) instead of stacked boxes. */
function profile(pts: [number, number][], width: number, c: number, bevel = 0.05): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  pts.forEach(([z, y], i) => (i === 0 ? sh.moveTo(z, y) : sh.lineTo(z, y)));
  sh.closePath();
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.rotateY(-Math.PI / 2).translate(depth / 2, 0, 0); // shape x → world z, extrusion centred on x = 0
  return colored(g, c);
}

function buildCar(body: number): THREE.BufferGeometry {
  const dark = 0x0f0f10;
  return mergeGeometries([
    // body silhouette: bumper → bonnet → windscreen → roof → rear screen → boot
    profile([[-2.15, 0.34], [-2.15, 0.74], [-2.0, 0.9], [-1.05, 0.98], [-0.55, 1.0], [-0.12, 1.42], [0.78, 1.45], [1.32, 1.1], [2.05, 1.02], [2.15, 0.76], [2.15, 0.34]], 1.74, body),
    // greenhouse: glass band a touch wider than the body so it shows through the sides
    profile([[-0.5, 1.02], [-0.1, 1.4], [0.74, 1.43], [1.24, 1.1], [1.2, 1.02]], 1.8, GLASS, 0),
    box(1.82, 0.42, 0.07, 0, 1.22, 0.32, body),                         // B-pillar
    box(1.8, 0.16, 0.22, 0, 0.44, -2.14, 0x2a2a2a), box(1.8, 0.16, 0.22, 0, 0.44, 2.14, 0x2a2a2a), // bumpers
    box(0.36, 0.15, 0.06, -0.58, 0.8, -2.15, LIGHT), box(0.36, 0.15, 0.06, 0.58, 0.8, -2.15, LIGHT),
    box(0.36, 0.13, 0.06, -0.58, 0.84, 2.15, TAIL), box(0.36, 0.13, 0.06, 0.58, 0.84, 2.15, TAIL),
    box(0.13, 0.08, 0.17, -0.93, 1.1, -0.45, body), box(0.13, 0.08, 0.17, 0.93, 1.1, -0.45, body),  // mirrors
    box(0.7, 0.12, 0.03, 0, 0.68, -2.16, 0x202020),                      // grille
    box(0.9, 0.02, 0.03, 0, 0.98, -2.0, CHROME),                        // bonnet lip
    arch(-0.8, -1.35, 0.33, 0.3, dark), arch(0.8, -1.35, 0.33, 0.3, dark), arch(-0.8, 1.35, 0.33, 0.3, dark), arch(0.8, 1.35, 0.33, 0.3, dark),
    wheel(-0.8, -1.35), wheel(0.8, -1.35), wheel(-0.8, 1.35), wheel(0.8, 1.35),
    hubcap(-0.9, -1.35, 0.33, 0.22), hubcap(0.9, -1.35, 0.33, 0.22), hubcap(-0.9, 1.35, 0.33, 0.22), hubcap(0.9, 1.35, 0.33, 0.22),
  ])!;
}
function buildBike(body: number): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.16, 0.2, 0.9, 0, 0.6, 0.05, 0x202020),                        // frame
    colored(new THREE.SphereGeometry(0.19, 8, 6).scale(1, 0.8, 1.6).translate(0, 0.84, -0.12), body),  // tank
    colored(new THREE.BoxGeometry(0.34, 0.3, 0.42).translate(0, 0.5, -0.05), 0x3a3a3a),               // engine block
    box(0.26, 0.09, 0.55, 0, 0.86, 0.33, 0x111111),                       // seat
    box(0.3, 0.3, 0.3, 0, 1.0, 0.68, body),                                // tail cowl
    box(0.62, 0.04, 0.04, 0, 1.02, -0.5, CHROME), box(0.06, 0.32, 0.06, 0, 0.9, -0.55, 0x202020), // handlebar + stem
    colored(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0.9, -0.66), LIGHT),
    box(0.12, 0.06, 0.05, 0, 0.9, 0.84, TAIL),
    colored(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 6).rotateX(Math.PI / 2 - 0.15).translate(0.16, 0.4, 0.35), CHROME),  // exhaust
    box(0.16, 0.04, 0.5, 0, 0.66, -0.72, body), box(0.16, 0.04, 0.5, 0, 0.66, 0.72, body),       // mudguards
    colored(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6).rotateX(0.5).translate(0.07, 0.6, -0.55), CHROME), // fork
    colored(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6).rotateX(0.5).translate(-0.07, 0.6, -0.55), CHROME),
    wheel(0, -0.72, 0.3, 0.08), wheel(0, 0.72, 0.3, 0.08),
    colored(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 8).rotateZ(Math.PI / 2).translate(0, 0.3, -0.72), 0x8a8e92),
    colored(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 8).rotateZ(Math.PI / 2).translate(0, 0.3, 0.72), 0x8a8e92),
  ])!;
}
function buildBus(body: number, stripe: number): THREE.BufferGeometry {
  const parts = [
    // rounded-front coach silhouette
    profile([[-5.25, 0.45], [-5.25, 2.2], [-5.12, 2.85], [-4.8, 3.15], [5.0, 3.15], [5.25, 2.85], [5.25, 0.45]], 2.45, body, 0.08),
    // continuous window band (pokes out of the body sides and ends → windscreen + rear screen)
    profile([[-5.32, 1.85], [-5.32, 2.78], [5.32, 2.78], [5.32, 1.85]], 2.49, GLASS, 0),
    box(2.5, 0.32, 10.3, 0, 1.45, 0, stripe), box(2.5, 0.1, 10.3, 0, 2.95, 0, stripe),          // livery stripes
    box(2.1, 0.12, 9.8, 0, 3.24, 0, 0xdddddd),                           // roof hump
    box(0.05, 0.05, 8.6, -0.9, 3.42, 0.2, CHROME), box(0.05, 0.05, 8.6, 0.9, 3.42, 0.2, CHROME), // roof rack rails
    box(1.8, 0.3, 0.04, 0, 2.98, -5.3, 0x101418),                        // destination board
    box(2.5, 0.3, 0.3, 0, 0.55, -5.3, CHROME), box(2.5, 0.3, 0.3, 0, 0.55, 5.3, CHROME), // bumpers
    box(1.4, 0.4, 0.05, 0, 1.0, -5.28, 0x202020),                        // grille
    box(0.35, 0.22, 0.05, -0.8, 1.0, -5.29, LIGHT), box(0.35, 0.22, 0.05, 0.8, 1.0, -5.29, LIGHT),
    box(0.35, 0.22, 0.05, -0.8, 1.0, 5.29, TAIL), box(0.35, 0.22, 0.05, 0.8, 1.0, 5.29, TAIL),
    box(0.06, 0.45, 0.3, -1.5, 2.3, -4.9, 0x202020), box(0.06, 0.45, 0.3, 1.5, 2.3, -4.9, 0x202020), // mirrors
    box(0.05, 1.9, 1.1, -1.26, 1.5, -3.6, 0x3a3a3a),                     // door
    arch(-1.0, -3.3, 0.5, 0.35, 0x0f0f10), arch(1.0, -3.3, 0.5, 0.35, 0x0f0f10), arch(-1.0, 2.8, 0.5, 0.35, 0x0f0f10), arch(1.0, 2.8, 0.5, 0.35, 0x0f0f10),
    wheel(-1.0, -3.3, 0.5, 0.3), wheel(1.0, -3.3, 0.5, 0.3), wheel(-1.0, 2.8, 0.5, 0.3), wheel(1.0, 2.8, 0.5, 0.3),
  ];
  for (let i = 0; i < 7; i++) parts.push(box(2.52, 0.95, 0.1, 0, 2.31, -4.0 + i * 1.5, body)); // window pillars
  return mergeGeometries(parts)!;
}
export function buildTruck(cab: number, cargo: number): THREE.BufferGeometry {
  const parts = [
    // cab silhouette with a raked windscreen
    profile([[-4.55, 0.55], [-4.55, 1.5], [-4.45, 1.95], [-4.0, 2.75], [-2.3, 2.75], [-2.3, 0.55]], 2.3, cab, 0.06),
    profile([[-4.5, 1.62], [-4.5, 2.0], [-4.06, 2.78], [-3.35, 2.78], [-3.35, 1.62]], 2.34, GLASS, 0),      // windscreen + side glass
    box(2.36, 1.2, 0.08, 0, 2.2, -3.32, cab),                            // rear cab wall / pillar
    box(2.4, 0.3, 0.6, 0, 2.95, -3.9, 0xffcc33),                         // sun visor
    box(2.4, 0.5, 7.6, 0, 0.9, 1.4, 0x3a3a3a),                           // chassis
    box(2.4, 1.9, 6.0, 0, 2.1, 1.6, cargo),
    box(2.42, 0.25, 6.02, 0, 2.95, 1.6, 0xffcc33), box(2.42, 0.25, 6.02, 0, 1.3, 1.6, 0x1f9d55),
    box(2.44, 0.12, 6.04, 0, 1.75, 1.6, 0xd8262c), box(2.44, 0.12, 6.04, 0, 2.5, 1.6, 0xd8262c), // painted planks
    box(0.08, 1.95, 0.08, -1.22, 2.1, -1.35, 0x6b4a2e), box(0.08, 1.95, 0.08, 1.22, 2.1, -1.35, 0x6b4a2e), // bed stakes
    box(0.08, 1.95, 0.08, -1.22, 2.1, 4.55, 0x6b4a2e), box(0.08, 1.95, 0.08, 1.22, 2.1, 4.55, 0x6b4a2e),
    box(2.5, 0.3, 0.3, 0, 0.5, -4.55, CHROME),
    box(0.35, 0.2, 0.05, -0.8, 0.85, -4.55, LIGHT), box(0.35, 0.2, 0.05, 0.8, 0.85, -4.55, LIGHT),
    box(0.3, 0.2, 0.05, -0.9, 0.9, 4.62, TAIL), box(0.3, 0.2, 0.05, 0.9, 0.9, 4.62, TAIL),
    box(0.06, 0.5, 0.3, -1.4, 2.2, -4.2, 0x202020), box(0.06, 0.5, 0.3, 1.4, 2.2, -4.2, 0x202020),
    arch(-1.0, -3.0, 0.5, 0.36, 0x0f0f10), arch(1.0, -3.0, 0.5, 0.36, 0x0f0f10),
    box(0.4, 0.08, 1.9, -1.1, 1.08, 2.8, 0x2a2a2a), box(0.4, 0.08, 1.9, 1.1, 1.08, 2.8, 0x2a2a2a), // rear mudguards
    wheel(-1.0, -3.0, 0.5, 0.3), wheel(1.0, -3.0, 0.5, 0.3), wheel(-1.0, 2.2, 0.5, 0.3), wheel(1.0, 2.2, 0.5, 0.3), wheel(-1.0, 3.4, 0.5, 0.3), wheel(1.0, 3.4, 0.5, 0.3),
  ];
  return mergeGeometries(parts)!;
}
function buildRickshaw(hood: number): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.9, 0.08, 1.0, 0, 0.72, 0.25, 0x6b4a2e),                       // seat base
    box(0.9, 0.5, 0.1, 0, 0.98, 0.72, hood),                             // seat back
    box(0.3, 0.12, 0.5, 0, 0.84, 0.3, 0x3a2a1a),                          // cushion
    colored(new THREE.CylinderGeometry(0.75, 0.75, 1.0, 10, 1, false, Math.PI, Math.PI).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.1, 0.35), hood), // folding hood
    box(0.06, 0.6, 0.06, -0.42, 1.05, 0.7, 0x202020), box(0.06, 0.6, 0.06, 0.42, 1.05, 0.7, 0x202020),
    box(0.1, 0.06, 1.4, 0, 0.55, -0.3, 0x202020),                        // frame
    box(0.5, 0.04, 0.04, 0, 0.95, -0.95, CHROME),                        // handlebar
    box(0.25, 0.06, 0.3, 0, 0.9, -0.55, 0x111111),                        // saddle
    wheel(0, -0.95, 0.33, 0.05), wheel(-0.48, 0.45, 0.33, 0.05), wheel(0.48, 0.45, 0.33, 0.05),
  ])!;
}
function buildVan(): THREE.BufferGeometry {
  return mergeGeometries([
    box(1.2, 0.06, 2.0, 0, 0.62, 0.3, 0x8a6a3a),                         // flat bed
    box(1.2, 0.3, 0.05, 0, 0.8, 1.3, 0x8a6a3a),
    box(0.9, 0.5, 1.2, 0, 0.9, 0.4, 0xc9b58a),                           // sacks
    box(0.1, 0.06, 1.2, 0, 0.5, -0.9, 0x202020), box(0.5, 0.04, 0.04, 0, 0.95, -1.4, CHROME), box(0.25, 0.06, 0.3, 0, 0.88, -1.0, 0x111111),
    wheel(0, -1.4, 0.33, 0.05), wheel(-0.55, 0.9, 0.33, 0.05), wheel(0.55, 0.9, 0.33, 0.05),
  ])!;
}
function buildAuto(): THREE.BufferGeometry {
  const green = 0x1f8a4a;
  return mergeGeometries([
    // lower tub with a rounded nose
    profile([[-1.4, 0.3], [-1.4, 0.7], [-1.3, 0.95], [-1.05, 1.1], [1.38, 1.0], [1.42, 0.3]], 1.3, green, 0.06),
    box(1.36, 0.08, 2.5, 0, 1.8, 0.12, 0x111111),                        // canopy roof
    colored(new THREE.BoxGeometry(1.22, 0.74, 0.05).rotateX(0.32).translate(0, 1.45, -1.05), GLASS), // raked windscreen
    box(0.06, 0.75, 0.06, -0.62, 1.42, -0.92, 0x202020), box(0.06, 0.75, 0.06, 0.62, 1.42, -0.92, 0x202020),
    box(0.06, 0.8, 0.06, -0.62, 1.4, 1.3, 0x202020), box(0.06, 0.8, 0.06, 0.62, 1.4, 1.3, 0x202020),
    box(1.3, 0.72, 0.05, 0, 1.4, 1.36, 0x111111),                        // closed rear
    box(1.1, 0.4, 0.04, 0, 1.0, 1.42, 0xffcc33),                         // rear sign panel
    box(0.05, 0.5, 0.9, -0.66, 1.3, 0.35, green), box(0.05, 0.5, 0.9, 0.66, 1.3, 0.35, green), // half doors
    colored(new THREE.SphereGeometry(0.11, 7, 6).translate(0, 0.95, -1.42), LIGHT),
    box(0.3, 0.06, 0.55, 0, 0.62, -1.1, green),                          // front mudguard
    wheel(0, -1.1, 0.25, 0.1), wheel(-0.6, 0.9, 0.25, 0.12), wheel(0.6, 0.9, 0.25, 0.12),
  ])!;
}

const SPEC: Record<VType, { count: number; speed: [number, number]; len: number; width: number; mass: number; colors: number[][] }> = {
  car: { count: 14, speed: [55, 85], len: 4.3, width: 1.8, mass: 1300, colors: [[0xe8e8e8], [0x1b1b1b], [0xb0b8c0], [0x8a1f2a], [0x1f4a8a], [0xd8a020]] },
  bike: { count: 10, speed: [45, 75], len: 1.6, width: 0.8, mass: 220, colors: [[0xd8262c], [0x1b1b1b], [0x1f6fb5]] },
  bus: { count: 5, speed: [55, 75], len: 10.5, width: 2.5, mass: 11000, colors: [[0xf2e2b0, 0x1f6fb5], [0xd8e8d0, 0xd8262c], [0xffffff, 0x1f9d55]] },
  truck: { count: 6, speed: [40, 60], len: 8.4, width: 2.4, mass: 14000, colors: [[0x2a5a9a, 0xc8a050], [0xd8262c, 0x3a7a3a], [0x1f9d55, 0xa04040]] },
  auto: { count: 9, speed: [35, 50], len: 2.8, width: 1.3, mass: 450, colors: [[0x1f8a4a]] },
  rickshaw: { count: 10, speed: [12, 18], len: 2.2, width: 1.0, mass: 160, colors: [[0x2a7fcf], [0xd8262c], [0x1f9d55]] },
  van: { count: 5, speed: [12, 16], len: 2.8, width: 1.2, mass: 260, colors: [[0x8a6a3a]] },
};

export class Traffic {
  readonly group = new THREE.Group();
  readonly vehicles: Vehicle[] = []; // public for tests/probes
  private meshes: Record<VType, THREE.InstancedMesh[]> = { car: [], bike: [], bus: [], truck: [], auto: [], rickshaw: [], van: [] };
  private slots: Record<VType, { mesh: number; idx: number }[]> = { car: [], bike: [], bus: [], truck: [], auto: [], rickshaw: [], van: [] };
  private riders: Person[] = [];
  private riderOf = new Map<Vehicle, Person>();
  private peds: { p: Person; s: number; dir: 1 | -1; lat: number }[] = [];
  private hawkers: Person[] = [];
  private density: number;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(1, 1, 1);
  /** set by the game: barrier s (Infinity when clear) */
  barrierS = Infinity;
  /** set by the game: a blocked travel lane (accident) — same-direction vehicles queue behind it */
  laneBarrierS = Infinity;
  /** set by the game: stop lines of signals currently red/amber — same-direction vehicles stop there */
  stopLines: number[] = [];
  /** last collision info for the game loop */
  collisionS = Infinity;
  /** night: lamps glow on lit vehicles, unlit ones go dark; set by the game */
  night = false;
  /** the bus is running its high beam: oncoming lit vehicles flash back */
  highBeam = false;
  private lampHead!: THREE.InstancedMesh; private lampTail!: THREE.InstancedMesh; private flashT = 0;
  private lampM = new THREE.Matrix4(); private zero = new THREE.Matrix4().makeScale(0, 0, 0); private playerS = 0;
  get unlitCount() { return this.vehicles.filter((v) => v.unlit).length; }
  setNight(on: boolean) {
    this.night = on;
    for (const vh of this.vehicles) {
      const slot = this.slots[vh.type][vh.idx]; const mesh = this.meshes[vh.type][slot.mesh];
      mesh.setColorAt(slot.idx, new THREE.Color(on && vh.unlit ? 0x2c2a28 : 0xffffff)); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.lampHead.visible = this.lampTail.visible = on;
  }
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
        const geo = type === 'car' ? buildCar(c[0]) : type === 'bike' ? buildBike(c[0]) : type === 'bus' ? buildBus(c[0], c[1]) : type === 'truck' ? buildTruck(c[0], c[1]) : type === 'rickshaw' ? buildRickshaw(c[0]) : type === 'van' ? buildVan() : buildAuto();
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
        const slow = type === 'rickshaw' || type === 'van';
        const unlit = (type === 'truck' || type === 'van' || type === 'rickshaw' || type === 'auto') && Math.random() < 0.3;
        this.vehicles.push({ type, idx: i, s: s0, dir, speed: maxSpeed, maxSpeed, lateral: -dir * (slow ? LANE + 1.3 : LANE), swerve: 0, len: sp.len, overtake: 0, cutin: 0, hitT: 0, unlit });
      }
    }
    // Lamps: one glowing quad per headlight / tail light, placed every frame (night only)
    const n = this.vehicles.length * 2;
    this.lampHead = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff3c8, toneMapped: false }), n);
    this.lampTail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }), n);
    this.lampHead.frustumCulled = this.lampTail.frustumCulled = false; this.lampHead.visible = this.lampTail.visible = false;
    this.group.add(this.lampHead, this.lampTail);
    // Bike riders (humanoids in a riding pose), one per bike
    for (const vh of this.vehicles) if (vh.type === 'bike' || vh.type === 'rickshaw' || vh.type === 'van') {
      const p = new Person(VARIANTS[(vh.idx * 3 + 1) % VARIANTS.length]); p.setAction('ride'); p.mesh.castShadow = false;
      this.group.add(p.root); people.add(p); this.riders.push(p); this.riderOf.set(vh, p);
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
    const hawkSpots = ROUTE.hawkerSpots;
    hawkSpots.forEach((s, i) => {
      const p = new Person(i % 2 ? HAWKER_VARIANT : makeVariant({ id: 'hawker2', outfit: 'lungi-shirt', top: '#f2e2b0', bottom: '#2a4a2a', hair: 'cap', accent: '#d8262c', prop: 'basket', height: 1.68 }));
      const side = i % 2 ? -1 : 1;
      const f = road.sample(s); const lat = side * (WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.8);
      p.position.set(f.x + f.rx * lat, road.footpathHeight(s), f.z + f.rz * lat); p.lookAt(f.x, f.z); p.setAction('hawk');
      this.group.add(p.root); people.add(p); this.hawkers.push(p);
    });
  }

  /** Collision circles of vehicles near route distance s (each vehicle = a row of circles along its length). */
  nearbyCircles(s: number, range: number, out: Circle[] = []) {
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
        out.push({ x: cx + f.tx * o, z: cz + f.tz * o, r, mass: SPEC[vh.type].mass, tag: vh, vx: f.tx * vh.speed * vh.dir, vz: f.tz * vh.speed * vh.dir });
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

  /** Momentum handed over by the bus this step (from resolveBusCollisions): shove the vehicle, then it
   *  brakes, pulls to the kerb and waits a few seconds before rejoining the flow. */
  applyContacts(contacts: Contact[]) {
    for (const c of contacts) {
      const vh = c.circle.tag as Vehicle | undefined;
      if (!vh || !this.enabled) continue;
      const f = this.road.sample(vh.s);
      // world push direction is -n; split into along-road (s) and lateral components
      const along = -(c.nx * f.tx + c.nz * f.tz), lat = -(c.nx * f.rx + c.nz * f.rz);
      vh.s += along * c.push; vh.swerve += lat * c.push;
      if (c.dv > 0.05) {
        vh.speed += along * c.dv * vh.dir;                 // speed is signed along the vehicle's own direction
        vh.swerve += lat * c.dv * 0.12;
        vh.hitT = Math.max(vh.hitT, 2.5 + Math.min(6, c.dv * 0.6));
        vh.overtake = 0; vh.cutin = 2;
      }
      vh.swerve = THREE.MathUtils.clamp(vh.swerve, -3.5, 3.5);
    }
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
    if (this.night) {
      const k = this.vehicles.indexOf(vh) * 2;
      if (vh.unlit) { this.lampHead.setMatrixAt(k, this.zero); this.lampHead.setMatrixAt(k + 1, this.zero); this.lampTail.setMatrixAt(k, this.zero); this.lampTail.setMatrixAt(k + 1, this.zero); }
      else {
        const half = vh.type === 'bike' || vh.type === 'rickshaw' ? 0 : SPEC[vh.type].width / 2 - 0.25;
        const hy = vh.type === 'truck' || vh.type === 'bus' ? 1.0 : 0.7, front = -vh.len / 2 + 0.05, back = vh.len / 2 - 0.05;
        // oncoming lit vehicles flash their lamps when the bus runs its high beam
        const flash = this.highBeam && vh.dir === -1 && vh.s > this.playerS && vh.s - this.playerS < 90 ? (Math.sin(this.flashT * 18) > 0 ? 2.6 : 1) : 1;
        for (const [i, x] of [[0, -half], [1, half]] as [number, number][]) {
          this.lampM.compose(this.v.clone().add(new THREE.Vector3(x, hy, front).applyQuaternion(this.q)), this.q, new THREE.Vector3(flash, flash, 1)); this.lampHead.setMatrixAt(k + i, this.lampM);
          this.lampM.compose(this.v.clone().add(new THREE.Vector3(x, hy, back).applyQuaternion(this.q)), this.q, new THREE.Vector3(1, 1, 1)); this.lampTail.setMatrixAt(k + i, this.lampM);
        }
      }
    }
    return yaw;
  }

  update(dt: number, playerS: number, playerLateral: number, playerSpeed: number, camPos: THREE.Vector3, playerActive: boolean) {
    this.playerS = playerS; this.flashT += dt;
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
      let target = vh.maxSpeed;
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
      // overtaking: a clearly faster vehicle stuck behind a slow one (or the slow bus) moves into the
      // oncoming lane when nothing oncoming is within 140 m, then returns once past
      const slowLead = gap < 18 && leadSpeed < vh.maxSpeed * 0.6 && vh.type !== 'rickshaw' && vh.type !== 'van' && vh.type !== 'truck';
      if (vh.overtake === 0 && slowLead) {
        let clear = true;
        for (const o of vs) { if (o.dir === vh.dir) continue; const dd = (o.s - vh.s) * vh.dir; if (dd > -10 && dd < 140) { clear = false; break; } }
        // never pull out toward the bus: same direction with the bus ahead on the centre line, or
        // oncoming with the bus anywhere in the next 160 m
        if (playerActive && vh.dir === 1 && playerS > vh.s && playerS - vh.s < 150 && playerLateral > -0.5) clear = false;
        if (playerActive && vh.dir === -1 && vh.s - playerS > -20 && vh.s - playerS < 160) clear = false;
        if (clear) vh.overtake = 1;
      }
      if (vh.overtake === 1) {
        // in the overtaking lane: ignore the leader, go a bit faster, come back when past it by 15 m
        gap = Infinity; target = Math.min(vh.maxSpeed * 1.15, vh.maxSpeed + 4);
        let passed = true;
        for (let j = 1; j < vs.length; j++) { const o = vs[(i - j * vh.dir + vs.length * 4) % vs.length]; if (o.dir !== vh.dir) continue; let dd = (vh.s - o.s) * vh.dir; if (dd < 0) dd += L; if (dd < 15 + o.len && dd > -2) passed = false; break; }
        if (playerActive && vh.dir === 1 && Math.abs(vh.s - playerS) < 16) passed = false;
        let oncoming = false; for (const o of vs) { if (o.dir === vh.dir) continue; const dd = (o.s - vh.s) * vh.dir; if (dd > -5 && dd < 60) oncoming = true; }
        if (passed || oncoming) vh.overtake = 0;
      }
      const laneTarget = vh.overtake === 1 ? vh.dir * (LANE + 0.3) : vh.lateral; // oncoming lane = +LANE for dir 1
      // CNG cut-in: an auto parked on the shoulder ahead of the bus pulls out into the lane
      if (vh.type === 'auto' && vh.cutin === 0 && vh.dir === 1 && playerActive && playerSpeed > 8) {
        const dd = vh.s - playerS;
        if (dd > 35 && dd < 60 && Math.random() < dt * 0.05) { vh.cutin = 1; vh.swerve = -2.6; vh.speed = 2; }
      }
      if (vh.cutin === 1) { vh.swerve += (0 - vh.swerve) * Math.min(1, dt * 0.9); if (Math.abs(vh.swerve) < 0.1) vh.cutin = 2; }
      // barrier (blockade) ahead
      const toBarrier = (this.barrierS - vh.s) * vh.dir - vh.len / 2 - 3;
      if (this.barrierS !== Infinity && toBarrier > -5 && toBarrier < gap) { gap = toBarrier; leadSpeed = 0; }
      if (vh.dir === 1 && this.laneBarrierS !== Infinity && vh.overtake === 0) { const tb = this.laneBarrierS - vh.s - vh.len / 2 - 4; if (tb > -5 && tb < gap) { gap = tb; leadSpeed = 0; } }
      if (vh.dir === 1) for (const ls of this.stopLines) { const tb = ls - vh.s - vh.len / 2 - 1.5; if (tb > -3 && tb < gap) { gap = tb; leadSpeed = 0; } }
      // target speed: the fastest speed from which we can still slow to the leader's speed
      // within (gap − margin) at a comfortable 4.5 m/s², plus a time headway
      target = Math.min(target, vh.maxSpeed);
      if (gap < Infinity) {
        const margin = 4 + vh.speed * 0.9;
        const room = gap - margin;
        const allowed = room <= 0 ? Math.min(leadSpeed, Math.max(0, gap - 2) * 0.5) : Math.sqrt(leadSpeed * leadSpeed + 2 * 4.5 * room);
        target = Math.min(target, Math.max(0, allowed));
        if (gap < 1.5) target = 0;
      }
      // ---- oncoming traffic when the bus is in their lane ------------------------------------
      // They do NOT scatter: if there is room between the bus and their kerb they squeeze past
      // slowly along the edge; otherwise they brake and wait in line (each one behind the one
      // ahead, via the normal car-following above) until the bus leaves the lane.
      let swerveT = 0; let hardBrake = false;
      if (playerActive && vh.dir === -1 && vh.overtake === 0 && vh.hitT <= 0) {
        const halfW = SPEC[vh.type].width / 2;
        const d = vh.s - playerS - 5.6 - vh.len / 2;                         // their nose → bus front
        const inLane = Math.abs(playerLateral - vh.lateral) < 1.25 + halfW + 0.35;
        if (inLane && d > -vh.len - 6 && d < 90) {
          const edge = WORLD.roadWidth / 2 + WORLD.shoulderWidth * 0.85 + this.road.bulge(vh.s);
          const free = edge - (playerLateral + 1.25);                        // room between the bus and their kerb
          if (free >= SPEC[vh.type].width + 0.5 && playerSpeed < 6) {
            // squeeze past along the kerb at walking pace
            swerveT = (edge - halfW - 0.2) - vh.lateral;
            if (d < 45) target = Math.min(target, 3.5);
          } else {
            // queue: the bus is a stopped lead vehicle; brake hard if it is closing fast
            if (d < gap) { gap = d; leadSpeed = 0; }
            if (playerSpeed > 6 && d < 60) hardBrake = true;
            if (d < 3) target = 0;
          }
        }
      }
      // re-apply the following rule with the (possibly) updated gap
      if (gap < Infinity) {
        const margin = 4 + vh.speed * 0.9;
        const room = gap - margin;
        const allowed = room <= 0 ? Math.min(leadSpeed, Math.max(0, gap - 2) * 0.5) : Math.sqrt(leadSpeed * leadSpeed + 2 * (hardBrake ? 7 : 4.5) * room);
        target = Math.min(target, Math.max(0, allowed));
        if (gap < 1.5) target = 0;
      }
      // just hit by the bus: brake, pull toward the kerb, sit for a moment, then rejoin
      if (vh.hitT > 0) {
        vh.hitT -= dt; target = 0;
        const edge = WORLD.roadWidth / 2 + WORLD.shoulderWidth + this.road.bulge(vh.s);
        swerveT = (-vh.dir * (edge - SPEC[vh.type].width / 2 - 0.05)) - vh.lateral;   // fully onto the shoulder
      }
      if (swerveT !== 0 && vh.overtake === 0 && vh.cutin !== 1) vh.swerve += (swerveT - vh.swerve) * Math.min(1, dt * (vh.hitT > 0 ? 0.8 : 1.2));
      else if (vh.cutin !== 1) vh.swerve += ((laneTarget - vh.lateral) - vh.swerve) * Math.min(1, dt * 1.6) * (vh.overtake === 1 || Math.abs(vh.swerve) > 0.05 ? 1 : 0); // back to the lane centre
      const accel = target > vh.speed ? (vh.speed < 0 ? 6 : 2.2) : (hardBrake || vh.hitT > 0 ? 9 : 7.5);
      vh.speed += THREE.MathUtils.clamp(target - vh.speed, -accel * dt, accel * dt);
      vh.s += vh.speed * vh.dir * dt;
      if (vh.s > L - 20) { vh.s -= L - 40; } else if (vh.s < 20) { vh.s += L - 40; }
      // keep traffic around the player: anything far away is recycled into a window ahead/behind
      if (playerActive && Math.abs(vh.s - playerS) > 650) {
        vh.s = vh.dir === 1 ? (Math.random() < 0.5 ? playerS - 120 - Math.random() * 60 : playerS + 150 + Math.random() * 200) : playerS + 250 + Math.random() * 350;
        vh.s = Math.max(30, Math.min(L - 30, vh.s)); vh.speed = vh.maxSpeed;
      }
      const yaw = this.place(vh);
      const rider = this.riderOf.get(vh);
      if (rider) { const f = this.road.sample(vh.s); const lat = vh.lateral + vh.swerve - vh.dir * this.road.bulge(vh.s); const back = vh.type === 'rickshaw' ? -0.55 : vh.type === 'van' ? -1.0 : 0; rider.position.set(f.x + f.rx * lat + f.tx * back * vh.dir, vh.type === 'bike' ? 0.52 : 0.62, f.z + f.rz * lat + f.tz * back * vh.dir); rider.root.rotation.y = yaw + Math.PI; }
    }
    for (const type of Object.keys(this.meshes) as VType[]) for (const mesh of this.meshes[type]) mesh.instanceMatrix.needsUpdate = true;
    if (this.night) { this.lampHead.instanceMatrix.needsUpdate = true; this.lampTail.instanceMatrix.needsUpdate = true; }

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
      pd.p.position.set(f.x + f.rx * plat, this.road.footpathHeight(pd.s), f.z + f.rz * plat);
      pd.p.root.rotation.y = Math.atan2(f.tx, f.tz) + (pd.dir === 1 ? 0 : Math.PI);
      if (pd.p.action !== 'walk') pd.p.setAction('walk');
    }
    void camPos;
  }
}
