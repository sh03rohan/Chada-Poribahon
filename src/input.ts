/**
 * Keyboard + touch + gamepad + tilt input, merged into one VehicleInput-shaped structure.
 * Touch buttons use Pointer Events with pointer capture so a finger sliding off a button
 * still releases it, and `touch-action: none` on the buttons stops the browser from scrolling.
 * Gamepad: left stick / d-pad steer, RT gas, LT brake, A gas, B handbrake, X horn, Y camera,
 * LB high beam, RB radio, Start pause, Back map. Haptics go to the phone motor and the pad.
 */
export interface RawInput {
  throttle: number; brake: number; steer: number; handbrake: boolean; horn: boolean;
}
export type HapticKind = 'tick' | 'bump' | 'thud' | 'crash' | 'sleep';
const PATTERNS: Record<HapticKind, number[]> = { tick: [10], bump: [25], thud: [45, 30, 25], crash: [120, 40, 60], sleep: [60, 60, 60] };

/**
 * Tilt steering from the phone's motion sensors: the roll of the screen's horizontal edge
 * (which device axis that is depends on the screen orientation), relative to a calibrated zero.
 */
export class TiltSteer {
  /** current roll angle of the screen (degrees, + = right edge down), null before the first sample */
  angle: number | null = null;
  private zero = 0;
  steer: number | null = null;
  enabled = false;
  permission: 'unknown' | 'granted' | 'denied' | 'unsupported' = 'unknown';
  /** degrees of tilt for full lock */
  range = 22;
  private listening = false;

  /** must be called from a user gesture on iOS (permission prompt) */
  async enable(): Promise<boolean> {
    this.enabled = true;
    if (this.listening) return true;
    const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> } }).DeviceMotionEvent;
    if (!DME) { this.permission = 'unsupported'; return false; }
    if (typeof DME.requestPermission === 'function') {
      try { this.permission = await DME.requestPermission(); } catch { this.permission = 'denied'; }
      if (this.permission !== 'granted') return false;
    } else this.permission = 'granted';
    addEventListener('devicemotion', (e) => this.onMotion(e));
    this.listening = true;
    return true;
  }
  disable() { this.enabled = false; this.steer = null; }
  calibrate() { if (this.angle !== null) this.zero = this.angle; }

  /** also used by the test harness with synthetic events */
  onMotion(e: DeviceMotionEvent) {
    const a = e.accelerationIncludingGravity; if (!a || a.x === null || a.y === null) return;
    const x = a.x ?? 0, y = a.y ?? 0;
    // screen-right / screen-up in device axes for each orientation
    const type = (screen.orientation && screen.orientation.type) || (Math.abs((window as unknown as { orientation?: number }).orientation ?? 0) === 90 ? 'landscape-primary' : 'portrait-primary');
    let right: number, up: number;
    if (type === 'landscape-primary') { right = -y; up = x; } else if (type === 'landscape-secondary') { right = y; up = -x; } else if (type === 'portrait-secondary') { right = -x; up = -y; } else { right = x; up = y; }
    // the reported vector points up (reaction to gravity); tilting the right edge down puts a negative component on screen-right
    this.angle = -Math.atan2(right, Math.max(0.5, up)) * 180 / Math.PI;
    if (!this.enabled) { this.steer = null; return; }
    let d = this.angle - this.zero; if (Math.abs(d) < 1.5) d = 0; else d -= Math.sign(d) * 1.5;
    this.steer = Math.max(-1, Math.min(1, d / this.range));
  }
}

export class InputManager {
  private keys = new Set<string>();
  private touch = { left: false, right: false, gas: false, brake: false, horn: false };
  gamepadIndex: number | null = null;
  private padButtons = new Map<number, boolean>();
  readonly state: RawInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
  /** Programmatic override (used by the Playwright harness / autopilot). */
  override: Partial<RawInput> | null = null;
  onCamera: (() => void) | null = null;
  onDebug: (() => void) | null = null;
  onWeather: (() => void) | null = null;

  /** analog steering from the on-screen wheel / tilt (null when idle) */
  analogSteer: number | null = null;
  sensitivity = 1;
  onPause: (() => void) | null = null;
  onMap: (() => void) | null = null;
  onPhoto: (() => void) | null = null;
  onBeam: (() => void) | null = null;
  onRadio: (() => void) | null = null;
  onGamepad: ((connected: boolean, id: string) => void) | null = null;
  readonly tilt = new TiltSteer();
  /** last haptic pulses (for the harness) */
  hapticLog: HapticKind[] = [];
  haptics = true;

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
      if (e.code === 'KeyN') this.onRadio?.();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.bindTouchButtons(touchRoot);

    addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; this.onGamepad?.(true, e.gamepad.id); });
    addEventListener('gamepaddisconnected', (e) => { if (this.gamepadIndex === e.gamepad.index) { this.gamepadIndex = null; this.onGamepad?.(false, e.gamepad.id); } });
  }

  /** (Re)bind every .tbtn under root — called again whenever the steering UI is rebuilt. */
  bindTouchButtons(root: HTMLElement) {
    this.touch = { left: false, right: false, gas: false, brake: false, horn: false };
    root.querySelectorAll<HTMLButtonElement>('.tbtn').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      const act = btn.dataset.act as keyof typeof this.touch;
      if (act === 'camera' as string) { btn.addEventListener('click', () => this.onCamera?.()); return; }
      if (act === 'calibrate' as string) { btn.addEventListener('click', () => { this.tilt.calibrate(); this.haptic('tick'); }); return; }
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

  /** a short buzz on the phone and/or the pad */
  haptic(kind: HapticKind) {
    if (!this.haptics) return;
    this.hapticLog.push(kind); if (this.hapticLog.length > 20) this.hapticLog.shift();
    if ('vibrate' in navigator) { try { navigator.vibrate?.(PATTERNS[kind]); } catch { /* ignore */ } }
    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads()[this.gamepadIndex] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: Record<string, number>) => Promise<unknown> } }) | null;
      const act = gp?.vibrationActuator;
      if (act?.playEffect) { const strong = kind === 'crash' ? 1 : kind === 'thud' ? 0.7 : kind === 'sleep' ? 0.5 : 0.3; void act.playEffect('dual-rumble', { startDelay: 0, duration: PATTERNS[kind][0] * 2, weakMagnitude: strong * 0.6, strongMagnitude: strong }).catch(() => { /* ignore */ }); }
    }
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
        if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * (Math.abs(ax) - 0.12) / 0.88;
        if (gp.buttons[14]?.pressed) steer = -1; if (gp.buttons[15]?.pressed) steer = 1;
        const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
        if (rt > 0.05) throttle = rt;
        if (lt > 0.05) brake = lt;
        if (gp.buttons[0]?.pressed) throttle = 1;
        if (gp.buttons[1]?.pressed) handbrake = true;
        if (gp.buttons[2]?.pressed) horn = true;
        // one-shot buttons (edge detected)
        const once = (i: number, fn: (() => void) | null) => { const p = !!gp.buttons[i]?.pressed, was = this.padButtons.get(i) ?? false; if (p && !was) fn?.(); this.padButtons.set(i, p); };
        once(3, this.onCamera); once(4, this.onBeam); once(5, this.onRadio); once(9, this.onPause); once(8, this.onMap); once(13, this.onPhoto);
      }
    }

    s.throttle = throttle; s.brake = brake; s.steer = steer; s.handbrake = handbrake; s.horn = horn;
    if (this.override) Object.assign(s, this.override);
    return s;
  }
}
