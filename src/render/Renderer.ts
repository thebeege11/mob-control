/**
 * Renderer — draws the Simulation with a pseudo-3D perspective on Canvas2D.
 * Read-only with respect to game state. Performance notes:
 *  - sprites are pre-rendered (drawImage only)
 *  - a single reusable draw list, insertion-sorted (nearly sorted each frame)
 *  - unit shadows batched into one path
 */
import { TUNING } from '../config/tuning';
import { clamp, easeOutBack, formatNum } from '../core/math';
import type { Gate, Hazard } from '../game/entities';
import { BOSS_NAMES } from '../game/FinaleController';
import { capsuleEnds, hazardActive, hazardOffsetX, hazardSlamWarn, hazardWarn } from '../game/hazardGeometry';
import { gateStateAt } from '../game/ObstacleManager';
import type { Simulation } from '../game/Simulation';
import type { GateKind } from '../gen/types';
import { Camera, type Projected } from './Camera';
import { FloatingText, setFont } from './FloatingText';
import type { Particles } from './Particles';
import { SpriteBank, roundRect } from './sprites';
import { COLORS, type Theme } from './theme';

const H = TUNING.world.trackHalfWidth;
const MAX_Z = 2600;

export interface HudState {
  score: number;
  multiplier: number;
  combo: number;
  surgeMeter: number;
  surgeActive: number;
  surgeUnlocked: boolean;
  soldiers: number;
  countPop: number;
  hint: string;
  hintTime: number;
  level: number;
  bestProgress: number;
  coins: number;
  leftHanded: boolean;
  safeTop: number;
  safeBottom: number;
  daily: boolean;
}

export interface RenderView {
  sim: Simulation;
  time: number;
  theme: Theme;
  hud: HudState | null;
  flash: number;
  flashColor: string;
  surgeTint: number;
}

const enum DK {
  Unit,
  Enemy,
  Gate,
  Hazard,
  Pickup,
  Finale,
}

const P = (): Projected => ({ x: 0, y: 0, s: 1, visible: true });

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly cam = new Camera();
  readonly sprites = new SpriteBank();
  readonly texts = new FloatingText();
  private dpr = 1;
  private keys: Float64Array = new Float64Array(2048);
  private kinds: Uint8Array = new Uint8Array(2048);
  private idx: Int32Array = new Int32Array(2048);
  private order: Int32Array = new Int32Array(2048);
  private n = 0;
  private p0 = P();
  private p1 = P();
  private p2 = P();
  private p3 = P();
  private p4 = P();
  private p5 = P();
  private p6 = P();
  private p7 = P();
  private tmpGate = { kind: 'add' as GateKind, value: 0, x0: 0, x1: 0 };
  private ends = new Float64Array(4);
  private bgGrad: CanvasGradient | null = null;
  private bgTheme: Theme | null = null;
  private stripePattern: CanvasPattern | null = null;
  private groupX: number[] = [];
  private groupY: number[] = [];
  private groupN: number[] = [];
  private groupSeen: number[] = [];
  /** Surge button hit-area (screen px) for input. */
  surgeButton = { x: 0, y: 0, r: 40 };

  constructor(private canvas: HTMLCanvasElement, public particles: Particles) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.resize(w, h);
    this.bgTheme = null;
  }

  render(v: RenderView): void {
    const ctx = this.ctx;
    const cam = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(v.theme, v.time);
    this.drawTrack(v);
    this.drawShadows(v.sim);
    this.buildDrawList(v.sim);
    for (let k = 0; k < this.n; k++) {
      const o = this.order[k];
      switch (this.kinds[o]) {
        case DK.Unit:
          this.drawUnit(v, this.idx[o]);
          break;
        case DK.Enemy:
          this.drawEnemy(v, this.idx[o]);
          break;
        case DK.Gate:
          this.drawGate(v, v.sim.obstacles.gates[this.idx[o]]);
          break;
        case DK.Hazard:
          this.drawHazard(v, v.sim.obstacles.hazards[this.idx[o]]);
          break;
        case DK.Pickup:
          this.drawPickup(v, this.idx[o]);
          break;
        case DK.Finale:
          this.drawFinale(v);
          break;
      }
    }
    this.drawGroupLabels(v.sim);
    this.particles.draw(ctx, cam);
    this.texts.draw(ctx, cam);
    if (v.surgeTint > 0) this.drawSurgeVignette(v.surgeTint, v.time);
    if (v.flash > 0) {
      ctx.globalAlpha = clamp(v.flash, 0, 0.8);
      ctx.fillStyle = v.flashColor;
      ctx.fillRect(0, 0, cam.W, cam.H);
      ctx.globalAlpha = 1;
    }
    if (v.hud) this.drawHud(v, v.hud);
  }

  // ------------------------------------------------------------ background & track

  private drawBackground(theme: Theme, time: number): void {
    const ctx = this.ctx;
    const { W, H: SH } = this.cam;
    if (this.bgTheme !== theme || !this.bgGrad) {
      this.bgGrad = ctx.createLinearGradient(0, 0, 0, SH);
      this.bgGrad.addColorStop(0, theme.bgTop);
      this.bgGrad.addColorStop(0.55, theme.bgBottom);
      this.bgGrad.addColorStop(1, theme.bgBottom);
      this.bgTheme = theme;
      this.stripePattern = ctx.createPattern(this.sprites.hazardStripes, 'repeat');
    }
    ctx.fillStyle = this.bgGrad;
    ctx.fillRect(0, 0, W, SH);
    // Floating bubbles for depth (cheap parallax decoration).
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 9; i++) {
      const bx = ((i * 97.3 + time * (6 + i)) % (W + 80)) - 40;
      const by = SH * (0.05 + ((i * 0.137) % 0.4)) + Math.sin(time * 0.6 + i) * 8;
      ctx.beginPath();
      ctx.arc(bx, by, 10 + (i % 4) * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTrack(v: RenderView): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const th = v.theme;
    const tile = 80;
    const startY = Math.floor((cam.camY - 200) / tile) * tile;
    const endY = Math.min(cam.camY + MAX_Z, v.sim.plan.finale.y + 700);
    const a = this.p0;
    const b = this.p1;
    const c = this.p2;
    const d = this.p3;
    // Draw far → near so near tiles overlap far ones.
    for (let y = Math.floor(endY / tile) * tile; y >= startY; y -= tile) {
      cam.project(-H, y, 0, a);
      cam.project(H, y, 0, b);
      cam.project(H, y + tile, 0, c);
      cam.project(-H, y + tile, 0, d);
      if (!a.visible || !d.visible) continue;
      ctx.fillStyle = (y / tile) % 2 === 0 ? th.trackA : th.trackB;
      quad(ctx, a, b, c, d);
      ctx.fill();
      // Rails
      for (const side of [-1, 1]) {
        const x0 = side * H;
        const x1 = side * (H + 14);
        cam.project(x0, y, 0, a);
        cam.project(x1, y, 0, b);
        cam.project(x1, y + tile, 0, c);
        cam.project(x0, y + tile, 0, d);
        ctx.fillStyle = (y / tile) % 2 === 0 ? th.rail : th.railDark;
        quad(ctx, a, b, c, d);
        ctx.fill();
        // Rail front face (height)
        cam.project(x0, y, 0, a);
        cam.project(x0, y, 12, b);
        cam.project(x0, y + tile, 12, c);
        cam.project(x0, y + tile, 0, d);
        ctx.fillStyle = th.railDark;
        quad(ctx, a, b, c, d);
        ctx.fill();
      }
    }
    // Speed pads
    for (const z of v.sim.plan.speedZones) {
      if (z.y1 < cam.camY - 100 || z.y0 > cam.camY + MAX_Z) continue;
      for (let y = z.y0; y < z.y1; y += 60) {
        const off = (v.time * 180) % 60;
        const yy = y + off;
        cam.project(-60, yy, 0.5, a);
        cam.project(0, yy + 30, 0.5, b);
        cam.project(60, yy, 0.5, c);
        if (!a.visible) continue;
        ctx.strokeStyle = 'rgba(255,212,0,0.9)';
        ctx.lineWidth = Math.max(2, 8 * b.s);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    }
    // Finish line
    const fy = v.sim.plan.finale.y - 90;
    if (fy > cam.camY - 100 && fy < cam.camY + MAX_Z) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < 2; r++) {
          const x0 = -H + (i * 2 * H) / n;
          cam.project(x0, fy + r * 14, 0.3, a);
          cam.project(x0 + (2 * H) / n, fy + r * 14, 0.3, b);
          cam.project(x0 + (2 * H) / n, fy + r * 14 + 14, 0.3, c);
          cam.project(x0, fy + r * 14 + 14, 0.3, d);
          ctx.fillStyle = (i + r) % 2 === 0 ? '#1d1433' : '#ffffff';
          quad(ctx, a, b, c, d);
          ctx.fill();
        }
      }
    }
  }

  private drawShadows(sim: Simulation): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const p = this.p0;
    ctx.fillStyle = 'rgba(40,20,80,0.18)';
    ctx.beginPath();
    const u = sim.units;
    for (let i = 0; i < u.count; i++) {
      const un = u.units[i];
      cam.project(un.x, un.y, 0, p);
      if (!p.visible) continue;
      const r = un.radius * 1.2 * p.s;
      ctx.moveTo(p.x + r, p.y);
      ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2);
    }
    const e = sim.enemies;
    for (let i = 0; i < e.count; i++) {
      const en = e.pool[i];
      if (!en.alive || !en.active) continue;
      const z = cam.depth(en.y);
      if (z > MAX_Z || z < -100) continue;
      cam.project(en.x, en.y, 0, p);
      const r = en.r * 1.1 * p.s;
      ctx.moveTo(p.x + r, p.y);
      ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // ------------------------------------------------------------ draw list

  private push(key: number, kind: DK, idx: number): void {
    if (this.n >= this.keys.length) return;
    this.keys[this.n] = key;
    this.kinds[this.n] = kind;
    this.idx[this.n] = idx;
    this.order[this.n] = this.n;
    this.n++;
  }

  private buildDrawList(sim: Simulation): void {
    this.n = 0;
    const cam = this.cam;
    const lo = cam.camY - 150;
    const hi = cam.camY + MAX_Z;
    const u = sim.units;
    for (let i = 0; i < u.count; i++) this.push(u.units[i].y, DK.Unit, i);
    const e = sim.enemies;
    for (let i = 0; i < e.count; i++) {
      const en = e.pool[i];
      if (en.alive && en.y > lo && en.y < hi) this.push(en.y, DK.Enemy, i);
    }
    const o = sim.obstacles;
    for (let i = 0; i < o.gates.length; i++) {
      const g = o.gates[i];
      if (g.y > lo && g.y < hi) this.push(g.y, DK.Gate, i);
    }
    for (let i = 0; i < o.hazards.length; i++) {
      const h = o.hazards[i];
      if (h.y1 > lo && h.y0 < hi) this.push(h.y0, DK.Hazard, i);
    }
    for (let i = 0; i < o.pickups.length; i++) {
      const p = o.pickups[i];
      if (!p.taken && p.y > lo && p.y < hi) this.push(p.y, DK.Pickup, i);
    }
    const f = sim.finale.f;
    if (f.y < hi) this.push(f.y + 1, DK.Finale, 0);
    // Insertion sort by key descending (far first). Nearly sorted → ~O(n).
    const ord = this.order;
    const keys = this.keys;
    for (let i = 1; i < this.n; i++) {
      const v = ord[i];
      const k = keys[v];
      let j = i - 1;
      while (j >= 0 && keys[ord[j]] < k) {
        ord[j + 1] = ord[j];
        j--;
      }
      ord[j + 1] = v;
    }
  }

  // ------------------------------------------------------------ entities

  private drawUnit(v: RenderView, i: number): void {
    const sim = v.sim;
    const u = sim.units.units[i];
    const p = this.cam.project(u.x, u.y, 0, this.p0);
    if (!p.visible) return;
    const bob = Math.abs(Math.sin(v.time * 14 + i * 1.7)) * 2.2;
    const pop = u.age < 0.25 ? easeOutBack(u.age / 0.25) : 1;
    const r = u.radius * 1.3 * pop;
    const size = r * 2 * p.s;
    const cy = p.y - (r + bob) * p.s;
    const ctx = this.ctx;
    if (sim.ability.active > 0) {
      ctx.fillStyle = 'rgba(255,225,77,0.45)';
      ctx.beginPath();
      ctx.arc(p.x, cy, size * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    const img = u.champion ? this.sprites.champion : this.sprites.blip;
    const sc = u.champion ? 1.6 : 1;
    // Squash & stretch on the bob.
    const stretch = 1 + (bob / 2.2 - 0.5) * 0.12;
    const w = size * sc / stretch;
    const h = size * sc * stretch;
    ctx.drawImage(img, p.x - w / 2, cy - h / 2, w, h);
    if (u.hurt > 0) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, cy, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (u.weight > 1 && p.s > 0.6) {
      setFont(ctx, Math.max(8, 9 * p.s));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      const t = String(u.weight);
      ctx.strokeText(t, p.x, cy + h * 0.28);
      ctx.fillText(t, p.x, cy + h * 0.28);
    }
  }

  private drawEnemy(v: RenderView, i: number): void {
    const e = v.sim.enemies.pool[i];
    const p = this.cam.project(e.x, e.y, 0, this.p0);
    if (!p.visible) return;
    const ctx = this.ctx;
    if (e.kind === 'crate' || e.kind === 'gemcrate') {
      const gem = e.kind === 'gemcrate';
      const s = e.r;
      const shake = e.flash > 0 ? Math.sin(v.time * 90) * 2 : 0;
      this.box(e.x - s + shake, e.x + s + shake, e.y - s, e.y + s, s * 1.6, gem ? '#7df0ff' : COLORS.crate, gem ? '#1ea9c9' : COLORS.crateDark, gem ? '#159ab8' : '#8e4f19');
      const top = this.cam.project(e.x, e.y, s * 1.6 + 8, this.p1);
      const img = gem ? this.sprites.gem : this.sprites.coin;
      const sz = 16 * top.s;
      ctx.drawImage(img, top.x - sz / 2, top.y - sz / 2, sz, sz);
      if (e.hp < e.maxHp) this.hpBar(top.x, top.y - 14 * top.s, 30 * top.s, e.hp / e.maxHp, COLORS.coin);
      return;
    }
    const isBrute = e.kind === 'brute';
    const img = isBrute ? this.sprites.brute : this.sprites.grunt;
    const wob = Math.sin(v.time * 10 + i) * 0.08;
    const r = e.r * (isBrute ? 1.55 : 1.45);
    const size = r * 2 * p.s;
    const cy = p.y - r * p.s * 0.95;
    ctx.save();
    ctx.translate(p.x, cy);
    ctx.rotate(e.aggro ? wob : 0);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    if (e.flash > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (isBrute && e.hp < e.maxHp) this.hpBar(p.x, cy - size * 0.62, 40 * p.s, e.hp / e.maxHp, COLORS.enemy);
  }

  private drawGroupLabels(sim: Simulation): void {
    const e = sim.enemies;
    const gx = this.groupX;
    const gy = this.groupY;
    const gn = this.groupN;
    const seen = this.groupSeen;
    seen.length = 0;
    for (let i = 0; i < e.count; i++) {
      const en = e.pool[i];
      if (!en.alive || en.kind !== 'grunt' || en.spawned) continue;
      const z = this.cam.depth(en.y);
      if (z > 1500 || z < 0) continue;
      const g = en.group;
      if (gn[g] === undefined || !seen.includes(g)) {
        seen.push(g);
        gx[g] = 0;
        gy[g] = -Infinity;
        gn[g] = 0;
      }
      gx[g] += en.x;
      gy[g] = Math.max(gy[g], en.y);
      gn[g]++;
    }
    const ctx = this.ctx;
    for (const g of seen) {
      if (gn[g] < 2) continue;
      const p = this.cam.project(gx[g] / gn[g], gy[g], 34, this.p0);
      if (!p.visible) continue;
      const txt = String(gn[g]);
      const fs = Math.max(11, 17 * p.s);
      setFont(ctx, fs);
      const w = ctx.measureText(txt).width + fs * 0.9;
      ctx.fillStyle = COLORS.enemyDark;
      roundRect(ctx, p.x - w / 2, p.y - fs * 0.7, w, fs * 1.4, fs * 0.7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, p.x, p.y + 1);
    }
  }

  private drawGate(v: RenderView, g: Gate): void {
    const st = this.tmpGate;
    gateStateAt(g.spec, v.sim.time, st);
    const positive = st.kind === 'add' || st.kind === 'mul';
    const cam = this.cam;
    const hgt = 52;
    const a = cam.project(st.x0, g.y, 0, this.p0);
    const b = cam.project(st.x1, g.y, 0, this.p1);
    const c = cam.project(st.x1, g.y, hgt, this.p2);
    const d = cam.project(st.x0, g.y, hgt, this.p3);
    if (!a.visible) return;
    const ctx = this.ctx;
    const used = g.passed;
    const base = positive ? COLORS.good : COLORS.bad;
    ctx.globalAlpha = used ? 0.18 : 0.42 + (g.flash > 0 ? 0.3 : 0);
    ctx.fillStyle = base;
    quad(ctx, a, b, c, d);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Frame
    ctx.strokeStyle = positive ? COLORS.goodLight : COLORS.badLight;
    ctx.lineWidth = Math.max(2, 5 * a.s);
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    // Posts
    for (const pp of [a, b]) {
      const top = pp === a ? d : c;
      ctx.strokeStyle = positive ? '#1f6fd1' : '#c21d4a';
      ctx.lineWidth = Math.max(3, 8 * pp.s);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pp.x, pp.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }
    // Label
    const label = gateLabel(st.kind, st.kind === 'sub' ? g.pool : st.value, g.triggered && st.kind === 'add');
    const m = cam.project((st.x0 + st.x1) / 2, g.y, hgt * 0.5, this.p4);
    const fsRaw = Math.min(46, 30 * m.s * Math.min(1, (st.x1 - st.x0) / 90));
    if (fsRaw < 6) return; // unreadably far: skip text entirely
    const fs = setFont(ctx, Math.max(8, fsRaw));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = fs * 0.16;
    ctx.strokeStyle = 'rgba(15,10,40,0.7)';
    ctx.strokeText(label, m.x, m.y);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, m.x, m.y);
    if (g.spec.blink) {
      // Swap indicator dots
      const f = v.sim.time / g.spec.blink.period + g.spec.blink.phase;
      const frac = f - Math.floor(f);
      ctx.fillStyle = COLORS.warn;
      ctx.beginPath();
      ctx.arc(m.x, m.y + fs * 0.75, fs * 0.12 * (0.6 + frac), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHazard(v: RenderView, h: Hazard): void {
    const spec = h.spec;
    const t = v.sim.time;
    const ctx = this.ctx;
    const cam = this.cam;
    const s = spec.shape;
    const ox = hazardOffsetX(spec, t);
    const flash = h.flash > 0;
    if (s.shape === 'rect') {
      const x0 = Math.max(-H - 14, s.x0 + ox);
      const x1 = Math.min(H + 14, s.x1 + ox);
      if (x1 <= x0) return;
      switch (spec.kind) {
        case 'laser': {
          const active = hazardActive(spec, t);
          const warn = hazardWarn(spec, t);
          const yc = (s.y0 + s.y1) / 2;
          // Emitters
          this.box(x0 - 2, x0 + 8, yc - 8, yc + 8, 26, '#5a4a7a', '#3a2d55', '#2b2140');
          this.box(x1 - 8, x1 + 2, yc - 8, yc + 8, 26, '#5a4a7a', '#3a2d55', '#2b2140');
          const a = cam.project(x0, yc, 14, this.p0);
          const b = cam.project(x1, yc, 14, this.p1);
          if (active) {
            ctx.strokeStyle = 'rgba(255,40,90,0.35)';
            ctx.lineWidth = Math.max(6, 18 * a.s);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.strokeStyle = flash ? '#fff' : '#ff2d6f';
            ctx.lineWidth = Math.max(2, 6 * a.s);
            ctx.stroke();
            ctx.strokeStyle = '#ffe0ea';
            ctx.lineWidth = Math.max(1, 2 * a.s);
            ctx.stroke();
          } else if (warn > 0) {
            ctx.strokeStyle = `rgba(255,60,110,${0.25 + 0.5 * warn * (0.5 + 0.5 * Math.sin(t * 40))})`;
            ctx.lineWidth = Math.max(1, 3 * a.s);
            ctx.setLineDash([8 * a.s, 6 * a.s]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            // Floor markings show where the beam will fire.
            const c = cam.project(x0, yc, 0, this.p2);
            const d = cam.project(x1, yc, 0, this.p3);
            ctx.strokeStyle = 'rgba(255,45,111,0.35)';
            ctx.lineWidth = Math.max(1, 4 * c.s);
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(d.x, d.y);
            ctx.stroke();
          }
          return;
        }
        case 'spikes': {
          this.box(x0, x1, s.y0, s.y1, 6, '#9aa0b5', '#6d7389', '#5b6076');
          // spike row
          const n = Math.max(2, Math.floor((x1 - x0) / 14));
          ctx.fillStyle = flash ? '#fff' : '#e8ebf5';
          ctx.strokeStyle = '#4b5066';
          ctx.lineWidth = 1;
          for (let k = 0; k < n; k++) {
            const cx = x0 + ((k + 0.5) * (x1 - x0)) / n;
            for (const yy of [s.y0 + 5, s.y1 - 5]) {
              const b0 = cam.project(cx - 6, yy, 6, this.p0);
              const b1 = cam.project(cx + 6, yy, 6, this.p1);
              const tp = cam.project(cx, yy, 20, this.p2);
              ctx.beginPath();
              ctx.moveTo(b0.x, b0.y);
              ctx.lineTo(tp.x, tp.y);
              ctx.lineTo(b1.x, b1.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
          return;
        }
        case 'crusher': {
          const warn = hazardSlamWarn(spec, t);
          const jitter = warn > 0 ? Math.sin(t * 60) * 2.5 * warn : 0;
          this.box(x0 + jitter, x1 + jitter, s.y0, s.y1, 44, flash ? '#fff' : '#5c4d80', '#3b2f5c', '#2b2140', true);
          if (warn > 0) {
            const edge = spec.motion && spec.motion.amp > 0 ? x1 : x0;
            const a = cam.project(edge, s.y0, 0, this.p0);
            const b = cam.project(edge, s.y1, 0, this.p1);
            ctx.strokeStyle = `rgba(255,212,0,${warn})`;
            ctx.lineWidth = Math.max(2, 6 * a.s);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
          return;
        }
        case 'sweeper': {
          this.box(x0, x1, s.y0, s.y1, 30, flash ? '#fff' : '#ff4fd8', '#b01e98', '#8c1479');
          const m = cam.project((x0 + x1) / 2, (s.y0 + s.y1) / 2, 30, this.p0);
          ctx.fillStyle = '#ffe3fa';
          ctx.beginPath();
          ctx.arc(m.x, m.y, 4 * m.s, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        case 'divider':
          this.box(x0, x1, s.y0, s.y1, 22, flash ? '#fff' : '#ff4fd8', '#b01e98', '#8c1479');
          return;
        default:
          this.box(x0, x1, s.y0, s.y1, 30, flash ? '#fff' : COLORS.hazardTop, COLORS.hazard, '#1d1530', true);
          return;
      }
    }
    if (s.shape === 'circle') {
      const p = cam.project(s.x + ox, s.y, 4, this.p0);
      if (!p.visible) return;
      const r = s.r * p.s;
      ctx.save();
      ctx.translate(p.x, p.y - r * 0.35);
      ctx.scale(1, 0.62);
      ctx.rotate(t * 9);
      ctx.drawImage(this.sprites.saw, -r * 1.05, -r * 1.05, r * 2.1, r * 2.1);
      ctx.restore();
      if (flash) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - r * 0.35, r, r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    // Spinner (capsule)
    capsuleEnds(spec as never, t, this.ends);
    const a = cam.project(this.ends[0], this.ends[1], 14, this.p0);
    const b = cam.project(this.ends[2], this.ends[3], 14, this.p1);
    const hub = cam.project(s.cx + ox, s.cy, 0, this.p2);
    const hubTop = cam.project(s.cx + ox, s.cy, 16, this.p3);
    ctx.strokeStyle = '#3a2d55';
    ctx.lineWidth = Math.max(3, 8 * hub.s);
    ctx.beginPath();
    ctx.moveTo(hub.x, hub.y);
    ctx.lineTo(hubTop.x, hubTop.y);
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.strokeStyle = flash ? '#fff' : '#ff4fd8';
    ctx.lineWidth = Math.max(3, s.thick * a.s);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, s.thick * 0.25 * a.s);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - s.thick * 0.2 * a.s);
    ctx.lineTo(b.x, b.y - s.thick * 0.2 * b.s);
    ctx.stroke();
    ctx.fillStyle = COLORS.warn;
    ctx.beginPath();
    ctx.arc(hubTop.x, hubTop.y, 6 * hub.s, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPickup(v: RenderView, i: number): void {
    const pk = v.sim.obstacles.pickups[i];
    const bob = 10 + Math.sin(v.time * 4 + pk.x) * 3;
    const p = this.cam.project(pk.x, pk.y, bob, this.p0);
    if (!p.visible) return;
    const ctx = this.ctx;
    if (pk.kind === 'coin') {
      const sz = 15 * p.s;
      const sx = Math.abs(Math.cos(v.time * 5 + pk.y * 0.05));
      ctx.drawImage(this.sprites.coin, p.x - (sz * Math.max(0.15, sx)) / 2, p.y - sz / 2, sz * Math.max(0.15, sx), sz);
    } else {
      const img = pk.kind === 'surge' ? this.sprites.surgeOrb : this.sprites.championOrb;
      const sz = 40 * p.s * (1 + Math.sin(v.time * 6) * 0.08);
      ctx.drawImage(img, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
  }

  private drawFinale(v: RenderView): void {
    const f = v.sim.finale.f;
    const ctx = this.ctx;
    const cam = this.cam;
    const shake = f.flash > 0 ? Math.sin(v.time * 80) * 1.8 : 0;
    if (f.kind === 'fortress') {
      if (f.destroyed) return;
      const dmg = 1 - f.hp / f.maxHp;
      const y0 = f.y;
      const y1 = f.y + 60;
      const hgt = 95;
      this.box(-H - 16 + shake, H + 16 + shake, y0, y1, hgt, COLORS.fortress, COLORS.fortressDark, '#7c1528');
      // Crenellations
      for (let k = 0; k < 9; k++) {
        const cx = -H + 10 + (k * (2 * H - 20)) / 8;
        this.box(cx - 13 + shake, cx + 13 + shake, y0, y0 + 26, hgt + 20, COLORS.fortress, COLORS.fortressDark, '#7c1528');
      }
      // Gate door
      const d0 = cam.project(-34 + shake, y0, 0, this.p0);
      const d1 = cam.project(34 + shake, y0, 0, this.p1);
      const d2 = cam.project(34 + shake, y0, 55, this.p2);
      const d3 = cam.project(-34 + shake, y0, 55, this.p3);
      ctx.fillStyle = '#4a0f1c';
      quad(ctx, d0, d1, d2, d3);
      ctx.fill();
      // Cracks as damage grows
      if (dmg > 0.2) {
        ctx.strokeStyle = 'rgba(40,5,15,0.7)';
        ctx.lineWidth = Math.max(1.5, 3 * d0.s);
        const n = Math.floor(dmg * 8);
        for (let k = 0; k < n; k++) {
          const cx = -H + 30 + ((k * 73) % (2 * H - 60));
          const a = cam.project(cx, y0, 30 + ((k * 31) % 50), this.p4);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(a.x + 10 * a.s, a.y + 12 * a.s);
          ctx.lineTo(a.x + 4 * a.s, a.y + 24 * a.s);
          ctx.stroke();
        }
      }
      const top = cam.project(0, y0, hgt + 48, this.p5);
      this.finaleLabel(top.x, top.y, top.s, f.hp, f.maxHp);
      return;
    }
    // Boss
    if (f.destroyed) return;
    const img = this.sprites.bosses[f.bossType ?? 'stomper'];
    const p = cam.project(f.x, f.y + 40, 0, this.p0);
    const r = f.width * 0.62;
    const size = r * 2 * p.s;
    const breathe = 1 + Math.sin(v.time * 3) * 0.03;
    const stomp = f.stompWarn > 0 ? Math.min(1, 1 - f.stompWarn) : 0;
    const lift = f.bossType === 'stomper' ? stomp * 26 : 0;
    // Stomp telegraph
    if (f.stompWarn > 0) {
      const sp = cam.project(f.stompX, f.y - 50, 0, this.p1);
      const rr = f.stompR * sp.s;
      ctx.fillStyle = `rgba(255,40,70,${0.18 + 0.2 * Math.abs(Math.sin(v.time * 18))})`;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, rr, rr * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff2d55';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,40,70,0.45)';
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, rr * stomp, rr * stomp * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,20,80,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, size * 0.45, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    const w = size * breathe;
    const hh = size / breathe;
    ctx.drawImage(img, p.x - w / 2 + shake, p.y - hh * 0.95 - lift * p.s, w, hh);
    if (f.flash > 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x + shake, p.y - hh * 0.45 - lift * p.s, w * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.finaleLabel(p.x, p.y - hh * 0.95 - 16 * p.s - lift * p.s, p.s, f.hp, f.maxHp);
  }

  private finaleLabel(x: number, y: number, s: number, hp: number, max: number): void {
    const ctx = this.ctx;
    const fs = Math.max(14, 30 * s);
    setFont(ctx, fs);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = fs * 0.2;
    ctx.strokeStyle = COLORS.ink;
    const txt = formatNum(Math.ceil(hp));
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(txt, x, y);
    this.hpBar(x, y + fs * 0.75, Math.max(60, 140 * s), hp / max, '#ff4757');
  }

  private hpBar(x: number, y: number, w: number, frac: number, color: string): void {
    const ctx = this.ctx;
    const h = Math.max(4, w * 0.1);
    ctx.fillStyle = 'rgba(20,10,40,0.7)';
    roundRect(ctx, x - w / 2 - 1.5, y - h / 2 - 1.5, w + 3, h + 3, h);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x - w / 2, y - h / 2, w * clamp(frac, 0, 1), h, h / 2);
    ctx.fill();
  }

  /** Extruded box: top, near face and the side facing the camera. */
  private box(x0: number, x1: number, y0: number, y1: number, h: number, top: string, front: string, side: string, stripes = false): void {
    const cam = this.cam;
    const ctx = this.ctx;
    const a = cam.project(x0, y0, 0, this.p0);
    const b = cam.project(x1, y0, 0, this.p1);
    const c = cam.project(x1, y0, h, this.p2);
    const d = cam.project(x0, y0, h, this.p3);
    if (!a.visible) return;
    const e = cam.project(x0, y1, h, this.p4);
    const f = cam.project(x1, y1, h, this.p5);
    // Side face
    if (x1 < cam.camX) {
      const g = cam.project(x1, y1, 0, this.p6);
      ctx.fillStyle = side;
      quad(ctx, b, g, f, c);
      ctx.fill();
    } else if (x0 > cam.camX) {
      const g = cam.project(x0, y1, 0, this.p6);
      ctx.fillStyle = side;
      quad(ctx, a, g, e, d);
      ctx.fill();
    }
    ctx.fillStyle = front;
    quad(ctx, a, b, c, d);
    ctx.fill();
    ctx.fillStyle = top;
    quad(ctx, d, c, f, e);
    ctx.fill();
    if (stripes && this.stripePattern) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = this.stripePattern;
      const k = cam.project(x0, y0, h * 0.25, this.p7);
      ctx.beginPath();
      ctx.moveTo(k.x, k.y);
      ctx.lineTo(b.x + (k.x - a.x), k.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(a.x, a.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawSurgeVignette(t: number, time: number): void {
    const ctx = this.ctx;
    const { W, H: SH } = this.cam;
    const g = ctx.createRadialGradient(W / 2, SH / 2, Math.min(W, SH) * 0.35, W / 2, SH / 2, Math.max(W, SH) * 0.75);
    g.addColorStop(0, 'rgba(255,220,60,0)');
    g.addColorStop(1, `rgba(255,200,40,${0.35 * t * (0.8 + 0.2 * Math.sin(time * 10))})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, SH);
  }

  // ------------------------------------------------------------ HUD

  private drawHud(v: RenderView, hud: HudState): void {
    const ctx = this.ctx;
    const { W, H: SH } = this.cam;
    const sim = v.sim;
    const top = hud.safeTop + 12;
    const f = sim.finale.f;

    // Progress bar (level label inside, finale icon at the end)
    const bw = Math.min(W - 124, 360);
    const bx = (W - bw) / 2;
    const bh = 18;
    ctx.fillStyle = 'rgba(20,10,50,0.5)';
    roundRect(ctx, bx - 3, top - 3, bw + 6, bh + 6, 12);
    ctx.fill();
    const prog = sim.progress;
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, '#5ef0ff');
    grad.addColorStop(1, '#b36bff');
    ctx.fillStyle = grad;
    roundRect(ctx, bx, top, Math.max(bh, bw * prog), bh, 9);
    ctx.fill();
    if (hud.bestProgress > 0.02 && hud.bestProgress < 1) {
      const mx = bx + bw * Math.min(1, hud.bestProgress / 0.9);
      ctx.fillStyle = '#fff';
      ctx.fillRect(mx - 1.5, top - 5, 3, bh + 10);
    }
    setFont(ctx, 13);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.ink;
    const lvl = hud.daily ? 'DAILY CHALLENGE' : `LEVEL ${hud.level}`;
    ctx.strokeText(lvl, bx + bw / 2, top + bh / 2 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(lvl, bx + bw / 2, top + bh / 2 + 1);
    setFont(ctx, 20);
    ctx.textAlign = 'left';
    const icon = sim.plan.isBoss ? '☠' : '♜';
    ctx.strokeText(icon, bx + bw + 8, top + bh / 2);
    ctx.fillStyle = sim.plan.isBoss ? '#ff6b81' : '#fff';
    ctx.fillText(icon, bx + bw + 8, top + bh / 2);

    // Score + multiplier
    const sy = top + bh + 26;
    ctx.textAlign = 'center';
    setFont(ctx, 28);
    ctx.lineWidth = 6;
    const scoreTxt = formatNum(hud.score);
    ctx.strokeText(scoreTxt, W / 2, sy);
    ctx.fillStyle = '#fff';
    ctx.fillText(scoreTxt, W / 2, sy);
    if (hud.multiplier > 1) {
      const sw = ctx.measureText(scoreTxt).width;
      const pulse = 1 + Math.sin(v.time * 10) * 0.06 * hud.multiplier;
      const mx = W / 2 + sw / 2 + 30;
      ctx.save();
      ctx.translate(mx, sy);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = COMBO_COLORS[Math.min(COMBO_COLORS.length - 1, hud.multiplier - 2)];
      roundRect(ctx, -24, -15, 48, 30, 12);
      ctx.fill();
      setFont(ctx, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(`x${hud.multiplier}`, 0, 1);
      ctx.restore();
    }
    // Coins this run
    ctx.textAlign = 'left';
    setFont(ctx, 15);
    const cx0 = hud.leftHanded ? W - 64 : 14;
    ctx.drawImage(this.sprites.coin, cx0, sy - 9, 18, 18);
    ctx.lineWidth = 4;
    ctx.strokeText(String(hud.coins), cx0 + 22, sy);
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(String(hud.coins), cx0 + 22, sy);

    // Finale HP banner
    if (sim.finale.arena && !f.destroyed) {
      const by = sy + 30;
      const name = f.kind === 'boss' ? BOSS_NAMES[f.bossType ?? 'stomper'] : 'FORTRESS';
      ctx.textAlign = 'center';
      setFont(ctx, 18);
      ctx.strokeText(name, W / 2, by);
      ctx.fillStyle = f.kind === 'boss' ? '#ff9db5' : '#fff';
      ctx.fillText(name, W / 2, by);
      this.hpBar(W / 2, by + 18, Math.min(W - 60, 300), f.hp / f.maxHp, '#ff4757');
    }

    // Swarm counter bubble
    if (sim.units.count > 0) {
      const u = sim.units;
      const r = u.radius();
      const p = this.cam.project(u.cx, u.cy + r * 0.8, 26, this.p0);
      if (p.visible) {
        const pop = 1 + hud.countPop * 0.35;
        const fs = 24 * pop;
        setFont(ctx, fs);
        const txt = formatNum(hud.soldiers);
        const w = ctx.measureText(txt).width + 22;
        const y = Math.max(sy + 70, p.y - 30);
        ctx.fillStyle = sim.ability.active > 0 ? '#ffcc00' : 'rgba(20,10,50,0.8)';
        roundRect(ctx, p.x - w / 2, y - fs * 0.62, w, fs * 1.24, fs * 0.62);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x - 6, y + fs * 0.6);
        ctx.lineTo(p.x + 6, y + fs * 0.6);
        ctx.lineTo(p.x, y + fs * 0.6 + 7);
        ctx.closePath();
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = sim.ability.active > 0 ? COLORS.ink : '#fff';
        ctx.fillText(txt, p.x, y + 1);
      }
    }

    // Surge button
    if (hud.surgeUnlocked) {
      const r = 38;
      const x = hud.leftHanded ? 16 + r : W - 16 - r;
      const y = SH - hud.safeBottom - 22 - r;
      this.surgeButton.x = x;
      this.surgeButton.y = y;
      this.surgeButton.r = r + 12;
      const ready = hud.surgeMeter >= 1 && hud.surgeActive <= 0;
      ctx.fillStyle = ready ? '#ffcc00' : 'rgba(20,10,50,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, r * (ready ? 1 + Math.sin(v.time * 8) * 0.06 : 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hud.surgeActive > 0 ? '#fff' : '#ffe14d';
      ctx.lineWidth = 6;
      ctx.beginPath();
      const frac = hud.surgeActive > 0 ? hud.surgeActive / sim.plan.player.surgeDuration : hud.surgeMeter;
      ctx.arc(x, y, r - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      ctx.textAlign = 'center';
      setFont(ctx, 26);
      ctx.fillStyle = ready ? COLORS.ink : '#ffe14d';
      ctx.fillText('⚡', x, y - 5);
      setFont(ctx, 11);
      ctx.fillText(ready ? 'TAP!' : 'SURGE', x, y + 18);
    }

    // Tutorial hint
    if (hud.hint && hud.hintTime > 0) {
      const a = Math.min(1, hud.hintTime / 0.4, (3.2 - hud.hintTime) / 0.2 + 0.001);
      const scale = hud.hintTime > 3.0 ? easeOutBack((3.2 - hud.hintTime) / 0.2) : 1;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(W / 2, SH * 0.3);
      ctx.scale(scale, scale);
      let hfs = 30;
      setFont(ctx, hfs);
      const tw = ctx.measureText(hud.hint).width;
      if (tw > W - 32) {
        hfs = Math.max(14, (hfs * (W - 32)) / tw);
        setFont(ctx, hfs);
      }
      ctx.textAlign = 'center';
      ctx.lineWidth = 7;
      ctx.strokeStyle = COLORS.ink;
      ctx.strokeText(hud.hint, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(hud.hint, 0, 0);
      ctx.restore();
    }
  }
}

const COMBO_COLORS = ['#2fb8ff', '#3ccf5a', '#ffb300', '#ff5a3c', '#e03cff'];

function gateLabel(kind: GateKind, value: number, used: boolean): string {
  switch (kind) {
    case 'mul':
      return `×${value}`;
    case 'add':
      return used ? '✓' : `+${formatNum(value)}`;
    case 'sub':
      return `−${formatNum(value)}`;
    case 'div':
      return `÷${value}`;
  }
}

function quad(ctx: CanvasRenderingContext2D, a: Projected, b: Projected, c: Projected, d: Projected): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
}
