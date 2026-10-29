import * as THREE from 'three';
import type { Road } from './road.ts';
import { Person, PeopleManager, VARIANTS, HAWKER_VARIANT, makeVariant } from './people.ts';
import { WORLD } from '../config.ts';


/**
 * Time-of-day street life: scenes that only exist in their hour band —
 *  school  07:00–09:30  children in uniform at every bus stand
 *  haat    11:00–14:00  market stalls and shoppers at the hawker spots
 *  cricket 16:00–18:30  a pitch in a field with a batsman, bowler and fielders
 *  tea     19:00–23:30  lit tea stalls with people on the bench
 * People are added to the manager only while their scene is on.
 */
export type Band = 'school' | 'haat' | 'cricket' | 'tea';
interface Scene { band: Band; group: THREE.Group; people: Person[]; lamps: THREE.MeshStandardMaterial[]; }

export function bandsFor(hour: number): Band[] {
  const b: Band[] = [];
  if (hour >= 7 && hour < 9.5) b.push('school');
  if (hour >= 11 && hour < 14) b.push('haat');
  if (hour >= 16 && hour < 18.5) b.push('cricket');
  if (hour >= 19 && hour < 23.5) b.push('tea');
  return b;
}

export class StreetLife {
  readonly group = new THREE.Group();
  readonly scenes: Scene[] = [];
  active: Band[] = [];
  constructor(private road: Road, private people: PeopleManager, stopsS: number[], hawkerSpots: number[]) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
    const cloth = [0xd8262c, 0x1f6fb5, 0xf2a900, 0x1f9d55].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    const tin = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.55, metalness: 0.6 });
    const kerb = WORLD.roadWidth / 2 + WORLD.shoulderWidth;
    const at = (s: number, lat: number) => { const f = road.sample(s); return { x: f.x + f.rx * lat, z: f.z + f.rz * lat, y: road.footpathHeight(s), yaw: Math.atan2(-f.tx, -f.tz), f }; };
    // ---- school: 5 children per stand, chatting by the shed
    const school: Scene = { band: 'school', group: new THREE.Group(), people: [], lamps: [] };
    stopsS.forEach((s, k) => { for (let i = 0; i < 5; i++) {
      const v = makeVariant({ id: `kid${k}${i}`, outfit: 'school', top: '#ffffff', bottom: i % 2 ? '#1b2a4a' : '#5a1f2a', hair: i % 2 ? 'orna' : 'short', accent: '#1b2a4a', height: 1.3 + (i % 3) * 0.06, build: 0.8, prop: i % 2 ? 'bag' : 'none' });
      const p = new Person(v); const q = at(s - 9 + i * 1.1, -(kerb + 1.6 + (i % 2) * 0.8)); p.position.set(q.x, q.y, q.z); p.lookAt(q.f.x, q.f.z); p.setAction(i % 3 === 0 ? 'talk' : i % 3 === 1 ? 'idle' : 'point');
      school.group.add(p.root); school.people.push(p);
    } });
    // ---- haat: three stalls + shoppers at the first three hawker spots
    const haat: Scene = { band: 'haat', group: new THREE.Group(), people: [], lamps: [] };
    hawkerSpots.slice(0, 3).forEach((s, k) => {
      const side = k % 2 ? -1 : 1;
      for (let i = 0; i < 3; i++) {
        const q = at(s + (i - 1) * 3.2, side * (kerb + 2.6));
        const g = new THREE.Group(); g.position.set(q.x, q.y, q.z); g.rotation.y = q.yaw;
        const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.0), wood); top.position.y = 0.8; g.add(top);
        for (const [x, z] of [[-1.1, -0.4], [1.1, -0.4], [-1.1, 0.4], [1.1, 0.4]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), wood); leg.position.set(x, 0.4, z); g.add(leg); }
        const c = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.15), cloth[(k + i) % 4]); c.position.y = 0.55; g.add(c);
        for (let b = 0; b < 4; b++) { const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.22, 10), cloth[(b + i) % 4]); basket.position.set(-0.9 + b * 0.6, 0.95, 0); g.add(basket); }
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 1.6), cloth[(k + i + 2) % 4]); canopy.position.set(0, 2.1, 0.2); canopy.rotation.x = 0.12; g.add(canopy);
        for (const x of [-1.3, 1.3]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6), wood); pole.position.set(x, 1.05, 0.9); g.add(pole); }
        g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        haat.group.add(g);
        const seller = new Person(i % 2 ? HAWKER_VARIANT : VARIANTS[(k * 3 + i) % VARIANTS.length]); const sq = at(s + (i - 1) * 3.2, side * (kerb + 3.5)); seller.position.set(sq.x, sq.y, sq.z); seller.lookAt(sq.f.x, sq.f.z); seller.setAction('hawk'); haat.group.add(seller.root); haat.people.push(seller);
        const buyer = new Person(VARIANTS[(k * 5 + i * 2 + 1) % VARIANTS.length]); const bq = at(s + (i - 1) * 3.2 + 0.7, side * (kerb + 1.5)); buyer.position.set(bq.x, bq.y, bq.z); buyer.lookAt(sq.x, sq.z); buyer.setAction(i === 1 ? 'point' : 'talk'); haat.group.add(buyer.root); haat.people.push(buyer);
      }
    });
    // ---- cricket: a pitch in the field on the right between the first two stands
    const cricket: Scene = { band: 'cricket', group: new THREE.Group(), people: [], lamps: [] };
    { const s = Math.round((stopsS[0] + (stopsS[1] ?? stopsS[0] + 800)) / 2); const q = at(s, 17);
      const g = new THREE.Group(); g.position.set(q.x, 0.02, q.z); g.rotation.y = q.yaw;
      const pitch = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9b78a, roughness: 1 })); g.add(pitch);
      for (const z of [-10, 10]) for (const x of [-0.12, 0, 0.12]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5), wood); st.position.set(x, 0.35, z); g.add(st); }
      cricket.group.add(g);
      const place = (dx: number, dz: number, action: Parameters<Person['setAction']>[0], i: number) => { const p = new Person(VARIANTS[(i * 3 + 4) % VARIANTS.length]); const w = new THREE.Vector3(dx, 0, dz).applyAxisAngle(new THREE.Vector3(0, 1, 0), q.yaw); p.position.set(q.x + w.x, 0, q.z + w.z); p.lookAt(q.x, q.z); p.setAction(action); cricket.group.add(p.root); cricket.people.push(p); };
      place(0.6, 10.5, 'idle', 0); place(0, -11.5, 'point', 1); place(8, -4, 'wave', 2); place(-9, 2, 'idle', 3); place(12, 6, 'talk', 4); place(-7, -9, 'idle', 5); place(3, 14, 'idle', 6);
    }
    // ---- tea stalls: at the hawker spots, a lit hut with a bench
    const tea: Scene = { band: 'tea', group: new THREE.Group(), people: [], lamps: [] };
    hawkerSpots.slice(0, 4).forEach((s, k) => {
      const side = k % 2 ? 1 : -1; const q = at(s + 6, side * (kerb + 3.0));
      const g = new THREE.Group(); g.position.set(q.x, q.y, q.z); g.rotation.y = q.yaw + (side > 0 ? Math.PI : 0);
      const hut = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.3, 2.0), new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.9 })); hut.position.set(0, 1.15, -1.2); g.add(hut);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 3.6), tin); roof.position.set(0, 2.4, -0.3); roof.rotation.x = 0.1; g.add(roof);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.9, 0.5), wood); counter.position.set(0, 0.45, 0.05); g.add(counter);
      const kettle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), tin); kettle.position.set(-0.8, 1.05, 0.05); g.add(kettle);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, 0.35), wood); bench.position.set(0, 0.45, 1.3); g.add(bench);
      for (const x of [-1.2, 1.2]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.3), wood); l.position.set(x, 0.22, 1.3); g.add(l); }
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc860, emissiveIntensity: 0 }); tea.lamps.push(lampMat);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lampMat); bulb.position.set(0, 2.05, 0.4); g.add(bulb);
      const glow = new THREE.PointLight(0xffc860, 0, 9, 1.5); glow.position.set(0, 2.0, 0.6); g.add(glow); (glow as unknown as { lampMat: THREE.MeshStandardMaterial }).lampMat = lampMat;
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      tea.group.add(g);
      const seller = new Person(HAWKER_VARIANT); const w0 = new THREE.Vector3(0, 0, -0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y); seller.position.set(q.x + w0.x, q.y, q.z + w0.z); seller.root.rotation.y = g.rotation.y; seller.setAction('hawk'); tea.group.add(seller.root); tea.people.push(seller);
      for (let i = 0; i < 3; i++) { const p = new Person(VARIANTS[(k * 4 + i * 3 + 2) % VARIANTS.length]); const w = new THREE.Vector3(-0.9 + i * 0.9, 0, 1.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y); p.position.set(q.x + w.x, q.y, q.z + w.z); p.root.rotation.y = g.rotation.y + Math.PI; p.setAction(i === 1 ? 'talk' : 'sit'); tea.group.add(p.root); tea.people.push(p); }
    });
    for (const sc of [school, haat, cricket, tea]) { sc.group.visible = false; this.group.add(sc.group); this.scenes.push(sc); }
  }
  /** Switch scenes to the hour band(s); people join/leave the manager with their scene. */
  apply(hour: number) {
    const bands = bandsFor(hour);
    for (const sc of this.scenes) {
      const on = bands.includes(sc.band);
      if (on === sc.group.visible) continue;
      sc.group.visible = on;
      for (const p of sc.people) { if (on) this.people.add(p); else this.people.remove(p); p.root.visible = on; }
      for (const m of sc.lamps) m.emissiveIntensity = on ? 2.5 : 0;
      sc.group.traverse((o) => { if ((o as THREE.PointLight).isPointLight) (o as THREE.PointLight).intensity = on ? 6 : 0; });
    }
    this.active = bands;
  }
  counts(): Record<Band, number> { const r = { school: 0, haat: 0, cricket: 0, tea: 0 }; for (const sc of this.scenes) if (sc.group.visible) r[sc.band] = sc.people.length; return r; }
}

