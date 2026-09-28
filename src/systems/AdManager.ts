import { TUNING } from '../config/tuning';
import type { AnalyticsManager } from './AnalyticsManager';
import type { SaveManager } from './SaveManager';

export type RewardedPlacement = 'revive' | 'double_reward' | 'free_coins' | 'chest_boost' | 'head_start';

/** Implement with AdMob / AppLovin MAX / Unity Ads etc. */
export interface AdProvider {
  readonly name: string;
  isRewardedReady(): boolean;
  isInterstitialReady(): boolean;
  /** Resolves true if the user earned the reward. */
  showRewarded(placement: RewardedPlacement): Promise<boolean>;
  showInterstitial(): Promise<void>;
}

/**
 * Development/mock provider: shows a short on-screen "ad" so the whole
 * reward flow is testable without any SDK.
 */
export class MockAdProvider implements AdProvider {
  readonly name = 'mock';
  constructor(private seconds = 2) {}
  isRewardedReady(): boolean {
    return true;
  }
  isInterstitialReady(): boolean {
    return true;
  }
  showRewarded(placement: RewardedPlacement): Promise<boolean> {
    return this.overlay(`Rewarded ad (${placement})`, true);
  }
  async showInterstitial(): Promise<void> {
    await this.overlay('Interstitial ad', false);
  }
  private overlay(label: string, rewarded: boolean): Promise<boolean> {
    if (typeof document === 'undefined') return Promise.resolve(true);
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'mock-ad';
      el.innerHTML = `<div class="mock-ad-box"><div class="mock-ad-tag">AD</div><div class="mock-ad-label">${label}</div><div class="mock-ad-count"></div>${
        rewarded ? '<button class="mock-ad-skip">Close (no reward)</button>' : ''
      }</div>`;
      document.body.appendChild(el);
      const count = el.querySelector('.mock-ad-count') as HTMLElement;
      let left = this.seconds;
      count.textContent = String(left);
      const done = (ok: boolean) => {
        clearInterval(iv);
        el.remove();
        resolve(ok);
      };
      const iv = setInterval(() => {
        left--;
        count.textContent = String(Math.max(0, left));
        if (left <= 0) done(true);
      }, 1000);
      el.querySelector('.mock-ad-skip')?.addEventListener('click', () => done(false));
    });
  }
}

/**
 * Ad policy: rewarded ads are always optional. Interstitials are rare,
 * never shown in the first levels, never after consecutive failures, and
 * disabled entirely by the Remove Ads purchase.
 */
export class AdManager {
  constructor(
    private provider: AdProvider,
    private save: SaveManager,
    private analytics: AnalyticsManager,
    private now: () => number = () => Date.now(),
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  rewardedAvailable(): boolean {
    return this.provider.isRewardedReady();
  }

  async showRewarded(placement: RewardedPlacement): Promise<boolean> {
    this.analytics.track('ad_offered', { placement });
    const ok = await this.provider.showRewarded(placement);
    if (ok) {
      this.save.data.stats.adsWatched++;
      this.save.saveSoon();
      this.analytics.track('ad_watched', { placement, type: 'rewarded' });
    }
    return ok;
  }

  /** Call after a level completion; shows an interstitial only when policy allows. */
  shouldShowInterstitial(level: number, failStreak: number): boolean {
    const d = this.save.data;
    if (d.removeAds) return false;
    if (level < TUNING.ads.interstitialMinLevel) return false;
    if (failStreak > 0) return false;
    if (d.ads.completionsSinceInterstitial < TUNING.ads.interstitialEveryCompletions) return false;
    if ((this.now() - d.ads.lastInterstitialAt) / 1000 < TUNING.ads.interstitialMinSeconds) return false;
    return this.provider.isInterstitialReady();
  }

  noteCompletion(): void {
    this.save.data.ads.completionsSinceInterstitial++;
  }

  async showInterstitial(): Promise<void> {
    const d = this.save.data;
    d.ads.completionsSinceInterstitial = 0;
    d.ads.lastInterstitialAt = this.now();
    this.save.saveSoon();
    await this.provider.showInterstitial();
    this.analytics.track('ad_watched', { type: 'interstitial' });
  }

  freeCoinsReady(): boolean {
    return this.now() - this.save.data.ads.lastFreeCoinsAt > 5 * 60 * 1000;
  }

  markFreeCoins(): void {
    this.save.data.ads.lastFreeCoinsAt = this.now();
    this.save.saveSoon();
  }
}
