import { WORLD } from '../config.ts';
import { ROUTE } from '../routes.ts';
import type { Road } from '../world/road.ts';
import { bn, bnKm, bnTime } from '../util/bangla.ts';

export interface MapState {
  x: number; z: number; yaw: number; s: number; onBranch: boolean; wrongBranch: boolean;
  blockadeActive: boolean; stoppedAtRajbari: boolean; kmh: number; northUp: boolean;
  /** per-stop served/missed flags (Phase 2) */
  stopsDone?: boolean[]; nextStopS?: number;
}

const WAYPOINTS = (): [number, string][] => ROUTE.waypoints;

/**
 * 2D map rendering shared by the HUD minimap, the full map and the pre-trip screen.
 * World (x,z) → canvas via a fitted transform (full map) or a centred/rotated one (minimap).
 */
export class RouteMap {
  private pts: [number, number][] = [];
  private branchPts: [number, number][] = [];
  private sidePts: [number, number][][] = [];
  constructor(private road: Road, branch: Road, sideRoads: Road[] = []) {
    for (const sr of sideRoads) { const pts: [number, number][] = []; for (let s = 0; s <= sr.length; s += 10) { const f = sr.sample(s); pts.push([f.x, f.z]); } this.sidePts.push(pts); }
    for (let s = 0; s <= road.length; s += 10) { const f = road.sample(s); this.pts.push([f.x, f.z]); }
    for (let s = 0; s <= branch.length; s += 10) { const f = branch.sample(s); this.branchPts.push([f.x, f.z]); }
  }

  /** Results card: the route with the driven path coloured by speed and the trip's moments marked. */
  drawTrace(canvas: HTMLCanvasElement, samples: { s: number; kmh: number }[], events: { s: number; kind: 'stop' | 'crash' | 'fine' | 'fuel' }[]) {
    const ctx = canvas.getContext('2d')!, W = canvas.width, H = canvas.height;
    const b = this.road.bounds; const pad = 18;
    const sc = Math.min((W - pad * 2) / (b.maxX - b.minX || 1), (H - pad * 2) / (b.maxZ - b.minZ || 1));
    const ox = (W - (b.maxX - b.minX) * sc) / 2, oz = (H - (b.maxZ - b.minZ) * sc) / 2;
    const P = (x: number, z: number): [number, number] => [ox + (x - b.minX) * sc, oz + (z - b.minZ) * sc];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#efe6cc'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#bfb49a'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    this.pts.forEach(([x, z], i) => { const [cx, cy] = P(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke();
    const col = (kmh: number) => kmh > 85 ? '#d8262c' : kmh > 55 ? '#f2a900' : '#1f8a4a';
    ctx.lineWidth = 4;
    for (let i = 1; i < samples.length; i++) {
      const a = this.road.sample(samples[i - 1].s), c = this.road.sample(samples[i].s);
      const [ax, ay] = P(a.x, a.z), [cx, cy] = P(c.x, c.z);
      ctx.strokeStyle = col(samples[i].kmh); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cx, cy); ctx.stroke();
    }
    ctx.font = '700 13px "Hind Siliguri", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const e of events) {
      const f = this.road.sample(e.s); const [x, y] = P(f.x, f.z);
      const [fill, glyph] = e.kind === 'crash' ? ['#d8262c', '✖'] : e.kind === 'fine' ? ['#7a3fa0', '৳'] : e.kind === 'fuel' ? ['#1f6fb5', '⛽'] : ['#1f8a4a', '●'];
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = fill; ctx.fillText(glyph, x, y + 0.5);
    }
    // legend
    ctx.textAlign = 'left'; ctx.font = '600 11px "Hind Siliguri", sans-serif';
    [['#1f8a4a', '< ৫৫'], ['#f2a900', '৫৫–৮৫'], ['#d8262c', '> ৮৫ কিমি/ঘ']].forEach(([c, t], i) => { ctx.fillStyle = c; ctx.fillRect(8 + i * 74, H - 14, 10, 6); ctx.fillStyle = '#2a1a0a'; ctx.fillText(t, 22 + i * 74, H - 11); });
  }
  /** Full route map in a canvas (north up, fitted). */
  drawFull(canvas: HTMLCanvasElement, st: MapState | null, info?: { remaining: number; eta: number }) {
    const st2 = st;
    const ctx = canvas.getContext('2d')!, W = canvas.width, H = canvas.height;
    const b = this.road.bounds; const pad = 60;
    const sx = (W - pad * 2) / (b.maxX - b.minX || 1), sz = (H - pad * 2) / (b.maxZ - b.minZ || 1);
    const sc = Math.min(sx, sz);
    const ox = (W - (b.maxX - b.minX) * sc) / 2, oz = (H - (b.maxZ - b.minZ) * sc) / 2;
    const P = (x: number, z: number): [number, number] => [ox + (x - b.minX) * sc, oz + (z - b.minZ) * sc];
    ctx.fillStyle = '#e9dfc2'; ctx.fillRect(0, 0, W, H);
    // paper grid
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // river band around the bridge
    const r0 = this.road.sample(WORLD.bridgeStartS), r1 = this.road.sample(WORLD.bridgeEndS);
    ctx.strokeStyle = '#8fb8d8'; ctx.lineWidth = 46; ctx.lineCap = 'round';
    const rm = P((r0.x + r1.x) / 2, (r0.z + r1.z) / 2); const rd = P(r0.x + r0.rx * 300, r0.z + r0.rz * 300); const rd2 = P(r0.x - r0.rx * 300, r0.z - r0.rz * 300);
    ctx.beginPath(); ctx.moveTo(rd[0], rd[1]); ctx.lineTo(rm[0], rm[1]); ctx.lineTo(rd2[0], rd2[1]); ctx.stroke();
    // junction side roads (thin grey)
    ctx.strokeStyle = '#a89f8c'; ctx.lineWidth = 4; ctx.setLineDash([]);
    for (const sp of this.sidePts) { ctx.beginPath(); sp.forEach(([x, z], i) => { const [cx, cy] = P(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke(); }
    // wrong branch (grey)
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 6; ctx.setLineDash([8, 6]); ctx.beginPath();
    this.branchPts.forEach(([x, z], i) => { const [cx, cy] = P(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke(); ctx.setLineDash([]);
    // main route
    ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 12; ctx.beginPath();
    this.pts.forEach(([x, z], i) => { const [cx, cy] = P(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke();
    ctx.strokeStyle = '#d8262c'; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); ctx.stroke(); ctx.setLineDash([]);
    // waypoints
    ctx.font = '700 18px "Hind Siliguri"'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const [s, name] of WAYPOINTS()) {
      const f = this.road.sample(s); const [cx, cy] = P(f.x, f.z);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a1a0a'; ctx.fillText(name, cx + 14, cy - 2);
    }
    // branch label
    const be = this.branchPts[this.branchPts.length - 1]; const [bx, by] = P(be[0], be[1]);
    ctx.fillStyle = '#666'; ctx.font = '700 15px "Hind Siliguri"'; ctx.fillText(ROUTE.names.branchLabel, bx + 10, by);
    // andolon warning
    if (st?.blockadeActive) { const f = this.road.sample(WORLD.andolonS); const [cx, cy] = P(f.x, f.z); this.icon(ctx, cx, cy, '⚠️', 22); }
    WORLD.stops.forEach((st, i) => { if (st.waiting === 0) return; const f = this.road.sample(st.s); const [cx, cy] = P(f.x, f.z); this.icon(ctx, cx, cy - 18, st2?.stopsDone?.[i] ? '✅' : '🚏', 20); });
    { const f = this.road.sample(WORLD.finishS); const [cx, cy] = P(f.x, f.z); this.icon(ctx, cx, cy - 18, '🏁', 22); }
    if (st) {
      const [cx, cy] = P(st.x, st.z);
      if (st.wrongBranch) { // reroute arrow back to the fork
        const f = this.road.sample(WORLD.forkS); const [fx, fy] = P(f.x, f.z);
        ctx.strokeStyle = '#1f6fb5'; ctx.lineWidth = 4; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(fx, fy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#1f6fb5'; ctx.font = '700 16px "Hind Siliguri"'; ctx.fillText('↩ ঘুরে মূল রাস্তায়', cx + 12, cy + 18);
      }
      this.arrow(ctx, cx, cy, st.yaw, 12);
    }
    if (info) {
      ctx.fillStyle = 'rgba(42,26,10,0.85)'; ctx.fillRect(10, H - 40, 330, 30);
      ctx.fillStyle = '#fff'; ctx.font = '700 16px "Hind Siliguri"'; ctx.fillText(`বাকি ${bnKm(info.remaining)}   ·   আনুমানিক ${bnTime(info.eta)}`, 18, H - 25);
    }
    ctx.fillStyle = '#2a1a0a'; ctx.font = '700 14px "Hind Siliguri"'; ctx.textAlign = 'right'; ctx.fillText('N ↑', W - 12, 18);
  }

  /** Round minimap: player at centre, heading-up (rotated) or north-up. */
  drawMini(canvas: HTMLCanvasElement, st: MapState, metresAcross = 900) {
    const ctx = canvas.getContext('2d')!, W = canvas.width, H = canvas.height, c = W / 2;
    const sc = W / metresAcross;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(c, c);
    // heading-up: rotate so the bus forward (-sin yaw, -cos yaw) points up
    if (!st.northUp) ctx.rotate(-(Math.PI - st.yaw));
    else ctx.rotate(Math.PI);  // north (-z) up in north-up mode
    const T = (x: number, z: number): [number, number] => [(x - st.x) * sc, (z - st.z) * sc];
    ctx.strokeStyle = '#a89f8c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (const sp of this.sidePts) { ctx.beginPath(); sp.forEach(([x, z], i) => { const [cx, cy] = T(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke(); }
    // branch
    ctx.strokeStyle = st.wrongBranch ? '#1f6fb5' : '#8a8a8a'; ctx.lineWidth = 5; ctx.setLineDash([5, 4]); ctx.beginPath();
    this.branchPts.forEach(([x, z], i) => { const [cx, cy] = T(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke(); ctx.setLineDash([]);
    // main
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f0e6c8'; ctx.lineWidth = 9; ctx.beginPath();
    this.pts.forEach(([x, z], i) => { const [cx, cy] = T(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke();
    ctx.strokeStyle = '#d8262c'; ctx.lineWidth = 4; ctx.stroke();
    // icons
    const put = (s: number, glyph: string, cond = true) => { if (!cond) return; const f = this.road.sample(s); const [x, y] = T(f.x, f.z); ctx.save(); ctx.translate(x, y); ctx.rotate(st.northUp ? -Math.PI : Math.PI - st.yaw); this.icon(ctx, 0, 0, glyph, 18); ctx.restore(); };
    WORLD.stops.forEach((sp, i) => put(sp.s, '🚏', sp.waiting > 0 && !(st.stopsDone?.[i])));
    put(WORLD.andolonS, '⚠️', st.blockadeActive);
    put(WORLD.finishS, '🏁');
    // next objective
    const next = st.nextStopS ?? (st.blockadeActive && st.s < WORLD.andolonS ? WORLD.andolonS : WORLD.finishS);
    { const f = this.road.sample(next); const [x, y] = T(f.x, f.z); ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.stroke(); }
    if (st.wrongBranch) { const f = this.road.sample(WORLD.forkS); const [x, y] = T(f.x, f.z); ctx.strokeStyle = '#1f6fb5'; ctx.lineWidth = 3; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
    // player arrow (always centred, pointing up in heading-up mode)
    this.arrow(ctx, c, c, st.northUp ? st.yaw : Math.PI, 11, st.wrongBranch ? '#1f6fb5' : '#ffcc33');
    // north indicator
    ctx.save(); ctx.translate(c, c); ctx.rotate(st.northUp ? 0 : -(Math.PI - st.yaw) + Math.PI); ctx.fillStyle = '#fff'; ctx.font = '700 13px "Hind Siliguri"'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -c + 16); ctx.restore();
  }

  private icon(ctx: CanvasRenderingContext2D, x: number, y: number, glyph: string, size: number) {
    ctx.save(); ctx.font = `${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(glyph, x, y); ctx.restore();
  }
  /** Player arrow; yaw in vehicle convention (forward = (-sin, -cos)); canvas y is world z. */
  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, yaw: number, r: number, color = '#ffcc33') {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-yaw + Math.PI); // forward (-z) is "up" (−y) on canvas when yaw = 0
    ctx.fillStyle = color; ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, r * 0.8); ctx.lineTo(0, r * 0.35); ctx.lineTo(-r * 0.7, r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  progressPercent(s: number): string { return bn(Math.round(Math.min(100, Math.max(0, s / WORLD.finishS * 100)))) + '%'; }
}
