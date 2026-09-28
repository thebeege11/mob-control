import { describe, expect, it } from 'vitest';
import { ProceduralLevelGenerator, levelLength } from '../src/gen/ProceduralLevelGenerator';
import { validatePlan, sweepReachability, fullTrackInterval } from '../src/gen/FairnessValidator';
import { DifficultyManager } from '../src/systems/DifficultyManager';
import { statsFromLevels, defaultUpgradeLevels } from '../src/systems/UpgradeManager';
import { MODULES } from '../src/gen/modules';
import { Rng } from '../src/core/rng';
import type { HazardSpec } from '../src/gen/types';

const dm = new DifficultyManager();
const gen = new ProceduralLevelGenerator(dm);

function statsFor(level: number, powerFactor = 1) {
  const ref = dm.referenceLevels(level);
  const l = { ...ref };
  if (powerFactor < 1) for (const k of Object.keys(l) as (keyof typeof l)[]) l[k] = Math.max(1, Math.floor(l[k] * powerFactor));
  if (powerFactor > 1) for (const k of Object.keys(l) as (keyof typeof l)[]) l[k] = Math.ceil(l[k] * powerFactor);
  return statsFromLevels(l);
}

describe('ProceduralLevelGenerator', () => {
  it('is deterministic for the same inputs', () => {
    const s = statsFromLevels(defaultUpgradeLevels());
    const a = gen.generate({ level: 7, stats: s });
    const b = gen.generate({ level: 7, stats: s });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('generates thousands of valid levels across the whole progression and power range', () => {
    let failures: string[] = [];
    let count = 0;
    const rng = new Rng(42);
    const levels: number[] = [];
    for (let l = 1; l <= 300; l++) levels.push(l);
    for (let k = 0; k < 1700; k++) levels.push(rng.int(300, 5000));
    for (const level of levels) {
      for (const pf of [0.6, 1, 1.6]) {
        const plan = gen.generate({ level, stats: statsFor(level, pf), perf: { failStreak: rng.int(0, 5), winStreak: rng.int(0, 5) } });
        const rep = validatePlan(plan);
        count++;
        if (!rep.ok) failures.push(`L${level} pf${pf}: ${rep.errors.join('; ')}`);
      }
    }
    if (failures.length) console.log(failures.slice(0, 20).join('\n'));
    expect(count).toBeGreaterThanOrEqual(6000);
    expect(failures.length).toBe(0);
  }, 120000);

  it('rarely needs whole-level regeneration', () => {
    let regen = 0;
    for (let level = 1; level <= 200; level++) {
      gen.generate({ level, stats: statsFor(level) });
      if (gen.lastAttempts > 1) regen++;
    }
    expect(regen).toBeLessThan(40);
  });

  it('level length grows but stays bounded (short sessions)', () => {
    expect(levelLength(1)).toBeLessThan(levelLength(30));
    expect(levelLength(100000)).toBeLessThanOrEqual(9000);
  });

  it('boss appears every 5 levels with a bigger reward finale', () => {
    const s = statsFor(10);
    expect(gen.generate({ level: 10, stats: s }).finale.kind).toBe('boss');
    expect(gen.generate({ level: 11, stats: s }).finale.kind).toBe('fortress');
  });

  it('introduces new mechanics progressively in the first 30 levels', () => {
    const seen = new Map<string, number>();
    for (let level = 1; level <= 40; level++) {
      const plan = gen.generate({ level, stats: statsFor(level) });
      for (const s of plan.segments) if (!seen.has(s.moduleId)) seen.set(s.moduleId, level);
    }
    // Every non-rare module shows up by level 40.
    for (const m of MODULES) {
      if (m.weight < 0.5) continue;
      expect(seen.has(m.id), `module ${m.id} never appeared`).toBe(true);
    }
    // First level only uses the simplest modules.
    const first = gen.generate({ level: 1, stats: statsFor(1) });
    for (const s of first.segments) expect(['growth', 'choice', 'reward', 'obstacle', 'recovery']).toContain(s.category);
  });

  it('upgrades help but do not trivialise: finale HP scales sub-linearly with power', () => {
    const level = 30;
    const weak = gen.generate({ level, stats: statsFor(level, 1) });
    const strong = gen.generate({ level, stats: statsFor(level, 1.6) });
    const weakRatio = weak.expected.damageTypical / weak.finale.hp;
    const strongRatio = strong.expected.damageTypical / strong.finale.hp;
    expect(strongRatio).toBeGreaterThan(weakRatio);
    expect(strong.enemyScale).toBeGreaterThan(weak.enemyScale);
  });

  it('mercy: repeated failures make the finale easier', () => {
    const s = statsFor(20);
    const a = gen.generate({ level: 20, stats: s, perf: { failStreak: 0, winStreak: 0 } });
    const b = gen.generate({ level: 20, stats: s, perf: { failStreak: 4, winStreak: 0 } });
    expect(b.enemyScale).toBeLessThan(a.enemyScale);
  });
});

describe('FairnessValidator', () => {
  it('detects an impossible wall', () => {
    const wall: HazardSpec = { t: 'hazard', kind: 'wall', shape: { shape: 'rect', x0: -200, x1: 200, y0: 500, y1: 520 } };
    const r = sweepReachability([wall], fullTrackInterval(), 0, 800, 240, []);
    expect(r.ok).toBe(false);
  });

  it('detects a gap that requires superhuman lateral speed', () => {
    const w1: HazardSpec = { t: 'hazard', kind: 'wall', shape: { shape: 'rect', x0: -200, x1: 100, y0: 300, y1: 320 } };
    const w2: HazardSpec = { t: 'hazard', kind: 'wall', shape: { shape: 'rect', x0: -100, x1: 200, y0: 340, y1: 360 } };
    const r = sweepReachability([w1, w2], fullTrackInterval(), 0, 500, 240, []);
    expect(r.ok).toBe(false);
  });

  it('accepts a fair gap', () => {
    const w1: HazardSpec = { t: 'hazard', kind: 'wall', shape: { shape: 'rect', x0: -200, x1: -40, y0: 300, y1: 320 } };
    const w2: HazardSpec = { t: 'hazard', kind: 'wall', shape: { shape: 'rect', x0: 40, x1: 200, y0: 300, y1: 320 } };
    const r = sweepReachability([w1, w2], fullTrackInterval(), 0, 500, 240, []);
    expect(r.ok).toBe(true);
  });
});
