# Plan: Balance — Tier Inflation & Expansion Sprawl

Tuning pass only. No new systems. Two independent issues that each have a single clean lever, plus one optional follow-up per issue.

After every change: `node --check`, then `node test/headless.js 2500 42` — determinism PASS. Re-run with seeds 123 and 777 for a wider picture.

Target state: Cities are genuinely large (pop 80+), a 1-hour game arc has 15–25 settlements not 42, and faction gold curves stay healthy.

---

## Issue 1: City-Tier Inflation

### Root cause

In `src/sim/governors.js`, `evaluateGoal` (~line 55):

```js
if (tier.next && s.population > tier.popCap * 0.6) { s.goal = GOALS.UPGRADE; return; }
```

The `0.6` threshold fires very early:
- Village (popCap 30) → Town: triggers at pop **18**
- Town (popCap 70) → City: triggers at pop **42**

A settlement that upgrades at pop 42 is a "City" in the data but behaviorally a medium town. The City efficiency multiplier (`1.6×` vs Village's `1.0×`) means there is strong economic pressure to upgrade as fast as possible — the upgrade is pure gain once you can afford the materials.

### Fix: Raise the upgrade threshold to 0.8

Change the single constant in `evaluateGoal`:

```js
// before
if (tier.next && s.population > tier.popCap * 0.6) { s.goal = GOALS.UPGRADE; return; }

// after
if (tier.next && s.population > tier.popCap * 0.8) { s.goal = GOALS.UPGRADE; return; }
```

New triggers:
- Village → Town: pop > **24** (was 18)
- Town → City: pop > **56** (was 42)

At 0.8 a settlement has demonstrably outgrown its tier before it starts saving for an upgrade. Cities will be pop 60–150, which is a meaningful signal. The material cost of upgrading (300 timber + 220 stone for Town → City) already acts as a further brake, so 0.8 should not feel punishing.

### Optional: Widen the efficiency gap between tiers

If Cities are still too common even at 0.8, re-examine the efficiency ladder in `src/core/constants.js`:

```js
VILLAGE: { efficiency: 1.0 }
TOWN:    { efficiency: 1.25 }
CITY:    { efficiency: 1.6 }
```

The Town→City efficiency jump (1.25 → 1.6 = +28%) is large. Consider 1.4 instead of 1.6 to reduce the urgency of chasing City status. Only adjust this if the threshold change alone doesn't solve the signal problem — measure first.

---

## Issue 2: Rampant Expansion (42 settlements by tick 2500)

### Root cause — two contributing factors

**Factor A: `EXPAND_MIN_POP` is too low.** In `src/sim/governors.js` `evaluateGoal` (~line 56):

```js
if (s.population >= ECON.EXPAND_MIN_POP / t.expand && s.tier !== 'VILLAGE' && !s.pendingSettler) {
  s.goal = GOALS.EXPAND; return;
}
```

`EXPAND_MIN_POP: 25` in constants.js. A balanced faction (expand: 1.0) expands at pop 25; Vesper (expand: 1.5) expands at pop 17. These are thin settlements that haven't consolidated — they are exporting people and materials before they are established.

**Factor B: `WIDE_TAX_MAX_PENALTY` caps too low.** In `src/core/constants.js`:

```js
WIDE_TAX_THRESHOLD: 3,        // settlements before corruption starts
WIDE_TAX_CORRUPTION: 0.04,    // tax penalty per settlement above threshold
WIDE_TAX_MAX_PENALTY: 0.35,   // max penalty cap
```

The corruption penalty maxes out at 35% once a faction hits (0.35 / 0.04) + 3 = ~12 settlements. Beyond 12 towns there is zero additional tax cost for any further expansion — the disincentive is fully saturated. With 42 settlements, the wide-tax system is simply not in play for most of the game. The cap was cut from 0.6 → 0.35, which was probably too aggressive.

### Fix A: Raise `EXPAND_MIN_POP` to 40

In `src/core/constants.js`:

```js
// before
EXPAND_MIN_POP: 25,

// after
EXPAND_MIN_POP: 40,
```

New expansion triggers:
- Balanced faction (1.0): pop ≥ 40 (was 25)
- Vesper (1.5): pop ≥ 27 (was 17)
- Aurelia (0.9): pop ≥ 44 (was 28)

This means a settlement must be a healthy, growing Town before it funds a colony, not a freshly founded one. The `SETTLER_SCALING` cost (50% increase per existing settlement) remains in place, so late-game over-expansion still gets expensive.

### Fix B: Restore `WIDE_TAX_MAX_PENALTY` to 0.5

In `src/core/constants.js`:

```js
// before
WIDE_TAX_MAX_PENALTY: 0.35,

// after
WIDE_TAX_MAX_PENALTY: 0.5,
```

This means the corruption cap maxes out at (0.5 / 0.04) + 3 = ~16 settlements (up from 12). Beyond 16 towns there is still no incremental pain, but at 0.5 the maximum penalty is painful enough that large empires feel the overhead. At 0.35 a faction running 42 settlements only faced a 35% tax hit — not much for a sprawling empire with a diversified economy.

Do NOT change `WIDE_TAX_CORRUPTION` (0.04) at the same time; adjust one lever per measurement pass.

### Optional: Require population at the sending settlement to stay above a floor after settlers leave

The current code subtracts `ECON.SETTLER_POP: 10` from the sender's population. A Town of pop 25 sends settlers and drops to 15, which can tip it into starvation. No guard prevents this. Consider adding a check in `civilGovernor` before dispatching:

```js
// in civilGovernor, before pay(s, sCost) / spawnAgent:
const minRetained = ECON.EXPAND_MIN_POP; // don't send if it would hollow the town
if (s.population - ECON.SETTLER_POP < minRetained) return;
```

This is a secondary guard — if EXPAND_MIN_POP is 40, a sender is already at 40+ and losing 10 pop leaves 30+, which is still a viable Village. Only matters if EXPAND_MIN_POP ends up tuned lower again.

---

## Implementation Order

1. **Raise `EXPAND_MIN_POP`: 25 → 40** (constants.js) — one line, largest effect on settlement count.
2. **Raise upgrade threshold: 0.6 → 0.8** (governors.js line ~55) — one line, fixes City signal.
3. Headless run seeds 42/123/777 at 2500 ticks. Check settlement count (target ≤ 25) and City pop distribution (target: most Cities > 60 pop).
4. **Raise `WIDE_TAX_MAX_PENALTY`: 0.35 → 0.5** (constants.js) only if settlement count is still too high after step 1.
5. Efficiency multiplier adjustment (1.6 → 1.4) only if City count is still out of line after step 2.

## File Summary

| File | Constant / line | Change |
|---|---|---|
| `src/core/constants.js` | `EXPAND_MIN_POP` | 25 → 40 |
| `src/core/constants.js` | `WIDE_TAX_MAX_PENALTY` (if needed) | 0.35 → 0.5 |
| `src/sim/governors.js` | `evaluateGoal` ~line 55 | `0.6` → `0.8` |
| `src/core/constants.js` | `CITY efficiency` (if needed) | 1.6 → 1.4 |
