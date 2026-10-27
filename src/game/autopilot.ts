import type { Road } from '../world/road.ts';
import type { VehicleState } from '../vehicle/physics.ts';

/**
 * Tiny pure-pursuit autopilot used by the Playwright harness (and handy for debugging):
 * steers toward a look-ahead point in the left lane. Not used by normal gameplay.
 */
export function autopilotSteer(road: Road, s: number, st: VehicleState, laneOffset = -1.75, dir: 1 | -1 = 1): number {
  const look = 8 + st.v * 0.9;
  const p = road.sample(s + look * dir);
  const tx = p.x + p.rx * laneOffset * dir, tz = p.z + p.rz * laneOffset * dir;
  const dx = tx - st.x, dz = tz - st.z;
  // angle between bus forward and target vector (positive = target to the right)
  const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
  const rx = Math.cos(st.yaw), rz = -Math.sin(st.yaw);
  const fwd = dx * fx + dz * fz, right = dx * rx + dz * rz;
  const ang = Math.atan2(right, Math.max(0.1, fwd));
  return Math.max(-1, Math.min(1, ang * 2.2));
}
