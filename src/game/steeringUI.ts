import type { SettingsStore } from './settings.ts';

/**
 * On-screen steering: either a draggable wheel or left/right buttons, placed on the side the
 * player chose; gas/brake/horn/camera live on the opposite side. Only the selected scheme exists
 * in the DOM. `steer` is the analog value the InputManager reads (-1..1) or null when idle.
 */
export class SteeringUI {
  steer: number | null = null;
  private wheelAngle = 0;          // visual wheel angle (rad)
  private dragging = false;
  private lastPointerAngle = 0;
  private wheelEl: HTMLElement | null = null;
  private wheelCanvas: HTMLCanvasElement | null = null;
  private maxWheel = Math.PI * 0.75; // ±135° = full lock
  private lastSign = 0;
  readonly root: HTMLElement;
  private pedals: HTMLElement;
  private steerBox: HTMLElement;

  constructor(private store: SettingsStore, private onButtons: (root: HTMLElement) => void) {
    this.root = document.getElementById('touch')!;
    this.steerBox = document.getElementById('touch-steer')!;
    this.pedals = document.getElementById('touch-pedals')!;
    this.rebuild();
    store.onChange((_, k) => { if (k === 'steering' || k === 'side') this.rebuild(); });
  }

  rebuild() {
    const s = this.store.value;
    this.root.classList.toggle('side-right', s.side === 'right');
    this.steerBox.innerHTML = '';
    this.steer = null; this.dragging = false; this.wheelEl = null;
    if (s.steering === 'buttons') {
      this.steerBox.innerHTML = `<button class="tbtn" data-act="left">◀</button><button class="tbtn" data-act="right">▶</button>`;
      this.steerBox.dataset.scheme = 'buttons';
    } else {
      this.steerBox.innerHTML = `<div id="wheel-ui"><canvas width="220" height="220"></canvas></div>`;
      this.steerBox.dataset.scheme = 'wheel';
      this.wheelEl = this.steerBox.querySelector('#wheel-ui')!;
      this.wheelCanvas = this.wheelEl.querySelector('canvas')!;
      this.drawWheel();
      this.bindWheel(this.wheelEl);
    }
    this.onButtons(this.root);
  }

  private drawWheel() {
    const c = this.wheelCanvas!, ctx = c.getContext('2d')!, S = c.width, r = S / 2 - 6;
    ctx.clearRect(0, 0, S, S);
    ctx.save(); ctx.translate(S / 2, S / 2);
    ctx.lineWidth = 22; ctx.strokeStyle = 'rgba(20,20,20,0.85)'; ctx.beginPath(); ctx.arc(0, 0, r - 11, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,204,51,0.9)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,40,40,0.9)'; ctx.lineWidth = 14;
    for (const a of [Math.PI / 2, Math.PI / 2 + 2.1, Math.PI / 2 - 2.1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * (r - 14), Math.sin(a) * (r - 14)); ctx.stroke(); }
    ctx.fillStyle = '#d8262c'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffcc33'; ctx.beginPath(); ctx.arc(0, -r + 12, 6, 0, Math.PI * 2); ctx.fill(); // top marker
    ctx.restore();
  }

  private bindWheel(el: HTMLElement) {
    const angleOf = (e: PointerEvent) => { const b = el.getBoundingClientRect(); return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2)); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); this.dragging = true; this.lastPointerAngle = angleOf(e); });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging || !el.hasPointerCapture(e.pointerId)) return;
      const a = angleOf(e); let d = a - this.lastPointerAngle; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.lastPointerAngle = a;
      this.wheelAngle = Math.max(-this.maxWheel, Math.min(this.maxWheel, this.wheelAngle + d));
      this.steer = this.wheelAngle / this.maxWheel;
    });
    const release = () => { this.dragging = false; };
    el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Call every frame with the physics steering fraction (-1..1) so the graphic matches the wheels. */
  update(dt: number, physicsSteer: number) {
    if (!this.wheelEl) return;
    if (this.dragging) {
      // graphic follows the finger; physics follows the graphic
    } else {
      // smooth self-centring, then follow keyboard/physics steering exactly
      if (this.steer !== null) {
        const rate = 3.5 * dt;
        const before = this.wheelAngle;
        this.wheelAngle = Math.abs(this.wheelAngle) <= rate ? 0 : this.wheelAngle - Math.sign(this.wheelAngle) * rate;
        this.steer = this.wheelAngle === 0 ? null : this.wheelAngle / this.maxWheel;
        if (this.wheelAngle === 0 && before !== 0 && 'vibrate' in navigator) { try { navigator.vibrate?.(12); } catch { /* ignore */ } }
      } else {
        this.wheelAngle = physicsSteer * this.maxWheel;
      }
    }
    const sign = Math.sign(this.wheelAngle);
    if (sign !== this.lastSign && this.lastSign !== 0 && this.dragging && 'vibrate' in navigator) { try { navigator.vibrate?.(8); } catch { /* ignore */ } }
    this.lastSign = sign;
    this.wheelEl.style.transform = `rotate(${this.wheelAngle}rad)`;
  }
}
