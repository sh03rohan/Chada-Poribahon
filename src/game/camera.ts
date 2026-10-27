import * as THREE from 'three';
import { CAMERA as C } from '../config.ts';

export type CameraMode = 'chase' | 'bonnet' | 'cockpit';
const MODES: CameraMode[] = ['chase', 'bonnet', 'cockpit'];

/**
 * Three camera rigs with smooth cross-fading between them. The cockpit rig is a child of the
 * body group so it inherits roll/pitch/heave exactly; chase uses a critically-damped follow.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private prevMode: CameraMode = 'chase';
  private blend = 1;              // 0 → 1 during a transition
  private chasePos = new THREE.Vector3();
  private shakeT = 0;
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3(); private tmpQ = new THREE.Quaternion();
  private fromPos = new THREE.Vector3(); private fromQuat = new THREE.Quaternion();
  private fovCur = C.fovBase;
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(C.fovBase, aspect, C.near, C.far);
    const q = new URLSearchParams(location.search).get('view');
    if (q === 'chase' || q === 'bonnet' || q === 'cockpit') this.mode = q;
  }

  next(): CameraMode {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
    return this.mode;
  }

  setMode(m: CameraMode) {
    if (m === this.mode) return;
    this.fromPos.copy(this.camera.position); this.fromQuat.copy(this.camera.quaternion);
    this.prevMode = this.mode; this.mode = m; this.blend = 0;
  }

  /**
   * @param root bus root (position + yaw)   @param body bus body (roll/pitch/heave)
   * @param kmh speed   @param rough 0..1 road roughness   @param dt frame time
   */
  update(root: THREE.Object3D, body: THREE.Object3D, kmh: number, rough: number, dt: number, aLat: number) {
    const cam = this.camera;
    // FOV with speed (ease-out so the sensation builds early)
    const sp = Math.min(1, kmh / C.fovSpeedKmh);
    const fovTarget = C.fovBase + (C.fovMax - C.fovBase) * (1 - Math.pow(1 - sp, 1.6));
    this.fovCur += (fovTarget - this.fovCur) * Math.min(1, dt * 3);
    cam.fov = this.fovCur; cam.updateProjectionMatrix();

    // Target pose for the current mode
    const pos = this.tmpA, look = this.tmpB;
    root.updateMatrixWorld(true);
    if (this.mode === 'chase') {
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);   // behind = +Z local
      const desired = root.position.clone().addScaledVector(back, C.chase.back).add(new THREE.Vector3(0, C.chase.up, 0));
      // lag the chase cam sideways a bit on cornering for a sense of weight
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
      desired.addScaledVector(right, -aLat * 0.12);
      if (!this.initialised) { this.chasePos.copy(desired); this.initialised = true; }
      // Exponential follow (stable for any frame time, unlike an explicit-Euler spring); a slow
      // frame just lags a little instead of launching the camera away. Snap if ever far off.
      const k = C.chase.stiffness;
      const a = 1 - Math.exp(-k * dt);
      this.chasePos.lerp(desired, a);
      if (this.chasePos.distanceTo(desired) > 40) this.chasePos.copy(desired);
      pos.copy(this.chasePos);
      look.copy(root.position).add(new THREE.Vector3(0, C.chase.lookUp, 0)).addScaledVector(back, -6);
      cam.position.copy(pos); cam.lookAt(look);
    } else if (this.mode === 'bonnet') {
      body.updateMatrixWorld(true);
      pos.set(0, C.bonnet.up, -C.bonnet.forward).applyMatrix4(body.matrixWorld);
      look.set(0, C.bonnet.up - 0.25, -C.bonnet.forward - 20).applyMatrix4(body.matrixWorld);
      cam.position.copy(pos); cam.lookAt(look);
    } else {
      body.updateMatrixWorld(true);
      pos.set(C.cockpit.x, C.cockpit.y, C.cockpit.z).applyMatrix4(body.matrixWorld);
      look.set(C.cockpit.x - 0.3, C.cockpit.y - C.cockpit.lookDown, C.cockpit.z - 30).applyMatrix4(body.matrixWorld);
      cam.position.copy(pos);
      // keep camera "up" aligned with the body so it rolls with the cabin
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(body.getWorldQuaternion(this.tmpQ));
      cam.up.copy(up); cam.lookAt(look); cam.up.set(0, 1, 0);
    }

    // Shake: high speed + rough surface
    this.shakeT += dt * (8 + kmh * 0.1);
    const amp = C.shakeAmplitude * Math.max(0, (kmh - C.shakeHighSpeedKmh) / 60) + C.shakeRoughAmplitude * rough * Math.min(1, kmh / 30);
    if (amp > 0.0005) {
      cam.position.x += Math.sin(this.shakeT * 1.7) * amp * 0.6;
      cam.position.y += Math.sin(this.shakeT * 2.3 + 1) * amp;
      cam.rotateZ(Math.sin(this.shakeT * 1.1) * amp * 0.08);
    }

    // Transition blend from previous pose
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / C.transitionTime);
      const e = 1 - Math.pow(1 - this.blend, 3);
      cam.position.lerpVectors(this.fromPos, cam.position, e);
      cam.quaternion.slerpQuaternions(this.fromQuat, cam.quaternion, e);
      void this.prevMode;
    }
  }

  /** Forget the chase spring state (after a teleport) so the camera re-appears behind the bus. */
  snap() { this.initialised = false; this.blend = 1; }

  resize(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
