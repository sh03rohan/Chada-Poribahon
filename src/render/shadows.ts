import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

/**
 * Cascaded shadow maps for the high tier: three cascades that follow the camera frustum, so the
 * near shadows stay crisp while the far ones still exist. The sky's single sun stops casting and
 * the cascade lights copy its colour and intensity every frame.
 */
export class Cascades {
  readonly csm: CSM;
  private materials = new Set<THREE.Material>();
  constructor(scene: THREE.Scene, camera: THREE.Camera, sunDir: THREE.Vector3, shadowMapSize: number) {
    this.csm = new CSM({ maxFar: 240, cascades: 3, mode: 'practical', parent: scene, shadowMapSize, lightDirection: sunDir.clone().negate(), camera, lightIntensity: 2, lightMargin: 120 });
    this.csm.fade = true;
    for (const l of this.csm.lights) { l.shadow.bias = -0.0003; l.shadow.normalBias = 0.04; l.shadow.radius = 2; }
  }
  /** Patch every mesh material under root so it samples the cascades (idempotent). */
  setupScene(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material; if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) { if (this.materials.has(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue; this.csm.setupMaterial(mat); this.materials.add(mat); }
    });
  }
  update(sunDir: THREE.Vector3, color: THREE.Color, intensity: number) {
    this.csm.lightDirection.copy(sunDir).negate();
    for (const l of this.csm.lights) { l.color.copy(color); l.intensity = intensity; }
    this.csm.update();
  }
  resize() { this.csm.updateFrustums(); }
}
