/**
 * Modal two-option prompt (touch buttons or keys 1 / 2). Resolves with the chosen index.
 * Only one prompt at a time; the game keeps rendering behind it.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class ChoicePanel {
  private root = $('choice');
  private title = $('choice-title');
  private sub = $('choice-sub');
  private btnA = $('choice-a') as HTMLButtonElement;
  private btnB = $('choice-b') as HTMLButtonElement;
  private resolve: ((i: 0 | 1) => void) | null = null;
  private onKey = (e: KeyboardEvent) => { if (e.code === 'Digit1' || e.code === 'Numpad1') this.pick(0); else if (e.code === 'Digit2' || e.code === 'Numpad2') this.pick(1); };
  private timer: number | null = null;

  constructor() {
    this.btnA.onclick = () => this.pick(0);
    this.btnB.onclick = () => this.pick(1);
  }
  get open() { return this.resolve !== null; }

  /** Show a prompt; `timeoutSec` auto-picks `timeoutChoice` when the player does not answer. */
  ask(title: string, sub: string, a: string, b: string, timeoutSec = 0, timeoutChoice: 0 | 1 = 1): Promise<0 | 1> {
    if (this.resolve) this.pick(timeoutChoice);
    this.title.textContent = title; this.sub.textContent = sub; this.btnA.textContent = a; this.btnB.textContent = b;
    this.root.classList.remove('hidden');
    addEventListener('keydown', this.onKey);
    if (timeoutSec > 0) this.timer = window.setTimeout(() => this.pick(timeoutChoice), timeoutSec * 1000);
    return new Promise((res) => { this.resolve = res; });
  }
  /** Dismiss an open prompt as if the player picked `i` (teleports / resets). */
  cancel(i: 0 | 1 = 1) { this.pick(i); }
  private pick(i: 0 | 1) {
    const r = this.resolve; if (!r) return;
    this.resolve = null; this.root.classList.add('hidden'); removeEventListener('keydown', this.onKey);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    r(i);
  }
}
