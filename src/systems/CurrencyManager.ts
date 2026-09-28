import type { SaveManager } from './SaveManager';

export type Currency = 'coins' | 'gems';
type Listener = (c: Currency, amount: number, delta: number) => void;

/** Coins (common) and gems (premium-ish, earned in play). */
export class CurrencyManager {
  private listeners: Listener[] = [];

  constructor(private save: SaveManager) {}

  get coins(): number {
    return this.save.data.coins;
  }

  get gems(): number {
    return this.save.data.gems;
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  earn(c: Currency, amount: number): void {
    const n = Math.max(0, Math.floor(amount));
    if (n === 0) return;
    this.save.data[c] += n;
    if (c === 'coins') this.save.data.stats.coinsEarned += n;
    else this.save.data.stats.gemsEarned += n;
    this.save.saveSoon();
    for (const l of this.listeners) l(c, this.save.data[c], n);
  }

  canAfford(c: Currency, amount: number): boolean {
    return this.save.data[c] >= amount;
  }

  spend(c: Currency, amount: number): boolean {
    if (!this.canAfford(c, amount)) return false;
    this.save.data[c] -= amount;
    this.save.saveSoon();
    for (const l of this.listeners) l(c, this.save.data[c], -amount);
    return true;
  }
}
