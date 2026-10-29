/** Money in and out during a run; shown in the HUD and the results card. */
export class Ledger {
  fares = 0; fines = 0; chada = 0; fuel = 0; tips = 0; charity = 0; repair = 0; toll = 0;
  /** story mode: owner's bonus (+) or deductions (−) — instalment, inspector report */
  owner = 0;
  get net() { return this.fares + this.tips - this.fines - this.chada - this.fuel - this.charity - this.repair - this.toll + this.owner; }
  reset() { this.fares = this.fines = this.chada = this.fuel = this.tips = this.charity = this.repair = this.toll = this.owner = 0; }
}
