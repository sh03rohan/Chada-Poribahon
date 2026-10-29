import type { CameraMode } from './camera.ts';
import type { QualityTier } from '../config.ts';

/** Player settings, persisted in localStorage. */
export interface Settings {
  steering: 'wheel' | 'buttons';
  side: 'left' | 'right';
  sensitivity: number;         // 0.5 .. 1.5
  camera: CameraMode;
  quality: QualityTier | 'auto';
  volume: number;              // 0 .. 1
  radio: number;               // -1 off, else station index
  northUp: boolean;            // minimap orientation
  introSeen: boolean;
  tutorialSeen: boolean;
}

const KEY = 'cp-settings';
const DEFAULTS: Settings = { steering: 'buttons', side: 'left', sensitivity: 1, camera: 'chase', quality: 'auto', volume: 0.8, radio: -1, northUp: false, introSeen: false, tutorialSeen: false };

type Listener = (s: Settings, changed: keyof Settings | null) => void;

export class SettingsStore {
  readonly value: Settings;
  private listeners: Listener[] = [];
  constructor() {
    let saved: Partial<Settings> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
    this.value = { ...DEFAULTS, ...saved };
  }
  set<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (this.value[k] === v) return;
    this.value[k] = v;
    this.save();
    for (const l of this.listeners) l(this.value, k);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.value)); } catch { /* private mode */ } }
  onChange(l: Listener) { this.listeners.push(l); }
}

const CAM_LABEL: Record<CameraMode, string> = { chase: 'পেছন থেকে', bonnet: 'বনেট', cockpit: 'ড্রাইভারের চোখ' };
const Q_LABEL: Record<QualityTier | 'auto', string> = { auto: 'স্বয়ংক্রিয়', low: 'কম', medium: 'মাঝারি', high: 'উচ্চ' };

/** Builds the settings panel DOM once; `onClose` is called when the player closes it. */
export function buildSettingsPanel(store: SettingsStore, onClose: () => void): HTMLElement {
  const el = document.getElementById('settings')!;
  const s = store.value;
  const seg = (name: keyof Settings, opts: [string, string][]) =>
    `<div class="seg" data-key="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[name]) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  el.innerHTML = `
    <div class="panel settings-panel">
      <h2>সেটিংস</h2>
      <div class="row-s"><label>স্টিয়ারিং</label>${seg('steering', [['wheel', 'স্টিয়ারিং হুইল'], ['buttons', 'বাম/ডান বাটন']])}</div>
      <div class="row-s"><label>কন্ট্রোলের দিক</label>${seg('side', [['left', 'বামে'], ['right', 'ডানে']])}</div>
      <div class="row-s"><label>স্টিয়ারিং সংবেদনশীলতা <span id="sens-val"></span></label><input type="range" id="set-sens" min="0.5" max="1.5" step="0.05" value="${s.sensitivity}"></div>
      <div class="row-s"><label>ডিফল্ট ক্যামেরা</label>${seg('camera', (Object.keys(CAM_LABEL) as CameraMode[]).map((k) => [k, CAM_LABEL[k]]))}</div>
      <div class="row-s"><label>গ্রাফিক্স (রিলোড লাগবে)</label>${seg('quality', (Object.keys(Q_LABEL) as (QualityTier | 'auto')[]).map((k) => [k, Q_LABEL[k]]))}</div>
      <div class="row-s"><label>মাস্টার ভলিউম <span id="vol-val"></span></label><input type="range" id="set-vol" min="0" max="1" step="0.05" value="${s.volume}"></div>
      <div class="row-s"><label>মিনিম্যাপ</label>${seg('northUp', [['false', 'সামনের দিক উপরে'], ['true', 'উত্তর উপরে']])}</div>
      <div class="row"><button id="set-close" class="btn-primary">ঠিক আছে</button></div>
    </div>`;
  el.querySelectorAll<HTMLElement>('.seg').forEach((segEl) => {
    const key = segEl.dataset.key as keyof Settings;
    segEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.onclick = () => {
      const raw = b.dataset.v!;
      const v = key === 'northUp' ? raw === 'true' : raw;
      store.set(key, v as never);
      segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
  });
  const sens = el.querySelector<HTMLInputElement>('#set-sens')!, sensVal = el.querySelector('#sens-val')!;
  const vol = el.querySelector<HTMLInputElement>('#set-vol')!, volVal = el.querySelector('#vol-val')!;
  const fmt = () => { sensVal.textContent = `(${Math.round(+sens.value * 100)}%)`; volVal.textContent = `(${Math.round(+vol.value * 100)}%)`; };
  sens.oninput = () => { store.set('sensitivity', +sens.value); fmt(); };
  vol.oninput = () => { store.set('volume', +vol.value); fmt(); };
  fmt();
  el.querySelector<HTMLButtonElement>('#set-close')!.onclick = () => { el.classList.add('hidden'); onClose(); };
  return el;
}
