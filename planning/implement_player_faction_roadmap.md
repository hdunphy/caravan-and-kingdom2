# Roadmap: Player-Controlled Faction (King Mode) — Work Packages

The player acts as King: **no direct unit control**, only edicts and sliders that steer the existing governor AI. This roadmap breaks the path into work packages (WP1–WP7), each sized for one agent session, independently testable, in dependency order. Do not start a WP until its predecessor's acceptance tests pass.

> **⚠ TS refactor (June 2026):** the codebase was migrated from `.js` to **TypeScript**, and several large modules were split into folders. All `.js` paths below have been updated to their `.ts` locations; where a folder split happened it is called out inline. The repo also keeps a `src/core/constants.ts` *barrel* that re-exports `src/core/constants/index.ts`, so existing `from '../core/constants.js'` import specifiers still resolve (NodeNext keeps the `.js` extension in specifiers even for `.ts` files — that is expected, not a bug).

**Standing rules for every WP:**
- ⚠ Codebase drift: read current code before patching — the repo has user additions (faction `focus` PEACE/MOBILIZE/WAR, `getSettlerCost` scaling, Market Hall, military AI / War Council work, tabbed sidebar UI). Adapt specs to what exists.
- After every change: typecheck with `npm run typecheck` (`tsc --noEmit`) instead of `node --check`, then run the headless sim with `npm run test:headless -- 2500 42` (or `npx tsx test/headless.ts 2500 42`). `test/headless.ts` still runs `generateWorld(seed, 24, 4)` — 4 factions.
- Determinism: the headless sim must stay deterministic. Player edicts are *inputs* — they only flow in via the policy object (WP1), never via direct reads of DOM state inside `src/sim/`.
- Sim code never imports from `src/ui/`. (Verified still true after the refactor.) UI now lives under `src/ui/` with `src/ui/hud/` split into `index.ts`, `updateHud.ts`, `chart.ts`.

---

## WP1 — Policy substrate (no behavior change) ✅ DONE

**Goal:** a per-faction `policy` object that will be the ONLY surface edicts touch. This WP defines and plumbs it; nothing reads it yet.

**Status: complete.** Implemented during/after the TS migration. For reference, here is where each piece landed:

- `DEFAULT_POLICY` is defined in **`src/core/constants/factions.ts`** (not the old single `constants.js`) and re-exported through `src/core/constants/index.ts` and the `src/core/constants.ts` barrel:
  ```ts
  export const DEFAULT_POLICY = {
    taxRate: 1.0,        // multiplies GOLD_INCOME_PER_POP
    rations: 1.0,        // multiplies food consumption (0.5 = austerity)
    recruitment: 1.0,    // multiplies villager/soldier recruit appetite
    expansion: 1.0,      // multiplies EXPAND appetite & settler budget
    tradeStance: 1.0,    // multiplies trade eagerness (0 = autarky)
    garrison: 1.0,       // multiplies peacetime garrison target
    militaryStance: 'DEFENSIVE' as const, // 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE'
  };
  ```
- A matching **`Policy` type** (and `MilitaryStance` union) now lives in `src/types.ts`. Keep the constant and the type in sync when adding knobs.
- `src/sim/worldgen.ts` gives every faction a policy: `FACTIONS.slice(0, factionCount).map(f => ({ ...f, policy: { ...DEFAULT_POLICY } }))`.
- Helper `policyOf(world, factionId)` lives in its own **`src/sim/policy.ts`** with the DEFAULT_POLICY fallback (old saves / GA worlds). Nothing in `src/sim/` consumes it yet — that is WP2.
- **Accept (met):** headless run byte-identical, determinism PASS, all factions carry a policy object.

## WP2 — Governors read policy (AI behavior preserved at defaults)

**Goal:** thread each policy knob into exactly one decision site, so a slider has a real lever. At default values (all 1.0 / DEFENSIVE-as-current) behavior must be unchanged.

Wire-up map (paths updated for the TS layout; read each before patching):
| Knob | Site |
| :--- | :--- |
| `taxRate` | `metabolismSystem` in **`src/sim/systems/metabolism.ts`**, the `s.gold += taxable * ECON.GOLD_INCOME_PER_POP * widePenalty * taxBonus` line (also: taxRate > 1.2 applies a small pop-growth penalty — overtaxation hurts) |
| `rations` | `metabolismSystem` food `need` (`need = s.population * ECON.FOOD_PER_POP`) in the same **`src/sim/systems/metabolism.ts`** (rations < 0.8 applies the same growth penalty) |
| `recruitment` | `laborGovernor` `maxVillagers` in **`src/sim/governors/labor.ts`**; soldier recruit target in **`src/sim/diplomacy/war.ts`** `recruitSoldiers(world, fid, target)` (called from `court.ts` and `peacetime.ts`) |
| `expansion` | ⚠ the EXPAND gate `s.population >= ECON.EXPAND_MIN_POP / t.expand` now exists in **TWO** places — patch both: `evaluateGoal` in **`src/sim/governors/index.ts`** AND `courtSystem` in **`src/sim/diplomacy/court.ts`**. Also scales the settler budget via `getSettlerCost` / dispatch in **`src/sim/governors/civil.ts`** |
| `tradeStance` | `tradeGovernor` in **`src/sim/governors/trade.ts`**: scales buy target & export surplus thresholds; 0 disables missions |
| `garrison` | peacetime garrison target — **`src/sim/diplomacy/peacetime.ts`** (`recruitSoldiers` target) and the garrison logic in **`src/sim/diplomacy/court.ts`** |
| `militaryStance` | `warCouncil(world, war, side)` operation scoring in **`src/sim/diplomacy/war.ts`** (RAID/SIEGE/DEFEND/INTERCEPT scores): DEFENSIVE boosts Defend/Intercept utility, AGGRESSIVE boosts Raid/Siege and lowers the declare-war bar slightly (declare bar is set in `court.ts`) |

AI Courts set policy each session FROM traits (e.g., `policy.tradeStance = traits.trade`), so AI factions keep their personalities through the same pipe the player will use. This belongs in `courtSystem` (**`src/sim/diplomacy/court.ts`**), which currently does **not** touch `policy` at all — you'll add the trait→policy assignment there. Read traits via the existing `traitsF`/`traitsOf` helpers.
- **Accept:** defaults → identical headless results. A test script flipping one knob (e.g., `rations: 0.5`) shows the expected directional change. Determinism PASS.

## WP3 — Save / load

**Goal:** persist a world and resume it.

- Create **`src/sim/serialize.ts`** (typed against `World` from `src/types.ts`): `saveWorld(world) -> JSON string`, `loadWorld(json) -> world`. Handle: `hexes` Map ↔ array, `rng`, `pathCache` (drop it; rebuilt lazily), `diplo`, `stats`, `history`, agents/settlements as-is.
  - ⚠ rng state is **already done**: `makeRng` in `src/core/rng.ts` already exposes `getState()` / `setState(s)` on the `Rng` interface (mulberry32 internal `a`). Use those — do NOT add a new `state()`/`restore()` pair.
- UI: Save button → download `.json` + write `localStorage.cnk_autosave`; Load button → file picker; auto-offer the autosave on boot.
- **Accept:** round-trip test in `test/`: run 2,000 ticks → save → load → run 500 more on both the original and the loaded copy → `summarize()` outputs identical (this proves rng state restoration). UI save/load works in browser.

## WP4 — Notifications & decision support

**Goal:** the triage layer a king needs. Sim-side alert records; UI renders them.

- Sim: add `alerts` to the **`World` interface in `src/types.ts`** and init `world.alerts = []` in `src/sim/worldgen.ts` (capped ring like the existing `world.log` / `LogEvent[]`). Add `alert(world, factionId|null, severity, msg, {q, r})` (co-locate with the existing `log()` helper) emitted for: war declared on you, settlement under siege, settlement starving (foodDays < 10 — note `foodDays` is already computed in `metabolism.ts`), settlement captured/lost, peace signed, exhaustion crossing 50, treasury at 0 with unpaid wages.
- UI (under `src/ui/hud/`): alerts panel (or badge on the existing tabbed sidebar); click an alert → camera pans to `{q,r}` (use `src/ui/camera.ts`); "pause on critical alert" toggle (UI-side: when a critical alert arrives for the *watched* faction, set speed 0).
- **Accept:** scripted scenario produces each alert type; clicking pans; pause toggle works; headless unaffected (alerts are derived state — determinism PASS).

## WP5 — Player faction MVP (King mode)

**Goal:** pick a faction at world start; its Court defers to the player.

- Add `playerFactionId` to the **`World` interface in `src/types.ts`** and init it in `src/sim/worldgen.ts` (null = pure observer, current behavior). New-world flow: "Observe" or "Rule a kingdom" → faction picker.
- Sim: in `courtSystem` (**`src/sim/diplomacy/court.ts`**), the player faction **skips** AI policy-setting (WP2), gift decisions, and war declarations. Wars/peace become player actions:
  - `declareWar` **already exists** in `src/sim/diplomacy/war.ts` but with signature `declareWar(world, attackerId, defenderId, goalId, isInitial=false)` — wrap it (or add a thin player helper) rather than redefining; pick a goal via the existing `pickWarGoal(world, fid, enemyFid)`.
  - Add a `sueForPeace(world)` helper next to the existing peace logic in `src/sim/diplomacy/peace.ts` (`checkPeace` / `makePeace`). Peace still auto-triggers at `DIPLO.SUE_THRESHOLD` so a ruined kingdom can't fight forever. Court still enforces legality (truce, war chest).
- UI (new "Crown" tab under `src/ui/hud/`): the seven policy sliders/selects from WP1, war/peace buttons per rival (with relation + strength comparison shown — see `src/sim/diplomacy/strength.ts` / `relations.ts`), and treasury/army/food summary. Edicts apply on the next Court session (flavor: "the council convenes") — this also keeps replays deterministic if edicts are recorded with their tick.
- Player faction rendering: subtle gold ring on owned settlements; alerts default to player faction.
- Loss = elimination (existing); on elimination show a "dynasty ends" banner + offer observer mode. Win = last faction standing or >60% of world population.
- **Accept:** full playthrough smoke test; AI-only worlds (playerFactionId null) remain byte-identical to pre-WP5 headless runs.

## WP6 — World events (post-MVP content)

Drought (region food rate ×0.5 for N ticks), bumper harvest (×1.5), bandit camp (neutral raiders on a hex until cleared by soldiers), plague (settlement pop decay until quarantine edict). Each event = alert + king-facing choice where sensible (e.g., drought → "open the granaries": spend stock to prevent growth penalty). Seeded via `world.rng` at fixed cadence — determinism preserved. Suggested home: a new `src/sim/systems/events.ts` registered in `src/sim/systems/index.ts` (the systems barrel that the game loop iterates). Size: one agent session for the framework + 2 events; more events are trivial after.

## WP7 — Resource depletion & regrowth (post-MVP content)

Forest hexes deplete with extraction (timber yield falls; at 0 the hex converts to plains), regrow slowly when unworked; ore/stone deplete permanently (mountains → hills → exhausted). Drives migration, makes LUMBER/MINING roles temporal, and gives the king's `expansion` slider long-term meaning. Requires: per-hex `richness` field (add to the `Hex` type in `src/types.ts`), extraction multiplies by it in **`src/sim/systems/extraction.ts`**, worldgen init in `src/sim/worldgen.ts`, renderer tint in `src/ui/renderer.ts`. Re-balance check afterward (headless 20k-tick health run — settlements must adapt, not mass-starve).

---

## Order & sizing

| WP | Size | Depends on |
| :-- | :-- | :-- |
| 1 Policy substrate ✅ | S | war-balance work settled (done) |
| 2 Governors read policy | M | 1 |
| 3 Save/load | M | none (parallelizable) |
| 4 Notifications | M | none (parallelizable) |
| 5 Player MVP | L | 1, 2, 4 (3 strongly recommended) |
| 6 Events | M | 4, 5 |
| 7 Depletion | M | 5 (re-balance after) |

Prerequisite for the whole roadmap: current war balance / military AI work (see `implement_war_balance.md`, `implement_military_ai.md` if present) verified — a king shouldn't inherit a broken army.
