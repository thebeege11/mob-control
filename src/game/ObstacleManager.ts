import { TUNING } from '../config/tuning';
import type { Rng } from '../core/rng';
import type { GateKind, GateSpec, HazardSpec, LevelPlan, PickupSpec } from '../gen/types';
import { Gate, Hazard, Pickup } from './entities';
import { hazardHitsCircle, hazardOffsetX, hazardYRange } from './hazardGeometry';
import { Ev, type EventQueue } from './SimEvents';
import type { UnitManager } from './UnitManager';

const W = TUNING.world;

interface HazardSegment {
  y0: number;
  y1: number;
  deaths: number;
  soldiersAtStart: number;
  nearMiss: boolean;
  started: boolean;
  resolved: boolean;
}

interface GateRow {
  y: number;
  gates: Gate[];
  resolved: boolean;
}

export interface ObstacleHooks {
  invulnerable: () => boolean;
  gateBonus: number;
  onGateRow: (gain: number, loss: number, x: number, y: number) => void;
  onHazardSegment: (perfect: boolean, nearMiss: boolean, lossFrac: number, x: number, y: number) => void;
  onPickup: (p: Pickup) => void;
}

/** Current gate kind/value/x-range given motion & blink at time t. */
export function gateStateAt(spec: GateSpec, t: number, out: { kind: GateKind; value: number; x0: number; x1: number }): void {
  let ox = 0;
  if (spec.motion) ox = spec.motion.amp * Math.sin((t / spec.motion.period + spec.motion.phase) * Math.PI * 2);
  out.x0 = spec.x0 + ox;
  out.x1 = spec.x1 + ox;
  out.kind = spec.kind;
  out.value = spec.value;
  if (spec.blink) {
    const f = t / spec.blink.period + spec.blink.phase;
    if (f - Math.floor(f) >= 1 - spec.blink.duty) {
      out.kind = spec.blink.kind2;
      out.value = spec.blink.value2;
    }
  }
}

/** Gates, hazards, pickups and speed pads. */
export class ObstacleManager {
  gates: Gate[] = [];
  hazards: Hazard[] = [];
  pickups: Pickup[] = [];
  rows: GateRow[] = [];
  private segs: HazardSegment[] = [];
  private gateCursor = 0;
  private hazCursor = 0;
  private tmp = { kind: 'add' as GateKind, value: 0, x0: 0, x1: 0 };
  soldiersLostToHazards = 0;
  soldiersLostToGates = 0;
  soldiersGained = 0;

  constructor(private events: EventQueue) {}

  load(plan: LevelPlan): void {
    this.gates = [];
    this.hazards = [];
    this.pickups = [];
    this.rows = [];
    this.segs = [];
    this.gateCursor = 0;
    this.hazCursor = 0;
    this.soldiersLostToHazards = 0;
    this.soldiersLostToGates = 0;
    this.soldiersGained = 0;
    const rowMap = new Map<number, GateRow>();
    plan.segments.forEach((seg) => {
      let segIdx = -1;
      for (const e of seg.entities) {
        if (e.t === 'gate') {
          const g = new Gate();
          g.spec = e;
          g.y = e.y;
          g.x0 = e.x0;
          g.x1 = e.x1;
          g.kind = e.kind;
          g.value = e.value;
          g.pool = e.value;
          const key = Math.round(e.y);
          let row = rowMap.get(key);
          if (!row) {
            row = { y: e.y, gates: [], resolved: false };
            rowMap.set(key, row);
            this.rows.push(row);
          }
          g.row = this.rows.indexOf(row);
          row.gates.push(g);
          this.gates.push(g);
        } else if (e.t === 'hazard') {
          if (segIdx < 0) {
            segIdx = this.segs.length;
            this.segs.push({ y0: Infinity, y1: -Infinity, deaths: 0, soldiersAtStart: 0, nearMiss: false, started: false, resolved: false });
          }
          const h = new Hazard();
          h.spec = e;
          const [a, b] = hazardYRange(e);
          h.y0 = a;
          h.y1 = b;
          h.segment = segIdx;
          const s = this.segs[segIdx];
          s.y0 = Math.min(s.y0, a);
          s.y1 = Math.max(s.y1, b);
          this.hazards.push(h);
        } else if (e.t === 'pickup') {
          this.pickups.push(makePickup(e));
        }
      }
    });
    this.gates.sort((a, b) => a.y - b.y);
    this.hazards.sort((a, b) => a.y0 - b.y0);
    this.rows.sort((a, b) => a.y - b.y);
    this.pickups.sort((a, b) => a.y - b.y);
  }

  gateView(g: Gate, t: number): { kind: GateKind; value: number; x0: number; x1: number } {
    gateStateAt(g.spec, t, this.tmp);
    return this.tmp;
  }

  hazardX(h: HazardSpec, t: number): number {
    return hazardOffsetX(h, t);
  }

  update(dt: number, t: number, units: UnitManager, rng: Rng, hooks: ObstacleHooks): void {
    const cy = units.cy;
    const lookBack = cy - 260;
    const lookAhead = cy + 220;
    const invuln = hooks.invulnerable();

    // ---- Gates ----
    while (this.gateCursor < this.gates.length && this.gates[this.gateCursor].y < lookBack) this.gateCursor++;
    for (let gi = this.gateCursor; gi < this.gates.length; gi++) {
      const g = this.gates[gi];
      if (g.y > lookAhead) break;
      if (g.flash > 0) g.flash -= dt;
      gateStateAt(g.spec, t, this.tmp);
      g.x0 = this.tmp.x0;
      g.x1 = this.tmp.x1;
      g.kind = this.tmp.kind;
      g.value = this.tmp.value;
      const n = units.count;
      for (let k = 0; k < n; k++) {
        const u = units.units[k];
        if (!u.alive || !(u.prevY < g.y && u.y >= g.y) || u.x < g.x0 || u.x > g.x1) continue;
        this.applyGate(g, u, units, rng, hooks.gateBonus);
      }
    }
    units.compact();

    // Gate rows resolve once the swarm is through.
    const rad = units.radius();
    for (const row of this.rows) {
      if (row.resolved) continue;
      if (row.y > cy - rad * 0.8 - 12) break;
      row.resolved = true;
      let gain = 0;
      let loss = 0;
      let x = 0;
      let hit = 0;
      for (const g of row.gates) {
        if (g.delta > 0) gain += g.delta;
        if (g.delta < 0) loss -= g.delta;
        if (g.delta !== 0) {
          x += (g.x0 + g.x1) / 2;
          hit++;
          g.passed = true;
        }
      }
      if (hit > 0) hooks.onGateRow(gain, loss, x / hit, row.y);
    }

    // ---- Hazards ----
    while (this.hazCursor < this.hazards.length && this.hazards[this.hazCursor].y1 < lookBack) this.hazCursor++;
    for (let hi = this.hazCursor; hi < this.hazards.length; hi++) {
      const h = this.hazards[hi];
      if (h.y0 > lookAhead) break;
      if (h.flash > 0) h.flash -= dt;
      const seg = this.segs[h.segment];
      for (let k = 0; k < units.count; k++) {
        const u = units.units[k];
        if (!u.alive) continue;
        if (u.y + u.radius + 8 < h.y0 || u.y - u.radius - 8 > h.y1) continue;
        if (hazardHitsCircle(h.spec, t, u.x, u.y, u.radius)) {
          if (invuln) continue;
          const w = u.weight;
          this.soldiersLostToHazards += w;
          seg.deaths += w;
          h.flash = 0.12;
          this.events.push(Ev.UnitDie, u.x, u.y, w, 0);
          units.kill(u);
        } else if (!seg.nearMiss && hazardHitsCircle(h.spec, t, u.x, u.y, u.radius + 7)) {
          seg.nearMiss = true;
        }
      }
    }
    units.compact();

    // Hazard segments resolve after the swarm passes.
    for (const s of this.segs) {
      if (s.resolved) continue;
      if (!s.started && cy + rad >= s.y0) {
        s.started = true;
        s.soldiersAtStart = Math.max(1, units.soldiers);
      }
      if (s.started && cy - rad > s.y1) {
        s.resolved = true;
        hooks.onHazardSegment(s.deaths === 0, s.nearMiss, s.deaths / s.soldiersAtStart, units.cx, s.y1);
      }
    }

    // ---- Pickups ----
    const r2 = (W.unitRadius + 11) * (W.unitRadius + 11);
    const minX = units.cx - rad - 20;
    const maxX = units.cx + rad + 20;
    for (const p of this.pickups) {
      if (p.taken) continue;
      if (p.y > lookAhead) break;
      p.age += dt;
      if (p.y < lookBack || p.x < minX || p.x > maxX) continue;
      for (let k = 0; k < units.count; k++) {
        const u = units.units[k];
        const dx = u.x - p.x;
        const dy = u.y - p.y;
        if (dx * dx + dy * dy < r2 + u.radius * u.radius) {
          p.taken = true;
          hooks.onPickup(p);
          break;
        }
      }
    }
  }

  private applyGate(g: Gate, u: import('./entities').Unit, units: UnitManager, rng: Rng, gateBonus: number): void {
    if (!g.triggered) {
      g.triggered = true;
      this.events.push(g.kind === 'add' || g.kind === 'mul' ? Ev.Gate : Ev.GateBad, (g.x0 + g.x1) / 2, g.y, 0, 0);
    }
    g.flash = 0.1;
    switch (g.kind) {
      case 'mul': {
        g.acc += (g.value - 1) * u.weight * (1 + gateBonus);
        const n = Math.floor(g.acc);
        g.acc -= n;
        if (n > 0) {
          units.addSoldiers(n, u.x, g.y + 3, rng);
          g.delta += n;
          this.soldiersGained += n;
          this.events.push(Ev.UnitSpawn, u.x, g.y, n);
        }
        break;
      }
      case 'add': {
        if (g.pool > 0) {
          const n = Math.round(g.pool * (1 + gateBonus));
          g.pool = 0;
          units.addSoldiers(n, u.x, g.y + 3, rng);
          g.delta += n;
          this.soldiersGained += n;
          this.events.push(Ev.UnitSpawn, u.x, g.y, n);
        }
        break;
      }
      case 'sub': {
        if (g.pool > 0) {
          const removed = units.removeSoldiers(u, g.pool);
          g.pool -= removed;
          g.delta -= removed;
          this.soldiersLostToGates += removed;
          this.events.push(Ev.UnitDie, u.x, u.y, removed, 2);
        }
        break;
      }
      case 'div': {
        g.acc += u.weight / 2;
        const n = Math.floor(g.acc);
        g.acc -= n;
        if (n > 0) {
          const removed = units.removeSoldiers(u, n);
          g.delta -= removed;
          this.soldiersLostToGates += removed;
          this.events.push(Ev.UnitDie, u.x, u.y, removed, 2);
        }
        break;
      }
    }
  }
}

function makePickup(s: PickupSpec): Pickup {
  const p = new Pickup();
  p.kind = s.kind;
  p.x = s.x;
  p.y = s.y;
  return p;
}
