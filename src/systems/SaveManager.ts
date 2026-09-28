import type { KeyValueStorage } from '../platform/storage';
import { defaultUpgradeLevels, type UpgradeLevels } from './UpgradeManager';

export const SAVE_KEY = 'swarm-surge-save';
export const SAVE_VERSION = 2;

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  reduceShake: boolean;
  leftHanded: boolean;
}

export interface PlayerStatistics {
  runs: number;
  wins: number;
  fails: number;
  kills: number;
  coinsEarned: number;
  gemsEarned: number;
  playTimeSec: number;
  bossesKilled: number;
  maxSoldiers: number;
  bestCombo: number;
  perfects: number;
  revives: number;
  adsWatched: number;
  upgradesBought: number;
  daysPlayed: number;
  chestsOpened: number;
}

export interface SaveData {
  version: number;
  coins: number;
  gems: number;
  upgrades: UpgradeLevels;
  /** Level the player will play next. */
  level: number;
  highestLevel: number;
  bestScore: number;
  /** Best progress (0..1) on the current level, for the "ghost" marker. */
  bestProgress: { level: number; progress: number };
  perf: { failStreak: number; winStreak: number };
  chestProgress: number;
  skins: { owned: string[]; equipped: string };
  hintsSeen: string[];
  settings: Settings;
  stats: PlayerStatistics;
  daily: { lastClaimDay: number; streak: number; challengeDay: number; challengeDone: boolean; lastPlayDay: number };
  achievements: string[];
  milestones: number[];
  removeAds: boolean;
  ads: { completionsSinceInterstitial: number; lastInterstitialAt: number; lastFreeCoinsAt: number };
  firstPlayAt: number;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    gems: 0,
    upgrades: defaultUpgradeLevels(),
    level: 1,
    highestLevel: 1,
    bestScore: 0,
    bestProgress: { level: 1, progress: 0 },
    perf: { failStreak: 0, winStreak: 0 },
    chestProgress: 0,
    skins: { owned: ['classic'], equipped: 'classic' },
    hintsSeen: [],
    settings: { sound: true, music: true, haptics: true, reduceShake: false, leftHanded: false },
    stats: {
      runs: 0,
      wins: 0,
      fails: 0,
      kills: 0,
      coinsEarned: 0,
      gemsEarned: 0,
      playTimeSec: 0,
      bossesKilled: 0,
      maxSoldiers: 0,
      bestCombo: 0,
      perfects: 0,
      revives: 0,
      adsWatched: 0,
      upgradesBought: 0,
      daysPlayed: 0,
      chestsOpened: 0,
    },
    daily: { lastClaimDay: -1, streak: 0, challengeDay: -1, challengeDone: false, lastPlayDay: -1 },
    achievements: [],
    milestones: [],
    removeAds: false,
    ads: { completionsSinceInterstitial: 0, lastInterstitialAt: 0, lastFreeCoinsAt: 0 },
    firstPlayAt: Date.now(),
  };
}

/** Deep-merge loaded data over defaults so new fields never break old saves. */
function mergeDefaults<T>(def: T, loaded: unknown): T {
  if (loaded === null || typeof loaded !== 'object' || Array.isArray(def)) return (loaded ?? def) as T;
  const out = { ...def } as Record<string, unknown>;
  const src = loaded as Record<string, unknown>;
  for (const k of Object.keys(def as object)) {
    if (!(k in src)) continue;
    const dv = (def as Record<string, unknown>)[k];
    const sv = src[k];
    if (dv !== null && typeof dv === 'object' && !Array.isArray(dv)) out[k] = mergeDefaults(dv, sv);
    else if (typeof dv === typeof sv || (Array.isArray(dv) && Array.isArray(sv))) out[k] = sv;
  }
  return out as T;
}

export function migrate(raw: Record<string, unknown>): SaveData {
  const v = typeof raw.version === 'number' ? raw.version : 1;
  // v1 → v2: `unlockedSkins` array was renamed to skins.owned.
  if (v < 2 && Array.isArray(raw.unlockedSkins)) {
    raw.skins = { owned: raw.unlockedSkins, equipped: typeof raw.equippedSkin === 'string' ? raw.equippedSkin : 'classic' };
  }
  const data = mergeDefaults(defaultSave(), raw);
  data.version = SAVE_VERSION;
  // Sanity clamps (corrupt / tampered data).
  data.coins = Math.max(0, Math.floor(data.coins) || 0);
  data.gems = Math.max(0, Math.floor(data.gems) || 0);
  data.level = Math.max(1, Math.floor(data.level) || 1);
  data.highestLevel = Math.max(data.level, Math.floor(data.highestLevel) || 1);
  for (const k of Object.keys(data.upgrades) as (keyof UpgradeLevels)[]) data.upgrades[k] = Math.max(1, Math.floor(data.upgrades[k]) || 1);
  if (!data.skins.owned.includes('classic')) data.skins.owned.unshift('classic');
  if (!data.skins.owned.includes(data.skins.equipped)) data.skins.equipped = 'classic';
  return data;
}

/** Local save: survives app restarts, no account required, works offline. */
export class SaveManager {
  data: SaveData;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private storage: KeyValueStorage) {
    this.data = this.load();
  }

  load(): SaveData {
    const raw = this.storage.get(SAVE_KEY);
    if (!raw) return defaultSave();
    try {
      return migrate(JSON.parse(raw));
    } catch {
      // Corrupt save: keep a backup, start fresh rather than crash.
      this.storage.set(SAVE_KEY + '-corrupt', raw);
      return defaultSave();
    }
  }

  /** Persist immediately. */
  save(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.storage.set(SAVE_KEY, JSON.stringify(this.data));
  }

  /** Coalesce frequent changes into one write. */
  saveSoon(ms = 400): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, ms);
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }
}
