import type { HazardSpec } from '../gen/types';
import { distSqPointSegment } from '../core/math';

/**
 * Shared, deterministic hazard geometry. Used by BOTH the runtime collision
 * code and the fairness validator, so what the validator proves safe is
 * exactly what the player experiences.
 */

const frac = (v: number): number => v - Math.floor(v);

/** Crusher slam profile: open → close → hold → open. Returns 0..1 closure. */
export function slamProfile(f: number): number {
  if (f < 0.55) return 0;
  if (f < 0.68) {
    const k = (f - 0.55) / 0.13;
    return k * k;
  }
  if (f < 0.8) return 1;
  if (f < 0.95) return 1 - (f - 0.8) / 0.15;
  return 0;
}

export function hazardOffsetX(h: HazardSpec, t: number): number {
  const m = h.motion;
  if (!m) return 0;
  const f = frac(t / m.period + m.phase);
  if (m.type === 'sine') return m.amp * Math.sin(f * Math.PI * 2);
  return m.amp * slamProfile(f);
}

/** 0..1 how "about to slam" a crusher is (for telegraph rendering). */
export function hazardSlamWarn(h: HazardSpec, t: number): number {
  const m = h.motion;
  if (!m || m.type !== 'slam') return 0;
  const f = frac(t / m.period + m.phase);
  if (f >= 0.35 && f < 0.55) return (f - 0.35) / 0.2;
  return 0;
}

export function hazardActive(h: HazardSpec, t: number): boolean {
  const c = h.cycle;
  if (!c) return true;
  const f = frac(t / c.period + c.phase);
  return f >= c.onFrom && f < c.onTo;
}

/** 0..1 warning intensity just before a cycled hazard turns on. */
export function hazardWarn(h: HazardSpec, t: number): number {
  const c = h.cycle;
  if (!c) return 0;
  if (hazardActive(h, t)) return 0;
  const f = frac(t / c.period + c.phase);
  let until = c.onFrom - f;
  if (until < 0) until += 1;
  const secs = until * c.period;
  if (secs > c.warn) return 0;
  return 1 - secs / c.warn;
}

export function capsuleEnds(h: HazardSpec & { shape: { shape: 'capsule' } }, t: number, out: Float64Array): void {
  const s = h.shape;
  const a = s.angle0 + s.angVel * t;
  const ox = hazardOffsetX(h, t);
  const hx = Math.cos(a) * s.len * 0.5;
  const hy = Math.sin(a) * s.len * 0.5;
  out[0] = s.cx + ox - hx;
  out[1] = s.cy - hy;
  out[2] = s.cx + ox + hx;
  out[3] = s.cy + hy;
}

const tmpEnds = new Float64Array(4);

export function hazardHitsCircle(h: HazardSpec, t: number, x: number, y: number, r: number): boolean {
  if (!hazardActive(h, t)) return false;
  const s = h.shape;
  const ox = hazardOffsetX(h, t);
  switch (s.shape) {
    case 'rect': {
      const x0 = s.x0 + ox;
      const x1 = s.x1 + ox;
      const nx = x < x0 ? x0 : x > x1 ? x1 : x;
      const ny = y < s.y0 ? s.y0 : y > s.y1 ? s.y1 : y;
      const dx = x - nx;
      const dy = y - ny;
      return dx * dx + dy * dy < r * r;
    }
    case 'circle': {
      const dx = x - (s.x + ox);
      const dy = y - s.y;
      const rr = s.r + r;
      return dx * dx + dy * dy < rr * rr;
    }
    case 'capsule': {
      capsuleEnds(h as never, t, tmpEnds);
      const rr = s.thick * 0.5 + r;
      return distSqPointSegment(x, y, tmpEnds[0], tmpEnds[1], tmpEnds[2], tmpEnds[3]) < rr * rr;
    }
  }
}

/** Conservative world-y extent of a hazard (including rotation). */
export function hazardYRange(h: HazardSpec): [number, number] {
  const s = h.shape;
  switch (s.shape) {
    case 'rect':
      return [s.y0, s.y1];
    case 'circle':
      return [s.y - s.r, s.y + s.r];
    case 'capsule':
      return [s.cy - s.len * 0.5 - s.thick, s.cy + s.len * 0.5 + s.thick];
  }
}

/**
 * Push x-intervals (pairs) blocked for a disc of radius R centred anywhere on
 * the horizontal band [y-halfBand, y+halfBand] at time t.
 */
export function hazardBlockedIntervals(h: HazardSpec, t: number, y: number, halfBand: number, R: number, out: number[]): void {
  if (!hazardActive(h, t)) return;
  const s = h.shape;
  const ox = hazardOffsetX(h, t);
  switch (s.shape) {
    case 'rect': {
      if (y + halfBand + R <= s.y0 || y - halfBand - R >= s.y1) return;
      out.push(s.x0 + ox - R, s.x1 + ox + R);
      return;
    }
    case 'circle': {
      chord(s.x + ox, s.y, s.r + R, y, halfBand, out);
      return;
    }
    case 'capsule': {
      capsuleEnds(h as never, t, tmpEnds);
      const re = s.thick * 0.5 + R;
      const steps = Math.max(2, Math.ceil(s.len / 6));
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        chord(tmpEnds[0] + (tmpEnds[2] - tmpEnds[0]) * k, tmpEnds[1] + (tmpEnds[3] - tmpEnds[1]) * k, re, y, halfBand, out);
      }
    }
  }
}

function chord(cx: number, cy: number, r: number, y: number, halfBand: number, out: number[]): void {
  let dy = Math.abs(cy - y) - halfBand;
  if (dy < 0) dy = 0;
  if (dy >= r) return;
  const hc = Math.sqrt(r * r - dy * dy);
  out.push(cx - hc, cx + hc);
}

/** Merge a flat list of [a,b] pairs into sorted disjoint intervals. */
export function mergeIntervals(flat: number[]): number[] {
  const n = flat.length / 2;
  if (n <= 1) return flat.slice();
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => flat[a * 2] - flat[b * 2]);
  const res: number[] = [];
  let cs = flat[idx[0] * 2];
  let ce = flat[idx[0] * 2 + 1];
  for (let k = 1; k < n; k++) {
    const s = flat[idx[k] * 2];
    const e = flat[idx[k] * 2 + 1];
    if (s <= ce) {
      if (e > ce) ce = e;
    } else {
      res.push(cs, ce);
      cs = s;
      ce = e;
    }
  }
  res.push(cs, ce);
  return res;
}

/** Complement of blocked intervals inside [lo, hi]. */
export function complementIntervals(blockedMerged: number[], lo: number, hi: number): number[] {
  const res: number[] = [];
  let cur = lo;
  for (let i = 0; i < blockedMerged.length; i += 2) {
    const s = blockedMerged[i];
    const e = blockedMerged[i + 1];
    if (e <= cur) continue;
    if (s >= hi) break;
    if (s > cur) res.push(cur, Math.min(s, hi));
    cur = Math.max(cur, e);
    if (cur >= hi) break;
  }
  if (cur < hi) res.push(cur, hi);
  return res;
}
