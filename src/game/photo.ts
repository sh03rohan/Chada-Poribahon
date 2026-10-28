import * as THREE from 'three';
import { bnClock } from '../util/bangla.ts';
import { ROUTE } from '../routes.ts';

/**
 * Photo mode: the game pauses, the HUD hides and the camera orbits the bus under pointer control
 * (drag to orbit, wheel / pinch to zoom). "Save" renders a clean frame, stamps a small caption and
 * shares it (Web Share with files where available) or downloads a PNG.
 */
export interface PhotoHost {
  busPos(): THREE.Vector3;
  setFreeCam(pos: THREE.Vector3, look: THREE.Vector3, fov: number): void;
  renderClean(): HTMLCanvasElement;
  hour(): number;
  onClose(): void;
}

export class PhotoMode {
  on = false;
  yaw = 0.7; pitch = 0.32; dist = 14;
  private root: HTMLElement; private drag: { x: number; y: number; id: number } | null = null;
  private pinch: { d: number; dist: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private host!: PhotoHost;
  private busPrev = new THREE.Vector3();

  constructor() {
    this.root = document.getElementById('photo')!;
    this.root.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button')) return; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.root.setPointerCapture(e.pointerId); if (this.pointers.size === 1) this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; else { this.drag = null; this.pinch = { d: this.pinchDist(), dist: this.dist }; } });
    this.root.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.drag && this.drag.id === e.pointerId) { this.yaw -= (e.clientX - this.drag.x) * 0.006; this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -0.05, 1.2); this.drag.x = e.clientX; this.drag.y = e.clientY; }
      else if (this.pinch && this.pointers.size >= 2) { const d = this.pinchDist(); if (d > 1) this.dist = THREE.MathUtils.clamp(this.pinch.dist * this.pinch.d / d, 5, 40); }
    });
    const up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); if (this.drag?.id === e.pointerId) this.drag = null; if (this.pointers.size < 2) this.pinch = null; };
    this.root.addEventListener('pointerup', up); this.root.addEventListener('pointercancel', up);
    this.root.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = THREE.MathUtils.clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 5, 40); }, { passive: false });
    document.getElementById('photo-save')!.onclick = () => void this.save();
    document.getElementById('photo-close')!.onclick = () => this.close();
  }
  private pinchDist() { const p = [...this.pointers.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }

  open(host: PhotoHost) {
    this.host = host; this.on = true; this.root.classList.remove('hidden');
    this.yaw = 0.7; this.pitch = 0.32; this.dist = 14;
    this.update();
  }
  close() { if (!this.on) return; this.on = false; this.root.classList.add('hidden'); this.host.onClose(); }

  /** Per frame: place the free camera on the orbit around the bus. */
  update() {
    if (!this.on) return;
    const c = this.host.busPos(); this.busPrev.copy(c);
    const pos = new THREE.Vector3(c.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, c.y + 1.2 + Math.sin(this.pitch) * this.dist, c.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    this.host.setFreeCam(pos, new THREE.Vector3(c.x, c.y + 1.6, c.z), 45);
  }

  /** Clean render → caption → share or download. */
  async save(): Promise<Blob | null> {
    const src = this.host.renderClean();
    const out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
    const cx = out.getContext('2d')!; cx.drawImage(src, 0, 0);
    const pad = Math.round(out.width * 0.012), fs = Math.max(14, Math.round(out.width * 0.018));
    cx.font = `700 ${fs}px "Hind Siliguri", "Noto Sans Bengali", sans-serif`;
    const text = `চাঁদা পরিবহন · ${ROUTE.label} · ${bnClock(this.host.hour())}`;
    const w = cx.measureText(text).width + pad * 2;
    cx.fillStyle = 'rgba(0,0,0,0.45)'; cx.fillRect(pad, out.height - fs * 2 - pad, w, fs * 2);
    cx.fillStyle = '#fff'; cx.textBaseline = 'middle'; cx.fillText(text, pad * 2, out.height - fs - pad);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    if (!blob) return null;
    const file = new File([blob], `chada-poribohon-${Date.now()}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: 'চাঁদা পরিবহন' }); return blob; } catch { /* user cancelled → fall through to download */ } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.lastBlob = blob;
    return blob;
  }
  lastBlob: Blob | null = null;
}
