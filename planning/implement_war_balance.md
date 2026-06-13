# Plan: War Balance — Make Wars Destructive and Decisive

Brief for an implementing agent. Playtesting at 200k ticks shows stagnation: wars flip one town or stalemate, towns flip back to their original owner, and all factions hover at equal power forever. Root cause: **wars don't destroy anything permanent** — soldiers cost 1 pop, sieges kill nobody until capture, and army size is a constant so accumulated advantage can't be expressed.

Three features. **Explicitly rejected by the user: "occupation stability" buffs for captured towns.** A captured town SHOULD be weaker (sacked pop, thin garrison) — but the conquering soldiers stationed there must genuinely receive the town's defensive role, and we must verify they aren't retreating or vanishing after a capture (§0).

## ⚠ Codebase drift warning

This file's code references were written against an older snapshot. The repo now contains user additions: faction `focus` (PEACE/MOBILIZE/WAR) in governors/diplomacy, `getSettlerCost` scaling, Market Hall construction, and possibly modified `conductWar`/`recruitSoldiers`. **Read the current code first; adapt these specs to it rather than pasting blindly.** Key files: `src/sim/diplomacy.js` (Court, combat, sieges, capture), `src/sim/systems.js` (metabolism, logistics), `src/core/constants.js` (`DIPLO`, `ECON`). After every step: `node --check` touched files and `node test/headless.js 2500 42` (determinism must pass).

---

## 0. Pre-work diagnostic: verify capture garrisons (user-reported suspicion)

The intended behavior in `captureSettlement` (`src/sim/diplomacy.js`): surviving attackers get `homeId = capturedTown.id`, `state = 'idle'`, standing on the town hex — which makes them count in `settlementDefense` (its filter requires exactly that: soldier, homeId match, idle, at town coords) and heal via `healAndAttrition`'s at-home branch.

**Verify in current code, then prove it dynamically.** Write `tools/wardiag2.mjs` (or extend `wardiag.mjs`): run seeds 42/123/777 for 30k ticks and record, per capture event: (a) number of surviving attackers re-homed as garrison, (b) `settlementDefense` of the town one tick after capture, (c) whether the same town is recaptured by its original owner within 5,000 ticks. If (a) is 0 or (c) exceeds ~50%, find out where the garrison goes — candidate bugs: peace treaties calling `cancelMission` on garrison soldiers and sending them to a *stale* home; `manageGarrison` disbanding them as "surplus"; `healAndAttrition` field-decaying them because some state check fails. Fix what's found and re-measure. This diagnostic also produces the baseline metrics for §4.

---

## 1. Pop-costed soldiers

A soldier is a company of people, not one person. Wars must depopulate.

Constants (`DIPLO`): `SOLDIER_POP_COST: 15`, `DISBAND_POP_RETURN: 0.5`.

- `recruitSoldiers`: replace `s.population -= 1` with `-= DIPLO.SOLDIER_POP_COST`; require `s.population > 40` (don't hollow out villages) instead of the current `> 15`.
- `manageGarrison` disband: return `Math.round(SOLDIER_POP_COST * DISBAND_POP_RETURN)` pop to the home settlement (currently returns 1).
- Soldier deaths (field battles, siege counter-damage, attrition) return nothing — that's the point. No code change needed there.
- Check every other `spawnAgent(world, 'soldier', ...)` call site for consistency (the user's focus/mobilize system may have added one).

Knock-on to watch: recruiting now removes 15 food-consumers, briefly *improving* food days. Acceptable. Militia (`MILITIA_PER_POP`) unchanged.

**Out of scope (noted as a future option, user approved only the three features):** soldiers drawing food upkeep from their home settlement.

## 2. Siege casualties (~20% of population for a typical siege)

Three effects while a settlement is under siege (`s.siegeHp != null`):

1. **Bombardment/starvation deaths** — in the siege block of `combatSystem`, each tick: `s.population = Math.max(5, s.population - s.population * DIPLO.SIEGE_DEATH_RATE)`. With `SIEGE_DEATH_RATE: 0.0011` a typical ~200-tick siege kills ~20%. Track cumulative loss per siege (`s.siegeDeaths`) and stop at `SIEGE_DEATH_CAP: 0.35` of the pre-siege population so multi-stage stalemates can't empty a city; reset the tracker when the siege lifts or the town falls.
2. **Trapped villagers** — `logisticsSystem`: idle villagers whose home is besieged get no new missions (they shelter). Caravan dispatch (`tradeGovernor`, `transportGovernor`) skips besieged settlements as origin AND as trade/freight destination — a siege is a blockade. Agents already in flight complete normally.
3. **Rationing** — `metabolismSystem`: `need *= 0.5` while besieged ("siege rations"), so the blockade starves slowly rather than instantly; growth is naturally impossible (food days collapse).

Since sieges now kill ~20% on their own, reduce the capture sack: `CAPTURE_POP_LOSS: 0.25 → 0.1`. Net loss for a fallen town stays ~30%, but most of it happens *during* the siege, visibly, and failed sieges also leave scars.

Determinism: all of this is arithmetic on existing state — no RNG. Keep it that way.

## 3. Scaled army caps (let advantage express itself)

Replace the constant army size (`ARMY_BASE + ARMY_PER_AGGRESSION × aggr`) wherever it gates recruitment (`conductWar`, and the war-chest check in `considerWar` — adapt to current code, the focus system may have moved these):

```js
// constants
POP_PER_SOLDIER: 45,    // 1 company per 45 faction population
ARMY_MIN: 4,
// helper in diplomacy.js
function armyCap(world, fid) {
  const pop = settlementsF(world, fid).reduce((a, s) => a + s.population, 0);
  const aggr = traitsF(world, fid).aggression ?? 1;
  return Math.max(DIPLO.ARMY_MIN, Math.round((pop / DIPLO.POP_PER_SOLDIER) * (0.7 + 0.3 * aggr)));
}
```

- Wartime recruitment target = `armyCap`. Peacetime garrison target = `min(current per-settlement formula, armyCap)`.
- War chest check in `considerWar`: use `armyCap(world, fid) * WAGE_SOLDIER * 1500` (scales with the army actually fielded).
- Sanity: a 4,000-pop empire fields ~90-110 soldiers vs a 1,200-pop rival's ~30 — decisive, which is the goal. But note the **interaction with §1**: fielding 100 soldiers consumes 1,500 pop. That's the real cost loop — big armies eat the demographic advantage that justified them. This is intended; don't "fix" it.
- Performance note: 100+ soldiers is fine (we've run 470+ agents), but field battles iterate hex buckets — keep the sorted-key iteration for determinism.

## 4. Balance targets & test plan

Extend the §0 diagnostic and run seeds 42/123/777 × 40k ticks (chunk runs; ~3-4 ms/tick late-game):

| Metric | Target |
| :--- | :--- |
| Pop casualties per successful siege | 15–30% of pre-siege pop |
| Towns recaptured by original owner within 5k ticks | < 30% of captures |
| Faction power spread at 40k ticks (max pop / min pop, living factions) | > 2.0 on ≥ 2 of 3 seeds (i.e., a clear leader emerges) |
| Eliminations across 3 seeds | ≥ 1 somewhere (stakes are real) |
| Soldier deaths per war | > 0 on every war (no bloodless wars) |
| `node test/headless.js 2500 42` | determinism PASS after every step |

If power spread stays ~1.0 after all three features, the remaining suspects are (in order): truce + pinned relations guaranteeing symmetric rematches (try raising `DIPLO.DRIFT` post-war), exhaustion ending wars too early for the stronger side (`EXH_SETTLEMENT_LOST` down for the winner only), and the MOBILIZE focus freezing both belligerents' economies symmetrically. Report findings rather than tuning all three blindly.

## Suggested order

1. §0 diagnostic (baseline numbers + garrison verification — fixes any flip-back bug found)
2. §1 pop-costed soldiers (smallest, immediate depopulation effect)
3. §2 siege casualties
4. §3 scaled army caps
5. §4 full measurement pass; tune `SIEGE_DEATH_RATE`, `POP_PER_SOLDIER` against the table
