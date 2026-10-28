import * as THREE from 'three';
import { WORLD } from '../config.ts';
import { Road } from './road.ts';
import { makeTextTexture } from './textures.ts';
import { COLLIDERS } from './collision.ts';
import { Person, PeopleManager, POLICE_VARIANTS, CHADA_VARIANT, makeVariant } from './people.ts';

/**
 * World objects for the Phase 2 incidents: chada men at the roadside, the police checkpoint
 * (barrier + officers + sign), the speed-camera gantry on the bridge, and the fuel pump.
 * Behaviour lives in game/incidents.ts; this file only builds and animates the scenery.
 */
export class IncidentProps {
  readonly group = new THREE.Group();
  readonly chadaMen: Person[] = [];
  readonly officers: Person[] = [];
  private barrier: THREE.Group;
  private barrierOpen = 0;
  private cameraFlash: THREE.MeshStandardMaterial;
  private flashT = 0;
  readonly pumpPos: THREE.Vector3;
  private pumpZoneMat!: THREE.MeshStandardMaterial; private zoneT = 0;

  constructor(private road: Road, people: PeopleManager) {
    const place = (s: number, lateral: number) => { const f = road.sample(s); const bl = road.bulge(s); const l = lateral + Math.sign(lateral) * bl; return { pos: new THREE.Vector3(f.x + f.rx * l, road.footpathHeight(s), f.z + f.rz * l), yaw: Math.atan2(-f.tx, -f.tz), f }; };
    const edge = WORLD.roadWidth / 2 + WORLD.shoulderWidth;

    // ---- chada men: standing at the left shoulder, waving ----
    for (const s of WORLD.chadaSpots) {
      const { pos, f } = place(s, -(edge - 0.4));
      const p = new Person(CHADA_VARIANT); p.position.copy(pos); p.lookAt(f.x - f.tx * 30, f.z - f.tz * 30); p.setAction('idle');
      this.group.add(p.root); people.add(p); this.chadaMen.push(p);
      // a plastic chair + umbrella: his "office"
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0xd8262c })); chair.position.copy(pos).add(new THREE.Vector3(f.rx * -1.4, 0.25, f.rz * -1.4)); this.group.add(chair);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x444 })); pole.position.copy(chair.position).setY(pos.y + 1.2); this.group.add(pole);
      const umb = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x1f6fb5 })); umb.position.copy(pole.position).setY(pos.y + 2.45); this.group.add(umb);
    }

    // ---- police checkpoint ----
    const cs = WORLD.checkpointS;
    const { pos: cpos, yaw: cyaw, f: cf } = place(cs, 0);
    this.barrier = new THREE.Group(); this.barrier.position.copy(cpos).setY(0); this.barrier.rotation.y = cyaw;
    const hw = WORLD.roadWidth / 2;
    const drumMat = new THREE.MeshStandardMaterial({ color: 0xd8262c, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
    // drums on both edges + a striped boom across the left (travel) lane that lifts when waved through
    for (const x of [-hw + 0.5, hw - 0.5]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), drumMat); d.position.set(x, 0.45, 0); this.barrier.add(d); const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.25, 10), white); ring.position.set(x, 0.45, 0); this.barrier.add(ring); }
    const pivot = new THREE.Group(); pivot.position.set(-hw + 0.5, 1.0, 0); this.barrier.add(pivot); pivot.name = 'boom';
    const boom = new THREE.Mesh(new THREE.BoxGeometry(hw + 0.2, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff })); boom.position.x = (hw + 0.2) / 2; pivot.add(boom);
    for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.11), drumMat); st.position.x = 0.4 + i * 0.95; pivot.add(st); }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), white); post.position.set(-hw + 0.5, 0.55, 0); this.barrier.add(post);
    const tent = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 2.5), new THREE.MeshStandardMaterial({ color: 0x2c4a7a })); tent.position.set(-(edge + 1.6), 2.4, 3); this.barrier.add(tent);
    for (const [x, z] of [[-(edge + 0.3), 1.9], [-(edge + 2.9), 1.9], [-(edge + 0.3), 4.1], [-(edge + 2.9), 4.1]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), white); p.position.set(x, 1.2, z); this.barrier.add(p); }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.3), new THREE.MeshStandardMaterial({ map: makeTextTexture(['পুলিশ চেকপোস্ট', 'গতি কমান — ৩০'], { bg: '#1b3f8a', fg: '#fff', w: 1024, h: 440, border: '#fff' }), roughness: 0.5, side: THREE.DoubleSide }));
    sign.position.set(-(edge + 0.8), 3.1, 60); this.barrier.add(sign);
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), white); sp.position.set(-(edge + 0.8), 1.3, 60); this.barrier.add(sp);
    this.group.add(this.barrier);
    // officers: one at the boom with a hand signal, one at the tent
    const o1 = new Person(POLICE_VARIANTS[1]); o1.position.set(cf.x + cf.rx * -(hw + 0.4), 0, cf.z + cf.rz * -(hw + 0.4)); o1.lookAt(cf.x - cf.tx * 40, cf.z - cf.tz * 40); o1.setAction('signal');
    const o2 = new Person(POLICE_VARIANTS[2]); o2.position.set(cf.x + cf.rx * -(edge + 1.6) + cf.tx * -2.5, 0, cf.z + cf.rz * -(edge + 1.6) + cf.tz * -2.5); o2.lookAt(cf.x, cf.z); o2.setAction('idle');
    for (const o of [o1, o2]) { this.group.add(o.root); people.add(o); this.officers.push(o); }
    COLLIDERS.add(cpos.x + cf.rx * (hw - 0.5), cpos.z + cf.rz * (hw - 0.5), 0.35);

    // ---- speed camera gantry on the bridge ----
    const { pos: gpos, yaw: gyaw } = place(WORLD.speedCameraS, 0);
    const g = new THREE.Group(); g.position.copy(gpos).setY(0); g.rotation.y = gyaw;
    const gm = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.5 });
    const gw = WORLD.roadWidth + WORLD.shoulderWidth * 2 + 1;
    for (const x of [-gw / 2, gw / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), gm); p.position.set(x, 3, 0); g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.3, 0.25, 0.25), gm); beam.position.y = 6; g.add(beam);
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x222 })); cam.position.set(-1.75, 5.6, 0.2); g.add(cam);
    this.cameraFlash = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 });
    const flash = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), this.cameraFlash); flash.position.set(-1.1, 5.6, 0.45); g.add(flash);
    const csign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), new THREE.MeshStandardMaterial({ map: makeTextTexture(['স্পিড ক্যামেরা', `সর্বোচ্চ ${WORLD.speedCameraLimitKmh}`], { bg: '#d8262c', fg: '#fff', w: 1024, h: 460, border: '#fff' }), roughness: 0.5, side: THREE.DoubleSide }));
    csign.position.set(-1.75, 4.6, 0.3); g.add(csign);
    this.group.add(g);
    for (const x of [-gw / 2, gw / 2]) COLLIDERS.add(gpos.x + Math.cos(gyaw) * x, gpos.z - Math.sin(gyaw) * x, 0.3);

    // ---- fuel pump (left side lay-by) ----
    const { pos: ppos, yaw: pyaw, f: pf } = place(WORLD.pumpS, -(edge + 4.5));
    this.pumpPos = ppos.clone();
    const pg = new THREE.Group(); pg.position.copy(ppos).setY(0); pg.rotation.y = pyaw;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 })); canopy.position.y = 4.6; pg.add(canopy);
    const band = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.5, 6.1), new THREE.MeshStandardMaterial({ color: 0x1f9d55 })); band.position.y = 4.2; pg.add(band);
    for (const [x, z] of [[-4, -2.5], [4, -2.5], [-4, 2.5], [4, 2.5]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.5, 8), new THREE.MeshStandardMaterial({ color: 0xcfd4d8, metalness: 0.5 })); c.position.set(x, 2.25, z); pg.add(c); }
    for (const z of [-1.2, 1.2]) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.5), new THREE.MeshStandardMaterial({ color: 0xd8262c })); d.position.set(0, 0.8, z); pg.add(d); const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), new THREE.MeshStandardMaterial({ color: 0x9ac0d8 })); screen.position.set(0.41, 1.1, z); screen.rotation.y = Math.PI / 2; pg.add(screen); }
    const pad = new THREE.Mesh(new THREE.BoxGeometry(12, 0.06, 8), new THREE.MeshStandardMaterial({ color: 0x5a5a5e, roughness: 1 })); pad.position.y = 0.03; pg.add(pad);
    const psign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.3), new THREE.MeshStandardMaterial({ map: makeTextTexture(['⛽ ফিলিং স্টেশন', 'ডিজেল · অকটেন'], { bg: '#1f9d55', fg: '#fff', w: 1024, h: 340, border: '#ffd23c' }), roughness: 0.5, side: THREE.DoubleSide }));
    psign.position.set(0, 5.6, 3.1); pg.add(psign);
    const attendant = new Person(makeVariant({ id: 'pump', outfit: 'shirt-pants', top: '#1f9d55', bottom: '#2f3a4a', hair: 'cap', accent: '#1f9d55' })); attendant.position.copy(ppos).add(new THREE.Vector3(pf.rx * 1.5, 0, pf.rz * 1.5)); attendant.lookAt(pf.x, pf.z); attendant.setAction('idle');
    this.group.add(pg, attendant.root); people.add(attendant);
    for (const [x, z] of [[-4, -2.5], [4, -2.5], [-4, 2.5], [4, 2.5], [0, -1.2], [0, 1.2]]) { const wx = ppos.x + Math.cos(pyaw) * x + Math.sin(pyaw) * z, wz = ppos.z - Math.sin(pyaw) * x + Math.cos(pyaw) * z; COLLIDERS.add(wx, wz, 0.3); }
    // green refuel zone on the left lane + shoulder in front of the station (stop here to fill up)
    {
      const s0 = WORLD.pumpS - WORLD.pumpZoneHalf, s1 = WORLD.pumpS + WORLD.pumpZoneHalf;
      const pts: number[] = [], idx: number[] = []; let k = 0;
      for (let s = s0; s <= s1; s += 2) {
        const f = road.sample(s); const a = -(edge - 0.2), b = -0.4;
        pts.push(f.x + f.rx * a, 0.016, f.z + f.rz * a, f.x + f.rx * b, 0.016, f.z + f.rz * b);
        if (s > s0) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        k += 2;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3)); g.setIndex(idx); g.computeVertexNormals();
      this.pumpZoneMat = new THREE.MeshStandardMaterial({ color: 0x1f9d55, emissive: 0x0f5c30, emissiveIntensity: 0.4, transparent: true, opacity: 0.65, roughness: 0.9, depthWrite: false, side: THREE.DoubleSide });
      const zone = new THREE.Mesh(g, this.pumpZoneMat); zone.renderOrder = 1; this.group.add(zone);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: makeTextTexture(['⛽ তেল'], { bg: 'rgba(0,0,0,0)', fg: '#fff', w: 256, h: 128 }), transparent: true, depthWrite: false }));
      const lf = road.sample(WORLD.pumpS); lbl.position.set(lf.x + lf.rx * -(edge / 2 + 0.3), 0.02, lf.z + lf.rz * -(edge / 2 + 0.3)); lbl.rotation.set(-Math.PI / 2, 0, 0); lbl.rotateZ(Math.atan2(-lf.tx, -lf.tz)); lbl.renderOrder = 2; this.group.add(lbl);
    }
    // apron stub road from the shoulder to the pump pad
    const apron = new Road(4, { route: [[12, 0]], start: { x: pf.x + pf.rx * -(edge - 0.5), z: pf.z + pf.rz * -(edge - 0.5), yaw: pyaw - Math.PI / 2 }, ground: false }); apron.group.position.y = -0.004; this.group.add(apron.group);
  }

  /** Distance from s to the checkpoint boom along the route (Infinity when open / passed). */
  checkpointWall(sFront: number): number { if (this.barrierOpen > 0.5) return Infinity; const d = WORLD.checkpointS - 1 - sFront; return d < -3 ? Infinity : Math.max(0, d); }
  setBoom(open: boolean) { this.barrierOpen = open ? 1 : 0; }
  flash() { this.flashT = 0.25; }
  wave(i: number, action: 'signal' | 'megaphone' | 'idle' | 'point') { this.officers[i]?.setAction(action); }

  update(dt: number) {
    this.zoneT += dt; this.pumpZoneMat.opacity = 0.6 + 0.14 * Math.sin(this.zoneT * 4);
    const boom = this.barrier.getObjectByName('boom')!;
    const target = this.barrierOpen > 0.5 ? -1.3 : 0;
    boom.rotation.z += (target - boom.rotation.z) * Math.min(1, dt * 2.5);
    if (this.flashT > 0) { this.flashT -= dt; this.cameraFlash.emissiveIntensity = this.flashT > 0.15 ? 12 : 0; } else this.cameraFlash.emissiveIntensity = 0;
  }
}
