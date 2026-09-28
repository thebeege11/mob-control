import type { SaveManager } from './SaveManager';

export interface Skin {
  id: string;
  name: string;
  body: string;
  shade: string;
  glow?: string;
  shape: 'round' | 'square' | 'star';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  /** How to get it. */
  unlock: { type: 'default' } | { type: 'gems'; cost: number } | { type: 'milestone'; level: number } | { type: 'chest' } | { type: 'iap' } | { type: 'achievement'; id: string };
}

export const SKINS: Skin[] = [
  { id: 'classic', name: 'Blip', body: '#38d8ff', shade: '#1b8fd6', shape: 'round', rarity: 'common', unlock: { type: 'default' } },
  { id: 'ember', name: 'Ember', body: '#ff9d3b', shade: '#d4561c', shape: 'round', rarity: 'common', unlock: { type: 'milestone', level: 10 } },
  { id: 'toxic', name: 'Toxic', body: '#9dff4d', shade: '#3fae2a', shape: 'round', rarity: 'rare', unlock: { type: 'milestone', level: 25 } },
  { id: 'candy', name: 'Candy', body: '#ff8ad8', shade: '#d9459e', shape: 'round', rarity: 'rare', unlock: { type: 'gems', cost: 80 } },
  { id: 'robo', name: 'Robo', body: '#cfd8e6', shade: '#7a8aa6', shape: 'square', rarity: 'epic', unlock: { type: 'gems', cost: 160 } },
  { id: 'royal', name: 'Royal', body: '#a57bff', shade: '#6236d1', shape: 'round', rarity: 'epic', unlock: { type: 'milestone', level: 50 } },
  { id: 'starry', name: 'Starry', body: '#fff06a', shade: '#e0a800', shape: 'star', rarity: 'epic', unlock: { type: 'achievement', id: 'combo_master' } },
  { id: 'void', name: 'Void', body: '#2b2346', shade: '#120d24', glow: '#ff4df0', shape: 'round', rarity: 'legendary', unlock: { type: 'milestone', level: 100 } },
  { id: 'golden', name: 'Golden', body: '#ffd34d', shade: '#c98a00', glow: '#fff3b0', shape: 'round', rarity: 'legendary', unlock: { type: 'chest' } },
  { id: 'neon', name: 'Neon', body: '#4dfff0', shade: '#00a3c4', glow: '#aefcff', shape: 'round', rarity: 'legendary', unlock: { type: 'iap' } },
];

export const SKIN_BY_ID: Record<string, Skin> = Object.fromEntries(SKINS.map((s) => [s.id, s]));

export class SkinManager {
  constructor(private save: SaveManager) {}

  get equipped(): Skin {
    return SKIN_BY_ID[this.save.data.skins.equipped] ?? SKINS[0];
  }

  owns(id: string): boolean {
    return this.save.data.skins.owned.includes(id);
  }

  unlock(id: string): boolean {
    if (this.owns(id) || !SKIN_BY_ID[id]) return false;
    this.save.data.skins.owned.push(id);
    this.save.saveSoon();
    return true;
  }

  equip(id: string): boolean {
    if (!this.owns(id)) return false;
    this.save.data.skins.equipped = id;
    this.save.saveSoon();
    return true;
  }

  /** A random not-yet-owned chest-eligible skin (rare/very rare reward). */
  randomLocked(roll: number): Skin | undefined {
    const pool = SKINS.filter((s) => !this.owns(s.id) && (s.unlock.type === 'chest' || s.unlock.type === 'gems'));
    if (pool.length === 0) return undefined;
    return pool[Math.floor(roll * pool.length) % pool.length];
  }
}
