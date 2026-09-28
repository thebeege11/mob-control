/**
 * One-finger controls:
 *   DRAG anywhere  → steer (relative, so the thumb can stay where it's comfy)
 *   HOLD           → squeeze the swarm tight (release to spread out)
 *   DOUBLE-TAP / ⚡ button → SURGE
 * Keyboard fallback for desktop testing: ←/→ or A/D steer, Space squeeze, E surge.
 */
import { TUNING } from '../config/tuning';
import type { SimInput } from './Simulation';

export interface ControllerHooks {
  /** Pixels per world unit at the swarm's depth. */
  pxPerUnit: () => number;
  currentX: () => number;
  surgeButton: () => { x: number; y: number; r: number };
  onTap: () => void;
  onSurge: () => void;
  enabled: () => boolean;
}

export class PlayerController {
  targetX = 0;
  squeeze = false;
  private pointerId: number | null = null;
  private startPx = 0;
  private startTarget = 0;
  private lastTapAt = 0;
  private lastTapX = 0;
  private keys = new Set<string>();
  private moved = 0;

  constructor(el: HTMLElement, private hooks: ControllerHooks) {
    el.addEventListener('pointerdown', this.down, { passive: false });
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'e') this.hooks.onSurge();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  reset(x = 0): void {
    this.targetX = x;
    this.squeeze = false;
    this.pointerId = null;
  }

  private down = (e: PointerEvent): void => {
    e.preventDefault();
    const b = this.hooks.surgeButton();
    const dx = e.clientX - b.x;
    const dy = e.clientY - b.y;
    if (this.hooks.enabled() && dx * dx + dy * dy < b.r * b.r) {
      this.hooks.onSurge();
      return;
    }
    const now = performance.now();
    if (now - this.lastTapAt < 280 && Math.abs(e.clientX - this.lastTapX) < 40) this.hooks.onSurge();
    this.lastTapAt = now;
    this.lastTapX = e.clientX;
    this.hooks.onTap();
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.startPx = e.clientX;
    this.startTarget = this.hooks.currentX();
    this.targetX = this.startTarget;
    this.squeeze = true;
    this.moved = 0;
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const px = this.hooks.pxPerUnit();
    const dx = (e.clientX - this.startPx) / px;
    this.moved = Math.max(this.moved, Math.abs(dx));
    const H = TUNING.world.trackHalfWidth;
    this.targetX = Math.max(-H, Math.min(H, this.startTarget + dx * TUNING.swarm.dragSensitivity));
    // Re-anchor when pinned at the edge so reversing direction responds instantly.
    if (Math.abs(this.targetX) >= H) {
      this.startPx = e.clientX;
      this.startTarget = this.targetX;
    }
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.squeeze = false;
  };

  apply(input: SimInput, dt: number): void {
    const H = TUNING.world.trackHalfWidth;
    let k = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) k -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) k += 1;
    if (k !== 0) this.targetX = Math.max(-H, Math.min(H, this.targetX + k * 420 * dt));
    input.targetX = this.targetX;
    input.squeeze = this.squeeze || this.keys.has(' ');
  }
}
