/**
 * Offline tuning harness: runs the pure physics at 120 Hz and prints measured
 * 0–60 km/h time, 60→0 braking distance, top speed and gear shift points.
 *   npm run tune
 */
import { createState, stepVehicle } from '../src/vehicle/physics.ts';
import { PHYSICS } from '../src/config.ts';

const dt = 1 / PHYSICS.hz;
const surf = { onRoad: true, wet: false, wallDistance: Infinity };

function run() {
  const s = createState();
  let t = 0, t60 = -1, t100 = -1, top = 0;
  const shifts: string[] = [];
  let lastGear = 0;
  while (t < 90) {
    stepVehicle(s, { throttle: 1, brake: 0, steer: 0, handbrake: false }, surf, dt);
    t += dt;
    const kmh = s.v * 3.6;
    if (t60 < 0 && kmh >= 60) t60 = t;
    if (t100 < 0 && kmh >= 100) t100 = t;
    if (s.gear !== lastGear) { shifts.push(`${lastGear + 1}→${s.gear + 1} @ ${kmh.toFixed(0)} km/h t=${t.toFixed(1)}s`); lastGear = s.gear; }
    top = Math.max(top, kmh);
  }
  // Braking from 60
  const b = createState();
  let tb = 0;
  while (b.v * 3.6 < 60 && tb < 60) { stepVehicle(b, { throttle: 1, brake: 0, steer: 0, handbrake: false }, surf, dt); tb += dt; }
  const x0 = b.x, z0 = b.z; let tBrake = 0;
  while (b.v > 0.05 && tBrake < 20) { stepVehicle(b, { throttle: 0, brake: 1, steer: 0, handbrake: false }, surf, dt); tBrake += dt; }
  const dist = Math.hypot(b.x - x0, b.z - z0);

  console.log(`0–60 km/h : ${t60.toFixed(2)} s   (target ${PHYSICS.target0to60s} s)`);
  console.log(`0–100 km/h: ${t100 < 0 ? 'never' : t100.toFixed(2) + ' s'}`);
  console.log(`Top speed : ${top.toFixed(1)} km/h (target ${PHYSICS.targetTopSpeedKmh}, governor ${PHYSICS.governorKmh})`);
  console.log(`60→0 brake: ${dist.toFixed(1)} m in ${tBrake.toFixed(2)} s`);
  console.log('Shifts    :', shifts.join(' | '));

  // Cornering feel: hold full steer at 40 / 70 / 100 km/h, report yaw rate, lateral g, body roll, slip
  for (const target of [40, 70, 100]) {
    const c = createState();
    let tc = 0;
    while (c.v * 3.6 < target && tc < 60) { stepVehicle(c, { throttle: 1, brake: 0, steer: 0, handbrake: false }, surf, dt); tc += dt; }
    let maxRoll = 0, latG = 0, yawDeg = 0, slip = false;
    for (let i = 0; i < 3 * PHYSICS.hz; i++) {
      stepVehicle(c, { throttle: 0.4, brake: 0, steer: 1, handbrake: false }, surf, dt);
      maxRoll = Math.max(maxRoll, Math.abs(c.roll)); latG = Math.abs(c.aLat) / 9.81; yawDeg = Math.abs(c.yawRate) * 180 / Math.PI; slip = slip || c.slipping;
    }
    const radius = c.v / Math.max(1e-3, Math.abs(c.yawRate));
    console.log(`Corner @${target} km/h: full lock → yaw ${yawDeg.toFixed(1)}°/s, radius ${radius.toFixed(0)} m, ${latG.toFixed(2)} g lateral, roll ${(maxRoll * 180 / Math.PI).toFixed(1)}°, grip-limited: ${slip}`);
  }
}
run();
