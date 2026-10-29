/**
 * Keyboard + touch + gamepad input, merged into one VehicleInput-shaped structure.
 * Touch buttons use Pointer Events with pointer capture so a finger sliding off a button
 * still releases it, and `touch-action: none` on the buttons stops the browser from scrolling.
 */
export interface RawInput {
  throttle: number; brake: number; steer: number; handbrake: boolean; horn: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private touch = { left: false, right: false, gas: false, brake: false, horn: false };
  private gamepadIndex: number | null = null;
  readonly state: RawInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
  /** Programmatic override (used by the Playwright harness / autopilot). */
  override: Partial<RawInput> | null = null;
  onCamera: (() => void) | null = null;
  onDebug: (() => void) | null = null;
  onWeather: (() => void) | null = null;

  /** analog steering from the on-screen wheel (null when idle) */
  analogSteer: number | null = null;
  sensitivity = 1;
  onPause: (() => void) | null = null;
  onMap: (() => void) | null = null;
  onPhoto: (() => void) | null = null;
  onBeam: (() => void) | null = null;

  constructor(touchRoot: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.onCamera?.();
      if (e.code === 'F3' || e.code === 'Backquote') { e.preventDefault(); this.onDebug?.(); }
      if (e.code === 'KeyR') this.onWeather?.();
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
      if (e.code === 'KeyM') this.onMap?.();
      if (e.code === 'KeyF') this.onPhoto?.();
      if (e.code === 'KeyL') this.onBeam?.();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.bindTouchButtons(touchRoot);

    addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  /** (Re)bind every .tbtn under root — called again whenever the steering UI is rebuilt. */
  bindTouchButtons(root: HTMLElement) {
    this.touch = { left: false, right: false, gas: false, brake: false, horn: false };
    root.querySelectorAll<HTMLButtonElement>('.tbtn').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      const act = btn.dataset.act as keyof typeof this.touch;
      if (act === 'camera' as string) { btn.addEventListener('click', () => this.onCamera?.()); return; }
      const set = (v: boolean) => { this.touch[act] = v; btn.classList.toggle('active', v); };
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); set(true); });
      btn.addEventListener('pointerup', () => set(false));
      btn.addEventListener('pointercancel', () => set(false));
      btn.addEventListener('lostpointercapture', () => set(false));
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  get touchActive(): boolean {
    return this.touch.left || this.touch.right || this.touch.gas || this.touch.brake;
  }

  poll(): RawInput {
    const k = this.keys, s = this.state;
    let throttle = (k.has('KeyW') || k.has('ArrowUp') || this.touch.gas) ? 1 : 0;
    let brake = (k.has('KeyS') || k.has('ArrowDown') || this.touch.brake) ? 1 : 0;
    let steer = 0;
    if (k.has('KeyA') || k.has('ArrowLeft') || this.touch.left) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight') || this.touch.right) steer += 1;
    if (this.analogSteer !== null && steer === 0) steer = this.analogSteer;
    steer = Math.max(-1, Math.min(1, steer * this.sensitivity));
    let handbrake = k.has('Space');
    let horn = k.has('KeyH') || this.touch.horn;

    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if (gp) {
        const ax = gp.axes[0] ?? 0;
        if (Math.abs(ax) > 0.12) steer = ax;
        const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
        if (rt > 0.05) throttle = rt;
        if (lt > 0.05) brake = lt;
        if (gp.buttons[0]?.pressed) throttle = 1;
        if (gp.buttons[1]?.pressed) handbrake = true;
        if (gp.buttons[2]?.pressed) horn = true;
      }
    }

    s.throttle = throttle; s.brake = brake; s.steer = steer; s.handbrake = handbrake; s.horn = horn;
    if (this.override) Object.assign(s, this.override);
    return s;
  }
}
