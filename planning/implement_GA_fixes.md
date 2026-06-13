# Plan: Genetic Algorithm Fixes (`tools/evolve.js`)

Brief for an implementing agent. Code review found the GA structurally sound (3-population co-evolution, elitism, tournament selection, blend crossover) but its **output is mostly noise** because of the issues below. Each fix is independent; do them in order. Run all commands from the project root.

## Context — read first

- `tools/evolve.js` (234 lines): evolves `{expand, trade, industry, aggression}` traits for 3 factions, writes `evolved_traits.json` to project root.
- `src/main.js` loads that JSON and applies it when the "GA Evolved Traits" playstyle is selected. This integration works; don't break the JSON shape: `{ "0": { name, traits: {expand,trade,industry,aggression}, persona }, "1": ..., "2": ... }`.
- The sim is deterministic when seeded (`world.rng` from `src/core/rng.js` → `makeRng(seed)`); `node test/headless.js 2500 42` must keep passing after any sim-side change.
- Sim pacing facts the GA must respect: caravans/trade ramp up ~t1500+, tier upgrades ~t2000+, first war declarations ~t3250–4250, eliminations after that. **At the current 1,000-tick horizon, the `aggression` and `trade` genes receive almost no fitness signal.**
- Evidence in the current `evolved_traits.json`: every faction drifted toward expand↑/industry↑ and trade↓ — fitness is effectively just population (see Fix 4). "Optimized Mercantile" Aurelia became *less* mercantile (trade 1.5→1.21).

---

## Fix 1 — Deterministic GA (seeded RNG)

**Problem:** `Math.random()` is used in `initPopulation`, `crossover`, `mutate`, `selectParent`. Runs aren't reproducible.

**Change:** in `tools/evolve.js`:
```js
import { makeRng } from '../src/core/rng.js';
const GA_SEED = Number(process.argv[2] ?? 1337);
const rng = makeRng(GA_SEED);
```
Replace every `Math.random()` with `rng.next()`. (`makeRng` also offers `int`, `pick`, `chance` if convenient.) Print the GA seed in the header log.

**Accept:** two runs with the same seed produce byte-identical `evolved_traits.json`; a different seed produces different output.

## Fix 2 — Realistic horizon

**Problem:** `TICKS_PER_GAME = 1000` ends matches before trade matures or any war can happen.

**Change:** `TICKS_PER_GAME = 8000`. Keep the existing early-break when ≤1 faction survives (it already shortens decided games).

**Cost note:** runtime scales linearly; see Fix 6 before raising further.

## Fix 3 — Multiple seeds

**Problem:** `SEEDS = [101]` overfits traits to one island's geography.

**Change:** `SEEDS = [42, 123, 777]` (known-diverse geographies: balanced / weak-Aurelia-start / high-water). The averaging code already supports multiple seeds — no other changes needed.

## Fix 4 — Fitness function redesign (the important one)

**Problem:** `100 + pop + gold*0.05 + settlements*12` — pop is in the thousands, the other terms are rounding errors. All three populations converge on "grow population fast"; persona genes are vestigial.

**Decide with the user if possible; otherwise implement Option A (persona-fit), which matches the existing "Optimized Mercantile/Expansionist/Industrious" labels.**

### Option A — persona-weighted fitness (recommended)
Score each faction on what its archetype is *for*, with components normalized to a roughly 0–100 scale:

```js
const PERSONA_WEIGHTS = {
  0: { popW: 0.3, goldW: 1.0, tradeW: 1.5, settleW: 0.5, capW: 0.0 },  // Aurelia: commerce
  1: { popW: 0.6, goldW: 0.2, tradeW: 0.2, settleW: 1.5, capW: 0.3 },  // Vesper: expansion
  2: { popW: 0.6, goldW: 0.2, tradeW: 0.0, settleW: 0.4, capW: 1.5 },  // Thornwall: conquest
};
// normalized: pop/4000, gold/5000, trades/100, settlements/12, captures/5
// fitness = Σ component × 100 × weight  (+100 alive bonus, as now)
```

**Required instrumentation** (small sim-side change — no RNG, keeps determinism):
- Add `world.stats = { trades: {}, captures: {} }` to the world object in `src/sim/worldgen.js`.
- In `src/sim/agents.js` → `recordTrade(world, fa, fb)`: also increment `world.stats.trades[fa]` and `[fb]` (guard for `world.stats` existence).
- In `src/sim/diplomacy.js` → `captureSettlement`: increment `world.stats.captures[winnerFid]`.
- Then run `node test/headless.js 2500 42` — determinism must still pass (counters are derived state only).

Keep the existing death penalty (`(deathTick / totalTicks) * 50`): dying early must remain worse than any alive outcome.

### Option B — relative power (if the user prefers raw strength)
`fitness = 100 * factionPop / totalWorldPop + survivalBonus`. Zero-sum and simple, but all factions will converge to similar generalist traits — personas become labels only.

## Fix 5 — Persistent control chromosome

**Problem:** the pure-default chromosome exists only in generation 1; afterwards there is no baseline, so "evolved beats default" can't be measured.

**Change:** in `createNextGen`, always set `nextPop[0] = { ...DEFAULTS[factionId] }`; keep elitism by copying the top-2 into slots 1–2; breed the rest. Index 0 plays matches and gets fitness like everyone else but is never replaced. In the final report print `improvement = bestFitness − defaultFitness` per faction.

**Accept:** final console output shows a default-vs-best delta for each faction.

## Fix 6 — Runtime budget

8,000 ticks × 3 seeds × 8 chromosomes × 2 rounds × 4 generations ≈ 1.5M sim-ticks ≈ 25–50 min single-threaded (the sim runs ~3–4 ms/tick in big late-game worlds, far faster early).

Mitigations, in order of preference:
1. `GENERATIONS = 3`, `POP_SIZE = 6` while iterating; full size for final runs.
2. Add a progress line per match (gen/round/index, elapsed ms) so long runs are observable.
3. Optional: parallelize matches with `node:worker_threads` (each match is independent). Only if asked — collect results and reduce in fixed index order so float-addition order stays stable (determinism).

## Verify after all fixes

```
node --check tools/evolve.js
node tools/evolve.js 1337        # full run, inspect leaderboards
node tools/evolve.js 1337        # second run: byte-identical evolved_traits.json
node test/headless.js 2500 42    # sim regression incl. determinism
```
Sanity-check the evolved traits: with persona fitness, expect Aurelia trade ≥ 1.5 (default), Thornwall aggression ≥ 1.4, Vesper expand ≥ 1.5. If a gene moves *against* its persona, the weights need tuning — report the result rather than forcing it.

---

## Related items spotted during the same review (verify / decide)

1. **VERIFY (likely already fixed):** `civilGovernor` in `src/sim/governors.js` now builds FISHERY on `h.terrain === 'WATER'` hexes with a land neighbor in both build sites, matching `extractionSystem`'s dock yield. Confirm with a 6k-tick run: grep the log for "Fishing Dock" and assert some hex has `terrain === 'WATER' && building === 'FISHERY'`.
2. **DECIDE (user call — do not change unilaterally):** `TERRAIN.WATER.moveCost` was changed from `Infinity` to `4.0`, making water slowly passable for ALL agents — settlers can cross ocean, armies can attack over lakes, A* routes through shallows. Major gameplay change. If unintentional, revert to `Infinity` (docks do NOT need passable water; their yield goes directly to settlement stock). If intentional, keep, but re-examine `findColonySite` / `pickWarGoal` reachability and the island premise.
3. `evolved_traits.json` must stay at the project root — it is both the GA output path and what the browser `fetch`es.

## File locations

Planning docs live in `planning/`: this file, `IMPLEMENTATION_PLAN.md` (field battles / barter / fishing docks), `DIPLOMACY_DESIGN.md`. Session task list items #25–27 cover the gameplay features; this plan is separate work on `tools/evolve.js`.
