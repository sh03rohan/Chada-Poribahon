import { WORLD, GAMEPLAY as G } from '../config.ts';
import { bn, bnTaka } from '../util/bangla.ts';
import type { Blockade } from '../world/blockade.ts';
import type { Passengers } from './passengers.ts';
import type { Hud } from './hud.ts';
import type { BusRig } from '../vehicle/busModel.ts';
import type { Ledger } from './ledger.ts';

export type RoutePhase = 'driving' | 'stop' | 'blockade' | 'finished';

export interface StopState { done: boolean; missed: boolean; boarded: number; alighted: number; }

/**
 * Route event state machine: passenger stops (all towns), the andolon blockade, the wrong-turn
 * branch, and the Dhaka finish. Incidents (chada, checkpoint, camera, alms, fuel) live in
 * game/incidents.ts and game/fuel.ts and only read `phase` from here.
 */
export class RouteEvents {
  phase: RoutePhase = 'driving';
  readonly stops: StopState[] = WORLD.stops.map(() => ({ done: false, missed: false, boarded: 0, alighted: 0 }));
  /** index of the stop being served while phase === 'stop' */
  currentStop = -1;
  /** multiplier on waiting passengers (morning rush etc.), set by the game from the clock */
  waitingMultiplier = 1;
  private dwell = 0;
  private hitBlockade = false;
  private blockadeStopped = false;
  private warned = new Set<number>();
  finishedAt: number | null = null;
  wrongBranch = false; wrongBranchCount = 0; private branchTimer = 0;
  /** stop-dwell callbacks for the game (boarding animation, alms visitor) */
  onStopBegin: ((i: number) => void) | null = null;
  onStopEnd: ((i: number) => void) | null = null;

  constructor(private blockade: Blockade, private passengers: Passengers, private hud: Hud, private bus: BusRig, readonly ledger: Ledger) {}

  // --- compatibility accessors (minimap / tests) ---
  get stoppedAtRajbari() { return this.stops[0].done; }
  get missedRajbari() { return this.stops[0].missed; }
  get stopsDone() { return this.stops.filter((s) => s.done).length; }
  get income() { return this.ledger.net; }

  /** Next stop that is still ahead and not served/missed, or -1. */
  nextStop(s: number): number {
    for (let i = 0; i < WORLD.stops.length; i++) { const st = this.stops[i]; if (!st.done && !st.missed && s < WORLD.stops[i].s + WORLD.stopZoneLength / 2 + 2) return i; }
    return -1;
  }

  wallDistance(sFront: number): number { return this.blockade.wallDistanceFrom(sFront); }
  get waitingAtBlockade(): boolean { return this.phase === 'blockade' && this.blockade.active; }

  updateBranch(dt: number, onBranch: boolean, branchS: number) {
    if (onBranch && !this.wrongBranch && branchS > 45) {
      this.wrongBranch = true; this.wrongBranchCount++;
      this.passengers.mood = Math.max(0, this.passengers.mood - G.wrongBranchEnterPenalty);
      this.hud.message('রাস্তা ভুল! এটা ফেরি ঘাটের রাস্তা — ঘুরে পদ্মা সেতুর পথে ফিরুন', false, 5000);
      this.passengers.shout('wait', true);
    } else if (!onBranch && this.wrongBranch) {
      this.wrongBranch = false; this.branchTimer = 0;
      this.hud.message('ঠিক রাস্তায় ফিরেছেন — ঢাকা ➜ পদ্মা সেতু', true, 3500);
    }
    if (this.wrongBranch) {
      this.branchTimer += dt;
      this.passengers.mood = Math.max(0, this.passengers.mood - G.wrongBranchPenaltyPerSec * dt);
      if (this.branchTimer > 12 && Math.random() < dt * 0.1) this.passengers.shout('wait');
    }
  }

  update(dt: number, s: number, kmh: number, elapsed: number) {
    if (this.phase === 'driving') {
      // ---- stops ----
      const i = this.nextStop(s);
      if (i >= 0) {
        const cfg = WORLD.stops[i];
        const s0 = cfg.s - WORLD.stopZoneLength / 2, s1 = cfg.s + WORLD.stopZoneLength / 2;
        if (!this.warned.has(i) && s > s0 - 220) { this.warned.add(i); this.hud.message(`সামনে ${cfg.name} — হলুদ জোনে থামুন`, true, 3500); }
        const inZone = s > s0 - 2 && s < s1 + 2;
        if (inZone && kmh < 1) {
          this.phase = 'stop'; this.currentStop = i; this.dwell = 0;
          this.hud.message(`${cfg.name} বাস স্ট্যান্ড — যাত্রী নামছে/উঠছে`, true, G.stopDwellTime * 1000);
          this.onStopBegin?.(i);
        } else if (s > s1 + 2) {
          this.stops[i].missed = true;
          this.passengers.mood = Math.max(0, this.passengers.mood - G.missedStopPenalty);
          this.hud.message(`${cfg.name} স্টপ মিস করলেন! যাত্রীরা রেগে গেছে`);
          this.passengers.shout('wait', true);
        }
      }
      // ---- blockade ----
      if (this.blockade.active && s > WORLD.andolonS - 260 && s < WORLD.andolonS && !this.hitBlockade) {
        this.hitBlockade = true;
        this.hud.message('সামনে অবরোধ! রাস্তা বন্ধ — থামুন', false, 4000);
        this.passengers.shout('blockade', true);
      }
      if (this.blockade.active && (this.wallDistance(s + 5.6) <= 0.5 || (s > WORLD.andolonS - 60 && s < WORLD.andolonS && kmh < 0.8))) {
        if (!this.blockadeStopped) {
          this.blockadeStopped = true;
          if (kmh > 8) { this.passengers.mood = Math.max(0, this.passengers.mood - G.blockadeHitPenalty); this.hud.message('অবরোধে ধাক্কা! যাত্রীরা ভয় পেয়েছে'); }
          else this.hud.message('অবরোধ — অপেক্ষা করুন, পুলিশ আসছে…', false, 5000);
          this.blockade.startWaiting();
          this.phase = 'blockade';
        }
      }
      if (s >= WORLD.finishS) { this.phase = 'finished'; this.finishedAt = elapsed; }
    } else if (this.phase === 'stop') {
      const i = this.currentStop, cfg = WORLD.stops[i], st = this.stops[i];
      this.dwell += dt;
      const k = Math.min(1, this.dwell / 1.2);
      this.bus.setDoor(this.dwell < G.stopDwellTime - 1 ? k : Math.max(0, G.stopDwellTime - this.dwell));
      if (this.dwell > 2 && !st.done) {
        st.done = true;
        st.alighted = Math.min(this.passengers.count, cfg.getOff);
        this.passengers.count -= st.alighted;
        const want = Math.round(cfg.waiting * this.waitingMultiplier);
        st.boarded = Math.max(0, Math.min(want, G.seats - this.passengers.count));
        this.passengers.count += st.boarded;
        this.ledger.fares += st.boarded * cfg.fare;
        this.passengers.mood = Math.min(100, this.passengers.mood + 5);
        this.bus.setPassengers(this.passengers.count);
      }
      if (this.dwell >= G.stopDwellTime) {
        this.bus.setDoor(0); this.phase = 'driving'; this.onStopEnd?.(i);
        this.hud.message(st.boarded > 0 ? `${bn(st.boarded)} জন উঠলেন, ভাড়া ${bnTaka(st.boarded * cfg.fare)} — চলুন!` : `${bn(st.alighted)} জন নামলেন — চলুন!`, true);
        this.currentStop = -1;
      }
    } else if (this.phase === 'blockade') {
      if (!this.blockade.active) {
        this.phase = 'driving';
        this.hud.message('রাস্তা খুলেছে — এগিয়ে যান!', true, 4000);
        this.passengers.shout('good', true);
      } else if (this.blockade.phase === 'police' && this.blockade.timer < 0.1) {
        this.hud.message('পুলিশের গাড়ি এসেছে…', true, 3000);
      }
    }
  }
}
