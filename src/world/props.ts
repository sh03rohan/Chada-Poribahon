import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD, type QualityTier } from '../config.ts';
import type { Road } from './road.ts';
import { makeTextTexture, makeWallTexture } from './textures.ts';
import { COLLIDERS } from './collision.ts';

/** Deterministic PRNG so the world is identical on every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

function placeAt(road: Road, s: number, lateral: number, y = 0): { pos: THREE.Vector3; yaw: number } {
  const f = road.sample(s);
  return { pos: new THREE.Vector3(f.x + f.rx * lateral, y, f.z + f.rz * lateral), yaw: Math.atan2(-f.tx, -f.tz) };
}

function colored(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function treeGeometry(kind: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 0) { // broad tree (mango/rain tree)
    parts.push(colored(new THREE.CylinderGeometry(0.22, 0.38, 3.2, 6).translate(0, 1.6, 0), 0x5a3d22));
    for (let i = 0; i < 4; i++) {
      const r = 1.6 + Math.random() * 0.9;
      const g = new THREE.IcosahedronGeometry(r, 1).translate((Math.random() - 0.5) * 2.2, 3.6 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2);
      parts.push(colored(g, new THREE.Color().setHSL(0.26 + Math.random() * 0.06, 0.55, 0.24 + Math.random() * 0.1)));
    }
  } else if (kind === 1) { // palm / coconut
    parts.push(colored(new THREE.CylinderGeometry(0.14, 0.24, 7, 6).translate(0.3, 3.5, 0), 0x7a6a4a));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const g = new THREE.BoxGeometry(2.6, 0.08, 0.5);
      g.translate(1.3, 0, 0).rotateZ(-0.5).rotateY(a).translate(0.3, 7, 0);
      parts.push(colored(g, 0x3d7a2a));
    }
  } else { // banana clump / bush
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.6, 2.4, 0.08).translate(0, 1.2, 0).rotateZ(0.35).rotateY(a);
      parts.push(colored(g, 0x4f9a35));
    }
  }
  // IcosahedronGeometry is non-indexed while Box/Cylinder are indexed; merge needs them uniform.
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
}

export class Props {
  readonly group = new THREE.Group();
  readonly nightEmissives: THREE.MeshStandardMaterial[] = [];
  private rand = rng(1234);

  /**
   * @param exclude returns true where nothing may be placed (branch road / junction side-road corridors).
   */
  constructor(private road: Road, tier: QualityTier, anisotropy: number, private exclude: (x: number, z: number) => boolean = () => false) {
    const density = WORLD.propDensity[tier];
    this.addTrees(density);
    this.addPoles();
    this.addLampPosts();
    this.addShopsAndBuildings(anisotropy);
    this.addSigns();
    this.addBridge(tier);
    this.addMilestones();
  }

  private addTrees(density: number) {
    const total = Math.floor((this.road.length / 1000) * WORLD.treesPerKm * density);
    const kinds = [treeGeometry(0), treeGeometry(1), treeGeometry(2)];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const perKind = [Math.floor(total * 0.55), Math.floor(total * 0.25), Math.floor(total * 0.2)];
    kinds.forEach((geo, k) => {
      const mesh = new THREE.InstancedMesh(geo, mat, perKind[k]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      for (let i = 0; i < perKind[k]; i++) {
        const s = this.rand() * this.road.length;
        const side = this.rand() < 0.5 ? -1 : 1;
        const near = this.rand() < 0.55;
        const lat = side * (near ? 7.5 + this.rand() * 9 : 18 + this.rand() * 45);
        // No trees in the river section
        if (s > WORLD.bridgeStartS - 40 && s < WORLD.bridgeEndS + 40) { _s.setScalar(0.0001); _m.compose(_p.set(0, -10, 0), _q, _s); mesh.setMatrixAt(i, _m); continue; }
        const { pos, yaw } = placeAt(this.road, s, lat);
        if (this.exclude(pos.x, pos.z)) { _s.setScalar(0.0001); _m.compose(_p.set(0, -10, 0), _q, _s); mesh.setMatrixAt(i, _m); continue; }
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + this.rand() * 6.28);
        const sc = 0.75 + this.rand() * 0.6;
        _s.set(sc, sc * (0.9 + this.rand() * 0.3), sc);
        _m.compose(pos, _q, _s); mesh.setMatrixAt(i, _m);
        COLLIDERS.add(pos.x, pos.z, k === 2 ? 0.6 * sc : 0.4 * sc);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    });
  }

  private addPoles() {
    const spacing = WORLD.polesSpacing;
    const n = Math.floor(this.road.length / spacing);
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.11, 0.16, 8.5, 6).translate(0, 4.25, 0),
      new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, 8.2, 0),
      new THREE.BoxGeometry(1.2, 0.1, 0.1).translate(0, 7.6, 0),
    ])!;
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c8c86, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(poleGeo, mat, n);
    mesh.castShadow = true;
    const wirePts: number[] = [];
    let prev: THREE.Vector3[] | null = null;
    const lat = -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 1.2); // left side
    for (let i = 0; i < n; i++) {
      const s = i * spacing + 10;
      const { pos, yaw } = placeAt(this.road, s, lat);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      _m.compose(pos, _q, _s.set(1, 1, 1)); mesh.setMatrixAt(i, _m);
      COLLIDERS.add(pos.x, pos.z, 0.22);
      // wire anchor points (3 wires on the crossarms)
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const anchors = [
        pos.clone().addScaledVector(right, -0.7).add(new THREE.Vector3(0, 8.25, 0)),
        pos.clone().addScaledVector(right, 0.7).add(new THREE.Vector3(0, 8.25, 0)),
        pos.clone().addScaledVector(right, -0.5).add(new THREE.Vector3(0, 7.65, 0)),
      ];
      if (prev) {
        for (let w = 0; w < 3; w++) {
          const a = prev[w], b = anchors[w];
          const segs = 6;
          for (let k = 0; k < segs; k++) {
            const t0 = k / segs, t1 = (k + 1) / segs;
            const sag = (t: number) => -0.9 * Math.sin(t * Math.PI);
            wirePts.push(
              a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0 + sag(t0), a.z + (b.z - a.z) * t0,
              a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1 + sag(t1), a.z + (b.z - a.z) * t1,
            );
          }
        }
      }
      prev = anchors;
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePts), 3));
    const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
    wires.frustumCulled = false;
    this.group.add(wires);
  }

  private addLampPosts() {
    const places: number[] = [];
    for (const c of [WORLD.rajbariStopS, WORLD.finishS - 200]) for (let s = c - 180; s <= c + 180; s += 28) places.push(s);
    const geo = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.12, 7, 6).translate(0, 3.5, 0),
      new THREE.BoxGeometry(1.8, 0.08, 0.08).translate(0.9, 7, 0),
    ])!;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.7, metalness: 0.4 });
    const mesh = new THREE.InstancedMesh(geo, mat, places.length);
    const lampGeo = new THREE.BoxGeometry(0.5, 0.14, 0.26);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd27a, emissiveIntensity: 0 });
    this.nightEmissives.push(lampMat);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, places.length);
    places.forEach((s, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const { pos, yaw } = placeAt(this.road, s, side * (WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.3));
      // arm points toward the road
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + (side > 0 ? Math.PI : 0));
      _m.compose(pos, _q, _s.set(1, 1, 1)); mesh.setMatrixAt(i, _m);
      COLLIDERS.add(pos.x, pos.z, 0.18);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      _m.compose(pos.clone().addScaledVector(right, -side * 1.75).add(new THREE.Vector3(0, 6.95, 0)), _q, _s); lamps.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true; lamps.instanceMatrix.needsUpdate = true;
    this.group.add(mesh, lamps);
  }

  private addShopsAndBuildings(anisotropy: number) {
    const shopNames = ['চা স্টল', 'হোটেল আল-মদিনা', 'মা ভ্যারাইটিজ স্টোর', 'ফার্মেসী', 'মোবাইল সার্ভিসিং', 'ভাই ভাই টেলিকম', 'জনতা হোটেল', 'ফলের দোকান'];
    const wallTex = [makeWallTexture('#c9b98a', anisotropy, false), makeWallTexture('#9fb8c2', anisotropy, false), makeWallTexture('#d8c8b0', anisotropy, false)];
    const tinMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.55, metalness: 0.6 });
    const signTex = shopNames.map((n, i) => makeTextTexture([n], { bg: ['#d8262c', '#1f6fb5', '#1f9d55', '#f2a900'][i % 4], fg: '#fff', w: 512, h: 128, border: '#fff' }));
    const clusters = [
      { s: WORLD.rajbariStopS, n: 10, spread: 160 },
      { s: 1150, n: 4, spread: 90 },
      { s: WORLD.andolonS - 300, n: 5, spread: 120 },
      { s: 4450, n: 4, spread: 80 },
      { s: 3560, n: 9, spread: 150 },
      { s: WORLD.finishS - 350, n: 16, spread: 260 },
    ];
    for (const c of clusters) {
      for (let i = 0; i < c.n; i++) {
        const s = c.s + (this.rand() - 0.5) * c.spread * 2;
        if (Math.abs(s - WORLD.rajbariStopS) < 30 && this.rand() < 0.7) continue; // keep shed area clear
        const side = this.rand() < 0.5 ? -1 : 1;
        const w = 3 + this.rand() * 3, d = 2.5 + this.rand() * 2, h = 2.6 + this.rand() * 0.8;
        const { pos, yaw } = placeAt(this.road, s, side * (WORLD.roadWidth / 2 + WORLD.shoulderWidth + 2.2 + d / 2 + this.rand() * 2));
        if (this.exclude(pos.x, pos.z)) continue;
        const shop = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: wallTex[i % 3], roughness: 0.9 }));
        body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.08, d + 0.8), tinMat);
        roof.position.set(0, h + 0.05, -0.2); roof.rotation.x = 0.08;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, w * 0.9 / 4), new THREE.MeshStandardMaterial({ map: signTex[i % signTex.length], roughness: 0.6 }));
        sign.position.set(0, h - 0.4, d / 2 + 0.03);
        shop.add(body, roof, sign);
        // face the road: the front (+z local) toward road centre
        shop.position.copy(pos);
        shop.rotation.y = yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        this.group.add(shop);
        COLLIDERS.addBox(pos.x, pos.z, shop.rotation.y, w, d);
      }
    }
    // Faridpur: mid-rise cluster around the roundabout
    for (let i = 0; i < 10; i++) {
      const s = 3560 - 200 + this.rand() * 400;
      const side = this.rand() < 0.5 ? -1 : 1;
      const floors = 2 + Math.floor(this.rand() * 4);
      const w = 8 + this.rand() * 6, d = 7 + this.rand() * 5, h = floors * 3.1;
      const { pos, yaw } = placeAt(this.road, s, side * (20 + this.rand() * 16));
      if (this.exclude(pos.x, pos.z)) continue;
      const tex = makeWallTexture(['#cfd4d8', '#e0c9a8', '#b9c7d1'][i % 3], anisotropy); tex.repeat.set(w / 4, floors); tex.needsUpdate = true;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      b.position.copy(pos).setY(h / 2); b.rotation.y = yaw; b.castShadow = true; COLLIDERS.addBox(b.position.x, b.position.z, b.rotation.y, w, d);
      this.group.add(b);
    }
    // Taller buildings near Dhaka
    const bTex = [makeWallTexture('#cfd4d8', anisotropy), makeWallTexture('#e0c9a8', anisotropy), makeWallTexture('#b9c7d1', anisotropy)];
    for (let i = 0; i < 26; i++) {
      const s = WORLD.finishS - 600 + this.rand() * 560;
      const side = this.rand() < 0.5 ? -1 : 1;
      const floors = 3 + Math.floor(this.rand() * 6);
      const w = 8 + this.rand() * 8, d = 8 + this.rand() * 6, h = floors * 3.1;
      const { pos, yaw } = placeAt(this.road, s, side * (18 + this.rand() * 20));
      if (this.exclude(pos.x, pos.z)) continue;
      const tex = bTex[i % 3].clone(); tex.repeat.set(w / 4, floors / 1.0); tex.needsUpdate = true;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      b.position.copy(pos).setY(h / 2); b.rotation.y = yaw + (this.rand() - 0.5) * 0.4;
      b.castShadow = true;
      this.group.add(b);
    }
    // Rajbari-ish low buildings
    for (let i = 0; i < 8; i++) {
      const s = WORLD.rajbariStopS - 250 + this.rand() * 500;
      const side = this.rand() < 0.5 ? -1 : 1;
      const w = 7 + this.rand() * 5, d = 6 + this.rand() * 4, h = 2 * 3.1;
      const { pos, yaw } = placeAt(this.road, s, side * (16 + this.rand() * 14));
      if (this.exclude(pos.x, pos.z)) continue;
      const tex = bTex[(i + 1) % 3].clone(); tex.repeat.set(w / 4, 2); tex.needsUpdate = true;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      b.position.copy(pos).setY(h / 2); b.rotation.y = yaw; b.castShadow = true; COLLIDERS.addBox(b.position.x, b.position.z, b.rotation.y, w, d);
      this.group.add(b);
    }
  }

  private addSigns() {
    const signs: [number, string[], string][] = [
      [350, ['রাজবাড়ী ১.৬ কিমি', 'ঢাকা ৫.৭ কিমি'], '#1f6fb5'],
      [1700, ['রাজবাড়ী বাস স্ট্যান্ড', 'সামনে থামুন'], '#1f9d55'],
      [2600, ['ফরিদপুর', 'সাবধানে চালান'], '#1f6fb5'],
      [3400, ['গতিসীমা', '৮০'], '#d8262c'],
      [WORLD.bridgeStartS - 120, ['পদ্মা সেতু', 'গতি কমান'], '#1f6fb5'],
      [WORLD.finishS - 700, ['ঢাকা ০.৭ কিমি', 'স্বাগতম'], '#1f9d55'],
    ];
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.6, metalness: 0.5 });
    for (const [s, lines, bg] of signs) {
      const tex = makeTextTexture(lines, { bg, fg: '#fff', w: 512, h: 256, border: '#fff' });
      // Left-hand traffic → drivers keep left → signs stand on the LEFT shoulder (negative lateral)
      const place = placeAt(this.road, s, -(WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.6));
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), postMat); post.position.y = 1.6;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, side: THREE.DoubleSide }));
      panel.position.y = 3.2;
      g.add(post, panel);
      g.position.copy(place.pos); g.rotation.y = place.yaw; // plane faces +z local = toward oncoming driver
      this.group.add(g);
      COLLIDERS.add(place.pos.x, place.pos.z, 0.15);
    }
  }

  private addMilestones() {
    const geo = new THREE.BoxGeometry(0.3, 0.6, 0.2).translate(0, 0.3, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2e7c4, roughness: 0.8 });
    const n = Math.floor(this.road.length / 100);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
      const { pos, yaw } = placeAt(this.road, i * 100 + 50, -(WORLD.roadWidth / 2 + WORLD.shoulderWidth - 0.3));
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      _m.compose(pos, _q, _s.set(1, 1, 1)); mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Padma bridge-ish section: river on both sides, railings, raised deck look. */
  private addBridge(tier: QualityTier) {
    const s0 = WORLD.bridgeStartS, s1 = WORLD.bridgeEndS;
    const water = new THREE.MeshStandardMaterial({ color: 0x3b6e8f, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const pts: number[] = [];
      const idx: number[] = [];
      let k = 0;
      for (let s = s0; s <= s1; s += 20) {
        const a = placeAt(this.road, s, side * (WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.5));
        const b = placeAt(this.road, s, side * 260);
        pts.push(a.pos.x, -0.6, a.pos.z, b.pos.x, -0.6, b.pos.z);
        if (s > s0) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        k += 2;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, water);
      this.group.add(m);
    }
    // Railings
    const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.5, metalness: 0.6 });
    const n = Math.floor((s1 - s0) / 3) * 2;
    const posts = new THREE.InstancedMesh(postGeo, postMat, n);
    let i = 0;
    const railPts: number[] = [];
    for (const side of [-1, 1]) {
      let prev: THREE.Vector3 | null = null;
      for (let s = s0; s < s1; s += 3) {
        const { pos, yaw } = placeAt(this.road, s, side * (WORLD.roadWidth / 2 + WORLD.shoulderWidth));
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        _m.compose(pos, _q, _s.set(1, 1, 1)); posts.setMatrixAt(i++, _m);
        COLLIDERS.add(pos.x, pos.z, 0.5);
        if (prev) for (const y of [0.5, 1.05]) railPts.push(prev.x, prev.y + y, prev.z, pos.x, pos.y + y, pos.z);
        prev = pos;
      }
    }
    posts.count = i; posts.instanceMatrix.needsUpdate = true;
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(railPts), 3));
    const rails = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xd0d4d8 }));
    rails.frustumCulled = false;
    this.group.add(posts, rails);
    // Pylons (visual, tall) every 150 m
    if (tier !== 'low') {
      const pyGeo = new THREE.BoxGeometry(1.2, 14, 1.2).translate(0, 5, 0);
      const pyMat = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.8 });
      const np = Math.floor((s1 - s0) / 150) * 2;
      const py = new THREE.InstancedMesh(pyGeo, pyMat, np);
      let j = 0;
      for (const side of [-1, 1]) for (let s = s0 + 75; s < s1; s += 150) {
        const { pos, yaw } = placeAt(this.road, s, side * (WORLD.roadWidth / 2 + WORLD.shoulderWidth + 0.8));
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        _m.compose(pos, _q, _s.set(1, 1, 1)); py.setMatrixAt(j++, _m);
        COLLIDERS.add(pos.x, pos.z, 0.9);
      }
      py.count = j; py.instanceMatrix.needsUpdate = true;
      this.group.add(py);
    }
  }

  setNight(on: boolean) {
    for (const m of this.nightEmissives) m.emissiveIntensity = on ? 2.5 : 0;
  }
}
