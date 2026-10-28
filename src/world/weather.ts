import * as THREE from 'three';

/**
 * Rain: a box of falling point sprites that follows the camera. `wet` ramps 0→1 over a few
 * seconds so the road/grip transition is smooth. Rendering uses a cheap PointsMaterial.
 */
export type WeatherKind = 'clear' | 'rain' | 'fog' | 'storm';
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'rain', 'fog', 'storm'];
export const WEATHER_INFO: Record<WeatherKind, { icon: string; name: string; effect: string }> = {
  clear: { icon: '☀️', name: 'পরিষ্কার', effect: 'ভালো রাস্তা, দূর পর্যন্ত দেখা যায়' },
  rain:  { icon: '🌧️', name: 'বৃষ্টি', effect: 'রাস্তা পিচ্ছিল — ব্রেক লম্বা, আস্তে বাঁক নিন' },
  fog:   { icon: '🌫️', name: 'ঘন কুয়াশা', effect: 'সামনে কম দেখা যায় — হেডলাইট জ্বলবে, গতি কমান' },
  storm: { icon: '⛈️', name: 'ঝড়-বৃষ্টি', effect: 'বজ্রপাত, ভারী বৃষ্টি, পিচ্ছিল রাস্তা — সবচেয়ে কঠিন' },
};

export class Weather {
  kind: WeatherKind = 'clear';
  raining = false;
  wet = 0;                 // 0..1 smoothed
  private points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private count: number;
  private box = new THREE.Vector3(60, 30, 60);
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, count: number) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.pos[i * 3 + 1] = Math.random() * this.box.y;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      this.vel[i] = 18 + Math.random() * 8;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const tex = makeDropTexture();
    const m = new THREE.PointsMaterial({
      size: 0.35, map: tex, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true,
      color: 0xcfe0f0, blending: THREE.NormalBlending, fog: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  toggle(): boolean { this.setKind(this.raining ? 'clear' : 'rain'); return this.raining; }
  set(on: boolean) { this.setKind(on ? 'rain' : 'clear'); }
  /** Pick a weather kind: rain and storm drive the drops (storm heavier), fog is sky-only. */
  setKind(kind: WeatherKind) {
    this.kind = kind;
    this.raining = kind === 'rain' || kind === 'storm';
    const storm = kind === 'storm';
    const m = this.points.material as THREE.PointsMaterial;
    m.size = storm ? 0.45 : 0.35; m.color.set(storm ? 0xb8c8dc : 0xcfe0f0);
    for (let i = 0; i < this.count; i++) this.vel[i] = (storm ? 26 : 18) + Math.random() * 8;
  }
  /** Next kind in the cycle clear → rain → fog → storm → clear. */
  next(): WeatherKind { return WEATHER_KINDS[(WEATHER_KINDS.indexOf(this.kind) + 1) % WEATHER_KINDS.length]; }
  get storm() { return this.kind === 'storm'; }
  get fog() { return this.kind === 'fog'; }

  update(dt: number, camPos: THREE.Vector3, velocity: THREE.Vector3) {
    const target = this.raining ? 1 : 0;
    this.wet += (target - this.wet) * Math.min(1, dt * 0.5);
    if (this.wet < 0.01 && !this.raining) { this.points.visible = false; return; }
    this.points.visible = true;
    const m = this.points.material as THREE.PointsMaterial;
    m.opacity = (this.kind === 'storm' ? 0.75 : 0.55) * Math.min(1, this.wet * 1.5);
    // Drops fall and streak backwards relative to vehicle motion; wrap within the box around the camera.
    this.points.position.copy(camPos);
    const vx = -velocity.x * 0.35, vz = -velocity.z * 0.35;
    const hx = this.box.x / 2, hz = this.box.z / 2;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k + 1] -= this.vel[i] * dt;
      this.pos[k] += vx * dt; this.pos[k + 2] += vz * dt;
      if (this.pos[k + 1] < -2) { this.pos[k + 1] = this.box.y; }
      if (this.pos[k] > hx) this.pos[k] -= this.box.x; else if (this.pos[k] < -hx) this.pos[k] += this.box.x;
      if (this.pos[k + 2] > hz) this.pos[k + 2] -= this.box.z; else if (this.pos[k + 2] < -hz) this.pos[k + 2] += this.box.z;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

function makeDropTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(6, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
