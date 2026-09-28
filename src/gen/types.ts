/**
 * Level plan data types. A LevelPlan is pure data produced by the
 * ProceduralLevelGenerator and consumed by the LevelManager / Simulation.
 * It is JSON-serialisable so levels can be logged, replayed and tested.
 */

export type GateKind = 'mul' | 'add' | 'sub' | 'div';

export interface GateMotion {
  amp: number;
  period: number;
  phase: number;
}

export interface GateBlink {
  period: number;
  /** Fraction of the period spent as the alternate gate. */
  duty: number;
  kind2: GateKind;
  value2: number;
  phase: number;
}

export interface GateSpec {
  t: 'gate';
  y: number;
  x0: number;
  x1: number;
  kind: GateKind;
  value: number;
  motion?: GateMotion;
  blink?: GateBlink;
}

export type HazardKind = 'wall' | 'sweeper' | 'spinner' | 'saw' | 'crusher' | 'laser' | 'spikes' | 'divider';

export type HazardShape =
  | { shape: 'rect'; x0: number; x1: number; y0: number; y1: number }
  | { shape: 'circle'; x: number; y: number; r: number }
  | { shape: 'capsule'; cx: number; cy: number; len: number; thick: number; angle0: number; angVel: number };

export type HazardMotion =
  | { type: 'sine'; amp: number; period: number; phase: number }
  /** Crusher slam: 0 → 1 → 0 over the cycle, with a warning phase before closing. */
  | { type: 'slam'; amp: number; period: number; phase: number };

export interface HazardCycle {
  period: number;
  phase: number;
  /** Active (lethal) while cycle fraction is in [onFrom, onTo). */
  onFrom: number;
  onTo: number;
  /** Warning telegraph starts this many seconds before becoming active. */
  warn: number;
}

export interface HazardSpec {
  t: 'hazard';
  kind: HazardKind;
  shape: HazardShape;
  motion?: HazardMotion;
  cycle?: HazardCycle;
}

export type EnemyKind = 'grunt' | 'brute' | 'crate' | 'gemcrate';

export interface EnemySpec {
  t: 'enemy';
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  atk: number;
  r: number;
  /** Group id so formations can show a shared counter label. */
  group: number;
}

export type PickupKind = 'coin' | 'surge' | 'champion';

export interface PickupSpec {
  t: 'pickup';
  kind: PickupKind;
  x: number;
  y: number;
}

export interface PadSpec {
  t: 'pad';
  y0: number;
  y1: number;
  mult: number;
}

export interface HintSpec {
  t: 'hint';
  y: number;
  text: string;
  key: string;
}

export type EntitySpec = GateSpec | HazardSpec | EnemySpec | PickupSpec | PadSpec | HintSpec;

export type BossType = 'stomper' | 'sweeper' | 'spawner';

export interface FinaleSpec {
  kind: 'fortress' | 'boss';
  bossType?: BossType;
  y: number;
  hp: number;
  /** Damage dealt to a unit on contact (unit bounces if it survives). */
  atk: number;
  width: number;
}

export interface SpeedZone {
  y0: number;
  y1: number;
  mult: number;
}

export interface SegmentPlan {
  moduleId: string;
  category: ModuleCategory;
  y0: number;
  y1: number;
  rating: number;
  /** Hazard modules must be followed by breathing room. */
  needsRecoveryAfter: boolean;
  entities: EntitySpec[];
  /** Estimated army after this segment. */
  armyBest: number;
  armyTypical: number;
}

export type ModuleCategory =
  | 'growth'
  | 'choice'
  | 'obstacle'
  | 'hazard'
  | 'enemy'
  | 'reward'
  | 'recovery'
  | 'speed'
  | 'branch'
  | 'combo';

export interface LevelPlan {
  level: number;
  seed: number;
  difficulty: number;
  enemyScale: number;
  baseSpeed: number;
  length: number;
  segments: SegmentPlan[];
  speedZones: SpeedZone[];
  finale: FinaleSpec;
  theme: number;
  isBoss: boolean;
  /** Stats the generator assumed for the player. */
  player: PlayerStats;
  expected: { armyBest: number; armyTypical: number; damageBest: number; damageTypical: number };
  daily?: DailyModifier;
}

export interface PlayerStats {
  power: number;
  health: number;
  startUnits: number;
  gateBonus: number;
  surgeDuration: number;
  surgeChargeMult: number;
  incomeMult: number;
}

export type DailyModifier = 'none' | 'glass' | 'megagates' | 'rush' | 'horde';
