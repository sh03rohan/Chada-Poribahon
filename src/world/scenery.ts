import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Road } from './road.ts';
import type { QualityTier } from '../config.ts';
import { WORLD } from '../config.ts';

/**
 * Route-specific landscape: tea-garden hills (rows of bushes on rolling mounds, a few shade trees)
 * and haor wetlands (wide water beside the road with boats). Built as a couple of merged
 * vertex-coloured meshes + one water mesh, so the draw-call budget stays flat.
 */
function paint(g: THREE.BufferGeometry, c: THREE.ColorRepresentation) {
  const geo = g.index ? g.toNonIndexed() : g; const col = new THREE.Color(c); const n = geo.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); geo.deleteAttribute('uv'); return geo;
}
let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export function buildScenery(road: Road, scenery: { teaHills: [number, number][]; haor: [number, number][] }, tier: QualityTier): THREE.Group {
  const group = new THREE.Group(); group.name = 'scenery';
  const edge = WORLD.roadWidth / 2 + WORLD.shoulderWidth;
  const density = tier === 'low' ? 0.5 : tier === 'medium' ? 0.8 : 1;
  const parts: THREE.BufferGeometry[] = [];
  const at = (s: number, lat: number) => { const f = road.sample(s); return { x: f.x + f.rx * lat, z: f.z + f.rz * lat, yaw: Math.atan2(-f.tx, -f.tz) }; };

  // ---- tea gardens: mounds with bush rows, both sides, plus shade trees
  for (const [s0, s1] of scenery.teaHills) {
    for (let s = s0 + 20; s < s1; s += 38) {
      for (const side of [-1, 1]) {
        const rx = 22 + rnd() * 14, rz = 18 + rnd() * 12, h = 4 + rnd() * 5;
        const lat = side * (edge + 9 + rx + rnd() * 22);   // inner foot of the mound stays clear of the road
        const p = at(s, lat);
        const mound = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(rx, h, rz).translate(p.x, -0.2, p.z);
        parts.push(paint(mound, 0x3f8b36));
        // bush rows across the mound (keep the count tier-scaled)
        const rows = Math.round(7 * density), per = Math.round(9 * density);
        for (let r = 0; r < rows; r++) for (let k = 0; k < per; k++) {
          const u = (r / (rows - 1) - 0.5) * 1.6, v = (k / (per - 1) - 0.5) * 1.6;
          if (u * u + v * v > 0.9) continue;
          const y = h * Math.sqrt(Math.max(0, 1 - u * u - v * v)) - 0.2;
          parts.push(paint(new THREE.SphereGeometry(0.9, 5, 4).scale(1.3, 0.8, 1).translate(p.x + u * rx, y + 0.5, p.z + v * rz), r % 2 ? 0x2e7a2a : 0x4a9a3c));
        }
        // a shade tree on the crest
        if (rnd() < 0.6) { parts.push(paint(new THREE.CylinderGeometry(0.25, 0.35, 6, 6).translate(p.x, h + 2.5, p.z), 0x5a3a22)); parts.push(paint(new THREE.SphereGeometry(3.2, 8, 6).scale(1.4, 0.6, 1.4).translate(p.x, h + 6, p.z), 0x2f6d2a)); }
      }
    }
  }

  // ---- haor: water on both sides, a dyke edge, boats and bamboo poles
  const water = new THREE.MeshStandardMaterial({ color: 0x3f7f9a, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.93 });
  for (const [s0, s1] of scenery.haor) {
    for (const side of [-1, 1]) {
      const pts: number[] = [], idx: number[] = []; let k = 0;
      for (let s = s0; s <= s1; s += 10) {
        const a = at(s, side * (edge + 6)), b = at(s, side * 320);
        pts.push(a.x, -0.06, a.z, b.x, -0.06, b.z);   // just above the ground plane (−0.09)
        if (s > s0) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        k += 2;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, water); m.material.side = THREE.DoubleSide; group.add(m);
      // dyke strip between the shoulder and the water
      for (let s = s0; s < s1; s += 10) { const p = at(s + 5, side * (edge + 4.2)); parts.push(paint(new THREE.BoxGeometry(2.6, 0.3, 10.2).rotateY(p.yaw).translate(p.x, 0.0, p.z), 0x6b5a3c)); }
      // boats + poles
      for (let s = s0 + 30; s < s1; s += 70 * (1 / density)) {
        const p = at(s, side * (edge + 30 + rnd() * 120));
        parts.push(paint(new THREE.BoxGeometry(1.4, 0.5, 5.5).rotateY(rnd() * 6.3).translate(p.x, -0.05, p.z), 0x4a2e1a));
        for (let i = 0; i < 3; i++) { const q = at(s + rnd() * 40, side * (edge + 10 + rnd() * 60)); parts.push(paint(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5).translate(q.x, 0.9, q.z), 0xc9b58a)); }
      }
    }
  }
  if (parts.length) {
    const merged = mergeGeometries(parts, false)!; merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    mesh.castShadow = tier === 'high'; mesh.receiveShadow = tier !== 'low'; group.add(mesh);
  }
  return group;
}

/** true where ordinary roadside props must not be placed (over haor water / on the tea mounds). */
export function sceneryExcludes(road: Road, scenery: { teaHills: [number, number][]; haor: [number, number][] }) {
  return (x: number, z: number) => {
    const l = road.locate(x, z, 0);
    for (const [a, b] of scenery.haor) if (l.s > a && l.s < b && Math.abs(l.lateral) > WORLD.roadWidth / 2 + WORLD.shoulderWidth + 4) return true;
    for (const [a, b] of scenery.teaHills) if (l.s > a && l.s < b && Math.abs(l.lateral) > WORLD.roadWidth / 2 + WORLD.shoulderWidth + 8) return true;
    return false;
  };
}
