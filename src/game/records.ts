import { bn, bnTaka, bnTime } from '../util/bangla.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import type { Career, BestRun } from './career.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** "রেকর্ড" panel: badges tab + best-runs tab. Rebuilt on every open. */
export function buildRecordsPanel(career: Career, onClose: () => void): HTMLElement & { refresh: (tab?: 'badges' | 'runs') => void } {
  const el = $('records') as HTMLElement & { refresh: (tab?: 'badges' | 'runs') => void };
  let tab: 'badges' | 'runs' = 'badges';
  const render = () => {
    const p = career.profile;
    const badges = ACHIEVEMENTS.map((a) => {
      const on = p.achievements.includes(a.id);
      return `<div class="badge ${on ? 'on' : ''}" title="${a.desc}"><span class="bicon">${on ? a.icon : '🔒'}</span><b>${a.name}</b><small>${a.desc}</small></div>`;
    }).join('');
    const runs = p.bestRuns.length
      ? `<table class="runs"><thead><tr><th>#</th><th>নিট আয়</th><th>তারা</th><th>সময়</th><th>যাত্রী</th><th>তারিখ</th></tr></thead><tbody>` +
        p.bestRuns.map((r: BestRun, i: number) => `<tr class="${r.date === career.lastRunDate ? 'latest' : ''}"><td>${bn(i + 1)}</td><td><b>${bnTaka(r.net)}</b></td><td>${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</td><td>${bnTime(r.timeSec)}</td><td>${bn(r.passengers)}</td><td>${bn(new Date(r.date).toLocaleDateString('en-GB'))}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="hint">এখনো কোনো ট্রিপ নেই — প্রথম ট্রিপটা করে আসুন!</p>';
    el.innerHTML = `<div class="panel records-panel">
      <h2>🏆 রেকর্ড</h2>
      <div class="seg tabs"><button data-tab="badges" class="${tab === 'badges' ? 'on' : ''}">ব্যাজ ${bn(p.achievements.length)}/${bn(ACHIEVEMENTS.length)}</button><button data-tab="runs" class="${tab === 'runs' ? 'on' : ''}">সেরা ট্রিপ</button></div>
      <div class="rec-body">${tab === 'badges' ? `<div class="badges">${badges}</div>` : runs}</div>
      <div class="row"><button id="records-close" class="btn-primary">ঠিক আছে</button></div>
    </div>`;
    el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.tab as typeof tab; render(); });
    $('records-close').onclick = () => { el.classList.add('hidden'); onClose(); };
  };
  el.refresh = (t) => { if (t) tab = t; render(); };
  render();
  return el;
}
