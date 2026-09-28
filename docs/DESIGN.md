# SWARM SURGE — Game Design

## 1. Concept

**Swarm Surge** is a one-finger arcade runner. You steer a swarm of jelly
"Blips" down a candy-coloured track. Gates multiply it, hazards and enemy
"Grumps" whittle it down, and at the end the whole swarm smashes into a
fortress (or, every 5th level, a boss). The bigger and healthier the swarm
you bring, the more damage you deal.

What makes it different from other crowd runners:

- **Squeeze.** Holding your finger tightens the formation; letting go lets it
  spread. A tight swarm slips through gaps, lasers and crushers. A loose one
  sweeps up coins and hits more of a wide fortress face. You choose the
  swarm's *shape*, not just where it goes.
- **Weighted blips.** Above 240 on-screen units, extra soldiers merge into
  bigger blips with a number on them. The army can grow into the thousands
  and still run at 60 FPS.
- **Continuous contact combat.** Fights grind down HP pools. Units lost is
  `(enemyHP × enemyATK) / (power × health)`, so every upgrade point counts
  and there are no sudden 2× cliffs.
- **SURGE.** One active ability. A meter charges from combos, kills and
  gates. Tap ⚡ (or double-tap) to turn golden for a few seconds: immune to
  hazards and dealing ×3 damage.

## 2. Core loop

```
TAP → run starts instantly (≈20–35 s per level)
  ├─ drag to steer, hold to squeeze
  ├─ pick gates (×2, +30 vs −45, ÷2 …)   → multiplication
  ├─ weave hazards (walls, sweepers, spinners, saws, lasers, crushers)
  ├─ crush Grump squads / Brutes, break crates
  ├─ combo builds x2…x6, Surge meter fills
  └─ FINALE: swarm grinds the fortress / boss HP
WIN  → coins count up, chest pips, x2 (optional ad), upgrade cards, NEXT (≈0.1 s)
FAIL → YOU LOST, % progress vs best, cause, reward, revive (optional), TAP TO RETRY (≈0.1 s)
```

## 3. Controls (one hand, one finger)

| Input | Action |
|---|---|
| Drag anywhere (relative) | Steer the swarm left/right |
| Finger down | Squeeze (tight formation) |
| Finger up | Spread (loose formation) |
| Tap ⚡ button, or double-tap | SURGE |

The ⚡ button moves to the other side with the *Left-handed* setting.
Keyboard fallback for desktop: ←/→ or A/D, Space, E.

## 4. Progression

- **Permanent upgrades** (coins): POWER (damage), HEALTH, SQUAD (starting
  units), GATES (+% on every gain, soft-capped), SURGE (duration and charge
  rate, soft-capped), INCOME (coin multiplier). Costs grow geometrically;
  most stats grow linearly, so returns diminish.
- **Rewards:**
  - Common: coins, from wins, progress on a fail, pickups and crates.
  - Uncommon: gems, from gem crates, bosses, chests, achievements and daily
    rewards. They pay for revives, Head Start boosts and skins.
  - Rare: Champion orb (a golden blip worth 8×) and Surge orbs.
  - Very rare: skins from chests (8% per chest) and milestone skins.
- **Chests:** every 3 wins.
- **Retention:** 7-day daily reward loop, daily challenge (a seeded level with
  a modifier), 15 achievements, level milestones (10/25/50/100) that unlock
  skins, and a best-progress "ghost" marker on the progress bar.

## 5. Procedural generation

`src/gen/` holds a library of **29 modules**. Each is a parameterised
level segment with a category, unlock level, difficulty window
(`minD`/`maxD`/`fullD`), rating, minimum army, compatibility rules and a
recovery requirement. Categories: growth, choice, obstacle, hazard, enemy,
reward, speed, branch (risk/reward path), combo and recovery.

For each level, the generator:

1. Asks the `DifficultyManager` for complexity *D*, reference stats and enemy
   multipliers.
2. **Tutorial scripts** for levels 1–4 introduce one idea at a time.
3. **Pacing director:** tension builds with each challenge. When it goes over
   budget, or after a module flagged `needsRecoveryAfter`, the director
   forces a breather. Challenge weight peaks late in the level.
4. **Army director:** it keeps a target army curve and sizes gates and
   enemies against it. That stops runaway exponential growth and keeps every
   choice meaningful.
5. Each candidate section is **validated locally**:
   - a time-aware reachability sweep
   - hazard reaction gaps
   - rating-spike limits
   - expected survival for both the actual and the reference player

   If it fails, the director picks another module (up to 14 tries), then
   falls back to a safe section.
6. It sizes the **finale** from the reference player's expected damage times
   a ratio that rises with *D*. It then clamps the HP so a good run with the
   player's actual stats always wins with a 15% margin.
7. A **full `FairnessValidator` pass** covers:
   - overlap and ordering
   - gates buried in walls
   - reaction time
   - recovery rules
   - rating spikes
   - army collapse
   - a global reachability sweep
   - whether the finale is beatable

   If anything fails, the level is regenerated with a new salt.

The reachability sweep uses the *same hazard geometry functions the runtime
uses*, sampled at the exact arrival time from the speed profile. It assumes
a human moves at only 50% of the swarm's real lateral speed.

## 6. Difficulty

Two separate axes:

- **Complexity *D*** (skill) comes only from the level number:
  `D = 10(1−e^(−L/12)) + 4·ln(1+L/20) + 0.02L`, plus a saw-tooth (a bump on
  boss levels, a breather right after). It drives which modules can appear,
  their intensity, forward speed, reaction windows, gap widths, and
  tension/spacing budgets. Upgrades never change it.
- **Toughness** (numbers):
  `enemyHP = referenceHP × (playerPower / referencePower)^0.45 × performance × (1 + 0.22·ln(1+L/30))`.
  - The *reference player* is simulated from the economy tuning: it wins
    every level and buys the cheapest upgrade.
  - Being ahead of the curve helps, but only by `ratio^0.55`.
  - Recent performance adjusts toughness: −7% per consecutive fail (up to 4),
    +2.5% per win streak (up to 5).

Every constant lives in **`src/config/tuning.ts`**.

## 7. Technology

**TypeScript + HTML5 Canvas 2D + Vite, wrapped with Capacitor 8 for iOS and
Android.**

- It's the fastest path to both stores from one codebase: no engine licence,
  a small binary, and web-speed iteration.
- The simulation is deterministic and headless, so automated bot playthroughs
  balance-test the real game in CI.
- The JS bundle is ≈57 KB gzipped. All art and audio is procedural, with no
  asset pipeline.
- Canvas 2D with pre-rendered sprites, pooled particles, zero per-frame
  allocations in the sim and adaptive resolution holds 60 FPS on mid-range
  phones.

## 8. Architecture

```
src/
  config/tuning.ts            ← every balancing number
  core/                       rng (seeded), math
  gen/                        types, modules (library), ProceduralLevelGenerator, FairnessValidator
  game/
    Simulation.ts             deterministic world for one run (headless)
    UnitManager.ts            swarm: pooled units, formation, squeeze, weights, crowd separation
    EnemyManager.ts           grunts/brutes/crates, activation, contact combat
    ObstacleManager.ts        gates, hazards, pickups, near-miss/perfect tracking
    FinaleController.ts       fortress + 3 boss behaviours
    ScoreManager.ts           score + combo tiers
    AbilitySystem.ts          SURGE
    hazardGeometry.ts         shared runtime/validator geometry
    SimEvents.ts              allocation-free event queue (sim → juice/audio/UI)
    Juice.ts                  particles, shake, flashes, slow-mo, haptics, sounds
    PlayerController.ts       one-finger input
    BotController.ts          AI player (tests + ?autoplay demo)
    LevelManager.ts           campaign / retry / daily requests
    GameManager.ts            state machine + wiring
  render/                     Camera (perspective), Renderer, Particles, FloatingText, sprites, theme
  systems/                    Difficulty, Upgrade, Currency, Save, Audio, Ad, Purchase, Analytics,
                              Retention (daily/achievements/milestones), Skin, economy
  platform/                   storage, haptics, native (Capacitor plugins)
  ui/UIManager.ts             DOM menus
```

## 9. First 30 minutes (designed discovery curve)

| Time | Levels | New things |
|---|---|---|
| 0–2 min | 1–2 | Drag, choose gates, squeeze through a gap, fortress, first chest pip, first upgrade affordable |
| 2–5 min | 3–5 | Grumps, crates, double gaps, sweeper, spike strips, SURGE unlocks (L4), **first boss** (L5) |
| 5–10 min | 6–10 | Spinners, triple gates, slalom, saws, moving gates, gate+enemy combos, second boss, Ember skin |
| 10–20 min | 11–20 | Crushers, lasers, Champion orb, sweeper-guarded gates, Brutes, swap gates, third and fourth bosses |
| 20–30 min | 21–30 | Speed pads, saw+gate combos, risk/reward branches, laser+gate combos, Toxic skin (L25) |

New modules get triple selection weight for 4 levels after they unlock, so
they show up right away. Each one shows a one-line hint the first time.
