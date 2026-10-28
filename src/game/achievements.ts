import { bn } from '../util/bangla.ts';
import type { Profile } from './career.ts';

/**
 * Badges. Checked at Dhaka against the finished run + the (already updated) career profile.
 * Unlocks are stored in the profile (`achievements`) so each one fires once.
 */
export interface RunFactsAll {
  stars: number; net: number; timeSec: number; passengers: number; fines: number; crashes: number; chadaPaid: number; chadaRefused: boolean;
  missedStops: number; mood: number; damage: number; ferry: boolean; roof: number; night: boolean; contractDone: boolean; refuels: number; hardBrakes: number; tips: number;
}
export interface AchievementDef { id: string; icon: string; name: string; desc: string; check: (run: RunFactsAll, p: Profile, level: number) => boolean; }

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first', icon: '🚌', name: 'প্রথম ট্রিপ', desc: 'প্রথমবার ঢাকায় পৌঁছানো', check: (_r, p) => p.trips >= 1 },
  { id: 'five_star', icon: '⭐', name: 'পাঁচ তারা', desc: 'এক ট্রিপে ৫ তারা রেটিং', check: (r) => r.stars >= 5 },
  { id: 'no_fine', icon: '🧾', name: 'কাগজ ঠিক', desc: 'এক টাকাও জরিমানা ছাড়া ঢাকা', check: (r) => r.fines === 0 },
  { id: 'honest', icon: '🤝', name: 'সৎ ড্রাইভার', desc: 'চাঁদা না দিয়ে, জরিমানা না খেয়ে ঢাকা', check: (r) => r.chadaPaid === 0 && r.fines === 0 },
  { id: 'brave', icon: '✊', name: 'ভয় পাই না', desc: 'চাঁদা দিতে অস্বীকার করেও জরিমানা ছাড়া পৌঁছানো', check: (r) => r.chadaRefused && r.fines === 0 },
  { id: 'full', icon: '👥', name: 'ফুল লোড', desc: 'কমপক্ষে ৩৪ জন যাত্রী নিয়ে নামা (ছাদ সহ)', check: (r) => r.passengers >= 34 },
  { id: 'ferry', icon: '⛴️', name: 'ফেরির যাত্রী', desc: 'দৌলতদিয়া ফেরিতে পদ্মা পার', check: (r) => r.ferry },
  { id: 'night', icon: '🌙', name: 'রাতের পাখি', desc: 'রাতে (রাত ৮টার পর) একটা ট্রিপ শেষ', check: (r) => r.night },
  { id: 'express', icon: '⚡', name: 'এক্সপ্রেস', desc: '৬ মিনিটের মধ্যে ঢাকা', check: (r) => r.timeSec <= 360 },
  { id: 'smooth', icon: '🪶', name: 'পালকের মতো', desc: '০ হার্ড ব্রেক, ০ ধাক্কা, মেজাজ ৮৫%+', check: (r) => r.hardBrakes === 0 && r.crashes === 0 && r.mood >= 85 },
  { id: 'spotless', icon: '✨', name: 'একটা আঁচড়ও না', desc: 'ক্ষতি ০% নিয়ে ঢাকা', check: (r) => r.damage === 0 && r.crashes === 0 },
  { id: 'sweep', icon: '🏁', name: 'সব স্টপ', desc: 'সব স্টপে যাত্রী তুলে, ০ জরিমানা, মেজাজ ৮০%+', check: (r) => r.missedStops === 0 && r.fines === 0 && r.mood >= 80 },
  { id: 'roof', icon: '🧗', name: 'ছাদের মাস্টার', desc: 'ছাদে যাত্রী নিয়ে জরিমানা ছাড়া ঢাকা', check: (r) => r.roof > 0 && r.fines === 0 },
  { id: 'ten', icon: '🔟', name: 'লাইনের লোক', desc: '১০টা ট্রিপ', check: (_r, p) => p.trips >= 10 },
  { id: 'hundred', icon: '💯', name: 'শত যাত্রী', desc: 'মোট ১০০ জন যাত্রী পৌঁছে দেওয়া', check: (_r, p) => p.totalPassengers >= 100 },
  { id: 'ostad', icon: '🎖️', name: 'ওস্তাদ', desc: 'লেভেল ৫-এ পৌঁছানো', check: (_r, _p, level) => level >= 5 },
  { id: 'contracts', icon: '📜', name: 'কন্ট্রাক্টর', desc: '৫টা কন্ট্রাক্ট পূরণ', check: (_r, p) => p.contractsDone >= 5 },
  { id: 'tipped', icon: '💝', name: 'যাত্রীর দোয়া', desc: 'স্পেশাল যাত্রীর অনুরোধ রেখে বকশিশ পাওয়া', check: (r) => r.tips > 0 },
  { id: 'rich', icon: '💰', name: 'লাখপতি হওয়ার পথে', desc: 'ব্যালেন্স ৳৫০,০০০', check: (_r, p) => p.balance >= 50000 },
];

/** Returns the newly unlocked definitions (and records them in the profile). */
export function evaluateAchievements(run: RunFactsAll, p: Profile, level: number): AchievementDef[] {
  const fresh: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements.includes(a.id)) continue;
    let ok = false; try { ok = a.check(run, p, level); } catch { ok = false; }
    if (ok) { p.achievements.push(a.id); fresh.push(a); }
  }
  return fresh;
}

export function achievementSummary(p: Profile): string { return `${bn(p.achievements.length)} / ${bn(ACHIEVEMENTS.length)} ব্যাজ`; }
