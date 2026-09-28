/**
 * Provider-agnostic analytics. Plug in Firebase / GameAnalytics / Amplitude by
 * implementing AnalyticsProvider; nothing else in the game changes.
 */
export type AnalyticsEvent =
  | 'session_started'
  | 'session_ended'
  | 'game_started'
  | 'game_failed'
  | 'game_completed'
  | 'upgrade_purchased'
  | 'reward_claimed'
  | 'ad_watched'
  | 'ad_offered'
  | 'revive_used'
  | 'new_high_score'
  | 'level_up'
  | 'purchase_completed'
  | 'achievement_unlocked'
  | 'daily_reward_claimed'
  | 'daily_challenge_started'
  | 'skin_equipped'
  | 'tutorial_hint';

export type AnalyticsParams = Record<string, string | number | boolean>;

export interface AnalyticsProvider {
  track(event: AnalyticsEvent, params: AnalyticsParams): void;
  flush?(): void;
}

export class ConsoleAnalyticsProvider implements AnalyticsProvider {
  constructor(private verbose = false) {}
  track(event: AnalyticsEvent, params: AnalyticsParams): void {
    if (this.verbose) console.info('[analytics]', event, params);
  }
}

/** Keeps the last N events in memory (debug overlay + tests). */
export class BufferAnalyticsProvider implements AnalyticsProvider {
  events: { event: AnalyticsEvent; params: AnalyticsParams; t: number }[] = [];
  constructor(private max = 200) {}
  track(event: AnalyticsEvent, params: AnalyticsParams): void {
    this.events.push({ event, params, t: Date.now() });
    if (this.events.length > this.max) this.events.shift();
  }
}

export class AnalyticsManager {
  private providers: AnalyticsProvider[] = [];
  private sessionStart = Date.now();
  enabled = true;

  addProvider(p: AnalyticsProvider): void {
    this.providers.push(p);
  }

  track(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
    if (!this.enabled) return;
    for (const p of this.providers) {
      try {
        p.track(event, params);
      } catch {
        /* never let analytics crash the game */
      }
    }
  }

  startSession(params: AnalyticsParams = {}): void {
    this.sessionStart = Date.now();
    this.track('session_started', params);
  }

  endSession(params: AnalyticsParams = {}): void {
    this.track('session_ended', { ...params, duration_sec: Math.round((Date.now() - this.sessionStart) / 1000) });
    for (const p of this.providers) p.flush?.();
  }
}
