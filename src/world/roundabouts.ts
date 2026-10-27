import * as THREE from 'three';
import { WORLD } from '../config.ts';
import { Road } from './road.ts';
import { makeTextTexture } from './textures.ts';
import { COLLIDERS } from './collision.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function col(geo: THREE.BufferGeometry, c: THREE.ColorRepresentation) { const g = geo.index ? geo.toNonIndexed() : geo; const n = g.attributes.position.count; const cc = new THREE.Color(c); const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; }

/** Destinations shown on the 4-way sign at each junction: [straight, back, left, right]. */
const DIRECTIONS: Record<string, [string, string, string, string]> = {
  'রাজবাড়ী': ['ঢাকা', 'কুষ্টিয়া', 'পাংশা', 'গোয়ালন্দ ঘাট'],
  'ফরিদপুর': ['ঢাকা', 'রাজবাড়ী', 'ভাঙ্গা', 'মধুখালী'],
  'ঢাকা': ['ঢাকা শহর', 'পদ্মা সেতু', 'গাবতলী', 'সায়েদাবাদ'],
};

/**
 * City junctions (গোল চত্বর): a 4-way crossing — the main road splits around a kerbed island
 * (see Road.bulge) and two side roads leave left and right. A 4-face direction sign stands on the
 * island telling which road goes where. `wallDistance` / `inside` keep the bus off the island;
 * `onSideRoad` lets it drive down the side roads.
 */
export class Roundabouts {
  readonly group = new THREE.Group();
  private centres: { x: number; z: number; s: number }[] = [];
  readonly lampMaterials: THREE.MeshStandardMaterial[] = [];
  readonly sideRoads: Road[] = [];

  constructor(private road: Road, anisotropy = 4) {
    const kerb = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.9 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x4f7a2e, roughness: 1 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9b64a, roughness: 0.35, metalness: 0.7 });
    const R = WORLD.islandRadius;
    WORLD.roundabouts.forEach((rb, i) => {
      const f = road.sample(rb.s);
      this.centres.push({ x: f.x, z: f.z, s: rb.s });
      const g = new THREE.Group();
      g.position.set(f.x, 0, f.z); g.rotation.y = road.yawAt(rb.s);
      const parts: THREE.BufferGeometry[] = [];
      const add = (geo: THREE.BufferGeometry, c: number, x = 0, y = 0, z = 0) => parts.push(col(geo.translate(x, y, z), c));
      add(new THREE.CylinderGeometry(R, R + 0.3, 0.42, 36), 0xb9b2a4, 0, 0.21, 0);
      add(new THREE.CylinderGeometry(R - 0.6, R - 0.6, 0.1, 36), 0x4f7a2e, 0, 0.47, 0);
      add(new THREE.RingGeometry(2.2, 3.0, 36).rotateX(-Math.PI / 2), 0xb9b2a4, 0, 0.53, 0);
      add(new THREE.CylinderGeometry(1.6, 2.0, 0.6, 12), 0xf2efe6, 0, 0.8, 0);
      add(new THREE.CylinderGeometry(1.0, 1.4, 0.5, 12), 0xf2efe6, 0, 1.35, 0);
      const variant = i % 3;
      if (variant === 0) { add(new THREE.CylinderGeometry(0.35, 0.7, 7, 8), 0xf2efe6, 0, 5.1, 0); add(new THREE.ConeGeometry(0.4, 1.2, 8), 0xd9b64a, 0, 9.2, 0); }
      else if (variant === 1) { for (const a of [0, 2.1, -2.1]) add(new THREE.BoxGeometry(0.4, 6.5, 1.6).rotateY(a), 0xf2efe6, Math.sin(a) * 1.0, 4.8, Math.cos(a) * 1.0); add(new THREE.SphereGeometry(0.9, 14, 10), 0xd9b64a, 0, 8.6, 0); }
      else { add(new THREE.CylinderGeometry(0.5, 0.6, 5, 10), 0xf2efe6, 0, 4.1, 0); add(new THREE.CylinderGeometry(0.6, 0.2, 4.4, 8).rotateZ(Math.PI / 2).scale(1, 0.55, 1), 0xd9b64a, 0, 6.9, 0); add(new THREE.ConeGeometry(1.1, 2.6, 4), 0xf2efe6, 0.3, 8.4, 0); }
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        add(new THREE.SphereGeometry(0.45, 8, 6).scale(1, 0.6, 1), [0xd8262c, 0xffcc33, 0xef6aa3, 0xf28c1a][k % 4], Math.cos(a) * (R - 1.6), 0.7, Math.sin(a) * (R - 1.6));
        if (k % 2 === 0) {
          add(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), 0x3a3f44, Math.cos(a) * (R - 3.6), 2.1, Math.sin(a) * (R - 3.6));
          const lm = new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd27a, emissiveIntensity: 0 }); this.lampMaterials.push(lm);
          const globe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lm); globe.position.set(Math.cos(a) * (R - 3.6), 3.8, Math.sin(a) * (R - 3.6)); g.add(globe);
        }
      }
      add(new THREE.CylinderGeometry(0.12, 0.14, 5.2, 8), 0x3a3f44, 0, 2.6, R - 2.6);
      const island = new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
      island.geometry.computeVertexNormals(); island.castShadow = true; island.receiveShadow = true; g.add(island);
      // Side roads: left (−right) and right (+right), leaving from the island edge
      const yaw = road.yawAt(rb.s);
      for (const side of [-1, 1]) {
        const sr = new Road(anisotropy, { route: [[40, 0], [120, side * 14], [160, 0]], start: { x: f.x + f.rx * side * (R - 2), z: f.z + f.rz * side * (R - 2), yaw: yaw - side * Math.PI / 2 }, ground: false });
        sr.group.position.y = -0.004;
        this.group.add(sr.group); this.sideRoads.push(sr);
      }
      // 4-face direction sign on the island: each face is read by traffic arriving from that side
      const dirs = DIRECTIONS[rb.name] ?? ['ঢাকা', 'কুষ্টিয়া', 'বামে', 'ডানে'];
      const [ahead, back, left, right] = dirs;
      const faces: [number, string[]][] = [
        [0, [`↑ ${ahead}`, `← ${left}   ${right} →`]],           // seen from the near side (arriving along +route) → faces +z local
        [Math.PI, [`↑ ${back}`, `← ${right}   ${left} →`]],       // seen by opposite traffic
        [Math.PI / 2, [`↑ ${right}`, `← ${ahead}   ${back} →`]],  // seen from the left side road
        [-Math.PI / 2, [`↑ ${left}`, `← ${back}   ${ahead} →`]],  // seen from the right side road
      ];
      for (const [rot, lines] of faces) {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.5), new THREE.MeshStandardMaterial({ map: makeTextTexture(lines, { bg: '#1f6fb5', fg: '#fff', w: 1024, h: 450, border: '#fff' }), roughness: 0.5 }));
        b.position.set(Math.sin(rot) * 0.1, 4.4, R - 2.6 + Math.cos(rot) * 0.1); b.rotation.y = rot; g.add(b);
      }
      const nameBoard = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), new THREE.MeshStandardMaterial({ map: makeTextTexture([`${rb.name} চত্বর`], { bg: '#d8262c', fg: '#fff', w: 1024, h: 210, border: '#fff' }), roughness: 0.5, side: THREE.DoubleSide }));
      nameBoard.position.set(0, 3.2, R - 2.6); g.add(nameBoard);
      this.group.add(g);
      COLLIDERS.add(f.x, f.z, R + 0.3);
    });
  }

  /** True when (x,z) is on one of the junction side roads (incl. shoulder). */
  onSideRoad(x: number, z: number): boolean {
    for (const sr of this.sideRoads) {
      const l = sr.locate(x, z, 0);
      if (l.s > 0 && l.s < sr.length && Math.abs(l.lateral) < WORLD.roadWidth / 2 + WORLD.shoulderWidth * 0.6) return true;
    }
    return false;
  }

  /** True when (x,z) lies on an island (kerb included). */
  inside(x: number, z: number, s: number): boolean {
    const R = WORLD.islandRadius + 0.4;
    for (const c of this.centres) if (Math.abs(c.s - s) < 60 && (c.x - x) ** 2 + (c.z - z) ** 2 < R * R) return true;
    return false;
  }

  setNight(on: boolean) { for (const m of this.lampMaterials) m.emissiveIntensity = on ? 2.5 : 0; }

  /** Distance along the bus heading until its front would touch an island kerb (Infinity if none). */
  wallDistance(x: number, z: number, yaw: number, s: number): number {
    const R = WORLD.islandRadius + 0.5;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = Infinity;
    for (const c of this.centres) {
      if (Math.abs(c.s - s) > 60) continue;
      const dx = c.x - x, dz = c.z - z;
      const along = dx * fx + dz * fz;        // island centre ahead?
      const perp = Math.abs(dx * fz - dz * fx);
      if (along < -2 || perp >= R) continue;
      const hit = along - Math.sqrt(R * R - perp * perp);
      best = Math.min(best, Math.max(0, hit));
    }
    return best;
  }
}
