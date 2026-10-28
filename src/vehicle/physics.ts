/**
 * Arcade-realistic bus physics. Pure TypeScript, no three.js dependency so it can be
 * unit-tested / tuned from Node (see scripts/tune.ts).
 *
 * Coordinate convention (matches three.js): y up, bus forward = local -Z.
 *   forward = (-sin yaw, 0, -cos yaw)   right = (cos yaw, 0, -sin yaw)
 */
import { PHYSICS as P } from '../config.ts';

export interface VehicleInput {
  throttle: number;   // 0..1
  brake: number;      // 0..1
  steer: number;      // -1 (left) .. 1 (right)
  handbrake: boolean;
}

export interface SurfaceInfo {
  onRoad: boolean;
  wet: boolean;
  /** Hard stop ahead (e.g. blockade): distance in metres along forward axis, or Infinity. */
  wallDistance: number;
}

export interface VehicleState {
  x: number; z: number; yaw: number;
  /** longitudinal speed m/s (+ forward) */
  v: number;
  /** lateral slide speed m/s (+ right) */
  vLat: number;
  yawRate: number;
  gear: number;        // 0-based index into gearRatios
  rpm: number;
  shiftTimer: number;  // >0 while shifting
  throttle: number;    // smoothed pedal
  brake: number;       // smoothed pedal
  steerInput: number;  // smoothed -1..1
  steerAngle: number;  // actual front wheel angle rad
  // Body motion
  roll: number; rollVel: number;
  pitch: number; pitchVel: number;
  heave: number; heaveVel: number;
  wheelSpin: number;   // rad accumulated
  // Derived (for consumers)
  aLong: number; aLat: number;
  slipping: boolean;
  onRoad: boolean;
  engineForce: number;
}

export function createState(x = 0, z = 0, yaw = 0): VehicleState {
  return {
    x, z, yaw, v: 0, vLat: 0, yawRate: 0, gear: 0, rpm: P.idleRpm, shiftTimer: 0,
    throttle: 0, brake: 0, steerInput: 0, steerAngle: 0,
    roll: 0, rollVel: 0, pitch: 0, pitchVel: 0, heave: 0, heaveVel: 0,
    wheelSpin: 0, aLong: 0, aLat: 0, slipping: false, onRoad: true, engineForce: 0,
  };
}

export function copyState(dst: VehicleState, src: VehicleState): void {
  Object.assign(dst, src);
}

/** Garage upgrade multipliers (set from the career profile before a run). */
export const MODS = { brake: 1, torque: 1, grip: 1 };

export function torqueAt(rpm: number): number {
  return rawTorqueAt(rpm) * MODS.torque;
}
function rawTorqueAt(rpm: number): number {
  const c = P.torqueCurve;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return c[c.length - 1][1];
}

export function rpmFromSpeed(v: number, gear: number): number {
  const ratio = P.gearRatios[gear] * P.finalDrive;
  return Math.abs(v) / P.wheelRadius * ratio * 60 / (2 * Math.PI);
}

function approach(cur: number, target: number, rate: number, dt: number): number {
  const d = target - cur;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

const G = 9.81;

/** Deterministic hash noise for road roughness (so feel is frame-rate independent). */
function roughNoise(t: number): number {
  const s = Math.sin(t * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export function stepVehicle(s: VehicleState, input: VehicleInput, surf: SurfaceInfo, dt: number): void {
  // ---- Pedals (smoothed) -------------------------------------------------
  const thrTarget = Math.max(0, Math.min(1, input.throttle));
  s.throttle = approach(s.throttle, thrTarget, thrTarget > s.throttle ? P.throttleRampUp : P.throttleRampDown, dt);
  const brkTarget = Math.max(0, Math.min(1, input.brake));
  s.brake = approach(s.brake, brkTarget, brkTarget > s.brake ? P.brakeRampUp : P.brakeRampDown, dt);

  const kmh = Math.abs(s.v) * 3.6;

  // ---- Steering ----------------------------------------------------------
  const steerTarget = Math.max(-1, Math.min(1, input.steer));
  if (Math.abs(steerTarget) > 0.01) s.steerInput = approach(s.steerInput, steerTarget, P.steerInputRate, dt);
  else s.steerInput = approach(s.steerInput, 0, P.steerReturnRate, dt);
  const maxSteer = P.maxSteerLowSpeed / (1 + kmh / P.steerSpeedFalloffKmh);
  s.steerAngle = s.steerInput * maxSteer;

  // ---- Gearbox -----------------------------------------------------------
  if (s.shiftTimer > 0) s.shiftTimer -= dt;
  const wheelRpm = rpmFromSpeed(s.v, s.gear);
  if (s.shiftTimer <= 0) {
    if (wheelRpm > P.shiftUpRpm && s.gear < P.gearRatios.length - 1 && s.v > 0) {
      s.gear++; s.shiftTimer = P.shiftDelay;
    } else if (wheelRpm < P.shiftDownRpm && s.gear > 0) {
      s.gear--; s.shiftTimer = P.shiftDelay * 0.6;
    }
  }
  const ratio = P.gearRatios[s.gear] * P.finalDrive;
  const drivenRpm = rpmFromSpeed(s.v, s.gear);
  // Engine rpm: follows wheels when clutched, blends toward idle/throttle when nearly stopped.
  const targetRpm = Math.max(P.idleRpm, Math.min(P.redlineRpm, drivenRpm > P.idleRpm ? drivenRpm : P.idleRpm + s.throttle * 500));
  s.rpm += (targetRpm - s.rpm) * Math.min(1, dt * 14);

  // ---- Longitudinal forces ----------------------------------------------
  let throttleEff = s.throttle;
  // Soft governor
  const govStart = P.targetTopSpeedKmh;
  if (kmh > govStart) throttleEff *= Math.max(0, 1 - (kmh - govStart) / (P.governorKmh - govStart));
  if (s.shiftTimer > 0) throttleEff *= 0.08;

  let fEngine = 0;
  if (s.v >= -0.01) {
    fEngine = torqueAt(s.rpm) * throttleEff * ratio * P.drivetrainEfficiency / P.wheelRadius;
    // Engine braking when off throttle
    if (s.throttle < 0.05 && s.v > 0.5) {
      fEngine -= P.engineBrakeTorque * (s.rpm / P.redlineRpm) * ratio * 0.5 / P.wheelRadius;
    }
  }
  // Reverse: hold brake while stopped for a moment → creep backwards slowly (arcade simplification)
  let fReverse = 0;
  if (s.v <= 0.3 && s.brake > 0.5 && s.throttle < 0.05) {
    fReverse = -P.brakeForce * 0.12 * s.brake;
  }

  const vAbs = Math.abs(s.v);
  const fDrag = 0.5 * P.airDensity * P.dragCoefficient * P.frontalArea * vAbs * vAbs;
  const crr = P.rollingResistance + (surf.onRoad ? 0 : P.offRoadResistance);
  const fRoll = vAbs > 0.05 ? crr * P.mass * G : 0;
  const fBrake = P.brakeForce * MODS.brake * (s.v > 0.3 ? s.brake : 0) + (input.handbrake ? P.handbrakeForce : 0);

  let fNet = fEngine + fReverse;
  const sign = s.v >= 0 ? 1 : -1;
  const resist = (fDrag + fRoll + fBrake) * sign;
  // Prevent resistance from reversing the sign of velocity in one step.
  const maxResistImpulse = Math.abs(s.v) * P.mass / dt;
  const resistClamped = Math.min(Math.abs(resist), maxResistImpulse) * sign;
  fNet -= resistClamped;
  if (s.v < -0.01 && fReverse === 0 && s.brake < 0.5) fNet += Math.min(Math.abs(s.v) * P.mass / dt, P.brakeForce * 0.5); // decel reverse when released

  let aLong = fNet / P.mass;
  if (input.handbrake && Math.abs(s.v) < 0.2 && s.throttle < 0.3) { aLong = 0; s.v = 0; }

  // ---- Lateral / yaw (bicycle model with grip limit) -----------------------
  let mu = (surf.wet ? P.gripWet : P.gripDry) * MODS.grip;
  if (!surf.onRoad) mu = Math.min(mu, P.gripOffRoad);
  if (input.handbrake) mu = Math.min(mu, P.gripHandbrake);
  const aMax = mu * G;

  // In three.js (y-up, right-handed) +yaw turns the nose LEFT, so a right turn (+steer) is a
  // negative yaw rate. aReq / aLat are defined positive toward the RIGHT.
  const tanSteer = Math.tan(s.steerAngle);
  const kinYaw = s.v * tanSteer / P.wheelbase;   // magnitude/sign in "steer" sense
  let yawTarget = -kinYaw;
  const aReq = s.v * kinYaw;
  let slipping = false;
  if (Math.abs(aReq) > aMax) {
    yawTarget *= aMax / Math.abs(aReq);
    slipping = true;
    // Excess demand becomes a sideways slide (understeer push toward the outside of the corner)
    const excess = (Math.abs(aReq) - aMax) * Math.sign(aReq);
    s.vLat -= excess * 0.35 * dt;
  }
  const tau = P.yawResponseTau + (P.yawResponseTauHighSpeed - P.yawResponseTau) * Math.min(1, kmh / 120);
  s.yawRate += (yawTarget - s.yawRate) * Math.min(1, dt / tau);
  // Lateral slide decays with available grip
  const latDamp = P.lateralDamping * (mu / P.gripDry);
  s.vLat -= s.vLat * Math.min(1, latDamp * dt);
  if (Math.abs(s.vLat) < 0.002) s.vLat = 0;

  const aLat = -s.v * s.yawRate; // centripetal, + = right (for body roll + mood)

  // ---- Integrate ---------------------------------------------------------
  s.v += aLong * dt;
  if (Math.abs(s.v) < 0.003 && s.throttle < 0.02 && fReverse === 0) s.v = 0;
  s.yaw += s.yawRate * dt;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  let dx = (fx * s.v + rx * s.vLat) * dt;
  let dz = (fz * s.v + rz * s.vLat) * dt;

  // Hard wall ahead (blockade)
  if (surf.wallDistance < Infinity && s.v > 0) {
    const move = s.v * dt;
    if (move >= surf.wallDistance - 0.05) {
      const k = Math.max(0, (surf.wallDistance - 0.05)) / move;
      dx *= k; dz *= k;
      s.v = 0; aLong = -Math.abs(aLong) - 6;
    }
  }
  s.x += dx; s.z += dz;

  // ---- Body motion: second-order spring-damper on roll/pitch/heave --------
  const rollTarget = Math.max(-P.maxRoll, Math.min(P.maxRoll, aLat * P.rollPerLateralG));
  // +rotation.x lifts the nose (nose is at -Z), so braking (aLong < 0) must dip it → same sign as aLong.
  const pitchTarget = Math.max(-P.maxPitch, Math.min(P.maxPitch, aLong * P.pitchPerLongG));
  const w = P.bodyOmega, z2 = 2 * P.bodyZeta * P.bodyOmega;
  s.rollVel += (w * w * (rollTarget - s.roll) - z2 * s.rollVel) * dt;
  s.roll += s.rollVel * dt;
  s.pitchVel += (w * w * (pitchTarget - s.pitch) - z2 * s.pitchVel) * dt;
  s.pitch += s.pitchVel * dt;

  // Heave excited by road roughness scaled by speed
  s.wheelSpin += s.v / P.wheelRadius * dt;
  const roughAmp = (surf.onRoad ? P.roughnessAmplitude : P.roughnessOffRoad) * Math.min(1, kmh / 40);
  const bump = roughNoise(Math.floor(s.wheelSpin * 3)) * roughAmp;
  const hw = P.heaveOmega, hz2 = 2 * P.heaveZeta * P.heaveOmega;
  s.heaveVel += (hw * hw * (bump - s.heave) - hz2 * s.heaveVel) * dt;
  s.heave += s.heaveVel * dt;

  s.aLong = aLong; s.aLat = aLat; s.slipping = slipping; s.onRoad = surf.onRoad; s.engineForce = fEngine;
}

/** Interpolate render pose between two physics states (alpha 0..1). */
export function lerpPose(a: VehicleState, b: VehicleState, t: number) {
  let dyaw = b.yaw - a.yaw;
  if (dyaw > Math.PI) dyaw -= 2 * Math.PI; else if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: a.yaw + dyaw * t,
    roll: a.roll + (b.roll - a.roll) * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    heave: a.heave + (b.heave - a.heave) * t,
    wheelSpin: a.wheelSpin + (b.wheelSpin - a.wheelSpin) * t,
    steerAngle: a.steerAngle + (b.steerAngle - a.steerAngle) * t,
  };
}
