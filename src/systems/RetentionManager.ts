import type { DailyModifier } from '../gen/types';
import type { AnalyticsManager } from './AnalyticsManager';
import type { CurrencyManager } from './CurrencyManager';
import type { SaveData, SaveManager } from './SaveManager';
import type { SkinManager } from './SkinManager';

/** Local calendar day index (changes at local midnight). */
export function dayIndex(now = Date.now()): number {
  const d = new Date(now);
  return Math.floor((now - d.getTimezoneOffset() * 60000) / 86400000);
}

export interface DailyRewardDay {
  coins: number;
  gems: number;
  chest?: boolean;
}

/** 7-day loop; coin amounts scale with progression so they always matter. */
export function dailyRewardFor(streakDay: number, highestLevel: number): DailyRewardDay {
  const scale = 1 + highestLevel / 15;
  const table: DailyRewardDay[] = [
    { coins: 100, gems: 0 },
    { coins: 150, gems: 0 },
    { coins: 0, gems: 5 },
    { coins: 300, gems: 0 },
    { coins: 0, gems: 10 },
    { coins: 500, gems: 0 },
    { coins: 400, gems: 20, chest: true },
  ];
  const r = table[streakDay % 7];
  return { coins: Math.round(r.coins * scale), gems: r.gems, chest: r.chest };
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  gems: number;
  check: (d: SaveData) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', name: 'First Surge', desc: 'Clear your first level', gems: 5, check: (d) => d.stats.wins >= 1 },
  { id: 'level_10', name: 'Getting Warm', desc: 'Reach level 10', gems: 10, check: (d) => d.highestLevel >= 10 },
  { id: 'level_25', name: 'Swarm Lord', desc: 'Reach level 25', gems: 15, check: (d) => d.highestLevel >= 25 },
  { id: 'level_50', name: 'Unstoppable', desc: 'Reach level 50', gems: 25, check: (d) => d.highestLevel >= 50 },
  { id: 'level_100', name: 'Legend', desc: 'Reach level 100', gems: 50, check: (d) => d.highestLevel >= 100 },
  { id: 'boss_1', name: 'Giant Slayer', desc: 'Defeat a boss', gems: 10, check: (d) => d.stats.bossesKilled >= 1 },
  { id: 'boss_10', name: 'Boss Hunter', desc: 'Defeat 10 bosses', gems: 30, check: (d) => d.stats.bossesKilled >= 10 },
  { id: 'army_200', name: 'Crowd Control', desc: 'Have 200 soldiers at once', gems: 10, check: (d) => d.stats.maxSoldiers >= 200 },
  { id: 'army_1000', name: 'Horde', desc: 'Have 1,000 soldiers at once', gems: 25, check: (d) => d.stats.maxSoldiers >= 1000 },
  { id: 'kills_500', name: 'Grump Smasher', desc: 'Defeat 500 enemies', gems: 15, check: (d) => d.stats.kills >= 500 },
  { id: 'combo_master', name: 'Combo Master', desc: 'Reach a 26 combo (x6)', gems: 20, check: (d) => d.stats.bestCombo >= 26 },
  { id: 'perfect_50', name: 'Untouchable', desc: '50 perfect hazard passes', gems: 15, check: (d) => d.stats.perfects >= 50 },
  { id: 'upgrades_20', name: 'Tinkerer', desc: 'Buy 20 upgrades', gems: 10, check: (d) => d.stats.upgradesBought >= 20 },
  { id: 'streak_7', name: 'Regular', desc: 'Claim daily rewards 7 days in a row', gems: 25, check: (d) => d.daily.streak >= 7 },
  { id: 'rich', name: 'Fat Stacks', desc: 'Earn 10,000 coins total', gems: 15, check: (d) => d.stats.coinsEarned >= 10000 },
];

export const MILESTONES: { level: number; gems: number; skin?: string }[] = [
  { level: 10, gems: 10, skin: 'ember' },
  { level: 25, gems: 20, skin: 'toxic' },
  { level: 50, gems: 30, skin: 'royal' },
  { level: 100, gems: 50, skin: 'void' },
];

const DAILY_MODS: DailyModifier[] = ['megagates', 'rush', 'glass', 'horde'];
export const DAILY_MOD_TEXT: Record<DailyModifier, string> = {
  none: '',
  megagates: 'MEGA GATES: +50% gate power',
  rush: 'RUSH: 25% faster',
  glass: 'GLASS SWARM: half health',
  horde: 'HORDE: tougher enemies',
};

export class RetentionManager {
  constructor(
    private save: SaveManager,
    private currency: CurrencyManager,
    private skins: SkinManager,
    private analytics: AnalyticsManager,
    private now: () => number = () => Date.now(),
  ) {}

  /** Call on boot; tracks days played. */
  touchDay(): void {
    const d = this.save.data.daily;
    const today = dayIndex(this.now());
    if (d.lastPlayDay !== today) {
      d.lastPlayDay = today;
      this.save.data.stats.daysPlayed++;
      this.save.saveSoon();
    }
  }

  dailyRewardAvailable(): boolean {
    return this.save.data.daily.lastClaimDay !== dayIndex(this.now());
  }

  /** Streak day (0-based) that would be claimed now. */
  pendingStreakDay(): number {
    const d = this.save.data.daily;
    const today = dayIndex(this.now());
    return d.lastClaimDay === today - 1 ? d.streak : 0;
  }

  claimDailyReward(mult = 1): DailyRewardDay | null {
    if (!this.dailyRewardAvailable()) return null;
    const d = this.save.data.daily;
    const day = this.pendingStreakDay();
    const r = dailyRewardFor(day, this.save.data.highestLevel);
    d.streak = day + 1;
    d.lastClaimDay = dayIndex(this.now());
    this.currency.earn('coins', r.coins * mult);
    this.currency.earn('gems', r.gems * mult);
    this.save.save();
    this.analytics.track('daily_reward_claimed', { day: d.streak, coins: r.coins * mult, gems: r.gems * mult });
    return r;
  }

  dailyChallenge(): { day: number; level: number; modifier: DailyModifier; done: boolean } {
    const day = dayIndex(this.now());
    const d = this.save.data.daily;
    const done = d.challengeDay === day && d.challengeDone;
    return { day, level: Math.max(6, this.save.data.highestLevel + 2), modifier: DAILY_MODS[day % DAILY_MODS.length], done };
  }

  completeDailyChallenge(): void {
    const d = this.save.data.daily;
    d.challengeDay = dayIndex(this.now());
    d.challengeDone = true;
    this.save.save();
  }

  /** Grant any newly earned achievements; returns them for UI toasts. */
  checkAchievements(): Achievement[] {
    const got: Achievement[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.save.data.achievements.includes(a.id)) continue;
      if (!a.check(this.save.data)) continue;
      this.save.data.achievements.push(a.id);
      this.currency.earn('gems', a.gems);
      if (a.id === 'combo_master') this.skins.unlock('starry');
      this.analytics.track('achievement_unlocked', { id: a.id });
      got.push(a);
    }
    if (got.length) this.save.saveSoon();
    return got;
  }

  checkMilestones(): { level: number; gems: number; skin?: string }[] {
    const got: { level: number; gems: number; skin?: string }[] = [];
    for (const m of MILESTONES) {
      if (this.save.data.highestLevel < m.level || this.save.data.milestones.includes(m.level)) continue;
      this.save.data.milestones.push(m.level);
      this.currency.earn('gems', m.gems);
      if (m.skin) this.skins.unlock(m.skin);
      got.push(m);
    }
    if (got.length) this.save.saveSoon();
    return got;
  }
}
