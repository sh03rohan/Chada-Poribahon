import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createProceduralBus, type BusRig } from './busModel.ts';

/**
 * Tries /assets/bus.glb first. Expected node names (see README):
 *   body, wheel_FL, wheel_FR, wheel_RL, wheel_RR, steering_wheel (optional), door (optional)
 * Any missing required node → falls back to the procedural bus.
 */
export async function loadBus(opts: { anisotropy: number; shadows: boolean; people?: import('../world/people.ts').PeopleManager }): Promise<BusRig> {
  try {
    const head = await fetch('/assets/bus.glb', { method: 'HEAD' });
    const type = head.headers.get('content-type') || '';
    if (!head.ok || type.includes('text/html')) throw new Error('no glb');
    const gltf = await new GLTFLoader().loadAsync('/assets/bus.glb');
    const rig = wrapGltf(gltf.scene, opts);
    if (rig) { console.info('[bus] loaded /assets/bus.glb'); return rig; }
    console.warn('[bus] bus.glb is missing required nodes; using procedural bus');
  } catch {
    console.info('[bus] no /assets/bus.glb — using procedural bus');
  }
  return createProceduralBus(opts);
}

function wrapGltf(scene: THREE.Group, opts: { shadows: boolean }): BusRig | null {
  const find = (n: string) => scene.getObjectByName(n) ?? null;
  const bodyNode = find('body');
  const names = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
  const wheels = names.map(find);
  if (!bodyNode || wheels.some((w) => !w)) return null;

  const root = new THREE.Group(); root.name = 'bus';
  const body = new THREE.Group(); body.name = 'body';
  root.add(body);
  body.add(bodyNode);
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = opts.shadows; o.receiveShadow = opts.shadows; } });

  // Re-parent wheels under steer/spin groups at their world positions.
  const wheelSpin: THREE.Object3D[] = [], wheelSteer: THREE.Object3D[] = [];
  wheels.forEach((w, i) => {
    const pos = new THREE.Vector3(); w!.getWorldPosition(pos);
    const steer = new THREE.Group(); steer.position.copy(pos); steer.name = names[i];
    const spin = new THREE.Group();
    w!.position.set(0, 0, 0); w!.rotation.set(0, 0, 0);
    spin.add(w!); steer.add(spin); root.add(steer);
    wheelSpin.push(spin); if (i < 2) wheelSteer.push(steer);
  });

  const headlights: THREE.SpotLight[] = [];
  for (const x of [-0.8, 0.8]) {
    const s = new THREE.SpotLight(0xfff1d6, 0, 70, 0.5, 0.55, 1.2);
    s.position.set(x, 1.1, -5.5); s.target.position.set(x * 1.5, 0, -35);
    body.add(s, s.target); headlights.push(s);
  }
  const emissives: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.emissive && /light|lamp/i.test(o.name)) emissives.push(m); });

  return {
    root, body, wheelSpin, wheelSteer, steeringWheel: find('steering_wheel'), door: find('door'), headlights, isProcedural: false,
    setLights({ headlights: on, brake }) { for (const s of headlights) s.intensity = on ? 900 : 0; for (const m of emissives) m.emissiveIntensity = (on ? 1 : 0.2) + brake * 3; },
    setWipers() { /* not available on GLB rig */ },
    setPassengers() { /* GLB rig has no passenger instances */ },
    setCockpitMode() { /* nothing to hide */ },
    updateSpeedo() { /* no dashboard canvas */ },
    setDoor(open) { const d = find('door'); if (d) d.rotation.y = -open * 1.2; },
    updateDriver(steerAngle) { const w = find('steering_wheel'); if (w) w.rotation.z = -steerAngle * 4.5; },
    driver: null, helper: null, riders: [], setPassengerPose() { /* no humanoids on GLB rig */ }, setDriverHandTarget() { /* no driver on GLB rig */ },
  };
}
