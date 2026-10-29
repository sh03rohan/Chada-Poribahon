import { bn, bnTaka } from '../util/bangla.ts';
import { Career, UPGRADES, LIVERIES, BUSES, busDef, type BusId, upgradeCost, UPGRADE_MODS } from './career.ts';
import { MODS } from '../vehicle/physics.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Push the profile's upgrade levels into the physics multipliers. */
export function applyUpgradeMods(career: Career) {
  const u = career.profile.upgrades;
  MODS.brake = 1 + u.brakes * UPGRADE_MODS.brakesPerLevel;
  MODS.torque = 1 + u.engine * UPGRADE_MODS.torquePerLevel;
  MODS.grip = 1 + u.tyres * UPGRADE_MODS.gripPerLevel;
}

/**
 * Garage panel: spend the career balance on upgrades and paint. `onApply` is called after any
 * purchase so the game can re-apply mods, repaint the bus and refresh the landing chip.
 */
export function buildGaragePanel(career: Career, onApply: () => void, onClose: () => void, onBusChange: () => void = () => location.reload()): HTMLElement {
  const el = $('garage');
  const render = () => {
    const p = career.profile;
    const cards = UPGRADES.map((d) => {
      const lvl = p.upgrades[d.id], cost = upgradeCost(d, lvl), max = cost === null;
      const dots = d.costs.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="gcard"><div class="gico">${d.icon}</div><div class="gbody"><b>${d.name}</b> <span class="gdots">${dots}</span><small>${d.desc}</small><em>${d.effect(lvl)}</em></div>
        <button class="gbuy" data-up="${d.id}" ${max || !career.canAfford(cost) ? 'disabled' : ''}>${max ? 'সর্বোচ্চ' : bnTaka(cost)}</button></div>`;
    }).join('');
    const paints = LIVERIES.map((s) => {
      const owned = p.liveriesOwned.includes(s.id), on = p.livery === s.id;
      return `<button class="swatch ${on ? 'on' : ''}" data-livery="${s.id}" style="--c:${s.main};--d:${s.dark}" ${!owned && !career.canAfford(s.cost) ? 'disabled' : ''} title="${s.name}"><span></span><small>${s.name}${owned ? '' : ' · ' + bnTaka(s.cost)}</small></button>`;
    }).join('');
    const buses = BUSES.map((b) => {
      const owned = p.busesOwned.includes(b.id), on = p.bus === b.id;
      return `<div class="gcard bus ${on ? 'on' : ''}"><div class="gico">${b.icon}</div><div class="gbody"><b>${b.name}</b>${on ? ' <span class="gon">চালাচ্ছেন</span>' : ''}<small>${b.desc}</small><em>${bn(b.seats)} সিট · ওজন ${bn(Math.round(b.massScale * 100))}% · গতি সীমা ${b.capKmh === Infinity ? 'নেই' : bn(b.capKmh) + ' কিমি/ঘ'}</em></div>
        <button class="gbus" data-bus="${b.id}" ${on || (!owned && !career.canAfford(b.cost)) ? 'disabled' : ''}>${on ? '✓' : owned ? 'চালান' : bnTaka(b.cost)}</button></div>`;
    }).join('');
    el.innerHTML = `<div class="panel garage-panel">
      <h2>🔧 গ্যারেজ</h2>
      <div class="gbal">ব্যালেন্স <b>${bnTaka(p.balance)}</b> · লেভেল ${bn(career.level)} ${career.title}</div>
      <div class="gcards">${cards}</div>
      <div class="gpaint"><b>রং / লিভারি</b><div class="swatches">${paints}</div></div>
      <div class="gbuses"><b>বাস</b><small class="hint">বাস বদলালে গেম আবার লোড হবে</small><div class="gcards">${buses}</div></div>
      <div class="row"><button id="garage-close" class="btn-primary">ঠিক আছে</button></div>
    </div>`;
    el.querySelectorAll<HTMLButtonElement>('.gbuy').forEach((b) => b.onclick = () => {
      const def = UPGRADES.find((d) => d.id === b.dataset.up)!;
      const cost = upgradeCost(def, p.upgrades[def.id]);
      if (cost === null || !career.spend(cost)) return;
      p.upgrades[def.id]++; career.save(); applyUpgradeMods(career); onApply(); render();
    });
    el.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) => b.onclick = () => {
      const s = LIVERIES[+b.dataset.livery!];
      if (!p.liveriesOwned.includes(s.id)) { if (!career.spend(s.cost)) return; p.liveriesOwned.push(s.id); }
      p.livery = s.id; career.save(); onApply(); render();
    });
    el.querySelectorAll<HTMLButtonElement>('.gbus').forEach((b) => b.onclick = () => {
      const def = busDef(b.dataset.bus as BusId);
      if (!p.busesOwned.includes(def.id)) { if (!career.spend(def.cost)) return; p.busesOwned.push(def.id); }
      p.bus = def.id; career.save(); onBusChange();
    });
    el.querySelector<HTMLButtonElement>('#garage-close')!.onclick = () => { el.classList.add('hidden'); onClose(); };
  };
  render();
  (el as HTMLElement & { refresh?: () => void }).refresh = render;
  return el;
}
