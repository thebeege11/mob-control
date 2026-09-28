/**
 * Procedurally drawn sprites, rendered once into offscreen canvases and then
 * blitted with drawImage (fast on mobile). All art is original.
 */
import type { Skin } from '../systems/SkinManager';
import { COLORS } from './theme';

export type Sprite = HTMLCanvasElement;

const SIZE = 64;

function canvas(w = SIZE, h = SIZE): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, n: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r0 : r1;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function eyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, angry = false, look = -0.15): void {
  const ex = r * 0.32;
  const ey = cy - r * 0.18;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx + s * ex, ey, r * 0.2, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(cx + s * ex, ey + r * look * 0.4, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
    if (angry) {
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = r * 0.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + s * ex * 1.8, ey - r * 0.38);
      ctx.lineTo(cx + s * ex * 0.3, ey - r * 0.22);
      ctx.stroke();
    }
  }
}

/** Player blip for a skin. `golden` renders the champion variant. */
export function makeBlip(skin: Skin, golden = false): Sprite {
  const [c, ctx] = canvas();
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE * 0.42;
  const body = golden ? '#ffd23f' : skin.body;
  const shade = golden ? '#d08a00' : skin.shade;
  if (skin.glow || golden) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.2);
    g.addColorStop(0, (golden ? '#fff3a0' : skin.glow!) + 'aa');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  grad.addColorStop(0, lighten(body, 0.35));
  grad.addColorStop(0.55, body);
  grad.addColorStop(1, shade);
  ctx.fillStyle = grad;
  ctx.strokeStyle = shade;
  ctx.lineWidth = 3;
  if (skin.shape === 'square' && !golden) {
    roundRect(ctx, cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8, r * 0.35);
    ctx.fill();
    ctx.stroke();
  } else if (skin.shape === 'star' && !golden) {
    starPath(ctx, cx, cy + 2, r * 1.05, r * 0.6, 5);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Glossy highlight
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy - r * 0.5, r * 0.28, r * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fill();
  eyes(ctx, cx, cy, r);
  if (golden) {
    // Crown
    ctx.fillStyle = '#fff6b0';
    ctx.strokeStyle = '#b87900';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const top = cy - r * 1.05;
    ctx.moveTo(cx - r * 0.5, top + r * 0.35);
    ctx.lineTo(cx - r * 0.5, top);
    ctx.lineTo(cx - r * 0.25, top + r * 0.18);
    ctx.lineTo(cx, top - r * 0.1);
    ctx.lineTo(cx + r * 0.25, top + r * 0.18);
    ctx.lineTo(cx + r * 0.5, top);
    ctx.lineTo(cx + r * 0.5, top + r * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  return c;
}

export function makeGrunt(): Sprite {
  const [c, ctx] = canvas();
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 2;
  const r = SIZE * 0.36;
  ctx.fillStyle = COLORS.enemyDark;
  starPath(ctx, cx, cy, r * 1.25, r * 0.9, 10);
  ctx.fill();
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ff8a92');
  g.addColorStop(0.6, COLORS.enemy);
  g.addColorStop(1, COLORS.enemyDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  eyes(ctx, cx, cy, r, true, 0.3);
  // Frown
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.62, r * 0.3, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  return c;
}

export function makeBrute(): Sprite {
  const [c, ctx] = canvas(96, 96);
  const cx = 48;
  const cy = 52;
  const r = 34;
  // Horns
  ctx.fillStyle = '#f3e3c2';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.5, cy - r * 0.6);
    ctx.quadraticCurveTo(cx + s * r * 1.25, cy - r * 1.0, cx + s * r * 1.05, cy - r * 1.35);
    ctx.quadraticCurveTo(cx + s * r * 0.95, cy - r * 0.9, cx + s * r * 0.2, cy - r * 0.75);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ff6b7c');
  g.addColorStop(0.6, COLORS.brute);
  g.addColorStop(1, '#6d0f1f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  eyes(ctx, cx, cy, r, true, 0.3);
  // Teeth
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy + r * 0.4);
  for (let i = 0; i <= 6; i++) ctx.lineTo(cx - r * 0.45 + (i * r * 0.9) / 6, cy + r * (i % 2 === 0 ? 0.4 : 0.62));
  ctx.closePath();
  ctx.fill();
  return c;
}

export function makeCoin(): Sprite {
  const [c, ctx] = canvas(32, 32);
  ctx.fillStyle = COLORS.coinDark;
  ctx.beginPath();
  ctx.arc(16, 17, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.coin;
  ctx.beginPath();
  ctx.arc(16, 15, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff2a8';
  ctx.font = '900 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 16, 16);
  return c;
}

export function makeGem(): Sprite {
  const [c, ctx] = canvas(32, 32);
  ctx.fillStyle = COLORS.gem;
  ctx.strokeStyle = '#0a7fa6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, 3);
  ctx.lineTo(28, 12);
  ctx.lineTo(16, 29);
  ctx.lineTo(4, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(16, 5);
  ctx.lineTo(22, 12);
  ctx.lineTo(16, 12);
  ctx.closePath();
  ctx.fill();
  return c;
}

export function makeSaw(): Sprite {
  const [c, ctx] = canvas();
  const cx = 32;
  const cy = 32;
  ctx.fillStyle = '#9aa3b5';
  starPath(ctx, cx, cy, 31, 24, 14);
  ctx.fill();
  ctx.fillStyle = '#d7dce6';
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.hazardGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7b8396';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
    ctx.lineTo(cx + Math.cos(a) * 19, cy + Math.sin(a) * 19);
    ctx.stroke();
  }
  return c;
}

export function makeOrb(kind: 'surge' | 'champion'): Sprite {
  const [c, ctx] = canvas();
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  const col = kind === 'surge' ? COLORS.surge : '#ffb300';
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.4, col);
  g.addColorStop(1, 'rgba(255,200,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = COLORS.ink;
  ctx.font = '900 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(kind === 'surge' ? '⚡' : '♛', 32, 34);
  return c;
}

export function makeStripes(a: string, b: string): HTMLCanvasElement {
  const [c, ctx] = canvas(24, 24);
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 24, 24);
  ctx.fillStyle = b;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(12, 0);
  ctx.lineTo(0, 12);
  ctx.closePath();
  ctx.moveTo(24, 0);
  ctx.lineTo(24, 12);
  ctx.lineTo(12, 24);
  ctx.lineTo(0, 24);
  ctx.closePath();
  ctx.fill();
  return c;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export class SpriteBank {
  blip!: Sprite;
  champion!: Sprite;
  grunt = makeGrunt();
  brute = makeBrute();
  coin = makeCoin();
  gem = makeGem();
  saw = makeSaw();
  surgeOrb = makeOrb('surge');
  championOrb = makeOrb('champion');
  hazardStripes = makeStripes('#ffd400', '#2b2140');
  bosses: Record<string, Sprite> = {
    stomper: makeBoss('#ff5a3c', '#8a1a0c', 'horns'),
    spawner: makeBoss('#b04dff', '#4b107a', 'eyes'),
    sweeper: makeBoss('#3ccf5a', '#12602a', 'spikes'),
  };
  private skinId = '';

  setSkin(skin: Skin): void {
    if (skin.id === this.skinId) return;
    this.skinId = skin.id;
    this.blip = makeBlip(skin);
    this.champion = makeBlip(skin, true);
  }
}

export function makeBoss(body: string, dark: string, variant: 'horns' | 'eyes' | 'spikes'): Sprite {
  const [c, ctx] = canvas(160, 160);
  const cx = 80;
  const cy = 88;
  const r = 60;
  if (variant === 'horns') {
    ctx.fillStyle = '#f7e7c6';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * r * 0.45, cy - r * 0.65);
      ctx.quadraticCurveTo(cx + s * r * 1.3, cy - r * 0.95, cx + s * r * 1.1, cy - r * 1.35);
      ctx.quadraticCurveTo(cx + s * r * 0.95, cy - r * 0.95, cx + s * r * 0.15, cy - r * 0.8);
      ctx.fill();
    }
  } else if (variant === 'spikes') {
    ctx.fillStyle = dark;
    starPath(ctx, cx, cy, r * 1.28, r * 0.95, 12);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, lighten(body, 0.4));
  g.addColorStop(0.6, body);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  if (variant === 'eyes') {
    for (const [ox, oy, rr] of [
      [-0.35, -0.2, 0.2],
      [0.35, -0.2, 0.2],
      [0, -0.45, 0.16],
      [-0.6, 0.1, 0.12],
      [0.6, 0.1, 0.12],
    ]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx + ox * r, cy + oy * r, rr * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath();
      ctx.arc(cx + ox * r, cy + oy * r + rr * r * 0.3, rr * r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    eyes(ctx, cx, cy, r, true, 0.3);
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy + r * 0.38);
  for (let i = 0; i <= 8; i++) ctx.lineTo(cx - r * 0.5 + (i * r) / 8, cy + r * (i % 2 === 0 ? 0.38 : 0.6));
  ctx.closePath();
  ctx.fill();
  return c;
}
