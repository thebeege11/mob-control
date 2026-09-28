import { TUNING } from '../config/tuning';
import { easeOutBack } from '../core/math';
import type { Camera, Projected } from './Camera';

interface FText {
  text: string;
  x: number;
  y: number;
  h: number;
  life: number;
  max: number;
  size: number;
  color: string;
  active: boolean;
  /** Screen-space (HUD) text instead of world-anchored. */
  screen: boolean;
}

/** Pooled world-anchored floating numbers & callouts. */
export class FloatingText {
  private items: FText[] = [];
  private p: Projected = { x: 0, y: 0, s: 1, visible: true };

  constructor() {
    for (let i = 0; i < TUNING.juice.maxFloatingTexts; i++) {
      this.items.push({ text: '', x: 0, y: 0, h: 0, life: 0, max: 1, size: 20, color: '#fff', active: false, screen: false });
    }
  }

  clear(): void {
    for (const it of this.items) it.active = false;
  }

  add(text: string, x: number, y: number, h: number, color: string, size = 22, life = 0.9, screen = false): void {
    let slot = this.items.find((i) => !i.active);
    if (!slot) {
      slot = this.items[0];
      for (const it of this.items) if (it.life < slot.life) slot = it;
    }
    slot.text = text;
    slot.x = x;
    slot.y = y;
    slot.h = h;
    slot.life = life;
    slot.max = life;
    slot.size = size;
    slot.color = color;
    slot.active = true;
    slot.screen = screen;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.active) continue;
      it.life -= dt;
      it.h += dt * (it.screen ? 40 : 55);
      if (it.life <= 0) it.active = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of this.items) {
      if (!it.active) continue;
      const age = 1 - it.life / it.max;
      const pop = age < 0.2 ? easeOutBack(age / 0.2) : 1;
      let x: number;
      let y: number;
      let scale: number;
      if (it.screen) {
        x = it.x;
        y = it.y - it.h;
        scale = 1;
      } else {
        const p = cam.project(it.x, it.y, it.h, this.p);
        if (!p.visible) continue;
        x = p.x;
        y = p.y;
        scale = Math.max(0.55, Math.min(1.3, p.s / cam.scale0 / 0.85));
      }
      let size = it.size * scale * pop;
      ctx.globalAlpha = Math.min(1, it.life / (it.max * 0.35));
      ctx.font = `900 ${size.toFixed(1)}px ${FONT}`;
      if (it.screen) {
        const w = ctx.measureText(it.text).width;
        if (w > cam.W - 28) {
          size *= (cam.W - 28) / w;
          ctx.font = `900 ${size.toFixed(1)}px ${FONT}`;
        }
      }
      ctx.lineWidth = Math.max(3, size * 0.18);
      ctx.strokeStyle = 'rgba(20,10,40,0.85)';
      ctx.strokeText(it.text, x, y);
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, x, y);
    }
    ctx.globalAlpha = 1;
  }
}

export const FONT = '"Baloo 2", "Nunito", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif';
