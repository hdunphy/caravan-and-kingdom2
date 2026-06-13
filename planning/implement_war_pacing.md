# Plan: War Pacing & Snowball — Make Dominance Decisive

Brief for an implementing agent. Playtest: wars are short, gaps between wars grow ever longer, and a faction with a 2× lead (Vesper: 20 towns/9k pop vs 11/6k vs 10/4k) cannot convert it. Desired feel: a full game arc in ~1 hour of play (settlement phase → volatile contested midgame → a leader snowballs and eventually steamrolls). Higher risk/reward; underdogs opportunistic; leaders aggressive.

This is Court-layer work in `src/sim/diplomacy.js` + `DIPLO` constants. No new systems. The military/siege layer is healthy (see `WAR_BALANCE_RESULTS.md`) — don't touch it.

**Verified in current code (line refs approximate, re-check before editing):**
- Truce escalation EXISTS: `d.warCounts` + `TRUCE_REPEAT_SCALING: 1000` in `makePeace` (~line 586-590) — each rematch lengthens the truce. This is the "wars further and further apart" bug, by design.
- Vassal mechanic EXISTS (~lines 96-130, 461-525, 555-580, 665-685): tribute 20%/court, vassalization at peace when single loser and winner pop ≥ `VASSAL_POP_RATIO_REQ: 3.0`, independence at 0.8× master pop or hostile relations, master defends vassal, vassals join master's wars, vassals can't declare or pact.
- Pacts/alliances EXIST (`PACT_RELATION_REQ`, ~line 216): relation-gated, both-at-peace, non-vassals. **Keep as-is** — observed frozen pairs sit at −100/truce, so pacts aren't the blocker.

After every change: `node --check`, `node test/headless.js 2500 42` (4 factions, mapRadius 24), determinism PASS.

---

## 1. Multi-war with strength budgeting (user-specified design)

**Anyone may enter multiple wars** — remove the `atWarAny()` exclusions in `considerWar` (both the self check and the target check). What replaces them is a commitment budget:

```js
// committed strength: what my existing wars demand of me
function committedStrength(world, fid) {
  let c = 0;
  for (const w of world.diplo.wars) {
    if (w.a !== fid && w.b !== fid) continue;
    const enemy = w.a === fid ? w.b : w.a;
    c += strengthOf(world, enemy) * DIPLO.COMMIT_FACTOR; // 0.8: holding a front costs ~80% of enemy strength
  }
  return c;
}
```

- **Declaration check** becomes: `strengthOf(me) − committedStrength(me) > targetEffectiveStrength × (ADVANTAGE / aggression)`.
- **Target's effective strength** is where opportunism lives: a target already fighting on other fronts is weaker than it looks. Opportunistic courts (use the `aggression` trait; ≥ 1.0 qualifies — or add an explicit `opportunism` trait if preferred) discount it:
  `targetEffective = strengthOf(target) − committedStrength(target) × opportunismFactor` where `opportunismFactor = clamp(aggression − 0.5, 0, 1)`.
  A cautious court (aggression 0.6) sees the target at near-full strength; a wolf (1.4) sees the exposed flank. This makes dog-piling an engaged leader natural — your underdog volatility — while the same math lets a dominant leader open a second front it can actually afford.
- War-chest check scales with the *combined* projected armies across all wars (sum of per-war army needs, not just the new one).
- Vassal strength counts toward the master's `strengthOf` in these calculations (vassals join the master's wars — already implemented — so budget accordingly).

Constants: `COMMIT_FACTOR: 0.8`.

## 2. Remove truce escalation (user-verified bug)

Delete `TRUCE_REPEAT_SCALING`, `d.warCounts`, and the `repeatBonus` term in `makePeace` — truces are flat `TRUCE_TICKS` again. Observed loop today: pairs pinned at −100 → truce → war the court after expiry → repeat with +1000 ticks each round. With escalation gone the cadence stays steady.

Optionally (single knob, measure separately): lower `TRUCE_TICKS` 2000 → 1500 to tighten the war:peace duty cycle toward the 1-hour arc. Do NOT add any other relations changes in this pass — the −100 pinning means the relations gate is not the bottleneck.

## 3. Exhaustion rework: weaker exponent + forced concessions

Keep the exponential time exhaustion but soften it — read the current implementation first (constants like `EXH_GROWTH`/exponent params from the military-AI work), then halve its bite, e.g. growth base 1.5 → 1.2 per 1000 ticks, so a war one side is *winning* has room to run long. Capture relief for the winner stays as-is.

**New: peace under domination costs territory.** In `makePeace`, when the exhaustion gap is extreme — loser ≥ `SUE_THRESHOLD` (70) while winner ≤ `DOMINANT_EXH: 20` — the loser cedes one settlement on top of reparations:

- Choose the loser's settlement nearest to any winner settlement (the border town), excluding their last settlement (that path is conquest/vassalization, not diplomacy).
- Transfer is the same operation as capture minus the sack: `factionId` flips, local agents of the loser disband, no pop/stock loss, winner garrisons it with nothing (it starts exposed — retaking it is a legitimate next-war goal).
- Log loudly: `"${loser} ceded ${town} to ${winner} in the peace of ${tick}"`.

Result: even a war with zero successful sieges moves the map if one side dominated the field — and a 100%-vs-10% exhaustion war ends with the dominated side paying in land, which is the risk/reward you want.

Constants: `DOMINANT_EXH: 20`.

## 4. Vassal mechanic: tune, don't rebuild (assessment)

The existing implementation is structurally sufficient — tribute, joint wars, master defense, independence — but its trigger never fires at realistic leads:

1. **`VASSAL_POP_RATIO_REQ` 3.0 → 2.0.** Observed dominant leads are 2-2.5×. At 3.0 the mechanic is dead code in practice.
2. **Add mid-war capitulation:** vassalization currently only happens at peace. Add a Court check during war: if loser exhaustion ≥ 90 AND winner pop ≥ 2× loser pop → immediate surrender → vassalization (reuse the existing peace-time vassalization block, then `makePeace` with no further terms). This is what turns a steamroll into a collapse instead of ten more sieges.
3. **Verify annexation exists.** The comment at ~line 461 says "tribute, annexation, and independence checks" — confirm there's a path where a long-held vassal is absorbed (e.g., after `VASSAL_ANNEX_TICKS: 8000` as vassal with master ≥ 3× pop, settlements transfer to master). If it's missing, add it — it's the endgame terminator that gets a 1-hour game to an actual conclusion.
4. **Independence stays as-is** (0.8× pop or hostile breakaway) — that's the underdog comeback path and adds late-game volatility.

## 5. Measurement (extend `tools/wardiag2.mjs` / `warrun.mjs`)

Run seeds 42/123/777 × 60k ticks (chunked via warrun). Targets for the 1-hour arc, scaled to tick rate (~16× ≈ 128 ticks/s → 1 hour ≈ 450k ticks; these 60k-tick runs should show the midgame shape):

| Metric | Target |
| :-- | :-- |
| Mean gap between wars (per faction pair) | < 4,000 ticks, NOT growing over time |
| Concurrent wars observed | ≥ 1 instance of a faction in 2 wars per seed |
| Dog-pile events (war declared on a faction already at war) | ≥ 1 per seed |
| Ceded settlements via peace terms | ≥ 1 per seed |
| Vassalizations | ≥ 1 across the three seeds |
| Leader's settlement share at 60k when pop lead ≥ 1.8× at 30k | growing, not flat (snowball check) |
| Determinism | PASS |

If the leader still stalls with all of the above: the remaining suspect is MOBILIZE freezing the leader's economy during its wars (it pays opportunity cost for every war while peaceful rivals grow) — measure before touching.

## Order

1. §2 truce escalation removal (one-line revert, immediate cadence fix)
2. §4.1 vassal ratio 2.0 (one constant)
3. §3 exhaustion soften + cession
4. §1 multi-war budgeting (largest change)
5. §4.2-4.3 capitulation + annexation
6. §5 measurement pass, tune `COMMIT_FACTOR` / `DOMINANT_EXH` / truce length
