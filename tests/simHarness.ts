import { TUNING } from '../src/config/tuning';
import { BotController } from '../src/game/BotController';
import { Simulation } from '../src/game/Simulation';
import { ProceduralLevelGenerator } from '../src/gen/ProceduralLevelGenerator';
import type { PlayerStats } from '../src/gen/types';
import { DifficultyManager } from '../src/systems/DifficultyManager';

export const dm = new DifficultyManager();
export const gen = new ProceduralLevelGenerator(dm);

export function runLevel(level: number, stats: PlayerStats, skill = 0.9, seed = 1, perf = { failStreak: 0, winStreak: 0 }) {
  const plan = gen.generate({ level, stats, perf });
  const sim = new Simulation();
  sim.load(plan);
  sim.start();
  const bot = new BotController(skill, seed);
  const dt = TUNING.fixedDt;
  let steps = 0;
  while (!sim.finished && steps < 60 * 240) {
    bot.update(sim);
    sim.step(dt);
    sim.events.clear();
    steps++;
  }
  return { plan, sim, stats: sim.stats(), won: sim.phase === 'won', steps };
}
