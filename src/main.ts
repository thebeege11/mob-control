import './style.css';
import { BotController } from './game/BotController';
import { GameManager } from './game/GameManager';
import { NativeHaptics, PreferencesStorage, installNativeHooks, isNative } from './platform/native';
import { SAVE_KEY } from './systems/SaveManager';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const toasts = document.getElementById('toasts') as HTMLElement;

// Block browser gestures (pull-to-refresh, pinch zoom, double-tap zoom).
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

async function start(): Promise<void> {
  const native = isNative();
  const storage = native ? await PreferencesStorage.create([SAVE_KEY]) : undefined;
  const game = new GameManager(canvas, ui, toasts, { storage, haptics: native ? new NativeHaptics() : undefined });
  // Debug params (dev builds, or ?debug): ?autoplay[=skill] lets the bot play, ?level=N jumps to a level.
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV || params.has('debug')) {
    if (params.has('autoplay')) game.autoplay = new BotController(Number(params.get('autoplay')) || 0.9, 1);
    const lvl = Number(params.get('level'));
    if (lvl > 0) {
      game.save.data.level = lvl;
      game.save.data.highestLevel = Math.max(game.save.data.highestLevel, lvl);
    }
  }
  installNativeHooks({
    onBack: () => game.handleBack(),
    onPause: () => game.onAppPause(),
    onResume: () => game.onAppResume(),
  });
  game.boot();

  // Exposed for debugging / automated smoke tests.
  (window as unknown as { __game: GameManager }).__game = game;
}

void start();
