import { TUNING } from '../config/tuning';

const E = TUNING.economy;

/** Coins for a clean win before survivor bonus / income multiplier. */
export function winBaseCoins(level: number): number {
  return Math.round(E.winBase + E.winPerLevel * Math.pow(level, E.winLevelExp));
}

export function isBossLevel(level: number): boolean {
  return level % TUNING.difficulty.bossEvery === 0;
}

export interface RunRewardInput {
  level: number;
  won: boolean;
  progress: number; // 0..1
  survivors: number;
  pickupCoins: number;
  incomeMult: number;
  isBoss: boolean;
  isDaily?: boolean;
}

export interface RunReward {
  coins: number;
  gems: number;
  breakdown: { label: string; value: number }[];
}

export function computeRunReward(r: RunRewardInput): RunReward {
  const breakdown: { label: string; value: number }[] = [];
  let coins = 0;
  let gems = 0;
  const base = winBaseCoins(r.level);
  if (r.won) {
    const b = r.isBoss ? base * E.bossCoinMult : base;
    breakdown.push({ label: r.isBoss ? 'Boss defeated' : 'Level clear', value: b });
    coins += b;
    const surv = Math.round(r.survivors * E.coinPerSurvivor);
    if (surv > 0) breakdown.push({ label: 'Survivors', value: surv });
    coins += surv;
    if (r.isBoss) gems += E.bossGems;
  } else {
    const p = Math.round(base * E.failProgressShare * Math.max(0, Math.min(1, r.progress)));
    breakdown.push({ label: 'Progress', value: p });
    coins += p;
  }
  if (r.pickupCoins > 0) breakdown.push({ label: 'Pickups', value: r.pickupCoins });
  coins += r.pickupCoins;
  const mult = r.incomeMult;
  coins = Math.round(coins * mult);
  if (r.isDaily && r.won) gems += 10;
  return { coins, gems, breakdown };
}

export function chestReward(level: number, roll: () => number): { coins: number; gems: number; skin: boolean } {
  const coins = Math.round(winBaseCoins(level) * E.chestCoinsLevelMult * (0.8 + roll() * 0.4));
  const gems = E.chestGemsMin + Math.floor(roll() * (E.chestGemsMax - E.chestGemsMin + 1));
  return { coins, gems, skin: roll() < E.chestSkinChance };
}
