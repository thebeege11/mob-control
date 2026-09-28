/**
 * FairnessValidator — proves generated levels are beatable by skill, not luck.
 *
 * Checks:
 *  - reachable paths: a swarm "core" moving at a human-achievable lateral
 *    speed always has a safe corridor through every hazard (time-aware, uses
 *    the exact runtime hazard geometry)
 *  - minimum reaction time between hazard sections
 *  - recovery room after demanding sections
 *  - obstacle overlap / segment ordering / gates not buried in walls
 *  - expected survival (typical army never collapses; finale beatable with good play)
 *  - difficulty spikes between consecutive sections
 */
import { TUNING } from '../config/tuning';
import { hazardBlockedIntervals, hazardYRange, mergeIntervals, complementIntervals } from '../game/hazardGeometry';
import type { EntitySpec, GateSpec, HazardSpec, LevelPlan, PlayerStats, SegmentPlan, SpeedZone } from './types';

const F = TUNING.fairness;
const H = TUNING.world.trackHalfWidth;

export function minHazardGapSeconds(D: number): number {
  return F.minHazardGapSecondsEnd + (F.minHazardGapSecondsStart - F.minHazardGapSecondsEnd) * Math.exp(-D / F.minHazardGapK);
}

export function maxRatingForD(D: number): number {
  return 1.6 + D * 0.42;
}

/** Time (s) for the swarm to reach world y, given the speed profile. */
export function timeAt(y: number, baseSpeed: number, zones: readonly SpeedZone[]): number {
  let t = y / baseSpeed;
  for (const z of zones) {
    const ov = Math.min(y, z.y1) - z.y0;
    if (ov > 0) t += ov * (1 / (baseSpeed * z.mult) - 1 / baseSpeed);
  }
  return t;
}

export function speedAt(y: number, baseSpeed: number, zones: readonly SpeedZone[]): number {
  for (const z of zones) if (y >= z.y0 && y < z.y1) return baseSpeed * z.mult;
  return baseSpeed;
}

export interface ReachResult {
  ok: boolean;
  /** Reachable swarm-centre intervals at the end (flat pairs). */
  intervals: number[];
  failY?: number;
}

/**
 * Sweep forward from y0 to y1, tracking the set of x positions the swarm
 * core can occupy without touching any hazard.
 */
export function sweepReachability(
  hazards: readonly HazardSpec[],
  start: number[],
  y0: number,
  y1: number,
  baseSpeed: number,
  zones: readonly SpeedZone[],
): ReachResult {
  const R = F.coreRadius;
  const lo = -H + R;
  const hi = H - R;
  const vmax = TUNING.swarm.maxLateralSpeed * F.humanLateralFactor;
  const step = F.sampleStep;
  // Pre-filter hazards by y range.
  const hs: { h: HazardSpec; a: number; b: number }[] = [];
  for (const h of hazards) {
    const [a, b] = hazardYRange(h);
    if (b + R + step >= y0 && a - R - step <= y1) hs.push({ h, a, b });
  }
  let cur = start.slice();
  let prevT = timeAt(y0, baseSpeed, zones);
  const blocked: number[] = [];
  for (let y = y0; y <= y1; y += step) {
    const t = timeAt(y, baseSpeed, zones);
    const grow = vmax * (t - prevT);
    prevT = t;
    // Expand reachable set by lateral movement.
    const expanded: number[] = [];
    for (let i = 0; i < cur.length; i += 2) expanded.push(Math.max(lo, cur[i] - grow), Math.min(hi, cur[i + 1] + grow));
    const reach = mergeIntervals(expanded);
    blocked.length = 0;
    for (const { h, a, b } of hs) {
      if (y + step + R < a || y - step - R > b) continue;
      hazardBlockedIntervals(h, t, y, step * 0.5, R, blocked);
    }
    if (blocked.length === 0) {
      cur = reach;
      continue;
    }
    const safe = complementIntervals(mergeIntervals(blocked), lo, hi);
    cur = intersect(reach, safe);
    if (cur.length === 0) return { ok: false, intervals: [], failY: y };
  }
  return { ok: true, intervals: cur };
}

function intersect(a: number[], b: number[]): number[] {
  const res: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i], b[j]);
    const e = Math.min(a[i + 1], b[j + 1]);
    if (e - s > 0.5) res.push(s, e);
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return res;
}

export function fullTrackInterval(): number[] {
  return [-H + F.coreRadius, H - F.coreRadius];
}

// ------------------------------------------------------------ estimation

export interface ArmyEst {
  best: number;
  typical: number;
}

/**
 * Expected army after a segment. `hpScale` rescales enemy HP (used to
 * estimate the reference player on the same level).
 */
export function estimateSegment(
  entities: readonly EntitySpec[],
  army: ArmyEst,
  stats: PlayerStats,
  hazardLossTypical: number,
  hpScale = 1,
): ArmyEst {
  const cap = TUNING.world.maxArmy;
  let best = army.best;
  let typ = army.typical;
  type Ev = { y: number; kind: 'row'; gates: GateSpec[] } | { y: number; kind: 'enemy'; loss: number } | { y: number; kind: 'hazard' };
  const evs: Ev[] = [];
  const rows = new Map<number, GateSpec[]>();
  let firstHazardY = Infinity;
  for (const e of entities) {
    if (e.t === 'gate') {
      const key = Math.round(e.y);
      const r = rows.get(key);
      if (r) r.push(e);
      else rows.set(key, [e]);
    } else if (e.t === 'enemy') {
      evs.push({ y: e.y, kind: 'enemy', loss: (e.hp * hpScale * e.atk) / (stats.power * stats.health) });
    } else if (e.t === 'hazard') {
      firstHazardY = Math.min(firstHazardY, hazardYRange(e)[0]);
    }
  }
  for (const [y, gates] of rows) evs.push({ y, kind: 'row', gates });
  if (firstHazardY < Infinity && hazardLossTypical > 0) evs.push({ y: firstHazardY, kind: 'hazard' });
  evs.sort((a, b) => a.y - b.y);

  const apply = (a: number, kind: GateSpec['kind'], v: number): number => {
    switch (kind) {
      case 'mul':
        return a + a * (v - 1) * (1 + stats.gateBonus);
      case 'add':
        return a + v * (1 + stats.gateBonus);
      case 'sub':
        return Math.max(0, a - v);
      case 'div':
        return a / 2;
    }
  };

  for (const ev of evs) {
    if (ev.kind === 'row') {
      const fullRow = ev.gates.reduce((s, g) => s + (g.x1 - g.x0), 0) > H * 1.5;
      const outcomesB: number[] = [];
      const outcomesT: number[] = [];
      for (const g of ev.gates) {
        let b = apply(best, g.kind, g.value);
        let t = apply(typ, g.kind, g.value);
        if (g.blink) {
          b = Math.max(b, apply(best, g.blink.kind2, g.blink.value2));
          t = (t + apply(typ, g.blink.kind2, g.blink.value2)) / 2;
        }
        if (g.motion) t = typ + (t - typ) * 0.65;
        outcomesB.push(b);
        outcomesT.push(t);
      }
      if (!fullRow) {
        // Optional gates: the player may skip them entirely.
        outcomesB.push(best);
        outcomesT.push(typ);
      }
      const bestB = Math.max(...outcomesB);
      const bestT = Math.max(...outcomesT);
      const meanT = outcomesT.reduce((s, v) => s + v, 0) / outcomesT.length;
      best = bestB;
      typ = fullRow ? 0.7 * bestT + 0.3 * meanT : 0.8 * bestT + 0.2 * typ;
    } else if (ev.kind === 'enemy') {
      typ -= ev.loss;
      best -= ev.loss * 0.85;
    } else {
      typ *= 1 - hazardLossTypical;
      best *= 1 - hazardLossTypical * 0.15;
    }
    best = Math.min(cap, Math.max(0, best));
    typ = Math.min(cap, Math.max(0, typ));
  }
  return { best, typical: Math.min(typ, best) };
}

/** Total finale damage the army can deal (continuous contact model). */
export function finaleDamage(army: number, stats: PlayerStats, finaleAtk: number): number {
  return army * stats.power * (stats.health / Math.max(0.001, finaleAtk));
}

// ------------------------------------------------------------ full validation

export interface ValidationReport {
  ok: boolean;
  errors: string[];
}

export function validatePlan(plan: LevelPlan): ValidationReport {
  const errors: string[] = [];
  const D = plan.difficulty;
  const zones = plan.speedZones;
  const hazards: HazardSpec[] = [];
  let prevEnd = 0;
  let prevChallenge = 0;
  let lastHazardEndT = -Infinity;
  let prevNeedsRecovery = false;

  for (const seg of plan.segments) {
    if (seg.y0 < prevEnd - 0.01) errors.push(`overlap: ${seg.moduleId} starts at ${seg.y0} before ${prevEnd}`);
    if (seg.y1 <= seg.y0) errors.push(`empty segment ${seg.moduleId}`);
    prevEnd = seg.y1;
    const segHaz = seg.entities.filter((e): e is HazardSpec => e.t === 'hazard');
    for (const e of seg.entities) {
      const ey = e.t === 'hazard' ? hazardYRange(e)[0] : e.t === 'pad' ? e.y0 : e.y;
      if (ey < seg.y0 - 1 || ey > seg.y1 + 1) errors.push(`entity outside segment ${seg.moduleId} at y=${ey}`);
      if (e.t === 'gate') {
        if (!(e.x1 > e.x0) || e.x0 < -H - 1 || e.x1 > H + 1) errors.push(`bad gate bounds in ${seg.moduleId}`);
        for (const h of segHaz) {
          if (h.motion || h.shape.shape !== 'rect') continue;
          const s = h.shape;
          if (e.y >= s.y0 && e.y <= s.y1 && e.x0 < s.x1 && e.x1 > s.x0) errors.push(`gate buried in wall in ${seg.moduleId}`);
        }
      }
    }
    if (segHaz.length > 0) {
      const t0 = timeAt(seg.y0, plan.baseSpeed, zones);
      if (prevNeedsRecovery) errors.push(`no recovery before ${seg.moduleId}`);
      const gap = t0 - lastHazardEndT;
      if (gap < minHazardGapSeconds(D) - 1e-6) errors.push(`reaction time ${gap.toFixed(2)}s too short before ${seg.moduleId}`);
      lastHazardEndT = timeAt(seg.y1, plan.baseSpeed, zones);
      hazards.push(...segHaz);
    }
    prevNeedsRecovery = seg.needsRecoveryAfter;
    if (seg.rating > maxRatingForD(D) + 1e-6) errors.push(`rating ${seg.rating.toFixed(1)} too high for D=${D.toFixed(1)} (${seg.moduleId})`);
    if (seg.rating >= 1.5) {
      if (seg.rating - prevChallenge > TUNING.fairness.maxSpikeDelta + 1e-6) errors.push(`difficulty spike into ${seg.moduleId}`);
      prevChallenge = seg.rating;
    }
    if (seg.armyTypical < TUNING.fairness.minTypicalArmy) errors.push(`army collapses after ${seg.moduleId} (${seg.armyTypical.toFixed(1)})`);
  }
  if (plan.finale.y < prevEnd) errors.push('finale overlaps last segment');

  const reach = sweepReachability(hazards, fullTrackInterval(), 0, plan.finale.y, plan.baseSpeed, zones);
  if (!reach.ok) errors.push(`no safe path at y=${reach.failY}`);

  const dmgBest = finaleDamage(plan.expected.armyBest, plan.player, plan.finale.atk);
  if (dmgBest < plan.finale.hp * TUNING.difficulty.finaleWinMargin * 0.999) {
    errors.push(`finale unbeatable: best dmg ${dmgBest.toFixed(0)} < hp ${plan.finale.hp.toFixed(0)}`);
  }
  return { ok: errors.length === 0, errors };
}

export function segmentHazards(seg: SegmentPlan): HazardSpec[] {
  return seg.entities.filter((e): e is HazardSpec => e.t === 'hazard');
}
