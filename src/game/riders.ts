import { bn, bnTaka } from '../util/bangla.ts';
import type { ChoicePanel } from './choice.ts';
import type { Hud } from './hud.ts';
import type { Ledger } from './ledger.ts';
import type { Passengers } from './passengers.ts';
import { WORLD } from '../config.ts';

/**
 * Passenger interaction 2.0: small money-and-manners moments handled through the choice panel.
 *  - haggle at boarding: someone offers less than the fare (accept / refuse / let the helper argue)
 *  - no change: a big note mid-leg (helper hops off at the next stop → longer dwell / waive / helper)
 *  - mid-way drop: someone wants off at a village — stop within 20 s for a small tip, or refuse
 * One haggle per stop at most and one mid-leg event per leg; outcomes touch fares, tips and mood.
 */
export type RiderEventKind = 'haggle' | 'nochange' | 'drop';
export interface RiderLog { kind: RiderEventKind; choice: number; outcome: string; }

export class RiderEvents {
  readonly log: RiderLog[] = [];
  private legTimer = -1; private legEvent: RiderEventKind | null = null;
  private dropWait = 0; private forced: RiderEventKind | null = null;
  chance = 0.5;
  constructor(private choice: ChoicePanel, private hud: Hud, private ledger: Ledger, private passengers: Passengers, private events: { extraDwell: number }) {}
  /** test hook: the next opportunity triggers this event */
  force(kind: RiderEventKind | null) { this.forced = kind; }
  reset() { this.log.length = 0; this.legTimer = -1; this.legEvent = null; this.dropWait = 0; }

  /** After a stop: maybe a haggle, then arm one mid-leg event for 10–30 s later. */
  async onStopEnd(stopIndex: number, boarded: number) {
    const fare = WORLD.stops[stopIndex]?.fare ?? 0;
    if (boarded > 0 && fare > 0 && (this.forced === 'haggle' || (this.forced === null && Math.random() < this.chance))) { if (this.forced === 'haggle') this.forced = null; await this.haggle(fare); }
    if (this.forced === 'nochange' || this.forced === 'drop') { this.legEvent = this.forced; this.forced = null; this.legTimer = 1; }
    else if (Math.random() < this.chance) { this.legEvent = Math.random() < 0.5 ? 'nochange' : 'drop'; this.legTimer = 10 + Math.random() * 20; }
  }
  private async haggle(fare: number) {
    const off = Math.round(fare * 0.2 / 10) * 10;
    const pick = await this.choice.askMany('“ভাই, ভাড়া একটু কম রাখেন”', `একজন যাত্রী ${bnTaka(fare)}-এর জায়গায় ${bnTaka(fare - off)} দিতে চান। হেল্পার তাকিয়ে আছে আপনার দিকে।`, [`মেনে নিন (−${bnTaka(off)})`, 'না, পুরো ভাড়া', 'হেল্পার সামলাক'], 15, 1);
    let outcome: string;
    if (pick === 0) { this.ledger.fares -= off; this.passengers.mood = Math.min(100, this.passengers.mood + 2); outcome = `কম রেখেছেন (−${bnTaka(off)}), যাত্রী খুশি`; }
    else if (pick === 1) { if (Math.random() < 0.4) { this.ledger.fares -= fare; this.passengers.count = Math.max(0, this.passengers.count - 1); outcome = `যাত্রী নেমে গেলেন — ভাড়া ${bnTaka(fare)} গেল`; } else { this.passengers.mood = Math.max(0, this.passengers.mood - 2); outcome = 'গজগজ করে পুরো ভাড়া দিলেন'; } }
    else { if (Math.random() < 0.6) outcome = 'হেল্পার বুঝিয়ে পুরো ভাড়া নিল'; else { this.passengers.mood = Math.max(0, this.passengers.mood - 3); this.passengers.shout('wait', true); outcome = 'হেল্পারের সাথে তর্ক — বাসের মেজাজ পড়ল'; } }
    this.log.push({ kind: 'haggle', choice: pick, outcome }); this.hud.message(`🗣️ ${outcome}`, pick === 0 || outcome.includes('পুরো ভাড়া নিল'), 3500);
  }
  /** Per frame while driving. */
  update(dt: number, kmh: number, phase: string, choiceOpen: boolean) {
    if (this.dropWait > 0) {
      this.dropWait -= dt;
      if (kmh < 1) { this.dropWait = 0; this.passengers.count = Math.max(0, this.passengers.count - 1); this.ledger.tips += 20; this.passengers.mood = Math.min(100, this.passengers.mood + 3); this.log.push({ kind: 'drop', choice: 0, outcome: 'থেমে নামিয়ে দিলেন — ৳২০ বকশিশ' }); this.hud.message('🙏 “দোয়া করি ভাই” — ৳২০ বকশিশ', true, 3000); }
      else if (this.dropWait <= 0) { this.passengers.mood = Math.max(0, this.passengers.mood - 4); this.log.push({ kind: 'drop', choice: 0, outcome: 'থামেননি — যাত্রী রেগে স্টপ পর্যন্ত গেলেন' }); this.hud.message('😠 “থামালেন না তো!” — যাত্রী রেগে গেলেন', false, 3000); }
      return;
    }
    if (this.legTimer < 0 || phase !== 'driving' || choiceOpen || kmh < 5) return;
    this.legTimer -= dt;
    if (this.legTimer > 0) return;
    this.legTimer = -1; const kind = this.legEvent; this.legEvent = null;
    if (kind === 'nochange') void this.noChange(); else if (kind === 'drop') void this.drop();
  }
  private async noChange() {
    const pick = await this.choice.askMany('“৫০০ টাকার নোট, খুচরা নেই”', 'একজন যাত্রীর কাছে বড় নোট। হেল্পার বলছে পরের স্টপে নেমে খুচরা করে আনবে।', ['পরের স্টপে খুচরা (+১৫ সে. দাঁড়ানো)', 'ভাড়া মাফ (−ভাড়া)', 'হেল্পার যা করার করুক'], 10, 0);
    const fare = WORLD.stops.find((s) => s.fare > 0)?.fare ?? 200;
    let outcome: string;
    if (pick === 0) { this.events.extraDwell += 15; outcome = 'পরের স্টপে হেল্পার খুচরা আনবে — ১৫ সেকেন্ড বেশি'; }
    else if (pick === 1) { this.ledger.fares -= fare; this.passengers.mood = Math.min(100, this.passengers.mood + 2); outcome = `ভাড়া মাফ (−${bnTaka(fare)}) — যাত্রী অবাক, খুশি`; }
    else { if (Math.random() < 0.5) outcome = 'হেল্পার অন্য যাত্রীর কাছ থেকে খুচরা জোগাড় করল'; else { this.passengers.mood = Math.max(0, this.passengers.mood - 3); outcome = 'খুচরা নিয়ে বাসে হট্টগোল — মেজাজ পড়ল'; } }
    this.log.push({ kind: 'nochange', choice: pick, outcome }); this.hud.message(`💵 ${outcome}`, pick !== 2 || !outcome.includes('হট্টগোল'), 3500);
  }
  private async drop() {
    const pick = await this.choice.askMany('“ভাই, এখানেই নামব — বাড়ি সামনে”', 'স্টপ নেই, কিন্তু এক যাত্রী এখানেই নামতে চান। থামালে ২০ সেকেন্ডের মধ্যে থামতে হবে।', ['থামুন, নামিয়ে দিন', 'না, স্টপে নামবেন'], 8, 1);
    if (pick === 0) { this.dropWait = 20; this.hud.message('🛑 ২০ সেকেন্ডের মধ্যে থামুন — যাত্রী নামবেন', true, 4000); }
    else { this.passengers.mood = Math.max(0, this.passengers.mood - 3); this.log.push({ kind: 'drop', choice: 1, outcome: 'নামতে দেননি — যাত্রী মন খারাপ' }); this.hud.message('😕 “ঠিক আছে, স্টপেই নামব…” — মেজাজ একটু পড়ল', false, 3000); }
  }
  get pendingDrop() { return this.dropWait > 0; }
  get count() { return this.log.length; }
}
