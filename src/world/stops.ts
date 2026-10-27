import * as THREE from 'three';
import { WORLD } from '../config.ts';
import type { Road } from './road.ts';
import { makeTextTexture } from './textures.ts';

/**
 * Static route landmarks: Rajbari bus-stand shed + painted stop zone, Dhaka finish gate,
 * start "Kushtia" board. Zones are queried by s (route distance) from game/events.
 */
export class Stops {
  readonly group = new THREE.Group();
  readonly zoneMaterial: THREE.MeshStandardMaterial;

  constructor(private road: Road) {
    this.zoneMaterial = new THREE.MeshStandardMaterial({ color: 0xffd23c, transparent: true, opacity: 0.55, roughness: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.buildStopZone();
    this.buildShed();
    this.buildGate(WORLD.finishS, ['ঢাকা', 'স্বাগতম']);
    this.buildGate(40, ['কুষ্টিয়া বাস টার্মিনাল', 'শুভ যাত্রা']);
  }

  private frameAt(s: number, lateral: number) {
    const f = this.road.sample(s);
    return { pos: new THREE.Vector3(f.x + f.rx * lateral, 0, f.z + f.rz * lateral), yaw: Math.atan2(-f.tx, -f.tz) };
  }

  /** Painted yellow box on the left lane: the bus must stop inside it. */
  private buildStopZone() {
    const s0 = WORLD.rajbariStopS - WORLD.stopZoneLength / 2, s1 = WORLD.rajbariStopS + WORLD.stopZoneLength / 2;
    const pts: number[] = [], idx: number[] = [];
    let k = 0;
    for (let s = s0; s <= s1; s += 2) {
      const a = this.frameAt(s, -WORLD.roadWidth / 2 + 0.3), b = this.frameAt(s, -0.3);
      pts.push(a.pos.x, 0.015, a.pos.z, b.pos.x, 0.015, b.pos.z);
      if (s > s0) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      k += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    g.setIndex(idx); g.computeVertexNormals();
    const zone = new THREE.Mesh(g, this.zoneMaterial);
    zone.renderOrder = 1;
    this.group.add(zone);
    // "BUS" text on the tarmac
    const t = makeTextTexture(['বাস'], { bg: 'rgba(0,0,0,0)', fg: '#fff', w: 256, h: 128 });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    const f = this.frameAt(WORLD.rajbariStopS, -WORLD.roadWidth / 4);
    label.position.copy(f.pos).setY(0.02); label.rotation.set(-Math.PI / 2, 0, 0); label.rotateZ(f.yaw);
    label.renderOrder = 2;
    this.group.add(label);
  }

  private buildShed() {
    const { pos, yaw } = this.frameAt(WORLD.rajbariStopS, -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 1.8));
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8a2f1d, roughness: 0.7 });
    for (const [x, z] of [[-3.5, -1.2], [3.5, -1.2], [-3.5, 1.2], [3.5, 1.2]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3, 0.18), postMat); p.position.set(x, 1.5, z); p.castShadow = true; g.add(p);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 3.2), new THREE.MeshStandardMaterial({ color: 0x3f7cb0, roughness: 0.5, metalness: 0.5 }));
    roof.position.y = 3.05; roof.castShadow = true; g.add(roof);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0xd8b070 }));
    bench.position.set(0, 0.5, -0.9); g.add(bench);
    const back = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 0.08), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 }));
    back.position.set(0, 1.9, -1.3); g.add(back);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ map: makeTextTexture(['রাজবাড়ী বাস স্ট্যান্ড'], { bg: '#1f9d55', fg: '#fff', w: 1024, h: 192, border: '#ffd23c' }), roughness: 0.6 }));
    sign.position.set(0, 3.7, 0.4); g.add(sign);
    // Waiting passengers (static silhouettes)
    const pm = new THREE.MeshStandardMaterial({ color: 0x4a3a5a, roughness: 0.9 });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 3, 6), pm);
      p.position.set(-3 + i * 1.2, 0.85, -0.4 + (i % 2) * 0.5); g.add(p);
    }
    g.position.copy(pos); g.rotation.y = yaw + Math.PI / 2; // shed's +z (front/open side) faces the road
    this.group.add(g);
  }

  private buildGate(s: number, lines: string[]) {
    const { pos, yaw } = this.frameAt(s, 0);
    const g = new THREE.Group();
    const w = WORLD.roadWidth + WORLD.shoulderWidth * 2 + 1;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8262c, roughness: 0.6 });
    for (const x of [-w / 2, w / 2]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.5, 0.5), mat); p.position.set(x, 3.25, 0); p.castShadow = true; g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 1.4, 0.5), mat); beam.position.y = 6.5; g.add(beam);
    const tex = makeTextTexture(lines, { bg: '#ffd23c', fg: '#8a1216', w: 1024, h: 192, border: '#d8262c' });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 5.33), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
    board.position.set(0, 6.5, 0.3); g.add(board);
    const board2 = board.clone(); board2.position.z = -0.3; board2.rotation.y = Math.PI; g.add(board2);
    g.position.copy(pos); g.rotation.y = yaw;
    this.group.add(g);
  }

  /** Pulse the zone when the player is near. */
  update(t: number, near: boolean) {
    this.zoneMaterial.opacity = near ? 0.5 + 0.25 * Math.sin(t * 5) : 0.45;
  }
}
