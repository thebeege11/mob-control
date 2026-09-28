/**
 * Juice — converts simulation events into audiovisual feedback:
 * particles, floating numbers, screen shake, flashes, zoom punches,
 * slow motion, sounds and haptics. Keeps the Simulation pure.
 */
import { TUNING } from '../config/tuning';
import { formatNum } from '../core/math';
import type { HapticsProvider } from '../platform/haptics';
import { PKind, type Particles } from '../render/Particles';
import type { FloatingText } from '../render/FloatingText';
import { COLORS } from '../render/theme';
import type { AudioManager } from '../systems/AudioManager';
import type { Skin } from '../systems/SkinManager';
import { Ev, type SimEvent } from './SimEvents';
import type { Simulation } from './Simulation';

export class Juice {
  shake = 0;
  flash = 0;
  flashColor = '#fff';
  zoomPunch = 0;
  slowMo = 0;
  countPop = 0;
  hint = '';
  hintTime = 0;
  reduceShake = false;
  surgeTint = 0;
  private hapticCd = 0;
  private deathSfx = 0;
  skin!: Skin;

  constructor(
    private particles: Particles,
    private texts: FloatingText,
    private audio: AudioManager,
    private haptics: HapticsProvider,
    private onHint: (key: string) => void,
  ) {}

  showHint(text: string): void {
    this.hint = text;
    this.hintTime = 3.2;
  }

  addShake(v: number): void {
    this.shake = Math.min(1, this.shake + v * (this.reduceShake ? 0.35 : 1));
  }

  haptic(s: 'light' | 'medium' | 'heavy'): void {
    if (this.hapticCd > 0 && s === 'light') return;
    this.hapticCd = 0.08;
    this.haptics.impact(s);
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * TUNING.juice.shakeDecay);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.zoomPunch *= Math.pow(0.02, dt);
    this.slowMo = Math.max(0, this.slowMo - dt);
    this.countPop = Math.max(0, this.countPop - dt * 4);
    this.hintTime = Math.max(0, this.hintTime - dt);
    this.hapticCd -= dt;
    this.deathSfx = 0;
  }

  process(sim: Simulation): void {
    const q = sim.events;
    for (let i = 0; i < q.count; i++) this.handle(sim, q.get(i));
  }

  private handle(sim: Simulation, e: SimEvent): void {
    const P = this.particles;
    const T = this.texts;
    const A = this.audio;
    const body = this.skin?.body ?? '#38d8ff';
    switch (e.type) {
      case Ev.UnitSpawn:
        P.burst(e.x, e.y, 10, Math.min(14, 3 + e.a), 110, COLORS.goodLight, PKind.Spark, 3, 0.4, 60);
        A.play('launch', 1 + Math.min(1, e.a / 60));
        this.countPop = 1;
        break;
      case Ev.UnitDie: {
        const col = e.b === 2 ? COLORS.bad : body;
        if (e.b === 0) {
          P.burst(e.x, e.y, 6, 7, 150, col, PKind.Dot, 3, 0.45, 180);
          P.burst(e.x, e.y, 6, 3, 90, '#ffffff', PKind.Spark, 2.5, 0.25, 40);
          this.haptic('light');
        } else {
          P.burst(e.x, e.y, 6, 4, 110, col, PKind.Dot, 2.5, 0.35, 140);
        }
        if (this.deathSfx < TUNING.juice.maxDeathSfxPerFrame) {
          this.deathSfx++;
          A.play('pop', 0.8 + Math.random() * 0.5, e.b === 1 ? 0.6 : 1);
        }
        this.countPop = Math.max(this.countPop, 0.4);
        break;
      }
      case Ev.EnemyHit:
        P.burst(e.x, e.y, 10, e.a ? 4 : 2, 90, COLORS.enemy, PKind.Spark, 2.5, 0.2, 60);
        A.play('hit', 1, 0.7);
        break;
      case Ev.EnemyDie:
        if (e.a === 1) {
          P.burst(e.x, e.y, 16, 30, 260, COLORS.brute, PKind.Chunk, 5, 0.8, 260);
          P.ring(e.x, e.y, 60, '#ffffff', 0.45);
          T.add('+' + TUNING.score.bruteKill * sim.score.multiplier, e.x, e.y, 30, '#ffd23f', 26);
          this.addShake(0.35);
          this.haptic('medium');
          A.play('destroy', 1, 0.6);
        } else {
          P.burst(e.x, e.y, 8, 9, 170, COLORS.enemy, PKind.Chunk, 3, 0.5, 200);
          A.play('enemyDie', 0.9 + Math.random() * 0.3);
        }
        break;
      case Ev.GroupCleared:
        T.add('CLEARED!', e.x, e.y, 40, '#7dffb0', 24, 0.9);
        break;
      case Ev.CrateBreak: {
        const gem = e.a === 2;
        P.burst(e.x, e.y, 14, 16, 200, gem ? '#7df0ff' : COLORS.crate, PKind.Chunk, 4, 0.7, 240);
        P.burst(e.x, e.y, 20, 8, 140, gem ? COLORS.gem : COLORS.coin, PKind.Dot, 3, 0.7, 260);
        T.add(gem ? '+1 ◆' : `+${TUNING.economy.crateCoins} $`, e.x, e.y, 34, gem ? COLORS.gem : COLORS.coin, 22);
        A.play('crate');
        this.addShake(0.12);
        break;
      }
      case Ev.Gate:
        if (e.b === 1) {
          T.add('+' + formatNum(e.a), e.x, e.y, 60, '#8fe3ff', Math.min(46, 26 + Math.log2(1 + e.a) * 2.5), 1.1);
          P.burst(e.x, e.y, 30, 16, 160, COLORS.goodLight, PKind.Confetti, 5, 0.9, 120);
          A.play('gate', 1 + Math.min(0.5, e.a / 200));
          this.zoomPunch = Math.min(0.06, 0.02 + e.a / 3000);
          this.haptic('light');
        }
        break;
      case Ev.GateBad:
        if (e.b === 1) {
          T.add('−' + formatNum(e.a), e.x, e.y, 60, '#ff8fa8', 30, 1.1);
          A.play('gateBad');
          this.addShake(0.2);
          this.flash = 0.18;
          this.flashColor = '#ff3b6b';
          this.haptic('medium');
        }
        break;
      case Ev.Coin:
        P.burst(e.x, e.y, 12, 4, 60, COLORS.coin, PKind.Spark, 2.5, 0.3, 80);
        A.play('coin');
        break;
      case Ev.Combo:
        T.add(`COMBO x${e.a}!`, this.texts ? sim.units.cx : 0, sim.units.cy + 140, 50, COMBO_TEXT[Math.min(COMBO_TEXT.length - 1, e.a - 2)], 30 + e.a * 2, 1.2);
        A.play('combo', e.a);
        this.flash = 0.12;
        this.flashColor = COMBO_TEXT[Math.min(COMBO_TEXT.length - 1, e.a - 2)];
        this.haptic('medium');
        break;
      case Ev.ComboBreak:
        if (e.b > 1) {
          T.add(`x${e.b} lost`, sim.units.cx, sim.units.cy + 100, 40, '#c9c3dd', 20, 0.9);
          A.play('comboBreak');
        }
        break;
      case Ev.Perfect:
        T.add('PERFECT!', e.x, e.y, 50, '#7dffb0', 30, 1);
        P.burst(e.x, e.y, 30, 12, 120, '#7dffb0', PKind.Spark, 3, 0.6, 90);
        A.play('perfect');
        break;
      case Ev.NearMiss:
        T.add('CLOSE CALL!', e.x, e.y + 30, 70, '#ffe14d', 24, 1);
        break;
      case Ev.SurgeReady:
        this.screenText('SURGE READY!', '#ffe14d', 26, 1.4);
        A.play('warn');
        this.haptic('medium');
        break;
      case Ev.SurgeStart:
        this.flash = 0.45;
        this.flashColor = '#ffe14d';
        this.zoomPunch = 0.08;
        this.addShake(0.3);
        P.burst(sim.units.cx, sim.units.cy, 20, 40, 300, COLORS.surge, PKind.Spark, 4, 0.7, 200);
        P.ring(sim.units.cx, sim.units.cy, 140, COLORS.surge, 0.5);
        A.play('surge');
        this.haptic('heavy');
        break;
      case Ev.SurgeOrb:
        T.add('⚡ SURGE CHARGED', e.x, e.y, 40, '#ffe14d', 22, 1);
        A.play('reward');
        break;
      case Ev.Champion:
        T.add('CHAMPION!', e.x, e.y, 50, '#ffd23f', 30, 1.2);
        P.burst(e.x, e.y, 20, 24, 200, '#ffd23f', PKind.Confetti, 5, 1, 200);
        A.play('reward');
        this.haptic('medium');
        break;
      case Ev.FinaleHit:
        T.add('-' + formatNum(Math.max(1, Math.round(e.a))), e.x, e.y - 10, 60, '#ffffff', 20, 0.6);
        P.burst(e.x, e.y - 5, 30, 5, 160, sim.finale.f.kind === 'boss' ? '#ff9f7a' : COLORS.fortress, PKind.Chunk, 3.5, 0.6, 220);
        A.play('fortressHit', 0.9 + Math.random() * 0.3);
        this.addShake(0.05);
        break;
      case Ev.FinaleDestroyed: {
        const f = sim.finale.f;
        for (let k = 0; k < 5; k++) P.burst(f.x + (k - 2) * 50, f.y + 20, 50, 30, 380, k % 2 ? COLORS.fortress : '#ffd23f', PKind.Chunk, 7, 1.2, 380);
        P.burst(f.x, f.y, 60, 80, 300, '#ffffff', PKind.Confetti, 6, 1.8, 300);
        P.ring(f.x, f.y, 260, '#ffffff', 0.7);
        this.addShake(1);
        this.flash = 0.7;
        this.flashColor = '#ffffff';
        this.slowMo = 0.9;
        this.zoomPunch = 0.12;
        A.play('destroy');
        A.play('victory');
        this.haptic('heavy');
        this.screenText(e.a ? 'BOSS DEFEATED!' : 'DESTROYED!', '#ffd23f', 40, 1.8);
        break;
      }
      case Ev.BossStompWarn:
        A.play('warn');
        break;
      case Ev.BossStomp:
        P.ring(e.x, e.y, e.a * 1.5, '#ff2d55', 0.5);
        P.burst(e.x, e.y, 0, 30, 260, '#b9a27c', PKind.Smoke, 8, 0.8, 30);
        this.addShake(0.6);
        A.play('stomp');
        this.haptic('heavy');
        break;
      case Ev.BossSpawn:
        P.burst(e.x, e.y, 20, 20, 200, '#b04dff', PKind.Spark, 4, 0.6, 100);
        break;
      case Ev.Hint: {
        const bar = e.s.indexOf('|');
        this.showHint(e.s.slice(bar + 1));
        this.onHint(e.s.slice(0, bar));
        break;
      }
      case Ev.ArenaEnter:
        if (e.a === 1) {
          this.screenText('BOSS FIGHT!', '#ff6b81', 42, 1.8);
          A.play('boss');
          this.addShake(0.4);
          this.slowMo = 0.35;
        } else {
          this.screenText('SMASH IT!', '#ffffff', 38, 1.4);
        }
        A.setIntensity(e.a === 1 ? 2 : 1);
        break;
      case Ev.Boost:
        T.add('SPEED!', sim.units.cx, sim.units.cy + 120, 40, '#ffd400', 30, 0.8);
        break;
      default:
        break;
    }
  }

  /** Centre for screen-space callouts (set by the GameManager on resize). */
  screenTextX = 0;
  screenTextY = 0;
  private screenText(text: string, color: string, size: number, life: number): void {
    this.texts.add(text, this.screenTextX, this.screenTextY, 0, color, size, life, true);
  }
}

const COMBO_TEXT = ['#5ee0ff', '#7dffb0', '#ffd23f', '#ff8a5c', '#f07dff'];
