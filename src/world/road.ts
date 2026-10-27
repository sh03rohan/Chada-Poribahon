import * as THREE from 'three';
import { WORLD } from '../config.ts';
import { makeRoadTextures, makeDirtTexture, makeGrassTexture } from './textures.ts';

/** Route definition: [length m, total turn deg (+ right, − left)] */
export const MAIN_ROUTE: [number, number][] = [
  [350, 0], [400, 35], [300, 0], [450, -50], [250, 0],
  [450, 0],            // Rajbari straight (stop at s=2000)
  [350, -40], [300, 25], [400, 0], [500, -60],
  [350, 0],            // Faridpur straight (andolon at s=3850)
  [300, 45], [250, 0],
  [700, 0],            // Padma bridge section
  [300, -30], [500, 0], // Dhaka approach (finish at 6050)
];

export interface RoadSample { x: number; z: number; tx: number; tz: number; rx: number; rz: number; s: number; }

/** Wrong-turn branch at the fork: bends right, runs to a ferry-ghat queue, ends in a turnaround pad. */
export const BRANCH_ROUTE: [number, number][] = [[60, 0], [140, 38], [230, 0], [60, -12], [40, 0]];

export interface RoadOptions { route?: [number, number][]; start?: { x: number; z: number; yaw: number }; ground?: boolean; roundabouts?: number[]; }

export class Road {
  readonly spacing = WORLD.frameSpacing;
  private route: [number, number][];
  private start: { x: number; z: number; yaw: number };
  private roundabouts: number[];

  /** Extra lateral half-width at s (the road splits around roundabout islands). 0 elsewhere. */
  bulge(s: number): number {
    let b = 0;
    for (const sc of this.roundabouts) {
      const d = Math.abs(s - sc) / WORLD.roundaboutHalfLength;
      if (d < 1) b = Math.max(b, WORLD.roundaboutBulge * (0.5 - 0.5 * Math.cos(Math.PI * (1 - d))));
    }
    return b;
  }
  px!: Float32Array; pz!: Float32Array; tx!: Float32Array; tz!: Float32Array;
  count = 0;
  length = 0;
  bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  readonly group = new THREE.Group();
  roadMaterial!: THREE.MeshStandardMaterial;
  private roadTex!: ReturnType<typeof makeRoadTextures>;

  constructor(anisotropy: number, opts: RoadOptions = {}) {
    this.route = opts.route ?? MAIN_ROUTE;
    this.start = opts.start ?? { x: 0, z: 0, yaw: 0 };
    this.roundabouts = opts.roundabouts ?? [];
    this.buildFrames();
    this.buildMeshes(anisotropy, opts.ground ?? true);
  }

  private buildFrames() {
    const step = 0.5;
    // Curvature profile along s, with 50 m linear ramps at segment boundaries (poor-man's clothoid)
    const ROUTE = this.route;
    const total = ROUTE.reduce((a, r) => a + r[0], 0);
    const n = Math.ceil(total / step);
    const curv = new Float32Array(n);
    let s0 = 0;
    for (const [len, deg] of ROUTE) {
      const k = (deg * Math.PI / 180) / len; // rad per m
      const i0 = Math.floor(s0 / step), i1 = Math.min(n, Math.floor((s0 + len) / step));
      for (let i = i0; i < i1; i++) curv[i] = k;
      s0 += len;
    }
    // smooth curvature (box blur ~ 60 m)
    const half = Math.floor(30 / step);
    const sm = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += curv[i];
      if (i - 2 * half - 1 >= 0) acc -= curv[i - 2 * half - 1];
      const cnt = Math.min(i + 1, 2 * half + 1);
      sm[Math.max(0, i - half)] = acc / cnt;
    }
    // integrate
    const every = Math.round(this.spacing / step);
    const frames = Math.floor(n / every) + 1;
    this.px = new Float32Array(frames); this.pz = new Float32Array(frames);
    this.tx = new Float32Array(frames); this.tz = new Float32Array(frames);
    let x = this.start.x, z = this.start.z, yaw = this.start.yaw, fi = 0;
    for (let i = 0; i < n; i++) {
      if (i % every === 0 && fi < frames) {
        this.px[fi] = x; this.pz[fi] = z;
        this.tx[fi] = -Math.sin(yaw); this.tz[fi] = -Math.cos(yaw);
        fi++;
      }
      // right turn (+curvature) = clockwise from above = negative yaw
      yaw -= sm[i] * step;
      x += -Math.sin(yaw) * step; z += -Math.cos(yaw) * step;
    }
    this.count = fi;
    this.length = (fi - 1) * this.spacing;
    const b = this.bounds;
    b.minX = Infinity; b.maxX = -Infinity; b.minZ = Infinity; b.maxZ = -Infinity;
    for (let i = 0; i < fi; i++) {
      b.minX = Math.min(b.minX, this.px[i]); b.maxX = Math.max(b.maxX, this.px[i]);
      b.minZ = Math.min(b.minZ, this.pz[i]); b.maxZ = Math.max(b.maxZ, this.pz[i]);
    }
  }

  /** Sample the centreline at distance s (clamped). */
  sample(s: number, out: RoadSample = { x: 0, z: 0, tx: 0, tz: 0, rx: 0, rz: 0, s: 0 }): RoadSample {
    const f = Math.max(0, Math.min(this.count - 1.0001, s / this.spacing));
    const i = Math.floor(f), t = f - i;
    const j = Math.min(i + 1, this.count - 1);
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.tx = tx; out.tz = tz; out.rx = -tz; out.rz = tx; out.s = s;
    return out;
  }

  /** Heading (yaw) of the road at s, in the vehicle convention (forward = (-sin yaw, -cos yaw)). */
  yawAt(s: number): number {
    const p = this.sample(s);
    return Math.atan2(-p.tx, -p.tz);
  }

  /**
   * Nearest point on the centreline to (x,z). `hint` is the previous s for an incremental local search.
   * Returns s and signed lateral offset (+ = right of travel direction).
   */
  locate(x: number, z: number, hint: number): { s: number; lateral: number } {
    let i = Math.max(0, Math.min(this.count - 1, Math.round(hint / this.spacing)));
    const d2 = (k: number) => { const dx = x - this.px[k], dz = z - this.pz[k]; return dx * dx + dz * dz; };
    let best = d2(i);
    // walk downhill
    for (let iter = 0; iter < 400; iter++) {
      const dn = i > 0 ? d2(i - 1) : Infinity, up = i < this.count - 1 ? d2(i + 1) : Infinity;
      if (dn < best) { best = dn; i--; } else if (up < best) { best = up; i++; } else break;
    }
    // project onto segment i→i+1 (or i-1→i)
    const j = i < this.count - 1 ? i + 1 : i - 1;
    const ax = this.px[i], az = this.pz[i], bx = this.px[j], bz = this.pz[j];
    const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
    let t = ((x - ax) * vx + (z - az) * vz) / len2;
    t = Math.max(-1, Math.min(1, t));
    const s = (i + (j > i ? t : -t)) * this.spacing;
    const tx = this.tx[i], tz = this.tz[i];
    const cx = ax + vx * t, cz = az + vz * t;
    const lateral = (x - cx) * -tz + (z - cz) * tx;
    return { s, lateral };
  }

  private buildMeshes(anisotropy: number, withGround: boolean) {
    const hw = WORLD.roadWidth / 2, sh = WORLD.shoulderWidth;
    const n = this.count;
    // Ground sits well below the tarmac (GROUND_Y) and the shoulders slope down to meet it. Keeping the
    // two surfaces apart matters: a near-coplanar giant ground quad can win the depth test against the
    // road at grazing angles (seen in the cockpit view on some rasterizers).
    const GROUND_Y = -0.09;
    const makeStrip = (offA: number, offB: number, yA: number, yB: number, vScale: number, uRepeatAcross: number) => {
      const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), nrm = new Float32Array(n * 2 * 3);
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const rx = -this.tz[i], rz = this.tx[i];
        const s = i * this.spacing;
        const bl = this.bulge(s);
        const oa = offA + (offA < 0 ? -bl : bl), ob = offB + (offB < 0 ? -bl : bl);
        pos.set([this.px[i] + rx * oa, yA, this.pz[i] + rz * oa], i * 6);
        pos.set([this.px[i] + rx * ob, yB, this.pz[i] + rz * ob], i * 6 + 3);
        nrm.set([0, 1, 0, 0, 1, 0], i * 6);
        uv.set([0, s / vScale, uRepeatAcross, s / vScale], i * 4);
        // CCW seen from above (+y): left_i → right_i → left_{i+1}
        if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    };

    this.roadTex = makeRoadTextures(anisotropy);
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: this.roadTex.map, roughnessMap: this.roadTex.roughnessMap, roughness: 0.92, metalness: 0.0, color: 0xffffff,
    });
    const road = new THREE.Mesh(makeStrip(-hw, hw, 0, 0, WORLD.roadTextureTileLength, 1), this.roadMaterial);
    road.receiveShadow = true; road.name = 'road';
    this.group.add(road);

    const dirt = makeDirtTexture(anisotropy);
    const dirtMat = new THREE.MeshStandardMaterial({ map: dirt, roughness: 1, color: 0xcfc3a8 });
    const shL = new THREE.Mesh(makeStrip(-hw - sh, -hw + 0.02, GROUND_Y, -0.012, 4, 1), dirtMat);
    const shR = new THREE.Mesh(makeStrip(hw - 0.02, hw + sh, -0.012, GROUND_Y, 4, 1), dirtMat);
    shL.receiveShadow = shR.receiveShadow = true;
    this.group.add(shL, shR);

    if (!withGround) return;
    // Ground plane (subdivided so no single triangle spans kilometres)
    const b = this.bounds;
    const pad = 900;
    const gw = b.maxX - b.minX + pad * 2, gh = b.maxZ - b.minZ + pad * 2;
    const grass = makeGrassTexture(anisotropy);
    grass.repeat.set(gw / 14, gh / 14);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh, 48, 48), new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0xb9c2a6 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, GROUND_Y, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true; ground.name = 'ground';
    this.group.add(ground);
  }

  /** Wet look: lower roughness, slightly darker. */
  setWet(wet: number) {
    this.roadMaterial.roughness = 0.92 - 0.42 * wet;
    this.roadMaterial.metalness = 0.05 * wet;
    this.roadMaterial.color.setScalar(1 - 0.4 * wet);
    this.roadMaterial.envMapIntensity = 1 + 0.4 * wet;
  }
}
