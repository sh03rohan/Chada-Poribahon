import * as THREE from 'three';

/**
 * One pooled point-sprite particle system for every small effect: exhaust puffs, shoulder dust,
 * wheel spray in rain, tea-stall smoke. A single draw call; particles grow, drift and fade.
 */
interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; r: number; g: number; b: number; a: number; }

export class Particles {
  readonly points: THREE.Points;
  private pool: P[] = []; private n: number; private head = 0;
  private pos: Float32Array; private col: Float32Array; private siz: Float32Array; private alp: Float32Array;
  alive = 0;
  constructor(n = 600) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.siz = new Float32Array(n); this.alp = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pool.push({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grow: 0, r: 1, g: 1, b: 1, a: 0 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!; const rg = x.createRadialGradient(32, 32, 2, 32, 32, 30); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = rg; x.fillRect(0, 0, 64, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: new THREE.CanvasTexture(c) } }, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      vertexShader: /* glsl */`attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA;
        void main() { vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * 420.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform sampler2D tMap; varying vec3 vC; varying float vA;
        void main() { vec4 t = texture2D(tMap, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 4;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, color: number, alpha: number) {
    const p = this.pool[this.head]; this.head = (this.head + 1) % this.n;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size; p.grow = grow;
    p.r = ((color >> 16) & 255) / 255; p.g = ((color >> 8) & 255) / 255; p.b = (color & 255) / 255; p.a = alpha;
  }
  update(dt: number, windX = 0, windZ = 0) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.pool[i];
      if (p.life > 0) {
        p.life -= dt; p.x += (p.vx + windX) * dt; p.y += p.vy * dt; p.z += (p.vz + windZ) * dt; p.vx *= 0.96; p.vz *= 0.96; p.vy += 0.15 * dt; p.size += p.grow * dt;
        const k = Math.max(0, p.life / p.max);
        this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z; this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
        this.siz[i] = p.size; this.alp[i] = p.a * Math.min(1, k * 2.5) * Math.min(1, (1 - k) * 6 + 0.2); alive++;
      } else if (this.alp[i] !== 0) { this.alp[i] = 0; this.pos[i * 3 + 1] = -100; }
    }
    this.alive = alive;
    const g = this.points.geometry; for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}
