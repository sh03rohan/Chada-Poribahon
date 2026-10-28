import { bn, bnTaka } from '../util/bangla.ts';

/**
 * Career profile: everything that survives between runs (localStorage `cp-career`).
 * Balance is the driver's own money (net income of every trip, spent in the garage),
 * XP drives the level/title, and the garage upgrade levels live here too.
 */
export type UpgradeId = 'brakes' | 'engine' | 'tyres' | 'horn' | 'livery';

export interface Profile {
  version: number;
  balance: number;
  xp: number;
  trips: number;
  bestStars: number;
  totalPassengers: number;
  totalEarned: number;
  contractsDone: number;
  upgrades: Record<UpgradeId, number>;
  /** garage paint: owned scheme ids and the one applied */
  liveriesOwned: number[];
  livery: number;
  lastPlayed: string;
}

export interface RunSummary {
  net: number; stars: number; passengers: number; stopsDone: number; fines: number; timeSec: number; hardBrakes: number;
  /** bonus from a completed contract (money, xp) */
  contractBonus?: number; contractXp?: number;
}

export interface RunOutcome { earned: number; xpGained: number; levelBefore: number; levelAfter: number; levelUp: boolean; balance: number; }

/** XP needed to *reach* each level (index = level − 1). */
export const LEVEL_XP = [0, 400, 1100, 2200, 4000, 6500, 10000];
export const LEVEL_TITLES = ['হেল্পার', 'নতুন ড্রাইভার', 'লাইনের ড্রাইভার', 'পাকা ড্রাইভার', 'ওস্তাদ', 'রোডের বাঘ', 'লিজেন্ড'];

const KEY = 'cp-career';
const DEFAULTS: Profile = {
  version: 1, balance: 0, xp: 0, trips: 0, bestStars: 0, totalPassengers: 0, totalEarned: 0, contractsDone: 0,
  upgrades: { brakes: 0, engine: 0, tyres: 0, horn: 0, livery: 0 }, liveriesOwned: [0], livery: 0, lastPlayed: '',
};

export class Career {
  readonly profile: Profile;
  constructor() {
    let saved: Partial<Profile> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
    this.profile = { ...DEFAULTS, ...saved, upgrades: { ...DEFAULTS.upgrades, ...(saved.upgrades ?? {}) } };
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.profile)); } catch { /* private mode */ } }
  reset() { Object.assign(this.profile, structuredClone(DEFAULTS)); this.save(); }

  get level(): number { let l = 1; for (let i = 1; i < LEVEL_XP.length; i++) if (this.profile.xp >= LEVEL_XP[i]) l = i + 1; return l; }
  get title(): string { return LEVEL_TITLES[Math.min(this.level, LEVEL_TITLES.length) - 1]; }
  get maxLevel(): boolean { return this.level >= LEVEL_XP.length; }
  /** 0..1 progress toward the next level (1 at max level) */
  get levelProgress(): number {
    if (this.maxLevel) return 1;
    const a = LEVEL_XP[this.level - 1], b = LEVEL_XP[this.level];
    return (this.profile.xp - a) / (b - a);
  }
  get xpToNext(): number { return this.maxLevel ? 0 : LEVEL_XP[this.level] - this.profile.xp; }

  /** XP for a finished run: stars and passengers matter most, fines and hard braking cost a little. */
  static xpFor(r: RunSummary): number {
    const base = 120 + r.stars * 70 + r.passengers * 3 + r.stopsDone * 45;
    const penalty = Math.min(base * 0.5, r.fines / 10 + r.hardBrakes * 5);
    return Math.max(40, Math.round(base - penalty)) + (r.contractXp ?? 0);
  }

  /** Apply a finished run to the profile and persist. */
  recordRun(r: RunSummary): RunOutcome {
    const p = this.profile;
    const levelBefore = this.level;
    const earned = Math.round(r.net + (r.contractBonus ?? 0));
    const xpGained = Career.xpFor(r);
    p.balance += earned; p.xp += xpGained; p.trips++;
    p.bestStars = Math.max(p.bestStars, r.stars);
    p.totalPassengers += r.passengers; p.totalEarned += Math.max(0, earned);
    if (r.contractBonus) p.contractsDone++;
    p.lastPlayed = new Date().toISOString();
    this.save();
    const levelAfter = this.level;
    return { earned, xpGained, levelBefore, levelAfter, levelUp: levelAfter > levelBefore, balance: p.balance };
  }

  canAfford(cost: number) { return this.profile.balance >= cost; }
  spend(cost: number) { if (!this.canAfford(cost)) return false; this.profile.balance -= cost; this.save(); return true; }

  /** One-line career summary for the landing page. */
  summaryHtml(): string {
    const p = this.profile;
    const pct = Math.round(this.levelProgress * 100);
    return `<div class="career-row"><span class="career-lvl">লেভেল ${bn(this.level)}</span><b>${this.title}</b><span>ব্যালেন্স <b>${bnTaka(p.balance)}</b></span><span>${bn(p.trips)} ট্রিপ</span></div>
      <div class="career-bar" title="${bn(p.xp)} XP"><div style="width:${pct}%"></div></div>
      <small>${this.maxLevel ? 'সর্বোচ্চ লেভেল' : `পরের লেভেলে ${bn(this.xpToNext)} XP বাকি`}</small>`;
  }
}

// ---------------------------------------------------------------- garage catalogue
export interface UpgradeDef { id: UpgradeId; name: string; icon: string; desc: string; costs: number[]; effect: (level: number) => string; }
export const UPGRADES: UpgradeDef[] = [
  { id: 'brakes', name: 'ব্রেক', icon: '🛑', desc: 'নতুন ব্রেক শু আর এয়ার ড্রাম — কম দূরত্বে থামে', costs: [3000, 6000, 10000], effect: (l) => `ব্রেক শক্তি +${bn(l * 12)}%` },
  { id: 'engine', name: 'ইঞ্জিন', icon: '⚙️', desc: 'টার্বো আর ফুয়েল পাম্প টিউন — দ্রুত টানে', costs: [4000, 8000, 14000], effect: (l) => `টর্ক +${bn(l * 8)}%` },
  { id: 'tyres', name: 'টায়ার', icon: '🛞', desc: 'নতুন রেডিয়াল টায়ার — বাঁকে আর বৃষ্টিতে কম পিছলায়', costs: [2500, 5000, 8000], effect: (l) => `গ্রিপ +${bn(l * 6)}%` },
  { id: 'horn', name: 'এয়ার হর্ন', icon: '📯', desc: 'তিন-সুরের এয়ার হর্ন — রাস্তা ফাঁকা হয়', costs: [1500], effect: (l) => (l ? 'লাগানো আছে' : 'স্টক হর্ন') },
];
export const UPGRADE_MODS = { brakesPerLevel: 0.12, torquePerLevel: 0.08, gripPerLevel: 0.06 };

export interface LiveryScheme { id: number; name: string; main: string; dark: string; cost: number; }
export const LIVERIES: LiveryScheme[] = [
  { id: 0, name: 'লাল (আসল)', main: '#d8262c', dark: '#8a1216', cost: 0 },
  { id: 1, name: 'সবুজ', main: '#1f8a4a', dark: '#0f5c30', cost: 2000 },
  { id: 2, name: 'নীল', main: '#1f5fb5', dark: '#0b3a66', cost: 2000 },
  { id: 3, name: 'বেগুনি', main: '#7a3fa0', dark: '#4a1f66', cost: 2500 },
  { id: 4, name: 'কমলা', main: '#e8731a', dark: '#8a3f08', cost: 2500 },
];

export function upgradeCost(def: UpgradeDef, level: number): number | null { return level < def.costs.length ? def.costs[level] : null; }
