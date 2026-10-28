import { GAMEPLAY as G } from '../config.ts';

export type ShoutKind = 'brake' | 'swerve' | 'speed' | 'offroad' | 'wait' | 'good' | 'horn' | 'blockade' | 'roof';

/** Mild, generic passenger lines. No profanity, no slurs. */
const LINES: Record<ShoutKind, string[]> = {
  brake: ['আস্তে ব্রেক দেন, আমরা মানুষ!', 'ভাই, ব্রেকটা একটু আস্তে!', 'মাথা ঠুকে গেল তো!'],
  swerve: ['রাস্তা দেইখা চালান!', 'এটা কি নৌকা নাকি বাস?', 'ধরেন ধরেন, পড়ে যাচ্ছি!'],
  speed: ['ঘুমাইছেন নাকি? আস্তে চালান!', 'এত জোরে কেন, প্লেন চালান?', 'ড্রাইভার সাহেব, একটু ধীরে!'],
  offroad: ['রাস্তা ছাইড়া মাঠে কেন?', 'এইটা রাস্তা না, ক্ষেত!', 'ও ভাই, রাস্তায় উঠেন!'],
  wait: ['আর কত দেরি? আমার অফিস আছে!', 'ভাই, আজকে পৌঁছাব তো?', 'গাড়ি চলে না কেন?'],
  good: ['ভালো চালান! এখনই পৌঁছে যাব।', 'বাহ, মসৃণ চালাচ্ছেন!', 'এই ড্রাইভারকে বকশিশ দেওয়া দরকার।'],
  horn: ['হর্ন কম দেন, কান গেল!'],
  blockade: ['সামনে অবরোধ! থামেন!', 'এখন কী হবে? ফিরে যাব নাকি?'],
  roof: ['ছাদ থেকে পড়ে যাব! আস্তে!', 'ভাই, ছাদে মানুষ আছে — ধীরে!', 'ও ড্রাইভার, উপরে আমরা উড়ে যাচ্ছি!'],
};

export interface PassengerEvent { kind: ShoutKind; text: string; }

/**
 * Passenger mood (0–100) and rate-limited speech. The game loop feeds it driving telemetry
 * each frame; it returns bubbles to display.
 */
export class Passengers {
  mood = G.moodStart;
  count = G.initialPassengers;
  shoutsTotal = 0;
  private cooldown = 0;
  private lastBrakeShout = 0;
  private lastSwerveShout = 0;
  private idleTime = 0;
  private goodTimer = 0;
  private pendingShouts: PassengerEvent[] = [];
  private stats = { hardBrakes: 0, swerves: 0, offRoadTime: 0, overspeedTime: 0 };

  get summary() { return { ...this.stats, shouts: this.shoutsTotal }; }

  private penalise(amount: number) { this.mood = Math.max(0, this.mood - amount); }
  private reward(amount: number) { this.mood = Math.min(100, this.mood + amount); }

  shout(kind: ShoutKind, force = false) {
    if (!force && this.cooldown > 0) return;
    const lines = LINES[kind];
    const text = lines[Math.floor(Math.random() * lines.length)];
    this.pendingShouts.push({ kind, text });
    this.cooldown = G.shoutCooldown;
    if (kind !== 'good') this.shoutsTotal++;
  }

  /** Call once per frame. */
  update(dt: number, t: { kmh: number; aLong: number; aLat: number; onRoad: boolean; waiting: boolean; horn: boolean; moving: boolean; time: number }): PassengerEvent[] {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let smooth = true;

    if (t.aLong < -G.hardBrakeDecel && t.kmh > 15) {
      smooth = false;
      if (t.time - this.lastBrakeShout > 2.5) { this.penalise(G.hardBrakePenalty); this.stats.hardBrakes++; this.shout('brake'); this.lastBrakeShout = t.time; }
    }
    if (Math.abs(t.aLat) > G.swerveLatAccel && t.kmh > 20) {
      smooth = false;
      if (t.time - this.lastSwerveShout > 2.5) { this.penalise(G.swervePenalty); this.stats.swerves++; this.shout('swerve'); this.lastSwerveShout = t.time; }
    }
    if (t.kmh > G.overspeedKmh) {
      smooth = false;
      this.penalise(G.overspeedPenaltyPerSec * dt); this.stats.overspeedTime += dt;
      if (Math.random() < dt * 0.25) this.shout('speed');
    }
    if (!t.onRoad && t.kmh > 5) {
      smooth = false;
      this.penalise(G.offRoadPenaltyPerSec * dt); this.stats.offRoadTime += dt;
      if (Math.random() < dt * 0.4) this.shout('offroad');
    }
    if (t.waiting) {
      this.penalise(G.blockadeWaitPenaltyPerSec * dt);
      if (Math.random() < dt * 0.12) this.shout('wait');
    } else if (!t.moving && this.count > 0) {
      this.idleTime += dt;
      if (this.idleTime > G.idleTooLongSec) { this.penalise(G.idlePenaltyPerSec * dt); if (Math.random() < dt * 0.1) this.shout('wait'); }
    } else this.idleTime = 0;
    if (t.horn && Math.random() < dt * 0.15) this.shout('horn');

    if (smooth && t.kmh > G.moodSmoothMinKmh && t.onRoad) {
      this.reward(G.moodSmoothGainPerSec * dt);
      this.goodTimer += dt;
      if (this.goodTimer > 25) { this.goodTimer = 0; this.shout('good'); }
    } else this.goodTimer = 0;

    const out = this.pendingShouts; this.pendingShouts = [];
    return out;
  }

  stars(): number {
    let s = 0;
    for (const th of G.starThresholds) if (this.mood >= th) s++;
    return Math.max(1, s);
  }
}
