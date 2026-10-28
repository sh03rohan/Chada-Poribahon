import * as THREE from 'three';
import { ROUTE } from '../routes.ts';
import { BANGLA_FONT } from '../util/fonts.ts';
import { bn } from '../util/bangla.ts';

/**
 * Procedurally painted livery in the Bangladeshi truck/bus-art style: bold bands, flowers,
 * birds, hand-lettered Bangla. All text is drawn with CanvasTexture AFTER the font has loaded
 * (see util/fonts.ts). Every helper is deterministic-ish but uses a seeded jitter for a
 * hand-painted look.
 */

export const PALETTE = {
  red: '#d8262c', darkRed: '#8a1216', yellow: '#ffcc33', orange: '#f28c1a', green: '#1f9d55', darkGreen: '#0f5c30',
  cream: '#fff1c9', blue: '#1f6fb5', pink: '#ef6aa3', white: '#fffaf0', black: '#1d1a17',
};

let seed = 7;
const jr = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const jit = (a: number) => (jr() - 0.5) * a;

export const BANGLA_BOLD = (px: number) => `700 ${px}px "${BANGLA_FONT}"`;

/** Hand-painted text: dark offset shadow, outline, then fill with a tiny wobble. */
function paintText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, fill: string, outline: string, maxW?: number) {
  ctx.save();
  ctx.font = BANGLA_BOLD(px);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText(text, x + px * 0.04, y + px * 0.05, maxW);
  ctx.lineWidth = px * 0.11; ctx.strokeStyle = outline;
  ctx.strokeText(text, x, y, maxW);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y, maxW);
  // highlight sliver
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff';
  ctx.fillText(text, x - px * 0.015, y - px * 0.02, maxW);
  ctx.restore();
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, petal: string, center: string, petals = 7) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(jit(0.6));
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ctx.save(); ctx.rotate(a + jit(0.08));
    ctx.beginPath(); ctx.ellipse(r * 0.62, 0, r * 0.5, r * 0.26 + jit(r * 0.04), 0, 0, Math.PI * 2);
    ctx.fillStyle = petal; ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.06); ctx.strokeStyle = PALETTE.darkRed; ctx.stroke();
    // petal highlight
    ctx.beginPath(); ctx.ellipse(r * 0.62, -r * 0.06, r * 0.28, r * 0.08, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fillStyle = center; ctx.fill();
  ctx.lineWidth = r * 0.06; ctx.strokeStyle = PALETTE.darkRed; ctx.stroke();
  for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.arc(jit(r * 0.4), jit(r * 0.4), r * 0.04, 0, 7); ctx.fillStyle = PALETTE.darkRed; ctx.fill(); }
  ctx.restore();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, angle: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.35, len, 0);
  ctx.quadraticCurveTo(len * 0.5, len * 0.35, 0, 0);
  ctx.fillStyle = PALETTE.green; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = PALETTE.darkGreen; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.strokeStyle = PALETTE.darkGreen; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

function bird(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false) {
  ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
  // body
  ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.5, -0.25, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.blue; ctx.fill(); ctx.lineWidth = s * 0.08; ctx.strokeStyle = '#0b3a66'; ctx.stroke();
  // wing
  ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 0.1); ctx.quadraticCurveTo(-s * 0.1, -s * 1.3, s * 0.9, -s * 0.5); ctx.quadraticCurveTo(s * 0.2, -s * 0.3, -s * 0.2, -s * 0.1);
  ctx.fillStyle = PALETTE.green; ctx.fill(); ctx.stroke();
  // tail
  ctx.beginPath(); ctx.moveTo(-s * 0.9, 0); ctx.lineTo(-s * 1.7, -s * 0.5); ctx.lineTo(-s * 1.6, s * 0.3); ctx.closePath();
  ctx.fillStyle = PALETTE.red; ctx.fill(); ctx.stroke();
  // head + beak
  ctx.beginPath(); ctx.arc(s * 0.95, -s * 0.25, s * 0.32, 0, Math.PI * 2); ctx.fillStyle = PALETTE.yellow; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s * 1.25, -s * 0.25); ctx.lineTo(s * 1.6, -s * 0.15); ctx.lineTo(s * 1.25, -s * 0.05); ctx.closePath(); ctx.fillStyle = PALETTE.orange; ctx.fill();
  ctx.beginPath(); ctx.arc(s * 1.02, -s * 0.32, s * 0.06, 0, 7); ctx.fillStyle = '#000'; ctx.fill();
  ctx.restore();
}

/** Zig-zag / diamond border band, typical of truck art. */
function band(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, bg: string, fg: string, pattern: 'diamond' | 'zigzag' | 'scallop') {
  ctx.save();
  ctx.fillStyle = bg; ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = fg; ctx.strokeStyle = PALETTE.darkRed; ctx.lineWidth = 2;
  const step = h * 1.1;
  for (let x = x0; x < x0 + w; x += step) {
    ctx.beginPath();
    if (pattern === 'diamond') { ctx.moveTo(x + step / 2, y0 + 2); ctx.lineTo(x + step - 2, y0 + h / 2); ctx.lineTo(x + step / 2, y0 + h - 2); ctx.lineTo(x + 2, y0 + h / 2); ctx.closePath(); }
    else if (pattern === 'zigzag') { ctx.moveTo(x, y0 + h); ctx.lineTo(x + step / 2, y0 + 2); ctx.lineTo(x + step, y0 + h); ctx.closePath(); }
    else { ctx.arc(x + step / 2, y0 + h, step / 2 - 1, Math.PI, 0); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Subtle brush texture overlay to kill the "flat vector" look. */
function brushNoise(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.07) {
  ctx.save();
  for (let i = 0; i < w * h / 600; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * strength})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 1 + Math.random() * 3);
  }
  // faded streaks
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 40; i++) { ctx.fillStyle = '#000'; ctx.fillRect(Math.random() * w, 0, 1 + Math.random() * 3, h); }
  ctx.restore();
}

export interface SideLiveryLayout {
  /** panel extents in bus profile units (u along length, y height) */
  uMin: number; uMax: number; yMin: number; yMax: number;
  /** window band in y (art avoided there) */
  winY0: number; winY1: number;
}

/**
 * Side livery canvas, mapped so that u∈[uMin,uMax] → canvas x, y∈[yMin,yMax] → canvas y (flipped).
 * The same texture works for both sides because the side panels are built from mirrored shapes
 * (see busModel.ts) — text reads correctly on both.
 */
export function makeSideLivery(l: SideLiveryLayout, anisotropy: number, main = PALETTE.red, dark = PALETTE.darkRed): THREE.CanvasTexture {
  const W = 2048, H = Math.round(W * (l.yMax - l.yMin) / (l.uMax - l.uMin));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const X = (u: number) => (u - l.uMin) / (l.uMax - l.uMin) * W;
  const Y = (y: number) => (1 - (y - l.yMin) / (l.yMax - l.yMin)) * H;

  // Base cream with warm gradient
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fff6dc'); g.addColorStop(1, '#f6e2b0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Roof edge band (above windows) — red with yellow scallops
  band(ctx, 0, Y(l.yMax), W, Y(l.winY1) - Y(l.yMax), main, PALETTE.yellow, 'scallop');
  // Window sill band — green with diamonds
  const sillTop = Y(l.winY0), sillH = H * 0.055;
  band(ctx, 0, sillTop, W, sillH, PALETTE.green, PALETTE.yellow, 'diamond');
  // Skirt band — red/yellow zigzag at the bottom
  const skirtH = H * 0.1;
  band(ctx, 0, H - skirtH, W, skirtH, main, PALETTE.yellow, 'zigzag');
  ctx.fillStyle = PALETTE.blue; ctx.fillRect(0, H - skirtH - 8, W, 8);
  ctx.fillStyle = PALETTE.yellow; ctx.fillRect(0, sillTop + sillH, W, 6);

  // Main name band: thick yellow panel with red lettering, between sill band and skirt
  const nameTop = sillTop + sillH + 14, nameBot = H - skirtH - 14;
  const nameH = nameBot - nameTop;
  ctx.fillStyle = PALETTE.yellow;
  ctx.fillRect(W * 0.22, nameTop + nameH * 0.08, W * 0.56, nameH * 0.84);
  ctx.strokeStyle = dark; ctx.lineWidth = 6; ctx.strokeRect(W * 0.22, nameTop + nameH * 0.08, W * 0.56, nameH * 0.84);
  ctx.strokeStyle = PALETTE.green; ctx.lineWidth = 3; ctx.strokeRect(W * 0.225, nameTop + nameH * 0.08 + 8, W * 0.55, nameH * 0.84 - 16);
  paintText(ctx, 'চাঁদা পরিবহন', W / 2, nameTop + nameH * 0.5, nameH * 0.62, main, dark, W * 0.52);

  // Flower clusters at both ends of the name band
  for (const side of [-1, 1]) {
    const cx = W / 2 + side * W * 0.37, cy = nameTop + nameH / 2;
    flower(ctx, cx, cy, nameH * 0.42, PALETTE.pink, PALETTE.yellow, 8);
    flower(ctx, cx + side * nameH * 0.75, cy - nameH * 0.2, nameH * 0.28, PALETTE.orange, main, 6);
    flower(ctx, cx - side * nameH * 0.7, cy + nameH * 0.2, nameH * 0.24, main, PALETTE.yellow, 6);
    for (let i = 0; i < 5; i++) leaf(ctx, cx + jit(nameH * 1.2), cy + jit(nameH * 0.6), nameH * 0.35, jr() * 6.28);
    bird(ctx, cx + side * nameH * 1.6, cy - nameH * 0.05, nameH * 0.22, side < 0);
  }
  // Small flowers along the sill band
  for (let i = 0; i < 10; i++) {
    const x = W * 0.05 + i * (W * 0.9 / 9);
    flower(ctx, x, sillTop + sillH / 2, sillH * 0.34, i % 2 ? PALETTE.pink : PALETTE.orange, PALETTE.yellow, 6);
  }
  // Small tagline near the rear: "শুভ যাত্রা"
  paintText(ctx, 'শুভ যাত্রা', W * 0.08, nameTop + nameH * 0.5, nameH * 0.3, PALETTE.green, PALETTE.darkGreen, W * 0.14);
  paintText(ctx, ROUTE.label.replace(' → ', '–'), W * 0.92, nameTop + nameH * 0.5, nameH * 0.28, PALETTE.blue, '#0b3a66', W * 0.14);

  brushNoise(ctx, W, H, 0.08);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function makeRearBoard(anisotropy: number, main = PALETTE.red, dark = PALETTE.darkRed): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PALETTE.cream; ctx.fillRect(0, 0, W, H);
  band(ctx, 0, 0, W, 54, main, PALETTE.yellow, 'scallop');
  band(ctx, 0, H - 54, W, 54, PALETTE.green, PALETTE.yellow, 'zigzag');
  ctx.fillStyle = PALETTE.yellow; ctx.fillRect(60, 90, W - 120, H - 180);
  ctx.strokeStyle = dark; ctx.lineWidth = 8; ctx.strokeRect(60, 90, W - 120, H - 180);
  paintText(ctx, 'চাঁদা পরিবহন', W / 2, H * 0.42, 150, main, dark, W - 180);
  paintText(ctx, 'সাবধানে চালান — আল্লাহ ভরসা', W / 2, H * 0.72, 54, PALETTE.darkGreen, PALETTE.cream, W - 200);
  flower(ctx, 110, H / 2, 60, PALETTE.pink, PALETTE.yellow, 7);
  flower(ctx, W - 110, H / 2, 60, PALETTE.orange, main, 7);
  brushNoise(ctx, W, H, 0.06);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
  return t;
}

export function makeDestinationBoard(anisotropy: number): THREE.CanvasTexture {
  const W = 1024, H = 192;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#101418'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a3f44'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.font = BANGLA_BOLD(118); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffd23c'; ctx.shadowBlur = 24;
  ctx.fillStyle = '#ffe066'; ctx.fillText(ROUTE.label, W / 2, H / 2 + 6, W - 60);
  ctx.shadowBlur = 0;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
  return t;
}

/** Front bumper strip "চাঁদা পরিবহন" small. */
export function makeFrontStrip(anisotropy: number, main = PALETTE.red, dark = PALETTE.darkRed): THREE.CanvasTexture {
  const W = 1024, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  band(ctx, 0, 0, W, H, main, PALETTE.yellow, 'diamond');
  ctx.fillStyle = PALETTE.yellow; ctx.fillRect(W * 0.25, 10, W * 0.5, H - 20);
  paintText(ctx, 'চাঁদা পরিবহন', W / 2, H / 2, 76, main, dark, W * 0.46);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
  return t;
}

/** Live speedometer drawn on the dashboard. Call update() ~10×/s. */
export class Speedometer {
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private size = 256;
  constructor() {
    const c = document.createElement('canvas'); c.width = c.height = this.size;
    this.ctx = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.update(0, 0, 0);
  }
  update(kmh: number, rpm: number, gear: number) {
    const ctx = this.ctx, S = this.size, cx = S / 2, cy = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0d0f12'; ctx.beginPath(); ctx.arc(cx, cy, S / 2 - 4, 0, 7); ctx.fill();
    ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 6; ctx.stroke();
    // ticks 0..140
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    for (let v = 0; v <= 140; v += 10) {
      const a = a0 + (a1 - a0) * v / 140;
      const r1 = S / 2 - 14, r2 = v % 20 === 0 ? S / 2 - 30 : S / 2 - 22;
      ctx.strokeStyle = v >= 100 ? '#ff5544' : '#e8e8e8'; ctx.lineWidth = v % 20 === 0 ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      if (v % 20 === 0) {
        ctx.fillStyle = '#e8e8e8'; ctx.font = `700 16px "${BANGLA_FONT}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(bn(v), cx + Math.cos(a) * (S / 2 - 46), cy + Math.sin(a) * (S / 2 - 46));
      }
    }
    // needle
    const a = a0 + (a1 - a0) * Math.min(140, kmh) / 140;
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (S / 2 - 26), cy + Math.sin(a) * (S / 2 - 26)); ctx.stroke();
    ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 7); ctx.fill();
    // digital readouts
    ctx.fillStyle = '#ffd23c'; ctx.font = `700 30px "${BANGLA_FONT}"`; ctx.textAlign = 'center';
    ctx.fillText(bn(Math.round(kmh)), cx, cy + 56);
    ctx.fillStyle = '#9fd5ff'; ctx.font = `400 15px "${BANGLA_FONT}"`;
    ctx.fillText(`${bn(Math.round(rpm))} rpm  গিয়ার ${gear === 0 ? 'N' : bn(gear)}`, cx, cy + 86);
    this.texture.needsUpdate = true;
  }
}

export function makeTyreTread(): THREE.CanvasTexture {
  const W = 64, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0a0a0a';
  for (let y = 0; y < H; y += 16) { ctx.fillRect(0, y, W, 6); ctx.fillRect(W * 0.3, y + 6, 6, 10); ctx.fillRect(W * 0.65, y + 6, 6, 10); }
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, 4, H); ctx.fillRect(W - 4, 0, 4, H);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 6);
  return t;
}

export function makeBlobShadow(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}
