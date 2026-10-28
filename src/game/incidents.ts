import { WORLD, GAMEPLAY as G } from '../config.ts';
import { bnTaka } from '../util/bangla.ts';
import { ROUTE } from '../routes.ts';
import type { IncidentProps } from '../world/incidentProps.ts';
import type { EventProps } from '../world/eventProps.ts';
import type { Passengers } from './passengers.ts';
import type { Hud } from './hud.ts';
import type { Ledger } from './ledger.ts';
import type { ChoicePanel } from './choice.ts';
import type { RouteEvents } from './events.ts';
import { Person, VARIANTS, makeVariant } from '../world/people.ts';
import * as THREE from 'three';

type ChadaState = 'idle' | 'waving' | 'asking' | 'blocking' | 'done' | 'skipped';

/**
 * Phase 2 incidents. All generic and fictional: a roadside "chada" collector, a police
 * checkpoint, a bridge speed camera, and a person asking for alms at a stop.
 * Each one reads route distance / speed every frame and talks to the HUD, ledger and the
 * two-button choice panel. Hooks for the game loop: `wallDistance(sFront)`, `blockingPerson`.
 */
export class Incidents {
  chada: ChadaState[] = WORLD.chadaSpots.map(() => 'idle');
  chadaRefused = false;
  checkpoint: 'idle' | 'approach' | 'stopped' | 'cleared' = 'idle';
  private cpTimer = 0;
  /** latched: the bus came at the boom above the limit (so stopping at the boom still earns the fine) */
  private speeding = false;
  cameraDone = false;
  almsDone = false;
  private blockTimer = 0;
  private blockIndex = -1;
  /** world-space point the blocking chada man stands at (for the wall) */
  private blockS = Infinity;
  private almsPerson: Person | null = null;
  fines = 0;
  // ---- Phase 3 events
  toll: 'idle' | 'approach' | 'asking' | 'paid' | 'dodged' = 'idle';
  rail: 'idle' | 'closed' | 'cleared' = 'idle';
  accident: 'idle' | 'approach' | 'waiting' | 'cleared' | 'passed' = 'idle';
  accidentWait = 0;
  /** set by the game while passengers ride on the roof; the checkpoint makes them get down */
  roofLoad = false;
  onRoofCleared: (() => void) | null = null;
  props3!: EventProps;

  constructor(private props: IncidentProps, private passengers: Passengers, private hud: Hud, private ledger: Ledger, private choice: ChoicePanel, private events: RouteEvents,
    private scene: THREE.Scene, private people: { add(p: Person): void; remove(p: Person): void }) {}

  /** Hard stop ahead from incidents (chada man standing in the lane, checkpoint boom). */
  wallDistance(sFront: number): number {
    let d = Math.min(this.props.checkpointWall(sFront), this.props3 ? Math.min(this.props3.tollWall(sFront), this.props3.railWall(sFront)) : Infinity);
    if (this.blockS !== Infinity) { const b = this.blockS - sFront; if (b > -3) d = Math.min(d, Math.max(0, b)); }
    return d;
  }

  update(dt: number, s: number, kmh: number, busWorld: THREE.Vector3, yaw: number) {
    this.updateChada(dt, s, kmh, busWorld, yaw);
    this.updateCheckpoint(dt, s, kmh);
    this.updateCamera(s, kmh);
    if (this.props3) { this.updateToll(dt, s, kmh); this.updateRail(s); this.updateAccident(dt, s, kmh); }
  }

  // ---------------------------------------------------------------- toll plaza
  private updateToll(dt: number, s: number, kmh: number) {
    void dt;
    const d = WORLD.tollS - s;
    if (this.toll === 'idle' && d < 200 && d > 0) { this.toll = 'approach'; this.hud.message(`সামনে ${ROUTE.names.bridge} টোল প্লাজা — থামুন, টোল ${bnTaka(G.tollAmount)}`, true, 4000); }
    else if (this.toll === 'approach' && d < 9 && d > -2 && kmh < 1 && !this.choice.open) { this.toll = 'asking'; void this.askToll(); }
  }
  private async askToll() {
    this.props3.tollAttendant.setAction('talk');
    const pick = await this.choice.ask('টোল প্লাজা', `হেল্পার টোলের ${bnTaka(G.tollAmount)} দেবে — নাকি বুথের লোক অন্যদিকে তাকালেই টান দেবেন?`, `টোল দিন (${bnTaka(G.tollAmount)})`, 'ফাঁকি দিন', 8, 0);
    if (pick === 0) {
      this.ledger.toll += G.tollAmount; this.toll = 'paid';
      this.hud.message(`টোল ${bnTaka(G.tollAmount)} দেওয়া হলো — সেতুতে উঠুন`, true, 3000);
      this.props3.tollAttendant.setAction('wave');
      setTimeout(() => this.props3.setTollOpen(true), 900);
    } else {
      this.toll = 'dodged'; this.props3.setTollOpen(true);
      if (Math.random() < G.tollDodgeCaughtChance) {
        this.ledger.fines += G.tollDodgeFine; this.fines++; this.chadaRefused = true;
        this.hud.message(`📸 টোল ফাঁকি — ক্যামেরায় ধরা, জরিমানা ${bnTaka(G.tollDodgeFine)}!`, false, 5000);
        this.passengers.mood = Math.max(0, this.passengers.mood - 6); this.passengers.shout('wait', true);
      } else { this.hud.message('টান দিয়ে বেরিয়ে গেলেন — কেউ দেখেনি… এবারের মতো', true, 4000); this.passengers.mood = Math.max(0, this.passengers.mood - 2); }
      this.props3.tollAttendant.setAction('point');
    }
  }

  // ---------------------------------------------------------------- level crossing
  private updateRail(s: number) {
    const d = WORLD.railS - s;
    if (this.rail === 'idle' && d < 170 && d > 110) {
      this.rail = 'closed'; this.props3.closeGates(); this.props3.startTrain();
      this.hud.message('🚂 রেল ক্রসিং — গেট নামছে, ট্রেন আসছে! থামুন', false, 4500);
      this.passengers.shout('wait', true);
    } else if (this.rail === 'closed' && this.props3.trainPassed) {
      this.rail = 'cleared'; this.props3.openGates();
      this.hud.message('ট্রেন গেছে — গেট উঠছে, চলুন', true, 3000);
    }
  }

  // ---------------------------------------------------------------- accident ahead
  private updateAccident(dt: number, s: number, kmh: number) {
    const d = WORLD.accidentS - s;
    if (this.accident === 'idle' && d < 230 && d > 0) { this.accident = 'approach'; this.hud.message('সামনে দুর্ঘটনা — ট্রাক উল্টে বাম লেন বন্ধ। অপেক্ষা করুন বা সাবধানে ডান দিক দিয়ে পাশ কাটান', false, 5500); this.passengers.shout('wait', true); }
    if ((this.accident === 'approach' || this.accident === 'waiting') && d > -2 && d < 70 && kmh < 2) {
      this.accident = 'waiting'; this.accidentWait += dt;
      if (this.accidentWait > G.accidentWaitSec) { this.accident = 'cleared'; this.props3.towWreck(); this.hud.message('রেকার এসে ট্রাক সরাল — রাস্তা খুলেছে, চলুন', true, 3500); this.passengers.shout('good', true); }
    }
    if ((this.accident === 'approach' || this.accident === 'waiting') && d < -12) { this.accident = 'passed'; this.hud.message('পাশ কাটিয়ে বেরিয়ে এলেন — সাবধানে!', true, 3000); }
  }

  // ---------------------------------------------------------------- chada
  private async updateChada(dt: number, s: number, kmh: number, bus: THREE.Vector3, yaw: number) {
    WORLD.chadaSpots.forEach((cs, i) => {
      const st = this.chada[i]; const man = this.props.chadaMen[i];
      const d = cs - s;
      if (st === 'idle' && d < 120 && d > 0) { this.chada[i] = 'waving'; man.setAction('wave'); this.hud.message('সামনে একজন হাত নাড়ছে — চাঁদা চাইবে। থামবেন?', false, 4000); }
      else if (st === 'waving') {
        if (d < 25 && d > -12 && kmh < 1.5 && !this.choice.open) { this.chada[i] = 'asking'; this.askChada(i, s, bus, yaw); }
        else if (d < -15) { this.chada[i] = 'skipped'; man.setAction('point'); this.hud.message('চাঁদা না দিয়েই চলে গেলেন — সামনে ঝামেলা হতে পারে', false, 3500); if (Math.random() < 0.5) this.chadaRefused = true; }
      } else if (st === 'blocking') {
        this.blockTimer += dt;
        this.passengers.mood = Math.max(0, this.passengers.mood - 0.3 * dt);
        if (this.blockTimer > G.chadaRefuseBlockSec) { this.chada[i] = 'done'; this.blockS = Infinity; man.walkTo(man.position.clone().add(new THREE.Vector3(Math.cos(yaw) * -4, 0, -Math.sin(yaw) * -4)), 'talk'); this.hud.message('লোকটা সরে গেল — চলুন', true, 2500); }
      }
    });
  }
  private async askChada(i: number, s: number, bus: THREE.Vector3, yaw: number) {
    const man = this.props.chadaMen[i];
    // walk up to the driver's window
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    man.walkTo(bus.clone().addScaledVector(fwd, 4.2).addScaledVector(right, 2.2), 'talk');
    const pick = await this.choice.ask('“ভাই, রাস্তার চাঁদাটা দিয়ে যান”', `${bnTaka(G.chadaAmount)} চাইছে। দিলে ঝামেলা নেই, না দিলে রাস্তা আটকাবে।`, `${bnTaka(G.chadaAmount)} দিন`, 'দেব না', 12, 0);
    if (this.chada[i] !== 'asking') return;
    if (pick === 0) {
      this.ledger.chada += G.chadaAmount; this.chada[i] = 'done';
      this.hud.message(`${bnTaka(G.chadaAmount)} দিলেন — “যান ভাই, ভালো থাকেন”`, true, 3000);
      this.passengers.shout('wait', true);
      man.setAction('count'); setTimeout(() => man.walkTo(man.position.clone().addScaledVector(right, 4), 'idle'), 2500);
    } else {
      this.chada[i] = 'blocking'; this.blockTimer = 0; this.blockIndex = i; this.chadaRefused = true;
      this.passengers.mood = Math.max(0, this.passengers.mood - G.chadaRefusePenalty);
      this.hud.message('“তাহলে বাস এখান থেকে নড়বে না!” — রাস্তা আটকে দাঁড়াল', false, 4000);
      // he steps in front of the bus; the physics wall holds the bus until he gives up
      man.walkTo(bus.clone().addScaledVector(fwd, 8.5).addScaledVector(right, -0.5), 'point');
      // wall just ahead of the bus's front bumper (bus centre → front = 5.6 m), where he stands
      this.blockS = s + 5.6 + 2.6;
    }
  }

  // ---------------------------------------------------------------- checkpoint
  private updateCheckpoint(dt: number, s: number, kmh: number) {
    const d = WORLD.checkpointS - s;
    if (this.checkpoint === 'idle' && d < 150 && d > 0) {
      this.checkpoint = 'approach';
      this.hud.message(`সামনে পুলিশ চেকপোস্ট — ${G.checkpointSpeedLimitKmh} কিমি/ঘ-এর নিচে যান`, false, 4000);
      this.props.wave(0, 'signal');
    } else if (this.checkpoint === 'approach') {
      if (d < 25 && kmh > G.checkpointSpeedLimitKmh && !this.speeding) { this.speeding = true; this.hud.message('চেকপোস্টে গতি বেশি — ব্যারিয়ার নামানো থাকল!', false, 3000); }
      const mustStop = this.chadaRefused || this.speeding || this.roofLoad;
      if (d < 40 && mustStop) {
        // boom stays down → the physics wall holds the bus; fine once it has stopped
        if (d < 8 && kmh < 1) { this.checkpoint = 'stopped'; this.cpTimer = 0; if (this.roofLoad) { this.fine('ছাদে যাত্রী! সবাইকে নামিয়ে দিল', G.roofFine); this.roofLoad = false; this.onRoofCleared?.(); } else this.fine(this.speeding ? 'গতি বেশি ছিল' : 'অভিযোগ এসেছে — কাগজপত্র চেক'); }
      } else if (d < 12 && kmh <= G.checkpointSpeedLimitKmh) {
        this.props.setBoom(true); this.props.wave(0, 'megaphone'); this.checkpoint = 'cleared';
        this.hud.message('ধীরে এসেছেন — হাত নেড়ে ছেড়ে দিল ✓', true, 3000);
      } else if (d < -5) this.checkpoint = 'cleared';
    } else if (this.checkpoint === 'stopped') {
      this.cpTimer += dt;
      this.passengers.mood = Math.max(0, this.passengers.mood - 0.15 * dt);
      if (this.cpTimer > G.checkpointDelaySec) { this.checkpoint = 'cleared'; this.props.setBoom(true); this.props.wave(0, 'signal'); this.hud.message('ছাড়া পেলেন — চলুন', true, 2500); }
    }
  }
  private fine(reason: string, amount = G.checkpointFine) {
    this.ledger.fines += amount; this.fines++;
    this.props.wave(0, 'point'); this.props.wave(1, 'handover' as never);
    this.hud.message(`${reason} — জরিমানা ${bnTaka(amount)} 🧾`, false, 5000);
    this.passengers.shout('wait', true);
  }

  // ---------------------------------------------------------------- speed camera
  private updateCamera(s: number, kmh: number) {
    if (this.cameraDone) return;
    if (s > WORLD.speedCameraS - 2 && s < WORLD.speedCameraS + 30) {
      this.cameraDone = true;
      if (kmh > WORLD.speedCameraLimitKmh) {
        this.props.flash(); this.ledger.fines += G.cameraFine; this.fines++;
        this.hud.message(`📸 স্পিড ক্যামেরা: ${Math.round(kmh)} কিমি/ঘ — জরিমানা ${bnTaka(G.cameraFine)}`, false, 4500);
      } else this.hud.message('স্পিড ক্যামেরা পার — গতি ঠিক ছিল ✓', true, 2500);
    }
  }

  // ---------------------------------------------------------------- alms at a stop
  /** Called by the game when the Faridpur dwell begins: a person boards and asks politely. */
  async beginAlms(door: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3) {
    if (this.almsDone) return; this.almsDone = true;
    const v = Math.random() < 0.5
      ? makeVariant({ id: 'alms-a', outfit: 'lungi-shirt', top: '#cfc8b8', bottom: '#5a4a3a', hair: 'tupi', accent: '#e8e8e8', height: 1.62, build: 0.9 })
      : makeVariant({ id: 'alms-b', outfit: 'saree', top: '#6b3fa0', bottom: '#d8262c', accent: '#ffcc33', hair: 'bun', height: 1.66, build: 0.95 });
    const p = new Person(v); this.almsPerson = p;
    p.position.copy(door).addScaledVector(right, -3).addScaledVector(fwd, -3); p.walkSpeed = 1.0;
    this.scene.add(p.root); this.people.add(p);
    p.walkTo(door.clone().addScaledVector(right, -0.4), 'talk');
    await new Promise((r) => setTimeout(r, 2600));
    if (!p.root.parent) return;
    const isSaree = v.id === 'alms-b';
    const pick = await this.choice.ask(isSaree ? '“ভাই, দোয়া করি — দশটা টাকা দেন”' : '“আল্লাহর ওয়াস্তে কিছু দেন, বাবা”', isSaree ? 'হিজড়া সম্প্রদায়ের একজন দরজায় এসে হাত পাতলেন।' : 'একজন ভিক্ষুক দরজায় এসে হাত পাতলেন।', `${bnTaka(G.begAmount)} দিন`, 'মাফ করেন', 10, 1);
    if (pick === 0) { this.ledger.charity += G.begAmount; this.passengers.mood = Math.min(100, this.passengers.mood + 2); this.hud.message('“দোয়া করি, ভালো থাকেন” — যাত্রীরা খুশি', true, 3000); p.setAction('wave'); }
    else { this.passengers.mood = Math.max(0, this.passengers.mood - 1); this.hud.message('“আচ্ছা বাবা, ভালো থাকেন”', true, 2500); p.setAction('idle'); }
    setTimeout(() => { p.walkTo(p.position.clone().addScaledVector(right, -5).addScaledVector(fwd, -6), 'idle', () => { this.scene.remove(p.root); this.people.remove(p); }); }, 1500);
  }

  reset() {
    this.toll = 'idle'; this.rail = 'idle'; this.accident = 'idle'; this.accidentWait = 0; this.roofLoad = false; if (this.props3) { this.props3.setTollOpen(false); this.props3.openGates(); }
    this.chada = WORLD.chadaSpots.map(() => 'idle'); this.chadaRefused = false; this.checkpoint = 'idle'; this.speeding = false; this.cameraDone = false; this.almsDone = false; this.blockS = Infinity; this.fines = 0;
    this.props.setBoom(false); this.props.chadaMen.forEach((m) => m.setAction('idle'));
    if (this.almsPerson?.root.parent) { this.scene.remove(this.almsPerson.root); this.people.remove(this.almsPerson); }
    void VARIANTS; void this.blockIndex; void this.events;
  }
}
