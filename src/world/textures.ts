import * as THREE from 'three';
import { WORLD } from '../config.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** Cheap value noise speckle. */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, light = true) {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(Math.random() * 255);
    ctx.fillStyle = light ? `rgba(${v},${v},${v},${alpha})` : `rgba(0,0,0,${alpha * Math.random()})`;
    const s = 1 + Math.random() * 2;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

export interface RoadTextures { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; }

/** Tangent-space normal map from a greyscale height canvas (Sobel), strength in texels. */
export function normalFromHeight(src: HTMLCanvasElement, strength = 2, anisotropy = 4): THREE.CanvasTexture {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d')!; const d = sctx.getImageData(0, 0, w, h).data;
  const hAt = (x: number, y: number) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  const [c, ctx] = canvas(w, h); const out = ctx.createImageData(w, h); const o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength, dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1); const i = (y * w + x) * 4;
    o[i] = (-dx / len * 0.5 + 0.5) * 255; o[i + 1] = (-dy / len * 0.5 + 0.5) * 255; o[i + 2] = (1 / len * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy;
  return t;
}
/** Height field for asphalt: aggregate grain, a few sunk patches and cracks (dark = low). */
function asphaltHeight(W: number, H: number): HTMLCanvasElement {
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 70000; i++) { const v = 100 + Math.random() * 90; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  for (let i = 0; i < 8; i++) { ctx.fillStyle = 'rgba(70,70,70,0.6)'; ctx.fillRect(Math.random() * W, Math.random() * H, 40 + Math.random() * 120, 60 + Math.random() * 200); }
  ctx.strokeStyle = 'rgba(30,30,30,0.9)'; ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) { ctx.beginPath(); let x = Math.random() * W, y = Math.random() * H; ctx.moveTo(x, y); for (let j = 0; j < 8; j++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 30; ctx.lineTo(x, y); } ctx.stroke(); }
  // soften a touch so the normals are not pure noise
  ctx.globalAlpha = 0.5; ctx.drawImage(c, 1, 0); ctx.drawImage(c, 0, 1); ctx.globalAlpha = 1;
  return c;
}

/**
 * Road texture. u spans the full road width (7 m), v spans one tile of `roadTextureTileLength` metres.
 * Left-hand traffic: lanes separated by a broken white centre line, solid white edge lines.
 */
export function makeRoadTextures(anisotropy: number): RoadTextures {
  const W = 512, H = 1024;
  const [c, ctx] = canvas(W, H);
  // Asphalt base
  ctx.fillStyle = '#56565a';
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 60000, 0.22);
  speckle(ctx, W, H, 9000, 0.45, false);
  // light aggregate flecks
  for (let i = 0; i < 9000; i++) { const v = 150 + Math.random() * 70; ctx.fillStyle = `rgba(${v},${v},${v - 6},0.5)`; ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
  // Patches / repairs
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(${30 + Math.random() * 20},${30 + Math.random() * 20},${32 + Math.random() * 20},0.5)`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 40 + Math.random() * 120, 60 + Math.random() * 200);
  }
  // Tyre wear strips (darker, slightly shiny) at wheel tracks in both lanes
  const mPerPx = WORLD.roadWidth / W;
  const trackX = [1.0, 2.6, 4.4, 6.0].map((m) => m / mPerPx);
  ctx.fillStyle = 'rgba(25,25,27,0.35)';
  for (const x of trackX) ctx.fillRect(x - 22, 0, 44, H);
  // Cracks
  ctx.strokeStyle = 'rgba(20,20,20,0.6)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    let x = Math.random() * W, y = Math.random() * H;
    ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // Markings
  const lineW = 0.12 / mPerPx;
  ctx.fillStyle = '#f4f2ea';
  ctx.fillRect(0.25 / mPerPx, 0, lineW, H);                 // left edge line
  ctx.fillRect(W - 0.25 / mPerPx - lineW, 0, lineW, H);     // right edge line
  // centre broken line: 3 m dash, 7 m gap (10 m tile)
  const dashLen = (3 / WORLD.roadTextureTileLength) * H;
  ctx.fillStyle = '#f7f1d4';
  ctx.fillRect(W / 2 - lineW / 2, H * 0.1, lineW, dashLen);
  // paint wear
  ctx.globalCompositeOperation = 'destination-out';
  speckle(ctx, W, H, 800, 0.08);
  ctx.globalCompositeOperation = 'source-over';
  speckle(ctx, W, H, 4000, 0.12);

  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.ClampToEdgeWrapping; map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy; map.colorSpace = THREE.SRGBColorSpace;

  // Roughness: paint smoother, wear strips smoother
  const [rc, rctx] = canvas(W / 2, H / 2);
  rctx.fillStyle = '#d0d0d0'; rctx.fillRect(0, 0, W / 2, H / 2);
  speckle(rctx, W / 2, H / 2, 8000, 0.3);
  rctx.fillStyle = '#9a9a9a';
  for (const x of trackX) rctx.fillRect(x / 2 - 11, 0, 22, H / 2);
  rctx.fillStyle = '#707070';
  rctx.fillRect(0.25 / mPerPx / 2, 0, lineW / 2, H / 2);
  rctx.fillRect((W - 0.25 / mPerPx - lineW) / 2, 0, lineW / 2, H / 2);
  rctx.fillRect(W / 4 - lineW / 4, H * 0.05, lineW / 2, dashLen / 2);
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = THREE.ClampToEdgeWrapping; roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = anisotropy;
  const normalMap = normalFromHeight(asphaltHeight(W / 2, H / 2), 1.6, anisotropy); normalMap.wrapS = THREE.ClampToEdgeWrapping;
  return { map, roughnessMap, normalMap };
}

export function makeGrassTexture(anisotropy: number): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#55692f'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const g = 80 + Math.random() * 60, r = 55 + Math.random() * 55, b = 25 + Math.random() * 30;
    ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  // dirt patches
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = `rgba(${110 + Math.random() * 30},${90 + Math.random() * 20},${50},0.35)`;
    ctx.beginPath(); ctx.ellipse(Math.random() * S, Math.random() * S, 20 + Math.random() * 40, 10 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // blades: short bright strokes so the ground reads as grass up close
  for (let i = 0; i < 6000; i++) { const x = Math.random() * S, y = Math.random() * S, l = 3 + Math.random() * 6; ctx.strokeStyle = `rgba(${90 + Math.random() * 60},${130 + Math.random() * 70},${40 + Math.random() * 30},0.55)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 3, y - l); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Bumpy grass normals (clumps) to go with makeGrassTexture. */
export function makeGrassNormal(anisotropy: number): THREE.CanvasTexture {
  const S = 256; const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { const r = 3 + Math.random() * 9, x = Math.random() * S, y = Math.random() * S; const gr = ctx.createRadialGradient(x, y, 0, x, y, r); const v = 110 + Math.random() * 80; gr.addColorStop(0, `rgba(${v},${v},${v},0.9)`); gr.addColorStop(1, 'rgba(128,128,128,0)'); ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  return normalFromHeight(c, 2.2, anisotropy);
}
/** Grass tuft card (alpha) for the roadside instancing. */
export function makeTuftTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  for (let i = 0; i < 26; i++) { const x = 8 + Math.random() * 48, top = 4 + Math.random() * 22; ctx.strokeStyle = `rgba(${70 + Math.random() * 60},${120 + Math.random() * 70},${35 + Math.random() * 30},0.95)`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(32 + (x - 32) * 0.3, 64); ctx.quadraticCurveTo(x, 40, x + (Math.random() - 0.5) * 10, top); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Soft puddle disc (alpha) */
export function makePuddleTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128); const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(64, 64, 62, 44, 0.4, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(c);
}

export function makeDirtTexture(anisotropy: number): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#8a7555'; ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 6000, 0.3);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(60,50,35,${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tin-roof / wall texture for roadside shops and buildings. */
export function makeWallTexture(baseColor: string, anisotropy: number, windows = true): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = baseColor; ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 2500, 0.25);
  if (windows) {
    ctx.fillStyle = '#1d2a3a';
    for (let y = 30; y < S - 40; y += 70) for (let x = 24; x < S - 40; x += 64) {
      ctx.fillRect(x, y, 34, 44);
      ctx.fillStyle = 'rgba(120,160,200,0.35)'; ctx.fillRect(x + 3, y + 3, 12, 38); ctx.fillStyle = '#1d2a3a';
    }
  }
  // grime at bottom
  const g = ctx.createLinearGradient(0, S * 0.7, 0, S);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Text sign (road sign / shop sign). */
export function makeTextTexture(lines: string[], opts: { bg: string; fg: string; w?: number; h?: number; font?: string; border?: string }): THREE.CanvasTexture {
  const W = opts.w ?? 512, H = opts.h ?? 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, W, H);
  if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = 12; ctx.strokeRect(6, 6, W - 12, H - 12); }
  ctx.fillStyle = opts.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const size = Math.min(H / (lines.length + 0.6), W / 7);
  ctx.font = opts.font ?? `700 ${size}px "Hind Siliguri"`;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * (i + 1) / (lines.length + 1), W - 30));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Striped black/white kerb texture (u across the kerb face, v along it; 1 m per repeat). */
export function makeKerbTexture(anisotropy: number): THREE.CanvasTexture {
  const W = 64, H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#e8e6df'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f1f22'; ctx.fillRect(0, 0, W, H / 2);
  speckle(ctx, W, H, 600, 0.25);
  const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Paving-tile texture for footpaths (0.5 m tiles, 2 m per repeat). */
export function makePavementTexture(anisotropy: number): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#9d978d'; ctx.fillRect(0, 0, S, S);
  const n = 4, cell = S / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 140 + Math.random() * 40;
    ctx.fillStyle = `rgb(${v + 6},${v},${v - 10})`;
    ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
  }
  speckle(ctx, S, S, 2500, 0.18);
  ctx.strokeStyle = 'rgba(40,35,30,0.55)'; ctx.lineWidth = 3;
  for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(S, i * cell); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Dhaka-style apartment façade: concrete bands, window rows with frames + glass reflections,
 * balconies with railings, AC units, grime streaks. One repeat = one floor × ~4 m of width.
 */
export function makeFacadeTexture(base: string, anisotropy: number, opts: { balconies?: boolean; shopfront?: boolean } = {}): THREE.CanvasTexture {
  const W = 512, H = 512;  // 2 floors tall × 8 m wide per repeat
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 4000, 0.12);
  const floorH = H / 2;
  for (let f = 0; f < 2; f++) {
    const y0 = f * floorH;
    // floor slab band
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, y0 + floorH - 14, W, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, y0 + floorH - 16, W, 2);
    // windows: 4 per repeat
    for (let i = 0; i < 4; i++) {
      const x = 28 + i * 124, w = 68, y = y0 + 52, h = 110;
      // frame
      ctx.fillStyle = '#d8d4c8'; ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
      ctx.fillStyle = '#2b3b4d'; ctx.fillRect(x, y, w, h);
      // glass reflection gradient + mullion
      const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, 'rgba(160,200,230,0.45)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(90,120,150,0.35)');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#c9c5bb'; ctx.fillRect(x + w / 2 - 2, y, 4, h); ctx.fillRect(x, y + h / 2 - 2, w, 4);
      // curtain / lit window variation
      if (Math.random() < 0.3) { ctx.fillStyle = 'rgba(230,200,120,0.35)'; ctx.fillRect(x + 4, y + 4, w / 2 - 6, h - 8); }
      // AC unit under some windows
      if (Math.random() < 0.4) { ctx.fillStyle = '#e6e6e2'; ctx.fillRect(x + w - 30, y + h + 10, 34, 24); ctx.fillStyle = '#9a9a96'; for (let k = 0; k < 5; k++) ctx.fillRect(x + w - 28, y + h + 14 + k * 4, 30, 2); }
      // balcony on alternate windows
      if (opts.balconies && i % 2 === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 24, y + h - 30, w + 48, 8);
        ctx.fillStyle = '#b9b5aa'; ctx.fillRect(x - 24, y + h - 60, w + 48, 6);
        ctx.strokeStyle = '#7a7670'; ctx.lineWidth = 3;
        for (let k = 0; k <= 8; k++) { const bx = x - 24 + k * (w + 48) / 8; ctx.beginPath(); ctx.moveTo(bx, y + h - 60); ctx.lineTo(bx, y + h - 30); ctx.stroke(); }
      }
    }
  }
  if (opts.shopfront) { // ground floor becomes shops with shutters and signs (bottom half)
    const y0 = floorH;
    ctx.fillStyle = '#5a5248'; ctx.fillRect(0, y0, W, floorH);
    for (let i = 0; i < 4; i++) {
      const x = i * 128;
      ctx.fillStyle = ['#d8262c', '#1f6fb5', '#1f9d55', '#f2a900'][i % 4]; ctx.fillRect(x + 4, y0 + 10, 120, 44);
      ctx.fillStyle = i % 2 ? '#7f8a96' : '#2a2a2a'; ctx.fillRect(x + 8, y0 + 60, 112, floorH - 70);
      if (i % 2) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; for (let k = 0; k < 20; k++) { ctx.beginPath(); ctx.moveTo(x + 8, y0 + 64 + k * 9); ctx.lineTo(x + 120, y0 + 64 + k * 9); ctx.stroke(); } }
      else { ctx.fillStyle = 'rgba(200,220,240,0.35)'; ctx.fillRect(x + 12, y0 + 64, 104, floorH - 80); }
    }
  }
  // grime streaks from the top + general dirt at the bottom
  for (let i = 0; i < 12; i++) { ctx.fillStyle = `rgba(30,25,20,${0.05 + Math.random() * 0.1})`; const x = Math.random() * W; ctx.fillRect(x, 0, 6 + Math.random() * 10, 60 + Math.random() * 200); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Foliage card (alpha) for billboard trees: a soft, clumpy canopy on a trunk. */
export function makeTreeCardTexture(kind: number): THREE.CanvasTexture {
  const W = 256, H = 384;
  const [c, ctx] = canvas(W, H);
  ctx.clearRect(0, 0, W, H);
  if (kind === 1) { // palm
    ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(W / 2 + 8, H); ctx.quadraticCurveTo(W / 2 - 6, H * 0.5, W / 2, H * 0.22); ctx.stroke();
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.42;
      ctx.strokeStyle = i % 2 ? '#3d7a2a' : '#4f9a35'; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(W / 2, H * 0.22); ctx.quadraticCurveTo(W / 2 + Math.cos(a) * 70, H * 0.22 + Math.sin(a) * 70 + 10, W / 2 + Math.cos(a) * 110, H * 0.22 + Math.sin(a) * 60 + 50); ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#5a3d22'; ctx.fillRect(W / 2 - 9, H * 0.55, 18, H * 0.45);
    ctx.fillStyle = '#4a3019'; ctx.fillRect(W / 2 - 9, H * 0.55, 6, H * 0.45);
    const hue = kind === 2 ? 95 : 110;
    for (let i = 0; i < 70; i++) {
      const r = 22 + Math.random() * 36;
      const ang = Math.random() * Math.PI * 2, rad = Math.random() * 78;
      const x = W / 2 + Math.cos(ang) * rad, y = H * 0.33 + Math.sin(ang) * rad * 0.8;
      const l = 22 + Math.random() * 22;
      ctx.fillStyle = `hsla(${hue + Math.random() * 14 - 7}, 48%, ${l}%, 0.95)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // lit top highlights
    for (let i = 0; i < 25; i++) { const ang = Math.random() * Math.PI * 2, rad = Math.random() * 70; ctx.fillStyle = `hsla(${hue}, 55%, ${48 + Math.random() * 10}%, 0.55)`; ctx.beginPath(); ctx.arc(W / 2 + Math.cos(ang) * rad, H * 0.28 + Math.sin(ang) * rad * 0.6, 10 + Math.random() * 14, 0, 7); ctx.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
