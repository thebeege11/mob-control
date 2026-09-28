/**
 * BotController — an automated player used for balance simulation tests and
 * the attract-mode demo behind the main menu. `skill` 0..1 controls how
 * well it reads gates and how early it reacts to hazards.
 */
import { TUNING } from '../config/tuning';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { hazardBlockedIntervals, mergeIntervals } from './hazardGeometry';
import { gateStateAt } from './ObstacleManager';
import type { Simulation } from './Simulation';
import type { GateKind } from '../gen/types';

const H = TUNING.world.trackHalfWidth;

export class BotController {
  private rng: Rng;
  private decided = new Map<number, number>();
  private tmp = { kind: 'add' as GateKind, value: 0, x0: 0, x1: 0 };
  private blocked: number[] = [];

  constructor(
    private skill = 0.9,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
  }

  update(sim: Simulation): void {
    const u = sim.units;
    const cy = u.cy;
    const t = sim.time;
    const speed = Math.max(60, sim.plan.baseSpeed);
    const f = sim.finale.f;
    let desired = u.cx;
    let squeeze = false;

    // ---- Finale ----
    if (sim.finale.arena) {
      desired = f.x;
      if (f.stompWarn > 0 && Math.abs(u.cx - f.stompX) < f.stompR + u.radius() * 0.5 && !sim.invulnerable) {
        desired = f.stompX + (f.stompX > 0 ? -1 : 1) * (f.stompR + 50);
      }
      squeeze = true;
      if (sim.ability.ready) sim.input.surge = true;
      sim.input.targetX = desired;
      sim.input.squeeze = squeeze;
      return;
    }

    // ---- Next gate row: pick the best option (skill decides reliability) ----
    const soldiers = u.soldiers;
    for (const row of sim.obstacles.rows) {
      if (row.resolved || row.y < cy + 5) continue;
      if (row.y > cy + 420) break;
      const key = Math.round(row.y);
      let choice = this.decided.get(key);
      const arriveT = t + (row.y - cy) / speed;
      if (choice === undefined || row.gates.some((g) => g.spec.motion || g.spec.blink)) {
        let best = -Infinity;
        let bestX = u.cx;
        let second = u.cx;
        const opts: { v: number; x: number }[] = [];
        for (const g of row.gates) {
          gateStateAt(g.spec, arriveT, this.tmp);
          const v = outcome(soldiers, this.tmp.kind, this.tmp.value, sim.plan.player.gateBonus);
          opts.push({ v, x: (this.tmp.x0 + this.tmp.x1) / 2 });
        }
        const fullRow = row.gates.reduce((s, g) => s + g.spec.x1 - g.spec.x0, 0) > H * 1.5;
        if (!fullRow) opts.push({ v: soldiers, x: NaN });
        opts.sort((a, b) => b.v - a.v);
        best = opts[0].v;
        bestX = opts[0].x;
        second = opts[1]?.x ?? bestX;
        void best;
        choice = this.rng.chance(this.skill) || isNaN(second) ? bestX : second;
        if (isNaN(choice)) choice = u.cx;
        this.decided.set(key, choice);
      }
      desired = choice;
      break;
    }

    // ---- Hazard avoidance: choose the lateral position with the clearest path ----
    const R = Math.max(16, Math.min(u.radius() * 0.7, 40));
    const look = 120 + 200 * this.skill;
    let hazardNear = false;
    let bestX = desired;
    let bestScore = -Infinity;
    const hz = sim.obstacles.hazards;
    for (let cand = -H + R; cand <= H - R; cand += 8) {
      let score = -Math.abs(cand - desired) * 0.02;
      for (let d = 0; d <= look; d += 16) {
        const y = cy + d;
        const ts = t + d / speed;
        this.blocked.length = 0;
        for (const h of hz) {
          if (h.y1 + R < y - 10 || h.y0 - R > y + 10) continue;
          hazardBlockedIntervals(h.spec, ts, y, 8, R, this.blocked);
        }
        if (this.blocked.length === 0) continue;
        hazardNear = hazardNear || d < 220;
        const m = mergeIntervals(this.blocked);
        for (let i = 0; i < m.length; i += 2) {
          if (cand > m[i] && cand < m[i + 1]) {
            score -= 100 * (1 - d / (look + 20));
            break;
          }
        }
        // Must be reachable in time.
        const reach = TUNING.swarm.maxLateralSpeed * 0.8 * (d / speed);
        if (Math.abs(cand - u.cx) > reach + 12) score -= 3;
      }
      if (score > bestScore) {
        bestScore = score;
        bestX = cand;
      }
    }
    if (hazardNear) {
      desired = bestX;
      squeeze = true;
    }
    if (sim.ability.ready && hazardNear && this.skill > 0.5) sim.input.surge = true;

    // Reaction lag for lower skill.
    const lag = 1 - (0.35 + 0.65 * this.skill) * 0.5;
    sim.input.targetX = clamp(sim.input.targetX * lag + desired * (1 - lag), -H, H);
    sim.input.squeeze = squeeze;
  }
}

function outcome(a: number, kind: GateKind, v: number, gb: number): number {
  switch (kind) {
    case 'mul':
      return a + a * (v - 1) * (1 + gb);
    case 'add':
      return a + v * (1 + gb);
    case 'sub':
      return a - v;
    case 'div':
      return a / 2;
  }
}
