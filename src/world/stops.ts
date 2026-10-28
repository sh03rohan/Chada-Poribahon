import * as THREE from 'three';
import { WORLD } from '../config.ts';
import type { Road } from './road.ts';
import { makeTextTexture } from './textures.ts';
import { COLLIDERS } from './collision.ts';
import { ROUTE } from '../routes.ts';
import { Person, PeopleManager, VARIANTS } from './people.ts';

/**
 * Passenger stops along the route (WORLD.stops): painted stop zone on the left lane, a bus shed with
 * a name board, and waiting passengers (humanoids) who walk to the door when the bus dwells.
 * Also the Kushtia / Dhaka gates.
 */
export class Stops {
  readonly group = new THREE.Group();
  readonly zoneMaterials: THREE.MeshStandardMaterial[] = [];
  /** per stop: people standing at the shed (removed as they board) */
  readonly waiting: Person[][] = [];
  /** per stop: world position just off the road where boarding passengers gather (shed front) */
  readonly shedFront: THREE.Vector3[] = [];

  constructor(private road: Road, private people: PeopleManager) {
    WORLD.stops.forEach((st, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffd23c, transparent: true, opacity: 0.55, roughness: 0.9, depthWrite: false, side: THREE.DoubleSide });
      this.zoneMaterials.push(mat);
      this.buildStopZone(st.s, mat);
      this.buildShed(st.s, st.name, st.waiting, i);
    });
    this.buildGate(WORLD.finishS, ROUTE.names.finishGate);
    this.buildGate(40, ROUTE.names.startGate);
  }

  private frameAt(s: number, lateral: number) {
    const f = this.road.sample(s);
    const bl = this.road.bulge(s);
    const lat = lateral + Math.sign(lateral) * bl;
    return { pos: new THREE.Vector3(f.x + f.rx * lat, 0, f.z + f.rz * lat), yaw: Math.atan2(-f.tx, -f.tz) };
  }

  private buildStopZone(sc: number, mat: THREE.MeshStandardMaterial) {
    const s0 = sc - WORLD.stopZoneLength / 2, s1 = sc + WORLD.stopZoneLength / 2;
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
    const zone = new THREE.Mesh(g, mat); zone.renderOrder = 1; this.group.add(zone);
    const t = makeTextTexture(['বাস'], { bg: 'rgba(0,0,0,0)', fg: '#fff', w: 256, h: 128 });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    const f = this.frameAt(sc, -WORLD.roadWidth / 4);
    label.position.copy(f.pos).setY(0.02); label.rotation.set(-Math.PI / 2, 0, 0); label.rotateZ(f.yaw); label.renderOrder = 2;
    this.group.add(label);
  }

  private buildShed(sc: number, name: string, waiting: number, index: number) {
    const lateral = -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 2.2);
    const { pos, yaw } = this.frameAt(sc, lateral);
    const y = this.road.footpathHeight(sc);
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8a2f1d, roughness: 0.7 });
    for (const [x, z] of [[-3.5, -1.2], [3.5, -1.2], [-3.5, 1.2], [3.5, 1.2]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3, 0.18), postMat); p.position.set(x, 1.5, z); p.castShadow = true; g.add(p);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 3.2), new THREE.MeshStandardMaterial({ color: 0x3f7cb0, roughness: 0.5, metalness: 0.5 }));
    roof.position.y = 3.05; roof.castShadow = true; g.add(roof);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0xd8b070 })); bench.position.set(0, 0.5, -0.9); g.add(bench);
    const back = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 0.08), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 })); back.position.set(0, 1.9, -1.3); g.add(back);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ map: makeTextTexture([`${name} বাস স্ট্যান্ড`], { bg: '#1f9d55', fg: '#fff', w: 1024, h: 192, border: '#ffd23c' }), roughness: 0.6 }));
    sign.position.set(0, 3.7, 0.4); g.add(sign);
    g.position.copy(pos).setY(y); g.rotation.y = yaw + Math.PI / 2;
    this.group.add(g);
    COLLIDERS.addBox(pos.x, pos.z, g.rotation.y, 8, 3.2);
    // the gathering point just in front of the shed, on the footpath edge
    this.shedFront.push(this.frameAt(sc - 4, -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.5)).pos.setY(y));
    // waiting passengers
    const list: Person[] = [];
    for (let i = 0; i < waiting; i++) {
      const p = new Person(VARIANTS[(index * 5 + i * 3) % VARIANTS.length]);
      const f = this.frameAt(sc - 3.5 + (i % 6) * 1.2, -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 1.0 + Math.floor(i / 6) * 1.1));
      p.position.copy(f.pos).setY(y); p.lookAt(f.pos.x + (pos.x - f.pos.x) * -1, f.pos.z + (pos.z - f.pos.z) * -1); // face the road
      p.setAction(i % 3 === 0 ? 'talk' : i % 3 === 1 ? 'queue' : 'phonecall');
      this.group.add(p.root); this.people.add(p); list.push(p);
    }
    this.waiting.push(list);
  }

  private buildGate(s: number, lines: string[]) {
    const { pos, yaw } = this.frameAt(s, 0);
    const g = new THREE.Group();
    const w = WORLD.roadWidth + WORLD.shoulderWidth * 2 + 1 + this.road.bulge(s) * 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8262c, roughness: 0.6 });
    for (const x of [-w / 2, w / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.5, 0.5), mat); p.position.set(x, 3.25, 0); p.castShadow = true; g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 1.4, 0.5), mat); beam.position.y = 6.5; g.add(beam);
    const tex = makeTextTexture(lines, { bg: '#ffd23c', fg: '#8a1216', w: 1024, h: 192, border: '#d8262c' });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 5.33), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
    board.position.set(0, 6.5, 0.3); g.add(board);
    const board2 = board.clone(); board2.position.z = -0.3; board2.rotation.y = Math.PI; g.add(board2);
    g.position.copy(pos); g.rotation.y = yaw;
    this.group.add(g);
    for (const x of [-w / 2, w / 2]) COLLIDERS.add(pos.x + Math.cos(yaw) * x, pos.z - Math.sin(yaw) * x, 0.4);
  }

  /** Remove a waiting person (boarded). */
  board(stop: number, p: Person) {
    const list = this.waiting[stop]; const i = list.indexOf(p); if (i >= 0) list.splice(i, 1);
    this.group.remove(p.root); this.people.remove(p);
  }

  /** Pulse the nearest zone when the player is close. */
  update(t: number, s: number) {
    WORLD.stops.forEach((st, i) => { this.zoneMaterials[i].opacity = Math.abs(s - st.s) < 150 ? 0.5 + 0.25 * Math.sin(t * 5) : 0.45; });
  }
}
