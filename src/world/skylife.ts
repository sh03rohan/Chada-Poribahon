import * as THREE from 'three';

/**
 * Sky life: a flock of birds wheeling over the fields ahead of the bus by day, and a couple of
 * kites on strings near the road in the late afternoon. Sprites only — a few draw calls.
 */
export class SkyLife {
  readonly group = new THREE.Group();
  private birds: THREE.Points; private birdPos: Float32Array; private t = 0;
  private kites: THREE.Sprite[] = []; private strings: THREE.Line[] = []; private kiteAnchors: THREE.Vector3[] = [];
  private centre = new THREE.Vector3(); private n = 14;
  constructor() {
    // bird: a small "v"
    const bc = document.createElement('canvas'); bc.width = bc.height = 32; const bx = bc.getContext('2d')!;
    bx.strokeStyle = '#1a1a1a'; bx.lineWidth = 2.5; bx.lineCap = 'round'; bx.beginPath(); bx.moveTo(4, 14); bx.quadraticCurveTo(10, 20, 16, 13); bx.quadraticCurveTo(22, 20, 28, 14); bx.stroke();
    this.birdPos = new Float32Array(this.n * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.birdPos, 3));
    this.birds = new THREE.Points(g, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(bc), size: 1.6, transparent: true, depthWrite: false, sizeAttenuation: true, fog: true, alphaTest: 0.2 }));
    this.birds.frustumCulled = false; this.group.add(this.birds);
    // kites: a diamond with a tail
    const kc = document.createElement('canvas'); kc.width = 64; kc.height = 96; const kx = kc.getContext('2d')!;
    for (const [col, ox] of [['#d8262c', 0], ['#1f6fb5', 0]] as [string, number][]) { kx.fillStyle = col; kx.beginPath(); kx.moveTo(32 + ox, 2); kx.lineTo(58, 30); kx.lineTo(32, 60); kx.lineTo(6, 30); kx.closePath(); kx.fill(); }
    kx.strokeStyle = '#fff'; kx.lineWidth = 1.5; kx.beginPath(); kx.moveTo(32, 2); kx.lineTo(32, 60); kx.moveTo(6, 30); kx.lineTo(58, 30); kx.stroke();
    kx.strokeStyle = '#333'; kx.beginPath(); kx.moveTo(32, 60); kx.quadraticCurveTo(40, 75, 30, 94); kx.stroke();
    const kiteTex = new THREE.CanvasTexture(kc);
    for (let i = 0; i < 2; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: kiteTex, transparent: true, depthWrite: false, fog: true })); sp.scale.set(1.6, 2.4, 1); sp.visible = false; this.group.add(sp); this.kites.push(sp);
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const ln = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5 })); ln.visible = false; this.group.add(ln); this.strings.push(ln);
      this.kiteAnchors.push(new THREE.Vector3());
    }
  }
  update(dt: number, busPos: THREE.Vector3, forward: THREE.Vector3, hour: number) {
    this.t += dt;
    const day = hour >= 6 && hour < 18.5;
    this.birds.visible = day;
    if (day) {
      // the flock drifts around a point 120 m ahead and 45 m up, re-centred when the bus leaves it behind
      const target = busPos.clone().addScaledVector(forward, 120).add(new THREE.Vector3(Math.sin(this.t * 0.05) * 60, 45, Math.cos(this.t * 0.04) * 60));
      if (this.centre.distanceTo(target) > 260) this.centre.copy(target); else this.centre.lerp(target, Math.min(1, dt * 0.15));
      for (let i = 0; i < this.n; i++) {
        const a = this.t * 0.35 + i * 0.45, r = 12 + (i % 5) * 4;
        this.birdPos[i * 3] = this.centre.x + Math.cos(a) * r; this.birdPos[i * 3 + 1] = this.centre.y + Math.sin(this.t * 1.2 + i) * 2 + (i % 3); this.birdPos[i * 3 + 2] = this.centre.z + Math.sin(a) * r;
      }
      (this.birds.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    const kiteTime = hour >= 15 && hour < 18.2;
    this.kites.forEach((k, i) => {
      k.visible = kiteTime; this.strings[i].visible = kiteTime; if (!kiteTime) return;
      const side = i === 0 ? -1 : 1; const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const anchor = busPos.clone().addScaledVector(forward, 70 + i * 40).addScaledVector(right, side * (26 + i * 10)); anchor.y = 0;
      if (this.kiteAnchors[i].distanceTo(anchor) > 160) this.kiteAnchors[i].copy(anchor);
      const a = this.kiteAnchors[i];
      k.position.set(a.x + Math.sin(this.t * 0.6 + i) * 3 + side * 6, 22 + Math.sin(this.t * 0.9 + i * 2) * 1.5, a.z + Math.cos(this.t * 0.5 + i) * 3 - 6);
      const pos = this.strings[i].geometry.attributes.position as THREE.BufferAttribute; pos.setXYZ(0, a.x, 1.6, a.z); pos.setXYZ(1, k.position.x, k.position.y - 1.1, k.position.z); pos.needsUpdate = true;
    });
  }
}
