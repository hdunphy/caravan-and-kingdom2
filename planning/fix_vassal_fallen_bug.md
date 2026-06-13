# Plan: Fix Vassal "Fallen" Bug + Add Vassal HUD Indicator

## Problem Summary

Aurelia and Thornwall show as **FALLEN** in the HUD but still have settlements visible on the map. The root cause is a partial-transfer bug in the tribute-failure annexation path. A secondary UI gap: living vassals have no visual indicator that they are vassals at all.

---

## Root Cause (Bug 1): Two problems with the tribute mechanic

**File:** `src/sim/diplomacy.js` — the vassal tribute loop, lines ~543–562.

```js
for (const s of mySettlements) {
  if (s.gold < 20) {
    log(world, `!!! ANNEXATION !!! ...`);
    s.factionId = masterId;          // ← only THIS ONE settlement is transferred
    world.agents = world.agents.filter(a => a.factionId !== fid);
    fac.eliminated = true;
    world.diplo.wars = world.diplo.wars.filter(w => w.a !== fid && w.b !== fid);
    break;                           // ← loop exits, other settlements orphaned
  } else { /* pay tribute per-settlement */ }
}
```

**Problem A — Wrong granularity:** Tribute is checked and collected settlement-by-settlement. One cash-poor town can trigger annexation of the entire faction, even if the faction as a whole is wealthy. The tribute relationship is between the vassal *faction* and the master, not between individual towns.

**Problem B — Partial transfer:** When annexation fires, only the single failing settlement gets `factionId = masterId`. All other settlements remain owned by the now-`eliminated` faction, orphaned on the map with no owner logic running on them.

These two bugs together produce the observed state: Aurelia/Thornwall marked FALLEN with settlements still visible in their color on the map.

---

## Fix 1: Faction-Level Tribute with Full Transfer on Default

Replace the entire tribute block (~lines 537–567, from `if (masterSettlements.length > 0)` to the closing brace) with faction-level logic:

```js
// B. Tribute payment & Annexation (faction-level, not per-settlement)
if (masterSettlements.length > 0) {
  const masterSettlement = masterSettlements[0];

  // Sum total gold across all vassal settlements
  const totalFactionGold = mySettlements.reduce((sum, s) => sum + s.gold, 0);
  const totalTribute = Math.floor(totalFactionGold * DIPLO.VASSAL_TRIBUTE_PCT);

  if (totalFactionGold < 20) {
    // Faction as a whole cannot pay — annexation
    log(world, `!!! ANNEXATION !!! ${fac.name} was unable to pay tribute. They have forfeited their lands and been annexed by ${masterFac.name}!`);
    for (const s of mySettlements) s.factionId = masterId;   // ALL settlements
    world.agents = world.agents.filter(a => a.factionId !== fid);
    fac.eliminated = true;
    world.diplo.wars = world.diplo.wars.filter(w => w.a !== fid && w.b !== fid);
  } else if (totalTribute > 0) {
    // Collect proportionally from each settlement so no single town is drained
    for (const s of mySettlements) {
      const share = Math.floor((s.gold / totalFactionGold) * totalTribute);
      s.gold -= share;
      masterSettlement.gold += share;
    }
    log(world, `${fac.name} paid ${totalTribute}g tribute to their overlord, ${masterFac.name}.`);
  }
}
```

Key changes from the old code:
- Annexation threshold is on **total faction gold** (`< 20`), not per-settlement.
- On annexation, **all settlements** are transferred to the master before `eliminated = true`.
- Tribute collection is proportional across settlements (richer towns pay more, poor towns pay little but don't veto the whole payment).

**After every change:** `node --check src/sim/diplomacy.js`, then `node test/headless.js 2500 42` and confirm determinism PASS.

**After every change:** `node --check src/sim/diplomacy.js`, then `node test/headless.js 2500 42` and confirm determinism PASS.

---

## Root Cause (Bug 2 / UI Gap): No Vassal Indicator in the HUD

**File:** `src/ui/hud.js` — the `rows` map starting at line ~38.

The current code has two states: `fac.eliminated` (→ "fallen") or alive (→ normal row with PEACE/WAR/MOBILIZE badge). Vassals that are alive (`vassalOf !== undefined`, `eliminated === false`) render identically to independent factions. The user has no way to see that Aurelia reports to Vesper, for example.

---

## Fix 2: Add Vassal Badge to HUD

In `src/ui/hud.js`, inside the `rows` map, after the `if (fac.eliminated)` early-return block, find where `focusHtml` is built (~line 54) and add a vassal badge before or after it:

```js
// existing focus badge
const focusHtml = `<span style="...>${focus}</span>`;

// NEW: vassal badge
let vassalHtml = '';
if (fac.vassalOf !== undefined) {
  const masterName = world.factions[fac.vassalOf]?.name ?? '?';
  vassalHtml = `<span style="font-size: 8px; padding: 1px 4px; border-radius: 4px; background: #8b572a22; border: 1px solid #8b572a; color: #c68642; font-weight: bold; margin-left: 4px;">VASSAL · ${masterName}</span>`;
}
```

Then include `${vassalHtml}` in the faction header HTML, right after `${focusHtml}`. For example:

```js
<div class="faction-header" style="display: flex; align-items: center; width: 100%;">
  <span class="swatch" ...></span>
  <span style="color:${fac.color}; font-weight:700;">${f.faction}</span>
  <span class="persona" style="margin-left: 6px;">${fac.persona ?? ''}</span>
  ${focusHtml}
  ${vassalHtml}
</div>
```

The badge should be a warm brown/gold to distinguish it from the PEACE/WAR/MOBILIZE badges. Example styling: background `#8b572a22`, border `#8b572a`, text `#c68642`.

---

## Verification Steps

1. `node --check src/sim/diplomacy.js` and `node --check src/ui/hud.js` — no syntax errors.
2. `node test/headless.js 2500 42` — determinism PASS.
3. Run until a vassalization occurs (seed 42 should produce one by tick 8000–12000 based on prior playtests). Confirm:
   - The newly-vassalized faction shows "VASSAL · [master]" badge in HUD.
   - The faction is NOT marked eliminated unless it has zero settlements.
   - If tribute failure fires, ALL settlements are transferred to the master's color on the map, and the faction correctly disappears from the kingdom panel (shown as fallen with no map presence).
4. Optional: add a Chronicle log check that the falling faction produces no lingering same-colored hexes after annexation.

---

## File Summary

| File | Lines affected | Change |
|---|---|---|
| `src/sim/diplomacy.js` | ~537–567 | Replace per-settlement tribute loop with faction-level gold sum, proportional deduction, and full-transfer annexation |
| `src/ui/hud.js` | ~54–63 | Add `vassalHtml` variable and inject into faction header |

Both changes are small and surgical. Do not touch the military/combat layer.
