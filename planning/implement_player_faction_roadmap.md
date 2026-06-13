# Roadmap: Player-Controlled Faction (King Mode) — Work Packages

The player acts as King: **no direct unit control**, only edicts and sliders that steer the existing governor AI. This roadmap breaks the path into work packages (WP1–WP7), each sized for one agent session, independently testable, in dependency order. Do not start a WP until its predecessor's acceptance tests pass.

**Standing rules for every WP:**
- ⚠ Codebase drift: read current code before patching — the repo has user additions (faction `focus` PEACE/MOBILIZE/WAR, `getSettlerCost` scaling, Market Hall, military AI / War Council work, tabbed sidebar UI). Adapt specs to what exists.
- After every change: `node --check` touched files, `node test/headless.js 2500 42` (note: headless.js currently runs `generateWorld(seed, 24, 4)` — 4 factions).
- Determinism: the headless sim must stay deterministic. Player edicts are *inputs* — they only flow in via the policy object (WP1), never via direct reads of DOM state inside `src/sim/`.
- Sim code never imports from `src/ui/`.

---

## WP1 — Policy substrate (no behavior change)

**Goal:** a per-faction `policy` object that will be the ONLY surface edicts touch. This WP defines and plumbs it; nothing reads it yet.

- Define in `src/core/constants.js`:
  ```js
  export const DEFAULT_POLICY = {
    taxRate: 1.0,        // multiplies GOLD_INCOME_PER_POP
    rations: 1.0,        // multiplies food consumption (0.5 = austerity)
    recruitment: 1.0,    // multiplies villager/soldier recruit appetite
    expansion: 1.0,      // multiplies EXPAND appetite & settler budget
    tradeStance: 1.0,    // multiplies trade eagerness (0 = autarky)
    garrison: 1.0,       // multiplies peacetime garrison target
    militaryStance: 'DEFENSIVE', // 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE'
  };
  ```
- `worldgen.js`: every faction gets `policy: { ...DEFAULT_POLICY }`.
- Helper in `governors.js` (or a new `src/sim/policy.js`): `policyOf(world, factionId)` with DEFAULT_POLICY fallback (old saves / GA worlds).
- **Accept:** headless run is byte-identical to before (same summarize output, determinism PASS). All factions carry a policy object.

## WP2 — Governors read policy (AI behavior preserved at defaults)

**Goal:** thread each policy knob into exactly one decision site, so a slider has a real lever. At default values (all 1.0 / DEFENSIVE-as-current) behavior must be unchanged.

Wire-up map (adapt to current code):
| Knob | Site |
| :--- | :--- |
| `taxRate` | `metabolismSystem` gold income line (also: taxRate > 1.2 applies a small pop-growth penalty — overtaxation hurts) |
| `rations` | `metabolismSystem` food `need` (rations < 0.8 applies the same growth penalty) |
| `recruitment` | `laborGovernor` maxVillagers; soldier recruit target in the War Council/`recruitSoldiers` |
| `expansion` | `evaluateGoal` EXPAND gate (multiplies `t.expand` effect) |
| `tradeStance` | `tradeGovernor`: scales buy target & export surplus thresholds; 0 disables missions |
| `garrison` | peacetime garrison target in the Court |
| `militaryStance` | War Council operation scoring: DEFENSIVE boosts Defend/Intercept utility, AGGRESSIVE boosts Raid/Siege and lowers the declare-war bar slightly |

AI Courts set policy each session FROM traits (e.g., `policy.tradeStance = traits.trade`), so AI factions keep their personalities through the same pipe the player will use.
- **Accept:** defaults → identical headless results. A test script flipping one knob (e.g., `rations: 0.5`) shows the expected directional change. Determinism PASS.

## WP3 — Save / load

**Goal:** persist a world and resume it.

- `src/sim/serialize.js`: `saveWorld(world) -> JSON string`, `loadWorld(json) -> world`. Handle: `hexes` Map ↔ array, `rng` (add a `state()`/`restore()` pair to `makeRng` in `src/core/rng.js` — expose internal `a`), `pathCache` (drop it; rebuilt lazily), `diplo`, `stats`, `history`, agents/settlements as-is.
- UI: Save button → download `.json` + write `localStorage.cnk_autosave`; Load button → file picker; auto-offer the autosave on boot.
- **Accept:** round-trip test in `test/`: run 2,000 ticks → save → load → run 500 more on both the original and the loaded copy → `summarize()` outputs identical (this proves rng state restoration). UI save/load works in browser.

## WP4 — Notifications & decision support

**Goal:** the triage layer a king needs. Sim-side alert records; UI renders them.

- Sim: `world.alerts = []` (capped ring like `world.log`). `alert(world, factionId|null, severity, msg, {q, r})` emitted for: war declared on you, settlement under siege, settlement starving (foodDays < 10), settlement captured/lost, peace signed, exhaustion crossing 50, treasury at 0 with unpaid wages.
- UI: alerts panel (or badge on the existing tabbed sidebar); click an alert → camera pans to `{q,r}`; "pause on critical alert" toggle (UI-side: when a critical alert arrives for the *watched* faction, set speed 0).
- **Accept:** scripted scenario produces each alert type; clicking pans; pause toggle works; headless unaffected (alerts are derived state — determinism PASS).

## WP5 — Player faction MVP (King mode)

**Goal:** pick a faction at world start; its Court defers to the player.

- `world.playerFactionId` (null = pure observer, current behavior). New-world flow: "Observe" or "Rule a kingdom" → faction picker.
- Sim: in `courtSystem`, the player faction **skips** AI policy-setting (WP2), gift decisions, and war declarations. Wars/peace become player actions: `declareWar(world, target)` and `sueForPeace(world)` exposed as plain functions the UI calls (Court still enforces legality: truce, war chest; peace still auto-triggers at SUE_THRESHOLD so a ruined kingdom can't fight forever).
- UI: a "Crown" tab with: the seven policy sliders/selects from WP1, war/peace buttons per rival (with relation + strength comparison shown), and treasury/army/food summary. Edicts apply on the next Court session (flavor: "the council convenes") — this also keeps replays deterministic if edicts are recorded with their tick.
- Player faction rendering: subtle gold ring on owned settlements; alerts default to player faction.
- Loss = elimination (existing); on elimination show a "dynasty ends" banner + offer observer mode. Win = last faction standing or >60% of world population.
- **Accept:** full playthrough smoke test; AI-only worlds (playerFactionId null) remain byte-identical to pre-WP5 headless runs.

## WP6 — World events (post-MVP content)

Drought (region food rate ×0.5 for N ticks), bumper harvest (×1.5), bandit camp (neutral raiders on a hex until cleared by soldiers), plague (settlement pop decay until quarantine edict). Each event = alert + king-facing choice where sensible (e.g., drought → "open the granaries": spend stock to prevent growth penalty). Seeded via `world.rng` at fixed cadence — determinism preserved. Size: one agent session for the framework + 2 events; more events are trivial after.

## WP7 — Resource depletion & regrowth (post-MVP content)

Forest hexes deplete with extraction (timber yield falls; at 0 the hex converts to plains), regrow slowly when unworked; ore/stone deplete permanently (mountains → hills → exhausted). Drives migration, makes LUMBER/MINING roles temporal, and gives the king's `expansion` slider long-term meaning. Requires: per-hex `richness` field, extraction multiplies by it, worldgen init, renderer tint. Re-balance check afterward (headless 20k-tick health run — settlements must adapt, not mass-starve).

---

## Order & sizing

| WP | Size | Depends on |
| :-- | :-- | :-- |
| 1 Policy substrate | S | war-balance work settled |
| 2 Governors read policy | M | 1 |
| 3 Save/load | M | none (parallelizable) |
| 4 Notifications | M | none (parallelizable) |
| 5 Player MVP | L | 1, 2, 4 (3 strongly recommended) |
| 6 Events | M | 4, 5 |
| 7 Depletion | M | 5 (re-balance after) |

Prerequisite for the whole roadmap: current war balance / military AI work (see `implement_war_balance.md`, `implement_military_ai.md` if present) verified — a king shouldn't inherit a broken army.
