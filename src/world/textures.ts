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

export interface RoadTextures { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; }

/**
 * Road texture. u spans the full road width (7 m), v spans one tile of `roadTextureTileLength` metres.
 * Left-hand traffic: lanes separated by a broken white centre line, solid white edge lines.
 */
export function makeRoadTextures(anisotropy: number): RoadTextures {
  const W = 512, H = 1024;
  const [c, ctx] = canvas(W, H);
  // Asphalt base
  ctx.fillStyle = '#4a4a4c';
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 26000, 0.35);
  speckle(ctx, W, H, 6000, 0.5, false);
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
  ctx.fillStyle = '#e8e6dc';
  ctx.fillRect(0.25 / mPerPx, 0, lineW, H);                 // left edge line
  ctx.fillRect(W - 0.25 / mPerPx - lineW, 0, lineW, H);     // right edge line
  // centre broken line: 3 m dash, 7 m gap (10 m tile)
  const dashLen = (3 / WORLD.roadTextureTileLength) * H;
  ctx.fillStyle = '#f0e9c8';
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
  return { map, roughnessMap };
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
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
