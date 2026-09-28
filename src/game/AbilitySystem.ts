import { TUNING } from '../config/tuning';
import type { PlayerStats } from '../gen/types';
import { Ev, type EventQueue } from './SimEvents';

const A = TUNING.ability;

/**
 * SURGE: one active ability. The meter charges from combos, kills and gate
 * gains. When full the player taps to go golden: invulnerable to hazards and
 * dealing x3 damage for a few seconds.
 */
export class AbilitySystem {
  meter = 0;
  active = 0;
  unlocked = false;
  private stats!: PlayerStats;

  constructor(private events: EventQueue) {}

  reset(stats: PlayerStats, level: number): void {
    this.stats = stats;
    this.meter = 0;
    this.active = 0;
    this.unlocked = level >= A.unlockLevel;
  }

  get ready(): boolean {
    return this.unlocked && this.meter >= 1 && this.active <= 0;
  }

  get damageMult(): number {
    return this.active > 0 ? A.damageMult : 1;
  }

  charge(amount: number): void {
    if (!this.unlocked || this.active > 0) return;
    const was = this.meter >= 1;
    this.meter = Math.min(1, this.meter + amount * this.stats.surgeChargeMult);
    if (!was && this.meter >= 1) this.events.push(Ev.SurgeReady);
  }

  fill(): void {
    if (!this.unlocked) return;
    this.charge(10);
  }

  activate(): boolean {
    if (!this.ready) return false;
    this.meter = 0;
    this.active = this.stats.surgeDuration;
    this.events.push(Ev.SurgeStart, 0, 0, this.active);
    return true;
  }

  update(dt: number): void {
    if (this.active > 0) {
      this.active -= dt;
      if (this.active <= 0) {
        this.active = 0;
        this.events.push(Ev.SurgeEnd);
      }
    }
  }
}
