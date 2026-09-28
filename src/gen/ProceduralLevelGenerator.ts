/**
 * ProceduralLevelGenerator — assembles infinite, hand-designed-feeling levels
 * from the module library with pacing, difficulty and fairness awareness.
 *
 * Pipeline per level:
 *   DifficultyManager.compute → pacing loop (category → module → build) →
 *   per-section validation (reachability, spacing, spikes, survival) with
 *   regeneration → finale sizing → full FairnessValidator pass.
 */
import { TUNING } from '../config/tuning';
import { clamp, lerp } from '../core/math';
import { Rng, hashSeed } from '../core/rng';
import type { DifficultyManager, PerformanceState } from '../systems/DifficultyManager';
import { isBossLevel } from '../systems/economy';
import {
  estimateSegment,
  finaleDamage,
  fullTrackInterval,
  maxRatingForD,
  minHazardGapSeconds,
  sweepReachability,
  timeAt,
  validatePlan,
  type ArmyEst,
} from './FairnessValidator';
import { MODULES, MODULE_BY_ID, intensity, type BuildCtx, type ModuleDef, type ModuleOutput } from './modules';
import type { BossType, DailyModifier, EntitySpec, FinaleSpec, HazardSpec, LevelPlan, ModuleCategory, PlayerStats, SegmentPlan, SpeedZone } from './types';

const G = TUNING.generator;
const L = TUNING.level;

export interface GenerateInput {
  level: number;
  stats: PlayerStats;
  perf?: PerformanceState;
  /** Extra salt (e.g. daily challenge date). */
  salt?: number;
  daily?: DailyModifier;
}

/** Scripted opening so the first minutes teach one idea at a time. */
const TUTORIAL: Record<number, string[]> = {
  1: ['growth_add', 'choice_pair', 'coin_trail', 'narrow_gap', 'recovery', 'growth_mul', 'choice_pair'],
  2: ['growth_mul', 'choice_pair', 'crates', 'narrow_gap', 'choice_pair', 'growth_add', 'coin_trail', 'choice_pair'],
  3: ['growth_add', 'choice_pair', 'grunt_squad', 'recovery', 'double_gap', 'growth_mul', 'grunt_squad'],
  4: ['growth_mul', 'choice_pair', 'sweeper', 'recovery', 'grunt_squad', 'crates', 'choice_pair', 'narrow_gap'],
};

export function levelLength(level: number): number {
  return Math.min(L.lengthMax, L.lengthBase + L.lengthPerLevel * Math.pow(level, L.lengthExp));
}

export function finaleRatio(D: number): number {
  const d = TUNING.difficulty;
  return lerp(d.finaleRatioStart, d.finaleRatioEnd, 1 - Math.exp(-D / d.finaleRatioK));
}

const BOSS_TYPES: BossType[] = ['stomper', 'spawner', 'sweeper'];

export class ProceduralLevelGenerator {
  /** Stats of the last generation run (for tests / debug overlay). */
  lastAttempts = 0;
  lastSectionRetries = 0;

  constructor(private difficulty: DifficultyManager) {}

  generate(input: GenerateInput): LevelPlan {
    const perf = input.perf ?? { failStreak: 0, winStreak: 0 };
    for (let attempt = 0; attempt < G.maxLevelAttempts; attempt++) {
      const plan = this.tryGenerate(input, perf, attempt);
      const report = validatePlan(plan);
      this.lastAttempts = attempt + 1;
      if (report.ok) return plan;
    }
    // Should never happen; guaranteed-safe fallback keeps the game playable.
    return this.tryGenerate(input, perf, 999, true);
  }

  private tryGenerate(input: GenerateInput, perf: PerformanceState, attempt: number, safeMode = false): LevelPlan {
    const level = Math.max(1, Math.floor(input.level));
    const seed = hashSeed(level, input.salt ?? 0x5eed, attempt);
    const rng = new Rng(seed);
    const dr = this.difficulty.compute(level, input.stats, perf);
    let D = dr.complexity;
    const daily = input.daily ?? 'none';
    let baseSpeed = dr.forwardSpeed;
    if (daily === 'rush') baseSpeed = Math.min(TUNING.swarm.maxForwardSpeed * 1.1, baseSpeed * 1.25);
    if (daily === 'horde') D += 1;
    const player: PlayerStats = { ...input.stats };
    if (daily === 'glass') player.health = Math.max(1, player.health * 0.5);
    if (daily === 'megagates') player.gateBonus += 0.5;
    const ref = dr.reference;
    const length = levelLength(level);
    const isBoss = isBossLevel(level);
    const enemyAtkMult = Math.sqrt(dr.progressionScaling) * (daily === 'horde' ? 1.1 : 1);

    let group = 0;
    const segments: SegmentPlan[] = [];
    const zones: SpeedZone[] = [];
    let y: number = L.startRunway;
    let act: ArmyEst = { best: player.startUnits, typical: player.startUnits };
    let refArmy: ArmyEst = { best: ref.startUnits, typical: ref.startUnits };
    let reach = fullTrackInterval();
    let lastHazardEndY = -Infinity;
    let tension = 0;
    let prevChallenge = 0;
    let prev: SegmentPlan | undefined;
    const recent: string[] = [];
    const tutorial = safeMode ? undefined : TUTORIAL[level];
    let tutIdx = 0;
    const hazardGap = minHazardGapSeconds(D);
    const maxRating = maxRatingForD(D);
    const tensionBudget = 3.5 + D * 0.4;

    while (y < length - L.finaleRunway) {
      const progress = y / length;
      let placed = false;
      for (let tries = 0; tries < G.maxSectionAttempts && !placed; tries++) {
        let def: ModuleDef | undefined;
        if (tutorial && tutIdx < tutorial.length && tries < 3) {
          def = MODULE_BY_ID[tutorial[tutIdx]];
        } else if (safeMode || tries >= G.maxSectionAttempts - 2) {
          def = MODULE_BY_ID[rng.chance(0.5) ? 'recovery' : 'coin_trail'];
        } else {
          const target = ref.startUnits * lerp(G.targetGrowthStart, G.targetGrowthEnd, progress) * (1 + D * G.targetGrowthPerD);
          const cat = this.pickCategory(rng, level, D, progress, tension, tensionBudget, prev, refArmy.typical / target, segments.length);
          def = this.pickModule(rng, cat, level, D, prev, recent, refArmy.typical);
          if (!def) continue;
        }
        // Recovery rule: nothing hazardous right after a demanding module.
        if (prev?.needsRecoveryAfter && def.hasHazards) continue;

        const i = intensity(def, D);
        const ctx: BuildCtx = {
          rng: new Rng(hashSeed(seed, segments.length, tries)),
          level,
          D,
          speed: baseSpeed,
          army: Math.max(1, refArmy.typical),
          targetArmy: ref.startUnits * lerp(G.targetGrowthStart, G.targetGrowthEnd, progress) * (1 + D * G.targetGrowthPerD),
          ref,
          enemyHpMult: dr.enemyHpMult,
          refHpMult: dr.progressionScaling,
          enemyAtkMult,
          nextGroup: () => ++group,
        };
        const out: ModuleOutput = def.build(ctx, i);
        const rating = Math.min(out.rating, maxRating);
        if (out.rating > maxRating + 0.01 && !tutorial) continue;
        if (rating >= 1.5 && rating - prevChallenge > TUNING.fairness.maxSpikeDelta) continue;

        // Spacing: breathing room scales down with difficulty; hazards get a reaction window.
        let gap = Math.max(50, lerp(170, 60, 1 - Math.exp(-D / 18)) * (baseSpeed / 240));
        if (def.hasHazards && lastHazardEndY > -Infinity) {
          // Ensure the time between hazard sections >= minimum reaction time.
          for (let k = 0; k < 40; k++) {
            const dt = timeAt(y + gap, baseSpeed, zones) - timeAt(lastHazardEndY, baseSpeed, zones);
            if (dt >= hazardGap) break;
            gap += 20;
          }
        }
        const y0 = y + gap;
        const y1 = y0 + out.length;
        const entities = offsetEntities(out.entities, y0);
        const segZones: SpeedZone[] = [];
        for (const e of entities) if (e.t === 'pad') segZones.push({ y0: e.y0, y1: e.y1, mult: e.mult });
        const allZones = segZones.length ? zones.concat(segZones) : zones;

        const hazards = entities.filter((e): e is HazardSpec => e.t === 'hazard');
        let nextReach = reach;
        if (hazards.length) {
          const r = sweepReachability(hazards, reach, y, y1, baseSpeed, allZones);
          if (!r.ok) continue;
          nextReach = r.intervals;
        } else {
          // Free movement across the gap/segment.
          nextReach = fullTrackInterval();
        }

        const actAfter = estimateSegment(entities, act, player, out.hazardLossTypical);
        const refAfter = estimateSegment(entities, refArmy, ref, out.hazardLossTypical, 1 / dr.powerAdjustment / dr.performanceAdjustment);
        if (actAfter.typical < TUNING.fairness.minTypicalArmy || refAfter.typical < TUNING.fairness.minTypicalArmy) continue;

        const seg: SegmentPlan = {
          moduleId: def.id,
          category: def.category,
          y0,
          y1,
          rating,
          needsRecoveryAfter: def.needsRecoveryAfter,
          entities,
          armyBest: actAfter.best,
          armyTypical: actAfter.typical,
        };
        segments.push(seg);
        zones.push(...segZones);
        reach = nextReach;
        act = actAfter;
        refArmy = refAfter;
        if (hazards.length) lastHazardEndY = y1;
        if (rating >= 1.5) prevChallenge = rating;
        tension = def.category === 'recovery' || def.category === 'growth' || def.category === 'reward' ? Math.max(0, tension - 2.5) : tension + rating;
        recent.push(def.id);
        if (recent.length > G.avoidRepeatWindow) recent.shift();
        prev = seg;
        if (tutorial && tutIdx < tutorial.length && def.id === tutorial[tutIdx]) tutIdx++;
        else if (tutorial && tries >= 3) tutIdx++;
        y = y1;
        placed = true;
        this.lastSectionRetries += tries;
      }
      if (!placed) {
        // Fallback: plain runway section (always safe).
        const y0 = y + 80;
        const seg: SegmentPlan = {
          moduleId: 'runway',
          category: 'recovery',
          y0,
          y1: y0 + 200,
          rating: 0,
          needsRecoveryAfter: false,
          entities: [],
          armyBest: act.best,
          armyTypical: act.typical,
        };
        segments.push(seg);
        prev = seg;
        reach = fullTrackInterval();
        y = seg.y1;
      }
    }

    // ---- Finale ----
    const finaleY = Math.max(y + L.finaleRunway, length);
    const atk = TUNING.combat.fortressAtkBase * (ref.health / 10) * enemyAtkMult;
    const refDamage = finaleDamage(refArmy.typical, ref, atk);
    let hp = refDamage * finaleRatio(D) * dr.enemyHpMult * (isBoss ? 0.85 : 1);
    if (daily === 'horde') hp *= 1.1;
    const bestDamage = finaleDamage(act.best, player, atk);
    const maxHp = bestDamage / TUNING.difficulty.finaleWinMargin;
    if (hp > maxHp) hp = maxHp;
    hp = Math.max(20, Math.round(hp));
    const finale: FinaleSpec = {
      kind: isBoss ? 'boss' : 'fortress',
      bossType: isBoss ? BOSS_TYPES[Math.floor(level / TUNING.difficulty.bossEvery - 1) % BOSS_TYPES.length] : undefined,
      y: finaleY,
      hp,
      atk,
      width: isBoss ? 150 : 220,
    };

    return {
      level,
      seed,
      difficulty: D,
      enemyScale: dr.enemyHpMult,
      baseSpeed,
      length: finaleY,
      segments,
      speedZones: zones,
      finale,
      theme: Math.floor((level - 1) / 10) % 5,
      isBoss,
      player,
      expected: {
        armyBest: act.best,
        armyTypical: act.typical,
        damageBest: bestDamage,
        damageTypical: finaleDamage(act.typical, player, atk),
      },
      daily: daily === 'none' ? undefined : daily,
    };
  }

  private pickCategory(
    rng: Rng,
    level: number,
    D: number,
    progress: number,
    tension: number,
    budget: number,
    prev: SegmentPlan | undefined,
    armyRatio: number,
    index: number,
  ): ModuleCategory {
    if (index === 0) return 'growth';
    if (prev?.needsRecoveryAfter || tension > budget) return rng.pick(['recovery', 'growth', 'reward', 'choice'] as const);
    if (armyRatio < 0.45) return rng.chance(0.6) ? 'growth' : 'choice';
    const heavy = armyRatio > 1.3 ? 2 : 1;
    // Tension rises through the level and peaks just before the finale.
    const peak = progress > 0.65 ? 1.4 : 1;
    const w: Partial<Record<ModuleCategory, number>> = {
      growth: armyRatio > 1.2 ? 0.2 : 1.0,
      choice: 2.4,
      obstacle: 2.0 * peak,
      hazard: (level >= 4 ? 2.6 : 0) * peak,
      enemy: (level >= 3 ? 2.2 : 0) * peak * heavy,
      reward: 1.0,
      combo: (D > 9 ? 1.8 + D * 0.03 : 0) * peak,
      branch: level >= 25 ? 0.7 : 0,
      speed: level >= 22 ? 0.5 : 0,
      recovery: 0.3,
    };
    const cats = Object.keys(w) as ModuleCategory[];
    return rng.weighted(cats, (c) => w[c] ?? 0) ?? 'choice';
  }

  private pickModule(rng: Rng, cat: ModuleCategory, level: number, D: number, prev: SegmentPlan | undefined, recent: string[], army: number): ModuleDef | undefined {
    const eligible = MODULES.filter(
      (m) =>
        m.category === cat &&
        m.unlockLevel <= level &&
        D >= m.minD &&
        D <= m.maxD &&
        army >= m.minArmy &&
        !recent.includes(m.id) &&
        !(prev && (m.notAfter.includes(prev.moduleId) || m.notAfter.includes(prev.category))),
    );
    if (eligible.length === 0) {
      // Fall back to any eligible growth/choice so pacing never stalls.
      return MODULES.find((m) => m.category === 'choice' && !recent.includes(m.id) && m.unlockLevel <= level) ?? MODULE_BY_ID.recovery;
    }
    return rng.weighted(eligible, (m) => {
      const novelty = level - m.unlockLevel < G.noveltyLevels && m.unlockLevel > 1 ? G.noveltyWeight : 1;
      return m.weight * novelty;
    });
  }
}

function offsetEntities(ents: EntitySpec[], y0: number): EntitySpec[] {
  return ents.map((e): EntitySpec => {
    switch (e.t) {
      case 'gate':
        return { ...e, y: e.y + y0 };
      case 'enemy':
      case 'pickup':
      case 'hint':
        return { ...e, y: e.y + y0 };
      case 'pad':
        return { ...e, y0: e.y0 + y0, y1: e.y1 + y0 };
      case 'hazard': {
        const s = e.shape;
        const shape =
          s.shape === 'rect'
            ? { ...s, y0: s.y0 + y0, y1: s.y1 + y0 }
            : s.shape === 'circle'
              ? { ...s, y: s.y + y0 }
              : { ...s, cy: s.cy + y0 };
        return { ...e, shape };
      }
    }
  });
}

export const _test = { offsetEntities, clamp };
