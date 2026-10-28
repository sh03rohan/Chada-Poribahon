import * as THREE from 'three';
import { WORLD } from '../config.ts';
import type { Road } from './road.ts';
import { makeTextTexture } from './textures.ts';
import { COLLIDERS, type Circle } from './collision.ts';
import { Person, PeopleManager, VARIANTS, POLICE_VARIANTS, makeVariant } from './people.ts';
import { buildTruck } from './traffic.ts';
import { ROUTE } from '../routes.ts';

/**
 * Phase 3 roadside scenes: the Padma toll plaza (canopy, booth, boom), a railway level
 * crossing (rails, gates, signal, hut and a passing train) and an accident scene (overturned
 * truck, tape, police, onlookers; the truck is towed aside once the player has waited).
 * Pure props + small animations; the rules live in game/incidents.ts.
 */
export class EventProps {
  readonly group = new THREE.Group();
  // toll
  private tollBoom!: THREE.Group; private tollOpen = 0; readonly tollAttendant: Person;
  // rail
  private gates: THREE.Group[] = []; private gatesClosed = false; private signalMats: THREE.MeshStandardMaterial[] = []; private blinkT = 0;
  private train!: THREE.Group; private trainU = 9999; private trainDir = new THREE.Vector3(); private trainCenter = new THREE.Vector3();
  trainActive = false;
  // accident
  private wreck!: THREE.Group; private wreckLateral = -2.2; private wreckTarget = -2.2; private wreckS: number; private wreckF: { x: number; z: number; rx: number; rz: number; tx: number; tz: number };
  readonly officer: Person;

  constructor(private road: Road, people: PeopleManager) {
    const place = (s: number, lateral: number) => { const f = road.sample(s); const bl = road.bulge(s); const l = lateral + Math.sign(lateral) * bl; return { pos: new THREE.Vector3(f.x + f.rx * l, 0, f.z + f.rz * l), yaw: Math.atan2(-f.tx, -f.tz), f }; };
    const edge = WORLD.roadWidth / 2 + WORLD.shoulderWidth, hw = WORLD.roadWidth / 2;
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd8262c, roughness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5, metalness: 0.6 });

    // ---------------------------------------------------------------- toll plaza
    {
      const { pos, yaw, f } = place(WORLD.tollS, 0);
      const bl = road.bulge(WORLD.tollS);
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = yaw;
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(edge * 2 + bl * 2 + 2, 0.4, 7), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 })); canopy.position.y = 5.4; g.add(canopy);
      const band = new THREE.Mesh(new THREE.BoxGeometry(edge * 2 + bl * 2 + 2.1, 0.7, 7.1), new THREE.MeshStandardMaterial({ color: 0x1f9d55 })); band.position.y = 4.85; g.add(band);
      for (const x of [-(edge + bl + 0.6), edge + bl + 0.6]) for (const z of [-3, 3]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5, 10), steel); p.position.set(x, 2.5, z); g.add(p); COLLIDERS.add(pos.x + Math.cos(yaw) * x + Math.sin(yaw) * z, pos.z - Math.sin(yaw) * x + Math.cos(yaw) * z, 0.3); }
      // concrete island between the widened lanes carries the booth
      const island = new THREE.Mesh(new THREE.BoxGeometry(bl * 2 - 0.3, 0.22, 26), new THREE.MeshStandardMaterial({ color: 0xbfb9ae, roughness: 0.95 })); island.position.y = 0.11; g.add(island);
      const kerbL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 26), new THREE.MeshStandardMaterial({ color: 0xffcc33 })); kerbL.position.set(-(bl - 0.2), 0.13, 0); g.add(kerbL);
      const kerbR = kerbL.clone(); kerbR.position.x = bl - 0.2; g.add(kerbR);
      COLLIDERS.addBox(pos.x + Math.sin(yaw) * 0, pos.z, yaw, Math.max(0.6, bl * 2 - 0.3), 26);
      const booth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 2.6), new THREE.MeshStandardMaterial({ color: 0xfff1c9, roughness: 0.8 })); booth.position.set(0, 1.3, 0); g.add(booth);
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.9, 1.6), new THREE.MeshStandardMaterial({ color: 0x9ac0d8, roughness: 0.2 })); win.position.set(0, 1.7, 0); g.add(win);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ map: makeTextTexture(ROUTE.names.tollSign, { bg: '#1b3f8a', fg: '#fff', w: 1024, h: 190, border: '#ffcc33' }), roughness: 0.5, side: THREE.DoubleSide }));
      sign.position.set(0, 4.3, 3.6); g.add(sign);
      // boom across the left (travel) lane, pivot at the booth
      const bx = -(bl - 0.5), blen = hw + 0.5;   // boom pivots at the island edge and spans the widened left lane
      this.tollBoom = new THREE.Group(); this.tollBoom.position.set(bx, 1.0, 0.2); g.add(this.tollBoom);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(blen, 0.1, 0.1), white); boom.position.x = -blen / 2; this.tollBoom.add(boom);
      for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.11, 0.11), red); st.position.x = -0.4 - i * 0.95; this.tollBoom.add(st); }
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), white); post.position.set(bx, 0.55, 0.2); g.add(post);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0x00ff55, emissiveIntensity: 1.5 })); lamp.position.set(-hw / 2, 4.2, 3.6); g.add(lamp);
      this.group.add(g);
      this.tollAttendant = new Person(makeVariant({ id: 'toll', outfit: 'shirt-pants', top: '#1f6fb5', bottom: '#2f3a4a', hair: 'cap', accent: '#ffcc33' }));
      this.tollAttendant.position.set(f.x + f.rx * -(bl - 0.9), 0.22, f.z + f.rz * -(bl - 0.9)); this.tollAttendant.lookAt(f.x + f.rx * -4, f.z + f.rz * -4); this.tollAttendant.setAction('idle');
      this.group.add(this.tollAttendant.root); people.add(this.tollAttendant);
    }

    // ---------------------------------------------------------------- level crossing
    {
      const { pos, yaw, f } = place(WORLD.railS, 0);
      this.trainCenter.copy(pos); this.trainDir.set(f.rx, 0, f.rz);
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = yaw;
      const L = 440;
      const ballast = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, 3.4), new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 1 })); ballast.position.y = -0.03; g.add(ballast);
      for (const z of [-0.72, 0.72]) { const r = new THREE.Mesh(new THREE.BoxGeometry(L, 0.1, 0.09), steel); r.position.set(0, 0.05, z); g.add(r); }
      const sleeperGeo = new THREE.BoxGeometry(0.26, 0.1, 2.4), sleeperMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
      const xs: number[] = []; for (let x = -L / 2; x <= L / 2; x += 0.75) if (Math.abs(x) > edge + 0.5) xs.push(x);
      const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMat, xs.length); const m = new THREE.Matrix4();
      xs.forEach((x, i) => { m.makeTranslation(x, 0.0, 0); sleepers.setMatrixAt(i, m); }); sleepers.instanceMatrix.needsUpdate = true; g.add(sleepers);
      // gates: travel lane (left half, 6 m before the rails), oncoming lane (right half, 6 m after)
      const mkGate = (side: -1 | 1) => {
        const pivot = new THREE.Group(); pivot.position.set(side * (hw + 0.35), 1.05, -side * 6.5); g.add(pivot);
        const len = hw + 0.5; const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), white); arm.position.x = -side * len / 2; pivot.add(arm);
        for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.13, 0.13), red); st.position.x = -side * (0.45 + i * 0.95); pivot.add(st); }
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), white); post.position.set(side * (hw + 0.35), 0.6, -side * 6.5); g.add(post);
        // signal: two red lamps on a post beside the gate
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), white); sp.position.set(side * (hw + 0.9), 1.6, -side * 7.3); g.add(sp);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.06), white); cross.position.set(side * (hw + 0.9), 3.1, -side * 7.3); cross.rotation.z = 0.6; g.add(cross);
        const cross2 = cross.clone(); cross2.rotation.z = -0.6; g.add(cross2);
        for (const dx of [-0.25, 0.25]) { const mat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 }); const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat); lamp.position.set(side * (hw + 0.9) + dx, 2.6, -side * 7.3); g.add(lamp); this.signalMats.push(mat); }
        COLLIDERS.add(pos.x + Math.cos(yaw) * side * (hw + 0.35) + Math.sin(yaw) * -side * 6.5, pos.z - Math.sin(yaw) * side * (hw + 0.35) + Math.cos(yaw) * -side * 6.5, 0.25);
        return pivot;
      };
      this.gates.push(mkGate(-1), mkGate(1));
      // gateman's hut + warning board
      const hut = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 0.9 })); hut.position.set(-(edge + 2.2), 1.2, 4.5); g.add(hut);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.9, 4), new THREE.MeshStandardMaterial({ color: 0x8a2f1d })); roof.position.set(-(edge + 2.2), 2.85, 4.5); roof.rotation.y = Math.PI / 4; g.add(roof);
      COLLIDERS.add(pos.x + Math.cos(yaw) * -(edge + 2.2) + Math.sin(yaw) * 4.5, pos.z - Math.sin(yaw) * -(edge + 2.2) + Math.cos(yaw) * 4.5, 1.4);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), new THREE.MeshStandardMaterial({ map: makeTextTexture(['রেল ক্রসিং', 'সাবধান — থামুন, দেখুন'], { bg: '#ffcc33', fg: '#8a1216', w: 1024, h: 470, border: '#d8262c' }), roughness: 0.5, side: THREE.DoubleSide }));
      board.position.set(-(edge + 0.8), 2.6, 60); g.add(board);
      const bp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), white); bp.position.set(-(edge + 0.8), 1.1, 60); g.add(bp);
      this.group.add(g);
      // the train: a loco + 5 coaches along the track direction (parked far away until triggered)
      this.train = new THREE.Group(); this.train.rotation.y = yaw;
      const loco = new THREE.Mesh(new THREE.BoxGeometry(20, 3.6, 3), new THREE.MeshStandardMaterial({ color: 0x1f6fb5, roughness: 0.6 })); loco.position.set(0, 2.3, 0); this.train.add(loco);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 2.6), new THREE.MeshStandardMaterial({ color: 0xffcc33 })); nose.position.set(-11, 1.6, 0); this.train.add(nose);
      for (let i = 0; i < 5; i++) {
        const coach = new THREE.Mesh(new THREE.BoxGeometry(18, 3.4, 3), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x1f9d55 : 0xd8262c, roughness: 0.6 })); coach.position.set(21 + i * 19, 2.2, 0); this.train.add(coach);
        const win = new THREE.Mesh(new THREE.BoxGeometry(17, 0.9, 3.04), new THREE.MeshStandardMaterial({ color: 0x1c2a36 })); win.position.set(21 + i * 19, 2.6, 0); this.train.add(win);
      }
      for (let i = 0; i < 12; i++) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.1, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x222 })); w.position.set(-7 + i * 9.5, 0.5, 0); this.train.add(w); }
      this.train.visible = false; this.group.add(this.train);
    }

    // ---------------------------------------------------------------- accident scene
    {
      const s = WORLD.accidentS; this.wreckS = s;
      const f = road.sample(s); this.wreckF = f;
      const yaw = Math.atan2(-f.tx, -f.tz);
      this.wreck = new THREE.Group();
      const truck = new THREE.Mesh(buildTruck(0x2a5a9a, 0xc8a050), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
      truck.rotation.z = Math.PI / 2 - 0.15; truck.position.y = 1.15; truck.rotation.y = 0.35; this.wreck.add(truck);
      // spilled sacks
      for (let i = 0; i < 7; i++) { const sack = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 1 })); sack.scale.set(1, 0.6, 1.3); sack.position.set(-1.5 + Math.sin(i * 2.1) * 1.6, 0.25, -5 + i * 1.6); this.wreck.add(sack); }
      this.wreck.rotation.y = yaw; this.setWreckLateral(this.wreckLateral);
      this.group.add(this.wreck);
      // tape between posts around the scene, police officer waving traffic, onlookers on the footpath
      const tapeMat = new THREE.MeshStandardMaterial({ color: 0xffcc33 });
      for (const [ds, lat] of [[-9, -0.4], [9, -0.4], [-9, -(edge - 0.2)], [9, -(edge - 0.2)]]) {
        const ff = road.sample(s + ds); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0xffffff })); p.position.set(ff.x + ff.rx * lat, 0.55, ff.z + ff.rz * lat); this.group.add(p);
      }
      for (const lat of [-0.4, -(edge - 0.2)]) { const a = road.sample(s - 9), b = road.sample(s + 9); const tape = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 18), tapeMat); tape.position.set((a.x + b.x) / 2 + f.rx * lat, 1.0, (a.z + b.z) / 2 + f.rz * lat); tape.rotation.y = yaw; this.group.add(tape); }
      this.officer = new Person(POLICE_VARIANTS[0]); const of = road.sample(s - 16); this.officer.position.set(of.x + of.rx * -0.6, 0, of.z + of.rz * -0.6); this.officer.lookAt(of.x - of.tx * 40, of.z - of.tz * 40); this.officer.setAction('signal');
      this.group.add(this.officer.root); people.add(this.officer);
      for (let i = 0; i < 6; i++) {
        const p = new Person(VARIANTS[(i * 4 + 2) % VARIANTS.length]); const pf = road.sample(s - 6 + i * 2.4); const lat = -(edge + 0.8 + (i % 2) * 0.9);
        p.position.set(pf.x + pf.rx * lat, road.footpathHeight(s), pf.z + pf.rz * lat); p.lookAt(pf.x, pf.z); p.setAction(i % 3 === 0 ? 'film' : i % 3 === 1 ? 'talk' : 'point');
        this.group.add(p.root); people.add(p);
      }
      // ambulance-ish van parked on the shoulder ahead
      const amb = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.2, 4.8), new THREE.MeshStandardMaterial({ color: 0xffffff })); const af = road.sample(s + 16); amb.position.set(af.x + af.rx * -(edge - 1.0), 1.1, af.z + af.rz * -(edge - 1.0)); amb.rotation.y = yaw; this.group.add(amb);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.3, 4.84), red); stripe.position.copy(amb.position).setY(1.4); stripe.rotation.y = yaw; this.group.add(stripe);
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x1f6fb5, emissive: 0x2060ff, emissiveIntensity: 2 })); beacon.position.copy(amb.position).setY(2.3); this.group.add(beacon);
      COLLIDERS.addBox(amb.position.x, amb.position.z, yaw, 2.0, 4.8);
    }
  }

  private setWreckLateral(lat: number) { const f = this.wreckF; this.wreck.position.set(f.x + f.rx * lat, 0, f.z + f.rz * lat); }

  // ---- toll
  tollWall(sFront: number): number { if (this.tollOpen > 0.5) return Infinity; const d = WORLD.tollS - 1.5 - sFront; return d < -3 ? Infinity : Math.max(0, d); }
  setTollOpen(open: boolean) { this.tollOpen = open ? 1 : 0; }

  // ---- rail
  railWall(sFront: number): number { if (!this.gatesClosed) return Infinity; const d = WORLD.railS - 7.5 - sFront; return d < -3 ? Infinity : Math.max(0, d); }
  get gatesDown() { return this.gatesClosed; }
  closeGates() { this.gatesClosed = true; }
  openGates() { this.gatesClosed = false; }
  /** Launch the train from the right-hand side; it needs ~14 s to clear the road. */
  startTrain() { this.trainU = 150; this.trainActive = true; this.train.visible = true; }
  get trainPassed() { return this.trainU < -150; }
  /** metres of the train along its track, 0 at the crossing (for the sound mix) */
  get trainOffset() { return this.trainU; }

  // ---- accident
  /** dynamic colliders for the overturned truck (moves aside when towed) */
  wreckCircles(out: Circle[]) { const f = this.wreckF; for (let i = 0; i < 4; i++) { const o = -3.6 + i * 2.4; out.push({ x: this.wreck.position.x + f.tx * o, z: this.wreck.position.z + f.tz * o, r: 1.3 }); } }
  get wreckClear() { return this.wreckTarget < -4; }
  towWreck() { this.wreckTarget = -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 1.8); this.officer.setAction('wave'); }

  update(dt: number) {
    this.tollBoom.rotation.z += (((this.tollOpen > 0.5 ? 1.35 : 0)) - this.tollBoom.rotation.z) * Math.min(1, dt * 2.5);
    this.gates[0].rotation.z += ((this.gatesClosed ? 0 : 1.4) - this.gates[0].rotation.z) * Math.min(1, dt * 1.6);
    this.gates[1].rotation.z += ((this.gatesClosed ? 0 : -1.4) - this.gates[1].rotation.z) * Math.min(1, dt * 1.6);
    this.blinkT += dt;
    const on = this.gatesClosed ? (Math.floor(this.blinkT * 2.5) % 2) : -1;
    this.signalMats.forEach((m, i) => { m.emissiveIntensity = on < 0 ? 0 : (i % 2 === on ? 4 : 0); });
    if (this.trainActive) {
      this.trainU -= dt * 22;
      this.train.position.copy(this.trainCenter).addScaledVector(this.trainDir, this.trainU);
      if (this.trainU < -420) { this.trainActive = false; this.train.visible = false; }
    }
    if (Math.abs(this.wreckLateral - this.wreckTarget) > 0.01) { this.wreckLateral += (this.wreckTarget - this.wreckLateral) * Math.min(1, dt * 0.8); this.setWreckLateral(this.wreckLateral); }
  }
}
