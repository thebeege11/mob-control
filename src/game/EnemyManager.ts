import { TUNING } from '../config/tuning';
import type { EnemyKind, EnemySpec } from '../gen/types';
import { Enemy } from './entities';
import { Ev, type EventQueue } from './SimEvents';
import type { UnitManager } from './UnitManager';

const C = TUNING.combat;
const W = TUNING.world;

export interface CombatHooks {
  damageMult: () => number;
  onKill: (e: Enemy) => void;
  onGroupCleared: (group: number, x: number, y: number) => void;
}

/**
 * Enemies & destructibles: pooled, activated as the swarm approaches,
 * walking into the swarm, and resolved with continuous contact combat.
 */
export class EnemyManager {
  readonly pool: Enemy[] = [];
  count = 0;
  private next = 0;
  private groupAlive = new Map<number, number>();
  private groupPos = new Map<number, { x: number; y: number }>();
  /** Soldiers lost to enemies this run. */
  soldiersLost = 0;
  kills = 0;

  constructor(private events: EventQueue) {}

  load(specs: readonly EnemySpec[]): void {
    this.count = 0;
    this.next = 0;
    this.soldiersLost = 0;
    this.kills = 0;
    this.groupAlive.clear();
    this.groupPos.clear();
    const sorted = specs.slice().sort((a, b) => a.y - b.y);
    for (const s of sorted) {
      const e = this.alloc();
      e.kind = s.kind;
      e.x = s.x;
      e.y = s.y;
      e.r = s.r;
      e.hp = e.maxHp = s.hp;
      e.atk = s.atk;
      e.group = s.group;
      e.alive = true;
      e.active = false;
      e.aggro = false;
      e.spawned = false;
      this.groupAlive.set(s.group, (this.groupAlive.get(s.group) ?? 0) + 1);
    }
  }

  private alloc(): Enemy {
    if (this.count >= this.pool.length) this.pool.push(new Enemy());
    const e = this.pool[this.count++];
    e.vx = e.vy = 0;
    e.flash = 0;
    e.age = 0;
    return e;
  }

  /** Runtime spawn (boss minions). */
  spawn(kind: EnemyKind, x: number, y: number, hp: number, atk: number, group: number): void {
    // Reuse a dead slot if available to keep the pool bounded.
    let e: Enemy | undefined;
    for (let i = 0; i < this.count; i++) {
      if (!this.pool[i].alive) {
        e = this.pool[i];
        break;
      }
    }
    if (!e) {
      if (this.count >= W.maxEnemies * 2) return;
      e = this.alloc();
    }
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.r = kind === 'brute' ? C.bruteRadius : C.gruntRadius;
    e.hp = e.maxHp = hp;
    e.atk = atk;
    e.group = group;
    e.alive = true;
    e.active = true;
    e.aggro = true;
    e.spawned = true;
    e.age = 0;
    e.flash = 0;
    this.groupAlive.set(group, (this.groupAlive.get(group) ?? 0) + 1);
  }

  aliveInGroup(group: number): number {
    return this.groupAlive.get(group) ?? 0;
  }

  update(dt: number, units: UnitManager, hooks: CombatHooks): void {
    const cy = units.cy;
    const cx = units.cx;
    const activateY = cy + W.viewAhead + 60;
    // Activation (pool is sorted by y for planned enemies).
    while (this.next < this.count && this.pool[this.next].y < activateY) {
      this.pool[this.next].active = true;
      this.next++;
    }
    const rate = C.contactRate * dt;
    const dmgMult = hooks.damageMult();
    const H = W.trackHalfWidth;
    for (let i = 0; i < this.count; i++) {
      const e = this.pool[i];
      if (!e.alive || !e.active) continue;
      e.age += dt;
      if (e.flash > 0) e.flash -= dt;
      const isCrate = e.kind === 'crate' || e.kind === 'gemcrate';
      // Movement: walk at the swarm once close.
      if (!isCrate) {
        if (!e.aggro && e.y - cy < C.enemyAggroDistance) e.aggro = true;
        if (e.aggro) {
          const sp = e.kind === 'brute' ? C.bruteSpeed : C.gruntSpeed;
          const dx = cx - e.x;
          e.vx += ((dx > 0 ? 1 : -1) * Math.min(Math.abs(dx), 60) * 0.6 - e.vx) * Math.min(1, dt * 3);
          e.vy += (-sp - e.vy) * Math.min(1, dt * 4);
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.x < -H + e.r) e.x = -H + e.r;
          if (e.x > H - e.r) e.x = H - e.r;
        }
      }
      // Passed behind the swarm: retire.
      if (e.y < cy - 260) {
        e.alive = false;
        this.decGroup(e);
        continue;
      }
      if (e.y > cy + 220) continue;
      // Contact combat with units.
      let touched = false;
      for (let k = 0; k < units.count; k++) {
        const u = units.units[k];
        if (!u.alive) continue;
        const dx = u.x - e.x;
        const dy = u.y - e.y;
        const rr = u.radius + e.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        touched = true;
        const champ = u.champion ? 8 : 1;
        e.hp -= units.stats.power * u.weight * champ * dmgMult * rate;
        if (e.atk > 0) {
          const lost = units.damage(u, e.atk * rate);
          if (lost > 0) {
            this.soldiersLost += lost;
            this.events.push(Ev.UnitDie, u.x, u.y, lost, 1);
          }
        }
        // Separate: push the unit back out of the enemy.
        const d = Math.sqrt(d2) || 0.001;
        const push = (rr - d) / d;
        if (u.alive) {
          u.x += dx * push * 0.8;
          u.y += dy * push * 0.8;
          u.vy -= 20;
        }
        if (!isCrate) {
          e.x -= dx * push * 0.2 * (e.kind === 'brute' ? 0.2 : 1);
          e.y -= dy * push * 0.2 * (e.kind === 'brute' ? 0.2 : 1);
        }
        if (e.hp <= 0) break;
      }
      if (touched) {
        if (e.flash <= 0) this.events.push(Ev.EnemyHit, e.x, e.y, e.kind === 'brute' ? 1 : 0);
        e.flash = 0.08;
      }
      if (e.hp <= 0) {
        e.alive = false;
        this.kills++;
        this.events.push(isCrate ? Ev.CrateBreak : Ev.EnemyDie, e.x, e.y, e.kind === 'brute' ? 1 : e.kind === 'gemcrate' ? 2 : 0);
        hooks.onKill(e);
        const left = this.decGroup(e);
        if (left === 0 && !e.spawned) hooks.onGroupCleared(e.group, e.x, e.y);
      } else {
        const gp = this.groupPos.get(e.group);
        if (gp) {
          gp.x = e.x;
          gp.y = e.y;
        }
      }
    }
    units.compact();
  }

  private decGroup(e: Enemy): number {
    const left = (this.groupAlive.get(e.group) ?? 1) - 1;
    this.groupAlive.set(e.group, left);
    return left;
  }

  /** Alive, active enemies ahead within range (for bots/UI). */
  nearestAhead(y: number, range: number): Enemy | undefined {
    let best: Enemy | undefined;
    for (let i = 0; i < this.count; i++) {
      const e = this.pool[i];
      if (!e.alive || e.y < y || e.y > y + range) continue;
      if (!best || e.y < best.y) best = e;
    }
    return best;
  }
}
