/**
 * Allocation-free event queue from the simulation to presentation layers
 * (renderer juice, audio, UI, analytics). Events are pooled objects that are
 * valid until the next `clear()`.
 */
export const enum Ev {
  UnitSpawn,
  UnitDie,
  EnemyHit,
  EnemyDie,
  GroupCleared,
  CrateBreak,
  Gate,
  GateBad,
  Coin,
  Gem,
  Combo,
  ComboBreak,
  Perfect,
  NearMiss,
  SurgeReady,
  SurgeStart,
  SurgeEnd,
  SurgeOrb,
  Champion,
  FinaleHit,
  FinaleDestroyed,
  BossStompWarn,
  BossStomp,
  BossSpawn,
  Hint,
  ArenaEnter,
  Win,
  Fail,
  Boost,
}

export interface SimEvent {
  type: Ev;
  x: number;
  y: number;
  a: number;
  b: number;
  s: string;
}

export class EventQueue {
  private pool: SimEvent[] = [];
  count = 0;

  constructor(capacity = 1024) {
    for (let i = 0; i < capacity; i++) this.pool.push({ type: Ev.Coin, x: 0, y: 0, a: 0, b: 0, s: '' });
  }

  push(type: Ev, x = 0, y = 0, a = 0, b = 0, s = ''): void {
    if (this.count >= this.pool.length) return; // drop silently when saturated
    const e = this.pool[this.count++];
    e.type = type;
    e.x = x;
    e.y = y;
    e.a = a;
    e.b = b;
    e.s = s;
  }

  get(i: number): SimEvent {
    return this.pool[i];
  }

  clear(): void {
    this.count = 0;
  }
}
