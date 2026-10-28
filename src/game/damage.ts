import * as THREE from 'three';
import { GAMEPLAY as G } from '../config.ts';
import { bn, bnTaka } from '../util/bangla.ts';
import { MODS } from '../vehicle/physics.ts';
import type { BusRig } from '../vehicle/busModel.ts';
import type { Hud } from './hud.ts';
import type { Passengers } from './passengers.ts';

/**
 * Bus damage 0..100. Every crash adds damage scaled by the impact speed. Thresholds:
 *  ≥30 % left headlight dead, ≥50 % bent bumper + weaker brakes and engine + speed cap,
 *  ≥75 % engine smoke, passengers scared, hard cap, ≥100 % limp mode (20 km/h).
 * Repair is charged at Dhaka (ledger.repair) and the bus is fixed for the next run.
 */
export class Damage {
  value = 0;
  private warned = new Set<number>();
  private smokeT = 0;

  constructor(private bus: BusRig, private hud: Hud, private passengers: Passengers) {}

  get level() { return Math.min(1, this.value / 100); }
  get repairCost() { return Math.round(this.value * G.repairCostPerPercent); }

  /** impact in m/s (closing speed removed by the collision) */
  hit(impact: number, kind: 'traffic' | 'object') {
    const add = Math.min(40, Math.max(2, (impact - 1.2) * G.damagePerImpactMs)) * (kind === 'traffic' ? 1 : 0.8);
    this.value = Math.min(100, this.value + add);
    this.apply();
    for (const th of [30, 50, 75, 100]) {
      if (this.value >= th && !this.warned.has(th)) {
        this.warned.add(th);
        const msg = th === 30 ? 'বাঁ হেডলাইট ভেঙে গেছে' : th === 50 ? 'বাম্পার বাঁকা, ব্রেক দুর্বল — গতি কমান' : th === 75 ? 'ইঞ্জিন থেকে ধোঁয়া! বাস আর টানছে না' : 'বাস প্রায় শেষ — ২০ কিমি/ঘ-এ টেনে ঢাকা নিন';
        setTimeout(() => this.hud.message(`🔧 ক্ষতি ${bn(Math.round(this.value))}% — ${msg}`, false, 4500), 1800);
      }
    }
  }

  /** Push the current damage into the physics multipliers and the bus visuals. */
  apply() {
    const v = this.value;
    MODS.dmgBrake = v >= 100 ? 0.55 : v >= 75 ? 0.7 : v >= 50 ? 0.85 : 1;
    MODS.dmgTorque = v >= 100 ? 0.4 : v >= 75 ? 0.65 : v >= 50 ? 0.85 : 1;
    MODS.speedCapKmh = v >= 100 ? 20 : v >= 75 ? 55 : v >= 50 ? 85 : Infinity;
    this.bus.setDamage?.(this.level);
  }

  /** per frame: smoke puffs + fear */
  update(dt: number, kmh: number) {
    if (this.value >= 75) {
      this.passengers.mood = Math.max(0, this.passengers.mood - G.damageFearPerSec * dt);
      this.smokeT += dt;
      const sm = this.bus.smoke ?? [];
      sm.forEach((sp, i) => {
        const ph = ((this.smokeT * 0.9 + i / sm.length) % 1);
        const m = sp.material as THREE.SpriteMaterial;
        m.opacity = (1 - ph) * 0.75; sp.scale.setScalar(0.6 + ph * 3.0);
        sp.position.set(-0.8 + Math.sin(ph * 6 + i) * 0.3, 0.6 + ph * 2.6, (sp.userData.z0 ??= sp.position.z) + ph * (1.5 + kmh * 0.05));
      });
    } else for (const sp of this.bus.smoke ?? []) (sp.material as THREE.SpriteMaterial).opacity = 0;
  }

  /** HUD text for the damage pill */
  label() { return `${bn(Math.round(this.value))}%`; }
  repairText() { return this.value > 0 ? `মেরামত ${bnTaka(this.repairCost)} (ক্ষতি ${bn(Math.round(this.value))}%)` : ''; }

  reset() { this.value = 0; this.warned.clear(); this.apply(); for (const sp of this.bus.smoke ?? []) (sp.material as THREE.SpriteMaterial).opacity = 0; }
}
