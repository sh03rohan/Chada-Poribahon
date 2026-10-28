/**
 * Modal prompt with 2–4 options (touch buttons or keys 1–4). Resolves with the chosen index.
 * Only one prompt at a time; the game keeps rendering behind it.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const IDS = ['choice-a', 'choice-b', 'choice-c', 'choice-d'];

export class ChoicePanel {
  private root = $('choice');
  private title = $('choice-title');
  private sub = $('choice-sub');
  private row = this.root.querySelector('.row') as HTMLElement;
  private resolve: ((i: number) => void) | null = null;
  private count = 2;
  private onKey = (e: KeyboardEvent) => { const m = /^(Digit|Numpad)([1-4])$/.exec(e.code); if (m) { const i = +m[2] - 1; if (i < this.count) this.pick(i); } };
  private timer: number | null = null;

  get open() { return this.resolve !== null; }

  /** Two-option prompt; `timeoutSec` auto-picks `timeoutChoice` when the player does not answer. */
  ask(title: string, sub: string, a: string, b: string, timeoutSec = 0, timeoutChoice: 0 | 1 = 1): Promise<0 | 1> {
    return this.askMany(title, sub, [a, b], timeoutSec, timeoutChoice) as Promise<0 | 1>;
  }

  /** 2–4 options; the first is styled as the primary action. */
  askMany(title: string, sub: string, options: string[], timeoutSec = 0, timeoutChoice = options.length - 1): Promise<number> {
    if (this.resolve) this.pick(timeoutChoice);
    this.count = options.length;
    this.title.textContent = title; this.sub.textContent = sub;
    this.row.innerHTML = options.map((o, i) => `<button id="${IDS[i]}" class="${i === 0 ? 'btn-primary' : ''}">${o}</button>`).join('');
    options.forEach((_, i) => { (this.row.querySelector('#' + IDS[i]) as HTMLButtonElement).onclick = () => this.pick(i); });
    const keys = this.root.querySelector('.choice-keys'); if (keys) keys.textContent = `কীবোর্ড: ${options.map((_, i) => ['১', '২', '৩', '৪'][i]).join(' / ')}`;
    this.root.classList.remove('hidden');
    addEventListener('keydown', this.onKey);
    if (timeoutSec > 0) this.timer = window.setTimeout(() => this.pick(timeoutChoice), timeoutSec * 1000);
    return new Promise((res) => { this.resolve = res; });
  }
  /** Dismiss an open prompt as if the player picked `i` (teleports / resets). */
  cancel(i = this.count - 1) { this.pick(i); }
  private pick(i: number) {
    const r = this.resolve; if (!r) return;
    this.resolve = null; this.root.classList.add('hidden'); removeEventListener('keydown', this.onKey);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    r(i);
  }
}
