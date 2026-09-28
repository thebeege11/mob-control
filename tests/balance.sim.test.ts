/**
 * Balance simulation: a bot plays real generated levels through the real
 * simulation. These tests guard the difficulty curve, fairness and upgrades.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config/tuning';
import { BotController } from '../src/game/BotController';
import { Simulation } from '../src/game/Simulation';
import { Ev } from '../src/game/SimEvents';
import { defaultUpgradeLevels, statsFromLevels } from '../src/systems/UpgradeManager';
import { dm, gen, runLevel } from './simHarness';

describe('balance simulation', () => {
  it('a skilled player on the expected upgrade curve wins most levels (1-60)', () => {
    let wins = 0;
    let total = 0;
    for (let level = 1; level <= 60; level++) {
      const r = runLevel(level, statsFromLevels(dm.referenceLevels(level)), 0.85, level);
      total++;
      if (r.won) wins++;
      const s = r.stats;
      for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
    expect(wins / total).toBeGreaterThan(0.8);
  }, 300000);

  it('the opening levels are very forgiving', () => {
    for (let level = 1; level <= 3; level++) {
      const r = runLevel(level, statsFromLevels(defaultUpgradeLevels()), 0.6, 7);
      expect(r.won, `level ${level}`).toBe(true);
    }
  }, 60000);

  it('upgrades matter: an un-upgraded player struggles later on', () => {
    let refWins = 0;
    let noUpWins = 0;
    let noUpProgress = 0;
    for (const level of [30, 35, 40, 45, 50]) {
      if (runLevel(level, statsFromLevels(dm.referenceLevels(level)), 0.85, 3).won) refWins++;
      const r = runLevel(level, statsFromLevels(defaultUpgradeLevels()), 0.85, 3);
      if (r.won) noUpWins++;
      noUpProgress += r.stats.progress;
    }
    expect(refWins).toBeGreaterThan(noUpWins);
    // ...but the mercy clamp still lets them get somewhere.
    expect(noUpProgress / 5).toBeGreaterThan(0.3);
  }, 120000);

  it('no hazard module routinely wipes the swarm (anti-frustration)', () => {
    const agg = new Map<string, { n: number; loss: number; wipes: number }>();
    for (let level = 4; level <= 70; level += 2) {
      const plan = gen.generate({ level, stats: statsFromLevels(dm.referenceLevels(level)) });
      const sim = new Simulation();
      sim.load(plan);
      sim.start();
      const bot = new BotController(0.85, level);
      const hazSegs = plan.segments.map((s, i) => [s, i] as const).filter(([s]) => s.entities.some((e) => e.t === 'hazard'));
      const segIn = new Map<number, number>();
      const segLost = new Map<number, number>();
      while (!sim.finished && sim.time < 200) {
        bot.update(sim);
        for (const [s, i] of hazSegs) if (!segIn.has(i) && sim.units.cy + sim.units.radius() >= s.y0 - 10) segIn.set(i, sim.units.soldiers);
        sim.step(TUNING.fixedDt);
        for (let k = 0; k < sim.events.count; k++) {
          const e = sim.events.get(k);
          if (e.type !== Ev.UnitDie || e.b !== 0) continue;
          const hit = hazSegs.find(([s]) => e.y >= s.y0 - 60 && e.y <= s.y1 + 60);
          if (hit) segLost.set(hit[1], (segLost.get(hit[1]) ?? 0) + e.a);
        }
        sim.events.clear();
      }
      for (const [s, i] of hazSegs) {
        const inn = segIn.get(i);
        if (!inn) continue;
        const lf = Math.min(1, (segLost.get(i) ?? 0) / inn);
        const a = agg.get(s.moduleId) ?? { n: 0, loss: 0, wipes: 0 };
        a.n++;
        a.loss += lf;
        if (lf > 0.9) a.wipes++;
        agg.set(s.moduleId, a);
      }
    }
    for (const [id, a] of agg) {
      expect(a.loss / a.n, `${id} average loss`).toBeLessThan(0.3);
      expect(a.wipes / a.n, `${id} wipe rate`).toBeLessThan(0.2);
    }
  }, 300000);

  it('restart is instant: loading a new level is fast', () => {
    const stats = statsFromLevels(dm.referenceLevels(50));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const plan = gen.generate({ level: 50 + i, stats });
      new Simulation().load(plan);
    }
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(100);
  });

  it('simulation step is cheap with a full swarm (60 FPS budget)', () => {
    const r = runLevel(100, statsFromLevels(dm.referenceLevels(100)), 0.85, 1);
    const perStepMs = 0; // measured below
    void perStepMs;
    const plan = r.plan;
    const sim = new Simulation();
    sim.load(plan);
    sim.start();
    const bot = new BotController(0.9, 1);
    let steps = 0;
    const t0 = performance.now();
    while (!sim.finished && steps < 1500) {
      bot.update(sim);
      sim.step(TUNING.fixedDt);
      sim.events.clear();
      steps++;
    }
    const avg = (performance.now() - t0) / steps;
    // Includes the bot's own planning; desktop CI budget, phones are ~4x slower.
    expect(avg).toBeLessThan(2);
  }, 60000);
});
