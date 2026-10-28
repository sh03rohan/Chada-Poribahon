import { bn, bnTime, bnTaka } from '../util/bangla.ts';
import { BANGLA_FONT } from '../util/fonts.ts';
import type { RunOutcome } from './career.ts';
import { LEVEL_TITLES } from './career.ts';

export interface RunResult {
  timeSec: number; passengers: number; income: number; mood: number; stars: number; shouts: number;
  hardBrakes: number; swerves: number; stoppedAtRajbari: boolean;
  stopsDone?: number; stopsTotal?: number; fares?: number; fines?: number; chada?: number; fuel?: number; charity?: number;
  /** career delta (Phase 3) */
  career?: RunOutcome;
  contractText?: string;
  repair?: number; damage?: number; toll?: number;
}

const NEWS = [
  (r: RunResult) => `কুষ্টিয়া-ঢাকা বাস ${bn(Math.round(r.timeSec / 60))} মিনিটে পৌঁছাল, যাত্রীর গালি ${bn(r.shouts)} টা।`,
  (r: RunResult) => `"${bn(r.hardBrakes)} বার হার্ড ব্রেক, তবু জীবিত" — চাঁদা পরিবহনের যাত্রীরা স্বস্তিতে।`,
  (r: RunResult) => `রেকর্ড: ${bn(r.passengers)} জন যাত্রী নিয়ে বাস ঢাকায়, ড্রাইভারের মেজাজ রেটিং ${bn(Math.round(r.mood))}/১০০।`,
  (r: RunResult) => `অবরোধ পেরিয়ে ঢাকায় চাঁদা পরিবহন; যাত্রীরা বললেন "${r.stars >= 4 ? 'আবার যাব' : 'আর না'}"।`,
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function showResults(r: RunResult, onAgain: () => void) {
  const root = $('results');
  $('res-stars').textContent = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
  $('res-grid').innerHTML = [
    ['সময়', bnTime(r.timeSec)], ['যাত্রী', bn(r.passengers)], ['নিট আয়', bnTaka(r.income)], ['মেজাজ', bn(Math.round(r.mood)) + '%'],
    ['হার্ড ব্রেক', bn(r.hardBrakes)], ['যাত্রীর চিৎকার', bn(r.shouts)], ['স্টপ', `${bn(r.stopsDone ?? (r.stoppedAtRajbari ? 1 : 0))} / ${bn(r.stopsTotal ?? 1)}`],
    ['ভাড়া আদায়', bnTaka(r.fares ?? r.income)], ['জরিমানা', bnTaka(r.fines ?? 0)], ['চাঁদা', bnTaka(r.chada ?? 0)], ['তেল', bnTaka(r.fuel ?? 0)],
    ['মেরামত', `${bnTaka(r.repair ?? 0)}${r.damage ? ` (ক্ষতি ${bn(Math.round(r.damage))}%)` : ''}`],
    ['টোল / ফেরি', bnTaka(r.toll ?? 0)],
  ].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  const car = $('res-career');
  if (r.career) {
    const c = r.career;
    car.innerHTML = `<span>${c.earned >= 0 ? '+' : '−'}${bnTaka(Math.abs(c.earned))} → ব্যালেন্স <b>${bnTaka(c.balance)}</b></span><span>+${bn(c.xpGained)} XP</span>` +
      (c.levelUp ? `<span class="lvlup">🎉 লেভেল ${bn(c.levelAfter)} — ${LEVEL_TITLES[Math.min(c.levelAfter, LEVEL_TITLES.length) - 1]}!</span>` : `<span>লেভেল ${bn(c.levelAfter)}</span>`) +
      (r.contractText ? `<span class="contract">${r.contractText}</span>` : '');
    car.classList.remove('hidden');
  } else car.classList.add('hidden');
  const news = NEWS[Math.floor(Math.random() * NEWS.length)](r);
  $('res-news').textContent = '📰 ' + news;
  root.classList.remove('hidden');
  $('btn-again').onclick = () => { root.classList.add('hidden'); onAgain(); };
  $('btn-share').onclick = () => shareImage(r, news);
}

/** Render a share card to canvas → PNG (Web Share API with file if available, else download). */
export async function shareImage(r: RunResult, news: string) {
  const W = 1080, H = 1080;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fff6d5'); g.addColorStop(1, '#ffd98a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#d8262c'; ctx.lineWidth = 28; ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 10; ctx.strokeRect(42, 42, W - 84, H - 84);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d8262c'; ctx.font = `700 110px "${BANGLA_FONT}"`;
  ctx.shadowColor = '#ffcc33'; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 5;
  ctx.fillText('চাঁদা পরিবহন', W / 2, 150);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#2a1a0a'; ctx.font = `700 46px "${BANGLA_FONT}"`;
  ctx.fillText('কুষ্টিয়া → ঢাকা', W / 2, 240);
  ctx.fillStyle = '#c99400'; ctx.font = `700 120px "${BANGLA_FONT}"`;
  ctx.fillText('★'.repeat(r.stars) + '☆'.repeat(5 - r.stars), W / 2, 360);
  const rows: [string, string][] = [['সময়', bnTime(r.timeSec)], ['যাত্রী', bn(r.passengers)], ['আয়', bnTaka(r.income)], ['যাত্রীর মেজাজ', bn(Math.round(r.mood)) + '%'], ['যাত্রীর চিৎকার', bn(r.shouts)]];
  ctx.font = `400 48px "${BANGLA_FONT}"`;
  rows.forEach(([k, v], i) => {
    const y = 470 + i * 78;
    ctx.textAlign = 'right'; ctx.fillStyle = '#5a3a1a'; ctx.fillText(k, W / 2 - 30, y);
    ctx.textAlign = 'left'; ctx.fillStyle = '#d8262c'; ctx.font = `700 48px "${BANGLA_FONT}"`; ctx.fillText(v, W / 2 + 30, y);
    ctx.font = `400 48px "${BANGLA_FONT}"`;
  });
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillRect(80, 880, W - 160, 130);
  ctx.fillStyle = '#d8262c'; ctx.fillRect(80, 880, 14, 130);
  ctx.fillStyle = '#2a1a0a'; ctx.font = `400 34px "${BANGLA_FONT}"`;
  wrapText(ctx, '📰 ' + news, W / 2, 925, W - 220, 44);
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
  const file = new File([blob], 'chada-poribohon.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: 'চাঁদা পরিবহন' }); return; } catch { /* user cancelled → fall through */ }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chada-poribohon.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' '); let line = ''; let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; } else line = test;
  }
  ctx.fillText(line, x, yy);
}
