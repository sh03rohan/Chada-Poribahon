import * as THREE from 'three';

/**
 * Rain on the windscreen (cockpit view): a plane hung in front of the camera with scrolling
 * streaks and droplets, cleared in two wedges that follow the wiper blades.
 */
export class GlassRain {
  readonly mesh: THREE.Mesh;
  private u = { tRain: { value: null as THREE.Texture | null }, time: { value: 0 }, wet: { value: 0 }, wiper: { value: 0 } };
  constructor(camera: THREE.PerspectiveCamera) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d')!;
    x.clearRect(0, 0, 512, 512);
    for (let i = 0; i < 420; i++) { const px = Math.random() * 512, py = Math.random() * 512, r = 1 + Math.random() * 3.5; const g = x.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r); g.addColorStop(0, 'rgba(235,245,255,0.95)'); g.addColorStop(0.7, 'rgba(200,220,240,0.55)'); g.addColorStop(1, 'rgba(200,220,240,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r, r * 1.5, 0, 0, Math.PI * 2); x.fill(); }
    for (let i = 0; i < 60; i++) { const px = Math.random() * 512, py = Math.random() * 512, l = 20 + Math.random() * 90; const g = x.createLinearGradient(px, py, px, py + l); g.addColorStop(0, 'rgba(220,235,250,0)'); g.addColorStop(0.5, 'rgba(220,235,250,0.6)'); g.addColorStop(1, 'rgba(220,235,250,0)'); x.strokeStyle = g; x.lineWidth = 1.2 + Math.random(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 6, py + l); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; this.u.tRain.value = t;
    const dist = 0.42, h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.15, w = h * camera.aspect;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, depthTest: false,
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform sampler2D tRain; uniform float time, wet, wiper; varying vec2 vUv;
        void main() {
          // streaks scroll down slowly; droplets jitter
          vec4 d = texture2D(tRain, vec2(vUv.x * 1.6, vUv.y * 1.6 + time * 0.08));
          vec4 s = texture2D(tRain, vec2(vUv.x * 0.8 + 0.3, vUv.y * 0.9 + time * 0.22));
          float a = max(d.a, s.a * 0.7);
          // wiper wedges: pivots at the bottom third-points; a blade sweeps angle th; the longer since the blade passed, the wetter
          float th = wiper * 2.6 + 0.27;
          vec2 pL = vec2(0.3, -0.08), pR = vec2(0.72, -0.08);
          float cl = 1.0;
          for (int i = 0; i < 2; i++) { vec2 p = i == 0 ? pL : pR; vec2 r = vUv - p; float ang = atan(r.y, r.x); float since = mod(th - ang + 6.2831, 3.1416) / 3.1416; if (length(r) < 0.95 && ang > 0.2 && ang < 2.95) cl = min(cl, 0.15 + 0.85 * since); }
          gl_FragColor = vec4(0.85, 0.92, 1.0, a * wet * cl * 0.8);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); this.mesh.position.set(0, 0, -dist); this.mesh.renderOrder = 20; this.mesh.visible = false; this.mesh.frustumCulled = false;
    camera.add(this.mesh);
  }
  update(dt: number, wet: number, wiperPhase: number, cockpit: boolean) {
    this.u.time.value += dt; this.u.wet.value = wet;
    const pp = wiperPhase < 0.5 ? wiperPhase * 2 : 2 - wiperPhase * 2; this.u.wiper.value = pp;
    this.mesh.visible = cockpit && wet > 0.05;
  }
  get visible() { return this.mesh.visible; }
}
