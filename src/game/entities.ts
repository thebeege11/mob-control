import type { BossType, EnemyKind, GateKind, GateSpec, HazardSpec, PickupKind } from '../gen/types';

export class Unit {
  x = 0;
  y = 0;
  prevY = 0;
  vx = 0;
  vy = 0;
  /** HP of the current soldier in this blip. */
  hp = 0;
  /** Soldiers represented by this blip (grows once the physical cap is hit). */
  weight = 1;
  champion = false;
  alive = false;
  /** Time since spawn (for pop-in squash & stretch). */
  age = 0;
  /** Set while touching something that damages it (for flash). */
  hurt = 0;
  radius = 5;
}

export class Enemy {
  kind: EnemyKind = 'grunt';
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r = 7;
  hp = 1;
  maxHp = 1;
  atk = 0;
  group = 0;
  alive = false;
  active = false;
  aggro = false;
  flash = 0;
  age = 0;
  /** Spawned by a boss (not part of plan). */
  spawned = false;
}

export class Gate {
  spec!: GateSpec;
  y = 0;
  x0 = 0;
  x1 = 0;
  kind: GateKind = 'add';
  value = 0;
  /** Remaining absorb pool for 'sub' gates / add pool for 'add' gates. */
  pool = 0;
  triggered = false;
  acc = 0;
  /** Soldiers gained / lost through this gate (for feedback). */
  delta = 0;
  flash = 0;
  row = 0;
  passed = false;
}

export class Hazard {
  spec!: HazardSpec;
  y0 = 0;
  y1 = 0;
  segment = 0;
  flash = 0;
}

export class Pickup {
  kind: PickupKind = 'coin';
  x = 0;
  y = 0;
  taken = false;
  age = 0;
}

export interface Finale {
  kind: 'fortress' | 'boss';
  bossType?: BossType;
  x: number;
  y: number;
  width: number;
  hp: number;
  maxHp: number;
  atk: number;
  destroyed: boolean;
  flash: number;
  /** Boss internal timers. */
  timer: number;
  stompX: number;
  stompWarn: number;
  stompR: number;
  shake: number;
}
