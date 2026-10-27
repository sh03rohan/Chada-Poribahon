import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { WORLD } from '../config.ts';

export interface SkyState { hour: number; rain: number; night: boolean; sunElevation: number; }

/**
 * Procedural sky (Preetham model from three examples) driven by the device clock, with a
 * PMREM environment baked from it for PBR reflections. Re-baked when hour or weather changes.
 */
export class SkySystem {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x7a6a3a, 1);
  readonly state: SkyState = { hour: 12, rain: 0, night: false, sunElevation: 60 };
  private pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private sunDir = new THREE.Vector3();
  exposure = 0.7;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadows: boolean, shadowMapSize: number) {
    this.sky.scale.setScalar(10000);
    this.skyScene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      const c = this.sun.shadow.camera;
      c.near = 1; c.far = 160; c.left = -45; c.right = 45; c.top = 45; c.bottom = -45;
      this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03;
    }
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.FogExp2(0xc8d8e8, WORLD.fogDensity);
    scene.background = null;
    const h = new URLSearchParams(location.search).get('hour');
    const now = new Date();
    this.setTime(h !== null ? parseFloat(h) : now.getHours() + now.getMinutes() / 60);
  }

  setTime(hour: number) {
    this.state.hour = ((hour % 24) + 24) % 24;
    this.update();
  }

  setRain(r: number) {
    this.state.rain = THREE.MathUtils.clamp(r, 0, 1);
    this.update();
  }

  /** Point the shadow camera at the bus every frame. */
  follow(target: THREE.Vector3) {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 120);
  }

  private update() {
    const { hour, rain } = this.state;
    // Sun path: rises 6h, peaks 12h at 68°, sets 18h. Night = below horizon.
    const dayT = (hour - 6) / 12;                 // 0 sunrise .. 1 sunset
    const elevation = Math.sin(dayT * Math.PI) * 68;
    const azimuth = 100 + dayT * 160;             // sweep east→west
    const night = elevation < 1;
    this.state.night = night; this.state.sunElevation = elevation;

    const phi = THREE.MathUtils.degToRad(90 - Math.max(elevation, night ? -4 : elevation));
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 2 + rain * 14;
    u.rayleigh.value = night ? 0.2 : 1.4 + rain * 1.5;
    u.mieCoefficient.value = 0.005 + rain * 0.02;
    u.mieDirectionalG.value = 0.8;

    // Lights
    const dayAmount = THREE.MathUtils.clamp(elevation / 25, 0, 1);
    const warm = new THREE.Color().setHSL(0.09, 0.8, 0.62);        // low sun orange
    const white = new THREE.Color(0xfff4e0);
    this.sun.color.copy(warm).lerp(white, dayAmount);
    this.sun.intensity = night ? 0.45 : (0.6 + 1.9 * dayAmount) * (1 - rain * 0.65);
    if (night) this.sun.color.set(0x7a8fc0);
    this.sun.visible = true;

    const skyCol = night ? new THREE.Color(0x1a2238) : new THREE.Color(0x9fc3ff).lerp(new THREE.Color(0x8b8f98), rain);
    const groundCol = night ? new THREE.Color(0x1a1812) : new THREE.Color(0x6b6040);
    this.hemi.color.copy(skyCol); this.hemi.groundColor.copy(groundCol);
    this.hemi.intensity = night ? 0.55 : 0.25 + 0.3 * dayAmount - rain * 0.15;

    const fog = this.scene.fog as THREE.FogExp2;
    const fogDay = new THREE.Color(0xcad9e6).lerp(new THREE.Color(0xe8b98a), 1 - dayAmount);
    fog.color.copy(night ? new THREE.Color(0x0b1020) : fogDay.lerp(new THREE.Color(0x9aa2aa), rain));
    fog.density = WORLD.fogDensity * (1 + rain * 2.2 + (night ? 0.4 : 0));

    this.exposure = night ? 0.8 : 0.5 - rain * 0.08;
    this.renderer.toneMappingExposure = this.exposure;

    // Bake environment map: the sky dome lives in a tiny side scene while PMREM runs,
    // then goes back into the main scene where it is drawn as the backdrop.
    this.skyScene.add(this.sky);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.skyScene, 0.02);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = night ? 0.2 : 0.45 - rain * 0.15;
    this.scene.add(this.sky);
  }
}
