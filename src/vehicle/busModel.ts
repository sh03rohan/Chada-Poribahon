import * as THREE from 'three';
import { mergeStaticMeshes } from './mergeStatic.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUS_DIMENSIONS, PHYSICS } from '../config.ts';
import { Person, DRIVER_VARIANT, HELPER_VARIANT, VARIANTS, type PeopleManager, type Action } from '../world/people.ts';
import { makeSideLivery, makeRearBoard, makeDestinationBoard, makeFrontStrip, makeTyreTread, makeBlobShadow, Speedometer, PALETTE } from './livery.ts';

/**
 * Common rig interface shared by the procedural bus and a GLB-loaded bus.
 * Hierarchy: root (position + yaw) → body (roll / pitch / heave) → everything that leans.
 * Wheels hang off root so they stay on the tarmac while the body rolls.
 */
export interface BusRig {
  root: THREE.Group;
  body: THREE.Group;
  wheelSpin: THREE.Object3D[];      // FL FR RL RR spin nodes (rotate about local X)
  wheelSteer: THREE.Object3D[];     // FL FR yaw nodes
  steeringWheel: THREE.Object3D | null;
  door: THREE.Object3D | null;
  headlights: THREE.SpotLight[];
  setLights(opts: { headlights: boolean; brake: number; reverse: boolean }): void;
  setWipers(phase: number | null): void;
  setPassengers(n: number): void;
  setCockpitMode(on: boolean): void;
  updateSpeedo(kmh: number, rpm: number, gear: number): void;
  setDoor(open: number): void;
  /** Per-frame: steering + idle animation of the driver's arms (hands glued to the wheel by IK). */
  updateDriver(steerAngle: number, dt: number, horn: boolean, swerving: boolean): void;
  driver: Person | null;
  helper: Person | null;
  riders: Person[];
  /** damage visuals 0..1: bent bumper, dead left lamp (garage repairs it); optional on GLB rigs */
  setDamage?(level: number): void;
  /** high beam: longer, brighter headlight cones (night hazards) */
  setHighBeam?(on: boolean): void;
  /** engine smoke sprites (animated by the damage model) */
  smoke?: THREE.Sprite[];
  /** repaint the side livery + paint colour (garage); optional on GLB rigs */
  setLivery?(main: string, dark: string): void;
  /** live rear-view mirror (render target texture); optional on GLB rigs */
  setMirrorTexture?(tex: THREE.Texture): void;
  setPassengerPose(a: Action): void;
  /** cinematic: pull a hand off the wheel to a world point (null = back on the wheel) */
  setDriverHandTarget(side: 'L' | 'R', worldPoint: THREE.Vector3 | null): void;
  isProcedural: boolean;
}

type Tag = 'body' | 'glass' | 'under';
interface ProfilePt { u: number; y: number; tag: Tag; }

export type BusDims = typeof BUS_DIMENSIONS;
let D: BusDims = BUS_DIMENSIONS;
let L = D.length, W = D.width, HALF = L / 2;
let U_FRONT = HALF, U_REAR = -HALF + 0.3; // u = -z (positive toward the front)
/** Choose the body dimensions for the next createProceduralBus() (the minibus is shorter and narrower). */
export function setBusDims(d: BusDims) { D = d; L = D.length; W = D.width; HALF = L / 2; U_FRONT = HALF; U_REAR = -HALF + 0.3; }
const CORNER_R = 0.17;
const WIN_Y0 = 1.78, WIN_Y1 = 2.82;
const DASH_TOP = 1.72;

/** Side profile in (u, y). Tags apply to the segment ENDING at that point. CCW loop. */
function buildProfile(): ProfilePt[] {
  const pts: ProfilePt[] = [];
  const line = (u: number, y: number, tag: Tag) => pts.push({ u, y, tag });
  const curve = (cx: number, cy: number, x: number, y: number, tag: Tag, n = 6) => {
    const p0 = pts[pts.length - 1];
    for (let i = 1; i <= n; i++) {
      const t = i / n, a = 1 - t;
      pts.push({ u: a * a * p0.u + 2 * a * t * cx + t * t * x, y: a * a * p0.y + 2 * a * t * cy + t * t * y, tag });
    }
  };
  line(U_REAR + 0.3, D.skirtHeight, 'under');          // start: bottom rear (after corner)
  line(U_FRONT - 0.35, D.skirtHeight, 'under');        // bottom edge
  curve(U_FRONT, D.skirtHeight, U_FRONT, D.skirtHeight + 0.4, 'body');  // front lower corner
  line(U_FRONT, DASH_TOP, 'body');                     // grille / bumper face
  line(U_FRONT - 0.22, 2.98, 'glass');                 // windshield (slight rake)
  curve(U_FRONT - 0.4, D.height, U_FRONT - 0.75, D.height, 'body');   // roof front corner
  line(U_REAR + 0.45, D.height, 'body');               // roof
  curve(U_REAR, D.height, U_REAR, D.height - 0.45, 'body');          // rear top corner
  line(U_REAR, 1.95, 'glass');                         // rear window
  line(U_REAR, D.skirtHeight + 0.35, 'body');          // rear lower
  curve(U_REAR, D.skirtHeight, U_REAR + 0.3, D.skirtHeight, 'body');  // rear bottom corner → back to start
  return pts;
}

function profileNormals(p: ProfilePt[]): { nx: number; ny: number }[] {
  const n = p.length;
  const out: { nx: number; ny: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    let tx = b.u - a.u, ty = b.y - a.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    out.push({ nx: ty, ny: -tx }); // outward for a CCW loop
  }
  return out;
}

/** Cross-section across the bus width with rounded corners. Returns [x, inward][] */
function crossSection(): [number, number][] {
  const r = CORNER_R, hw = W / 2, pts: [number, number][] = [];
  const n = 4;
  for (let i = n; i >= 0; i--) { const a = (i / n) * Math.PI / 2; pts.push([-(hw - r) - r * Math.sin(a), r - r * Math.cos(a)]); }
  for (let i = 1; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push([(hw - r) + r * Math.sin(a), r - r * Math.cos(a)]); }
  return pts;
}

/** Build the swept shell for all runs of segments with the given tag. */
function sweep(profile: ProfilePt[], tag: Tag, inset = 0): THREE.BufferGeometry {
  const nrm = profileNormals(profile);
  const cs = crossSection();
  const K = cs.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = profile.length;
  // find runs: segment i goes from point i to point (i+1)%n and has tag profile[(i+1)%n].tag
  let i = 0;
  // start at a segment boundary where tag changes, so runs don't wrap awkwardly
  let start = 0;
  for (let k = 0; k < n; k++) if (profile[(k + 1) % n].tag !== profile[k].tag) { start = k; break; }
  i = 0;
  while (i < n) {
    const segIdx = (start + i) % n;
    const segTag = profile[(segIdx + 1) % n].tag;
    if (segTag !== tag) { i++; continue; }
    // run from segIdx while tag matches
    let len = 0;
    while (len < n && profile[(segIdx + len + 1) % n].tag === tag) len++;
    const rowBase = pos.length / 3;
    let along = 0;
    for (let r = 0; r <= len; r++) {
      const pi = (segIdx + r) % n;
      const p = profile[pi], nn = nrm[pi];
      if (r > 0) { const q = profile[(segIdx + r - 1) % n]; along += Math.hypot(p.u - q.u, p.y - q.y); }
      for (let c = 0; c < K; c++) {
        const [x, inward] = cs[c];
        const d = inward + inset;
        pos.push(x, p.y - nn.ny * d, -(p.u - nn.nx * d));
        uv.push(c / (K - 1), along / 3);
      }
    }
    for (let r = 0; r < len; r++) for (let c = 0; c < K - 1; c++) {
      const a = rowBase + r * K + c, b = a + K;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    i += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface WindowRect { u0: number; u1: number; y0: number; y1: number; }

function sideWindows(): WindowRect[] {
  const wins: WindowRect[] = [{ u0: 3.35, u1: 5.05, y0: WIN_Y0, y1: 2.88 }]; // driver / door window
  const w = 1.45, gap = 0.2;
  let u1 = 3.35 - gap;
  while (u1 - w > U_REAR + 0.45) { wins.push({ u0: u1 - w, u1, y0: WIN_Y0, y1: WIN_Y1 }); u1 -= w + gap; } // as many bays as the body is long
  return wins;
}

function roundedRectPath(u0: number, u1: number, y0: number, y1: number, r: number, mirror: boolean): THREE.Path {
  const p = new THREE.Path();
  const m = (u: number) => (mirror ? -u : u);
  const a = mirror ? u1 : u0, b = mirror ? u0 : u1;
  const x0 = m(a), x1 = m(b);
  p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.quadraticCurveTo(x1, y0, x1, y0 + r);
  p.lineTo(x1, y1 - r); p.quadraticCurveTo(x1, y1, x1 - r, y1);
  p.lineTo(x0 + r, y1); p.quadraticCurveTo(x0, y1, x0, y1 - r);
  p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0);
  return p;
}

/** Side panel: the profile inset by the corner radius, with window holes and wheel arches. */
function sidePanelShape(profile: ProfilePt[], mirror: boolean): THREE.Shape {
  const nrm = profileNormals(profile);
  const inset = profile.map((p, i) => ({ u: p.u - nrm[i].nx * CORNER_R, y: p.y - nrm[i].ny * CORNER_R }));
  const m = (u: number) => (mirror ? -u : u);
  const shape = new THREE.Shape();
  const arches = [PHYSICS.lf, -PHYSICS.lr].map((u) => ({ u, r: 0.66 }));
  const yb = D.skirtHeight + CORNER_R;
  const pts: [number, number][] = [];
  for (let i = 0; i < inset.length; i++) {
    const p = inset[i], q = inset[(i + 1) % inset.length];
    pts.push([p.u, p.y]);
    // bottom edge: insert wheel arches (edge runs toward +u)
    if (Math.abs(p.y - yb) < 0.02 && Math.abs(q.y - yb) < 0.02 && q.u > p.u) {
      for (const a of arches) {
        if (a.u - a.r > p.u && a.u + a.r < q.u) {
          for (let k = 0; k <= 10; k++) { const t = Math.PI - (k / 10) * Math.PI; pts.push([a.u + Math.cos(t) * a.r, yb + Math.sin(t) * a.r]); }
        }
      }
    }
  }
  // mirrored shape must keep CCW winding: reverse the order when mirroring
  const ordered = mirror ? pts.slice().reverse() : pts;
  ordered.forEach(([u, y], i) => (i === 0 ? shape.moveTo(m(u), y) : shape.lineTo(m(u), y)));
  shape.closePath();
  for (const w of sideWindows()) {
    const hole = roundedRectPath(w.u0, w.u1, w.y0, w.y1, 0.09, mirror);
    shape.holes.push(hole);
  }
  return shape;
}

export function createProceduralBus(opts: { anisotropy: number; shadows: boolean; people?: PeopleManager; dims?: BusDims }): BusRig {
  setBusDims(opts.dims ?? BUS_DIMENSIONS);
  const root = new THREE.Group(); root.name = 'bus';
  const body = new THREE.Group(); body.name = 'body';
  root.add(body);
  const profile = buildProfile();
  const cast = (m: THREE.Mesh) => { m.castShadow = opts.shadows; m.receiveShadow = opts.shadows; return m; };

  // ---- Materials ---------------------------------------------------------------
  const paint = new THREE.MeshPhysicalMaterial({ color: PALETTE.red, roughness: 0.42, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const roofPaint = new THREE.MeshPhysicalMaterial({ color: PALETTE.cream, roughness: 0.5, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const under = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.95 });
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.9, side: THREE.BackSide });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xaacbe0, transparent: true, opacity: 0.18, roughness: 0.04, metalness: 0.0,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.05,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.25, metalness: 0.9 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.95 });

  // ---- Shell (sweep) -----------------------------------------------------------
  const bodyGeo = sweep(profile, 'body');
  const bodyMesh = cast(new THREE.Mesh(bodyGeo, roofPaint)); bodyMesh.name = 'shell';
  body.add(bodyMesh);
  const bodyInner = new THREE.Mesh(bodyGeo, interiorMat); body.add(bodyInner);
  const underMesh = new THREE.Mesh(sweep(profile, 'under'), under); body.add(underMesh);
  const underInner = new THREE.Mesh(underMesh.geometry, new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1, side: THREE.BackSide })); body.add(underInner);
  const glassSweep = new THREE.Mesh(sweep(profile, 'glass', 0.01), glass); glassSweep.renderOrder = 10; glassSweep.name = 'windshield';
  body.add(glassSweep);

  // ---- Side panels with livery -------------------------------------------------
  const layout = { uMin: U_REAR, uMax: U_FRONT, yMin: D.skirtHeight, yMax: D.height, winY0: WIN_Y0, winY1: WIN_Y1 };
  const liveryTex = makeSideLivery(layout, opts.anisotropy);
  const Lu = layout.uMax - layout.uMin, Ly = layout.yMax - layout.yMin;
  const texR = liveryTex; texR.repeat.set(1 / Lu, 1 / Ly); texR.offset.set(-layout.uMin / Lu, -layout.yMin / Ly);
  const texL = liveryTex.clone(); texL.repeat.set(1 / Lu, 1 / Ly); texL.offset.set(layout.uMax / Lu, -layout.yMin / Ly); texL.needsUpdate = true;
  const sideMatR = new THREE.MeshPhysicalMaterial({ map: texR, roughness: 0.45, metalness: 0.08, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const sideMatL = sideMatR.clone(); sideMatL.map = texL;
  const shapeR = sidePanelShape(profile, false), shapeL = sidePanelShape(profile, true);
  const panelR = cast(new THREE.Mesh(new THREE.ShapeGeometry(shapeR, 8), sideMatR));
  panelR.rotation.y = Math.PI / 2; panelR.position.x = W / 2; panelR.name = 'panelR';
  const panelL = cast(new THREE.Mesh(new THREE.ShapeGeometry(shapeL, 8), sideMatL));
  panelL.rotation.y = -Math.PI / 2; panelL.position.x = -W / 2; panelL.name = 'panelL';
  body.add(panelR, panelL);
  // interior lining of the side walls (back faces)
  const liningR = new THREE.Mesh(panelR.geometry, interiorMat); liningR.rotation.y = Math.PI / 2; liningR.position.x = W / 2 - 0.05;
  const liningL = new THREE.Mesh(panelL.geometry, interiorMat); liningL.rotation.y = -Math.PI / 2; liningL.position.x = -W / 2 + 0.05;
  body.add(liningR, liningL);
  // Side window glass
  for (const w of sideWindows()) {
    const g = new THREE.PlaneGeometry(w.u1 - w.u0, w.y1 - w.y0);
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(g, glass);
      m.position.set(side * (W / 2 - 0.02), (w.y0 + w.y1) / 2, -(w.u0 + w.u1) / 2);
      m.rotation.y = side * Math.PI / 2; m.renderOrder = 9;
      body.add(m);
    }
  }
  // Door (left side, front) — thin panel that slides back when open
  const door = new THREE.Group(); door.name = 'door';
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.35, 1.3), new THREE.MeshPhysicalMaterial({ map: texL, roughness: 0.5, clearcoat: 0.5 }));
  doorPanel.position.set(0, 0, 0);
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.45, 0.05), black); doorFrame.position.set(0, 0.5, -0.68);
  const doorFrame2 = doorFrame.clone(); doorFrame2.position.z = 0.68;
  door.add(doorPanel, doorFrame, doorFrame2);
  door.position.set(-W / 2 - 0.01, 1.1, -(3.35 + 0.65));
  body.add(door);

  // ---- Front details -----------------------------------------------------------
  const zF = -U_FRONT;
  const bumper = cast(new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.32, 0.3), chrome)); bumper.position.set(0, 0.62, zF - 0.1); body.add(bumper);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.06), black); grille.position.set(0, 1.05, zF - 0.02); body.add(grille);
  for (let i = 0; i < 6; i++) { const slat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.04), chrome); slat.position.set(0, 0.86 + i * 0.07, zF - 0.05); body.add(slat); }
  const frontStrip = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.26), new THREE.MeshStandardMaterial({ map: makeFrontStrip(opts.anisotropy), roughness: 0.5 }));
  frontStrip.position.set(0, 1.36, zF - 0.015); frontStrip.rotation.y = Math.PI; body.add(frontStrip);
  const destBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.375), new THREE.MeshStandardMaterial({ map: makeDestinationBoard(opts.anisotropy), emissive: 0xffffff, emissiveMap: makeDestinationBoard(opts.anisotropy), emissiveIntensity: 0.6, roughness: 0.6 }));
  destBoard.position.set(0, 2.72, zF - 0.2 + 0.0); destBoard.rotation.y = Math.PI; destBoard.rotation.x = 0.1; body.add(destBoard);
  // Headlights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 0.15, roughness: 0.2, metalness: 0.3 });
  const headMatL = headMat.clone(); // left lamp gets its own material so damage can kill it
  const indMat = new THREE.MeshStandardMaterial({ color: 0xff9a1a, emissive: 0xff7a00, emissiveIntensity: 0.3, roughness: 0.3 });
  const headlights: THREE.SpotLight[] = [];
  for (const x of [-0.82, 0.82]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 20).rotateX(Math.PI / 2), x < 0 ? headMatL : headMat); h.position.set(x, 1.08, zF - 0.02); body.add(h);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 20), chrome); ring.position.set(x, 1.08, zF - 0.04); body.add(ring);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.05), indMat); ind.position.set(x * 1.28, 0.9, zF - 0.02); body.add(ind);
    const spot = new THREE.SpotLight(0xfff1d6, 0, 70, 0.5, 0.55, 1.2);
    spot.position.set(x, 1.1, zF); spot.target.position.set(x * 1.5, 0.0, zF - 30);
    body.add(spot, spot.target); headlights.push(spot);
  }
  // Mirrors
  for (const x of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), black); arm.position.set(x * (W / 2 + 0.25), 2.3, zF + 0.35); body.add(arm);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.3), black); mir.position.set(x * (W / 2 + 0.5), 2.3, zF + 0.35); body.add(mir);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.4), chrome); face.position.set(x * (W / 2 + 0.5) - x * 0.035, 2.3, zF + 0.35); face.rotation.y = x > 0 ? -Math.PI / 2 - 0.3 : Math.PI / 2 + 0.3; body.add(face);
  }
  // Wipers (pivot at windshield base; lie on the raked glass)
  const wipers: THREE.Group[] = [];
  for (const x of [-0.55, 0.45]) {
    const piv = new THREE.Group(); piv.position.set(x, DASH_TOP + 0.08, zF + 0.02); piv.rotation.x = -0.16;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.02), black); blade.position.y = 0.45;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.015), chrome); arm.position.set(0.02, 0.3, 0.01);
    piv.add(blade, arm); piv.rotation.z = -0.2; body.add(piv); wipers.push(piv);
  }
  // ---- Rear details ------------------------------------------------------------
  const zR = -U_REAR;
  const rearBumper = cast(new THREE.Mesh(new THREE.BoxGeometry(W + 0.05, 0.3, 0.25), chrome)); rearBumper.position.set(0, 0.62, zR + 0.05); body.add(rearBumper);
  const rearBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.05), new THREE.MeshStandardMaterial({ map: makeRearBoard(opts.anisotropy), roughness: 0.5 }));
  rearBoard.position.set(0, 1.35, zR + 0.015); body.add(rearBoard);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 0.25, roughness: 0.3 });
  const revMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  for (const x of [-0.95, 0.95]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), tailMat); t.position.set(x, 1.0, zR + 0.02); body.add(t);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), revMat); r.position.set(x, 0.8, zR + 0.02); body.add(r);
    const i = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), indMat); i.position.set(x, 1.22, zR + 0.02); body.add(i);
  }
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 10).rotateX(Math.PI / 2), black); exhaust.position.set(-0.9, 0.38, zR + 0.1); body.add(exhaust);
  // Roof rack
  const rackMat = chrome;
  for (const x of [-0.95, -0.32, 0.32, 0.95]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 8.6), rackMat); r.position.set(x, D.height + 0.22, 0.2); body.add(r); }
  for (let z = -4; z <= 4; z += 1.6) { const c = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.05), rackMat); c.position.set(0, D.height + 0.22, z); body.add(c); }
  for (let z = -4; z <= 4; z += 1.6) for (const x of [-0.95, 0.95]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), rackMat); p.position.set(x, D.height + 0.11, z); body.add(p); }
  const luggage = cast(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.2), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }))); luggage.position.set(0.1, D.height + 0.5, 1.2); body.add(luggage);
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 1 })); sack.scale.set(1, 0.7, 1.3); sack.position.set(-0.5, D.height + 0.5, -1.4); body.add(sack);

  // ---- Wheels ------------------------------------------------------------------
  const tread = makeTyreTread();
  const tyreMat = new THREE.MeshStandardMaterial({ map: tread, color: 0x2a2a2a, roughness: 0.95 });
  const tyreGeo = new THREE.CylinderGeometry(PHYSICS.wheelRadius, PHYSICS.wheelRadius, 0.3, 28).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.32, 20).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.38, 12).rotateZ(Math.PI / 2);
  const nutGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.04, 6).rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.35, metalness: 0.8 });
  const wheelSpin: THREE.Object3D[] = [], wheelSteer: THREE.Object3D[] = [];
  const makeWheel = (x: number, z: number, steer: boolean, dual: boolean, name: string) => {
    const steerNode = new THREE.Group(); steerNode.position.set(x, PHYSICS.wheelRadius, z); steerNode.name = name;
    const spin = new THREE.Group();
    const mk = (ox: number) => {
      const t = cast(new THREE.Mesh(tyreGeo, tyreMat)); t.position.x = ox;
      const r = new THREE.Mesh(rimGeo, rimMat); r.position.x = ox;
      const h = new THREE.Mesh(hubGeo, chrome); h.position.x = ox;
      spin.add(t, r, h);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const nt = new THREE.Mesh(nutGeo, black); nt.position.set(ox + Math.sign(x) * 0.17, Math.cos(a) * 0.2, Math.sin(a) * 0.2); spin.add(nt); }
    };
    mk(0); if (dual) mk(-Math.sign(x) * 0.33);
    steerNode.add(spin); root.add(steerNode);
    wheelSpin.push(spin); if (steer) wheelSteer.push(steerNode);
  };
  const tx = PHYSICS.trackWidth / 2;
  makeWheel(-tx, -PHYSICS.lf, true, false, 'wheel_FL');
  makeWheel(tx, -PHYSICS.lf, true, false, 'wheel_FR');
  makeWheel(-tx, PHYSICS.lr, false, true, 'wheel_RL');
  makeWheel(tx, PHYSICS.lr, false, true, 'wheel_RR');
  // Wheel wells (dark half-cylinders so you don't see the cabin floor through the arches)
  const wellGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 12, 1, true, 0, Math.PI).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-tx, -PHYSICS.lf], [tx, -PHYSICS.lf], [-tx, PHYSICS.lr], [tx, PHYSICS.lr]]) {
    const w = new THREE.Mesh(wellGeo, new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.DoubleSide })); w.position.set(x, 0.5, z); body.add(w);
  }

  // ---- Interior -----------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, 0.06, L - 0.5), new THREE.MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.95 }));
  floor.position.set(0, D.floorHeight - 0.03, 0.2); body.add(floor);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.56, 0.75), new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.8 }));
  dash.position.set(0, D.floorHeight + 0.28, zF + 0.5); body.add(dash);
  const dashTop = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: 0x1f1c1a, roughness: 0.6 }));
  dashTop.position.set(0, DASH_TOP - 0.02, zF + 0.3); body.add(dashTop);
  const speedo = new Speedometer();
  const speedoMesh = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshBasicMaterial({ map: speedo.texture }));
  speedoMesh.position.set(0.85, D.floorHeight + 0.66, zF + 0.55); speedoMesh.rotation.x = -0.5; body.add(speedoMesh);
  // A-pillars + windshield header so the cockpit view is framed like a real cab
  for (const x of [-(W / 2 - 0.1), W / 2 - 0.1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.12, D.height - DASH_TOP - 0.2, 0.14), new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8 }));
    pil.position.set(x, (D.height + DASH_TOP) / 2 - 0.1, zF + 0.12); pil.rotation.x = -0.14; body.add(pil);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8 }));
  header.position.set(0, D.height - 0.2, zF + 0.5); body.add(header);
  const steeringWheel = new THREE.Group(); steeringWheel.name = 'steering_wheel';
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 10, 32), black);
  const spokes = new THREE.Group();
  for (const a of [0, 2.1, -2.1]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.02), black); s.position.set(Math.sin(a) * 0.12, Math.cos(a) * 0.12, 0); s.rotation.z = -a; spokes.add(s); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateX(Math.PI / 2), black);
  steeringWheel.add(rim, spokes, hub);
  steeringWheel.position.set(0.85, D.floorHeight + 0.71, zF + 1.1); steeringWheel.rotation.x = -0.7;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), black); column.position.set(0.85, D.floorHeight + 0.55, zF + 0.85); column.rotation.x = 1.0; body.add(column);
  body.add(steeringWheel);
  const gearLever = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8), chrome); stick.position.y = 0.22;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), black); knob.position.y = 0.45;
  gearLever.add(stick, knob); gearLever.position.set(0.3, D.floorHeight + 0.05, zF + 1.2); gearLever.rotation.x = 0.4; body.add(gearLever);
  const rearView = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.02), chrome); rearView.position.set(0.3, 2.72, zF + 0.75); rearView.rotation.set(0.2, -0.25, 0); body.add(rearView);
  const mirrorMat = new THREE.MeshBasicMaterial({ color: 0x9aa4ac });
  const mirrorFace = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.13), mirrorMat); mirrorFace.position.set(0, 0, 0.012); rearView.add(mirrorFace);
  // Seats (instanced)
  const seatGeo = mergeGeometries([
    new THREE.BoxGeometry(0.48, 0.1, 0.5).translate(0, 0.45, 0),
    new THREE.BoxGeometry(0.48, 0.6, 0.08).translate(0, 0.75, 0.24),
    new THREE.BoxGeometry(0.06, 0.45, 0.5).translate(-0.24, 0.22, 0),
  ])!;
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x8a2d3a, roughness: 0.85 });
  const seatPositions: THREE.Vector3[] = [];
  for (let z = -(HALF - 2.7); z < HALF - 1.0; z += 0.78) for (const x of [-0.95, -0.47, 0.47, 0.95]) {
    if (z < -(HALF - 3.4) && x < 0) continue; // door well at the front left
    seatPositions.push(new THREE.Vector3(x, D.floorHeight, z));
  }
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, seatPositions.length);
  const m4 = new THREE.Matrix4();
  seatPositions.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); seats.setMatrixAt(i, m4); });
  seats.instanceMatrix.needsUpdate = true; body.add(seats);
  const driverSeat = new THREE.Mesh(seatGeo, new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 })); driverSeat.position.set(0.85, D.floorHeight, zF + 1.6); body.add(driverSeat);
  // Grab poles + ceiling rail
  for (const z of [-1.5, 1.0, 3.5]) for (const x of [-0.22, 0.22]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, D.height - D.floorHeight - 0.2, 8), chrome); p.position.set(x, (D.height + D.floorHeight) / 2 - 0.1, z); body.add(p); }
  for (const x of [-0.22, 0.22]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 8.5, 8).rotateX(Math.PI / 2), chrome); r.position.set(x, D.height - 0.25, 0.8); body.add(r); }
  // Seated passenger silhouettes: two instanced meshes so skin and clothing get separate colours
  const skinGeo = mergeGeometries([
    new THREE.SphereGeometry(0.11, 9, 7).scale(0.95, 1.1, 0.95).translate(0, 1.25, 0.01),            // head
    new THREE.CylinderGeometry(0.045, 0.05, 0.08, 6).translate(0, 1.1, 0),                           // neck
    new THREE.SphereGeometry(0.045, 6, 5).translate(-0.24, 0.6, 0.12), new THREE.SphereGeometry(0.045, 6, 5).translate(0.24, 0.6, 0.12), // hands
  ].map((g) => g.index ? g.toNonIndexed() : g))!;
  const clothGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.16, 0.19, 0.5, 8).scale(1, 1, 0.65).translate(0, 0.75, 0),          // torso
    new THREE.CylinderGeometry(0.19, 0.14, 0.12, 8).scale(1.25, 1, 0.7).translate(0, 1.02, 0),       // shoulders
    new THREE.CapsuleGeometry(0.045, 0.3, 2, 6).rotateZ(0.25).translate(-0.2, 0.78, 0.04),          // arms
    new THREE.CapsuleGeometry(0.045, 0.3, 2, 6).rotateZ(-0.25).translate(0.2, 0.78, 0.04),
  ].map((g) => g.index ? g.toNonIndexed() : g))!;
  const hairGeo = new THREE.SphereGeometry(0.115, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.05, 1).translate(0, 1.27, -0.01).toNonIndexed();
  const silMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const skinMesh = new THREE.InstancedMesh(skinGeo, silMat, seatPositions.length);
  const clothMesh = new THREE.InstancedMesh(clothGeo, silMat, seatPositions.length);
  const hairMesh = new THREE.InstancedMesh(hairGeo, new THREE.MeshStandardMaterial({ color: 0x17110d, roughness: 0.95 }), seatPositions.length);
  const SKIN = [0x8d5a3b, 0xa56a45, 0xc58a62, 0x6f452b, 0xb07a55];
  const CLOTH = [0xe9e4d6, 0x1f6fb5, 0xd8262c, 0x1f9d55, 0xf2a900, 0x6b3fa0, 0xffffff, 0x2f3a4a, 0xef6aa3, 0x8a2d3a];
  const col = new THREE.Color();
  seatPositions.forEach((p, i) => {
    m4.makeTranslation(p.x, p.y + 0.02, p.z - 0.05);
    skinMesh.setMatrixAt(i, m4); clothMesh.setMatrixAt(i, m4); hairMesh.setMatrixAt(i, m4);
    skinMesh.setColorAt(i, col.set(SKIN[(i * 3) % SKIN.length]));
    clothMesh.setColorAt(i, col.set(CLOTH[(i * 7) % CLOTH.length]));
  });
  for (const mm of [skinMesh, clothMesh, hairMesh]) { mm.instanceMatrix.needsUpdate = true; if (mm.instanceColor) mm.instanceColor.needsUpdate = true; mm.count = 0; body.add(mm); }
  const passengers = { set count(n: number) { skinMesh.count = clothMesh.count = hairMesh.count = n; }, get count() { return skinMesh.count; } };
  // Driver (humanoid, RHD seat, hands held on the wheel by 2-bone IK) + door helper
  const driver = new Person(DRIVER_VARIANT);
  driver.root.position.set(0.85, D.floorHeight, zF + 1.78); driver.root.rotation.y = Math.PI; // faces -Z (forward)
  driver.setAction('drive'); driver.mesh.castShadow = false; driver.mesh.frustumCulled = false;
  body.add(driver.root);
  const helper = new Person(HELPER_VARIANT);
  helper.root.position.set(-W / 2 - 0.12, D.floorHeight - 0.45, -(3.35 + 0.65) + 0.1); helper.root.rotation.y = -Math.PI / 2 + 0.5;
  helper.setAction('hang'); helper.mesh.castShadow = false; helper.mesh.frustumCulled = false;
  body.add(helper.root);
  opts.people?.add(driver); opts.people?.add(helper);
  // A few humanoid passengers at window seats (the rest stay as instanced silhouettes)
  const riders: Person[] = [];
  const riderSeats = [[0.95, -1.3], [-0.95, 0.3], [0.95, 2.6], [-0.95, 3.4]];
  const riderVariants = [VARIANTS[3], VARIANTS[9], VARIANTS[7], VARIANTS[10]];
  riderSeats.forEach(([x, z], i) => {
    const p = new Person(riderVariants[i]); p.root.position.set(x, D.floorHeight + 0.08, z + 0.1); p.root.rotation.y = Math.PI;
    p.setAction('seated'); p.seatedSub = (['idle', 'talk', 'phone', 'film'] as const)[i]; p.mesh.castShadow = false; p.mesh.frustumCulled = false;
    body.add(p.root); opts.people?.add(p); riders.push(p);
  });
  const gripL = new THREE.Vector3(), gripR = new THREE.Vector3();
  let hornTimer = 0, idleHand = 0;
  const driverHandOverride: { L: THREE.Vector3 | null; R: THREE.Vector3 | null } = { L: null, R: null };

  // ---- Draw-call merge: static parts → a few vertex-coloured meshes -------------
  const skip = new Set<THREE.Object3D>([door, steeringWheel, ...wipers, driver.root, helper.root, ...riders.map((r) => r.root), seats, skinMesh, clothMesh, hairMesh, speedoMesh, rearView, bumper]);
  mergeStaticMeshes(body, skip, opts.shadows);
  for (const g of [door, steeringWheel, ...wipers, ...wheelSpin]) mergeStaticMeshes(g, new Set(), opts.shadows);

  // ---- Blob shadow (used on tiers without shadow maps) -----------------------
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(W + 1.2, L + 0.8), new THREE.MeshBasicMaterial({ map: makeBlobShadow(), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.015; blob.renderOrder = 1; blob.visible = !opts.shadows; root.add(blob);

  const exteriorOnly = [destBoard, frontStrip];
  // engine smoke (rear, shown by the damage model)
  const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(90,90,90,0.9)'); g.addColorStop(1, 'rgba(90,90,90,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const smoke: THREE.Sprite[] = [];
  for (let i = 0; i < 5; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false })); sp.position.set(-0.8, 0.6, zR + 0.4); sp.scale.setScalar(0.6); body.add(sp); smoke.push(sp); }
  const bumperY = bumper.position.y;
  let headlightsDead = false;
  let highBeam = false, lightsOn = false;

  const rig: BusRig = {
    root, body, wheelSpin, wheelSteer, steeringWheel, door, headlights, isProcedural: true,
    setLights({ headlights: on, brake, reverse }) {
      lightsOn = on;
      headMat.emissiveIntensity = on ? (highBeam ? 5.5 : 3.5) : 0.15;
      if (!headlightsDead) headMatL.emissiveIntensity = headMat.emissiveIntensity;
      headlights.forEach((s, i) => { s.intensity = on && !(i === 0 && headlightsDead) ? (highBeam ? 1700 : 900) : 0; s.distance = highBeam ? 130 : 70; s.angle = highBeam ? 0.42 : 0.5; });
      tailMat.emissiveIntensity = (on ? 1.2 : 0.25) + brake * 5;
      revMat.emissiveIntensity = reverse ? 2.5 : 0;
    },
    setWipers(phase) {
      const a = phase === null ? -0.2 : -0.2 + 1.3 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
      for (const w of wipers) w.rotation.z = a;
    },
    setPassengers(n) { passengers.count = Math.max(0, Math.min(seatPositions.length, n)); },
    setCockpitMode(on) {
      for (const o of exteriorOnly) o.visible = !on;
      // the camera sits where the driver's head is: collapse head + neck bones in cockpit view
      const sc = on ? 0.001 : 1;
      driver.bones[3].scale.setScalar(sc); driver.bones[4].scale.setScalar(sc);
    },
    updateDriver(steerAngle, dt, horn, swerving) {
      steeringWheel.rotation.z = -steerAngle * 4.5;
      steeringWheel.updateMatrixWorld(true);
      // grips at 9 and 3 o'clock on the rim, in the driver's root space
      gripL.set(-0.24, 0, 0); steeringWheel.localToWorld(gripL); driver.root.worldToLocal(gripL);
      gripR.set(0.24, 0, 0); steeringWheel.localToWorld(gripR); driver.root.worldToLocal(gripR);
      // the driver faces -Z: their LEFT hand is on the +X (world-right... no: driver's left = world +x? no) side.
      // Driver root rotated 180°, so world -x (left side of bus) == driver's right. Left hand holds the rim at world +x.
      driver.ikR = gripL; driver.ikL = gripR;
      // Left hand occasionally leaves the wheel: horn press / shifter reach
      hornTimer += dt;
      if (horn) idleHand = 1;
      else if (hornTimer > 9 + Math.random() * 6) { hornTimer = 0; idleHand = 1; }
      if (idleHand > 0) {
        idleHand -= dt / 1.4;
        const k = Math.sin(Math.min(1, Math.max(0, idleHand)) * Math.PI);
        const hub = new THREE.Vector3(0, 0, 0.05); steeringWheel.localToWorld(hub); driver.root.worldToLocal(hub);
        driver.ikL = gripR.clone().lerp(hub, k * (horn ? 1 : 0.6));
        if (!horn && k > 0.5) { const lever = new THREE.Vector3(0.3, D.floorHeight + 0.5, zF + 1.2); body.localToWorld(lever); driver.root.worldToLocal(lever); driver.ikL = gripR.clone().lerp(lever, k); }
      }
      if (driverHandOverride.L) driver.ikL = driverHandOverride.L;
      if (driverHandOverride.R) driver.ikR = driverHandOverride.R;
      driver.speed = swerving ? 2.2 : 1;
      driver.headYaw = THREE.MathUtils.lerp(driver.headYaw, -steerAngle * 0.9, Math.min(1, dt * 4));
    },
    driver, helper, riders,
    setMirrorTexture(tex) { mirrorMat.map = tex; mirrorMat.color.set(0xffffff); mirrorMat.needsUpdate = true; },
    setPassengerPose(a) { const map: Record<string, Person['seatedSub']> = { talk: 'talk', fan: 'fan', sleep: 'sleep', phonecall: 'phone', film: 'film' }; riders.forEach((r, i) => { r.seatedSub = a === 'idle' ? (['idle', 'talk', 'phone', 'film'] as const)[i] : (map[a] ?? 'idle'); }); },
    setDriverHandTarget(side, worldPoint) { if (!worldPoint) { driverHandOverride[side] = null; return; } driverHandOverride[side] = driver.root.worldToLocal(worldPoint.clone()); },
    updateSpeedo(kmh, rpm, gear) { speedo.update(kmh, rpm, gear); },
    smoke,
    setHighBeam(on) { highBeam = on; rig.setLights({ headlights: lightsOn, brake: 0, reverse: false }); },
    setDamage(level) {
      // bent bumper from ~50 %, dead left headlight from ~30 %
      const bend = Math.max(0, (level - 0.45) / 0.55);
      bumper.rotation.z = -0.14 * bend; bumper.position.y = bumperY - 0.1 * bend; bumper.rotation.y = 0.05 * bend;
      const dead = level > 0.3;
      headMatL.color.set(dead ? 0x3a3a3a : 0xffffff); headMatL.emissiveIntensity = dead ? 0 : headMat.emissiveIntensity;
      if (headlights[0]) headlights[0].intensity = dead ? 0 : headlights[0].intensity;
      headlightsDead = dead;
    },
    setLivery(main, dark) {
      const nt = makeSideLivery(layout, opts.anisotropy, main, dark);
      const r = nt; r.repeat.copy(texR.repeat); r.offset.copy(texR.offset);
      const l = nt.clone(); l.repeat.copy(texL.repeat); l.offset.copy(texL.offset); l.needsUpdate = true;
      sideMatR.map = r; sideMatL.map = l; (doorPanel.material as THREE.MeshPhysicalMaterial).map = l;
      sideMatR.needsUpdate = sideMatL.needsUpdate = true;
      // rear board + front strip carry the same colours (what the chase camera sees)
      const rm = rearBoard.material as THREE.MeshStandardMaterial; rm.map?.dispose(); rm.map = makeRearBoard(opts.anisotropy, main, dark); rm.needsUpdate = true;
      const fm = frontStrip.material as THREE.MeshStandardMaterial; fm.map?.dispose(); fm.map = makeFrontStrip(opts.anisotropy, main, dark); fm.needsUpdate = true;
      paint.color.set(main);
    },
    setDoor(open) { door.position.z = -(3.35 + 0.65) + open * 1.25; door.position.x = -W / 2 - 0.01 - open * 0.08; },
  };
  rig.setLights({ headlights: false, brake: 0, reverse: false });
  return rig;
}
