/**
 * Simulation — the complete, deterministic, headless game world for one run.
 * Rendering/audio/UI only *read* it and consume its events, so the same code
 * runs in the browser and in automated balance tests (with a bot).
 */
import { TUNING } from '../config/tuning';
import { clamp } from '../core/math';
import { Rng, hashSeed } from '../core/rng';
import { speedAt } from '../gen/FairnessValidator';
import type { EnemySpec, HintSpec, LevelPlan } from '../gen/types';
import { AbilitySystem } from './AbilitySystem';
import { EnemyManager } from './EnemyManager';
import type { Enemy, Pickup } from './entities';
import { FinaleController } from './FinaleController';
import { ObstacleManager } from './ObstacleManager';
import { ScoreManager } from './ScoreManager';
import { Ev, EventQueue } from './SimEvents';
import { UnitManager } from './UnitManager';

const S = TUNING.score;
const A = TUNING.ability;

export type SimPhase = 'ready' | 'running' | 'arena' | 'victory' | 'won' | 'failed';

export interface SimInput {
  /** Desired swarm centre x (world units). */
  targetX: number;
  squeeze: boolean;
  /** Edge-triggered: set true for one step to activate Surge. */
  surge: boolean;
}

export interface RunStats {
  score: number;
  bestCombo: number;
  kills: number;
  coins: number;
  gems: number;
  perfects: number;
  nearMisses: number;
  maxSoldiers: number;
  soldiersGained: number;
  soldiersLost: number;
  progress: number;
  survivors: number;
  finaleHpLeft: number;
  finaleHpMax: number;
  time: number;
  champions: number;
  surgesUsed: number;
  lostToHazards: number;
  deathCause: 'none' | 'hazard' | 'enemy' | 'gate' | 'finale';
}

export class Simulation {
  readonly events = new EventQueue(2048);
  readonly units = new UnitManager();
  readonly enemies = new EnemyManager(this.events);
  readonly obstacles = new ObstacleManager(this.events);
  readonly score = new ScoreManager(this.events);
  readonly ability = new AbilitySystem(this.events);
  readonly finale = new FinaleController(this.events);
  readonly input: SimInput = { targetX: 0, squeeze: false, surge: false };

  plan!: LevelPlan;
  phase: SimPhase = 'ready';
  time = 0;
  shield = 0;
  victoryTimer = 0;
  coins = 0;
  gems = 0;
  perfects = 0;
  nearMisses = 0;
  maxSoldiers = 0;
  champions = 0;
  surgesUsed = 0;
  revives = 0;
  lastLossCause: RunStats['deathCause'] = 'none';
  private rng = new Rng(1);
  private hints: HintSpec[] = [];
  private hintIdx = 0;
  private distAcc = 0;
  private boostTimer = 0;
  /** Returns true if a tutorial hint should be shown (not seen yet). */
  hintFilter: (key: string) => boolean = () => true;

  load(plan: LevelPlan): void {
    this.plan = plan;
    this.rng = new Rng(hashSeed(plan.seed, 77));
    this.events.clear();
    this.phase = 'ready';
    this.time = 0;
    this.shield = 0;
    this.victoryTimer = 0;
    this.coins = 0;
    this.gems = 0;
    this.perfects = 0;
    this.nearMisses = 0;
    this.champions = 0;
    this.surgesUsed = 0;
    this.revives = 0;
    this.distAcc = 0;
    this.boostTimer = 0;
    this.lastLossCause = 'none';
    this.input.targetX = 0;
    this.input.squeeze = false;
    this.input.surge = false;
    this.units.reset(plan.player, 0);
    this.units.addSoldiers(plan.player.startUnits, 0, 0, this.rng);
    // Settle the starting blob into formation instantly.
    for (let i = 0; i < 30; i++) this.units.update(1 / 60, 0, false, Infinity);
    this.maxSoldiers = this.units.soldiers;
    const enemies: EnemySpec[] = [];
    this.hints = [];
    for (const s of plan.segments) for (const e of s.entities) {
      if (e.t === 'enemy') enemies.push(e);
      else if (e.t === 'hint') this.hints.push(e);
    }
    this.hints.sort((a, b) => a.y - b.y);
    this.hintIdx = 0;
    this.enemies.load(enemies);
    this.obstacles.load(plan);
    this.score.reset();
    this.ability.reset(plan.player, plan.level);
    this.finale.load(plan);
  }

  start(): void {
    if (this.phase === 'ready') this.phase = 'running';
  }

  get progress(): number {
    return clamp(this.units.cy / this.plan.finale.y, 0, 1);
  }

  get finished(): boolean {
    return this.phase === 'won' || this.phase === 'failed';
  }

  get invulnerable(): boolean {
    return this.ability.active > 0 || this.shield > 0;
  }

  /** Continue after failure (rewarded ad / gems). */
  revive(): void {
    if (this.phase !== 'failed') return;
    this.revives++;
    const n = Math.max(12, Math.ceil(this.plan.player.startUnits * 1.5), Math.ceil(this.maxSoldiers * 0.35));
    this.units.addSoldiers(n, this.units.cx, this.units.cy, this.rng);
    this.shield = 2.5;
    this.phase = this.finale.arena ? 'arena' : 'running';
    this.events.push(Ev.UnitSpawn, this.units.cx, this.units.cy, n);
  }

  step(dt: number): void {
    if (this.phase === 'ready' || this.phase === 'won' || this.phase === 'failed') return;
    this.time += dt;
    const u = this.units;
    const f = this.finale;

    if (this.phase === 'victory') {
      this.victoryTimer -= dt;
      u.cy += 260 * dt;
      u.update(dt, 260, false, Infinity);
      if (this.victoryTimer <= 0) {
        this.phase = 'won';
        this.events.push(Ev.Win);
      }
      return;
    }

    // ---- Input → swarm centre ----
    if (this.input.surge) {
      this.input.surge = false;
      if (this.ability.activate()) this.surgesUsed++;
    }
    const H = TUNING.world.trackHalfWidth;
    const target = clamp(this.input.targetX, -H + 8, H - 8);
    const maxMove = TUNING.swarm.maxLateralSpeed * dt;
    u.cx += clamp(target - u.cx, -maxMove, maxMove);

    // ---- Forward motion ----
    let forward = 0;
    const face = f.faceY();
    if (!f.arena) {
      forward = speedAt(u.cy, this.plan.baseSpeed, this.plan.speedZones);
      if (forward > this.plan.baseSpeed * 1.05) {
        if (this.boostTimer <= 0) this.events.push(Ev.Boost, u.cx, u.cy);
        this.boostTimer = 0.5;
      } else if (this.boostTimer > 0) this.boostTimer -= dt;
      u.cy += forward * dt;
      this.distAcc += forward * dt;
      while (this.distAcc >= 100) {
        this.distAcc -= 100;
        this.score.add(S.distancePer100, 0, 0, false);
      }
    } else {
      // Arena: the whole crowd charges the face; separation turns it into a
      // queue that feeds forward as the front row falls.
      const stop = face - 40;
      u.cy += clamp(stop - u.cy, -220 * dt, 220 * dt);
    }
    u.update(dt, forward, this.input.squeeze, face, f.arena);

    if (this.shield > 0) this.shield -= dt;
    this.ability.update(dt);
    this.score.update(dt);

    // ---- Hints ----
    while (this.hintIdx < this.hints.length && this.hints[this.hintIdx].y < u.cy + 420) {
      const h = this.hints[this.hintIdx++];
      if (this.hintFilter(h.key)) this.events.push(Ev.Hint, 0, h.y, 0, 0, h.key + '|' + h.text);
    }

    // ---- World systems ----
    const before = u.soldiers;
    const hazBefore = this.obstacles.soldiersLostToHazards;
    this.obstacles.update(dt, this.time, u, this.rng, {
      invulnerable: () => this.invulnerable,
      gateBonus: this.plan.player.gateBonus,
      onGateRow: (gain, loss, x, y) => this.onGateRow(gain, loss, x, y),
      onHazardSegment: (perfect, near, lossFrac, x, y) => this.onHazardSegment(perfect, near, lossFrac, x, y),
      onPickup: (p) => this.onPickup(p),
    });
    const afterObstacles = u.soldiers;
    if (afterObstacles < before) this.lastLossCause = this.obstacles.soldiersLostToHazards > hazBefore ? 'hazard' : 'gate';
    this.enemies.update(dt, u, {
      damageMult: () => this.ability.damageMult,
      onKill: (e) => this.onKill(e),
      onGroupCleared: (_g, x, y) => {
        this.score.success(x, y);
        this.ability.charge(A.chargePerCombo);
        this.events.push(Ev.GroupCleared, x, y);
      },
    });
    if (u.soldiers < afterObstacles) this.lastLossCause = 'enemy';
    const beforeFinale = u.soldiers;
    f.update(dt, u, this.enemies, this.rng, this.ability.damageMult, this.invulnerable);
    if (u.soldiers < beforeFinale) this.lastLossCause = 'finale';
    if (f.arena && this.phase === 'running') this.phase = 'arena';

    if (u.soldiers > this.maxSoldiers) this.maxSoldiers = u.soldiers;

    // ---- Outcome ----
    if (f.f.destroyed) {
      this.phase = 'victory';
      this.victoryTimer = 1.1;
      const survivors = u.soldiers;
      this.score.add((f.f.kind === 'boss' ? S.boss : S.fortress) + survivors * S.survivor, f.f.x, face);
      return;
    }
    if (u.soldiers <= 0 || u.count === 0) {
      u.soldiers = 0;
      this.phase = 'failed';
      this.events.push(Ev.Fail, u.cx, u.cy);
    }
  }

  private onGateRow(gain: number, loss: number, x: number, y: number): void {
    if (gain > 0) {
      this.score.add(gain * S.unitGained, x, y);
      this.score.success(x, y);
      this.ability.charge(A.chargePerCombo + Math.min(0.2, gain * A.chargePerGateUnit));
      this.events.push(Ev.Gate, x, y, gain, 1);
    }
    if (loss > 0) {
      this.score.mistake(x, y);
      this.events.push(Ev.GateBad, x, y, loss, 1);
    }
  }

  private onHazardSegment(perfect: boolean, near: boolean, lossFrac: number, x: number, y: number): void {
    if (perfect) {
      this.perfects++;
      this.score.add(S.perfectHazard, x, y);
      this.score.success(x, y);
      this.ability.charge(A.chargePerCombo);
      this.events.push(Ev.Perfect, x, y);
      if (near) {
        this.nearMisses++;
        this.score.add(S.nearMiss, x, y);
        this.events.push(Ev.NearMiss, x, y);
      }
    } else if (lossFrac > 0.15) {
      this.score.mistake(x, y);
    }
  }

  private onKill(e: Enemy): void {
    const isCrate = e.kind === 'crate' || e.kind === 'gemcrate';
    if (isCrate) {
      this.score.add(S.crateBreak, e.x, e.y);
      this.score.success(e.x, e.y);
      this.coins += TUNING.economy.crateCoins;
      if (e.kind === 'gemcrate') this.gems += 1;
    } else {
      this.score.add(e.kind === 'brute' ? S.bruteKill : S.gruntKill, e.x, e.y);
      this.ability.charge(A.chargePerKill * (e.kind === 'brute' ? 6 : 1));
      if (e.kind === 'brute') this.score.success(e.x, e.y);
    }
  }

  private onPickup(p: Pickup): void {
    switch (p.kind) {
      case 'coin':
        this.coins += TUNING.economy.pickupCoin;
        this.score.add(5, p.x, p.y, false);
        this.events.push(Ev.Coin, p.x, p.y);
        break;
      case 'surge':
        this.ability.fill();
        this.events.push(Ev.SurgeOrb, p.x, p.y);
        break;
      case 'champion': {
        const c = this.units.makeChampion();
        if (c) {
          this.champions++;
          this.events.push(Ev.Champion, c.x, c.y);
        }
        break;
      }
    }
  }

  stats(): RunStats {
    const f = this.finale.f;
    return {
      score: this.score.score,
      bestCombo: this.score.bestCombo,
      kills: this.enemies.kills,
      coins: this.coins,
      gems: this.gems,
      perfects: this.perfects,
      nearMisses: this.nearMisses,
      maxSoldiers: this.maxSoldiers,
      soldiersGained: this.obstacles.soldiersGained,
      soldiersLost: this.obstacles.soldiersLostToHazards + this.obstacles.soldiersLostToGates + this.enemies.soldiersLost,
      progress: this.phase === 'won' || this.phase === 'victory' ? 1 : this.finale.arena ? 0.9 + 0.1 * (1 - f.hp / f.maxHp) : this.progress * 0.9,
      survivors: this.units.soldiers,
      finaleHpLeft: f.hp,
      finaleHpMax: f.maxHp,
      time: this.time,
      champions: this.champions,
      surgesUsed: this.surgesUsed,
      lostToHazards: this.obstacles.soldiersLostToHazards,
      deathCause: this.phase === 'failed' ? this.lastLossCause : 'none',
    };
  }
}
