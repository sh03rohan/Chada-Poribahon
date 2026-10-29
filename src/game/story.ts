import { bn, bnTaka, bnClock } from '../util/bangla.ts';
import { ROUTES, type RouteId } from '../routes.ts';
import { WEATHER_INFO, type WeatherKind } from '../world/weather.ts';

/**
 * Story mode "৭ দিনের চাকরি": seven linked days driving for a bus owner. Each day fixes the route,
 * the clock, sometimes the weather and a contract, and adds a condition (Eid rush, hartal, loan
 * instalment, inspector on board…). Meeting the day's net-income target earns a point; after day
 * seven the owner gives a verdict. Progress lives in localStorage (`cp-story`).
 */
export type StoryCondition = 'none' | 'eid' | 'hartal' | 'instalment' | 'night' | 'inspector' | 'final';
export interface StoryDay {
  day: number; title: string; owner: string; route: RouteId; hour: number; weather: WeatherKind | null; contract: string | null;
  target: number; condition: StoryCondition; conditionText: string;
  /** passengers waiting at stands × this */
  crowd: number;
}
export interface StoryDayResult { net: number; stars: number; met: boolean; points: number; note: string; }
export interface StoryProgress { day: number; results: StoryDayResult[]; finished: boolean; ending: string | null; }

export const INSTALMENT = 5000;
export const INSPECTOR_BONUS = 1500, INSPECTOR_PENALTY = 2000;

export const STORY: StoryDay[] = [
  { day: 1, title: 'প্রথম দিন', owner: '“বাসটা নতুন, কাগজ সব ঠিক আছে। আস্তে চালাও, যাত্রী তোলো — দিনে অন্তত ৳৮,০০০ চাই।”', route: 'kushtia-dhaka', hour: 7, weather: 'clear', contract: null, target: 8000, condition: 'none', conditionText: 'সাধারণ দিন — স্টপে থামুন, জরিমানা এড়ান', crowd: 1 },
  { day: 2, title: 'ঈদের ভিড়', owner: '“ঈদের আগের দিন — স্ট্যান্ডে মানুষের ঢল। যত পারো তোলো, কিন্তু ছাদে বেশি নিয়ো না।”', route: 'kushtia-dhaka', hour: 9, weather: 'clear', contract: 'fullload', target: 12000, condition: 'eid', conditionText: 'স্ট্যান্ডে দেড় গুণ যাত্রী — টার্গেট বেশি', crowd: 1.8 },
  { day: 3, title: 'হরতাল', owner: '“আজ হরতাল। রাস্তায় লোক কম, অবরোধ বেশি। যা পাও তাই — বাস যেন আস্ত থাকে।”', route: 'dhaka-sylhet', hour: 13, weather: null, contract: 'safe', target: 5000, condition: 'hartal', conditionText: 'যাত্রী অর্ধেক, অবরোধে ধৈর্য — ধাক্কা নয়', crowd: 0.55 },
  { day: 4, title: 'কিস্তির দিন', owner: '“মহাজনের কিস্তি ৳৫,০০০ আজই — দিনের আয় থেকে কেটে নেব। কিস্তির পরেও যেন ৳৫,০০০ থাকে।”', route: 'kushtia-dhaka', hour: 17.5, weather: null, contract: 'ontime', target: 10000, condition: 'instalment', conditionText: 'দিনের শেষে ৳৫,০০০ কিস্তি কাটা যাবে', crowd: 1 },
  { day: 5, title: 'ঝড়ের রাত', owner: '“রাতের ট্রিপ, আবহাওয়া খারাপ। হাই বিম দিয়ো, বাতি-ছাড়া ট্রাক সাবধান। নিরাপদে পৌঁছালেই হবে।”', route: 'dhaka-chattogram', hour: 20.5, weather: 'storm', contract: 'safe', target: 7000, condition: 'night', conditionText: 'রাত + ঝড় — পিচ্ছিল রাস্তা, বাতি-ছাড়া গাড়ি', crowd: 0.8 },
  { day: 6, title: 'ইন্সপেক্টরের দিন', owner: '“আজ কোম্পানির ইন্সপেক্টর সাহেব বাসে থাকবেন। একটা জরিমানা নয়, হার্ড ব্রেক দুইটার বেশি নয়। ভালো রিপোর্ট হলে বোনাস।”', route: 'dhaka-sylhet', hour: 9, weather: 'clear', contract: 'service', target: 9000, condition: 'inspector', conditionText: 'জরিমানা ০, হার্ড ব্রেক ≤ ২ → বোনাস ৳১,৫০০; নইলে কাটা ৳২,০০০', crowd: 1.3 },
  { day: 7, title: 'শেষ দিন', owner: '“সপ্তাহ শেষ। আজ কুয়াশা। একটা পারফেক্ট ট্রিপ দেখাও — তারপর তোমার ব্যাপারে সিদ্ধান্ত নেব।”', route: 'kushtia-dhaka', hour: 6.5, weather: 'fog', contract: 'perfect', target: 10000, condition: 'final', conditionText: 'ঘন কুয়াশা — ধীরে, সব স্টপ, ০ জরিমানা', crowd: 1 },
];

const KEY = 'cp-story';
export function loadStory(): StoryProgress { try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (p && typeof p.day === 'number') return p; } catch { /* ignore */ } return { day: 1, results: [], finished: false, ending: null }; }
export function saveStory(p: StoryProgress) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }
export function resetStory(): StoryProgress { const p = { day: 1, results: [], finished: false, ending: null }; saveStory(p); return p; }

/** Judge a day: a point for the target, half a point for 4+ stars, half for no fines. */
export function judgeDay(d: StoryDay, f: { net: number; stars: number; fines: number; hardBrakes: number; crashes: number }): StoryDayResult {
  const met = f.net >= d.target;
  let points = met ? 1 : 0; if (f.stars >= 4) points += 0.5; if (f.fines === 0) points += 0.5;
  const note = met ? `টার্গেট ${bnTaka(d.target)} পূরণ ✅` : `টার্গেট ${bnTaka(d.target)} হয়নি ❌ (${bnTaka(f.net)})`;
  return { net: f.net, stars: f.stars, met, points, note };
}
export function verdict(results: StoryDayResult[]): { title: string; text: string; grade: 'partner' | 'kept' | 'fired' } {
  const pts = results.reduce((a, r) => a + r.points, 0), met = results.filter((r) => r.met).length;
  if (pts >= 10) return { grade: 'partner', title: '🎉 মালিক বললেন: “বাসটা এখন থেকে অর্ধেক তোমার।”', text: `৭ দিনে ${bn(met)} দিন টার্গেট পূরণ, মোট ${bn(pts)} পয়েন্ট। আপনি এখন অংশীদার — লাইনের সবাই চেনে “ওস্তাদ” নামে।` };
  if (pts >= 6) return { grade: 'kept', title: '👍 মালিক বললেন: “থাকো, বেতন বাড়ল।”', text: `৭ দিনে ${bn(met)} দিন টার্গেট পূরণ, মোট ${bn(pts)} পয়েন্ট। চাকরি পাকা, মাসে ৳২,০০০ বেশি।` };
  return { grade: 'fired', title: '😞 মালিক বললেন: “তোমাকে দিয়ে হবে না।”', text: `৭ দিনে মাত্র ${bn(met)} দিন টার্গেট পূরণ, ${bn(pts)} পয়েন্ট। আবার শুরু করুন — এবার স্টপে থামুন, জরিমানা এড়ান।` };
}
export function describeDay(d: StoryDay): string {
  const r = ROUTES.find((x) => x.id === d.route)!;
  return `${r.label} · ${bnClock(d.hour)} · ${d.weather ? WEATHER_INFO[d.weather].icon + ' ' + WEATHER_INFO[d.weather].name : '🎲 আবহাওয়া অজানা'} · টার্গেট ${bnTaka(d.target)}`;
}
