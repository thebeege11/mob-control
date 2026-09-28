import { TUNING } from '../config/tuning';
import { Ev, type EventQueue } from './SimEvents';

const C = TUNING.combo;

/**
 * Score + combo. Consecutive successes build the combo count; tiers give a
 * score multiplier (x1..x6). Mistakes drop ONE tier (meaningful, not devastating).
 */
export class ScoreManager {
  score = 0;
  combo = 0;
  bestCombo = 0;
  multiplier = 1;
  private idle = 0;
  private overflowAcc = 0;

  constructor(private events: EventQueue) {}

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.multiplier = 1;
    this.idle = 0;
  }

  static multiplierFor(combo: number): number {
    let m = 1;
    for (const t of C.tiers) if (combo >= t) m++;
    return m;
  }

  add(points: number, x = 0, y = 0, useCombo = true): number {
    const p = Math.round(points * (useCombo ? this.multiplier : 1));
    this.score += p;
    void x;
    void y;
    return p;
  }

  /** A successful action: increments the combo. */
  success(x: number, y: number): void {
    this.combo++;
    this.idle = 0;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const m = ScoreManager.multiplierFor(this.combo);
    if (m > this.multiplier) this.events.push(Ev.Combo, x, y, m, this.combo);
    this.multiplier = m;
  }

  /** A mistake: drop to the start of the previous tier. */
  mistake(x: number, y: number): void {
    if (this.combo === 0) return;
    const tiers = C.tiers;
    let floor = 0;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (this.combo >= tiers[i]) {
        floor = i > 0 ? tiers[i - 1] : 0;
        break;
      }
    }
    const before = this.multiplier;
    this.combo = floor;
    this.multiplier = ScoreManager.multiplierFor(this.combo);
    this.events.push(Ev.ComboBreak, x, y, this.multiplier, before);
  }

  overflow(n: number): void {
    this.overflowAcc += n;
  }

  update(dt: number): void {
    if (this.combo > 0) {
      this.idle += dt;
      if (this.idle > C.comboTimeout) {
        this.idle = 0;
        this.mistake(0, 0);
      }
    }
  }
}
