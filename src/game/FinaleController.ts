import { TUNING } from '../config/tuning';
import { clamp, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import type { LevelPlan } from '../gen/types';
import type { EnemyManager } from './EnemyManager';
import type { Finale } from './entities';
import { Ev, type EventQueue } from './SimEvents';
import type { UnitManager } from './UnitManager';

const H = TUNING.world.trackHalfWidth;
export const ARENA_DISTANCE = 150;
export const BOSS_NAMES: Record<string, string> = { stomper: 'COLOSSUS', spawner: 'BROODMOTHER', sweeper: 'RAMPAGER' };

/**
 * End-of-level encounter. Fortress: a wall with HP the swarm grinds down.
 * Boss: an "oh no, this is different" encounter with one readable twist
 * (telegraphed stomps, minion waves, or fast side-to-side movement).
 */
export class FinaleController {
  f!: Finale;
  arena = false;
  private hitAcc = 0;
  private hitTimer = 0;
  private difficulty = 1;
  private gruntHp = 10;
  private gruntAtk = 10;
  private spawnGroup = 100000;
  time = 0;

  constructor(private events: EventQueue) {}

  load(plan: LevelPlan): void {
    const s = plan.finale;
    this.f = {
      kind: s.kind,
      bossType: s.bossType,
      x: 0,
      y: s.y,
      width: s.kind === 'fortress' ? H * 2 : s.width,
      hp: s.hp,
      maxHp: s.hp,
      atk: s.atk,
      destroyed: false,
      flash: 0,
      timer: 2.2,
      stompX: 0,
      stompWarn: 0,
      stompR: 64,
      shake: 0,
    };
    this.arena = false;
    this.hitAcc = 0;
    this.hitTimer = 0;
    this.time = 0;
    this.difficulty = plan.difficulty;
    this.gruntHp = TUNING.combat.gruntBaseHp * (plan.player.power / 10) * 0.8;
    this.gruntAtk = s.atk * 0.8;
  }

  /** The y the swarm presses against. */
  faceY(): number {
    return this.f.y;
  }

  update(dt: number, units: UnitManager, enemies: EnemyManager, rng: Rng, damageMult: number, invulnerable: boolean): void {
    const f = this.f;
    if (f.flash > 0) f.flash -= dt;
    if (f.shake > 0) f.shake -= dt;
    if (!this.arena && units.cy >= f.y - ARENA_DISTANCE) {
      this.arena = true;
      this.events.push(Ev.ArenaEnter, 0, f.y, f.kind === 'boss' ? 1 : 0);
    }
    if (!this.arena || f.destroyed) return;
    this.time += dt;

    // ---- Boss behaviour ----
    if (f.kind === 'boss') {
      const t = this.time;
      if (f.bossType === 'sweeper') {
        const period = lerp(4.2, 2.6, clamp((this.difficulty - 5) / 25, 0, 1));
        f.x = (H - f.width / 2 - 6) * Math.sin((t / period) * Math.PI * 2);
      } else {
        f.x = 60 * Math.sin(t * 0.7);
      }
      if (f.bossType === 'stomper') {
        if (f.stompWarn > 0) {
          f.stompWarn -= dt;
          if (f.stompWarn <= 0) {
            // STOMP: telegraphed area kills.
            f.shake = 0.3;
            this.events.push(Ev.BossStomp, f.stompX, f.y - 50, f.stompR);
            if (!invulnerable) {
              const sy = f.y - 50;
              for (let i = 0; i < units.count; i++) {
                const u = units.units[i];
                const dx = u.x - f.stompX;
                const dy = (u.y - sy) * 1.4;
                if (dx * dx + dy * dy < f.stompR * f.stompR) {
                  this.events.push(Ev.UnitDie, u.x, u.y, u.weight, 0);
                  units.kill(u);
                }
              }
              units.compact();
            }
          }
        } else {
          f.timer -= dt;
          if (f.timer <= 0) {
            f.timer = lerp(3.4, 2.2, clamp((this.difficulty - 5) / 25, 0, 1));
            f.stompX = clamp(units.cx + rng.range(-20, 20), -H + 40, H - 40);
            f.stompWarn = lerp(1.1, 0.8, clamp((this.difficulty - 5) / 25, 0, 1));
            this.events.push(Ev.BossStompWarn, f.stompX, f.y - 50, f.stompR);
          }
        }
      } else if (f.bossType === 'spawner') {
        f.timer -= dt;
        if (f.timer <= 0) {
          f.timer = lerp(3.2, 2.2, clamp((this.difficulty - 5) / 25, 0, 1));
          const n = 5 + Math.floor(rng.range(0, 4));
          const g = ++this.spawnGroup;
          for (let i = 0; i < n; i++) enemies.spawn('grunt', f.x + rng.range(-60, 60), f.y - 30 - rng.range(0, 20), this.gruntHp, this.gruntAtk, g);
          this.events.push(Ev.BossSpawn, f.x, f.y - 30, n);
        }
      }
    }

    // ---- Contact damage (units grind against the face) ----
    const face = f.y;
    const half = f.width / 2;
    const rate = TUNING.combat.finaleContactRate * dt;
    let dealt = 0;
    for (let i = 0; i < units.count; i++) {
      const u = units.units[i];
      if (!u.alive) continue;
      if (u.y + u.radius < face - 1.5) continue;
      if (Math.abs(u.x - f.x) > half + u.radius * 0.5) continue;
      const champ = u.champion ? 8 : 1;
      const d = units.stats.power * u.weight * champ * damageMult * rate;
      f.hp -= d;
      dealt += d;
      const lost = units.damage(u, f.atk * rate);
      if (lost > 0) this.events.push(Ev.UnitDie, u.x, u.y, lost, 1);
      u.vy = -60; // little bounce for readability
    }
    units.compact();
    if (dealt > 0) {
      f.flash = 0.06;
      this.hitAcc += dealt;
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) {
        this.hitTimer = 0.12;
        this.events.push(Ev.FinaleHit, f.x + rng.range(-half * 0.6, half * 0.6), face, this.hitAcc);
        this.hitAcc = 0;
      }
    }
    if (f.hp <= 0) {
      f.hp = 0;
      f.destroyed = true;
      this.events.push(Ev.FinaleDestroyed, f.x, face, f.kind === 'boss' ? 1 : 0);
    }
  }
}
