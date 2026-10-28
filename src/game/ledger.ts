/** Money in and out during a run; shown in the HUD and the results card. */
export class Ledger {
  fares = 0; fines = 0; chada = 0; fuel = 0; tips = 0; charity = 0; repair = 0;
  get net() { return this.fares + this.tips - this.fines - this.chada - this.fuel - this.charity - this.repair; }
  reset() { this.fares = this.fines = this.chada = this.fuel = this.tips = this.charity = this.repair = 0; }
}
