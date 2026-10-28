import { bn, bnTaka } from '../util/bangla.ts';

/**
 * Daily contracts: optional goals picked on the pre-trip card, paid as a bonus (money + XP) at
 * Dhaka when the run satisfies the check. Three are offered per calendar day (seeded by the
 * date) from the pool, filtered by career level; the player may also take none.
 */
export interface RunFacts {
  timeSec: number; mood: number; missedStops: number; stopsDone: number; passengers: number;
  fines: number; hardBrakes: number; crashes: number; chadaPaid: number; refuels: number; fuelEmptied: boolean; wrongBranches: number;
}
export interface ContractDef { id: string; name: string; desc: string; bonus: number; xp: number; minLevel: number; check: (f: RunFacts) => boolean; }

export const CONTRACTS: ContractDef[] = [
  { id: 'ontime', name: 'সময়মতো', desc: '৭ মিনিটের মধ্যে ঢাকা পৌঁছান', bonus: 1500, xp: 150, minLevel: 1, check: (f) => f.timeSec <= 7 * 60 },
  { id: 'service', name: 'যাত্রীসেবা', desc: 'কোনো স্টপ মিস না করে, মেজাজ ৭০%-এর উপরে রেখে পৌঁছান', bonus: 2000, xp: 200, minLevel: 1, check: (f) => f.missedStops === 0 && f.mood >= 70 },
  { id: 'safe', name: 'সেফ ড্রাইভার', desc: 'কোনো জরিমানা নয়, কোনো ধাক্কা নয়, হার্ড ব্রেক ২টার বেশি নয়', bonus: 1800, xp: 180, minLevel: 1, check: (f) => f.fines === 0 && f.crashes === 0 && f.hardBrakes <= 2 },
  { id: 'fullload', name: 'ফুল লোড', desc: 'কমপক্ষে ৩০ জন যাত্রী নিয়ে ঢাকায় নামুন', bonus: 1500, xp: 150, minLevel: 2, check: (f) => f.passengers >= 30 },
  { id: 'honest', name: 'সৎ ড্রাইভার', desc: 'এক টাকাও চাঁদা দেবেন না, জরিমানাও খাবেন না', bonus: 1200, xp: 150, minLevel: 2, check: (f) => f.chadaPaid === 0 && f.fines === 0 },
  { id: 'fuel', name: 'তেল সাশ্রয়', desc: 'পাম্পে না থেমে, তেল শেষ না করে ঢাকা', bonus: 1000, xp: 120, minLevel: 2, check: (f) => f.refuels === 0 && !f.fuelEmptied },
  { id: 'express', name: 'এক্সপ্রেস', desc: '৬ মিনিটের মধ্যে, রাস্তা ভুল না করে', bonus: 2500, xp: 250, minLevel: 3, check: (f) => f.timeSec <= 6 * 60 && f.wrongBranches === 0 },
  { id: 'perfect', name: 'পারফেক্ট ট্রিপ', desc: 'সব স্টপ, ০ জরিমানা, ০ ধাক্কা, মেজাজ ৮০%+', bonus: 4000, xp: 400, minLevel: 4, check: (f) => f.missedStops === 0 && f.fines === 0 && f.crashes === 0 && f.mood >= 80 },
];

/** Deterministic per-day pick of three contracts the player's level allows. */
export function dailyContracts(level: number, date = new Date()): ContractDef[] {
  const pool = CONTRACTS.filter((c) => c.minLevel <= level);
  let seed = date.getFullYear() * 372 + date.getMonth() * 31 + date.getDate();
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const picks: ContractDef[] = [];
  const bag = [...pool];
  while (picks.length < 3 && bag.length) picks.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0]);
  return picks;
}

export interface ContractResult { def: ContractDef; done: boolean; text: string; }

export function evaluateContract(def: ContractDef | null, f: RunFacts): ContractResult | null {
  if (!def) return null;
  const done = def.check(f);
  return { def, done, text: done ? `✅ কন্ট্রাক্ট “${def.name}” সম্পূর্ণ — বোনাস ${bnTaka(def.bonus)} + ${bn(def.xp)} XP` : `❌ কন্ট্রাক্ট “${def.name}” হয়নি (${def.desc})` };
}

/** Renders the radio list on the pre-trip card; returns a getter for the chosen contract. */
export function renderContractPicker(el: HTMLElement, offers: ContractDef[], initial: string | null): () => ContractDef | null {
  let chosen: string | null = initial && offers.some((o) => o.id === initial) ? initial : null;
  const draw = () => {
    el.innerHTML = `<b>📜 আজকের কন্ট্রাক্ট</b><div class="contracts">` +
      `<button class="contract ${chosen === null ? 'on' : ''}" data-id=""><span>কোনো কন্ট্রাক্ট নয়</span><small>শুধু ভাড়া</small></button>` +
      offers.map((o) => `<button class="contract ${chosen === o.id ? 'on' : ''}" data-id="${o.id}"><span>${o.name}</span><small>${o.desc}</small><em>+${bnTaka(o.bonus)} · ${bn(o.xp)} XP</em></button>`).join('') + '</div>';
    el.querySelectorAll<HTMLButtonElement>('.contract').forEach((b) => b.onclick = () => { chosen = b.dataset.id || null; draw(); });
  };
  draw();
  return () => offers.find((o) => o.id === chosen) ?? null;
}
