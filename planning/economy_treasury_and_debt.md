# Implementation Plan: Faction Treasury, Recoverable Debt, and Economy-Gated Soldiers

Three interlocking economy changes, designed together:

1. **Gold becomes a faction treasury** (one pool per faction) instead of per-settlement piggy banks. Physical resources (food/timber/stone/ore) stay local.
2. **Bankruptcy becomes recoverable debt** with an exponentially scaling growth penalty. Shallow debt is a nuisance; **−1000 is a death sentence** (population decline, not just stalled growth). Replaces the current desertion-spiral.
3. **Soldiers are no longer hard-capped.** `armyCap` becomes the AI's *chosen target*, not an engine ceiling. The player recruits as far as **population + treasury** sustain. Over-recruiting is balanced by the debt system.

Why together: uncapping soldiers is only safe because over-recruiting now drives debt, and debt now bites. Pooling gold makes both the debt state and the war/diplomacy math (which already sums gold via `goldF`) coherent.

Grounded in branch `add-player`, commit `1d8a738`. **Re-grep symbols before editing — line numbers drift.** Standing rules: `npm run typecheck` + `npm run test:headless -- 2500 42` after changes; sim never imports from `src/ui/`; the sim must stay deterministic.

> Environment note: the reviewer's sandbox had a truncated working tree + corrupt git index. If on-disk files look truncated, recover with `git read-tree HEAD && git checkout-index -a -f`, or review via `git show 1d8a738:<path>`. No commits lost.

---

## Current state (what we're changing)

- Gold is stored per-settlement as `s.gold` (init `ECON.GOLD_START = 100`). It is summed to faction level *ad hoc* by `goldF(world, fid)` in `src/sim/diplomacy/helpers.ts` for war exhaustion, war-chest checks, tribute, and reparations. So a faction treasury already exists implicitly — it's just scattered.
- Same-faction settlements even trade gold with each other (`src/sim/agents/arrival.ts` moves gold between `home`/`buyer`/`seller` regardless of faction) — effectively paying yourself.
- Bankruptcy (`src/sim/systems/maintenance.ts`): each settlement pays its own wage + upkeep bill; if `s.gold < bill` it fires a `BANKRUPT` alert, clamps `gold = 0`, and unpaid agents desert at `DESERTION_CHANCE` (0.003/tick), protected by `DESERTION_FLOOR` (3 villagers). This is a death spiral: losing workers cuts production → less income → more desertion.
- Soldiers: `recruitSoldiers(world, fid, target)` (`src/sim/diplomacy/war.ts`) recruits toward `target * policy.recruitment`, where the target is `armyCap(world, fid)` (`src/sim/diplomacy/strength.ts`): `max(ARMY_MIN(4), round(pop / POP_PER_SOLDIER(45) * (0.7 + 0.3*aggr)))`. Per-settlement guards: pop > 40, `SOLDIER_POP_COST` 15 pop each, `maxPerSettlement` 1 (peace) / 3 (war). Net: a hard pop-derived ceiling.

---

# Part A — Faction treasury

**Goal:** gold lives on the faction. Physical resources stay on settlements.

### A1. Data model
- Add `treasury: number` to the `Faction` interface in `src/types.ts`. (Keep the `Policy` etc. as-is.)
- `src/sim/worldgen.ts`: init `treasury: ECON.GOLD_START * <#settlements at spawn>` (or a flat faction start — pick one and note it). Remove per-settlement `gold` init, OR keep `s.gold` only as a **derived display field** (see A4). Recommend: remove the authoritative `s.gold`; compute display separately.
- Add a helper module surface (extend `src/sim/policy.ts` or a new `src/sim/economy.ts`):
  - `treasuryOf(world, fid): number`
  - `spendGold(world, fid, amount): boolean` — deducts; returns false if it would breach the debt floor (see Part B) when that matters, true otherwise. Most callers can spend into mild debt.
  - `addGold(world, fid, amount): void`

### A2. Convert every gold read/write (full call-site list)
Replace `s.gold` access with faction-treasury access. Sites found:
- `src/sim/systems/metabolism.ts:24` — tax income: add to `faction.treasury`, not `s.gold`.
- `src/sim/systems/maintenance.ts` — wages + building upkeep now bill the **faction treasury once** (sum the whole faction's wage+upkeep bill, deduct from treasury). This is the big simplification and the source of the noise fix.
- `src/sim/settlement.ts:91,99` — `canAfford`/`spend` special-case `res === 'gold'`: route the gold leg to `treasuryOf`/`spendGold`. Resource legs stay on `s.stock`.
- `src/sim/governors/labor.ts:26`, `transport.ts:18` — recruit/caravan gold gates → check treasury.
- `src/sim/governors/civil.ts` — build costs, Market Hall (`gold >= 80`), MOBILIZE/WAR `gold < 200` checks → treasury.
- `src/sim/governors/trade.ts` — buying with gold, `o.gold` buyer checks → treasury.
- `src/sim/agents/arrival.ts` — trade settlement: **inter-faction** trade moves gold treasury→treasury; **intra-faction** trade drops the gold leg entirely (just transfer the resource). This removes the "pay yourself" incoherence.
- `src/sim/diplomacy/peace.ts:73-76` — reparations: percentage of loser **treasury** to winner treasury.
- `src/sim/diplomacy/peacetime.ts:39-43` — gifts: from giver treasury to recipient treasury (drop the "find richest settlement" logic; just use treasury).
- `src/sim/diplomacy/court.ts:158,311,412-427` — war-broke exhaustion, and **vassal tribute** becomes a simple treasury→treasury transfer (delete the per-settlement share-out loop).
- `src/sim/diplomacy/war.ts:114-115` — war-chest / soldier gold cost → treasury.
- `src/sim/diplomacy/helpers.ts:9` — `goldF` collapses to `return treasuryOf(world, fid)`. Keep the name as a thin alias so callers don't all change at once.
- `src/sim/gameLoop.ts:41,67` — history sampling `gold` → `treasuryOf`.

### A3. Constants
- `ECON.GOLD_START` stays (re-interpret as per-faction or per-settlement-at-spawn — document the choice).

### A4. Preserve the lost signal (derived per-settlement economics)
Per-settlement gold was a useful readout (rich hub vs poor frontier). Replace it with a **derived, non-authoritative** per-settlement net-gold/tick (income contribution − local wage/upkeep share), computed for display only and shown in the Inspector. Do **not** let it drive any sim decision.

**Accept (Part A):** `npm run typecheck` clean; headless determinism PASS; a faction's total spending power is unchanged in aggregate vs. the old summed-gold behavior at defaults (sanity-check a short run); no same-faction gold transfers remain.

---

# Part B — Recoverable debt with exponential penalty

**Goal:** the treasury may go negative. Growth penalty scales super-linearly with debt depth; −1000 is terminal.

### B1. Remove the desertion spiral
In `src/sim/systems/maintenance.ts`, delete the `gold = 0` clamp + `DESERTION_CHANCE` loop. Instead: deduct the full faction wage+upkeep bill from the treasury **even if it goes negative**. (Retire or repurpose `DESERTION_CHANCE` / `DESERTION_FLOOR` constants.)

### B2. Exponential growth penalty
Where population growth is applied (`src/sim/systems/metabolism.ts`, the growth-rate block), apply a treasury-debt factor. With `D = max(0, -treasuryOf(world, fid))`:
- `D = 0` → factor `1.0` (no penalty).
- Quadratic toward the −1000 anchor: `growthFactor = max(0, 1 - (D / DEBT_DEATH)²)` with `DEBT_DEATH = 1000`.
  - ≈ −6% growth at −250, −25% at −500, −56% at −750, **0% at −1000**.
- **Past −1000:** flip to **population decline**, accelerating with depth, e.g. `decayRate = BASE_DECAY * (D / DEBT_DEATH - 1 + 1)` → tune so the spiral is unrecoverable but not instant. This is what makes −1000 a death sentence while shallow debt stays fully recoverable.
- Stack this multiplicatively with the existing tax/ration growth penalties (`taxRate > 1.2`, `rations < 0.8`).

### B3. Constants (add to `src/core/constants/economy.ts`)
- `DEBT_DEATH: 1000` — debt depth at which growth hits zero / decline begins.
- `DEBT_AUSTERITY: 350` — depth at which AI emergency austerity kicks in (Part C). Start before the cliff so the AI has runway.
- `DEBT_DECAY_BASE: <tune>` — population decline rate per tick past `DEBT_DEATH`.

**Accept (Part B):** scripted test — a faction forced to −500 grows slower but recovers when income restored; forced to −1000+ it declines and cannot recover; determinism PASS. No more `DESERTION` events.

---

# Part C — AI fiscal austerity (governors react to debt)

**Goal:** AI manages debt deliberately — like SURVIVE, but for money, **with food still taking priority.**

### C1. Goal ordering
In `evaluateGoal` (`src/sim/governors/index.ts`), insert a fiscal check **after** the food check so food always wins:
```
if (foodDays < 15) { s.goal = SURVIVE; return; }                 // food first (unchanged)
if (treasuryOf(world, s.factionId) <= -ECON.DEBT_AUSTERITY)      // NEW
    { s.goal = AUSTERITY; return; }
if (totalStock < 100) { s.goal = THRIFTY; return; }
... // normal goals
```
Add an `AUSTERITY` goal to `GOALS` (`src/core/constants/tiers.ts`) — or reuse `THRIFTY` if its behavior already halts spending; a distinct goal reads more clearly.

### C2. Austerity behavior
While a faction is in austerity (treasury below `−DEBT_AUSTERITY`):
- **Stop** recruiting soldiers, building, and expanding (gate these in `civil.ts` / `labor.ts` / the Court).
- **Disband soldiers first** — they're the biggest wage line (`WAGE_SOLDIER` 0.03 vs `WAGE_VILLAGER` 0.004). Add a Court step that releases soldiers down toward a minimal garrison while insolvent; shedding wages is the fastest way out and is self-correcting.
- **Raise taxes**: AI Court bumps `policy.taxRate` up while in debt (and relaxes it once recovered).
- **Sell for gold**: bias `tradeGovernor` toward exporting surpluses for gold.
- Scale urgency with depth: mild belt-tightening near `−DEBT_AUSTERITY`, full emergency as it approaches `−DEBT_DEATH`.

Apply the same logic to **all** AI factions (and to a player faction's Court only when `playerFactionId` doesn't own it — the player manages their own debt via the policy UI).

**Accept (Part C):** in a long headless run, factions that dip into debt take the AUSTERITY goal, disband soldiers, raise taxes, and most claw back above water; none exploit unbounded debt; food crises still override fiscal ones; determinism + health PASS (settlements adapt, not mass-die).

---

# Part D — Economy-gated soldiers (remove the hard cap)

**Goal:** `armyCap` is the AI's chosen target, not an engine ceiling. The player recruits as far as pop + treasury allow.

### D1. Keep the natural limiters (already present)
Each company costs `SOLDIER_POP_COST` (15) pop up front + `WAGE_SOLDIER` (0.03) gold/tick ongoing, and a settlement won't recruit below the pop floor. These are the real constraints — keep them.

### D2. Decouple the cap
- `src/sim/diplomacy/war.ts` `recruitSoldiers`: stop treating the passed `target` as a hard ceiling for the **player**. For AI callers, `armyCap` remains the target (sane self-limited army). For the player, the target comes from the player's recruitment control, bounded only by available pop + treasury.
- Practically: change the early-return so it limits by resources/pop, not by an artificial max. Keep `policy.recruitment` as the player's lever (consider letting it set a desired army size or simply removing the `armyCap` clamp for the player path).
- `armyCap` in `src/sim/diplomacy/strength.ts` stays for AI strategic sizing; document that it's now a *preference*, not a limit.

### D3. Balance interaction
Over-recruiting now drains pop and piles on wages → debt → exponential penalty → forced austerity (disband). So the cap removal is self-balancing; verify in headless that a war-spamming faction self-corrects rather than snowballing infinitely.

**Accept (Part D):** with surplus pop + treasury the player can exceed the old `armyCap × recruitment`; an AI left alone still fields a sane army near `armyCap`; a faction that over-recruits goes into debt and is pushed into austerity; determinism + health PASS.

---

## Determinism & save migration

- All new state (`faction.treasury`) is plain data seeded from `world.rng`/init — deterministic. The debt penalty and austerity decisions are pure functions of world state.
- `src/sim/serialize.ts`: add `faction.treasury` to save/load. **Migration:** on loading an old save (settlements have `gold`, factions have no `treasury`), set `faction.treasury = sum(settlement.gold)` and drop `s.gold` (or keep as derived). Round-trip test must still PASS.
- Re-run the long-horizon health check (the roadmap's 20k-tick run is ideal here) — the whole point is that factions *adapt* to debt, not mass-starve or mass-bankrupt.

## Suggested order & sizing

| Part | What | Size | Notes |
| :-- | :-- | :-- | :-- |
| A | Faction treasury + call-site conversion + serialize migration | L | broad but mechanical; do first |
| B | Recoverable debt + exponential penalty (remove desertion) | M | depends on A |
| C | AI austerity goal + disband/raise-tax/sell behavior | M | depends on A, B |
| D | Economy-gate soldiers (uncap) | S | do after B/C so it's balanced |

**Definition of done:** gold is a single per-faction treasury (no same-faction transfers, no per-settlement bankruptcy); debt is recoverable with an exponential growth penalty that becomes terminal at −1000; AI enters austerity (disband soldiers, raise taxes, sell surpluses) below `−DEBT_AUSTERITY` while food crises still take priority; soldiers are limited by pop + treasury rather than a hard cap; `npm run typecheck` clean; `npm run test:headless -- 2500 42` and a long-horizon run PASS (determinism + save/load + health, factions adapt to debt); save migration from old per-settlement gold works.
