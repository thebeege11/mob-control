import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config/tuning';
import { ScoreManager } from '../src/game/ScoreManager';
import { EventQueue, Ev } from '../src/game/SimEvents';
import { Simulation } from '../src/game/Simulation';
import { MemoryStorage } from '../src/platform/storage';
import { AdManager, type AdProvider } from '../src/systems/AdManager';
import { AnalyticsManager, BufferAnalyticsProvider } from '../src/systems/AnalyticsManager';
import { CurrencyManager } from '../src/systems/CurrencyManager';
import { DifficultyManager, baseComplexity, levelComplexity } from '../src/systems/DifficultyManager';
import { chestReward, computeRunReward, winBaseCoins } from '../src/systems/economy';
import { MockStoreProvider, PurchaseManager } from '../src/systems/PurchaseManager';
import { RetentionManager, dayIndex } from '../src/systems/RetentionManager';
import { SAVE_KEY, SaveManager, defaultSave, migrate } from '../src/systems/SaveManager';
import { SkinManager } from '../src/systems/SkinManager';
import { UpgradeManager, defaultUpgradeLevels, statsFromLevels, upgradeCost, upgradeValue } from '../src/systems/UpgradeManager';
import { gen, dm } from './simHarness';

describe('SaveManager', () => {
  it('round-trips data through storage', () => {
    const store = new MemoryStorage();
    const a = new SaveManager(store);
    a.data.coins = 1234;
    a.data.upgrades.power = 7;
    a.data.level = 42;
    a.data.settings.music = false;
    a.save();
    const b = new SaveManager(store);
    expect(b.data.coins).toBe(1234);
    expect(b.data.upgrades.power).toBe(7);
    expect(b.data.level).toBe(42);
    expect(b.data.settings.music).toBe(false);
  });

  it('survives corrupt saves', () => {
    const store = new MemoryStorage();
    store.set(SAVE_KEY, '{not json');
    const s = new SaveManager(store);
    expect(s.data.level).toBe(1);
    expect(store.get(SAVE_KEY + '-corrupt')).toBe('{not json');
  });

  it('migrates old versions and fills new fields with defaults', () => {
    const d = migrate({ version: 1, coins: 50, unlockedSkins: ['classic', 'ember'], equippedSkin: 'ember', level: 3 });
    expect(d.version).toBe(2);
    expect(d.coins).toBe(50);
    expect(d.skins.owned).toContain('ember');
    expect(d.skins.equipped).toBe('ember');
    expect(d.settings.sound).toBe(true);
    expect(d.stats.runs).toBe(0);
  });

  it('sanitises tampered values', () => {
    const d = migrate({ coins: -50, level: 0, upgrades: { power: -3 }, skins: { owned: [], equipped: 'nope' } });
    expect(d.coins).toBe(0);
    expect(d.level).toBe(1);
    expect(d.upgrades.power).toBe(1);
    expect(d.skins.equipped).toBe('classic');
  });

  it('reset keeps settings', () => {
    const s = new SaveManager(new MemoryStorage());
    s.data.coins = 99;
    s.data.settings.haptics = false;
    s.reset();
    expect(s.data.coins).toBe(0);
    expect(s.data.settings.haptics).toBe(false);
  });
});

describe('Upgrades & currency', () => {
  it('costs grow geometrically, stats grow (soft-capped where configured)', () => {
    for (const id of ['power', 'health', 'squad', 'gates', 'surge', 'income'] as const) {
      expect(upgradeCost(id, 10)).toBeGreaterThan(upgradeCost(id, 2));
      expect(upgradeValue(id, 10)).toBeGreaterThan(upgradeValue(id, 1));
    }
    expect(upgradeValue('gates', 500)).toBeLessThanOrEqual(TUNING.upgrades.gates.max);
    expect(upgradeValue('surge', 500)).toBeLessThanOrEqual(TUNING.upgrades.surge.max);
  });

  it('buying spends coins and raises the level; cannot overspend', () => {
    const save = new SaveManager(new MemoryStorage());
    const cur = new CurrencyManager(save);
    const up = new UpgradeManager(save.data.upgrades, (n) => cur.spend('coins', n));
    cur.earn('coins', upgradeCost('power', 1));
    expect(up.buy('power')).toBe(true);
    expect(save.data.upgrades.power).toBe(2);
    expect(cur.coins).toBe(0);
    expect(up.buy('power')).toBe(false);
    expect(save.data.upgrades.power).toBe(2);
    expect(up.stats().power).toBe(upgradeValue('power', 2));
  });

  it('every upgrade visibly changes a stat', () => {
    const base = statsFromLevels(defaultUpgradeLevels());
    const l = defaultUpgradeLevels();
    l.power++;
    l.health++;
    l.squad++;
    l.gates++;
    l.surge++;
    l.income++;
    const up = statsFromLevels(l);
    expect(up.power).toBeGreaterThan(base.power);
    expect(up.health).toBeGreaterThan(base.health);
    expect(up.startUnits).toBeGreaterThan(base.startUnits);
    expect(up.gateBonus).toBeGreaterThan(base.gateBonus);
    expect(up.surgeDuration).toBeGreaterThan(base.surgeDuration);
    expect(up.incomeMult).toBeGreaterThan(base.incomeMult);
  });
});

describe('Economy & rewards', () => {
  it('win rewards grow with level; bosses pay more and give gems', () => {
    expect(winBaseCoins(20)).toBeGreaterThan(winBaseCoins(2));
    const normal = computeRunReward({ level: 10, won: true, progress: 1, survivors: 50, pickupCoins: 10, incomeMult: 1, isBoss: false });
    const boss = computeRunReward({ level: 10, won: true, progress: 1, survivors: 50, pickupCoins: 10, incomeMult: 1, isBoss: true });
    expect(boss.coins).toBeGreaterThan(normal.coins);
    expect(boss.gems).toBeGreaterThan(0);
  });

  it('failing still pays something proportional to progress', () => {
    const lo = computeRunReward({ level: 10, won: false, progress: 0.2, survivors: 0, pickupCoins: 0, incomeMult: 1, isBoss: false });
    const hi = computeRunReward({ level: 10, won: false, progress: 0.9, survivors: 0, pickupCoins: 0, incomeMult: 1, isBoss: false });
    expect(hi.coins).toBeGreaterThan(lo.coins);
    expect(lo.coins).toBeGreaterThan(0);
  });

  it('income upgrade multiplies coins', () => {
    const a = computeRunReward({ level: 5, won: true, progress: 1, survivors: 20, pickupCoins: 5, incomeMult: 1, isBoss: false });
    const b = computeRunReward({ level: 5, won: true, progress: 1, survivors: 20, pickupCoins: 5, incomeMult: 2, isBoss: false });
    expect(b.coins).toBe(Math.round(a.coins * 2));
  });

  it('chest rewards are meaningful and deterministic for a given roll', () => {
    const r1 = chestReward(10, () => 0.5);
    const r2 = chestReward(10, () => 0.5);
    expect(r1).toEqual(r2);
    expect(r1.coins).toBeGreaterThan(winBaseCoins(10) * 3);
    expect(r1.gems).toBeGreaterThanOrEqual(TUNING.economy.chestGemsMin);
  });

  it('the reference player can afford roughly one upgrade per level early on', () => {
    const l5 = dm.referenceLevels(5);
    const l30 = dm.referenceLevels(30);
    const sum = (l: Record<string, number>) => Object.values(l).reduce((a, b) => a + b, 0) - 6;
    expect(sum(l5)).toBeGreaterThanOrEqual(3);
    expect(sum(l30)).toBeGreaterThan(sum(l5) * 3);
  });
});

describe('Difficulty', () => {
  it('complexity grows forever but sub-linearly', () => {
    expect(baseComplexity(10)).toBeGreaterThan(baseComplexity(1));
    expect(baseComplexity(1000)).toBeGreaterThan(baseComplexity(100));
    expect(baseComplexity(100) - baseComplexity(90)).toBeLessThan(baseComplexity(20) - baseComplexity(10));
  });

  it('has breathers after bosses', () => {
    expect(levelComplexity(11)).toBeLessThan(levelComplexity(10));
  });

  it('player power only partially offsets enemy scaling', () => {
    const m = new DifficultyManager();
    const ref = m.referenceStats(40);
    const strong = { ...ref, power: ref.power * 2 };
    const a = m.compute(40, ref, { failStreak: 0, winStreak: 0 });
    const b = m.compute(40, strong, { failStreak: 0, winStreak: 0 });
    expect(b.enemyHpMult).toBeGreaterThan(a.enemyHpMult);
    expect(b.enemyHpMult / a.enemyHpMult).toBeLessThan(2);
    expect(b.complexity).toBe(a.complexity); // skill difficulty never depends on upgrades
  });
});

describe('Score & combo', () => {
  it('builds multiplier tiers and drops one tier on a mistake', () => {
    const q = new EventQueue();
    const s = new ScoreManager(q);
    for (let i = 0; i < TUNING.combo.tiers[1]; i++) s.success(0, 0);
    expect(s.multiplier).toBe(3);
    s.mistake(0, 0);
    expect(s.multiplier).toBe(2);
    expect(s.combo).toBe(TUNING.combo.tiers[0]);
    const before = s.score;
    s.add(10);
    expect(s.score - before).toBe(20);
    let comboEvents = 0;
    for (let i = 0; i < q.count; i++) if (q.get(i).type === Ev.Combo) comboEvents++;
    expect(comboEvents).toBeGreaterThan(0);
  });

  it('combo decays by one tier after idling', () => {
    const s = new ScoreManager(new EventQueue());
    for (let i = 0; i < TUNING.combo.tiers[2]; i++) s.success(0, 0);
    const m = s.multiplier;
    s.update(TUNING.combo.comboTimeout + 0.1);
    expect(s.multiplier).toBe(m - 1);
  });
});

describe('Simulation lifecycle', () => {
  it('restart produces an identical level and fresh state (instant retry)', () => {
    const stats = statsFromLevels(dm.referenceLevels(12));
    const a = gen.generate({ level: 12, stats });
    const sim = new Simulation();
    sim.load(a);
    sim.start();
    for (let i = 0; i < 300; i++) sim.step(TUNING.fixedDt);
    expect(sim.units.cy).toBeGreaterThan(0);
    sim.load(gen.generate({ level: 12, stats }));
    expect(sim.units.cy).toBe(0);
    expect(sim.score.score).toBe(0);
    expect(sim.units.soldiers).toBe(stats.startUnits);
    expect(sim.phase).toBe('ready');
  });

  it('revive restores a playable swarm after failure', () => {
    const plan = gen.generate({ level: 8, stats: statsFromLevels(defaultUpgradeLevels()) });
    const sim = new Simulation();
    sim.load(plan);
    sim.start();
    for (let i = 0; i < 60; i++) sim.step(TUNING.fixedDt);
    for (let i = 0; i < sim.units.count; i++) sim.units.kill(sim.units.units[i]);
    sim.units.compact();
    sim.step(TUNING.fixedDt);
    expect(sim.phase).toBe('failed');
    sim.revive();
    expect(sim.phase).toBe('running');
    expect(sim.units.soldiers).toBeGreaterThan(0);
    expect(sim.invulnerable).toBe(true);
  });

  it('gates multiply and subtract soldiers exactly', () => {
    const plan = gen.generate({ level: 1, stats: statsFromLevels(defaultUpgradeLevels()) });
    // Replace the level with a single x3 gate across the track.
    plan.segments = [{ moduleId: 't', category: 'growth', y0: 100, y1: 300, rating: 0, needsRecoveryAfter: false, armyBest: 0, armyTypical: 0, entities: [{ t: 'gate', y: 200, x0: -160, x1: 160, kind: 'mul', value: 3 }] }];
    const sim = new Simulation();
    sim.load(plan);
    sim.start();
    const start = sim.units.soldiers;
    for (let i = 0; i < 120; i++) sim.step(TUNING.fixedDt);
    expect(sim.units.soldiers).toBe(start * 3);
    plan.segments[0].entities = [{ t: 'gate', y: 200, x0: -160, x1: 160, kind: 'sub', value: 5 }];
    sim.load(plan);
    sim.start();
    for (let i = 0; i < 120; i++) sim.step(TUNING.fixedDt);
    expect(sim.units.soldiers).toBe(start - 5);
  });

  it('units beyond the physical cap become weight (no entity explosion)', () => {
    const plan = gen.generate({ level: 1, stats: statsFromLevels(defaultUpgradeLevels()) });
    plan.segments = [{ moduleId: 't', category: 'growth', y0: 100, y1: 300, rating: 0, needsRecoveryAfter: false, armyBest: 0, armyTypical: 0, entities: [{ t: 'gate', y: 200, x0: -160, x1: 160, kind: 'add', value: 5000 }] }];
    const sim = new Simulation();
    sim.load(plan);
    sim.start();
    for (let i = 0; i < 120; i++) sim.step(TUNING.fixedDt);
    expect(sim.units.count).toBeLessThanOrEqual(TUNING.world.maxUnits);
    expect(sim.units.soldiers).toBe(5000 + plan.player.startUnits);
    let sum = 0;
    for (let i = 0; i < sim.units.count; i++) sum += sim.units.units[i].weight;
    expect(sum).toBe(sim.units.soldiers);
  });
});

describe('Monetization policy', () => {
  const fakeAds = (): AdProvider => ({
    name: 'fake',
    isRewardedReady: () => true,
    isInterstitialReady: () => true,
    showRewarded: async () => true,
    showInterstitial: async () => {},
  });

  it('never shows interstitials early, after failures, too often, or with Remove Ads', async () => {
    let now = 1_000_000;
    const save = new SaveManager(new MemoryStorage());
    const ads = new AdManager(fakeAds(), save, new AnalyticsManager(), () => now);
    expect(ads.shouldShowInterstitial(2, 0)).toBe(false);
    for (let i = 0; i < TUNING.ads.interstitialEveryCompletions; i++) ads.noteCompletion();
    expect(ads.shouldShowInterstitial(10, 1)).toBe(false);
    expect(ads.shouldShowInterstitial(10, 0)).toBe(true);
    await ads.showInterstitial();
    for (let i = 0; i < TUNING.ads.interstitialEveryCompletions; i++) ads.noteCompletion();
    expect(ads.shouldShowInterstitial(10, 0)).toBe(false); // too soon
    now += TUNING.ads.interstitialMinSeconds * 1000 + 1;
    expect(ads.shouldShowInterstitial(10, 0)).toBe(true);
    save.data.removeAds = true;
    expect(ads.shouldShowInterstitial(10, 0)).toBe(false);
  });

  it('purchases grant content and restore works', async () => {
    const save = new SaveManager(new MemoryStorage());
    const cur = new CurrencyManager(save);
    const store = new MockStoreProvider();
    const pm = new PurchaseManager(store, save, cur, new AnalyticsManager());
    expect(await pm.buy('gems_small')).toBe(true);
    expect(cur.gems).toBe(60);
    expect(await pm.buy('remove_ads')).toBe(true);
    expect(save.data.removeAds).toBe(true);
    save.data.removeAds = false;
    expect(await pm.restore()).toBe(1);
    expect(save.data.removeAds).toBe(true);
  });
});

describe('Retention', () => {
  it('daily reward: once per day, streak continues on consecutive days and resets after a gap', () => {
    let now = new Date(2026, 0, 10, 12).getTime();
    const save = new SaveManager(new MemoryStorage());
    const cur = new CurrencyManager(save);
    const r = new RetentionManager(save, cur, new SkinManager(save), new AnalyticsManager(), () => now);
    expect(r.claimDailyReward()).not.toBeNull();
    expect(r.claimDailyReward()).toBeNull();
    now += 86400000;
    r.claimDailyReward();
    expect(save.data.daily.streak).toBe(2);
    now += 3 * 86400000;
    r.claimDailyReward();
    expect(save.data.daily.streak).toBe(1);
    expect(dayIndex(now)).toBeGreaterThan(0);
  });

  it('achievements and milestones grant once', () => {
    const save = new SaveManager(new MemoryStorage());
    const cur = new CurrencyManager(save);
    const skins = new SkinManager(save);
    const analytics = new AnalyticsManager();
    const buf = new BufferAnalyticsProvider();
    analytics.addProvider(buf);
    const r = new RetentionManager(save, cur, skins, analytics);
    save.data.stats.wins = 1;
    save.data.highestLevel = 26;
    const got = r.checkAchievements();
    expect(got.map((a) => a.id)).toContain('first_win');
    expect(r.checkAchievements().length).toBe(0);
    const ms = r.checkMilestones();
    expect(ms.map((m) => m.level)).toEqual([10, 25]);
    expect(skins.owns('ember')).toBe(true);
    expect(r.checkMilestones().length).toBe(0);
    expect(buf.events.some((e) => e.event === 'achievement_unlocked')).toBe(true);
  });

  it('daily challenge is seeded by day and marked complete', () => {
    const now = new Date(2026, 3, 1, 9).getTime();
    const save = new SaveManager(new MemoryStorage());
    const r = new RetentionManager(save, new CurrencyManager(save), new SkinManager(save), new AnalyticsManager(), () => now);
    const c = r.dailyChallenge();
    expect(c.done).toBe(false);
    r.completeDailyChallenge();
    expect(r.dailyChallenge().done).toBe(true);
    expect(defaultSave().daily.challengeDone).toBe(false);
  });
});
