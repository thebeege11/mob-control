import './style.css';
import { BotController } from './game/BotController';
import { GameManager } from './game/GameManager';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const toasts = document.getElementById('toasts') as HTMLElement;

// Block browser gestures (pull-to-refresh, pinch zoom, double-tap zoom).
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

const game = new GameManager(canvas, ui, toasts);
// Debug params (development only): ?autoplay[=skill] lets the bot play, ?level=N jumps to a level.
const params = new URLSearchParams(location.search);
if (import.meta.env.DEV || params.has('debug')) {
  if (params.has('autoplay')) game.autoplay = new BotController(Number(params.get('autoplay')) || 0.9, 1);
  const lvl = Number(params.get('level'));
  if (lvl > 0) {
    game.save.data.level = lvl;
    game.save.data.highestLevel = Math.max(game.save.data.highestLevel, lvl);
  }
}
game.boot();

// Exposed for debugging / automated smoke tests.
(window as unknown as { __game: GameManager }).__game = game;
