import * as THREE from 'three';
import { WORLD } from '../config.ts';
import type { Road } from './road.ts';
import { makeTextTexture } from './textures.ts';

/**
 * City roundabouts: a kerbed island with a monument, flower beds, lamps and a name board, sitting
 * in the widened section of road (see Road.bulge). `wallDistance` keeps the bus from driving onto it.
 */
export class Roundabouts {
  readonly group = new THREE.Group();
  private centres: { x: number; z: number; s: number }[] = [];
  readonly lampMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(private road: Road) {
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
      const base = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.3, 0.42, 36), kerb); base.position.y = 0.21; base.receiveShadow = true; g.add(base);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.6, R - 0.6, 0.1, 36), grass); top.position.y = 0.47; g.add(top);
      // inner ring path + monument (generic: stepped plinth, tapered pillar, golden finial)
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.0, 36), kerb); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.53; g.add(ring);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 0.6, 12), white); plinth.position.y = 0.8; plinth.castShadow = true; g.add(plinth);
      const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, 0.5, 12), white); plinth2.position.y = 1.35; g.add(plinth2);
      const variant = i % 3;
      if (variant === 0) {        // obelisk
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 7, 8), white); pillar.position.y = 5.1; pillar.castShadow = true; g.add(pillar);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 8), gold); tip.position.y = 9.2; g.add(tip);
      } else if (variant === 1) { // arch of three fins
        for (const a of [0, 2.1, -2.1]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.5, 1.6), white); fin.position.set(Math.sin(a) * 1.0, 4.8, Math.cos(a) * 1.0); fin.rotation.y = a; fin.castShadow = true; g.add(fin); }
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), gold); orb.position.y = 8.6; g.add(orb);
      } else {                    // boat-like sculpture on a column
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 5, 10), white); col.position.y = 4.1; col.castShadow = true; g.add(col);
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.2, 4.4, 8).rotateZ(Math.PI / 2).scale(1, 0.55, 1), gold); hull.position.y = 6.9; g.add(hull);
        const sail = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 4), white); sail.position.set(0.3, 8.4, 0); g.add(sail);
      }
      // flower beds + small lamps around the island
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        const bed = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshStandardMaterial({ color: [0xd8262c, 0xffcc33, 0xef6aa3, 0xf28c1a][k % 4], roughness: 0.9 }));
        bed.position.set(Math.cos(a) * (R - 1.6), 0.7, Math.sin(a) * (R - 1.6)); bed.scale.y = 0.6; g.add(bed);
        if (k % 2 === 0) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x3a3f44, metalness: 0.5 })); post.position.set(Math.cos(a) * (R - 3.6), 2.1, Math.sin(a) * (R - 3.6)); g.add(post);
          const lm = new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd27a, emissiveIntensity: 0 }); this.lampMaterials.push(lm);
          const globe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lm); globe.position.set(Math.cos(a) * (R - 3.6), 3.8, Math.sin(a) * (R - 3.6)); g.add(globe);
        }
      }
      // name board facing arriving traffic
      const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.1), new THREE.MeshStandardMaterial({ map: makeTextTexture([`${rb.name} গোল চত্বর`], { bg: '#1f6fb5', fg: '#fff', w: 1024, h: 268, border: '#fff' }), roughness: 0.5, side: THREE.DoubleSide }));
      board.position.set(0, 2.6, R - 0.2); g.add(board);
      const board2 = board.clone(); board2.position.z = -(R - 0.2); board2.rotation.y = Math.PI; g.add(board2);
      this.group.add(g);
    });
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
