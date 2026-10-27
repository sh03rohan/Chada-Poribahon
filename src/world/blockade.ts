import * as THREE from 'three';
import { WORLD, GAMEPLAY } from '../config.ts';
import type { Road } from './road.ts';
import { Person, PeopleManager, VARIANTS, POLICE_VARIANTS, type Action } from './people.ts';

export type BlockadePhase = 'idle' | 'waiting' | 'police' | 'dispersing' | 'cleared';

/**
 * Generic road-block ("andolon") event: burning tyres, smoke, a crowd, then a police van with
 * flashing lights arrives and the crowd disperses. No parties, flags, slogans or leaders.
 */
export class Blockade {
  readonly group = new THREE.Group();
  phase: BlockadePhase = 'idle';
  timer = 0;
  readonly crowd: Person[] = [];
  private crowdHome: THREE.Vector3[] = []; private crowdAction: Action[] = []; private crowdLook: THREE.Vector3[] = [];
  readonly police: Person[] = [];
  private crowdTarget: THREE.Vector3[] = [];
  private policeTarget: THREE.Vector3[] = [];
  private tyres: THREE.Group;
  private fire: THREE.Points;
  private smoke: THREE.Points;
  private firePos: Float32Array; private smokePos: Float32Array; private smokeAge: Float32Array;
  private fireCenters: THREE.Vector3[] = [];
  private van: THREE.Group;
  private vanLightR: THREE.MeshStandardMaterial; private vanLightB: THREE.MeshStandardMaterial;
  private vanFrom = new THREE.Vector3(); private vanTo = new THREE.Vector3();
  private fireLight: THREE.PointLight;
  private yaw = 0;
  private center = new THREE.Vector3();
  private right = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private clearedOffset = 0;
  private time = 0;

  constructor(private road: Road, lowTier: boolean, private people: PeopleManager) {
    const f = road.sample(WORLD.andolonS);
    this.center.set(f.x, 0, f.z);
    this.right.set(f.rx, 0, f.rz);
    this.forward.set(f.tx, 0, f.tz);
    this.yaw = Math.atan2(-f.tx, -f.tz);
    this.group.position.copy(this.center);
    this.group.rotation.y = this.yaw;

    // Tyres across the road (local: x = right, -z = forward)
    this.tyres = new THREE.Group();
    const tyreGeo = new THREE.TorusGeometry(0.45, 0.17, 8, 14);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });
    for (let i = 0; i < 9; i++) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      const x = -3 + i * 0.75 + (Math.random() - 0.5) * 0.3;
      const stacked = i % 3 === 0;
      t.position.set(x, stacked ? 0.17 : 0.45, (Math.random() - 0.5) * 0.8);
      t.rotation.set(stacked ? Math.PI / 2 : 0, Math.random() * 3, stacked ? 0 : Math.random() * 0.4);
      t.castShadow = true;
      this.tyres.add(t);
      if (i % 2 === 0) this.fireCenters.push(new THREE.Vector3(x, 0.5, t.position.z));
    }
    // Loose bricks / bamboo
    const brickMat = new THREE.MeshStandardMaterial({ color: 0x9a4a35, roughness: 0.9 });
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.12), brickMat);
      b.position.set((Math.random() - 0.5) * 7, 0.06, (Math.random() - 0.5) * 3 + 1);
      b.rotation.y = Math.random() * 3;
      this.tyres.add(b);
    }
    const bamboo = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6.5, 6), new THREE.MeshStandardMaterial({ color: 0xc9b26a }));
    bamboo.rotation.z = Math.PI / 2; bamboo.position.set(0, 0.9, -1.2);
    this.tyres.add(bamboo);
    this.group.add(this.tyres);

    // Fire + smoke particles
    const fireN = lowTier ? 160 : 360, smokeN = lowTier ? 120 : 260;
    this.firePos = new Float32Array(fireN * 3); this.smokePos = new Float32Array(smokeN * 3); this.smokeAge = new Float32Array(smokeN);
    for (let i = 0; i < fireN; i++) this.resetFire(i);
    for (let i = 0; i < smokeN; i++) { this.resetSmoke(i); this.smokeAge[i] = Math.random() * 4; }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(this.firePos, 3));
    this.fire = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.55, map: glowTexture('#ffb030'), color: 0xff8a20, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.6, map: glowTexture('#888'), color: 0x6a6a6a, transparent: true, opacity: 0.22, depthWrite: false }));
    this.fire.frustumCulled = this.smoke.frustumCulled = false;
    this.group.add(this.fire, this.smoke);
    this.fireLight = new THREE.PointLight(0xff7a20, lowTier ? 0 : 40, 25, 2);
    this.fireLight.position.set(0, 1.2, 0);
    this.group.add(this.fireLight);

    // Crowd: 20–28 humanoids in small groups — standing, sitting on the road, gesturing, filming.
    const n = lowTier ? 20 : 28;
    const groups = [[-2.5, -3.5], [1.5, -4.5], [-0.5, -7], [3, -8], [-3.5, -9.5]];
    const stand: Action[] = ['talk', 'idle', 'point', 'film', 'wave', 'talk', 'shield', 'idle', 'talk'];
    for (let i = 0; i < n; i++) {
      const v = VARIANTS[i % VARIANTS.length];
      const p = new Person(v);
      const g = groups[i % groups.length];
      const home = new THREE.Vector3(g[0] + (Math.random() - 0.5) * 2.2, 0, g[1] + (Math.random() - 0.5) * 2.2);
      p.position.copy(home);
      const sit = i % 5 === 2 || i % 7 === 4;
      p.setAction(sit ? 'sit' : stand[i % stand.length]);
      this.crowdHome.push(home.clone()); this.crowdAction.push(p.action);
      // face the group centre (or the fire for 'shield'), sitters face the bus
      const lk = p.action === 'shield' ? new THREE.Vector3(0, 0, 0) : sit ? new THREE.Vector3(home.x, 0, 10) : new THREE.Vector3(g[0] + (Math.random() - 0.5), 0, g[1] + (Math.random() - 0.5));
      p.lookAt(lk.x, lk.z); this.crowdLook.push(lk);
      const side = home.x > 0 ? 1 : -1;
      this.crowdTarget.push(new THREE.Vector3(side * (9 + Math.random() * 7), 0, home.z - 6 + Math.random() * 10));
      this.group.add(p.root); this.people.add(p); this.crowd.push(p);
    }
    // Police: 4–6 officers, arrive with the van and walk in calmly guiding the crowd away.
    const np = lowTier ? 4 : 6;
    for (let i = 0; i < np; i++) {
      const p = new Person(POLICE_VARIANTS[i % POLICE_VARIANTS.length]);
      p.position.set(2 + (i % 2) * 1.2, 0, -16 - Math.floor(i / 2) * 1.5); // start beside the van's stop point
      p.setAction('idle'); p.root.visible = false;
      this.policeTarget.push(new THREE.Vector3(-3 + i * 1.3, 0, -4.5 - (i % 3) * 1.5));
      this.group.add(p.root); this.people.add(p); this.police.push(p);
    }

    // Police van (generic white van with light bar)
    this.van = new THREE.Group();
    const vanBody = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.9, 5.2), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.2 }));
    vanBody.position.y = 1.4; vanBody.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.3, 5.22), new THREE.MeshStandardMaterial({ color: 0x1b3f8a }));
    stripe.position.y = 1.2;
    this.vanLightR = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 0 });
    this.vanLightB = new THREE.MeshStandardMaterial({ color: 0x2040ff, emissive: 0x0030ff, emissiveIntensity: 0 });
    const lr = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.4), this.vanLightR); lr.position.set(-0.45, 2.46, -1.2);
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.4), this.vanLightB); lb.position.set(0.45, 2.46, -1.2);
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515 });
    for (const [x, z] of [[-1.05, -1.6], [1.05, -1.6], [-1.05, 1.7], [1.05, 1.7]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.42, z); this.van.add(w);
    }
    this.van.add(vanBody, stripe, lr, lb);
    this.van.visible = false;
    this.group.add(this.van);
    // Van drives in from ahead (further along the route) on the right-hand lane, stops past the tyres.
    this.vanFrom.set(2.0, 0, -140); this.vanTo.set(2.0, 0, -12);
  }

  /** Distance (m) from a route position to the barrier line, or Infinity when cleared. */
  wallDistanceFrom(s: number): number {
    if (this.phase === 'cleared') return Infinity;
    const d = WORLD.andolonS - 1.2 - s;
    if (d < -3) return Infinity;   // already past the barrier (e.g. teleported) — nothing ahead
    return d > 0 ? d : 0;
  }

  get active(): boolean { return this.phase !== 'cleared'; }

  /** Cinematic hooks: jump the event forward. */
  forcePolice() { if (this.phase === 'idle' || this.phase === 'waiting') { this.phase = 'police'; this.timer = 0; this.van.visible = true; } }
  forceDisperse() { if (this.phase !== 'cleared' && this.phase !== 'dispersing') { this.phase = 'dispersing'; this.timer = 0; this.police.forEach((p, i) => { p.root.visible = true; p.position.copy(this.policeTarget[i]); p.setAction(i === 0 ? 'megaphone' : 'signal'); }); this.disperse(); } }
  /** Restart the event (new run). */
  reset() {
    this.phase = 'idle'; this.timer = 0; this.clearedOffset = 0; this.tyres.position.x = 0; this.van.visible = false; this.van.position.copy(this.vanFrom);
    this.crowd.forEach((p, i) => { p.target = null; p.position.copy(this.crowdHome[i]); p.setAction(this.crowdAction[i]); p.lookAt(this.crowdLook[i].x, this.crowdLook[i].z); });
    this.police.forEach((p, i) => { p.target = null; p.root.visible = false; p.position.set(2 + (i % 2) * 1.2, 0, -16 - Math.floor(i / 2) * 1.5); p.setAction('idle'); });
  }

  /** Called when the bus has stopped at the barrier the first time. */
  startWaiting() {
    if (this.phase === 'idle') { this.phase = 'waiting'; this.timer = 0; }
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    // Particles
    const burning = this.phase !== 'cleared' && this.phase !== 'dispersing';
    const fireAlpha = burning ? 1 : Math.max(0, 1 - this.clearedOffset);
    for (let i = 0; i < this.firePos.length / 3; i++) {
      const k = i * 3;
      this.firePos[k + 1] += dt * (1.6 + Math.random());
      this.firePos[k] += (Math.random() - 0.5) * dt * 0.8;
      if (this.firePos[k + 1] > 0.5 + Math.random() * 1.6) this.resetFire(i);
    }
    (this.fire.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.fire.material as THREE.PointsMaterial).opacity = 0.9 * fireAlpha;
    for (let i = 0; i < this.smokePos.length / 3; i++) {
      const k = i * 3;
      this.smokeAge[i] += dt;
      this.smokePos[k + 1] += dt * 1.4;
      this.smokePos[k] += dt * 0.9 + Math.sin(t + i) * dt * 0.3;   // drift right
      if (this.smokeAge[i] > 6) { this.resetSmoke(i); this.smokeAge[i] = 0; }
    }
    (this.smoke.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.smoke.material as THREE.PointsMaterial).opacity = 0.35 * fireAlpha;
    this.fireLight.intensity = (this.fireLight.intensity > 0 || burning ? 1 : 0) * (30 + Math.sin(t * 17) * 8 + Math.sin(t * 29) * 5) * fireAlpha;

    if (this.phase === 'waiting') {
      this.timer += dt;
      if (this.timer >= GAMEPLAY.policeArriveAfter) { this.phase = 'police'; this.timer = 0; this.van.visible = true; }
    } else if (this.phase === 'police') {
      this.timer += dt;
      const k = Math.min(1, this.timer / 6);
      const e = 1 - Math.pow(1 - k, 3);
      this.van.position.lerpVectors(this.vanFrom, this.vanTo, e);
      this.flash(t);
      // officers step out once the van has stopped and walk toward the crowd with hand signals
      if (this.timer > 4.5 && !this.police[0].root.visible) {
        this.police.forEach((p, i) => { p.root.visible = true; p.walkTo(this.policeTarget[i], i === 0 ? 'megaphone' : i % 2 ? 'signal' : 'point'); });
      }
      if (this.timer >= 6) { this.phase = 'dispersing'; this.timer = 0; this.disperse(); }
    } else if (this.phase === 'dispersing') {
      this.timer += dt;
      this.flash(t);
      const k = Math.min(1, this.timer / GAMEPLAY.crowdDisperseTime);
      this.clearedOffset = k;
      // Tyres get dragged to the side
      this.tyres.position.x = -9 * k;
      if (k >= 1) { this.phase = 'cleared'; this.fireLight.intensity = 0; this.police.forEach((p, i) => p.walkTo(new THREE.Vector3(2 + (i % 2) * 1.2, 0, -14 - i), 'idle')); }
    } else if (this.phase === 'cleared') {
      this.flash(t);
    }
  }

  /** Everyone stands up and walks off the road in loose order; nobody is pushed. */
  private disperse() {
    this.crowd.forEach((p, i) => {
      const delay = (i % 7) * 0.5 + Math.random() * 0.8;
      setTimeout(() => { if (this.phase !== 'idle') p.walkTo(this.crowdTarget[i], i % 4 === 0 ? 'talk' : i % 4 === 1 ? 'film' : 'idle'); }, delay * 1000);
    });
  }

  private flash(t: number) {
    const on = Math.floor(t * 4) % 2 === 0;
    this.vanLightR.emissiveIntensity = on ? 6 : 0.2;
    this.vanLightB.emissiveIntensity = on ? 0.2 : 6;
  }

  private resetFire(i: number) {
    const c = this.fireCenters[i % this.fireCenters.length];
    this.firePos[i * 3] = c.x + (Math.random() - 0.5) * 0.7;
    this.firePos[i * 3 + 1] = c.y - 0.3 + Math.random() * 0.3;
    this.firePos[i * 3 + 2] = c.z + (Math.random() - 0.5) * 0.7;
  }
  private resetSmoke(i: number) {
    const c = this.fireCenters[i % this.fireCenters.length];
    this.smokePos[i * 3] = c.x + (Math.random() - 0.5) * 1.2;
    this.smokePos[i * 3 + 1] = c.y + 0.6 + Math.random() * 0.5;
    this.smokePos[i * 3 + 2] = c.z + (Math.random() - 0.5) * 1.2;
  }
}

function glowTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, color); g.addColorStop(0.35, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
