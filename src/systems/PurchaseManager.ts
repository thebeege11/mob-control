import type { AnalyticsManager } from './AnalyticsManager';
import type { CurrencyManager } from './CurrencyManager';
import type { SaveManager } from './SaveManager';

export interface Product {
  id: string;
  title: string;
  description: string;
  price: string;
  kind: 'non_consumable' | 'consumable';
  gems?: number;
  skin?: string;
}

export const PRODUCTS: Product[] = [
  { id: 'remove_ads', title: 'Remove Ads', description: 'No more interstitial ads. Rewarded ads stay optional.', price: '$2.99', kind: 'non_consumable' },
  { id: 'gems_small', title: 'Pouch of Gems', description: '60 gems', price: '$0.99', kind: 'consumable', gems: 60 },
  { id: 'gems_large', title: 'Chest of Gems', description: '400 gems', price: '$4.99', kind: 'consumable', gems: 400 },
  { id: 'skin_pack_neon', title: 'Neon Skin', description: 'Exclusive glowing swarm skin', price: '$1.99', kind: 'non_consumable', skin: 'neon' },
];

/** Implement with StoreKit 2 / Google Play Billing (e.g. via RevenueCat / cordova-plugin-purchase). */
export interface StoreProvider {
  purchase(productId: string): Promise<boolean>;
  restore(): Promise<string[]>;
}

/** Mock store: every purchase succeeds instantly. Replace before release. */
export class MockStoreProvider implements StoreProvider {
  private owned = new Set<string>();
  async purchase(productId: string): Promise<boolean> {
    this.owned.add(productId);
    return true;
  }
  async restore(): Promise<string[]> {
    return [...this.owned];
  }
}

export class PurchaseManager {
  constructor(
    private store: StoreProvider,
    private save: SaveManager,
    private currency: CurrencyManager,
    private analytics: AnalyticsManager,
  ) {}

  owns(id: string): boolean {
    if (id === 'remove_ads') return this.save.data.removeAds;
    const p = PRODUCTS.find((x) => x.id === id);
    return !!p?.skin && this.save.data.skins.owned.includes(p.skin);
  }

  async buy(id: string): Promise<boolean> {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return false;
    const ok = await this.store.purchase(id);
    if (!ok) return false;
    this.grant(p);
    this.analytics.track('purchase_completed', { product: id, price: p.price });
    return true;
  }

  async restore(): Promise<number> {
    const ids = await this.store.restore();
    let n = 0;
    for (const id of ids) {
      const p = PRODUCTS.find((x) => x.id === id);
      if (p && p.kind === 'non_consumable') {
        this.grant(p);
        n++;
      }
    }
    return n;
  }

  private grant(p: Product): void {
    if (p.id === 'remove_ads') this.save.data.removeAds = true;
    if (p.gems) this.currency.earn('gems', p.gems);
    if (p.skin && !this.save.data.skins.owned.includes(p.skin)) this.save.data.skins.owned.push(p.skin);
    this.save.save();
  }
}
