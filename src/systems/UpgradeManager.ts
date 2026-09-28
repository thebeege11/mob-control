import { TUNING, UPGRADE_IDS, type UpgradeId } from '../config/tuning';
import type { PlayerStats } from '../gen/types';

export type UpgradeLevels = Record<UpgradeId, number>;

export const defaultUpgradeLevels = (): UpgradeLevels => ({ power: 1, health: 1, squad: 1, gates: 1, surge: 1, income: 1 });

export interface UpgradeInfo {
  id: UpgradeId;
  name: string;
  icon: string;
  describe: (v: number) => string;
}

export const UPGRADE_INFO: Record<UpgradeId, UpgradeInfo> = {
  power: { id: 'power', name: 'POWER', icon: '⚔', describe: (v) => `${fmt(v)} dmg` },
  health: { id: 'health', name: 'HEALTH', icon: '♥', describe: (v) => `${fmt(v)} hp` },
  squad: { id: 'squad', name: 'SQUAD', icon: '●', describe: (v) => `${v} start` },
  gates: { id: 'gates', name: 'GATES', icon: '✚', describe: (v) => `+${Math.round(v * 100)}% gain` },
  surge: { id: 'surge', name: 'SURGE', icon: '⚡', describe: (v) => `${v.toFixed(2).replace(/0$/, '')}s` },
  income: { id: 'income', name: 'INCOME', icon: '$', describe: (v) => `x${v.toFixed(1)}` },
};

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Stat value at an upgrade level (1-based). */
export function upgradeValue(id: UpgradeId, level: number): number {
  const u: { base: number; perLevel: number; max?: number } = TUNING.upgrades[id];
  let raw = u.base + u.perLevel * (level - 1);
  if (u.max !== undefined) {
    const span = u.max - u.base;
    raw = u.base + span * (1 - Math.exp((-(level - 1) * u.perLevel) / span));
  }
  if (id === 'squad') return Math.floor(raw);
  return Math.round(raw * 100) / 100;
}

/** Cost to buy the next level when currently at `level`. */
export function upgradeCost(id: UpgradeId, level: number): number {
  const u = TUNING.upgrades[id];
  const c = u.costBase * Math.pow(u.costGrowth, level - 1) + 6 * (level - 1);
  // Round to "nice" numbers.
  const mag = c < 100 ? 5 : c < 1000 ? 10 : c < 10000 ? 50 : 500;
  return Math.round(c / mag) * mag;
}

export function statsFromLevels(l: UpgradeLevels): PlayerStats {
  return {
    power: upgradeValue('power', l.power),
    health: upgradeValue('health', l.health),
    startUnits: upgradeValue('squad', l.squad),
    gateBonus: upgradeValue('gates', l.gates),
    surgeDuration: upgradeValue('surge', l.surge),
    surgeChargeMult: 1 + TUNING.ability.chargePerLevelUpgrade * (l.surge - 1),
    incomeMult: upgradeValue('income', l.income),
  };
}

/**
 * Single scalar describing how strong a player is. Used to scale enemies so
 * upgrades always help but never trivialise the game.
 */
export function powerScalar(s: PlayerStats): number {
  return (s.power / 10) * Math.sqrt(s.health / 10) * Math.sqrt(s.startUnits / 8) * Math.pow(1 + s.gateBonus, 1.5);
}

/** Stateful wrapper used by the game (owns levels, spends currency). */
export class UpgradeManager {
  constructor(
    public levels: UpgradeLevels,
    private spend: (amount: number) => boolean,
    private onPurchased?: (id: UpgradeId, newLevel: number, cost: number) => void,
  ) {}

  cost(id: UpgradeId): number {
    return upgradeCost(id, this.levels[id]);
  }

  current(id: UpgradeId): number {
    return upgradeValue(id, this.levels[id]);
  }

  next(id: UpgradeId): number {
    return upgradeValue(id, this.levels[id] + 1);
  }

  buy(id: UpgradeId): boolean {
    const cost = this.cost(id);
    if (!this.spend(cost)) return false;
    this.levels[id]++;
    this.onPurchased?.(id, this.levels[id], cost);
    return true;
  }

  stats(): PlayerStats {
    return statsFromLevels(this.levels);
  }

  cheapest(): UpgradeId {
    let best: UpgradeId = 'power';
    for (const id of UPGRADE_IDS) if (this.cost(id) < this.cost(best)) best = id;
    return best;
  }
}
