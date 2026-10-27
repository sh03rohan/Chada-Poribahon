import { WORLD, GAMEPLAY as G } from '../config.ts';
import { bn, bnTaka } from '../util/bangla.ts';
import type { Blockade } from '../world/blockade.ts';
import type { Passengers } from './passengers.ts';
import type { Hud } from './hud.ts';
import type { BusRig } from '../vehicle/busModel.ts';

export type RoutePhase = 'driving' | 'rajbari-stop' | 'blockade' | 'finished';

/**
 * Route event state machine: Rajbari stop zone, the andolon blockade, and the Dhaka finish.
 * Pure game logic — reads route distance s and speed, pokes HUD/passengers/bus door.
 * Extension point: add more stops/events by appending to `update()`.
 */
export class RouteEvents {
  phase: RoutePhase = 'driving';
  stoppedAtRajbari = false;
  missedRajbari = false;
  income = 0;
  private dwell = 0;
  private hitBlockade = false;
  private blockadeStopped = false;
  private warnedZone = false;
  finishedAt: number | null = null;
  wrongBranch = false; wrongBranchCount = 0; private branchTimer = 0;

  constructor(private blockade: Blockade, private passengers: Passengers, private hud: Hud, private bus: BusRig) {}

  /** Returns wall distance for the physics step (Infinity if the road is clear). */
  wallDistance(sFront: number): number {
    return this.blockade.wallDistanceFrom(sFront);
  }

  get waitingAtBlockade(): boolean { return this.phase === 'blockade' && this.blockade.active; }

  /** Wrong-turn branch bookkeeping (called every frame with the fork locator result). */
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
    const stopS0 = WORLD.rajbariStopS - WORLD.stopZoneLength / 2, stopS1 = WORLD.rajbariStopS + WORLD.stopZoneLength / 2;
    const inZone = s > stopS0 - 2 && s < stopS1 + 2;

    if (this.phase === 'driving') {
      if (!this.stoppedAtRajbari && !this.missedRajbari) {
        if (!this.warnedZone && s > stopS0 - 220) { this.warnedZone = true; this.hud.message('সামনে রাজবাড়ী — হলুদ জোনে থামুন', true, 3500); }
        if (inZone && kmh < 1) { this.phase = 'rajbari-stop'; this.dwell = 0; this.hud.message('রাজবাড়ী বাস স্ট্যান্ড — যাত্রী নামছে/উঠছে', true, G.stopDwellTime * 1000); }
        else if (s > stopS1 + 2) { this.missedRajbari = true; this.passengers.mood = Math.max(0, this.passengers.mood - G.missedStopPenalty); this.hud.message('রাজবাড়ী স্টপ মিস করলেন! যাত্রীরা রেগে গেছে'); this.passengers.shout('wait', true); }
      }
      // Blockade
      if (this.blockade.active && s > WORLD.andolonS - 260 && s < WORLD.andolonS && !this.hitBlockade) {
        this.hitBlockade = true;
        this.hud.message('সামনে অবরোধ! রাস্তা বন্ধ — থামুন', false, 4000);
        this.passengers.shout('blockade', true);
      }
      if (this.blockade.active && this.wallDistance(s + 5.6) <= 0.5) {
        // bus is pressed against the barrier
        if (!this.blockadeStopped) {
          this.blockadeStopped = true;
          if (kmh > 8) { this.passengers.mood = Math.max(0, this.passengers.mood - G.blockadeHitPenalty); this.hud.message('অবরোধে ধাক্কা! যাত্রীরা ভয় পেয়েছে'); }
          else this.hud.message('অবরোধ — অপেক্ষা করুন, পুলিশ আসছে…', false, 5000);
          this.blockade.startWaiting();
          this.phase = 'blockade';
        }
      }
      if (s >= WORLD.finishS && this.phase === 'driving') {
        this.phase = 'finished'; this.finishedAt = elapsed;
        this.income = this.passengers.count * G.fareKushtiaDhaka; // base fare for everyone aboard at the end
        if (this.stoppedAtRajbari) this.income += 0; // Rajbari pickups already paid at the stop
      }
    } else if (this.phase === 'rajbari-stop') {
      this.dwell += dt;
      const k = Math.min(1, this.dwell / 1.2);
      this.bus.setDoor(this.dwell < G.stopDwellTime - 1 ? k : Math.max(0, (G.stopDwellTime - this.dwell)));
      if (this.dwell > 2 && !this.stoppedAtRajbari) {
        this.stoppedAtRajbari = true;
        this.passengers.count = Math.max(0, this.passengers.count - G.rajbariGetOff) + G.rajbariGetOn;
        this.passengers.count = Math.min(G.seats, this.passengers.count);
        this.income += G.rajbariGetOn * G.fareRajbariDhaka;
        this.passengers.mood = Math.min(100, this.passengers.mood + 6);
        this.bus.setPassengers(this.passengers.count);
      }
      if (this.dwell >= G.stopDwellTime) { this.bus.setDoor(0); this.phase = 'driving'; this.hud.message(`${bn(G.rajbariGetOn)} জন উঠলেন, ভাড়া ${bnTaka(G.rajbariGetOn * G.fareRajbariDhaka)} — চলুন ঢাকা!`, true); }
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
