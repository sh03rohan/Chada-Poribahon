import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Stylised low-poly humanoid factory + procedural animation.
 *
 * Every person is ONE SkinnedMesh (single draw call, ~700 tris) rigidly skinned to a 17-bone
 * skeleton. Geometry is built once per *variant* (outfit / hair / colours / proportions) and
 * shared by every person using that variant; one vertex-colour material is shared by all.
 *
 * Coordinates: person stands at origin, feet on y=0, FACING +Z (so Object3D.lookAt works).
 * Add a new variant: push a PersonVariant into VARIANTS (or build one with makeVariant()).
 */

export type Hair = 'short' | 'cap' | 'tupi' | 'gamchha' | 'hijab' | 'orna' | 'bun' | 'policecap';
export type Outfit = 'shirt-pants' | 'panjabi' | 'lungi-shirt' | 'saree' | 'school' | 'police' | 'driver' | 'helper';
export type Prop = 'none' | 'phone' | 'placard' | 'megaphone' | 'bag' | 'basket' | 'notes' | 'slip';
export type Action =
  | 'idle' | 'walk' | 'sit' | 'talk' | 'point' | 'wave' | 'film' | 'shield' | 'megaphone' | 'signal'
  | 'sleep' | 'phonecall' | 'fan' | 'hang' | 'drive' | 'count' | 'handover' | 'hawk' | 'queue' | 'ride' | 'seated';

export interface PersonVariant {
  id: string;
  height: number;        // metres
  build: number;         // 0.85 slim .. 1.2 heavy (x/z scale of torso & limbs)
  skin: string;
  hair: Hair;
  hairColor: string;
  outfit: Outfit;
  top: string;           // shirt / panjabi / blouse colour
  bottom: string;        // pants / lungi / saree colour
  accent: string;        // cap / gamchha / orna / drape colour
  prop: Prop;
  /** arm length multiplier (driver uses 1.3 so hands reach a bus-sized wheel) */
  armScale?: number;
}

// Bone indices
const B = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, uarmL: 5, larmL: 6, handL: 7, uarmR: 8, larmR: 9, handR: 10, ulegL: 11, llegL: 12, footL: 13, ulegR: 14, llegR: 15, footR: 16 } as const;
const BONE_PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];

/** Joint positions in bind pose for unit height, [x, y, z]. Arms hang straight down. */
function joints(h: number, build: number, armScale = 1) {
  const sw = 0.115 * h * build; // half shoulder width
  const hw = 0.075 * h * build; // half hip width
  const p: [number, number, number][] = [];
  p[B.hips] = [0, 0.53 * h, 0];
  p[B.spine] = [0, 0.62 * h, 0];
  p[B.chest] = [0, 0.72 * h, 0];
  p[B.neck] = [0, 0.84 * h, 0];
  p[B.head] = [0, 0.875 * h, 0];
  const ua = 0.17 * h * armScale, la = 0.15 * h * armScale;
  p[B.uarmL] = [-sw, 0.82 * h, 0]; p[B.larmL] = [-sw, 0.82 * h - ua, 0]; p[B.handL] = [-sw, 0.82 * h - ua - la, 0];
  p[B.uarmR] = [sw, 0.82 * h, 0]; p[B.larmR] = [sw, 0.82 * h - ua, 0]; p[B.handR] = [sw, 0.82 * h - ua - la, 0];
  p[B.ulegL] = [-hw, 0.52 * h, 0]; p[B.llegL] = [-hw, 0.28 * h, 0]; p[B.footL] = [-hw, 0.04 * h, 0];
  p[B.ulegR] = [hw, 0.52 * h, 0]; p[B.llegR] = [hw, 0.28 * h, 0]; p[B.footR] = [hw, 0.04 * h, 0];
  return p;
}

interface Part { geo: THREE.BufferGeometry; bone: number; color: string; }

function col(geo: THREE.BufferGeometry, color: string, bone: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { colors.set([c.r, c.g, c.b], i * 3); si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.deleteAttribute('uv');
  return g;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Builds (and caches) the skinned geometry for a variant. */
export function variantGeometry(v: PersonVariant): THREE.BufferGeometry {
  const hit = cache.get(v.id);
  if (hit) return hit;
  const h = v.height, b = v.build, J = joints(h, b, v.armScale ?? 1);
  const parts: Part[] = [];
  const add = (geo: THREE.BufferGeometry, bone: number, color: string) => parts.push({ geo, bone, color });
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
  const hr = 0.075 * h;                       // head radius
  const [, hy] = J[B.head];
  const [, ny] = J[B.neck];

  // Head + face
  add(at(new THREE.SphereGeometry(hr, 10, 8).scale(1, 1.12, 0.95), 0, hy + hr * 0.35, 0), B.head, v.skin);
  add(at(new THREE.SphereGeometry(hr * 0.12, 5, 4), -hr * 0.35, hy + hr * 0.45, hr * 0.85), B.head, '#1a1210');
  add(at(new THREE.SphereGeometry(hr * 0.12, 5, 4), hr * 0.35, hy + hr * 0.45, hr * 0.85), B.head, '#1a1210');
  add(at(new THREE.SphereGeometry(hr * 0.16, 5, 4).scale(0.8, 1, 1), 0, hy + hr * 0.2, hr * 0.98), B.head, v.skin);
  add(at(new THREE.BoxGeometry(hr * 0.5, hr * 0.08, hr * 0.1), 0, hy - hr * 0.1, hr * 0.9), B.head, '#7a3b2e');
  // ears
  for (const s of [-1, 1]) add(at(new THREE.SphereGeometry(hr * 0.2, 5, 4), s * hr * 0.98, hy + hr * 0.35, 0), B.head, v.skin);
  // Hair / headwear
  const hairTop = hy + hr * 0.35;
  switch (v.hair) {
    case 'short': add(at(new THREE.SphereGeometry(hr * 1.06, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.1, 0.97), 0, hairTop + hr * 0.05, -hr * 0.05), B.head, v.hairColor); break;
    case 'bun': add(at(new THREE.SphereGeometry(hr * 1.06, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1, 1.1, 0.97), 0, hairTop + hr * 0.05, -hr * 0.05), B.head, v.hairColor);
      add(at(new THREE.SphereGeometry(hr * 0.42, 7, 5), 0, hairTop + hr * 0.3, -hr * 0.95), B.head, v.hairColor); break;
    case 'cap': case 'policecap':
      add(at(new THREE.SphereGeometry(hr * 1.08, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.9, 1), 0, hairTop + hr * 0.15, 0), B.head, v.accent);
      add(at(new THREE.BoxGeometry(hr * 1.4, hr * 0.1, hr * 0.9), 0, hairTop + hr * 0.25, hr * 0.9), B.head, v.hair === 'policecap' ? '#1b1b1b' : v.accent);
      if (v.hair === 'policecap') add(at(new THREE.BoxGeometry(hr * 0.5, hr * 0.3, hr * 0.06), 0, hairTop + hr * 0.5, hr * 1.02), B.head, '#d9b64a');
      break;
    case 'tupi': add(at(new THREE.SphereGeometry(hr * 1.06, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.1, 0.97), 0, hairTop + hr * 0.05, -hr * 0.05), B.head, v.hairColor);
      add(at(new THREE.CylinderGeometry(hr * 0.85, hr * 0.95, hr * 0.55, 10), 0, hairTop + hr * 0.95, -hr * 0.05), B.head, v.accent); break;
    case 'gamchha': add(at(new THREE.SphereGeometry(hr * 1.06, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.1, 0.97), 0, hairTop + hr * 0.05, -hr * 0.05), B.head, v.hairColor);
      add(at(new THREE.TorusGeometry(hr * 1.02, hr * 0.28, 6, 12).rotateX(Math.PI / 2), 0, hairTop + hr * 0.75, 0), B.head, v.accent);
      add(at(new THREE.BoxGeometry(hr * 0.4, hr * 1.2, hr * 0.15).rotateX(0.3), hr * 0.9, hairTop + hr * 0.1, -hr * 0.6), B.head, v.accent); break;
    case 'hijab':
      add(at(new THREE.SphereGeometry(hr * 1.12, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.1, 1), 0, hairTop + hr * 0.1, -hr * 0.1), B.head, v.accent);
      add(at(new THREE.CylinderGeometry(hr * 1.1, hr * 1.5, hr * 1.4, 10, 1, true, Math.PI * 0.75, Math.PI * 1.5), 0, hy - hr * 0.3, -hr * 0.15), B.head, v.accent);
      add(at(new THREE.CylinderGeometry(hr * 1.5, hr * 1.9, hr * 0.8, 10), 0, ny - hr * 0.2, -hr * 0.1), B.chest, v.accent); break;
    case 'orna':
      add(at(new THREE.SphereGeometry(hr * 1.06, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.1, 0.97), 0, hairTop + hr * 0.05, -hr * 0.05), B.head, v.hairColor);
      add(at(new THREE.SphereGeometry(hr * 1.14, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45).scale(1, 0.9, 1), 0, hairTop + hr * 0.12, -hr * 0.15), B.head, v.accent);
      add(at(new THREE.BoxGeometry(hr * 0.9, 0.42 * h, hr * 0.12).rotateZ(0.35), 0.1 * h * b, ny - 0.18 * h, 0.07 * h), B.chest, v.accent); break;
  }
  // Neck
  add(at(new THREE.CylinderGeometry(hr * 0.42, hr * 0.5, hy - ny + hr * 0.2, 8), 0, (hy + ny) / 2, 0), B.neck, v.skin);

  // Torso (chest + belly) — outfit dependent
  const cw = 0.14 * h * b, cd = 0.085 * h * b;
  const chestY = J[B.chest][1], hipsY = J[B.hips][1];
  const torsoTop = ny - 0.005 * h;
  const topColor = v.top;
  const longTop = v.outfit === 'panjabi' || v.outfit === 'police' && false;
  const torsoBottom = longTop ? hipsY - 0.18 * h : hipsY - 0.03 * h;
  add(at(new THREE.CylinderGeometry(cw, cw * 0.88, torsoTop - torsoBottom, 8).scale(1, 1, cd / cw), 0, (torsoTop + torsoBottom) / 2, 0), B.chest, topColor);
  add(at(new THREE.CylinderGeometry(cw * 0.9, cw * 0.95, (chestY - hipsY) + 0.06 * h, 8).scale(1, 1, cd / cw), 0, hipsY + 0.02 * h, 0), B.hips, longTop ? topColor : (v.outfit === 'saree' ? v.bottom : topColor));
  if (v.outfit === 'police') { // belt + shoulder tabs + a light stripe (no insignia text)
    add(at(new THREE.BoxGeometry(cw * 2.04, 0.025 * h, cd * 2.04), 0, hipsY + 0.02 * h, 0), B.hips, '#2a1a0a');
    for (const s of [-1, 1]) add(at(new THREE.BoxGeometry(cw * 0.5, 0.012 * h, cd * 0.6), s * cw * 0.75, torsoTop - 0.004 * h, 0), B.chest, '#d9b64a');
    add(at(new THREE.BoxGeometry(cw * 0.4, 0.03 * h, 0.004 * h), -cw * 0.5, chestY + 0.08 * h, cd + 0.002 * h), B.chest, '#d9b64a');
  }
  if (v.outfit === 'saree') { // pallu drape over the left shoulder
    add(at(new THREE.BoxGeometry(cw * 0.9, 0.5 * h, 0.02 * h).rotateZ(0.5), -cw * 0.4, chestY - 0.05 * h, cd + 0.005 * h), B.chest, v.accent);
    add(at(new THREE.BoxGeometry(cw * 0.9, 0.42 * h, 0.02 * h).rotateZ(-0.4), -cw * 0.5, chestY - 0.02 * h, -cd - 0.005 * h), B.chest, v.accent);
  }
  if (v.outfit === 'helper') { // gamchha over the shoulder
    add(at(new THREE.BoxGeometry(cw * 0.5, 0.45 * h, 0.02 * h).rotateZ(0.2), cw * 0.5, chestY - 0.05 * h, cd + 0.004 * h), B.chest, v.accent);
  }

  // Arms
  const ar = 0.042 * h * b;
  const sleeve = v.outfit === 'saree' ? 0.35 : (v.outfit === 'school' ? 0.5 : 1);  // fraction of upper arm covered
  for (const side of ['L', 'R'] as const) {
    const u = side === 'L' ? B.uarmL : B.uarmR, l = side === 'L' ? B.larmL : B.larmR, hd = side === 'L' ? B.handL : B.handR;
    const [ux, uy] = J[u], [lx, ly] = J[l], [hx, hy2] = J[hd];
    const ulen = uy - ly, llen = ly - hy2;
    add(at(new THREE.CapsuleGeometry(ar, ulen * sleeve, 2, 7), ux, uy - ulen * sleeve / 2, 0), u, topColor);
    if (sleeve < 1) add(at(new THREE.CapsuleGeometry(ar * 0.85, ulen * (1 - sleeve), 2, 7), ux, ly + ulen * (1 - sleeve) / 2, 0), u, v.skin);
    add(at(new THREE.CapsuleGeometry(ar * 0.85, llen, 2, 7), lx, ly - llen / 2, 0), l, v.outfit === 'panjabi' || v.outfit === 'police' || v.outfit === 'shirt-pants' ? topColor : v.skin);
    add(at(new THREE.SphereGeometry(ar * 1.15, 7, 5).scale(0.8, 1.25, 1), hx, hy2 - ar * 0.6, 0), hd, v.skin);
  }

  // Legs
  const lr = 0.048 * h * b;
  const lungi = v.outfit === 'lungi-shirt' || v.outfit === 'saree' || v.outfit === 'driver';
  const skirt = v.outfit === 'school' && v.hair === 'orna';
  for (const side of ['L', 'R'] as const) {
    const u = side === 'L' ? B.ulegL : B.ulegR, l = side === 'L' ? B.llegL : B.llegR, f = side === 'L' ? B.footL : B.footR;
    const [ux, uy] = J[u], [lx, ly] = J[l], [fx, fy] = J[f];
    const ulen = uy - ly, llen = ly - fy;
    const r1 = lungi ? lr * 1.45 : lr, r2 = lungi ? lr * 1.3 : lr * 0.85;
    add(at(new THREE.CapsuleGeometry(r1, ulen, 2, 7), ux, uy - ulen / 2, 0), u, v.bottom);
    add(at(new THREE.CapsuleGeometry(r2, llen - 0.03 * h, 2, 7), lx, ly - llen / 2 + 0.01 * h, 0), l, skirt ? v.skin : v.bottom);
    add(at(new THREE.BoxGeometry(lr * 1.8, 0.035 * h, lr * 3.4), fx, 0.0175 * h, lr * 0.9), f, v.outfit === 'police' ? '#1b1b1b' : (v.outfit === 'school' ? '#2a2a2a' : '#4a3828'));
  }
  if (skirt) add(at(new THREE.CylinderGeometry(0.12 * h * b, 0.17 * h * b, 0.22 * h, 10), 0, hipsY - 0.12 * h, 0), B.hips, v.bottom);

  // Props held in the right hand (left for placard)
  const [hx, hy3] = J[B.handR];
  switch (v.prop) {
    case 'phone': add(at(new THREE.BoxGeometry(0.035 * h, 0.07 * h, 0.006 * h), hx, hy3 - 0.02 * h, 0.03 * h), B.handR, '#202428'); break;
    case 'placard': {
      const [lx, ly2] = J[B.handL];
      add(at(new THREE.CylinderGeometry(0.008 * h, 0.008 * h, 0.5 * h, 6), lx, ly2 + 0.15 * h, 0.02 * h), B.handL, '#b8905a');
      add(at(new THREE.BoxGeometry(0.3 * h, 0.22 * h, 0.01 * h), lx, ly2 + 0.45 * h, 0.02 * h), B.handL, '#c9a97a');
      break;
    }
    case 'megaphone': add(at(new THREE.ConeGeometry(0.05 * h, 0.14 * h, 8).rotateX(-Math.PI / 2), hx, hy3, 0.08 * h), B.handR, '#d8262c'); break;
    case 'bag': add(at(new THREE.BoxGeometry(0.1 * h, 0.14 * h, 0.06 * h), hx + 0.01 * h, hy3 - 0.1 * h, 0), B.handR, v.accent); break;
    case 'basket': add(at(new THREE.CylinderGeometry(0.1 * h, 0.07 * h, 0.08 * h, 8), 0, hy + hr * 1.6, 0), B.head, '#b8905a'); break;
    case 'notes': add(at(new THREE.BoxGeometry(0.05 * h, 0.02 * h, 0.1 * h), hx, hy3 - 0.02 * h, 0.03 * h), B.handR, '#5a8a4a'); break;
    case 'slip': add(at(new THREE.BoxGeometry(0.06 * h, 0.001 * h, 0.09 * h), hx, hy3 - 0.02 * h, 0.03 * h), B.handR, '#f4f0e0'); break;
  }

  const merged = mergeGeometries(parts.map((p) => col(p.geo, p.color, p.bone)), false)!;
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  cache.set(v.id, merged);
  return merged;
}

export const PEOPLE_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, flatShading: true });

// ---------------------------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------------------------
const SKINS = ['#8d5a3b', '#a56a45', '#c58a62', '#6f452b', '#b07a55', '#7d4f33'];
let vcount = 0;
export function makeVariant(p: Partial<PersonVariant>): PersonVariant {
  const id = p.id ?? `v${vcount++}`;
  return {
    id, height: 1.7, build: 1, skin: SKINS[vcount % SKINS.length], hair: 'short', hairColor: '#17110d', outfit: 'shirt-pants',
    top: '#d8d2c0', bottom: '#2f3a4a', accent: '#d8262c', prop: 'none', ...p, ...(p.id ? {} : { id }),
  };
}

/** 14 stock civilians + police + driver + helper. */
export const VARIANTS: PersonVariant[] = [
  makeVariant({ id: 'c01', outfit: 'shirt-pants', top: '#e9e4d6', bottom: '#2b2f3a', hair: 'short', height: 1.74 }),
  makeVariant({ id: 'c02', outfit: 'panjabi', top: '#f2f2f2', bottom: '#f2f2f2', hair: 'tupi', accent: '#f8f8f8', height: 1.68, build: 1.1 }),
  makeVariant({ id: 'c03', outfit: 'lungi-shirt', top: '#4b86c6', bottom: '#8a2d3a', hair: 'gamchha', accent: '#d8262c', height: 1.66, build: 1.05 }),
  makeVariant({ id: 'c04', outfit: 'saree', top: '#d8262c', bottom: '#1f6fb5', accent: '#ffcc33', hair: 'bun', height: 1.58, build: 0.95 }),
  makeVariant({ id: 'c05', outfit: 'shirt-pants', top: '#1f9d55', bottom: '#3a3a3a', hair: 'cap', accent: '#1b1b1b', height: 1.8, build: 0.92, prop: 'phone' }),
  makeVariant({ id: 'c06', outfit: 'school', top: '#ffffff', bottom: '#1b2a4a', hair: 'orna', accent: '#1b2a4a', height: 1.45, build: 0.85 }),
  makeVariant({ id: 'c07', outfit: 'school', top: '#ffffff', bottom: '#1b2a4a', hair: 'short', height: 1.5, build: 0.88, prop: 'bag', accent: '#5a3a1a' }),
  makeVariant({ id: 'c08', outfit: 'shirt-pants', top: '#f2a900', bottom: '#2f3a4a', hair: 'hijab', accent: '#5a2d6b', height: 1.6, build: 0.95 }),
  makeVariant({ id: 'c09', outfit: 'lungi-shirt', top: '#e8d8b0', bottom: '#1f6f55', hair: 'short', height: 1.72, build: 1.2, prop: 'placard' }),
  makeVariant({ id: 'c10', outfit: 'panjabi', top: '#6b3fa0', bottom: '#f0e6c8', hair: 'short', height: 1.76, build: 1.0, prop: 'phone' }),
  makeVariant({ id: 'c11', outfit: 'saree', top: '#1f9d55', bottom: '#ffcc33', accent: '#d8262c', hair: 'orna', height: 1.62, build: 1.05 }),
  makeVariant({ id: 'c12', outfit: 'shirt-pants', top: '#b23a48', bottom: '#1b1b1b', hair: 'short', hairColor: '#4a4a4a', height: 1.7, build: 1.15 }),
  makeVariant({ id: 'c13', outfit: 'lungi-shirt', top: '#ffffff', bottom: '#2a4a8a', hair: 'tupi', accent: '#d8d8d8', height: 1.64, build: 0.9, prop: 'placard' }),
  makeVariant({ id: 'c14', outfit: 'shirt-pants', top: '#3a7bd5', bottom: '#5a5a5a', hair: 'cap', accent: '#d8262c', height: 1.78, build: 1.05, prop: 'phone' }),
];
export const POLICE_VARIANTS: PersonVariant[] = [0, 1, 2].map((i) => makeVariant({ id: `p0${i}`, outfit: 'police', top: '#2c4a7a', bottom: '#1f3558', hair: 'policecap', accent: '#2c4a7a', height: 1.74 + i * 0.03, build: 1.05, prop: i === 0 ? 'megaphone' : 'none' }));
export const DRIVER_VARIANT = makeVariant({ id: 'driver', outfit: 'driver', top: '#5a8ad0', bottom: '#4a2d3a', hair: 'gamchha', accent: '#d8262c', height: 1.72, build: 1.08, armScale: 1.42 });
export const HELPER_VARIANT = makeVariant({ id: 'helper', outfit: 'helper', top: '#e8c84a', bottom: '#3a3a3a', hair: 'short', accent: '#d8262c', height: 1.66, build: 0.95 });
export const HAWKER_VARIANT = makeVariant({ id: 'hawker', outfit: 'lungi-shirt', top: '#c9d8e8', bottom: '#6a2d2a', hair: 'gamchha', accent: '#1f9d55', height: 1.64, build: 1.0, prop: 'basket' });
export const CHADA_VARIANT = makeVariant({ id: 'chada', outfit: 'shirt-pants', top: '#2a2a2a', bottom: '#1b1b1b', hair: 'short', height: 1.78, build: 1.2, prop: 'notes' });

// ---------------------------------------------------------------------------------------------
// Person: skinned mesh + skeleton + procedural animation
// ---------------------------------------------------------------------------------------------
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);

export class Person {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  readonly variant: PersonVariant;
  action: Action = 'idle';
  /** per-person random phase so crowds are never in sync */
  phase = Math.random() * 100;
  speed = 0.9 + Math.random() * 0.25;   // animation tempo
  walkSpeed = 1.1 + Math.random() * 0.3; // m/s
  target: THREE.Vector3 | null = null;
  onArrive: (() => void) | null = null;
  headYaw = 0; headPitch = 0;
  /** sub-pose used while 'seated' (bus passengers) */
  seatedSub: 'idle' | 'talk' | 'fan' | 'sleep' | 'phone' | 'film' = 'idle';
  /** external IK targets in root space (driver) */
  ikL: THREE.Vector3 | null = null; ikR: THREE.Vector3 | null = null;
  private jointPos: [number, number, number][];
  private time = 0;
  private sitOffset = 0;

  constructor(variant: PersonVariant) {
    this.variant = variant;
    const geo = variantGeometry(variant);
    this.jointPos = joints(variant.height, variant.build, variant.armScale ?? 1);
    for (let i = 0; i < BONE_PARENT.length; i++) {
      const b = new THREE.Bone(); b.name = Object.keys(B)[i];
      const p = this.jointPos[i], pp = BONE_PARENT[i] >= 0 ? this.jointPos[BONE_PARENT[i]] : [0, 0, 0];
      b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      this.bones.push(b);
      if (BONE_PARENT[i] >= 0) this.bones[BONE_PARENT[i]].add(b);
    }
    this.mesh = new THREE.SkinnedMesh(geo, PEOPLE_MATERIAL);
    this.mesh.add(this.bones[0]);
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.name = 'person:' + variant.id;
  }

  get position() { return this.root.position; }
  setAction(a: Action) { if (a !== this.action) { this.action = a; this.sitOffset = 0; } }
  lookAt(x: number, z: number) { _v.set(x, this.root.position.y, z); this.root.lookAt(_v); }

  /** Walk toward a target; switches to 'walk' and back to `then` on arrival. */
  walkTo(target: THREE.Vector3, then: Action = 'idle', cb?: () => void) {
    this.target = target.clone(); this.setAction('walk');
    this.onArrive = () => { this.setAction(then); cb?.(); };
  }

  private rot(i: number, x: number, y: number, z: number) { this.bones[i].rotation.set(x, y, z); }

  update(dt: number) {
    this.time += dt * this.speed;
    const t = this.time + this.phase;
    const bn = this.bones;
    // reset
    for (const b of bn) b.rotation.set(0, 0, 0);
    bn[B.hips].position.y = this.jointPos[B.hips][1];
    const breathe = Math.sin(t * 2.1) * 0.02;
    const sway = Math.sin(t * 0.7) * 0.03;
    bn[B.spine].rotation.x = breathe;
    bn[B.hips].rotation.z = sway;
    bn[B.neck].rotation.set(this.headPitch, this.headYaw, 0);

    // Movement toward target (walking)
    if (this.target) {
      const dx = this.target.x - this.root.position.x, dz = this.target.z - this.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { this.target = null; const cb = this.onArrive; this.onArrive = null; cb?.(); }
      else {
        const step = Math.min(d, this.walkSpeed * dt);
        this.root.position.x += dx / d * step; this.root.position.z += dz / d * step;
        const yaw = Math.atan2(dx, dz);
        let dy = yaw - this.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.root.rotation.y += dy * Math.min(1, dt * 6);
        if (this.action !== 'walk') this.action = 'walk';
      }
    }

    switch (this.action) {
      case 'idle': {
        // weight shift + relaxed arms
        const w = Math.sin(t * 0.5);
        bn[B.hips].rotation.z = w * 0.04; bn[B.spine].rotation.z = -w * 0.03;
        this.rot(B.uarmL, 0.05, 0, 0.08); this.rot(B.uarmR, 0.05, 0, -0.08);
        this.rot(B.larmL, -0.15 + Math.sin(t * 1.3) * 0.03, 0, 0); this.rot(B.larmR, -0.15, 0, 0);
        this.rot(B.ulegL, 0, 0, 0.03); this.rot(B.ulegR, 0, 0, -0.03);
        break;
      }
      case 'walk': {
        const ph = t * 5.5;
        const s = Math.sin(ph), c = Math.sin(ph + Math.PI);
        this.rot(B.ulegL, -s * 0.55, 0, 0); this.rot(B.llegL, Math.max(0, -c) * 0.9, 0, 0);
        this.rot(B.ulegR, -c * 0.55, 0, 0); this.rot(B.llegR, Math.max(0, -s) * 0.9, 0, 0);
        this.rot(B.uarmL, c * 0.45, 0, 0.1); this.rot(B.uarmR, s * 0.45, 0, -0.1);
        this.rot(B.larmL, -0.35, 0, 0); this.rot(B.larmR, -0.35, 0, 0);
        bn[B.hips].position.y += Math.abs(Math.sin(ph)) * 0.025;
        bn[B.spine].rotation.y = s * 0.08; bn[B.hips].rotation.z = s * 0.05;
        this.rot(B.footL, 0.1, 0, 0); this.rot(B.footR, 0.1, 0, 0);
        break;
      }
      case 'sit': {
        // sitting on the ground, knees up, arms resting on knees
        const hy = this.jointPos[B.hips][1];
        bn[B.hips].position.y = 0.12 * this.variant.height;
        this.rot(B.ulegL, -1.75, 0.35, 0); this.rot(B.llegL, 1.95, 0, 0);
        this.rot(B.ulegR, -1.75, -0.35, 0); this.rot(B.llegR, 1.95, 0, 0);
        this.rot(B.uarmL, -0.9, 0, 0.25); this.rot(B.larmL, -0.9, 0, 0);
        this.rot(B.uarmR, -0.9, 0, -0.25); this.rot(B.larmR, -0.9, 0, 0);
        bn[B.spine].rotation.x = 0.15 + breathe;
        void hy;
        break;
      }
      case 'talk': {
        const g = Math.sin(t * 3.1), g2 = Math.sin(t * 2.3 + 1);
        this.rot(B.uarmR, -0.6 + g * 0.25, 0, -0.5 + g2 * 0.2); this.rot(B.larmR, -1.4 + g2 * 0.3, 0, 0);
        this.rot(B.uarmL, -0.2 + g2 * 0.15, 0, 0.3); this.rot(B.larmL, -0.9 + g * 0.2, 0, 0);
        bn[B.neck].rotation.y += Math.sin(t * 1.7) * 0.2; bn[B.neck].rotation.x += Math.sin(t * 4) * 0.05;
        this.rot(B.ulegL, 0, 0, 0.05); this.rot(B.ulegR, 0, 0, -0.05);
        break;
      }
      case 'point': {
        this.rot(B.uarmR, -1.5 + Math.sin(t * 2) * 0.08, 0, -0.1); this.rot(B.larmR, -0.1, 0, 0);
        this.rot(B.uarmL, 0.1, 0, 0.1); this.rot(B.larmL, -0.3, 0, 0);
        bn[B.spine].rotation.y = -0.15; bn[B.neck].rotation.y += -0.1;
        break;
      }
      case 'wave': {
        const w = Math.sin(t * 6);
        this.rot(B.uarmR, -2.6, 0, -0.6 + w * 0.35); this.rot(B.larmR, -0.5 + w * 0.3, 0, 0);
        this.rot(B.uarmL, -2.4, 0, 0.6 - w * 0.35); this.rot(B.larmL, -0.5 - w * 0.3, 0, 0);
        bn[B.hips].position.y += Math.max(0, Math.sin(t * 6)) * 0.03;
        break;
      }
      case 'film': {
        this.rot(B.uarmR, -1.7, -0.3, -0.25); this.rot(B.larmR, -1.1, 0, 0);
        this.rot(B.uarmL, -1.6, 0.3, 0.3); this.rot(B.larmL, -1.2, 0, 0);
        bn[B.neck].rotation.x += 0.1;
        bn[B.spine].rotation.y = Math.sin(t * 0.6) * 0.15;
        break;
      }
      case 'shield': {
        this.rot(B.uarmR, -1.9, 0.2, -0.3); this.rot(B.larmR, -2.3, 0, 0);
        this.rot(B.uarmL, -0.3, 0, 0.3); this.rot(B.larmL, -0.6, 0, 0);
        bn[B.spine].rotation.x += -0.1; bn[B.neck].rotation.x += -0.1;
        bn[B.hips].rotation.z += Math.sin(t) * 0.03;
        break;
      }
      case 'megaphone': {
        this.rot(B.uarmR, -1.3, -0.2, -0.2); this.rot(B.larmR, -1.6, 0, 0);
        this.rot(B.uarmL, -1.2 + Math.sin(t * 2.5) * 0.3, 0, 0.8); this.rot(B.larmL, -0.7, 0, 0);
        bn[B.neck].rotation.y += Math.sin(t * 0.9) * 0.3;
        break;
      }
      case 'signal': {
        // traffic hand signal: right arm out, left arm beckoning
        const b2 = Math.sin(t * 3);
        this.rot(B.uarmR, -1.55, 0, -1.2); this.rot(B.larmR, -0.2, 0, 0);
        this.rot(B.uarmL, -1.3 + b2 * 0.25, 0, 0.3); this.rot(B.larmL, -1.4 + b2 * 0.5, 0, 0);
        bn[B.neck].rotation.y += Math.sin(t * 0.8) * 0.35;
        break;
      }
      case 'sleep': {
        bn[B.neck].rotation.set(0.45, 0.3, 0.3);
        bn[B.spine].rotation.x = 0.25 + breathe;
        this.rot(B.uarmL, -0.5, 0, 0.4); this.rot(B.larmL, -1.2, 0, 0);
        this.rot(B.uarmR, -0.5, 0, -0.4); this.rot(B.larmR, -1.2, 0, 0);
        this.rot(B.ulegL, -1.5, 0, 0); this.rot(B.llegL, 1.5, 0, 0); this.rot(B.ulegR, -1.5, 0, 0); this.rot(B.llegR, 1.5, 0, 0);
        bn[B.hips].position.y = 0.46 * this.variant.height;
        break;
      }
      case 'phonecall': {
        this.rot(B.uarmR, -0.4, 0, -0.9); this.rot(B.larmR, -2.5, 0, 0);
        this.rot(B.uarmL, 0.1, 0, 0.1); this.rot(B.larmL, -0.3, 0, 0);
        bn[B.neck].rotation.z = 0.2; bn[B.spine].rotation.y = Math.sin(t * 0.4) * 0.2;
        this.rot(B.ulegL, 0, 0, 0.05); this.rot(B.ulegR, 0, 0, -0.05);
        break;
      }
      case 'fan': {
        const f = Math.sin(t * 7);
        this.rot(B.uarmR, -1.2, 0, -0.4); this.rot(B.larmR, -1.6 + f * 0.35, 0, 0);
        this.rot(B.uarmL, -0.4, 0, 0.3); this.rot(B.larmL, -1.0, 0, 0);
        this.rot(B.ulegL, -1.5, 0, 0); this.rot(B.llegL, 1.5, 0, 0); this.rot(B.ulegR, -1.5, 0, 0); this.rot(B.llegR, 1.5, 0, 0);
        bn[B.hips].position.y = 0.46 * this.variant.height;
        bn[B.neck].rotation.x += 0.1;
        break;
      }
      case 'hang': {
        // helper hanging from the door: left arm up gripping, body leaning out, right arm waving passengers in
        this.rot(B.uarmL, -2.9, 0, 0.5); this.rot(B.larmL, -0.3, 0, 0);
        const w = Math.sin(t * 4);
        this.rot(B.uarmR, -1.2 + w * 0.3, 0, -0.8); this.rot(B.larmR, -0.8 + w * 0.3, 0, 0);
        bn[B.spine].rotation.z = -0.3; bn[B.hips].rotation.z = -0.1;
        this.rot(B.ulegL, 0.2, 0, 0.1); this.rot(B.ulegR, -0.3, 0, -0.2); this.rot(B.llegR, 0.5, 0, 0);
        bn[B.neck].rotation.y += 0.4 + Math.sin(t * 2) * 0.2;
        break;
      }
      case 'drive': {
        // seated, legs forward; arms solved by IK below
        bn[B.hips].position.y = 0.36 * this.variant.height;
        this.rot(B.ulegL, -1.45, 0, 0.1); this.rot(B.llegL, 1.2, 0, 0);
        this.rot(B.ulegR, -1.45, 0, -0.1); this.rot(B.llegR, 1.1 + Math.sin(t) * 0.02, 0, 0);
        bn[B.spine].rotation.x = 0.2 + breathe * 0.5;
        break;
      }
      case 'ride': {
        bn[B.hips].position.y = 0.42 * this.variant.height;
        this.rot(B.ulegL, -1.1, 0, 0.25); this.rot(B.llegL, 1.6, 0, 0);
        this.rot(B.ulegR, -1.1, 0, -0.25); this.rot(B.llegR, 1.6, 0, 0);
        this.rot(B.uarmL, -0.9, 0, 0.2); this.rot(B.larmL, -0.5, 0, 0);
        this.rot(B.uarmR, -0.9, 0, -0.2); this.rot(B.larmR, -0.5, 0, 0);
        bn[B.spine].rotation.x = 0.3 + breathe * 0.3;
        break;
      }
      case 'seated': {
        bn[B.hips].position.y = 0.38 * this.variant.height;
        this.rot(B.ulegL, -1.45, 0, 0.08); this.rot(B.llegL, 1.3, 0, 0);
        this.rot(B.ulegR, -1.45, 0, -0.08); this.rot(B.llegR, 1.3, 0, 0);
        const sub = this.seatedSub;
        if (sub === 'talk') { const g = Math.sin(t * 3.1); this.rot(B.uarmR, -0.5 + g * 0.2, 0, -0.4); this.rot(B.larmR, -1.3 + g * 0.3, 0, 0); this.rot(B.uarmL, -0.2, 0, 0.2); this.rot(B.larmL, -1.0, 0, 0); bn[B.neck].rotation.y += 0.5 + Math.sin(t * 1.7) * 0.2; }
        else if (sub === 'fan') { const f = Math.sin(t * 7); this.rot(B.uarmR, -1.0, 0, -0.4); this.rot(B.larmR, -1.6 + f * 0.35, 0, 0); this.rot(B.uarmL, -0.3, 0, 0.2); this.rot(B.larmL, -1.0, 0, 0); bn[B.neck].rotation.x += 0.1; }
        else if (sub === 'sleep') { bn[B.neck].rotation.set(0.5, 0.2, 0.35); bn[B.spine].rotation.x = 0.2 + breathe; this.rot(B.uarmL, -0.3, 0, 0.3); this.rot(B.larmL, -1.1, 0, 0); this.rot(B.uarmR, -0.3, 0, -0.3); this.rot(B.larmR, -1.1, 0, 0); }
        else if (sub === 'phone') { this.rot(B.uarmR, -0.4, 0, -0.9); this.rot(B.larmR, -2.5, 0, 0); this.rot(B.uarmL, -0.2, 0, 0.2); this.rot(B.larmL, -1.0, 0, 0); bn[B.neck].rotation.z = 0.2; }
        else if (sub === 'film') { this.rot(B.uarmR, -1.6, -0.3, -0.25); this.rot(B.larmR, -1.1, 0, 0); this.rot(B.uarmL, -1.5, 0.3, 0.3); this.rot(B.larmL, -1.2, 0, 0); bn[B.neck].rotation.y += 0.4; }
        else { this.rot(B.uarmL, -0.3, 0, 0.2); this.rot(B.larmL, -1.1, 0, 0); this.rot(B.uarmR, -0.3, 0, -0.2); this.rot(B.larmR, -1.1, 0, 0); bn[B.neck].rotation.y += Math.sin(t * 0.6) * 0.2; }
        break;
      }
      case 'count': {
        this.rot(B.uarmR, -1.0, 0, -0.35); this.rot(B.larmR, -1.4 + Math.sin(t * 5) * 0.15, 0, 0);
        this.rot(B.uarmL, -1.0, 0, 0.35); this.rot(B.larmL, -1.5, 0, 0);
        bn[B.neck].rotation.x += 0.35;
        break;
      }
      case 'handover': {
        this.rot(B.uarmR, -1.4, 0, -0.2); this.rot(B.larmR, -0.4 + Math.sin(t * 2) * 0.05, 0, 0);
        this.rot(B.uarmL, 0.1, 0, 0.1); this.rot(B.larmL, -0.3, 0, 0);
        break;
      }
      case 'hawk': {
        const g = Math.sin(t * 2.5);
        this.rot(B.uarmR, -1.4 + g * 0.2, 0, -0.3); this.rot(B.larmR, -0.6, 0, 0);
        this.rot(B.uarmL, -1.8, 0, 0.4); this.rot(B.larmL, -1.5, 0, 0); // steadying basket
        bn[B.neck].rotation.y += g * 0.2;
        break;
      }
      case 'queue': {
        this.rot(B.uarmL, -0.1, 0, 0.1); this.rot(B.larmL, -1.2, 0, 0);
        this.rot(B.uarmR, -0.1, 0, -0.1); this.rot(B.larmR, -1.2, 0, 0);
        bn[B.neck].rotation.x += Math.sin(t * 0.8) * 0.1;
        break;
      }
    }

    if (this.ikL) this.solveArm('L', this.ikL);
    if (this.ikR) this.solveArm('R', this.ikR);
  }

  /**
   * Analytic 2-bone IK in root space: places the hand of `side` at `target` (root-local).
   * Elbow pole points down and slightly back (natural for a steering wheel).
   */
  solveArm(side: 'L' | 'R', target: THREE.Vector3) {
    const u = side === 'L' ? B.uarmL : B.uarmR, l = side === 'L' ? B.larmL : B.larmR, hd = side === 'L' ? B.handL : B.handR;
    const bn = this.bones;
    bn[B.hips].updateMatrixWorld(true);
    // shoulder position in root space
    const S = bn[u].getWorldPosition(_v); this.root.worldToLocal(S);
    const a = bn[l].position.length(), b = bn[hd].position.length();
    const T = _v2.copy(target);
    const d = Math.max(0.05, Math.min(a + b - 0.01, T.distanceTo(S)));
    const dir = _v3.subVectors(T, S).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const angA = Math.acos(Math.max(-1, Math.min(1, cosA)));
    // pole: down & slightly back in root space, made orthogonal to dir
    const pole = new THREE.Vector3(side === 'L' ? -0.3 : 0.3, -1, -0.35);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbowDir = dir.clone().multiplyScalar(Math.cos(angA)).addScaledVector(pole, Math.sin(angA)).normalize();
    const E = S.clone().addScaledVector(elbowDir, a);
    const foreDir = T.clone().sub(E).normalize();
    // world (root-space) orientations for upper & lower arm: bone -Y should point along the segment
    const qUpper = new THREE.Quaternion().setFromUnitVectors(DOWN, elbowDir);
    const qLower = new THREE.Quaternion().setFromUnitVectors(DOWN, foreDir);
    // convert to local: parent world quaternion (chest chain) in root space
    const parentQ = new THREE.Quaternion();
    bn[BONE_PARENT[u]].getWorldQuaternion(parentQ);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    parentQ.premultiply(rootQ);
    bn[u].quaternion.copy(parentQ.clone().invert().multiply(qUpper));
    bn[l].quaternion.copy(qUpper.clone().invert().multiply(qLower));
    bn[hd].quaternion.identity();
  }
}

/**
 * Keeps per-frame cost bounded: hides people beyond `hideDistance`, animates the nearest
 * `maxAnimated` every frame, farther ones at a reduced rate.
 */
export class PeopleManager {
  readonly people: Person[] = [];
  hideDistance = 80;
  maxAnimated = 40;
  private frame = 0;
  private scratch: { p: Person; d: number }[] = [];

  add(p: Person) { this.people.push(p); return p; }
  remove(p: Person) { const i = this.people.indexOf(p); if (i >= 0) this.people.splice(i, 1); }

  update(dt: number, camPos: THREE.Vector3) {
    this.frame++;
    this.scratch.length = 0;
    for (const p of this.people) {
      if (!p.root.parent) continue;
      const d = p.root.getWorldPosition(_v).distanceTo(camPos);
      const vis = d < this.hideDistance;
      if (p.root.visible !== vis) p.root.visible = vis;
      if (vis) this.scratch.push({ p, d });
    }
    this.scratch.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.scratch.length; i++) {
      const { p, d } = this.scratch[i];
      const rate = i >= this.maxAnimated ? 0 : d < 25 ? 1 : d < 50 ? 2 : 4;
      if (rate === 0) { if (p.target) p.update(dt); continue; } // still walk, but no pose refresh otherwise
      if (this.frame % rate === 0) p.update(dt * rate);
    }
  }
}
