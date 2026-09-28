import { TUNING, UPGRADE_IDS, type UpgradeId } from '../config/tuning';
import { clamp } from '../core/math';
import type { PlayerStats } from '../gen/types';
import { isBossLevel, winBaseCoins } from './economy';
import { defaultUpgradeLevels, powerScalar, statsFromLevels, upgradeCost, type UpgradeLevels } from './UpgradeManager';

const D = TUNING.difficulty;

/** Recent-performance signal (per level). */
export interface PerformanceState {
  failStreak: number;
  winStreak: number;
}

export interface DifficultyResult {
  /** Complexity D: drives module selection, speed, spacing, reaction windows. Skill-only; never depends on upgrades. */
  complexity: number;
  /** Stats of the "reference" player expected at this level. */
  reference: PlayerStats;
  /** playerPower / referencePower. */
  powerRatio: number;
  /** Multiplier on enemy HP & finale HP from player power (partial compensation). */
  powerAdjustment: number;
  /** Multiplier from recent performance (mercy / pressure). */
  performanceAdjustment: number;
  /** Additional late-game toughness. */
  progressionScaling: number;
  /** Final enemy HP multiplier relative to the reference player's power. */
  enemyHpMult: number;
  /** Single summary number (for analytics/debug): effective difficulty. */
  effective: number;
  forwardSpeed: number;
}

/** Base level complexity curve. Smooth, monotone-ish, grows forever. */
export function baseComplexity(level: number): number {
  const L = Math.max(1, level);
  return D.early * (1 - Math.exp(-L / D.earlyK)) + D.mid * Math.log(1 + L / D.midK) + D.late * L;
}

/** Complexity with pacing saw-tooth (breather after bosses, bump on bosses). */
export function levelComplexity(level: number): number {
  let c = baseComplexity(level);
  if (isBossLevel(level)) c += D.bossBump;
  else if (level > D.bossEvery && level % D.bossEvery === 1) c += D.postBossBreather;
  return Math.max(0.5, c);
}

/**
 * Reference player model: wins every level, collects a typical amount of
 * extra coins, and always buys the cheapest useful upgrade. Derived purely
 * from tuning so the economy and the difficulty curve can never drift apart.
 */
class ReferencePlayer {
  private levelsAt: UpgradeLevels[] = [];
  private coins = 0;
  private cur = defaultUpgradeLevels();

  levelsFor(level: number): UpgradeLevels {
    const L = Math.max(1, Math.floor(level));
    while (this.levelsAt.length < L) this.step(this.levelsAt.length + 1);
    return this.levelsAt[L - 1];
  }

  private step(level: number): void {
    // Snapshot BEFORE playing the level (what they bring into it).
    this.levelsAt.push({ ...this.cur });
    const s = statsFromLevels(this.cur);
    const bossMult = isBossLevel(level) ? TUNING.economy.bossCoinMult : 1;
    this.coins += winBaseCoins(level) * bossMult * TUNING.difficulty.referenceIncomeFactor * s.incomeMult;
    for (;;) {
      let best: UpgradeId | null = null;
      let bestCost = Infinity;
      for (const id of UPGRADE_IDS) {
        const c = upgradeCost(id, this.cur[id]);
        if (c < bestCost) {
          bestCost = c;
          best = id;
        }
      }
      if (!best || bestCost > this.coins) break;
      this.coins -= bestCost;
      this.cur[best]++;
    }
  }
}

export class DifficultyManager {
  private ref = new ReferencePlayer();

  referenceLevels(level: number): UpgradeLevels {
    return this.ref.levelsFor(level);
  }

  referenceStats(level: number): PlayerStats {
    return statsFromLevels(this.ref.levelsFor(level));
  }

  compute(level: number, player: PlayerStats, perf: PerformanceState): DifficultyResult {
    const complexity = levelComplexity(level);
    const reference = this.referenceStats(level);
    const powerRatio = powerScalar(player) / powerScalar(reference);
    const powerAdjustment = Math.pow(powerRatio, D.powerAlpha);
    const fails = Math.min(perf.failStreak, D.mercyMaxFails);
    const wins = Math.min(perf.winStreak, D.pressureMaxWins);
    const performanceAdjustment = clamp(1 - D.mercyPerFail * fails + D.pressurePerWin * wins, 0.6, 1.2);
    const progressionScaling = 1 + D.enemyExtraLog * Math.log(1 + level / D.enemyExtraK);
    const enemyHpMult = powerAdjustment * performanceAdjustment * progressionScaling;
    const forwardSpeed = Math.min(TUNING.swarm.maxForwardSpeed, TUNING.swarm.baseForwardSpeed + TUNING.level.speedPerD * complexity);
    const effective = complexity + Math.log2(progressionScaling) * 4 + Math.log2(performanceAdjustment) * 4 - Math.log2(powerRatio / powerAdjustment) * 4;
    return {
      complexity,
      reference,
      powerRatio,
      powerAdjustment,
      performanceAdjustment,
      progressionScaling,
      enemyHpMult,
      effective,
      forwardSpeed,
    };
  }
}
