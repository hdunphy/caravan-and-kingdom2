# Plan: Military AI Overhaul — War Council, Operations & Exponential Exhaustion

## Problem Statement

Vesper and Thornwall enter war but neither side acts — soldiers sit in garrisons reinforcing endlessly while nobody marches, raids, or fights. The current `conductWar` is two if-statements: march if you're the aggressor *or* 1.2× stronger, otherwise sit home. With pop-scaled army caps both sides recruit to similar caps simultaneously, so neither ever reaches the local advantage threshold. Meanwhile Aurelia captures the entire map unopposed. Wars need to *resolve* — through active military operations that create asymmetry.

### Root Cause Analysis (current code: [diplomacy.js](file:///c:/Users/hdunp/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/6c3a86ac-9fe2-4242-9682-0fb3a5279249/b3c093a8-f8d0-4976-9994-1d9c2278542e/local_871e485e-65bf-4454-b7f0-35b3a6564ee5/outputs/caravan-and-kingdom/src/sim/diplomacy.js) L388-431)

1. **Only aggressors march** — `offensive = side === war.a || strength > enemy * 1.2` means the defender never sorties
2. **Piecemeal dispatch** — soldiers march individually as they're recruited, arriving one-by-one and accomplishing nothing
3. **No raiding** — pillage code exists (L563-593) but only triggers when soldiers stand on enemy hexes, and nobody marches there
4. **Linear exhaustion** — `EXH_TICK * INTERVAL / aggr` accrues at constant rate; stalemates never accelerate toward peace
5. **No capture momentum** — winning a settlement doesn't reduce winner's exhaustion, so winners have no incentive to press on

---

## Proposed Changes

Three interconnected features, no optional stalemate detector.

---

### 1. War Council — Utility-Based Operation Scoring

Replace `conductWar()` with a **War Council** that scores a menu of military operations each Court session, then assigns soldiers to **Task Forces**.

> [!IMPORTANT]
> This is NOT full GOAP. The domain has ~6 macro-actions, so utility scoring is the right complexity level. Each operation gets a score; the highest wins. Observable: log lines like "Thornwall orders: raid Vesper's timber country".

#### Dual-Operation Model (Primary + Secondary)

The War Council issues **two simultaneous operations** per Court session:

- **Primary operation** — the main army action: MUSTER, SIEGE, or DEFEND. This commits the bulk of soldiers (~70%+ of available force).
- **Secondary operation** — a supporting action: RAID or INTERCEPT. This uses a small detachment (2-3 soldiers). Runs concurrently with the primary.

This means a faction can siege a town with its main army *while* a raid party burns the enemy's timber country. No "general" agent is needed — the War Council tags soldiers with their operation via the `mission` field, and soldiers act autonomously based on mission type. Think of it as the king's council issuing strategy; the soldiers carry out orders through their mission assignments.

If no secondary scores above a minimum threshold (15), only the primary runs. DEMOBILIZE cancels both.

#### Operations Menu

| Operation | Type | Description | When it scores high |
|:---|:---|:---|:---|
| **MUSTER** | Primary | Hold recruits at a staging town until army reaches ~70% of cap, then release as one stack | Army below muster threshold, no urgent threat |
| **SIEGE** | Primary | March the massed army to attack a target settlement | Army mustered, viable target exists, strength advantage |
| **DEFEND** | Primary | Reinforce a besieged or threatened settlement | Our settlement is under siege or enemy army nearby |
| **RAID** | Secondary | Send 2-3 soldier parties to burn enemy resource hexes and buildings | Enemy has exposed economic hexes, we want to draw out defenders |
| **INTERCEPT** | Secondary | Sortie garrison to engage enemies detected in our territory | Enemy soldiers spotted on our land, local strength favors us |
| **DEMOBILIZE** | Either | Stand down, seek peace | Exhaustion high, no viable targets |

#### Scoring Formulas

Each operation gets a utility score (0-100). The War Council picks the highest primary and highest secondary:

```js
// PRIMARY OPERATIONS
// MUSTER: high when army is small relative to cap, low when already mustered
score_muster = (1 - currentArmy / armyCap) * 60 * (noUrgentThreat ? 1.5 : 0.3)

// SIEGE: high when army is mustered and target is vulnerable
score_siege = (armyStrength / targetDefense) * 30 + (mustered ? 40 : 0) - (targetDist * 2)

// DEFEND: urgent when besieged, proportional to settlement value
score_defend = besiegedSettlement ? 90 : (enemyNearby ? tierValue * 15 : 0)

// SECONDARY OPERATIONS
// RAID: high when enemy has undefended economic hexes, good for asymmetric warfare
score_raid = enemyEconValue * 20 / (1 + enemyGarrisonNearby) + (aggression * 10)

// INTERCEPT: high when enemies are in our territory and we can win locally
score_intercept = (localStrength / enemyLocalStrength) * 40 * (enemiesInTerritory ? 1 : 0)

// EITHER
// DEMOBILIZE: high exhaustion drives this
score_demobilize = (exhaustion / SUE_THRESHOLD) * 50 - (aggression * 15)
```

#### Task Force Assignment

Soldiers are assigned to operations based on priority:
1. **DEFEND** claims soldiers closest to the threatened settlement first
2. **Primary** (SIEGE/MUSTER) claims the bulk of remaining idle soldiers, keeping a skeleton garrison (GARRISON_PEACE per settlement)
3. **Secondary** (RAID/INTERCEPT) gets 2-3 soldiers from the nearest settlement to the target area — these are *not* pulled from the primary force

Each soldier's `mission` field tracks which operation they belong to. The War Council re-evaluates every Court session (50 ticks), but soldiers mid-mission continue until the operation changes or completes.

#### Emergent Baiting Behavior

No explicit bait logic needed:
1. Raids pull garrisons out of settlements to chase raiders
2. Intercept commits defenders to field battles away from walls
3. The massed main army hits the emptied town
4. This creates the dynamic warfare loop the user wants to see

#### Combat Commitment Timer

Once soldiers engage in a field battle (share a hex with enemies at war), they are **committed to fighting** for `COMBAT_COMMIT_TICKS` (60 ticks). During commitment:
- Soldiers cannot retreat, change mission, or receive new orders
- The `engaged` flag is already set each tick in `combatSystem` — we add `engagedSince` to track when combat began
- After commitment expires, soldiers on RAID missions will attempt to disengage if outmatched 2:1

This prevents cat-and-mouse: a raid party that gets caught *must fight* for ~60 ticks, taking real casualties. Raiding becomes a genuine gamble, not a free poke-and-run.

```js
// In combatSystem, when soldiers first engage:
if (!s.engagedSince) s.engagedSince = world.tick;

// Disengagement check (only after commitment expires):
const committed = (world.tick - s.engagedSince) < DIPLO.COMBAT_COMMIT_TICKS;
if (!committed && s.mission?.kind === 'raid' && enemyStr > friendlyStr * 2) {
  s.engagedSince = null;
  cancelMission(world, s); // retreat home, battered
}

// Clear engagedSince when no longer on a hostile hex:
if (!s.engaged) s.engagedSince = null;
```

#### [MODIFY] [diplomacy.js](file:///c:/Users/hdunp/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/6c3a86ac-9fe2-4242-9682-0fb3a5279249/b3c093a8-f8d0-4976-9994-1d9c2278542e/local_871e485e-65bf-4454-b7f0-35b3a6564ee5/outputs/caravan-and-kingdom/src/sim/diplomacy.js)

Replace `conductWar()` (L388-431) with the War Council system:

- New function `warCouncil(world, war, side)` — scores all primary ops, scores all secondary ops, picks the best of each
- New function `executeMuster(world, side, staging)` — holds soldiers at staging town until 70% cap
- New function `executeSiege(world, side, target)` — march mustered army as a group to target
- New function `executeRaid(world, side, enemy)` — dispatch 2-3 soldier raid parties to enemy economic hexes
- New function `executeIntercept(world, side)` — sortie garrison against enemies in our territory
- New function `executeDefend(world, side, settlement)` — reinforce threatened/besieged settlement
- Add `war.orders` object to track current operations per side: `{ [factionId]: { primary: { op, targetId }, secondary: { op, targetId } } }`
- Add `fac.mustering` flag and `fac.musterTown` to track muster staging
- Add combat commitment logic to `combatSystem` field battle section

New soldier mission kinds in [agents.js](file:///c:/Users/hdunp/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/6c3a86ac-9fe2-4242-9682-0fb3a5279249/b3c093a8-f8d0-4976-9994-1d9c2278542e/local_871e485e-65bf-4454-b7f0-35b3a6564ee5/outputs/caravan-and-kingdom/src/sim/agents.js):
- `raid` — move to enemy hex, pillage, disengage after commitment timer if outmatched
- `intercept` — move to engage enemies detected in our territory
- `muster` — move to staging town and wait

New soldier state property:
- `engagedSince` — tick when combat commitment began, null when not in combat

---

### 2. Exponential War Exhaustion

Replace linear exhaustion accrual with compound growth. Early war is cheap; late war is catastrophic.

#### [MODIFY] [constants.js](file:///c:/Users/hdunp/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/6c3a86ac-9fe2-4242-9682-0fb3a5279249/b3c093a8-f8d0-4976-9994-1d9c2278542e/local_871e485e-65bf-4454-b7f0-35b3a6564ee5/outputs/caravan-and-kingdom/src/core/constants.js)

New/modified DIPLO constants:

```js
// Replace linear EXH_TICK with exponential parameters
EXH_TICK: 0.015,              // base tick exhaustion (slightly lower base)
EXH_GROWTH: 1.5,              // compound growth factor
EXH_GROWTH_INTERVAL: 1000,    // ticks per growth step
// Momentum: asymmetric exhaustion from captures
EXH_CAPTURE_WINNER_REFUND: 12,  // winner LOSES this much exhaustion on capture
EXH_CAPTURE_LOSER_PENALTY: 25,  // loser GAINS this (was EXH_SETTLEMENT_LOST)
EXH_BATTLE_WINNER_RELIEF: 2,    // winner relief after field battle
EXH_BATTLE_LOSER_COST: 4,       // loser cost after field battle
// Repeat war escalation
TRUCE_REPEAT_SCALING: 1000,     // extra truce ticks per repeat war between same pair
// Combat commitment
COMBAT_COMMIT_TICKS: 60,        // soldiers must fight this long before disengaging
```

Remove: `EXH_SETTLEMENT_LOST: 25` (replaced by the asymmetric pair above).

#### [MODIFY] [diplomacy.js](file:///c:/Users/hdunp/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/6c3a86ac-9fe2-4242-9682-0fb3a5279249/b3c093a8-f8d0-4976-9994-1d9c2278542e/local_871e485e-65bf-4454-b7f0-35b3a6564ee5/outputs/caravan-and-kingdom/src/sim/diplomacy.js)

**Exhaustion accrual** in `courtSystem` (L137-144):

```js
// Replace linear exhaustion:
//   war.exh[side] += (DIPLO.EXH_TICK * DIPLO.INTERVAL) / aggr;
// With exponential:
const warDuration = world.tick - war.since;
const rate = DIPLO.EXH_TICK * Math.pow(DIPLO.EXH_GROWTH, warDuration / DIPLO.EXH_GROWTH_INTERVAL);
war.exh[side] += (rate * DIPLO.INTERVAL) / aggr;
```

Exhaustion timeline (with EXH_GROWTH=1.5, EXH_GROWTH_INTERVAL=1000):

| War Duration (ticks) | Rate Multiplier | Effective Rate | Cumulative ~Exh |
|:---|:---|:---|:---|
| 0-1000 | 1.0× | 0.015/tick | ~15 |
| 1000-2000 | 1.5× | 0.023/tick | ~38 |
| 2000-3000 | 2.25× | 0.034/tick | ~72 |
| 3000-4000 | 3.4× | 0.051/tick | ~123 |
| 5000+ | 7.6× | 0.114/tick | guaranteed peace |

> No war survives past ~4000-5000 ticks regardless of stalemate. But a decisive war (captures in first 1000 ticks) can last much longer for the *winner* thanks to capture refunds.

**Capture momentum** in `captureSettlement` (L688-727):

```js
// Winner gets exhaustion REFUND (stays fresh, presses on)
if (war) {
  war.exh[winnerFid] = Math.max(0, war.exh[winnerFid] - DIPLO.EXH_CAPTURE_WINNER_REFUND);
  war.exh[loserFid] += DIPLO.EXH_CAPTURE_LOSER_PENALTY;
}
```

**Field battle momentum** in `combatSystem` after field battle resolution:

```js
// After a field battle resolves (one side routed or destroyed):
// Winner = side with more surviving strength
if (survivingStrA > survivingStrB * 1.5) {
  war.exh[fa] = Math.max(0, war.exh[fa] - DIPLO.EXH_BATTLE_WINNER_RELIEF);
  war.exh[fb] += DIPLO.EXH_BATTLE_LOSER_COST;
} else if (survivingStrB > survivingStrA * 1.5) {
  war.exh[fb] = Math.max(0, war.exh[fb] - DIPLO.EXH_BATTLE_WINNER_RELIEF);
  war.exh[fa] += DIPLO.EXH_BATTLE_LOSER_COST;
}
```

**Repeat war truce scaling** in `makePeace`:

```js
// Track war count between pairs
d.warCounts = d.warCounts ?? {};
const pk = pairKey(war.a, war.b);
d.warCounts[pk] = (d.warCounts[pk] ?? 0) + 1;
const repeatBonus = (d.warCounts[pk] - 1) * DIPLO.TRUCE_REPEAT_SCALING;
d.truces[pk] = world.tick + DIPLO.TRUCE_TICKS + repeatBonus;
```

---

### 3. Raid & Pillage Visibility

Raids and pillaging are currently invisible (only caravan raids log). Make war visible on the map.

#### [MODIFY] [diplomacy.js](file:///c:/Users/hdunp/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/6c3a86ac-9fe2-4242-9682-0fb3a5279249/b3c093a8-f8d0-4976-9994-1d9c2278542e/local_871e485e-65bf-4454-b7f0-35b3a6564ee5/outputs/caravan-and-kingdom/src/sim/diplomacy.js)

In `combatSystem` pillage section (L563-593):

```js
// Add raid logging when soldiers pillage
if (hex.building && hex.buildingIntegrity > 0) {
  const oldIntegrity = hex.buildingIntegrity;
  hex.buildingIntegrity = Math.max(0, hex.buildingIntegrity - 0.5);
  if (oldIntegrity > 50 && hex.buildingIntegrity <= 50) {
    log(world, `${world.factions[a.factionId].name} raiders damaged a ${hex.building} near ${ownerS.name}`);
  }
}
// Add burn marker for visualization
hex.burnedTick = world.tick;  // UI can show fire/smoke on recently pillaged hexes
```

War Council operation logging:

```js
// In warCouncil, log the chosen operation
log(world, `${world.factions[side].name} War Council orders: ${chosenOp} ${targetName ?? ''}`);
```

#### [MODIFY] [index.html](file:///c:/Users/hdunp/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/6c3a86ac-9fe2-4242-9682-0fb3a5279249/b3c093a8-f8d0-4976-9994-1d9c2278542e/local_871e485e-65bf-4454-b7f0-35b3a6564ee5/outputs/caravan-and-kingdom/index.html)

In the hex rendering code, add a burn marker overlay:

```js
// After drawing hex terrain, check for recent pillage
if (hex.burnedTick && world.tick - hex.burnedTick < 200) {
  const opacity = 1 - (world.tick - hex.burnedTick) / 200;
  // Draw a small fire/smoke icon or orange tint
  ctx.fillStyle = `rgba(200, 80, 0, ${opacity * 0.3})`;
  ctx.fill(); // re-fill hex with burn overlay
}
```

---

## Implementation Order

1. **§2 Exponential Exhaustion** (smallest change, immediate stalemate fix)
   - Modify exhaustion accrual formula
   - Add capture/battle momentum
   - Add repeat-war truce scaling
   - Test: run `wardiag.mjs` — wars should resolve within ~5000 ticks

2. **§1 War Council** (largest change, core AI rewrite)
   - Add new constants for operation thresholds
   - Implement `warCouncil` + all `execute*` functions
   - Add new mission kinds (`raid`, `intercept`, `muster`) to `agents.js`
   - Add retreat-when-outnumbered rule
   - Test: run `wardiag.mjs` — should see raid/intercept log lines, battles, and captures

3. **§3 Visibility** (polish, after core works)
   - Add raid logging and burn markers
   - Add War Council operation logging
   - Add burn marker rendering in UI

---

## Verification Plan

### Automated Tests

```bash
# Determinism must pass after every step
node test/headless.js 2500 42

# War diagnostics — run multiple seeds
node wardiag.mjs 42 20000
node wardiag.mjs 123 20000
node wardiag.mjs 777 20000
```

### Acceptance Criteria

| Metric | Target |
|:---|:---|
| War duration | No war lasts > 5000 ticks (exponential exhaustion) |
| Raid visibility | Raid log lines appear during wars |
| Field battles | > 0 battles per war (soldiers actually fight) |
| Captures per war | ≥ 1 on most seeds (wars are decisive) |
| No faction captures entire map unopposed | Third-party wars create opportunity cost, not free expansion |
| Muster behavior | Soldiers group before marching (no piecemeal trickle) |
| Combat commitment | Raid parties fight for ~60 ticks before attempting retreat |
| Retreat behavior | Outnumbered raid parties retreat visibly after commitment expires |
| `node test/headless.js 2500 42` | Determinism PASS |

### Manual Verification

- Watch a game in the browser: see soldiers raid enemy territory, defenders intercept, armies clash in field battles
- Check event log for War Council orders, raid damage reports, battle reports
- Verify burn markers appear on pillaged hexes and fade over time
