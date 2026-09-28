/**
 * LevelManager — decides WHICH level to build (campaign / retry / daily) and
 * asks the generator for it with the player's current stats & performance.
 */
import { hashSeed } from '../core/rng';
import { ProceduralLevelGenerator } from '../gen/ProceduralLevelGenerator';
import type { DailyModifier, LevelPlan, PlayerStats } from '../gen/types';
import { DifficultyManager } from '../systems/DifficultyManager';

export interface LevelRequest {
  level: number;
  stats: PlayerStats;
  failStreak: number;
  winStreak: number;
  daily?: { day: number; modifier: DailyModifier };
}

export class LevelManager {
  readonly difficulty = new DifficultyManager();
  readonly generator = new ProceduralLevelGenerator(this.difficulty);
  current: LevelPlan | null = null;
  isDaily = false;

  build(req: LevelRequest): LevelPlan {
    this.isDaily = !!req.daily;
    this.current = this.generator.generate({
      level: req.level,
      stats: req.stats,
      perf: { failStreak: req.failStreak, winStreak: req.winStreak },
      salt: req.daily ? hashSeed(req.daily.day, 0xda11) : undefined,
      daily: req.daily?.modifier,
    });
    return this.current;
  }
}
