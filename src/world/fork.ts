import * as THREE from 'three';
import { WORLD } from '../config.ts';
import { Road, BRANCH_ROUTE } from './road.ts';
import { makeTextTexture } from './textures.ts';
import { Person, PeopleManager, VARIANTS } from './people.ts';

/**
 * The route fork: a branch road peels off to the right toward "দৌলতদিয়া ঘাট" and dead-ends in a
 * ferry queue with a turnaround pad. Big gantry signboards mark the correct (Padma) way.
 */
export class Fork {
  readonly group = new THREE.Group();
  readonly branch: Road;
  readonly forkS = WORLD.forkS;
  private queue: Person[] = [];

  constructor(main: Road, anisotropy: number, people: PeopleManager) {
    const f = main.sample(this.forkS);
    // branch starts on the main centreline, same heading
    this.branch = new Road(anisotropy, { route: BRANCH_ROUTE, start: { x: f.x, z: f.z, yaw: main.yawAt(this.forkS) }, ground: false });
    this.branch.group.position.y = -0.004; // sits a hair below the main road where they overlap
    this.group.add(this.branch.group);

    // Turnaround pad at the end
    const end = this.branch.sample(this.branch.length - 2);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(16, 28), new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 1 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(end.x + end.tx * 8, -0.006, end.z + end.tz * 8);
    this.group.add(pad);

    // Signboards at the fork (gantry across the road, 90 m before the split)
    const sf = main.sample(this.forkS - 90);
    const gantry = new THREE.Group();
    const post = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.5 });
    const w = WORLD.roadWidth + WORLD.shoulderWidth * 2 + 2;
    for (const x of [-w / 2, w / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 0.35), post); p.position.set(x, 3.5, 0); gantry.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, 0.3), post); beam.position.y = 7; gantry.add(beam);
    const boardL = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), new THREE.MeshStandardMaterial({ map: makeTextTexture(['ঢাকা ➜ পদ্মা সেতু', '↑ সোজা'], { bg: '#1f6fb5', fg: '#fff', w: 1024, h: 400, border: '#fff' }), roughness: 0.5, side: THREE.DoubleSide }));
    boardL.position.set(-2.9, 5.6, 0.2); gantry.add(boardL);
    const boardR = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), new THREE.MeshStandardMaterial({ map: makeTextTexture(['দৌলতদিয়া ঘাট ➜', 'ফেরি'], { bg: '#1f9d55', fg: '#fff', w: 1024, h: 400, border: '#fff' }), roughness: 0.5, side: THREE.DoubleSide }));
    boardR.position.set(2.9, 5.6, 0.2); gantry.add(boardR);
    gantry.position.set(sf.x, 0, sf.z); gantry.rotation.y = main.yawAt(this.forkS - 90);
    this.group.add(gantry);
    // Roadside repeat sign right at the split
    const ss = this.branch.sample(70);
    const side = new THREE.Group();
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 6), post); sp.position.y = 1.75; side.add(sp);
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.3), new THREE.MeshStandardMaterial({ map: makeTextTexture(['ফেরি ঘাট ২ কিমি', 'ভারী যানবাহন লাইন'], { bg: '#d8262c', fg: '#fff', w: 1024, h: 440, border: '#fff' }), roughness: 0.5, side: THREE.DoubleSide }));
    sb.position.y = 3.5; side.add(sb);
    side.position.set(ss.x + ss.rx * -5.5, 0, ss.z + ss.rz * -5.5); side.rotation.y = this.branch.yawAt(70);
    this.group.add(side);

    // Ferry queue: parked trucks/buses along the right of the branch + people waiting
    const truckMat = new THREE.MeshStandardMaterial({ color: 0x3a5a9a, roughness: 0.7 });
    const cargoMat = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.9 });
    for (let i = 0; i < 7; i++) {
      const s = this.branch.length - 40 - i * 12;
      const q = this.branch.sample(s);
      const t = new THREE.Group();
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.2, 2.2), truckMat); cab.position.set(0, 1.6, -3.4);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 6), i % 2 ? cargoMat : new THREE.MeshStandardMaterial({ color: 0x1f9d55 })); box.position.set(0, 2.0, 1.6);
      t.add(cab, box);
      t.position.set(q.x + q.rx * 1.8, 0, q.z + q.rz * 1.8); t.rotation.y = this.branch.yawAt(s);
      this.group.add(t);
    }
    for (let i = 0; i < 6; i++) {
      const s = this.branch.length - 50 - i * 9;
      const q = this.branch.sample(s);
      const p = new Person(VARIANTS[(i * 7 + 3) % VARIANTS.length]);
      p.position.set(q.x + q.rx * 4.2, 0, q.z + q.rz * 4.2); p.lookAt(q.x, q.z); p.setAction(i % 3 === 0 ? 'talk' : i % 3 === 1 ? 'queue' : 'phonecall');
      this.group.add(p.root); people.add(p); this.queue.push(p);
    }
  }

  /** s on the branch and lateral, if the point lies on the branch beyond the overlap with the main road. */
  locate(x: number, z: number, hint: number): { onBranch: boolean; s: number; lateral: number } {
    const l = this.branch.locate(x, z, hint);
    const onBranch = l.s > 35 && l.s < this.branch.length - 1 && Math.abs(l.lateral) < WORLD.roadWidth / 2 + WORLD.shoulderWidth + 14;
    return { onBranch, s: l.s, lateral: l.lateral };
  }
}
