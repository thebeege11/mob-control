/**
 * UIManager — fast DOM overlays for menus. Gameplay HUD is drawn on canvas.
 * Screens are rendered from plain data; all interaction goes through one
 * delegated click handler (`data-action` attributes) → GameManager.
 */
import { UPGRADE_IDS, type UpgradeId } from '../config/tuning';
import { formatNum } from '../core/math';
import { UPGRADE_INFO } from '../systems/UpgradeManager';
import { SKINS, type Skin } from '../systems/SkinManager';
import { PRODUCTS } from '../systems/PurchaseManager';
import { ACHIEVEMENTS, DAILY_MOD_TEXT, dailyRewardFor } from '../systems/RetentionManager';
import type { DailyModifier } from '../gen/types';
import type { Settings, SaveData } from '../systems/SaveManager';

export type ActionHandler = (action: string, arg: string | undefined, el: HTMLElement) => void;

export interface UpgradeCard {
  id: UpgradeId;
  level: number;
  current: number;
  next: number;
  cost: number;
  affordable: boolean;
}

export interface HomeData {
  level: number;
  isBoss: boolean;
  bestScore: number;
  coins: number;
  gems: number;
  upgrades: UpgradeCard[];
  dailyAvailable: boolean;
  freeCoinsReady: boolean;
  firstTime: boolean;
  themeName: string;
}

export interface ResultData {
  won: boolean;
  level: number;
  daily: boolean;
  score: number;
  best: number;
  newBest: boolean;
  coins: number;
  gems: number;
  breakdown: { label: string; value: number }[];
  progress: number;
  bestProgress: number;
  causeText: string;
  survivors: number;
  kills: number;
  bestCombo: number;
  canRevive: boolean;
  reviveGemCost: number;
  canAffordGemRevive: boolean;
  canDouble: boolean;
  chestPips: number;
  chestEvery: number;
  chestReady: boolean;
  upgrades: UpgradeCard[];
  coinsTotal: number;
  gemsTotal: number;
  finaleLeftPct: number;
  isBoss: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class UIManager {
  readonly root: HTMLElement;
  private toasts: HTMLElement;
  private handler: ActionHandler = () => {};
  current = '';
  private countUpRaf = 0;

  constructor(root: HTMLElement, toasts: HTMLElement) {
    this.root = root;
    this.toasts = toasts;
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!el || el.hasAttribute('disabled')) return;
      e.stopPropagation();
      this.handler(el.dataset.action!, el.dataset.arg, el);
    });
  }

  onAction(h: ActionHandler): void {
    this.handler = h;
  }

  hide(): void {
    this.current = '';
    this.root.innerHTML = '';
    this.root.className = '';
  }

  private set(screen: string, html: string, cls = ''): void {
    this.current = screen;
    this.root.className = `screen-${screen} ${cls}`;
    this.root.innerHTML = html;
  }

  // ------------------------------------------------------------ shared bits

  private topBar(coins: number, gems: number, extra = ''): string {
    return `<div class="topbar">
      <div class="pill coin-pill"><span class="ico coin">$</span><b id="coinCount">${formatNum(coins)}</b></div>
      <div class="pill gem-pill"><span class="ico gem">◆</span><b id="gemCount">${formatNum(gems)}</b></div>
      <div class="spacer"></div>${extra}
    </div>`;
  }

  updateCurrency(coins: number, gems: number): void {
    const c = this.root.querySelector('#coinCount');
    const g = this.root.querySelector('#gemCount');
    if (c) c.textContent = formatNum(coins);
    if (g) g.textContent = formatNum(gems);
  }

  private upgradeRow(cards: UpgradeCard[], compact = false): string {
    return `<div class="upgrades ${compact ? 'compact' : ''}">${cards
      .map((c) => {
        const info = UPGRADE_INFO[c.id];
        return `<button class="upg ${c.affordable ? 'can' : ''}" data-action="upgrade" data-arg="${c.id}" ${c.affordable ? '' : 'disabled'}>
          <div class="upg-ico">${info.icon}</div>
          <div class="upg-name">${info.name} <small>${c.level}</small></div>
          <div class="upg-lvl">LV ${c.level}</div>
          <div class="upg-val">${esc(info.describe(c.current))}<span class="arrow">→</span><em>${esc(info.describe(c.next))}</em></div>
          <div class="upg-cost"><span class="ico coin">$</span>${formatNum(c.cost)}</div>
        </button>`;
      })
      .join('')}</div>`;
  }

  // ------------------------------------------------------------ HOME

  showHome(d: HomeData): void {
    this.set(
      'home',
      `${this.topBar(d.coins, d.gems, `<button class="icon-btn" data-action="settings" aria-label="Settings">⚙</button>`)}
      <div class="logo"><span class="l1">SWARM</span><span class="l2">SURGE</span></div>
      <div class="home-center">
        <div class="lvl-badge ${d.isBoss ? 'boss' : ''}">${d.isBoss ? '☠ BOSS · ' : ''}LEVEL ${d.level}</div>
        ${d.bestScore > 0 ? `<div class="best">BEST ${formatNum(d.bestScore)}</div>` : ''}
        <div class="tap-to-play">${d.firstTime ? 'DRAG TO STEER' : 'TAP TO PLAY'}</div>
        <div class="hand"><div class="finger"></div></div>
      </div>
      <div class="home-bottom">
        ${this.upgradeRow(d.upgrades)}
        <div class="nav">
          <button class="nav-btn" data-action="skins"><span>🎨</span>SKINS</button>
          <button class="nav-btn" data-action="daily"><span>📅</span>DAILY${d.dailyAvailable ? '<i class="dot"></i>' : ''}</button>
          <button class="nav-btn" data-action="trophies"><span>🏆</span>TROPHIES</button>
          <button class="nav-btn" data-action="shop"><span>🛒</span>SHOP</button>
          <button class="nav-btn ad" data-action="freecoins" ${d.freeCoinsReady ? '' : 'disabled'}><span>▶</span>FREE $</button>
        </div>
      </div>`,
      'passthrough',
    );
  }

  refreshUpgrades(cards: UpgradeCard[]): void {
    const row = this.root.querySelector('.upgrades');
    if (!row) return;
    const compact = row.classList.contains('compact');
    row.outerHTML = this.upgradeRow(cards, compact);
  }

  // ------------------------------------------------------------ RESULTS

  showResult(d: ResultData): void {
    const pct = Math.round(d.progress * 100);
    const bestPct = Math.round(d.bestProgress * 100);
    const coinsLine = `<div class="reward-line"><span class="ico coin">$</span><b class="countup" data-to="${d.coins}">0</b>${
      d.gems > 0 ? `<span class="gem-reward"><span class="ico gem">◆</span>+${d.gems}</span>` : ''
    }</div>`;
    if (d.won) {
      const pips = Array.from({ length: d.chestEvery }, (_, i) => `<i class="${i < d.chestPips ? 'on' : ''}"></i>`).join('');
      this.set(
        'result',
        `${this.topBar(d.coinsTotal, d.gemsTotal, `<button class="icon-btn" data-action="home" aria-label="Home">⌂</button>`)}
        <div class="result win">
          <div class="result-title">${d.daily ? 'DAILY CLEAR!' : d.isBoss ? 'BOSS DOWN!' : `LEVEL ${d.level} CLEAR!`}</div>
          <div class="score-big">${formatNum(d.score)}${d.newBest ? '<span class="newbest">NEW BEST!</span>' : ''}</div>
          <div class="sub">BEST ${formatNum(d.best)} · ${formatNum(d.survivors)} survivors · combo ${d.bestCombo}</div>
          ${coinsLine}
          <div class="breakdown">${d.breakdown.map((b) => `<span>${esc(b.label)} <b>+${formatNum(b.value)}</b></span>`).join('')}</div>
          <div class="chest-row">${d.chestReady ? `<button class="btn chest-btn" data-action="chest">🎁 OPEN CHEST!</button>` : `<div class="chest-pips"><span>🎁</span>${pips}</div>`}</div>
          <div class="btn-row">
            ${d.canDouble ? `<button class="btn ad-btn" data-action="double">▶ x2 COINS</button>` : ''}
          </div>
          ${d.daily ? '' : this.upgradeRow(d.upgrades, true)}
          <button class="btn big-btn next-btn" data-action="${d.daily ? 'home' : 'next'}">${d.daily ? 'HOME' : 'NEXT ▶'}</button>
        </div>`,
      );
    } else {
      this.set(
        'result',
        `${this.topBar(d.coinsTotal, d.gemsTotal, `<button class="icon-btn" data-action="home" aria-label="Home">⌂</button>`)}
        <div class="result fail">
          <div class="result-title lost">YOU LOST</div>
          <div class="cause">${esc(d.causeText)}</div>
          <div class="progress-wrap">
            <div class="progress"><div class="fill" style="width:${pct}%"></div>${bestPct > 0 ? `<div class="best-mark" style="left:${bestPct}%"></div>` : ''}</div>
            <div class="progress-label">${pct}%${pct >= 85 ? ' — SO CLOSE!' : ''}</div>
          </div>
          <div class="stat-grid">
            <div><small>RESULT</small><b>${formatNum(d.score)}</b></div>
            <div><small>BEST</small><b>${formatNum(d.best)}</b></div>
            <div><small>REWARD</small><b class="coin-text">+<span class="countup" data-to="${d.coins}">0</span></b></div>
          </div>
          ${
            d.canRevive
              ? `<div class="btn-row">
            <button class="btn ad-btn" data-action="revive-ad">▶ REVIVE</button>
            <button class="btn gem-btn" data-action="revive-gems" ${d.canAffordGemRevive ? '' : 'disabled'}>◆${d.reviveGemCost} REVIVE</button>
          </div>`
              : ''
          }
          ${d.daily ? '' : `<div class="upg-hint">${d.upgrades.some((u) => u.affordable) ? 'Upgrade to go further!' : ''}</div>${this.upgradeRow(d.upgrades, true)}`}
          <button class="btn big-btn retry-btn" data-action="retry">TAP TO RETRY</button>
        </div>`,
      );
    }
    this.countUp();
  }

  private countUp(): void {
    cancelAnimationFrame(this.countUpRaf);
    const els = Array.from(this.root.querySelectorAll<HTMLElement>('.countup'));
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      for (const el of els) el.textContent = formatNum(Math.round(Number(el.dataset.to) * e));
      if (k < 1) this.countUpRaf = requestAnimationFrame(tick);
    };
    this.countUpRaf = requestAnimationFrame(tick);
  }

  bumpCoins(total: number, added: number): void {
    const el = this.root.querySelector<HTMLElement>('.countup');
    if (el) {
      el.dataset.to = String(Number(el.dataset.to) + added);
      this.countUp();
    }
    const c = this.root.querySelector('#coinCount');
    if (c) c.textContent = formatNum(total);
  }

  // ------------------------------------------------------------ MODALS

  showPause(s: Settings): void {
    this.set(
      'modal',
      `<div class="modal">
        <h2>PAUSED</h2>
        <button class="btn big-btn" data-action="resume">RESUME</button>
        <div class="btn-row">
          <button class="btn" data-action="restart">RESTART</button>
          <button class="btn" data-action="home">HOME</button>
        </div>
        ${this.toggles(s)}
      </div>`,
    );
  }

  private toggles(s: Settings): string {
    const t = (k: keyof Settings, label: string) =>
      `<button class="toggle ${s[k] ? 'on' : ''}" data-action="toggle" data-arg="${k}"><span>${label}</span><i></i></button>`;
    return `<div class="toggles">${t('sound', 'Sound')}${t('music', 'Music')}${t('haptics', 'Vibration')}${t('reduceShake', 'Reduce shake')}${t('leftHanded', 'Left-handed')}</div>`;
  }

  showSettings(s: Settings, adsRemoved: boolean): void {
    this.set(
      'modal',
      `<div class="modal">
        <h2>SETTINGS</h2>
        ${this.toggles(s)}
        <div class="btn-row">
          ${adsRemoved ? '' : `<button class="btn" data-action="buy" data-arg="remove_ads">Remove Ads</button>`}
          <button class="btn" data-action="restore">Restore</button>
        </div>
        <button class="btn danger" data-action="reset">Reset progress</button>
        <p class="fine">Swarm Surge · offline, no account needed.<br/>All art & sound generated in-game.</p>
        <button class="btn big-btn" data-action="close">CLOSE</button>
      </div>`,
    );
  }

  confirm(text: string, action: string): void {
    this.set(
      'modal',
      `<div class="modal"><h2>SURE?</h2><p>${esc(text)}</p>
      <div class="btn-row"><button class="btn danger" data-action="${action}">YES</button><button class="btn" data-action="close">NO</button></div></div>`,
    );
  }

  showSkins(owned: string[], equipped: string, gems: number, coins: number): void {
    const how = (s: Skin): string => {
      switch (s.unlock.type) {
        case 'default':
          return '';
        case 'gems':
          return `◆${s.unlock.cost}`;
        case 'milestone':
          return `Reach LV ${s.unlock.level}`;
        case 'chest':
          return 'From chests';
        case 'iap':
          return 'Shop';
        case 'achievement':
          return 'Trophy reward';
      }
    };
    this.set(
      'modal',
      `${this.topBar(coins, gems)}<div class="modal wide">
        <h2>SKINS</h2>
        <div class="skin-grid">${SKINS.map((s) => {
          const own = owned.includes(s.id);
          const eq = s.id === equipped;
          const canBuy = !own && s.unlock.type === 'gems' && gems >= s.unlock.cost;
          const action = eq ? '' : own ? `data-action="equip" data-arg="${s.id}"` : s.unlock.type === 'gems' ? `data-action="buyskin" data-arg="${s.id}"` : '';
          return `<button class="skin ${own ? 'owned' : 'locked'} ${eq ? 'equipped' : ''} r-${s.rarity}" ${action} ${!own && !canBuy ? 'disabled' : ''}>
            <div class="blob ${s.shape}" style="--c:${s.body};--d:${s.shade}"></div>
            <div class="skin-name">${s.name}</div>
            <div class="skin-sub">${eq ? 'EQUIPPED' : own ? 'EQUIP' : how(s)}</div>
          </button>`;
        }).join('')}</div>
        <button class="btn big-btn" data-action="close">BACK</button>
      </div>`,
    );
  }

  showDaily(d: { available: boolean; streakDay: number; highestLevel: number; challenge: { level: number; modifier: DailyModifier; done: boolean } }): void {
    const days = Array.from({ length: 7 }, (_, i) => {
      const r = dailyRewardFor(i, d.highestLevel);
      const state = i < d.streakDay ? 'claimed' : i === d.streakDay && d.available ? 'today' : '';
      return `<div class="day ${state}"><small>DAY ${i + 1}</small>${r.chest ? '🎁' : ''}${r.coins ? `<b>$${formatNum(r.coins)}</b>` : ''}${r.gems ? `<b class="g">◆${r.gems}</b>` : ''}</div>`;
    }).join('');
    this.set(
      'modal',
      `<div class="modal wide">
        <h2>DAILY</h2>
        <div class="days">${days}</div>
        ${
          d.available
            ? `<div class="btn-row"><button class="btn big-btn" data-action="claim-daily">CLAIM</button><button class="btn ad-btn" data-action="claim-daily-2x">▶ x2</button></div>`
            : `<p class="fine">Come back tomorrow for the next reward!</p>`
        }
        <div class="challenge">
          <h3>DAILY CHALLENGE</h3>
          <p>Level ${d.challenge.level} · ${esc(DAILY_MOD_TEXT[d.challenge.modifier])}</p>
          <p class="fine">Reward: ◆10 + coins</p>
          <button class="btn big-btn" data-action="play-daily" ${d.challenge.done ? 'disabled' : ''}>${d.challenge.done ? 'DONE TODAY ✓' : 'PLAY'}</button>
        </div>
        <button class="btn" data-action="close">BACK</button>
      </div>`,
    );
  }

  showTrophies(save: SaveData): void {
    const s = save.stats;
    this.set(
      'modal',
      `<div class="modal wide">
        <h2>TROPHIES</h2>
        <div class="ach-list">${ACHIEVEMENTS.map((a) => {
          const got = save.achievements.includes(a.id);
          return `<div class="ach ${got ? 'got' : ''}"><div class="ach-ico">${got ? '🏆' : '🔒'}</div><div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div><div class="ach-r">◆${a.gems}</div></div>`;
        }).join('')}</div>
        <div class="stats">
          <span>Highest level <b>${save.highestLevel}</b></span>
          <span>Best score <b>${formatNum(save.bestScore)}</b></span>
          <span>Wins <b>${s.wins}</b></span>
          <span>Runs <b>${s.runs}</b></span>
          <span>Enemies smashed <b>${formatNum(s.kills)}</b></span>
          <span>Bosses <b>${s.bossesKilled}</b></span>
          <span>Biggest swarm <b>${formatNum(s.maxSoldiers)}</b></span>
          <span>Best combo <b>${s.bestCombo}</b></span>
          <span>Play time <b>${Math.round(s.playTimeSec / 60)}m</b></span>
        </div>
        <button class="btn big-btn" data-action="close">BACK</button>
      </div>`,
    );
  }

  showShop(owned: (id: string) => boolean, gems: number, coins: number): void {
    this.set(
      'modal',
      `${this.topBar(coins, gems)}<div class="modal wide">
        <h2>SHOP</h2>
        <div class="shop-list">${PRODUCTS.map(
          (p) => `<div class="product"><div><b>${esc(p.title)}</b><small>${esc(p.description)}</small></div>
          <button class="btn" data-action="buy" data-arg="${p.id}" ${p.kind === 'non_consumable' && owned(p.id) ? 'disabled' : ''}>${
            p.kind === 'non_consumable' && owned(p.id) ? 'OWNED' : p.price
          }</button></div>`,
        ).join('')}</div>
        <p class="fine">Everything in Swarm Surge can be earned by playing. Purchases are optional.</p>
        <div class="btn-row"><button class="btn" data-action="restore">Restore purchases</button><button class="btn big-btn" data-action="close">BACK</button></div>
      </div>`,
    );
  }

  showChest(r: { coins: number; gems: number; skin?: Skin }): void {
    this.set(
      'modal',
      `<div class="modal chest-modal">
        <div class="chest-anim">🎁</div>
        <h2>CHEST!</h2>
        <div class="reward-line big"><span class="ico coin">$</span><b>+${formatNum(r.coins)}</b></div>
        <div class="reward-line big"><span class="ico gem">◆</span><b>+${r.gems}</b></div>
        ${r.skin ? `<div class="skin-reveal"><div class="blob ${r.skin.shape}" style="--c:${r.skin.body};--d:${r.skin.shade}"></div><b>NEW SKIN: ${esc(r.skin.name)}!</b></div>` : ''}
        <button class="btn big-btn" data-action="chest-done">AWESOME!</button>
      </div>`,
    );
  }

  /** Toasts are queued and shown one at a time so they never bury a screen. */
  toast(text: string, sub = ''): void {
    this.toastQueue.push({ text, sub });
    if (!this.toastBusy) this.nextToast();
  }

  private toastQueue: { text: string; sub: string }[] = [];
  private toastBusy = false;

  private nextToast(): void {
    const t = this.toastQueue.shift();
    if (!t) {
      this.toastBusy = false;
      return;
    }
    this.toastBusy = true;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<b>${esc(t.text)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}`;
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1500);
    setTimeout(() => {
      el.remove();
      this.nextToast();
    }, 1850);
  }
}

export function upgradeIds(): UpgradeId[] {
  return UPGRADE_IDS;
}
