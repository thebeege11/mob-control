# Swarm Surge

In this one-finger arcade game you steer a growing swarm through gates,
hazards and enemies, then smash it into a fortress or a boss. Levels are
generated procedurally and never run out, and difficulty adapts to the
player. It's built for iOS and Android with TypeScript, Canvas 2D and
Capacitor.

- **Design:** [docs/DESIGN.md](docs/DESIGN.md)
- **Shipping to the stores:** [docs/RELEASE.md](docs/RELEASE.md)

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (open on your phone via the LAN URL too)
npm test             # unit + generator + balance-simulation tests (~40 s)
npm run build        # typecheck + production bundle in dist/
npm run e2e          # headless-browser smoke test of the whole UI loop (after build)
```

### Debug URL parameters

These work in dev builds, or in any build if you add `?debug`:

- `?autoplay` or `?autoplay=0.6`: the bot plays at that skill level, from 0 to 1.
- `?level=25`: jump to a level.

## Controls

- **Drag** to steer.
- **Hold** to squeeze the swarm; **release** to let it spread.
- **Tap ⚡** or **double-tap** to Surge.

## Tuning

Every balancing value is in [`src/config/tuning.ts`](src/config/tuning.ts):
difficulty curve, upgrade curves and costs, economy, combo tiers, ad pacing,
juice limits and generator/fairness limits.

After changing values, run `npm test`. The balance simulation plays hundreds
of generated levels with a bot and asserts these targets:

- win rate on the expected upgrade curve
- forgiving openers
- upgrades mattering
- no hazard that routinely wipes the swarm
- instant restarts
- a per-step CPU budget

## Project layout

```
src/config     tuning
src/core       seeded RNG, math
src/gen        module library, procedural generator, fairness validator
src/game       simulation + managers, juice, input, bot, GameManager
src/render     perspective camera, renderer, particles, floating text, sprites
src/systems    difficulty, upgrades, currency, save, audio, ads, IAP, analytics, retention, skins
src/platform   storage / haptics / Capacitor bindings
src/ui         DOM menus
tests/         vitest suites (generator, balance sim, systems)
scripts/       asset generation, e2e
android/ ios/  Capacitor native projects
```

## Tests

| Suite | What it checks |
|---|---|
| `tests/generator.test.ts` | 6,000 generated levels (levels 1–5000, at 0.6×, 1× and 1.6× power) all pass the fairness validator. Also: determinism, unlock curve, boss cadence, mercy, upgrades vs. scaling. |
| `tests/balance.sim.test.ts` | A bot plays levels 1–60 through the real simulation: win rate, forgiving openers, upgrades matter, anti-frustration (per-module loss/wipe caps), restart speed, CPU budget. |
| `tests/systems.test.ts` | Save/load/migration/corruption, upgrades, economy, rewards, combo, gates math, weight cap, revive, ad policy, IAP restore, daily rewards/streaks, achievements, milestones. |
| `scripts/e2e.mjs` | A real browser at phone size: play → win → NEXT → fail → retry → upgrade → every menu → reload persistence → zero runtime errors. |
