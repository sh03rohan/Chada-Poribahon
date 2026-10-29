import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { WORLD } from '../config.ts';

export interface SkyState { hour: number; rain: number; fog: number; storm: number; night: boolean; sunElevation: number; }

/**
 * Procedural sky (Preetham model from three examples) driven by the device clock, with a
 * PMREM environment baked from it for PBR reflections. Re-baked when hour or weather changes.
 */
export class SkySystem {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x7a6a3a, 1);
  readonly state: SkyState = { hour: 12, rain: 0, fog: 0, storm: 0, night: false, sunElevation: 60 };
  /** Lightning: 0..1, decays over ~0.25 s; applied on top of the baked lighting in tick(). */
  private flashT = 0;
  private baseHemi = 1; private baseExposure = 0.7;
  private pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private sunDir = new THREE.Vector3();
  exposure = 0.7;
  private sunDisc: THREE.Sprite; private sunGlow: THREE.Sprite; private moon: THREE.Sprite; private stars: THREE.Points; private clouds: THREE.Mesh; private overcast: THREE.Mesh;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadows: boolean, shadowMapSize: number) {
    this.sky.scale.setScalar(10000);
    this.skyScene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      const c = this.sun.shadow.camera;
      c.near = 1; c.far = 220; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60;
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.05; this.sun.shadow.radius = 2;
    }
    scene.add(this.sun, this.sun.target, this.hemi);
    // Visible sun (disc + soft glow), moon and stars; drawn beyond the fog
    const spr = (color: string, inner: number) => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, color); g.addColorStop(inner, color); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending }));
    };
    this.sunDisc = spr('rgba(255,250,225,1)', 0.55); this.sunDisc.scale.setScalar(70); this.sunDisc.renderOrder = -2;
    this.sunGlow = spr('rgba(255,210,140,0.55)', 0.05); this.sunGlow.scale.setScalar(260); this.sunGlow.renderOrder = -3;
    this.moon = spr('rgba(235,240,255,1)', 0.6); this.moon.scale.setScalar(55); this.moon.renderOrder = -2;
    const starPos = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) { const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08; const r = 1500; starPos.set([Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    // Cloud dome: noise alpha; thickens with rain
    const cc = document.createElement('canvas'); cc.width = 1024; cc.height = 512; const cx = cc.getContext('2d')!;
    cx.clearRect(0, 0, 1024, 512);
    for (let i = 0; i < 900; i++) { const x = Math.random() * 1024, y = 120 + Math.random() * 300, r = 20 + Math.random() * 70; const g = cx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = g; cx.fillRect(x - r, y - r, r * 2, r * 2); }
    const ct = new THREE.CanvasTexture(cc); ct.wrapS = THREE.RepeatWrapping; ct.repeat.set(2, 1);
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.2, side: THREE.BackSide, depthWrite: false, fog: false, color: 0xffffff }));
    this.clouds.renderOrder = -1; this.clouds.frustumCulled = false;
    // Overcast dome: a flat grey shell that hides the sky shader in fog (pale) and storms (dark)
    this.overcast = new THREE.Mesh(new THREE.SphereGeometry(1450, 24, 12), new THREE.MeshBasicMaterial({ color: 0xc3c8cd, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.overcast.renderOrder = -2; this.overcast.frustumCulled = false; this.overcast.visible = false;
    scene.add(this.sunDisc, this.sunGlow, this.moon, this.stars, this.clouds, this.overcast);
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
  /** Thick morning fog: 0 clear .. 1 dense (grey dome, dim sun, short view). */
  setFog(f: number) {
    this.state.fog = THREE.MathUtils.clamp(f, 0, 1);
    this.update();
  }
  /** Storm darkening on top of rain (0..1): blacker clouds, lower exposure. */
  setStorm(s: number) {
    this.state.storm = THREE.MathUtils.clamp(s, 0, 1);
    this.update();
  }
  /** Lightning flash: whole scene brightens for a few frames. */
  flash(strength = 1) { this.flashT = Math.max(this.flashT, strength); }
  get flashing() { return this.flashT > 0.05; }
  /** Per-frame: decay the lightning flash (cheap — no env re-bake). */
  tick(dt: number) {
    if (this.flashT <= 0) return;
    this.flashT = Math.max(0, this.flashT - dt * 4.5);
    const k = this.flashT;
    this.hemi.intensity = this.baseHemi + k * 2.6;
    this.renderer.toneMappingExposure = this.baseExposure + k * 0.5;
    if (k === 0) { this.hemi.intensity = this.baseHemi; this.renderer.toneMappingExposure = this.baseExposure; }
  }

  /** Point the shadow camera at the bus every frame. */
  follow(target: THREE.Vector3) {
    this.bakeEnv();
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 120);
    this.sunDisc.position.copy(target).addScaledVector(this.sunDir, 1500);
    this.sunGlow.position.copy(this.sunDisc.position);
    this.moon.position.copy(target).addScaledVector(this.moonDir, 1500);
    this.stars.position.copy(target); this.clouds.position.copy(target); this.overcast.position.copy(target);
    this.sky.position.copy(target); // the sky box is 10 km wide: keep it centred on the bus so long routes never leave it
    this.clouds.rotation.y += 0.00004;
  }
  private moonDir = new THREE.Vector3(0.4, 0.6, -0.5).normalize();

  private update() {
    const { hour, rain, storm } = this.state; const fogLvl = this.state.fog;
    // Sun path: rises 6h, peaks 12h at 68°, sets 18h. Night = below horizon.
    const dayT = (hour - 6) / 12;                 // 0 sunrise .. 1 sunset
    const elevation = Math.sin(dayT * Math.PI) * 68;
    const azimuth = 100 + dayT * 160;             // sweep east→west
    const night = elevation < 1;
    this.state.night = night; this.state.sunElevation = elevation;

    // at night push the shader sun well below the horizon so the dome goes properly dark
    const phi = THREE.MathUtils.degToRad(90 - (night ? Math.min(elevation, -18) : elevation));
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 2 + rain * 14 + fogLvl * 10 + storm * 4;
    u.rayleigh.value = night ? 0.2 : 1.4 + rain * 1.5;
    u.mieCoefficient.value = 0.005 + rain * 0.02;
    u.mieDirectionalG.value = 0.8;

    // Lights
    const dayAmount = THREE.MathUtils.clamp(elevation / 25, 0, 1);
    const warm = new THREE.Color().setHSL(0.09, 0.8, 0.62);        // low sun orange
    const white = new THREE.Color(0xfff4e0);
    this.sun.color.copy(warm).lerp(white, dayAmount);
    this.sun.intensity = (night ? 1.0 : (0.6 + 1.9 * dayAmount) * (1 - rain * 0.72)) * (1 - fogLvl * 0.6) * (1 - storm * 0.3);
    if (night) { this.sun.color.set(0x9fb4dc); this.sunDir.copy(this.moonDir); }
    this.sun.visible = true;
    // visible sun / moon / stars / clouds
    this.sunDisc.visible = this.sunGlow.visible = !night && elevation > -3;
    (this.sunDisc.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - rain * 0.85 - fogLvl * 0.9);
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = (0.18 + 0.25 * (1 - dayAmount)) * (1 - rain) * (1 - fogLvl);
    this.sunDisc.material.color.copy(new THREE.Color().setHSL(0.09, 0.9, 0.7).lerp(new THREE.Color(0xfffbe8), dayAmount));
    this.moon.visible = night;
    (this.stars.material as THREE.PointsMaterial).opacity = night ? 0.9 * (1 - rain) * (1 - fogLvl) : 0;
    (this.clouds.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (night ? 0.06 : 0.22) + rain * 0.6 + fogLvl * 0.5 + storm * 0.2);
    (this.clouds.material as THREE.MeshBasicMaterial).color.set(night ? 0x202430 : 0xffffff).lerp(new THREE.Color(0x6a6e75), rain).lerp(new THREE.Color(0xb9bdc2), fogLvl).lerp(new THREE.Color(0x2e3238), storm * 0.8);

    const skyCol = (night ? new THREE.Color(0x4a5c84) : new THREE.Color(0x9fc3ff).lerp(new THREE.Color(0x8b8f98), rain)).lerp(new THREE.Color(night ? 0x394050 : 0xc2c7cc), fogLvl);
    const groundCol = night ? new THREE.Color(0x2a2820) : new THREE.Color(0x6b6040);
    this.hemi.color.copy(skyCol); this.hemi.groundColor.copy(groundCol);
    // night keeps ~30–40 % of daytime ambient so the surroundings stay readable (moonlit look)
    this.hemi.intensity = (night ? 1.1 : 0.25 + 0.3 * dayAmount - rain * 0.22) * (1 - storm * 0.2) + fogLvl * (night ? 0 : 0.12);

    const fog_ = fogLvl;
    const fog = this.scene.fog as THREE.FogExp2;
    const fogDay = new THREE.Color(0xcad9e6).lerp(new THREE.Color(0xe8b98a), 1 - dayAmount);
    fog.color.copy(night ? new THREE.Color(0x141c30) : fogDay.lerp(new THREE.Color(0x5f666e), rain));
    fog.color.lerp(new THREE.Color(night ? 0x2a303c : 0xc3c8cd), fog_);
    fog.color.lerp(new THREE.Color(0x3a3f47), storm * 0.5);
    fog.density = WORLD.fogDensity * (1 + rain * 1.1 + (night ? 0.25 : 0) + fog_ * 8 + storm * 0.8);
    // overcast shell: fog → the dome takes the fog colour so ground and sky melt together; storm → slate grey
    const oc = this.overcast.material as THREE.MeshBasicMaterial;
    const ocA = Math.max(fog_ * 0.96, storm * 0.85);
    oc.opacity = ocA; this.overcast.visible = ocA > 0.01;
    oc.color.copy(fog_ >= storm ? fog.color : new THREE.Color(night ? 0x151a24 : 0x4a5058));

    this.exposure = (night ? 0.5 : 0.5 - rain * 0.2) - storm * 0.1 - fogLvl * (night ? 0.05 : 0);
    this.renderer.toneMappingExposure = this.exposure;
    this.baseHemi = this.hemi.intensity; this.baseExposure = this.exposure; this.flashT = 0;

    this.scene.environmentIntensity = (night ? 0.25 : 0.45 - rain * 0.2) * (1 - fogLvl * 0.3) * (1 - storm * 0.3);
    // the PMREM bake is the expensive part: do it once per frame at most, not once per setter
    this.envDirty = true;
  }
  private envDirty = true; bakes = 0;
  /** Bake the environment map from the sky dome (deferred to the next follow() so several setters cost one bake). */
  bakeEnv() {
    if (!this.envDirty) return;
    this.envDirty = false; this.bakes++;
    this.skyScene.add(this.sky);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.skyScene, 0.02);
    this.scene.environment = this.envTarget.texture;
    this.scene.add(this.sky);
  }
}
