import { TUNING } from '../config/tuning';
import { GOLDEN_ANGLE, clamp, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import type { PlayerStats } from '../gen/types';
import { Unit } from './entities';

const W = TUNING.world;
const S = TUNING.swarm;

/** Precomputed phyllotaxis (sunflower) formation slots. */
const SLOT_X = new Float32Array(W.maxUnits);
const SLOT_Y = new Float32Array(W.maxUnits);
for (let i = 0; i < W.maxUnits; i++) {
  const r = Math.sqrt(i + 0.5);
  SLOT_X[i] = r * Math.cos(i * GOLDEN_ANGLE);
  SLOT_Y[i] = r * Math.sin(i * GOLDEN_ANGLE);
}

export function unitRadiusForWeight(w: number): number {
  return W.unitRadius * Math.min(2.4, 1 + 0.32 * Math.log2(Math.max(1, w)));
}

/**
 * Owns the player's swarm: pooled units, formation, squeeze, spawning,
 * weights (soldiers per blip) and deaths. Allocation-free after construction.
 */
export class UnitManager {
  readonly units: Unit[] = [];
  count = 0;
  /** Total soldiers (sum of weights) — the number shown to the player. */
  soldiers = 0;
  cx = 0;
  cy = 0;
  squeeze = 0;
  /** Swarm centre lateral velocity (feed-forward for units). */
  cvx = 0;
  private prevCx = 0;
  stats!: PlayerStats;
  private rr = 0;
  private dirty = false;

  constructor() {
    for (let i = 0; i < W.maxUnits; i++) this.units.push(new Unit());
  }

  reset(stats: PlayerStats, startY: number): void {
    this.stats = stats;
    this.count = 0;
    this.soldiers = 0;
    this.cx = 0;
    this.prevCx = 0;
    this.cvx = 0;
    this.cy = startY;
    this.squeeze = 0;
    for (const u of this.units) u.alive = false;
  }

  /** Current formation spacing (world units between slot rings). */
  spacing(): number {
    const n = Math.max(1, this.count);
    const sp = lerp(S.spacingLoose, S.spacingTight, this.squeeze);
    const maxR = lerp(S.maxRadiusLoose, S.maxRadiusTight, this.squeeze);
    return Math.min(sp, maxR / Math.sqrt(n));
  }

  /** Approximate formation radius (for UI / camera). */
  radius(): number {
    return this.spacing() * Math.sqrt(Math.max(1, this.count));
  }

  /** Add soldiers near (x, y). Uses new blips until the cap, then adds weight. */
  addSoldiers(n: number, x: number, y: number, rng: Rng): number {
    let left = Math.floor(n);
    let spawned = 0;
    while (left > 0 && this.count < W.maxUnits) {
      const u = this.units[this.count++];
      u.alive = true;
      u.x = clamp(x + rng.range(-10, 10), -W.trackHalfWidth + 4, W.trackHalfWidth - 4);
      u.y = y + rng.range(-4, 8);
      u.prevY = u.y;
      u.vx = rng.range(-60, 60);
      u.vy = 0;
      u.weight = 1;
      u.hp = this.stats.health;
      u.champion = false;
      u.age = 0;
      u.hurt = 0;
      u.radius = W.unitRadius;
      left--;
      spawned++;
    }
    // Physical cap reached: distribute remaining soldiers as extra weight.
    while (left > 0 && this.count > 0) {
      const u = this.units[this.rr++ % this.count];
      const add = Math.max(1, Math.ceil(left / this.count));
      const take = Math.min(add, left);
      u.weight += take;
      u.radius = unitRadiusForWeight(u.weight);
      u.age = Math.min(u.age, 0.05);
      left -= take;
    }
    this.soldiers += Math.floor(n);
    return spawned;
  }

  /** Remove up to n soldiers from blip u. Returns soldiers removed. */
  removeSoldiers(u: Unit, n: number): number {
    const take = Math.min(u.weight, n);
    u.weight -= take;
    this.soldiers -= take;
    if (u.weight <= 0) this.kill(u, false);
    else u.radius = unitRadiusForWeight(u.weight);
    return take;
  }

  /** Kill a whole blip (all its soldiers). */
  kill(u: Unit, countSoldiers = true): void {
    if (!u.alive) return;
    if (countSoldiers) this.soldiers -= u.weight;
    u.alive = false;
    u.weight = 0;
    this.dirty = true;
  }

  /** Apply damage; soldiers die one by one. Returns soldiers lost. */
  damage(u: Unit, dmg: number): number {
    let lost = 0;
    u.hp -= dmg;
    u.hurt = 0.1;
    const maxHp = this.stats.health * (u.champion ? 8 : 1);
    while (u.hp <= 0 && u.alive) {
      u.weight -= 1;
      this.soldiers -= 1;
      lost++;
      if (u.weight <= 0) {
        u.alive = false;
        this.dirty = true;
        break;
      }
      u.hp += maxHp;
      u.radius = unitRadiusForWeight(u.weight);
    }
    return lost;
  }

  makeChampion(): Unit | undefined {
    if (this.count === 0) return undefined;
    // Promote the unit nearest the centre.
    let best: Unit | undefined;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const u = this.units[i];
      if (!u.alive || u.champion) continue;
      const d = Math.abs(u.x - this.cx) + Math.abs(u.y - this.cy);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best) {
      best.champion = true;
      best.hp = this.stats.health * 8;
      best.age = 0;
    }
    return best;
  }

  // Spatial hash for crowd separation (used while charging the finale).
  private cellHead = new Int32Array(2048).fill(-1);
  private cellNext = new Int32Array(W.maxUnits);

  /** Push overlapping units apart (O(n) with a spatial hash). */
  separate(strength = 0.5): void {
    const n = this.count;
    const cs = W.unitRadius * 2.2;
    const head = this.cellHead;
    const next = this.cellNext;
    head.fill(-1);
    const key = (cx: number, cy: number) => ((cx * 73856093) ^ (cy * 19349663)) & 2047;
    for (let i = 0; i < n; i++) {
      const u = this.units[i];
      const k = key(Math.floor(u.x / cs), Math.floor(u.y / cs));
      next[i] = head[k];
      head[k] = i;
    }
    for (let i = 0; i < n; i++) {
      const a = this.units[i];
      const gx = Math.floor(a.x / cs);
      const gy = Math.floor(a.y / cs);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let j = head[key(gx + ox, gy + oy)]; j !== -1; j = next[j]) {
            if (j <= i) continue;
            const b = this.units[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const rr = (a.radius + b.radius) * 0.9;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const push = ((rr - d) / d) * strength * 0.5;
            a.x -= dx * push;
            a.y -= dy * push;
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
    }
  }

  /** Compact dead units out, preserving order (stable formation slots). */
  compact(): void {
    if (!this.dirty) return;
    let w = 0;
    for (let r = 0; r < this.count; r++) {
      const u = this.units[r];
      if (u.alive) {
        if (w !== r) {
          this.units[r] = this.units[w];
          this.units[w] = u;
        }
        w++;
      }
    }
    this.count = w;
    this.dirty = false;
  }

  /**
   * Integrate units toward formation slots around (cx, cy).
   * `frontY` is a barrier the units press against (the finale face).
   */
  update(dt: number, forward: number, squeezing: boolean, frontY: number, charge = false): void {
    const blend = dt / S.squeezeBlendTime;
    this.squeeze = clamp(this.squeeze + (squeezing ? blend : -blend), 0, 1);
    const sp = this.spacing();
    const k = S.slotStiffness;
    const c = S.slotDamping;
    const H = W.trackHalfWidth;
    const ys = S.formationYScale;
    this.cvx = dt > 0 ? (this.cx - this.prevCx) / dt : 0;
    this.prevCx = this.cx;
    const cvx = this.cvx;
    for (let i = 0; i < this.count; i++) {
      const u = this.units[i];
      u.prevY = u.y;
      u.age += dt;
      if (u.hurt > 0) u.hurt -= dt;
      const tx = this.cx + SLOT_X[i] * sp;
      u.vx += ((tx - u.x) * k + (cvx - u.vx) * c) * dt;
      if (charge) {
        // Finale: a steady crowd push into the face; separation forms the queue.
        u.vy += (110 - u.vy) * Math.min(1, dt * 8);
      } else {
        const ty = this.cy + SLOT_Y[i] * sp * ys;
        u.vy += ((ty - u.y) * k - u.vy * c) * dt;
      }
      // Cap spring speed so units don't teleport.
      if (u.vy > 420) u.vy = 420;
      if (u.vy < -420) u.vy = -420;
      u.x += u.vx * dt;
      u.y += (u.vy + forward) * dt;
      const r = u.radius;
      if (u.x < -H + r) {
        u.x = -H + r;
        u.vx = Math.abs(u.vx) * 0.3;
      } else if (u.x > H - r) {
        u.x = H - r;
        u.vx = -Math.abs(u.vx) * 0.3;
      }
      if (u.y > frontY - r) {
        u.y = frontY - r;
        if (u.vy > 0) u.vy = 0;
      }
    }
    if (charge) {
      this.separate(0.9);
      this.separate(0.9);
      for (let i = 0; i < this.count; i++) {
        const u = this.units[i];
        if (u.y > frontY - u.radius) u.y = frontY - u.radius;
      }
    }
  }
}
