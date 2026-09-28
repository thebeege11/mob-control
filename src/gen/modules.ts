/**
 * Level module library. Each module is a reusable, parameterised chunk of
 * level (a LevelSegment) that knows its own difficulty rating, unlock level,
 * compatibility rules and how to build itself for a given difficulty.
 *
 * Coordinates: x in [-H, H], y relative to the start of the segment.
 */
import { TUNING } from '../config/tuning';
import { clamp, clamp01, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import type { EnemyKind, EntitySpec, GateKind, GateSpec, HazardSpec, ModuleCategory, PlayerStats } from './types';

export const H = TUNING.world.trackHalfWidth;
const C = TUNING.combat;

export interface BuildCtx {
  rng: Rng;
  level: number;
  /** Complexity (skill) difficulty. */
  D: number;
  speed: number;
  /** Expected army entering this segment (typical play, reference player). */
  army: number;
  /** Director's desired army size at this point of the level. */
  targetArmy: number;
  /** Reference stats for this level: enemy numbers are sized against these. */
  ref: PlayerStats;
  /** Enemy HP multiplier (power + performance + progression). */
  enemyHpMult: number;
  /** Enemy attack multiplier (progression only). */
  enemyAtkMult: number;
  nextGroup: () => number;
}

export interface ModuleOutput {
  length: number;
  entities: EntitySpec[];
  rating: number;
  /** Fraction of units a typical player loses to this module's hazards. */
  hazardLossTypical: number;
}

export interface ModuleDef {
  id: string;
  category: ModuleCategory;
  unlockLevel: number;
  /** Difficulty window in which this module may appear. */
  minD: number;
  maxD: number;
  /** D at which the module reaches full intensity. */
  fullD: number;
  /** Required expected army (typical) to be placed. */
  minArmy: number;
  weight: number;
  needsRecoveryAfter: boolean;
  hasHazards: boolean;
  /** Module ids or categories this module must not directly follow. */
  notAfter: string[];
  hint?: { key: string; text: string };
  build: (ctx: BuildCtx, i: number) => ModuleOutput;
}

// ---------------------------------------------------------------- helpers

export function intensity(def: ModuleDef, D: number): number {
  return clamp01((D - def.minD) / Math.max(0.001, def.fullD - def.minD));
}

/** Overdrive beyond full intensity: grows slowly forever (late game). */
export function overdrive(def: ModuleDef, D: number): number {
  return Math.max(0, (D - def.fullD) / 18);
}

function niceCount(n: number): number {
  if (n <= 10) return Math.max(1, Math.round(n));
  if (n <= 50) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}

interface GateOpt {
  kind: GateKind;
  value: number;
}

function goodGate(ctx: BuildCtx, strong = false): GateOpt {
  // Director: steer the army toward the designed size so numbers stay
  // readable and every choice keeps mattering.
  const gb = 1 + ctx.ref.gateBonus;
  const desired = ctx.targetArmy * (strong ? 1.35 : 1.1);
  const need = desired - ctx.army;
  if (need <= ctx.army * 0.1) return { kind: 'add', value: niceCount(clamp(ctx.army * (strong ? 0.25 : 0.12) + 3, 3, 5000)) };
  if (ctx.army >= 10 && ctx.rng.chance(strong ? 0.7 : 0.5)) {
    let k = 0;
    for (const cand of [2, 3, 4]) {
      if (cand > 2 && ctx.D < 6) break;
      if (cand > 3 && ctx.D < 14) break;
      if (ctx.army * (1 + (cand - 1) * gb) <= desired * 1.2) k = cand;
    }
    if (k >= 2) return { kind: 'mul', value: k };
  }
  return { kind: 'add', value: niceCount(clamp(need / gb + 3, 4, 5000)) };
}

function weakGate(ctx: BuildCtx): GateOpt {
  const r = ctx.rng.next();
  if (ctx.level < 2) return { kind: 'add', value: niceCount(clamp(ctx.army * 0.2 + 2, 3, 30)) };
  if (r < 0.2 && ctx.army >= 10) return { kind: 'div', value: 2 };
  if (r < 0.45) return { kind: 'add', value: niceCount(clamp(ctx.army * 0.12 + 2, 2, 60)) };
  return { kind: 'sub', value: niceCount(clamp(ctx.army * lerp(0.3, 0.6, clamp01(ctx.D / 20)), 3, 2000)) };
}

/** Evenly split a row of gates across [x0, x1] with posts between them. */
function gateRow(y: number, opts: GateOpt[], x0 = -H + 6, x1 = H - 6): GateSpec[] {
  const post = 10;
  const n = opts.length;
  const w = (x1 - x0 - post * (n - 1)) / n;
  return opts.map((o, i) => ({
    t: 'gate' as const,
    y,
    x0: x0 + i * (w + post),
    x1: x0 + i * (w + post) + w,
    kind: o.kind,
    value: o.value,
  }));
}

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function wallWithGaps(y: number, thick: number, gaps: [number, number][]): HazardSpec[] {
  const res: HazardSpec[] = [];
  const sorted = gaps.slice().sort((a, b) => a[0] - b[0]);
  let cur = -H - 20;
  for (const [g0, g1] of sorted) {
    if (g0 > cur + 2) res.push({ t: 'hazard', kind: 'wall', shape: { shape: 'rect', x0: cur, x1: g0, y0: y, y1: y + thick } });
    cur = g1;
  }
  if (cur < H + 18) res.push({ t: 'hazard', kind: 'wall', shape: { shape: 'rect', x0: cur, x1: H + 20, y0: y, y1: y + thick } });
  return res;
}

function coinTrail(y0: number, len: number, x: number, amp: number, n: number, freq = 1): EntitySpec[] {
  const out: EntitySpec[] = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1);
    out.push({ t: 'pickup', kind: 'coin', x: clamp(x + Math.sin(t * Math.PI * 2 * freq) * amp, -H + 14, H - 14), y: y0 + t * len });
  }
  return out;
}

function gruntHp(ctx: BuildCtx): number {
  return C.gruntBaseHp * (ctx.ref.power / 10) * ctx.enemyHpMult;
}
function gruntAtk(ctx: BuildCtx): number {
  return C.gruntBaseAtk * (ctx.ref.health / 10) * ctx.enemyAtkMult;
}

/** Units the reference player loses per grunt (continuous contact model). */
function refLossPerGrunt(ctx: BuildCtx): number {
  return (gruntHp(ctx) * gruntAtk(ctx)) / (ctx.ref.power * ctx.ref.health);
}

function formation(ctx: BuildCtx, kind: EnemyKind, n: number, cx: number, y0: number, cols: number, spacing: number): EntitySpec[] {
  const group = ctx.nextGroup();
  const out: EntitySpec[] = [];
  const isBrute = kind === 'brute';
  const hp = gruntHp(ctx) * (isBrute ? C.bruteHpMult : 1);
  const atk = gruntAtk(ctx) * (isBrute ? C.bruteAtkMult : 1);
  const r = isBrute ? C.bruteRadius : C.gruntRadius;
  const rows = Math.ceil(n / cols);
  let placed = 0;
  for (let row = 0; row < rows && placed < n; row++) {
    const inRow = Math.min(cols, n - placed);
    const rowW = (inRow - 1) * spacing;
    for (let c = 0; c < inRow; c++) {
      const x = clamp(cx - rowW / 2 + c * spacing + (row % 2) * spacing * 0.3, -H + r + 2, H - r - 2);
      out.push({ t: 'enemy', kind, x, y: y0 + row * spacing, hp, atk, r, group });
      placed++;
    }
  }
  return out;
}

function hint(key: string, text: string): EntitySpec {
  return { t: 'hint', y: 0, key, text };
}

// ---------------------------------------------------------------- modules

const M: ModuleDef[] = [];
function def(d: Partial<ModuleDef> & Pick<ModuleDef, 'id' | 'category' | 'build'>): void {
  M.push({
    unlockLevel: 1,
    minD: 0,
    maxD: Infinity,
    fullD: 20,
    minArmy: 0,
    weight: 1,
    needsRecoveryAfter: false,
    hasHazards: false,
    notAfter: [],
    ...d,
  });
}

// ---- GROWTH ----
def({
  id: 'growth_add',
  category: 'growth',
  weight: 1.2,
  build: (ctx) => {
    const over = ctx.army / Math.max(1, ctx.targetArmy);
    const n = niceCount(clamp(over > 1 ? ctx.army * 0.15 + 4 : Math.max(ctx.army * 0.4, ctx.targetArmy - ctx.army) * 0.8 + 5, 5, 1000));
    const w = ctx.rng.range(170, 250);
    const cx = ctx.rng.range(-H + w / 2 + 6, H - w / 2 - 6);
    return {
      length: 230,
      rating: 0.3,
      hazardLossTypical: 0,
      entities: [{ t: 'gate', y: 150, x0: cx - w / 2, x1: cx + w / 2, kind: 'add', value: n }, ...coinTrail(20, 110, cx, 30, 6)],
    };
  },
});

def({
  id: 'growth_mul',
  category: 'growth',
  weight: 1.4,
  build: (ctx) => {
    const k = ctx.D > 10 && ctx.army < ctx.targetArmy * 0.5 && ctx.rng.chance(0.4) ? 3 : 2;
    const w = ctx.rng.range(140, 200);
    const cx = ctx.rng.range(-H + w / 2 + 6, H - w / 2 - 6);
    const g: GateOpt = ctx.army > ctx.targetArmy ? { kind: 'add', value: niceCount(ctx.army * 0.2 + 4) } : { kind: 'mul', value: k };
    return {
      length: 240,
      rating: 0.5,
      hazardLossTypical: 0,
      entities: [{ t: 'gate', y: 160, x0: cx - w / 2, x1: cx + w / 2, kind: g.kind, value: g.value }, ...coinTrail(10, 120, cx, 0, 5)],
    };
  },
});

// ---- CHOICE ----
def({
  id: 'choice_pair',
  category: 'choice',
  weight: 2.2,
  build: (ctx) => {
    const good = goodGate(ctx);
    let other = weakGate(ctx);
    if (ctx.level <= 1) other = { kind: good.kind === 'mul' ? 'add' : 'mul', value: good.kind === 'mul' ? niceCount(ctx.army * 0.4 + 3) : 2 };
    const opts = shuffle(ctx.rng, [good, other]);
    return { length: 220, rating: 1, hazardLossTypical: 0, entities: gateRow(150, opts) };
  },
});

def({
  id: 'choice_triple',
  category: 'choice',
  unlockLevel: 6,
  minD: 5,
  weight: 1.6,
  build: (ctx) => {
    const opts = shuffle(ctx.rng, [goodGate(ctx, true), weakGate(ctx), ctx.rng.chance(0.5) ? goodGate(ctx) : weakGate(ctx)]);
    return { length: 230, rating: 1.5, hazardLossTypical: 0, entities: gateRow(160, opts) };
  },
});

def({
  id: 'choice_moving',
  category: 'choice',
  unlockLevel: 9,
  minD: 6,
  fullD: 22,
  weight: 1.2,
  hint: { key: 'moving_gate', text: 'Catch the moving gate!' },
  build: (ctx, i) => {
    const g = goodGate(ctx, true);
    const w = lerp(130, 100, i);
    const amp = H - w / 2 - 10;
    const period = lerp(3.2, 1.9, i);
    return {
      length: 260,
      rating: 1.5 + i,
      hazardLossTypical: 0,
      entities: [
        hint('moving_gate', 'Catch the moving gate!'),
        { t: 'gate', y: 180, x0: -w / 2, x1: w / 2, kind: g.kind, value: g.value, motion: { amp, period, phase: ctx.rng.next() } },
      ],
    };
  },
});

def({
  id: 'choice_swap',
  category: 'choice',
  unlockLevel: 18,
  minD: 11,
  fullD: 26,
  weight: 1.1,
  hint: { key: 'swap_gate', text: 'Gates swap! Watch the rhythm' },
  build: (ctx, i) => {
    const g = goodGate(ctx, true);
    const b = weakGate(ctx);
    const period = lerp(2.4, 1.5, i);
    const phase = ctx.rng.next();
    const row = gateRow(180, [g, b]);
    row[0].blink = { period, duty: 0.5, kind2: b.kind, value2: b.value, phase };
    row[1].blink = { period, duty: 0.5, kind2: g.kind, value2: g.value, phase };
    return { length: 260, rating: 2 + i, hazardLossTypical: 0, entities: [hint('swap_gate', 'Gates swap! Watch the rhythm'), ...row] };
  },
});

// ---- OBSTACLES ----
def({
  id: 'narrow_gap',
  category: 'obstacle',
  hasHazards: true,
  fullD: 18,
  weight: 1.8,
  hint: { key: 'squeeze', text: 'HOLD to squeeze through!' },
  build: (ctx, i) => {
    const gw = lerp(170, 64, i);
    const gx = ctx.rng.range(-H + gw / 2 + 10, H - gw / 2 - 10) * (ctx.level <= 1 ? 0.3 : 1);
    return {
      length: 190,
      rating: 1.5 + 2.5 * i,
      hazardLossTypical: 0.05 + 0.16 * i,
      entities: [hint('squeeze', 'HOLD to squeeze through!'), ...wallWithGaps(110, 24, [[gx - gw / 2, gx + gw / 2]]), ...coinTrail(40, 120, gx, 0, 4)],
    };
  },
});

def({
  id: 'double_gap',
  category: 'obstacle',
  unlockLevel: 3,
  minD: 2,
  hasHazards: true,
  weight: 1.5,
  build: (ctx, i) => {
    const wide = lerp(150, 100, i);
    const narrow = lerp(90, 56, i);
    const left = ctx.rng.chance(0.5);
    const gA: [number, number] = left ? [-H + 20, -H + 20 + narrow] : [H - 20 - narrow, H - 20];
    const gB: [number, number] = left ? [H - 20 - wide, H - 20] : [-H + 20, -H + 20 + wide];
    const good = goodGate(ctx, true);
    const meh: GateOpt = { kind: 'add', value: niceCount(clamp(ctx.army * 0.2 + 3, 3, 40)) };
    return {
      length: 290,
      rating: 2 + 2 * i,
      hazardLossTypical: 0.08 + 0.12 * i,
      entities: [
        ...wallWithGaps(100, 24, [gA, gB]),
        { t: 'gate', y: 200, x0: gA[0], x1: gA[1], kind: good.kind, value: good.value },
        { t: 'gate', y: 200, x0: gB[0], x1: gB[1], kind: meh.kind, value: meh.value },
      ],
    };
  },
});

def({
  id: 'slalom',
  category: 'obstacle',
  unlockLevel: 7,
  minD: 5,
  fullD: 24,
  hasHazards: true,
  needsRecoveryAfter: true,
  weight: 1.2,
  build: (ctx, i) => {
    const walls = i > 0.5 ? 3 : 2;
    const gw = lerp(130, 80, i);
    const shift = lerp(60, 95, i);
    const spacing = ((2 * shift) / (TUNING.swarm.maxLateralSpeed * lerp(0.32, 0.42, i))) * ctx.speed + 50;
    const ents: EntitySpec[] = [];
    let side = ctx.rng.sign();
    for (let k = 0; k < walls; k++) {
      const gx = side * shift;
      ents.push(...wallWithGaps(80 + k * spacing, 22, [[gx - gw / 2, gx + gw / 2]]));
      ents.push({ t: 'pickup', kind: 'coin', x: gx, y: 60 + k * spacing });
      side = -side;
    }
    return { length: 80 + walls * spacing + 40, rating: 2.5 + 2.5 * i, hazardLossTypical: 0.1 + 0.15 * i, entities: ents };
  },
});

// ---- HAZARDS ----
def({
  id: 'sweeper',
  category: 'hazard',
  unlockLevel: 4,
  minD: 3,
  hasHazards: true,
  weight: 1.6,
  hint: { key: 'sweeper', text: 'Dodge the sweeper!' },
  build: (ctx, i) => {
    const count = i > 0.55 ? 2 : 1;
    const ents: EntitySpec[] = [hint('sweeper', 'Dodge the sweeper!')];
    const w = lerp(90, 125, i);
    const period = lerp(3.4, 1.9, i);
    const phase = ctx.rng.next();
    for (let k = 0; k < count; k++) {
      ents.push({
        t: 'hazard',
        kind: 'sweeper',
        shape: { shape: 'rect', x0: -w / 2, x1: w / 2, y0: 100 + k * 150, y1: 128 + k * 150 },
        motion: { type: 'sine', amp: H - w / 2 - 4, period, phase: phase + k * 0.5 },
      });
    }
    return { length: 150 + count * 150, rating: 2 + 3 * i, hazardLossTypical: 0.06 + 0.12 * i, entities: ents };
  },
});

def({
  id: 'spinner',
  category: 'hazard',
  unlockLevel: 6,
  minD: 4,
  hasHazards: true,
  weight: 1.5,
  hint: { key: 'spinner', text: 'Spinner! Slip past the bar' },
  build: (ctx, i) => {
    const ents: EntitySpec[] = [hint('spinner', 'Spinner! Slip past the bar')];
    const dual = i > 0.6 && ctx.rng.chance(0.6);
    const angVel = lerp(1.5, 3.0, i) * ctx.rng.sign();
    if (dual) {
      for (const sx of [-1, 1]) {
        ents.push({
          t: 'hazard',
          kind: 'spinner',
          shape: { shape: 'capsule', cx: sx * 78, cy: 170, len: 140, thick: 16, angle0: ctx.rng.range(0, 6.28), angVel: angVel * sx },
        });
      }
    } else {
      const len = lerp(170, 250, i);
      ents.push({
        t: 'hazard',
        kind: 'spinner',
        shape: { shape: 'capsule', cx: ctx.rng.range(-40, 40), cy: 170, len, thick: 16, angle0: ctx.rng.range(0, 6.28), angVel },
      });
    }
    return { length: 340, rating: 2.5 + 3 * i, hazardLossTypical: 0.08 + 0.14 * i, entities: ents };
  },
});

def({
  id: 'saw_field',
  category: 'hazard',
  unlockLevel: 8,
  minD: 5,
  fullD: 26,
  hasHazards: true,
  weight: 1.3,
  hint: { key: 'saws', text: 'Saws! Weave through' },
  build: (ctx, i) => {
    const ents: EntitySpec[] = [hint('saws', 'Saws! Weave through')];
    const rows = 2 + Math.round(i * 2);
    const moving = i > 0.4;
    for (let r = 0; r < rows; r++) {
      const perRow = ctx.rng.chance(0.5) ? 2 : 1;
      const slots = shuffle(ctx.rng, [-100, -35, 35, 100]).slice(0, perRow);
      for (const sx of slots) {
        ents.push({
          t: 'hazard',
          kind: 'saw',
          shape: { shape: 'circle', x: sx + ctx.rng.range(-12, 12), y: 90 + r * 120, r: lerp(17, 23, i) },
          motion: moving && ctx.rng.chance(0.5) ? { type: 'sine', amp: 40, period: lerp(2.6, 1.8, i), phase: ctx.rng.next() } : undefined,
        });
      }
    }
    return { length: 90 + rows * 120 + 40, rating: 2.5 + 3 * i, hazardLossTypical: 0.07 + 0.13 * i, entities: ents };
  },
});

def({
  id: 'crusher',
  category: 'hazard',
  unlockLevel: 11,
  minD: 7,
  fullD: 26,
  hasHazards: true,
  needsRecoveryAfter: true,
  weight: 1.2,
  hint: { key: 'crusher', text: 'Crusher! Squeeze when it slams' },
  build: (ctx, i) => {
    const openHalf = lerp(120, 105, i);
    const closedGap = lerp(70, 44, i);
    const amp = openHalf - closedGap / 2;
    const period = lerp(2.8, 1.8, i);
    const phase = ctx.rng.next();
    const y0 = 120;
    const y1 = y0 + lerp(50, 80, i);
    return {
      length: y1 + 110,
      rating: 3 + 3 * i,
      hazardLossTypical: 0.1 + 0.15 * i,
      entities: [
        hint('crusher', 'Crusher! Squeeze when it slams'),
        { t: 'hazard', kind: 'crusher', shape: { shape: 'rect', x0: -H - 80, x1: -openHalf, y0, y1 }, motion: { type: 'slam', amp, period, phase } },
        { t: 'hazard', kind: 'crusher', shape: { shape: 'rect', x0: openHalf, x1: H + 80, y0, y1 }, motion: { type: 'slam', amp: -amp, period, phase } },
      ],
    };
  },
});

def({
  id: 'laser_split',
  category: 'hazard',
  unlockLevel: 13,
  minD: 8,
  fullD: 28,
  hasHazards: true,
  weight: 1.1,
  hint: { key: 'laser', text: 'Lasers flip sides — time it!' },
  build: (ctx, i) => {
    const period = lerp(2.6, 1.6, i);
    const phase = ctx.rng.next();
    const mid = ctx.rng.range(-30, 30);
    const warn = lerp(0.6, 0.4, i);
    return {
      length: 280,
      rating: 3 + 2.5 * i,
      hazardLossTypical: 0.1 + 0.12 * i,
      entities: [
        hint('laser', 'Lasers flip sides — time it!'),
        { t: 'hazard', kind: 'laser', shape: { shape: 'rect', x0: -H - 10, x1: mid - 8, y0: 160, y1: 170 }, cycle: { period, phase, onFrom: 0, onTo: 0.5, warn } },
        { t: 'hazard', kind: 'laser', shape: { shape: 'rect', x0: mid + 8, x1: H + 10, y0: 160, y1: 170 }, cycle: { period, phase, onFrom: 0.5, onTo: 1, warn } },
      ],
    };
  },
});

def({
  id: 'spike_strips',
  category: 'hazard',
  unlockLevel: 5,
  minD: 3,
  hasHazards: true,
  weight: 1.3,
  build: (ctx, i) => {
    const n = 2 + Math.round(i * 2);
    const w = lerp(0.5, 0.62, i) * 2 * H;
    // The swarm must shift by ~w between strips: give it time to do so.
    const spacing = (w / (TUNING.swarm.maxLateralSpeed * lerp(0.32, 0.42, i))) * ctx.speed + 40;
    let side = ctx.rng.sign();
    const ents: EntitySpec[] = [];
    for (let k = 0; k < n; k++) {
      const y = 80 + k * spacing;
      const shape = side < 0 ? { shape: 'rect' as const, x0: -H - 10, x1: -H + w, y0: y, y1: y + 20 } : { shape: 'rect' as const, x0: H - w, x1: H + 10, y0: y, y1: y + 20 };
      ents.push({ t: 'hazard', kind: 'spikes', shape });
      side = -side;
    }
    return { length: 80 + n * spacing + 30, rating: 2 + 2.5 * i, hazardLossTypical: 0.06 + 0.12 * i, entities: ents, };
  },
});

// ---- ENEMIES ----
def({
  id: 'grunt_squad',
  category: 'enemy',
  unlockLevel: 3,
  minD: 1.5,
  minArmy: 8,
  weight: 2.0,
  hint: { key: 'grunts', text: 'Smash the Grumps!' },
  build: (ctx, i) => {
    const frac = lerp(0.22, 0.4, i);
    const n = Math.round(clamp((ctx.army * frac) / refLossPerGrunt(ctx), 3, 36));
    const cols = clamp(Math.ceil(Math.sqrt(n * 1.6)), 3, 9);
    const cx = ctx.rng.range(-60, 60);
    return {
      length: 260 + Math.ceil(n / cols) * 16,
      rating: 1.5 + 2.5 * i,
      hazardLossTypical: 0,
      entities: [hint('grunts', 'Smash the Grumps!'), ...formation(ctx, 'grunt', n, cx, 180, cols, 17)],
    };
  },
});

def({
  id: 'grunt_waves',
  category: 'enemy',
  unlockLevel: 9,
  minD: 6,
  minArmy: 16,
  weight: 1.4,
  build: (ctx, i) => {
    const frac = lerp(0.3, 0.45, i);
    const total = clamp((ctx.army * frac) / refLossPerGrunt(ctx), 6, 56);
    const n1 = Math.round(total * 0.45);
    const n2 = Math.round(total * 0.55);
    const side = ctx.rng.sign();
    return {
      length: 470,
      rating: 2.5 + 2.5 * i,
      hazardLossTypical: 0,
      entities: [...formation(ctx, 'grunt', n1, side * 70, 170, 5, 17), ...formation(ctx, 'grunt', n2, -side * 60, 350, 6, 17)],
    };
  },
});

def({
  id: 'brute',
  category: 'enemy',
  unlockLevel: 16,
  minD: 7,
  minArmy: 25,
  weight: 1.1,
  hint: { key: 'brute', text: 'BRUTE! Hit it with everything' },
  build: (ctx, i) => {
    const bruteCost = (gruntHp(ctx) * C.bruteHpMult * gruntAtk(ctx) * C.bruteAtkMult) / (ctx.ref.power * ctx.ref.health);
    const brutes = clamp(Math.round((ctx.army * lerp(0.25, 0.4, i)) / bruteCost), 1, 3);
    const escorts = Math.round(clamp((ctx.army * 0.1) / refLossPerGrunt(ctx), 0, 12));
    const ents: EntitySpec[] = [hint('brute', 'BRUTE! Hit it with everything')];
    for (let b = 0; b < brutes; b++) ents.push(...formation(ctx, 'brute', 1, (b - (brutes - 1) / 2) * 90, 200, 1, 40));
    if (escorts > 0) ents.push(...formation(ctx, 'grunt', escorts, 0, 150, 6, 17));
    return { length: 330, rating: 3 + 2 * i, hazardLossTypical: 0, entities: ents };
  },
});

// ---- REWARDS ----
def({
  id: 'crates',
  category: 'reward',
  unlockLevel: 2,
  weight: 1.1,
  build: (ctx) => {
    const n = ctx.rng.int(2, 4);
    const group = ctx.nextGroup();
    const hp = C.crateBaseHp * (ctx.ref.power / 10) * ctx.enemyHpMult;
    const ents: EntitySpec[] = [];
    const span = (n - 1) * 70;
    for (let k = 0; k < n; k++) {
      const gem = ctx.rng.chance(TUNING.economy.gemCrateChance);
      ents.push({ t: 'enemy', kind: gem ? 'gemcrate' : 'crate', x: -span / 2 + k * 70, y: 150, hp: gem ? hp * 1.6 : hp, atk: 0, r: 15, group });
    }
    return { length: 240, rating: 0.4, hazardLossTypical: 0, entities: ents };
  },
});

def({
  id: 'coin_trail',
  category: 'reward',
  weight: 0.9,
  build: (ctx) => ({
    length: 260,
    rating: 0.2,
    hazardLossTypical: 0,
    entities: coinTrail(20, 220, ctx.rng.range(-40, 40), ctx.rng.range(50, 100), 14, ctx.rng.chance(0.5) ? 1 : 1.5),
  }),
});

def({
  id: 'surge_orb',
  category: 'reward',
  unlockLevel: TUNING.ability.unlockLevel + 1,
  weight: 0.7,
  build: (ctx) => {
    const x = ctx.rng.range(-110, 110);
    return { length: 220, rating: 0.4, hazardLossTypical: 0, entities: [{ t: 'pickup', kind: 'surge', x, y: 140 }, ...coinTrail(30, 90, x, 0, 4)] };
  },
});

def({
  id: 'champion_orb',
  category: 'reward',
  unlockLevel: 12,
  weight: 0.25,
  hint: { key: 'champion', text: 'CHAMPION! A mighty golden blip' },
  build: (ctx) => {
    const x = ctx.rng.range(-120, 120);
    return { length: 220, rating: 0.4, hazardLossTypical: 0, entities: [hint('champion', 'CHAMPION! A mighty golden blip'), { t: 'pickup', kind: 'champion', x, y: 140 }] };
  },
});

// ---- SPEED ----
def({
  id: 'boost_pad',
  category: 'speed',
  unlockLevel: 22,
  minD: 11,
  weight: 0.8,
  hint: { key: 'boost', text: 'SPEED BOOST!' },
  build: (ctx) => {
    const len = 620;
    const g = goodGate(ctx);
    return {
      length: len + 60,
      rating: 1.5,
      hazardLossTypical: 0,
      entities: [
        hint('boost', 'SPEED BOOST!'),
        { t: 'pad', y0: 20, y1: len, mult: 1.5 },
        ...coinTrail(80, 360, 0, 110, 18, 1.5),
        ...gateRow(len - 40, [g, goodGate(ctx)]),
      ],
    };
  },
});

// ---- BRANCH (risk / reward) ----
def({
  id: 'branch',
  category: 'branch',
  unlockLevel: 25,
  minD: 12,
  fullD: 30,
  hasHazards: true,
  needsRecoveryAfter: true,
  weight: 0.9,
  hint: { key: 'branch', text: 'Pick a path: risky or safe?' },
  build: (ctx, i) => {
    const len = 440;
    const riskySide = ctx.rng.sign();
    const ents: EntitySpec[] = [hint('branch', 'Pick a path: risky or safe?')];
    ents.push({ t: 'hazard', kind: 'divider', shape: { shape: 'rect', x0: -6, x1: 6, y0: 90, y1: 90 + len } });
    // Risky side: sweeper across its lane + big multiplier.
    const laneC = riskySide * (H / 2);
    const w = 70;
    ents.push({
      t: 'hazard',
      kind: 'sweeper',
      shape: { shape: 'rect', x0: laneC - w / 2, x1: laneC + w / 2, y0: 230, y1: 256 },
      motion: { type: 'sine', amp: H / 2 - w / 2 - 8, period: lerp(2.6, 1.7, i), phase: ctx.rng.next() },
    });
    ents.push({ t: 'hazard', kind: 'saw', shape: { shape: 'circle', x: laneC + ctx.rng.range(-35, 35), y: 360, r: 18 } });
    const big: GateOpt = ctx.army < ctx.targetArmy ? { kind: 'mul', value: ctx.D > 18 ? 4 : 3 } : { kind: 'add', value: niceCount(ctx.army * 0.9 + 5) };
    const small: GateOpt = { kind: 'add', value: niceCount(clamp(ctx.army * 0.4 + 4, 4, 80)) };
    const lo = riskySide < 0 ? [-H + 6, -8] : [8, H - 6];
    const so = riskySide < 0 ? [8, H - 6] : [-H + 6, -8];
    ents.push({ t: 'gate', y: 440, x0: lo[0], x1: lo[1], kind: big.kind, value: big.value });
    ents.push({ t: 'gate', y: 440, x0: so[0], x1: so[1], kind: small.kind, value: small.value });
    ents.push(...coinTrail(150, 250, -laneC, 0, 6));
    return { length: 90 + len + 40, rating: 3 + 2 * i, hazardLossTypical: 0.08, entities: ents };
  },
});

// ---- COMBOS (mid / late game) ----
def({
  id: 'combo_sweeper_gate',
  category: 'combo',
  unlockLevel: 14,
  minD: 9,
  fullD: 28,
  hasHazards: true,
  weight: 1.1,
  build: (ctx, i) => {
    const w = lerp(100, 125, i);
    const g = goodGate(ctx, true);
    const side = ctx.rng.sign();
    return {
      length: 300,
      rating: 3 + 2.5 * i,
      hazardLossTypical: 0.08 + 0.1 * i,
      entities: [
        { t: 'hazard', kind: 'sweeper', shape: { shape: 'rect', x0: -w / 2, x1: w / 2, y0: 150, y1: 176 }, motion: { type: 'sine', amp: H - w / 2 - 4, period: lerp(3.0, 1.9, i), phase: ctx.rng.next() } },
        ...gateRow(240, side < 0 ? [g, weakGate(ctx)] : [weakGate(ctx), g]),
      ],
    };
  },
});

def({
  id: 'combo_gates_grunts',
  category: 'combo',
  unlockLevel: 10,
  minD: 6,
  minArmy: 10,
  weight: 1.2,
  build: (ctx, i) => {
    const opts = shuffle(ctx.rng, [goodGate(ctx), weakGate(ctx)]);
    const n = Math.round(clamp((ctx.army * lerp(0.35, 0.5, i)) / refLossPerGrunt(ctx), 4, 40));
    return {
      length: 470,
      rating: 2.5 + 2 * i,
      hazardLossTypical: 0,
      entities: [...gateRow(120, opts), ...formation(ctx, 'grunt', n, ctx.rng.range(-50, 50), 340, 7, 17)],
    };
  },
});

def({
  id: 'combo_saw_gates',
  category: 'combo',
  unlockLevel: 24,
  minD: 12,
  fullD: 30,
  hasHazards: true,
  weight: 1.0,
  build: (ctx, i) => {
    const g = goodGate(ctx, true);
    const b = weakGate(ctx);
    const row = gateRow(250, ctx.rng.chance(0.5) ? [g, b] : [b, g]);
    const ents: EntitySpec[] = [...row];
    for (const sx of [-110, 0, 110]) {
      ents.push({ t: 'hazard', kind: 'saw', shape: { shape: 'circle', x: sx, y: 150, r: 18 }, motion: { type: 'sine', amp: 30, period: lerp(2.4, 1.6, i), phase: ctx.rng.next() } });
    }
    return { length: 320, rating: 3 + 2.5 * i, hazardLossTypical: 0.1 + 0.1 * i, entities: ents };
  },
});

def({
  id: 'combo_laser_gates',
  category: 'combo',
  unlockLevel: 28,
  minD: 13,
  fullD: 32,
  hasHazards: true,
  needsRecoveryAfter: true,
  weight: 0.9,
  build: (ctx, i) => {
    const period = lerp(2.4, 1.6, i);
    const phase = ctx.rng.next();
    const g = goodGate(ctx, true);
    const b = weakGate(ctx);
    const goodLeft = ctx.rng.chance(0.5);
    return {
      length: 320,
      rating: 3.5 + 2.5 * i,
      hazardLossTypical: 0.12 + 0.1 * i,
      entities: [
        { t: 'hazard', kind: 'laser', shape: { shape: 'rect', x0: -H - 10, x1: -8, y0: 140, y1: 150 }, cycle: { period, phase, onFrom: 0, onTo: 0.5, warn: 0.45 } },
        { t: 'hazard', kind: 'laser', shape: { shape: 'rect', x0: 8, x1: H + 10, y0: 140, y1: 150 }, cycle: { period, phase, onFrom: 0.5, onTo: 1, warn: 0.45 } },
        ...gateRow(250, goodLeft ? [g, b] : [b, g]),
      ],
    };
  },
});

// ---- RECOVERY ----
def({
  id: 'recovery',
  category: 'recovery',
  weight: 1,
  build: (ctx) => {
    const ents: EntitySpec[] = coinTrail(20, 170, ctx.rng.range(-60, 60), 60, 8);
    if (ctx.rng.chance(0.5)) {
      const n = niceCount(clamp(ctx.army * 0.3 + 4, 4, 60));
      ents.push({ t: 'gate', y: 200, x0: -H + 30, x1: H - 30, kind: 'add', value: n });
    }
    return { length: 250, rating: 0, hazardLossTypical: 0, entities: ents };
  },
});

export const MODULES: readonly ModuleDef[] = M;
export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries(M.map((m) => [m.id, m]));

/** Levels at which each module first appears (for the discovery curve / tests). */
export function unlockSchedule(): { level: number; id: string }[] {
  return M.map((m) => ({ level: m.unlockLevel, id: m.id })).sort((a, b) => a.level - b.level);
}
