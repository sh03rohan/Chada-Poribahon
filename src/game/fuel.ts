import { WORLD, GAMEPLAY as G, PHYSICS } from '../config.ts';
import { bn, bnTaka } from '../util/bangla.ts';
import type { Hud } from './hud.ts';
import type { Ledger } from './ledger.ts';
import type { ChoicePanel } from './choice.ts';
import type { Passengers } from './passengers.ts';

/**
 * Diesel tank. Burn rate scales with throttle × rpm (plus idle). A pump lay-by at WORLD.pumpS
 * offers a refuel prompt when the bus stops beside it; an empty tank cuts the engine until a
 * (costly, slow) roadside rescue.
 */
export class Fuel {
  litres = G.fuelTankLitres;
  state: 'ok' | 'empty' | 'rescue' = 'ok';
  private rescueT = 0;
  private warned = { quarter: false, empty: false };
  private pumpOffered = false;
  private pumpTimer = 0;
  refuels = 0;

  constructor(private hud: Hud, private ledger: Ledger, private choice: ChoicePanel, private passengers: Passengers) {}

  get fraction() { return Math.max(0, this.litres / G.fuelTankLitres); }
  /** 0..1 multiplier on engine force */
  get engineFactor() { return this.state === 'ok' ? 1 : 0; }

  /** Per physics step. */
  burn(dt: number, throttle: number, rpm: number) {
    if (this.state !== 'ok') return;
    const load = throttle * (rpm / PHYSICS.redlineRpm);
    this.litres -= (G.fuelIdlePerSec + G.fuelBurnPerSec * load) * dt;
    if (this.litres <= 0) { this.litres = 0; this.state = 'empty'; }
  }

  /** Per frame. */
  async update(dt: number, s: number, kmh: number, lateral: number, stopped: boolean) {
    if (!this.warned.quarter && this.fraction < 0.25) { this.warned.quarter = true; this.hud.message(`⛽ তেল কম — ${bn(Math.round(this.fraction * 100))}%। সামনে পাম্পে থামুন`, false, 4500); }
    if (this.state === 'empty' && !this.warned.empty) {
      this.warned.empty = true;
      this.hud.message('তেল শেষ! বাস থেমে গেছে…', false, 4000);
      this.passengers.shout('wait', true);
      const pick = await this.choice.ask('তেল শেষ — কী করবেন?', `পাশের দোকান থেকে জেরিক্যানে তেল আনাতে ${bnTaka(G.emptyTankRescueCost)} আর ${bn(G.emptyTankRescueSec)} সেকেন্ড লাগবে।`, `তেল আনান (${bnTaka(G.emptyTankRescueCost)})`, 'অপেক্ষা করুন', 20, 0);
      void pick; this.state = 'rescue'; this.rescueT = 0; this.ledger.fuel += G.emptyTankRescueCost;
    }
    if (this.state === 'rescue') {
      this.rescueT += dt; this.passengers.mood = Math.max(0, this.passengers.mood - 0.2 * dt);
      if (this.rescueT > G.emptyTankRescueSec) { this.state = 'ok'; this.litres = G.emptyTankRescueLitres; this.warned.empty = false; this.hud.message(`${bn(G.emptyTankRescueLitres)} লিটার এলো — চলুন`, true, 2500); }
    }
    // pump: stopped in the lay-by beside the pump (left of the shoulder)
    const nearPump = Math.abs(s - WORLD.pumpS) < 18 && lateral < -(WORLD.roadWidth / 2 - 0.5);
    if (nearPump && stopped && !this.pumpOffered && !this.choice.open && this.state === 'ok') {
      this.pumpTimer += dt;
      if (this.pumpTimer > 0.8) {
        this.pumpOffered = true;
        const need = Math.min(G.fuelPumpLitres, G.fuelTankLitres - this.litres);
        const cost = Math.round(need * G.fuelPricePerLitre);
        const pick = await this.choice.ask('⛽ ফিলিং স্টেশন', `ট্যাঙ্কে ${bn(Math.round(this.fraction * 100))}% আছে। ${bn(Math.round(need))} লিটার ডিজেল ${bnTaka(cost)} — ঢাকা পর্যন্ত নিশ্চিন্তে যাওয়া যাবে।`, `${bn(Math.round(need))} লিটার (${bnTaka(cost)})`, 'লাগবে না', 15, 1);
        if (pick === 0) { this.litres += need; this.ledger.fuel += cost; this.refuels++; this.hud.message(`${bn(Math.round(need))} লিটার ভরা হলো — ${bnTaka(cost)}`, true, 3000); }
        setTimeout(() => { this.pumpOffered = false; }, 30000);
      }
    } else if (!nearPump) this.pumpTimer = 0;
    if (Math.abs(s - WORLD.pumpS) < 200 && s < WORLD.pumpS && !this.pumpOffered && this.fraction < 0.6) this.hud.setHint('⛽ সামনে বামে পাম্প — তেল ভরতে পাম্পের পাশে থামুন');
  }

  reset() { this.litres = G.fuelTankLitres; this.state = 'ok'; this.warned = { quarter: false, empty: false }; this.pumpOffered = false; this.refuels = 0; }
}
