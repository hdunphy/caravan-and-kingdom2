# TypeScript Migration Plan

Incremental migration of the `src/` codebase from JavaScript (ES modules) to TypeScript, one module at a time, keeping the game runnable and the headless test green after **every** step.

## Guiding principles

- **Bottom-up, one module per step.** Convert leaf modules (no internal imports) first, then their dependents. Each converted file imports already-typed modules, so types compound instead of fighting `any`.
- **Always green.** After each file is renamed `.js -> .ts`, run the headless test and a typecheck. Never start the next file until both pass and the determinism hash is unchanged.
- **`allowJs` bridge.** With `allowJs` on, a `.ts` file can import a `.js` file and vice-versa, so the repo stays in a working mixed state throughout. No big-bang cutover.
- **Loose first, tighten last.** Start with relaxed strictness so each file converts cleanly; flip on full `strict` as the final phase once everything is `.ts`.
- **Runtime: `tsx`.** The headless runner executes mixed `.ts`/`.js` directly via `tsx test/headless.ts` — no build step between checks.
- **Decompose while we're in there.** The migration also breaks the monolithic files into smaller, single-concern modules (target **≤ ~250 LOC/file**) so each fits comfortably in an agent's context window. Splitting is a pure code-move along existing function-group seams — no behavior change — and is verified by the same determinism guardrail. Each split module re-exports through a barrel (`index.ts`) so import sites elsewhere don't churn and the `diplomacy ↔ governors` cycle keeps working unchanged.

## How verification works each step

The headless runner (`test/headless.js`) already covers the **entire sim path**: `worldgen -> gameLoop (run / summarize)`, plus a same-seed determinism check and four health assertions. It exits non-zero on failure. That is our safety net for everything under `src/core` and `src/sim`.

> ⚠️ **Coverage gap:** the headless runner does **not** import any of `src/ui/*` or `src/main.js`. Those modules (camera, renderer, hud, main) cannot be validated by the runner — they get verified by `tsc` typecheck plus a manual browser smoke test. Plan their conversion for last and budget time for eyeball checks.

Per-step checklist (the loop we repeat for every file):

1. `git mv src/path/file.js src/path/file.ts` (keep history).
2. Fix the type errors `tsc` reports for that file. Leave `.js` import specifiers as-is — under NodeNext, `import './hex.js'` correctly resolves `hex.ts`.
3. `npm run typecheck` — `tsc --noEmit` passes (0 errors).
4. `npm run test:headless` — health checks PASS **and** determinism PASS.
5. Compare the printed summary table + determinism hash against the baseline captured in Phase 0. **They must be byte-identical** — a TS conversion must not change runtime behavior.
6. Commit: `refactor(ts): convert <module>`.

If a step turns red, the change set is one file — revert it, not the whole migration.

### Convert vs. split ordering (two atomic sub-steps)

Keep typing and decomposition in **separate commits** so each diff is one kind of change and easy to review:

- **Small / single-concern files** (`hex`, `rng`, `settlement`, `worldgen`, `pathfinding`, `policy`, `camera`, `gameLoop`): just convert `.js -> .ts`. No split.
- **Oversized files** (`diplomacy`, `governors`, `systems`, `agents`, `constants`, `renderer`, `hud`): **split first (in JS), then convert each piece.** Splitting the JS file into a folder of small `.js` modules + barrel is a pure move the headless runner validates immediately; afterwards each small module converts to `.ts` with a tiny, readable diff — far easier than typing a 1,489-line file in one go. (Convert-then-split also works, but typing the monolith first is the painful path.)

Either way, run the full per-step checklist after **both** the split and each conversion. A split must leave the determinism hash byte-identical, exactly like a conversion.

## Module dependency map (conversion order)

Derived from the actual import graph. Lower layers have no dependency on higher ones, so convert top-to-bottom of this list.

```
Layer 0 — leaves (no internal imports)
  core/rng.js
  core/constants.js
  core/hex.js
  ui/camera.js                (UI leaf, but defer to Phase 7)

Layer 1
  core/pathfinding.js   -> constants
  sim/policy.js         -> constants
  sim/settlement.js     -> constants, hex

Layer 2
  sim/worldgen.js       -> constants, hex, rng, settlement
  sim/agents.js         -> constants, hex, pathfinding, settlement
  sim/systems.js        -> constants, hex, agents, settlement

Layer 3  (mutually recursive — convert as a pair)
  sim/diplomacy.js  <->  sim/governors.js
      diplomacy -> constants, hex, agents, governors, settlement
      governors -> constants, hex, pathfinding, agents, diplomacy, settlement, systems

Layer 4
  sim/gameLoop.js       -> diplomacy, governors, systems   (full sim now TS)

UI / entry  (no headless coverage)
  ui/renderer.js        -> constants, hex
  ui/hud.js             -> constants, diplomacy, gameLoop, settlement
  ui/camera.js          -> (none)
  main.js               -> worldgen, gameLoop, camera, renderer, hud, hex
```

LOC per file (rough effort signal): `diplomacy 1489`, `governors 560`, `renderer 420`, `systems 336`, `agents 313`, `hud 289`, `constants 222`, `worldgen 160`, `pathfinding 127`, `main 118`, `settlement 116`, `gameLoop 69`, `hex 57`, `camera 29`, `rng 18`, `policy 15`.

---

## Target module layout (decomposition)

Each oversized file becomes a **directory with a barrel** (`index.ts` that re-exports the public surface). The barrel keeps every existing import working — e.g. `import { combatSystem } from './diplomacy.js'` becomes `from './diplomacy/index.js'` (or the folder is named `diplomacy/` and resolves via its `index.ts`). Files under ~250 LOC that already do one job (`hex`, `rng`, `settlement`, `worldgen`, `pathfinding`, `policy`, `camera`, `gameLoop`) stay single-file.

Splits follow the existing section-comment seams, so each piece is a clean cut of related functions:

```
sim/diplomacy/                          (was 1489 LOC)
  relations.ts    pairKey, getRelation, addRelation, findWar, atWar(Any),
                  stateOf, hasEmbargo, hasPact, getAllies, canTrade, tradePrice
  strength.ts     soldiersOf, strengthOf, committedStrength, defensive/offensiveBlocStats,
                  settlementDefense, armyCap (+ aliveF/traitsF/goldF helpers)
  court.ts        courtSystem            (the ~410-line Court pass — its own file)
  peace.ts        checkPeace, makePeace
  war.ts          declareWar, pickWarGoal, recruitSoldiers, warCouncil
  peacetime.ts    manageGarrison, considerGift
  combat.ts       combatSystem, healAndAttrition, captureSettlement
  index.ts        barrel: re-export the public API used by governors/gameLoop/hud

sim/governors/                          (was 560 LOC)
  index.ts        traitsOf, getSettlerCost, aiSystem, evaluateGoal  (entry + barrel)
  civil.ts        civilGovernor, favoredPartners, paveRoads, findColonySite
  labor.ts        laborGovernor
  transport.ts    transportGovernor
  trade.ts        tradeGovernor

sim/systems/                            (was 336 LOC — already numbered 1–5)
  extraction.ts   extractionSystem
  metabolism.ts   metabolismSystem, abandonSettlement
  movement.ts     movementSystem
  logistics.ts    buildClaims, takeTicket, unclaimed, logisticsSystem, rankedNeeds
  maintenance.ts  maintenanceSystem
  index.ts        barrel

sim/agents/                             (was 313 LOC)
  spawn.ts        spawnAgent, homeOf, AGENT_SPEED, AGENT_CAPACITY (+ recordTrade, findFallbackSite)
  movement.ts     assignPath, cancelMission
  arrival.ts      onArrival          (split the big mission switch by kind if it stays unwieldy)
  index.ts        barrel

core/constants/                         (was 222 LOC — config, not logic)
  terrain.ts      TERRAIN, RESOURCES
  economy.ts      ECON
  tiers.ts        TIERS, BUILDINGS, GOALS, ROLES
  diplo.ts        DIPLO (~83 LOC on its own)
  factions.ts     FACTIONS, DEFAULT_TRAITS, DEFAULT_POLICY
  index.ts        barrel

ui/renderer/                            (was 420 LOC — one giant render())
  smooth.ts       smoothPos, HEX_SIZE
  drawTerrain.ts  hex fill, territory tint/borders, burn markers, resource piles
  drawRoads.ts    road casing + surface passes
  drawSettlements.ts  settlement glyphs, siege indicator
  drawAgents.ts   villager/caravan(boat)/soldier(shield)/settler glyphs
  drawWeather.ts  drifting clouds (screen-space)
  render.ts       orchestrator: calls the draw passes in order
  index.ts        barrel (export render, HEX_SIZE)

ui/hud/                                 (was 289 LOC)
  updateHud.ts    updateHud + bindFilterEvents
  chart.ts        drawChart (history chart)
  index.ts        barrel
```

Barrels preserve the public API exactly, so `main.js`, `gameLoop`, `hud`, and the `diplomacy↔governors` cycle need no import changes beyond the folder rename. Internal `import` lines within each split package point at sibling files.

---

## Phase 0 — Tooling & baseline (no logic changes)

Goal: stand up the TS toolchain and capture a known-good reference, without touching any `src` file yet.

1. Add dev dependencies: `typescript`, `tsx`, `@types/node`.
2. Add `tsconfig.json` (loose-first settings):
   ```jsonc
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "NodeNext",
       "moduleResolution": "NodeNext",
       "allowJs": true,
       "checkJs": false,
       "noEmit": true,
       "strict": false,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true
     },
     "include": ["src", "test"]
   }
   ```
3. Add `package.json` scripts:
   ```jsonc
   "scripts": {
     "typecheck": "tsc --noEmit",
     "test:headless": "tsx test/headless.ts"
   }
   ```
   (Rename `test/headless.js -> .ts` now, or keep `.js` and point the script at it — either works under `tsx`.)
4. **Capture baseline.** Run `node test/headless.js 3000 42` and save the full output (summary table, settlement line, determinism result) to `planning/headless-baseline.txt`. This is the reference every later step is diffed against.
5. Verify both `npm run typecheck` (0 errors, all files still JS) and `npm run test:headless` pass.

**Exit criteria:** clean typecheck, headless PASS, baseline file committed.

## Phase 1 — Core leaves

Convert `core/rng.ts` and `core/hex.ts` (small, pure — just convert). For `core/constants` (222 LOC of config): **split first** into the `core/constants/` layout above (terrain / economy / tiers / diplo / factions + barrel), verify headless, then convert each piece. Run the per-step checklist after each move.

## Phase 2 — Shared domain types (high leverage)

Before climbing into the sim layer, create `src/types.ts` defining the central data shapes that get passed everywhere: `World`, `Hex`, `Settlement`, `Agent` (and its variants: villager / caravan / settler / soldier), plus enums/unions for `tier`, `role`, `goal`. Derive these from how the objects are actually constructed in `worldgen`/`settlement`/`agents`.

This is optional but pays for itself: once `World` is typed, every sim module that takes `world` as a parameter gets real autocomplete and error-checking instead of `any`. Keep fields permissive at first (optional / unions) and tighten in Phase 8.

## Phase 3 — Layer 1 sim

Convert `sim/policy.ts`, `sim/settlement.ts`, `core/pathfinding.ts`. Wire in the `types.ts` shapes where natural. Per-step checklist after each.

## Phase 4 — Layer 2 sim

Convert `sim/worldgen.ts` (single file, just convert). **Split then convert** `sim/agents/` and `sim/systems/` per the layout above (`systems` cuts cleanly along its existing 1–5 numbering; `agents` into spawn / movement / arrival). After `worldgen` is `.ts`, the headless runner's first import is TS — confirm `tsx` still runs the mixed graph cleanly.

## Phase 5 — Layer 3: diplomacy + governors (the hard part)

`diplomacy.js` and `governors.js` import each other (circular), and `diplomacy` is the largest file in the repo — so decomposition matters most here. Strategy:

- **Split both into their folders first** (in JS), with barrels that preserve the exact public surface. Because the cross-module cycle goes barrel→barrel, splitting into smaller files actually *clarifies* the cycle: only `combat.ts`/`war.ts`/`court.ts` reach into governors, not the whole file. Verify headless after the split.
- **Then convert the small pieces to `.ts`** — typing a 200-line `court.ts` is tractable in a way the 1,489-line monolith never was.
- Convert the paired barrels/entry points **together** rather than one at a time — a half-converted cycle produces noisy cross-file type errors.
- ES module circular imports work fine at runtime as long as the cycle is only exercised at call-time (not at module top-level); TS won't change that. Just type the function signatures on both sides so the cycle is described, not broken.
- Expect the most type churn here. Lean on the `World`/`Agent` types from Phase 2. It's fine to use targeted `// @ts-expect-error` or `any` escape hatches to keep moving — log them as TODOs to clean up in Phase 8.

Run the checklist; this is the step most likely to surface a behavioral diff, so scrutinize the determinism hash carefully.

## Phase 6 — gameLoop

Convert `sim/gameLoop.ts`. The **entire sim path is now TypeScript** and fully exercised by the headless runner. This is a natural milestone commit / tag.

## Phase 7 — UI & entry point (no headless coverage)

Convert `ui/camera.ts` (single file). **Split then convert** `ui/renderer/` (carve the one giant `render()` into the draw-pass files above — `render.ts` becomes a short orchestrator) and `ui/hud/` (updateHud / chart). Then convert `main.ts`. These touch the DOM/Canvas, so:

- `tsc` typecheck is the primary gate (use `lib: ["ES2022", "DOM"]` in tsconfig for this phase).
- **Manual smoke test required** after each: run `npx serve`, open the game, confirm it renders, pans/zooms, ticks, and the HUD updates. Try `?seed=123`. The headless runner cannot catch a broken render.
- `main.ts` will need a build/serve story for the browser, since browsers can't load `.ts`. Either add a bundler (`vite` is the lightest path — `index.html` -> `src/main.ts` just works) or emit JS via `tsc`. Decide here; `vite` is recommended and also gives hot-reload for the smoke tests.

## Phase 8 — Tighten strictness & clean up

Now that all of `src` is `.ts`:

1. Flip on `"strict": true` (and consider `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Fix the new errors module by module, running the headless checklist after each batch.
2. Remove `"allowJs"` and `"checkJs": false`.
3. Replace the `any` / `@ts-expect-error` escape hatches logged in Phase 5 with real types; tighten the optional fields in `types.ts`.
4. Optionally migrate the diagnostic scripts (`*.mjs` at repo root, `tools/*.mjs`, `tools/*.js`) — lower priority, not on the game's runtime path.
5. Update `README.md` (run instructions, headless command) to reflect the TS setup.

**Exit criteria:** `tsc --noEmit` passes under full strict with no `allowJs`, headless PASS + determinism unchanged from the Phase 0 baseline, game runs in the browser.

---

## Risk notes

- **Behavioral drift is the #1 risk.** The determinism hash + summary diff against the Phase 0 baseline is the guardrail — treat any change to it as a bug in the conversion, not an acceptable side effect.
- **UI has no automated net.** Budget manual browser checks for Phase 7; that's where a silent break can slip through.
- **The diplomacy/governors cycle** is the single riskiest step — convert it as a pair and review carefully.
- **Keep steps atomic.** One file (or the one cyclic pair) per commit, so a red check always points at a single, revertable change.
- **The renderer split is the one non-mechanical split with no automated net.** Carving one big `render()` into draw-pass functions means extracting shared canvas/`ctx` state and locals into parameters — a real refactor, not a pure move — and the headless runner doesn't exercise it. Do it in small extractions, each followed by a browser smoke test, and keep the draw order identical. If it gets risky, it's fine to leave `renderer` as a single (typed) file; decomposition there is a nice-to-have, not load-bearing for the sim.
