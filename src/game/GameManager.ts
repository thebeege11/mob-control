/**
 * GameManager — owns the app state machine and wires every system together.
 *
 *   HOME ──tap──▶ PLAYING ──▶ (victory | dying) ──▶ RESULT ──tap──▶ PLAYING
 *                    ▲  └─pause─▶ PAUSED                     │
 *                    └───────────── revive ◀─────────────────┘
 *
 * Restart after failure is a single tap and ~no loading: the next level is
 * generated synchronously in a few milliseconds.
 */
import { TUNING, UPGRADE_IDS, type UpgradeId } from '../config/tuning';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { DailyModifier } from '../gen/types';
import { WebHaptics, type HapticsProvider } from '../platform/haptics';
import { LocalStorageBackend, type KeyValueStorage } from '../platform/storage';
import { Particles } from '../render/Particles';
import { Renderer, type HudState } from '../render/Renderer';
import { THEMES } from '../render/theme';
import { AdManager, MockAdProvider, type AdProvider } from '../systems/AdManager';
import { AnalyticsManager, BufferAnalyticsProvider, ConsoleAnalyticsProvider } from '../systems/AnalyticsManager';
import { AudioManager } from '../systems/AudioManager';
import { CurrencyManager } from '../systems/CurrencyManager';
import { chestReward, computeRunReward, isBossLevel } from '../systems/economy';
import { MockStoreProvider, PurchaseManager, type StoreProvider } from '../systems/PurchaseManager';
import { RetentionManager } from '../systems/RetentionManager';
import { SaveManager, type Settings } from '../systems/SaveManager';
import { SKIN_BY_ID, SkinManager } from '../systems/SkinManager';
import { UpgradeManager } from '../systems/UpgradeManager';
import { UIManager, type ResultData, type UpgradeCard } from '../ui/UIManager';
import { BotController } from './BotController';
import { Juice } from './Juice';
import { LevelManager } from './LevelManager';
import { PlayerController } from './PlayerController';
import { Simulation, type RunStats } from './Simulation';

type AppState = 'home' | 'playing' | 'paused' | 'ending' | 'result';

export interface GameDeps {
  storage?: KeyValueStorage;
  haptics?: HapticsProvider & { enabled: boolean };
  ads?: AdProvider;
  store?: StoreProvider;
}

export class GameManager {
  // Services
  readonly save: SaveManager;
  readonly currency: CurrencyManager;
  readonly upgrades: UpgradeManager;
  readonly analytics = new AnalyticsManager();
  readonly analyticsBuffer = new BufferAnalyticsProvider();
  readonly audio = new AudioManager();
  readonly haptics: HapticsProvider & { enabled: boolean };
  readonly ads: AdManager;
  readonly purchases: PurchaseManager;
  readonly skins: SkinManager;
  readonly retention: RetentionManager;
  readonly levels = new LevelManager();
  // Game
  readonly sim = new Simulation();
  readonly particles = new Particles(new Rng(99));
  readonly renderer: Renderer;
  readonly juice: Juice;
  readonly controller: PlayerController;
  readonly ui: UIManager;

  state: AppState = 'home';
  private last = 0;
  private acc = 0;
  private timeScale = 1;
  private realTime = 0;
  private endTimer = 0;
  private resultShownAt = 0;
  private dailyRun: { day: number; modifier: DailyModifier } | null = null;
  private lastResult: ResultData | null = null;
  private lastReward = { coins: 0, gems: 0 };
  private doubled = false;
  private safeTop = 0;
  private safeBottom = 0;
  private hud: HudState;
  private lastSoldiers = 0;
  private runStart = 0;
  private headStart = false;
  /** Debug/demo: `?autoplay` lets the bot drive (used by automated smoke tests). */
  autoplay: BotController | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, toastRoot: HTMLElement, deps: GameDeps = {}) {
    this.save = new SaveManager(deps.storage ?? new LocalStorageBackend());
    this.haptics = deps.haptics ?? new WebHaptics();
    this.currency = new CurrencyManager(this.save);
    this.analytics.addProvider(new ConsoleAnalyticsProvider(false));
    this.analytics.addProvider(this.analyticsBuffer);
    this.upgrades = new UpgradeManager(
      this.save.data.upgrades,
      (n) => this.currency.spend('coins', n),
      (id, lvl, cost) => {
        this.save.data.stats.upgradesBought++;
        this.analytics.track('upgrade_purchased', { upgrade: id, level: lvl, cost });
      },
    );
    this.ads = new AdManager(deps.ads ?? new MockAdProvider(2), this.save, this.analytics);
    this.purchases = new PurchaseManager(deps.store ?? new MockStoreProvider(), this.save, this.currency, this.analytics);
    this.skins = new SkinManager(this.save);
    this.retention = new RetentionManager(this.save, this.currency, this.skins, this.analytics);
    this.renderer = new Renderer(canvas, this.particles);
    this.ui = new UIManager(uiRoot, toastRoot);
    this.juice = new Juice(this.particles, this.renderer.texts, this.audio, this.haptics, (key) => {
      if (!this.save.data.hintsSeen.includes(key)) {
        this.save.data.hintsSeen.push(key);
        this.save.saveSoon();
        this.analytics.track('tutorial_hint', { key });
      }
    });
    this.controller = new PlayerController(canvas, {
      pxPerUnit: () => this.renderer.cam.scale0 * 0.87,
      currentX: () => this.sim.units.cx,
      surgeButton: () => this.renderer.surgeButton,
      onTap: () => this.onCanvasTap(),
      onSurge: () => {
        if (this.state === 'playing') this.sim.input.surge = true;
      },
      enabled: () => this.state === 'playing' && this.sim.ability.unlocked,
    });
    this.sim.hintFilter = (key) => !this.save.data.hintsSeen.includes(key);
    this.hud = {
      score: 0,
      multiplier: 1,
      combo: 0,
      surgeMeter: 0,
      surgeActive: 0,
      surgeUnlocked: false,
      soldiers: 0,
      countPop: 0,
      hint: '',
      hintTime: 0,
      level: 1,
      bestProgress: 0,
      coins: 0,
      leftHanded: false,
      safeTop: 0,
      safeBottom: 0,
      daily: false,
    };
    this.currency.onChange(() => this.ui.updateCurrency(this.currency.coins, this.currency.gems));
    this.ui.onAction((a, arg, el) => this.onAction(a, arg, el));
    this.applySettings();
  }

  // ------------------------------------------------------------ lifecycle

  boot(): void {
    this.measureSafeArea();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
        this.save.save();
      } else this.audio.resume();
    });
    window.addEventListener('pagehide', () => {
      this.analytics.endSession({ level: this.save.data.level });
      this.save.save();
    });
    document.getElementById('pauseBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state === 'playing') this.pause();
    });
    this.retention.touchDay();
    this.analytics.startSession({ level: this.save.data.level, coins: this.save.data.coins });
    this.prepareLevel();
    this.showHome();
    if (this.retention.dailyRewardAvailable() && this.save.data.stats.runs > 0) this.openDaily();
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** Android back button. Returns true when handled in-game. */
  handleBack(): boolean {
    if (this.state === 'playing') {
      this.pause();
      return true;
    }
    if (this.state === 'paused') {
      this.resume();
      return true;
    }
    if (this.ui.current === 'modal') {
      void this.onAction('close', undefined, document.body);
      return true;
    }
    if (this.state === 'result') {
      void this.onAction('home', undefined, document.body);
      return true;
    }
    return false;
  }

  onAppPause(): void {
    if (this.state === 'playing') this.pause();
    this.audio.suspend();
    this.analytics.endSession({ level: this.save.data.level });
    this.save.save();
  }

  onAppResume(): void {
    this.audio.resume();
    this.retention.touchDay();
    this.analytics.startSession({ level: this.save.data.level });
  }

  private measureSafeArea(): void {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    this.safeTop = parseFloat(cs.paddingTop) || 0;
    this.safeBottom = parseFloat(cs.paddingBottom) || 0;
    probe.remove();
  }

  /** Adaptive resolution: drop render scale on slow devices to hold 60 FPS. */
  private dprCap = 2;
  private frameEma = 1 / 60;
  private slowFrames = 0;

  private adaptQuality(dt: number): void {
    this.frameEma += (dt - this.frameEma) * 0.05;
    if (this.state !== 'playing') return;
    if (this.frameEma > 1 / 45) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.dprCap > 1) {
      this.dprCap = Math.max(1, this.dprCap - 0.5);
      this.slowFrames = 0;
      this.resize();
      this.analytics.track('quality_changed', { dpr: this.dprCap });
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(this.dprCap, window.devicePixelRatio || 1);
    this.renderer.resize(w, h, dpr);
    this.juice.screenTextX = w / 2;
    this.juice.screenTextY = h * 0.4;
  }

  private applySettings(): void {
    const s = this.save.data.settings;
    this.audio.sfxEnabled = s.sound;
    this.audio.musicEnabled = s.music;
    this.audio.setMusic(s.music);
    this.haptics.enabled = s.haptics;
    this.juice.reduceShake = s.reduceShake;
    document.body.classList.toggle('left-handed', s.leftHanded);
  }

  // ------------------------------------------------------------ level flow

  private prepareLevel(daily: { day: number; modifier: DailyModifier; level: number } | null = null): void {
    const d = this.save.data;
    this.dailyRun = daily ? { day: daily.day, modifier: daily.modifier } : null;
    const plan = this.levels.build({
      level: daily ? daily.level : d.level,
      stats: this.upgrades.stats(),
      failStreak: daily ? 0 : d.perf.failStreak,
      winStreak: daily ? 0 : d.perf.winStreak,
      daily: this.dailyRun ?? undefined,
    });
    this.sim.load(plan);
    this.skins.equipped && this.renderer.sprites.setSkin(this.skins.equipped);
    this.juice.skin = this.skins.equipped;
    this.controller.reset(0);
    this.particles.clear();
    this.renderer.texts.clear();
    this.juice.hintTime = 0;
    const cam = this.renderer.cam;
    cam.camY = this.sim.units.cy - 470;
    cam.camX = 0;
    this.lastSoldiers = this.sim.units.soldiers;
    this.audio.setIntensity(0);
  }

  private startRun(): void {
    this.audio.unlock();
    this.ui.hide();
    this.state = 'playing';
    this.sim.start();
    this.runStart = performance.now();
    this.save.data.stats.runs++;
    this.audio.setIntensity(1);
    document.body.classList.add('in-game');
    const plan = this.sim.plan;
    this.analytics.track('game_started', { level: plan.level, daily: !!this.dailyRun, difficulty: Math.round(plan.difficulty * 10) / 10 });
    if (this.headStart) {
      this.headStart = false;
      const extra = Math.ceil(plan.player.startUnits * TUNING.economy.headStartSquadBonus);
      this.sim.units.addSoldiers(extra, 0, this.sim.units.cy, new Rng(plan.seed));
      this.sim.ability.fill();
      this.juice.showHint(`HEAD START! +${extra}`);
      this.analytics.track('boost_used', { level: plan.level, extra });
    }
    if (!this.save.data.hintsSeen.includes('intro')) {
      this.juice.showHint('DRAG to steer · HOLD to squeeze');
      this.save.data.hintsSeen.push('intro');
    } else if (this.sim.ability.unlocked && !this.save.data.hintsSeen.includes('surge')) {
      this.juice.showHint('SURGE unlocked! Tap ⚡ when full');
      this.save.data.hintsSeen.push('surge');
    }
  }

  private onCanvasTap(): void {
    if (this.state === 'home' && this.ui.current === 'home') this.startRun();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showPause(this.save.data.settings);
  }

  private resume(): void {
    this.ui.hide();
    this.state = 'playing';
    this.controller.reset(this.sim.units.cx);
  }

  private showHome(): void {
    this.state = 'home';
    document.body.classList.remove('in-game');
    const d = this.save.data;
    this.ui.showHome({
      level: d.level,
      isBoss: isBossLevel(d.level),
      bestScore: d.bestScore,
      coins: d.coins,
      gems: d.gems,
      upgrades: this.upgradeCards(),
      dailyAvailable: this.retention.dailyRewardAvailable() || !this.retention.dailyChallenge().done,
      freeCoinsReady: this.ads.freeCoinsReady(),
      headStart: this.headStart,
      headStartGemCost: TUNING.economy.headStartGemCost,
      canAffordHeadStart: this.currency.canAfford('gems', TUNING.economy.headStartGemCost),
      firstTime: d.stats.runs === 0,
      themeName: THEMES[this.sim.plan.theme].name,
    });
  }

  private upgradeCards(): UpgradeCard[] {
    return UPGRADE_IDS.filter((id) => id !== 'surge' || this.save.data.highestLevel >= TUNING.ability.unlockLevel).map((id) => ({
      id,
      level: this.upgrades.levels[id],
      current: this.upgrades.current(id),
      next: this.upgrades.next(id),
      cost: this.upgrades.cost(id),
      affordable: this.currency.canAfford('coins', this.upgrades.cost(id)),
    }));
  }

  private buyUpgrade(id: UpgradeId): void {
    if (!this.upgrades.buy(id)) return;
    this.audio.play('upgrade');
    this.haptics.impact('medium');
    this.ui.toast(`${id.toUpperCase()} UP!`, `Level ${this.upgrades.levels[id]}`);
    this.save.save();
    this.ui.refreshUpgrades(this.upgradeCards());
    this.checkRetention();
    // Upgrades apply immediately to the level waiting behind the menu.
    if (this.state === 'home') this.prepareLevel();
  }

  // ------------------------------------------------------------ run end

  private onRunEnd(): void {
    const won = this.sim.phase === 'won';
    const st = this.sim.stats();
    const d = this.save.data;
    const plan = this.sim.plan;
    const level = plan.level;
    const daily = !!this.dailyRun;
    d.stats.playTimeSec += (performance.now() - this.runStart) / 1000;
    d.stats.kills += st.kills;
    d.stats.perfects += st.perfects;
    d.stats.maxSoldiers = Math.max(d.stats.maxSoldiers, st.maxSoldiers);
    d.stats.bestCombo = Math.max(d.stats.bestCombo, st.bestCombo);

    const reward = computeRunReward({
      level,
      won,
      progress: st.progress,
      survivors: st.survivors,
      pickupCoins: st.coins,
      incomeMult: plan.player.incomeMult,
      isBoss: plan.isBoss,
      isDaily: daily,
    });
    reward.gems += st.gems;
    this.currency.earn('coins', reward.coins);
    this.currency.earn('gems', reward.gems);
    this.lastReward = { coins: reward.coins, gems: reward.gems };
    this.doubled = false;

    const newBest = st.score > d.bestScore;
    if (newBest) {
      d.bestScore = st.score;
      this.analytics.track('new_high_score', { score: st.score, level });
    }
    const prevBestProgress = !daily && d.bestProgress.level === level ? d.bestProgress.progress : 0;
    if (won) {
      d.stats.wins++;
      if (plan.isBoss) d.stats.bossesKilled++;
      if (daily) this.retention.completeDailyChallenge();
      else {
        d.level = level + 1;
        d.highestLevel = Math.max(d.highestLevel, d.level);
        d.perf.winStreak++;
        d.perf.failStreak = 0;
        d.chestProgress++;
        d.bestProgress = { level: d.level, progress: 0 };
        this.ads.noteCompletion();
        this.analytics.track('level_up', { level: d.level });
      }
      this.analytics.track('game_completed', { level, score: st.score, survivors: st.survivors, time: Math.round(st.time), daily });
    } else {
      d.stats.fails++;
      if (!daily) {
        d.perf.failStreak++;
        d.perf.winStreak = 0;
        d.bestProgress = { level, progress: Math.max(prevBestProgress, st.progress) };
      }
      this.analytics.track('game_failed', { level, progress: Math.round(st.progress * 100), cause: st.deathCause, score: st.score, daily });
    }
    this.save.save();

    const canRevive = !won && this.sim.revives === 0 && st.progress >= TUNING.ads.reviveMinProgress;
    this.lastResult = {
      won,
      level,
      daily,
      score: st.score,
      best: d.bestScore,
      newBest,
      coins: reward.coins,
      gems: reward.gems,
      breakdown: reward.breakdown,
      progress: st.progress,
      bestProgress: prevBestProgress,
      causeText: causeText(st),
      survivors: st.survivors,
      kills: st.kills,
      bestCombo: st.bestCombo,
      canRevive,
      reviveGemCost: TUNING.economy.reviveGemCost,
      canAffordGemRevive: this.currency.canAfford('gems', TUNING.economy.reviveGemCost),
      canDouble: won && this.ads.rewardedAvailable(),
      chestPips: Math.min(d.chestProgress, TUNING.economy.chestEvery),
      chestEvery: TUNING.economy.chestEvery,
      chestReady: won && !daily && d.chestProgress >= TUNING.economy.chestEvery,
      upgrades: this.upgradeCards(),
      coinsTotal: this.currency.coins,
      gemsTotal: this.currency.gems,
      finaleLeftPct: st.finaleHpMax > 0 ? st.finaleHpLeft / st.finaleHpMax : 0,
      isBoss: plan.isBoss,
    };
    this.state = 'result';
    this.resultShownAt = performance.now();
    this.ui.showResult(this.lastResult);
    document.body.classList.remove('in-game');
    this.audio.setIntensity(0);
    if (won) this.audio.play('reward');
    this.checkRetention();
  }

  private checkRetention(): void {
    for (const a of this.retention.checkAchievements()) {
      this.ui.toast(`🏆 ${a.name}`, `+◆${a.gems}`);
      this.audio.play('reward');
    }
    for (const m of this.retention.checkMilestones()) {
      this.ui.toast(`LEVEL ${m.level} MILESTONE!`, m.skin ? `New skin: ${SKIN_BY_ID[m.skin]?.name} · +◆${m.gems}` : `+◆${m.gems}`);
    }
  }

  private async retryOrNext(): Promise<void> {
    // Tiny grace period so a frantic gameplay tap doesn't skip the result.
    if (performance.now() - this.resultShownAt < 350) return;
    const d = this.save.data;
    if (this.lastResult?.won && !this.dailyRun && this.ads.shouldShowInterstitial(d.level, d.perf.failStreak)) {
      await this.ads.showInterstitial();
    }
    this.prepareLevel();
    this.startRun();
  }

  private async revive(withGems: boolean): Promise<void> {
    if (withGems) {
      if (!this.currency.spend('gems', TUNING.economy.reviveGemCost)) return;
    } else {
      const ok = await this.ads.showRewarded('revive');
      if (!ok) return;
    }
    // Revive continues the same run, so undo the failure bookkeeping.
    const d = this.save.data;
    if (!this.dailyRun) {
      d.perf.failStreak = Math.max(0, d.perf.failStreak - 1);
    }
    d.stats.fails = Math.max(0, d.stats.fails - 1);
    d.stats.revives++;
    this.analytics.track('revive_used', { level: this.sim.plan.level, method: withGems ? 'gems' : 'ad' });
    this.sim.revive();
    this.ui.hide();
    this.state = 'playing';
    document.body.classList.add('in-game');
    this.audio.setIntensity(this.sim.finale.arena && this.sim.plan.isBoss ? 2 : 1);
    this.controller.reset(this.sim.units.cx);
    this.juice.showHint('REVIVED! Go go go!');
  }

  private openDaily(): void {
    const ch = this.retention.dailyChallenge();
    this.ui.showDaily({
      available: this.retention.dailyRewardAvailable(),
      streakDay: this.retention.pendingStreakDay(),
      highestLevel: this.save.data.highestLevel,
      challenge: ch,
    });
  }

  private openChest(): void {
    const d = this.save.data;
    if (d.chestProgress < TUNING.economy.chestEvery) return;
    d.chestProgress = 0;
    d.stats.chestsOpened++;
    const rng = new Rng((Date.now() & 0xffffffff) >>> 0);
    const r = chestReward(d.highestLevel, () => rng.next());
    this.currency.earn('coins', r.coins);
    this.currency.earn('gems', r.gems);
    const skin = r.skin ? this.skins.randomLocked(rng.next()) : undefined;
    if (skin) this.skins.unlock(skin.id);
    this.save.save();
    this.audio.play('chest');
    this.haptics.impact('heavy');
    this.analytics.track('reward_claimed', { type: 'chest', coins: r.coins, gems: r.gems, skin: skin?.id ?? '' });
    this.ui.showChest({ coins: r.coins, gems: r.gems, skin });
  }

  // ------------------------------------------------------------ UI actions

  private async onAction(action: string, arg: string | undefined, el: HTMLElement): Promise<void> {
    this.audio.unlock();
    if (action !== 'retry' && action !== 'next') this.audio.play('click');
    switch (action) {
      case 'play':
        this.startRun();
        break;
      case 'upgrade':
        this.buyUpgrade(arg as UpgradeId);
        break;
      case 'retry':
      case 'next':
        await this.retryOrNext();
        break;
      case 'home':
        this.save.save();
        this.prepareLevel();
        this.showHome();
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.prepareLevel(this.dailyRun ? { ...this.dailyRun, level: this.sim.plan.level } : null);
        this.startRun();
        break;
      case 'close':
        if (this.state === 'paused') this.ui.showPause(this.save.data.settings);
        else if (this.state === 'result' && this.lastResult) this.ui.showResult(this.lastResult);
        else this.showHome();
        break;
      case 'settings':
        this.ui.showSettings(this.save.data.settings, this.save.data.removeAds);
        break;
      case 'toggle': {
        const k = arg as keyof Settings;
        this.save.data.settings[k] = !this.save.data.settings[k];
        this.applySettings();
        this.save.save();
        el.classList.toggle('on', this.save.data.settings[k]);
        break;
      }
      case 'reset':
        this.ui.confirm('Erase ALL progress? This cannot be undone.', 'reset-confirm');
        break;
      case 'reset-confirm':
        this.save.reset();
        location.reload();
        break;
      case 'skins':
        this.ui.showSkins(this.save.data.skins.owned, this.save.data.skins.equipped, this.currency.gems, this.currency.coins);
        break;
      case 'equip':
        if (arg && this.skins.equip(arg)) {
          this.renderer.sprites.setSkin(this.skins.equipped);
          this.juice.skin = this.skins.equipped;
          this.analytics.track('skin_equipped', { skin: arg });
          this.ui.showSkins(this.save.data.skins.owned, this.save.data.skins.equipped, this.currency.gems, this.currency.coins);
        }
        break;
      case 'buyskin': {
        const s = arg ? SKIN_BY_ID[arg] : undefined;
        if (s && s.unlock.type === 'gems' && this.currency.spend('gems', s.unlock.cost)) {
          this.skins.unlock(s.id);
          this.skins.equip(s.id);
          this.renderer.sprites.setSkin(this.skins.equipped);
          this.juice.skin = this.skins.equipped;
          this.audio.play('reward');
          this.save.save();
          this.ui.showSkins(this.save.data.skins.owned, this.save.data.skins.equipped, this.currency.gems, this.currency.coins);
        }
        break;
      }
      case 'daily':
        this.openDaily();
        break;
      case 'claim-daily':
      case 'claim-daily-2x': {
        let mult = 1;
        if (action === 'claim-daily-2x') {
          if (!(await this.ads.showRewarded('double_reward'))) break;
          mult = 2;
        }
        const r = this.retention.claimDailyReward(mult);
        if (r) {
          this.audio.play('reward');
          this.ui.toast('DAILY REWARD!', `${r.coins ? `+$${r.coins * mult} ` : ''}${r.gems ? `+◆${r.gems * mult}` : ''}`);
          if (r.chest) {
            this.save.data.chestProgress = Math.max(this.save.data.chestProgress, TUNING.economy.chestEvery);
            this.openChest();
            break;
          }
        }
        this.checkRetention();
        this.openDaily();
        break;
      }
      case 'play-daily': {
        const ch = this.retention.dailyChallenge();
        if (ch.done) break;
        this.analytics.track('daily_challenge_started', { day: ch.day, modifier: ch.modifier });
        this.prepareLevel({ day: ch.day, modifier: ch.modifier, level: ch.level });
        this.startRun();
        break;
      }
      case 'trophies':
        this.ui.showTrophies(this.save.data);
        break;
      case 'shop':
        this.ui.showShop((id) => this.purchases.owns(id), this.currency.gems, this.currency.coins);
        break;
      case 'buy':
        if (arg && (await this.purchases.buy(arg))) {
          this.ui.toast('THANK YOU!', 'Purchase complete');
          if (arg.startsWith('skin')) this.renderer.sprites.setSkin(this.skins.equipped);
          this.ui.showShop((id) => this.purchases.owns(id), this.currency.gems, this.currency.coins);
        }
        break;
      case 'restore': {
        const n = await this.purchases.restore();
        this.ui.toast('Purchases restored', `${n} item(s)`);
        break;
      }
      case 'freecoins':
        if (this.ads.freeCoinsReady() && (await this.ads.showRewarded('free_coins'))) {
          const amt = 60 + this.save.data.highestLevel * 12;
          this.currency.earn('coins', amt);
          this.ads.markFreeCoins();
          this.analytics.track('reward_claimed', { type: 'free_coins', coins: amt });
          this.audio.play('reward');
          this.ui.toast('FREE COINS!', `+$${amt}`);
          this.showHome();
        }
        break;
      case 'double':
        if (!this.doubled && (await this.ads.showRewarded('double_reward'))) {
          this.doubled = true;
          this.currency.earn('coins', this.lastReward.coins);
          this.analytics.track('reward_claimed', { type: 'double', coins: this.lastReward.coins });
          this.audio.play('reward');
          this.ui.bumpCoins(this.currency.coins, this.lastReward.coins);
          el.setAttribute('disabled', '');
          if (this.lastResult) {
            this.lastResult.coins += this.lastReward.coins;
            this.lastResult.canDouble = false;
            this.lastResult.coinsTotal = this.currency.coins;
          }
          this.ui.refreshUpgrades(this.upgradeCards());
        }
        break;
      case 'boost-ad':
      case 'boost-gems':
        if (this.headStart) break;
        if (action === 'boost-gems' ? this.currency.spend('gems', TUNING.economy.headStartGemCost) : await this.ads.showRewarded('head_start')) {
          this.headStart = true;
          this.audio.play('upgrade');
          this.showHome();
        }
        break;
      case 'revive-ad':
        await this.revive(false);
        break;
      case 'revive-gems':
        await this.revive(true);
        break;
      case 'chest':
        this.openChest();
        break;
      case 'chest-done':
        if (this.lastResult) {
          this.lastResult.chestReady = false;
          this.lastResult.chestPips = 0;
          this.lastResult.coinsTotal = this.currency.coins;
          this.lastResult.gemsTotal = this.currency.gems;
          this.lastResult.upgrades = this.upgradeCards();
          this.ui.showResult(this.lastResult);
        } else this.showHome();
        break;
    }
  }

  // ------------------------------------------------------------ main loop

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1; // tab switches / hitches: never spiral
    this.realTime += dt;
    this.adaptQuality(dt);
    const sim = this.sim;

    // Slow-motion easing
    const targetScale = this.juice.slowMo > 0 ? TUNING.juice.slowMoScale : 1;
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, dt * 10);

    if (this.state === 'playing' || this.state === 'ending') {
      if (this.autoplay) this.autoplay.update(sim);
      else this.controller.apply(sim.input, dt);
      this.acc += dt * this.timeScale;
      const step = TUNING.fixedDt;
      let n = 0;
      while (this.acc >= step && n < 5) {
        sim.step(step);
        this.acc -= step;
        n++;
        this.juice.process(sim);
        sim.events.clear();
      }
      if (n === 5) this.acc = 0;
      if (this.state === 'playing' && sim.finished) {
        this.state = 'ending';
        this.endTimer = sim.phase === 'won' ? 0.5 : 1.0;
        if (sim.phase === 'failed') {
          this.juice.slowMo = 0.6;
          this.juice.addShake(0.5);
          this.audio.play('fail');
          this.haptics.impact('heavy');
          this.juice.flash = 0.35;
          this.juice.flashColor = '#ff3b6b';
        }
      } else if (this.state === 'ending') {
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.onRunEnd();
      }
      if (sim.units.soldiers !== this.lastSoldiers) this.lastSoldiers = sim.units.soldiers;
    } else if (this.state === 'home') {
      // Idle "breathing" swarm behind the menu.
      sim.units.update(dt, 0, false, Infinity);
    }

    this.juice.update(dt);
    this.particles.update(dt * this.timeScale);
    this.renderer.texts.update(dt);
    this.updateCamera(dt);
    this.juice.surgeTint += ((sim.ability.active > 0 ? 1 : 0) - this.juice.surgeTint) * Math.min(1, dt * 6);

    const playingHud = this.state === 'playing' || this.state === 'ending' || this.state === 'paused';
    if (playingHud) this.fillHud();
    this.renderer.render({
      sim,
      time: this.realTime,
      theme: THEMES[sim.plan.theme] ?? THEMES[0],
      hud: playingHud ? this.hud : null,
      flash: this.juice.flash,
      flashColor: this.juice.flashColor,
      surgeTint: this.juice.surgeTint,
    });
  };

  private updateCamera(dt: number): void {
    const cam = this.renderer.cam;
    const sim = this.sim;
    const u = sim.units;
    const f = sim.finale.f;
    // Menu: camera pulled back so the swarm sits above the UI; zooms in on start.
    const targetY = this.state === 'home' ? u.cy - 470 : sim.finale.arena ? f.y - 330 : u.cy - 150;
    cam.camY += (targetY - cam.camY) * (1 - Math.exp(-dt * 7));
    cam.camX += (u.cx * 0.22 - cam.camX) * (1 - Math.exp(-dt * 5));
    const tr = this.juice.shake;
    const mag = TUNING.juice.maxShake * tr * tr;
    cam.shakeX = mag * Math.sin(this.realTime * 71.3);
    cam.shakeY = mag * Math.cos(this.realTime * 59.1);
    cam.zoom = 1 + this.juice.zoomPunch;
  }

  private fillHud(): void {
    const sim = this.sim;
    const h = this.hud;
    const d = this.save.data;
    h.score = sim.score.score;
    h.multiplier = sim.score.multiplier;
    h.combo = sim.score.combo;
    h.surgeMeter = sim.ability.meter;
    h.surgeActive = sim.ability.active;
    h.surgeUnlocked = sim.ability.unlocked;
    h.soldiers = sim.units.soldiers;
    h.countPop = this.juice.countPop;
    h.hint = this.juice.hint;
    h.hintTime = this.juice.hintTime;
    h.level = sim.plan.level;
    h.bestProgress = !this.dailyRun && d.bestProgress.level === sim.plan.level ? d.bestProgress.progress : 0;
    h.coins = sim.coins;
    h.leftHanded = d.settings.leftHanded;
    h.safeTop = this.safeTop;
    h.safeBottom = this.safeBottom;
    h.daily = !!this.dailyRun;
  }
}

function causeText(st: RunStats): string {
  if (st.finaleHpMax > 0 && st.finaleHpLeft < st.finaleHpMax && st.progress >= 0.9) {
    const pct = Math.round(clamp(1 - st.finaleHpLeft / st.finaleHpMax, 0, 1) * 100);
    return `The finale was ${pct}% destroyed — grow a bigger swarm!`;
  }
  switch (st.deathCause) {
    case 'hazard':
      return 'Your swarm hit a hazard — squeeze & steer!';
    case 'enemy':
      return 'Out-numbered! Grab more gates first.';
    case 'gate':
      return 'A red gate drained your swarm.';
    case 'finale':
      return 'The finale held. More power!';
    default:
      return 'So close — try again!';
  }
}
