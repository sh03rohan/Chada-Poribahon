import type { VehicleState } from '../vehicle/physics.ts';
import { PHYSICS } from '../config.ts';

/**
 * Static obstacle colliders (circles in the XZ plane) in a uniform grid, plus the bus-vs-circle
 * solver. Every world builder registers what it places (trees, poles, buildings, shops, posts…);
 * traffic vehicles are passed in per step as dynamic circles.
 *
 * The bus is modelled as 5 circles along its axis. Penetrations are resolved by pushing the bus
 * out along the contact normal and killing the velocity component into the obstacle, so the bus
 * stops against a wall / slides along it instead of passing through.
 */
export interface Circle {
  x: number; z: number; r: number;
  /** dynamic obstacles (traffic): mass in kg → momentum exchange instead of a hard stop */
  mass?: number;
  /** world velocity of a dynamic obstacle (m/s), so impacts use the closing speed */
  vx?: number; vz?: number;
  /** owner object handed back in the contact list (e.g. the traffic vehicle) */
  tag?: unknown;
}

/** One bus↔circle impact this step (only recorded for circles with a mass). */
export interface Contact {
  circle: Circle;
  /** closing speed along the normal before the hit (m/s) */
  into: number;
  /** speed handed to the obstacle along -n (m/s) */
  dv: number;
  /** position correction the obstacle should take along -n (m) */
  push: number;
  /** normal from obstacle to bus */
  nx: number; nz: number;
}

const CELL = 24;

export class StaticColliders {
  private cells = new Map<string, Circle[]>();
  count = 0;
  private key(cx: number, cz: number) { return cx + ',' + cz; }

  add(x: number, z: number, r: number) {
    const c: Circle = { x, z, r };
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const k = this.key(cx, cz);
    let arr = this.cells.get(k); if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(c); this.count++;
  }

  /** Oriented box (yaw = three.js rotation.y, w along local X, d along local Z) as a row of circles. */
  addBox(x: number, z: number, yaw: number, w: number, d: number) {
    const long = Math.max(w, d), short = Math.min(w, d);
    const r = short / 2;
    const n = Math.max(1, Math.ceil(long / short));
    const step = n > 1 ? (long - short) / (n - 1) : 0;
    // local long axis direction in world space
    const alongX = w >= d;
    const ax = alongX ? Math.cos(yaw) : Math.sin(yaw), az = alongX ? -Math.sin(yaw) : Math.cos(yaw);
    for (let i = 0; i < n; i++) {
      const o = -(long - short) / 2 + i * step;
      this.add(x + ax * o, z + az * o, r * 1.02);
    }
  }

  /** Circles within `range` of (x,z). */
  query(x: number, z: number, range: number, out: Circle[] = []): Circle[] {
    const c0 = Math.floor((x - range) / CELL), c1 = Math.floor((x + range) / CELL);
    const z0 = Math.floor((z - range) / CELL), z1 = Math.floor((z + range) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.cells.get(this.key(cx, cz)); if (arr) for (const c of arr) out.push(c);
    }
    return out;
  }
}

export const COLLIDERS = new StaticColliders();

const BUS_SAMPLES = [-5.0, -2.5, 0, 2.5, 5.0];  // along local Z (negative = front)
const BUS_R = 1.3;

export interface CollisionResult { hit: boolean; impact: number; contacts: Contact[]; }

/**
 * Resolve the bus against static + dynamic circles. Returns the largest impact speed (m/s)
 * removed this step, so the caller can score damage / mood.
 */
export function resolveBusCollisions(s: VehicleState, dynamic: Circle[], scratch: Circle[] = [], contacts: Contact[] = []): CollisionResult {
  scratch.length = 0; contacts.length = 0;
  COLLIDERS.query(s.x, s.z, 9, scratch);
  for (const d of dynamic) scratch.push(d);
  if (scratch.length === 0) return { hit: false, impact: 0, contacts };
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  const M = PHYSICS.mass;
  let hit = false, impact = 0;
  const impulsed = new Set<unknown>();
  for (let iter = 0; iter < 2; iter++) {
    for (const off of BUS_SAMPLES) {
      const bx = s.x + fx * -off, bz = s.z + fz * -off;   // sample centre (off<0 → front → along +forward)
      for (const c of scratch) {
        const dx = bx - c.x, dz = bz - c.z;
        const rr = BUS_R + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;           // normal pointing from obstacle to bus
        const pen = rr - d;
        // velocity into the obstacle: v_world = f·v + r·vLat
        const vx = fx * s.v + rx * s.vLat, vz = fz * s.v + rz * s.vLat;
        const into = -((vx - (c.vx ?? 0)) * nx + (vz - (c.vz ?? 0)) * nz);   // closing speed along n
        if (c.mass !== undefined) {
          // ---- vehicle: inelastic momentum exchange. The bus keeps M/(M+m) of its closing speed
          // and the other vehicle is shoved along -n; the overlap is split by the same ratio.
          // The impulse is exchanged once per vehicle per step (a vehicle is several circles).
          const k = c.mass / (M + c.mass);           // fraction the bus loses
          s.x += nx * pen * k; s.z += nz * pen * k;
          const first = c.tag === undefined || !impulsed.has(c.tag);
          if (into > 0 && first) {
            if (c.tag !== undefined) impulsed.add(c.tag);
            impact = Math.max(impact, into);
            const lost = into * k;                       // bus speed removed along n
            const nvx = vx + nx * lost, nvz = vz + nz * lost;
            // crumple / friction loss on top of the momentum exchange
            const loss = into > 1 ? 0.92 : 1;
            s.v = (nvx * fx + nvz * fz) * loss;
            s.vLat = (nvx * rx + nvz * rz) * (into > 1 ? 0.6 : 0.9);
            // off-centre hits twist the bus: torque = r × J (r = sample offset along the axis)
            const px = fx * -off, pz = fz * -off;
            const jx = nx * lost, jz = nz * lost;
            s.yawRate += (pz * jx - px * jz) / 10 * 0.5;
            contacts.push({ circle: c, into, dv: into * (1 - k), push: pen * (1 - k), nx, nz });
          } else contacts.push({ circle: c, into: 0, dv: 0, push: pen * (1 - k), nx, nz });
        } else {
          s.x += nx * pen; s.z += nz * pen;
          if (into > 0) {
            impact = Math.max(impact, into);
            const nvx = vx + nx * into, nvz = vz + nz * into;   // remove the component into the obstacle
            // a real impact scrubs speed; gentle contact just slides along the obstacle (no sticking)
            const scrub = into > 1.0 ? 0.55 : 1.0;
            s.v = (nvx * fx + nvz * fz) * scrub;
            s.vLat = (nvx * rx + nvz * rz) * (into > 1.0 ? 0.3 : 0.8);
            if (into > 1.0) s.yawRate *= 0.3;
          }
        }
        hit = true;
      }
    }
  }
  return { hit, impact, contacts };
}
