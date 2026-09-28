import { TUNING } from '../config/tuning';
import type { Rng } from '../core/rng';
import type { Camera, Projected } from './Camera';

export const enum PKind {
  Dot,
  Spark,
  Chunk,
  Ring,
  Confetti,
  Smoke,
}

/** Structure-of-arrays particle pool: zero allocations after construction. */
export class Particles {
  readonly max = TUNING.juice.maxParticles;
  private x = new Float32Array(this.max);
  private y = new Float32Array(this.max);
  private h = new Float32Array(this.max);
  private vx = new Float32Array(this.max);
  private vy = new Float32Array(this.max);
  private vh = new Float32Array(this.max);
  private life = new Float32Array(this.max);
  private maxLife = new Float32Array(this.max);
  private size = new Float32Array(this.max);
  private rot = new Float32Array(this.max);
  private kind = new Uint8Array(this.max);
  private color: string[] = new Array(this.max).fill('#fff');
  count = 0;
  private p: Projected = { x: 0, y: 0, s: 1, visible: true };

  constructor(private rng: Rng) {}

  clear(): void {
    this.count = 0;
  }

  spawn(kind: PKind, x: number, y: number, h: number, vx: number, vy: number, vh: number, life: number, size: number, color: string): void {
    let i: number;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(this.rng.next() * this.max); // overwrite a random one when full
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.h[i] = h;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vh[i] = vh;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.rot[i] = this.rng.next() * 6.28;
    this.color[i] = color;
  }

  burst(x: number, y: number, h: number, n: number, speed: number, color: string, kind: PKind = PKind.Dot, size = 3, life = 0.5, up = 120): void {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const a = r.next() * Math.PI * 2;
      const sp = speed * (0.4 + r.next() * 0.6);
      this.spawn(kind, x, y, h, Math.cos(a) * sp, Math.sin(a) * sp, up * (0.4 + r.next()), life * (0.6 + r.next() * 0.6), size * (0.6 + r.next() * 0.7), color);
    }
  }

  ring(x: number, y: number, size: number, color: string, life = 0.4): void {
    this.spawn(PKind.Ring, x, y, 1, 0, 0, 0, life, size, color);
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swap(i, --this.count);
        continue;
      }
      const k = this.kind[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (k === PKind.Chunk || k === PKind.Confetti || k === PKind.Dot) {
        this.vh[i] -= (k === PKind.Confetti ? 160 : 520) * dt;
        this.h[i] += this.vh[i] * dt;
        if (this.h[i] < 0) {
          this.h[i] = 0;
          this.vh[i] *= -0.35;
          this.vx[i] *= 0.6;
          this.vy[i] *= 0.6;
        }
        const drag = k === PKind.Confetti ? 0.96 : 0.985;
        this.vx[i] *= drag;
        this.vy[i] *= drag;
      } else if (k === PKind.Spark || k === PKind.Smoke) {
        this.h[i] += this.vh[i] * dt;
        this.vx[i] *= 0.92;
        this.vy[i] *= 0.92;
      }
      this.rot[i] += dt * 8;
      i++;
    }
  }

  private swap(a: number, b: number): void {
    this.x[a] = this.x[b];
    this.y[a] = this.y[b];
    this.h[a] = this.h[b];
    this.vx[a] = this.vx[b];
    this.vy[a] = this.vy[b];
    this.vh[a] = this.vh[b];
    this.life[a] = this.life[b];
    this.maxLife[a] = this.maxLife[b];
    this.size[a] = this.size[b];
    this.rot[a] = this.rot[b];
    this.kind[a] = this.kind[b];
    this.color[a] = this.color[b];
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const p = this.p;
    for (let i = 0; i < this.count; i++) {
      cam.project(this.x[i], this.y[i], this.h[i], p);
      if (!p.visible) continue;
      const t = this.life[i] / this.maxLife[i];
      const k = this.kind[i];
      const s = this.size[i] * p.s;
      ctx.fillStyle = this.color[i];
      switch (k) {
        case PKind.Dot:
        case PKind.Chunk: {
          ctx.globalAlpha = Math.min(1, t * 2);
          const r = s * (k === PKind.Chunk ? 1 : 0.5 + t * 0.5);
          if (k === PKind.Chunk) ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
          else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case PKind.Spark: {
          ctx.globalAlpha = t;
          const r = s * t;
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          break;
        }
        case PKind.Smoke: {
          ctx.globalAlpha = t * 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s * (1.6 - t), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case PKind.Ring: {
          ctx.globalAlpha = t;
          ctx.strokeStyle = this.color[i];
          ctx.lineWidth = Math.max(1.5, 5 * t * p.s);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, s * (1.2 - t), s * (1.2 - t) * 0.55, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case PKind.Confetti: {
          ctx.globalAlpha = Math.min(1, t * 3);
          const w = s;
          const hgt = s * 0.5 * Math.abs(Math.cos(this.rot[i]));
          ctx.fillRect(p.x - w / 2, p.y - hgt / 2, w, hgt + 0.5);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
