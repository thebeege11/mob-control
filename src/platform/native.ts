/**
 * Native (Capacitor) integrations. Everything degrades gracefully to web
 * implementations, so the same bundle runs in a browser, on iOS and Android.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import type { HapticsProvider } from './haptics';
import { LocalStorageBackend, type KeyValueStorage } from './storage';

export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Durable storage on device (iOS may evict WebView localStorage under
 * pressure). Reads are served from a cache pre-loaded at boot; writes go
 * through to native Preferences asynchronously and to localStorage as backup.
 */
export class PreferencesStorage implements KeyValueStorage {
  private cache = new Map<string, string>();
  private fallback = new LocalStorageBackend();

  static async create(keys: string[]): Promise<PreferencesStorage> {
    const s = new PreferencesStorage();
    for (const key of keys) {
      const { value } = await Preferences.get({ key });
      const v = value ?? s.fallback.get(key);
      if (v !== null) s.cache.set(key, v);
    }
    return s;
  }

  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
    this.fallback.set(key, value);
    void Preferences.set({ key, value });
  }

  remove(key: string): void {
    this.cache.delete(key);
    this.fallback.remove(key);
    void Preferences.remove({ key });
  }
}

export class NativeHaptics implements HapticsProvider {
  enabled = true;
  impact(strength: 'light' | 'medium' | 'heavy'): void {
    if (!this.enabled) return;
    const style = strength === 'light' ? ImpactStyle.Light : strength === 'medium' ? ImpactStyle.Medium : ImpactStyle.Heavy;
    void Haptics.impact({ style }).catch(() => {});
  }
}

export interface NativeHooks {
  onBack: () => boolean; // return true if handled
  onPause: () => void;
  onResume: () => void;
}

export function installNativeHooks(h: NativeHooks): void {
  if (!isNative()) return;
  void App.addListener('backButton', () => {
    if (!h.onBack()) void App.minimizeApp();
  });
  void App.addListener('appStateChange', ({ isActive }) => (isActive ? h.onResume() : h.onPause()));
}
