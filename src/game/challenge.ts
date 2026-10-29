import { bn, bnTaka, bnClock } from '../util/bangla.ts';
import { ROUTES, type RouteId } from '../routes.ts';
import { CONTRACTS, type ContractDef } from './contracts.ts';
import { WEATHER_INFO, type WeatherKind } from '../world/weather.ts';

/**
 * Daily challenge: one fixed run per calendar day — route, clock hour, weather and contract are
 * drawn from a PRNG seeded with the date, so every player gets the same conditions. The score is
 * net income + stars × 500 + contract bonus; the best score per day is kept locally.
 */
export interface Challenge { id: string; routeId: RouteId; hour: number; weather: WeatherKind; contract: ContractDef; }
export interface ChallengeEntry { best: number; runs: number; net: number; stars: number; timeSec: number; last: number; }
export type ChallengeBook = Record<string, ChallengeEntry>;

const KEY = 'cp-challenge';
const HOURS = [6.5, 9, 13, 17.5, 20.5, 23];
const WEATHERS: WeatherKind[] = ['clear', 'clear', 'rain', 'fog', 'storm', 'clear'];

export function dateId(d = new Date()): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function mulberry32(seed: number) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function dailyChallenge(id = dateId()): Challenge {
  const rnd = mulberry32(hash('chada:' + id));
  const routes = ROUTES.filter((r) => r.available);
  const route = routes[Math.floor(rnd() * routes.length)];
  const hour = HOURS[Math.floor(rnd() * HOURS.length)];
  const weather = WEATHERS[Math.floor(rnd() * WEATHERS.length)];
  const contract = CONTRACTS[Math.floor(rnd() * CONTRACTS.length)];
  return { id, routeId: route.id, hour, weather, contract };
}

export function challengeScore(net: number, stars: number, contractBonus: number): number { return Math.round(net + stars * 500 + contractBonus); }

export function loadBook(): ChallengeBook { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export function saveBook(b: ChallengeBook) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* private mode */ } }
/** Record a finished challenge run; returns the entry and whether it is a new personal best. */
export function recordChallenge(id: string, score: number, net: number, stars: number, timeSec: number): { entry: ChallengeEntry; isBest: boolean } {
  const b = loadBook();
  const e = b[id] ?? { best: -Infinity, runs: 0, net, stars, timeSec, last: score };
  const isBest = score > e.best;
  if (isBest) { e.best = score; e.net = net; e.stars = stars; e.timeSec = Math.round(timeSec); }
  e.runs++; e.last = score; b[id] = e;
  // keep the last 60 days only
  const keys = Object.keys(b).sort(); while (keys.length > 60) delete b[keys.shift()!];
  saveBook(b);
  return { entry: e, isBest };
}

export function describeChallenge(c: Challenge): string {
  const r = ROUTES.find((x) => x.id === c.routeId)!; const w = WEATHER_INFO[c.weather];
  return `${r.label} · ${bnClock(c.hour)} · ${w.icon} ${w.name} · 📜 ${c.contract.name}`;
}
export function challengeDateLabel(id: string): string { const [y, m, d] = id.split('-'); return `${bn(+d)}/${bn(+m)}/${bn(+y)}`; }
export function shareText(c: Challenge, score: number, net: number, stars: number): string {
  return `🚌 চাঁদা পরিবহন — আজকের চ্যালেঞ্জ ${challengeDateLabel(c.id)}\n${describeChallenge(c)}\nস্কোর ${bn(score)} · নিট ${bnTaka(net)} · ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}\nআপনি কত পান? ${location.origin}${location.pathname}?challenge=${c.id}`;
}
