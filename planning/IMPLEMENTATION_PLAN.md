# Implementation Plan: Field Battles · Barter Trade · Fishing Docks

Three features, ordered so each is testable alone. Note: index.html / governors.js have been edited outside this plan (restyle, playstyle selector, "essential food source" logic) — verify exact code strings before patching; the function names below are stable.

---

## 1. Soldier vs Soldier Field Battles

**Problem:** soldiers only fight settlements (sieges) and raid caravans. Armies pass each other on roads without fighting, and garrisons don't visibly defend. Battles should be observable.

### Constants (`src/core/constants.js`, DIPLO block)
```js
FIELD_DAMAGE: 0.05,   // fraction of enemy stack strength dealt per tick, split across a side
```

### Sim (`src/sim/diplomacy.js` → `combatSystem`)
Insert a field-battle pass **after** `healAndAttrition(world)` and **before** the siege block:

1. Bucket all soldiers by hex key. Reset `a.engaged = false` on every soldier first.
2. For each hex (sorted keys, for determinism) with soldiers from 2+ factions, for each faction pair **at war** (`atWar`):
   - `sA`, `sB` = summed strength (`SOLDIER_STRENGTH * integrity/100`) per side.
   - Each soldier on side A loses `sB * FIELD_DAMAGE / countA` integrity per tick; mirror for B.
   - Set `engaged = true` on all combatants.
3. Battle-start logging: keep `world.diplo.activeBattles` (Set of hex keys). A battle hex not in last tick's set → `log(world, "Battle joined near (q,r)!")`. Replace the set each tick.
4. After the pass, remove soldiers with `integrity <= 0`; add `EXH_SOLDIER_LOST` per death to that faction's entry in every war it's part of (same pattern as `healAndAttrition`).

### Movement lock (`src/sim/systems.js` → `movementSystem`)
First line inside the agent loop: `if (agent.engaged) continue;` — engaged soldiers hold position; flag is recomputed by combat each tick, so survivors resume their path automatically. (Tick order is movement → combat, so the flag applies on the following tick — fine.)

### Emergent bonus
Attackers besieging a settlement stand ON its hex; garrison soldiers idle there share the hex → the field-battle pass makes garrisons fight attackers visibly, on top of existing siege math. No extra code needed — verify it happens.

### UI (`src/ui/renderer.js`, agent loop)
For soldiers with `a.engaged`, draw a red halo behind the diamond:
`arc(x, y, 7)` fill `#e74c3c55`, stroke `#e74c3c`. Optionally pulse with `world.tick % 20`.
Also update the sidebar hint text: "diamonds are soldiers; red halo = battle".

### Tests (extend `wardiag.mjs`)
- Grep log for "Battle joined" over a 9k-tick run on seed 42 (wars occur ~t4250).
- Assert engaged soldiers don't move (positions stable across ticks while flagged).
- Battles must end (no immortal stalemates): two equal stacks of 10 should annihilate in ~100-200 ticks. If too fast/slow, tune `FIELD_DAMAGE` (0.03–0.08 range).
- Full `node test/headless.js` regression: determinism must hold (iteration over sorted hex keys is required).

---

## 2. Barter Trade + SURVIVE Towns May Buy Food

**Problem A (bug):** `tradeGovernor` (`src/sim/governors.js`) returns immediately when `s.goal === GOALS.SURVIVE` — starving towns are exactly the ones that must import food. **Problem B:** purchases require gold; a poor mountain village with 600 ore but no gold can't buy food. It should swap ore for food.

### Governor (`src/sim/governors.js` → `tradeGovernor`)
1. Replace the SURVIVE early-return: `const survival = s.goal === GOALS.SURVIVE;` and iterate `survival ? ['food'] : rankedNeeds(world, s)` in the buy loop. Skip the **export** section entirely when `survival`.
2. In the buy loop, after picking a seller (existing `canTrade` + range filter):
   ```js
   const unit = tradePrice(world, s.factionId, seller.factionId);
   const cost = Math.ceil(ECON.TRADE_BATCH * unit);
   let barterRes = null;
   if (s.gold < cost) {
     barterRes = ['ore', 'stone', 'timber', 'food']
       .find(r => r !== res && s.stock[r] >= ECON.TRADE_BATCH + 60); // keep a buffer
     if (!barterRes) continue;     // can't pay either way
   }
   ```
3. On dispatch, if bartering: deduct `ECON.TRADE_BATCH` of `barterRes` from stock, load into `caravan.cargo[barterRes]`, and set `mission.barterRes`. (1:1 by unit — both sides value goods at the same price; refine later if wanted.)

### Arrival (`src/sim/agents.js` → `onArrival`, `'trade'` case, `phase === 'out'`)
If `m.barterRes`:
```js
const amt = Math.min(amount /* seller surplus calc, existing */, agent.cargo[m.barterRes] ?? 0);
if (amt > 0) {
  seller.stock[m.resource] -= amt;
  deposit(seller, { [m.barterRes]: amt });
  agent.cargo[m.barterRes] -= amt;
  agent.cargo[m.resource] += amt;
  recordTrade(world, home.factionId, seller.factionId);
  log(world, `${home.name} bartered ${amt} ${m.barterRes} for ${m.resource} with ${seller.name}`);
}
```
Else: existing gold path. The return leg already deposits all cargo home, including any unswapped barter goods — no changes needed.

### Edge cases
- Caravan dies mid-barter-trip: goods lost with it (already true of all cargo) — acceptable.
- Seller's surplus shrank in transit: partial swap via the `Math.min`; remainder rides home.
- Relations credit (`recordTrade`) applies to barter too — barter builds friendships.

### Tests
- Seed with a mountain-ish start, or assert via log: run 10k ticks across seeds 42/123/777 and grep "bartered". Expect >0 on at least one seed.
- Assert no settlement sits at `goal === SURVIVE` with `stock.ore > 300` for >2000 consecutive ticks (the wedge this fixes).
- Headless regression + determinism.

---

## 3. Fishing Docks on Water Tiles

**Problem:** FISHERY is currently a *land* building adjacent to water (and recent edits already build it as an "essential food source"). The user wants docks ON water hexes; they should be a real lifeline for food-poor geographies.

### Approach
Keep it simple: a dock occupies a **coastal water hex** (water hex with ≥1 land neighbor) and lands its catch directly into the settlement's stock — no pile on an impassable hex, no villager trip needed. That's the justification for a slightly lower rate than a worked farm.

### Constants (`src/core/constants.js`)
```js
FISHERY: { name: 'Fishing Dock', terrain: 'WATER', cost: { timber: 40 }, yieldMult: 1.5 },
```

### Extraction (`src/sim/systems.js` → `extractionSystem`)
The water branch currently `continue`s immediately. Change to:
```js
if (hex.terrain === 'WATER') {
  if (hex.building === 'FISHERY') {
    s.stock.food += 1.2 * workEfficiency * (hex.buildingIntegrity / 100);
  }
  continue;
}
```
Remove any remaining land-FISHERY special case in the loop.

### Governor (`src/sim/governors.js` → `civilGovernor`)
Replace both existing FISHERY-building sites (the "essential food source" block and the in-loop food branch) with one rule targeting water:
```js
const dockHex = controlledHexes(world, s).find(h =>
  h.terrain === 'WATER' && !h.building &&
  [...range(h.q, h.r, 1)].some(([q, r]) => {
    const nb = world.hexes.get(key(q, r));
    return nb && nb.terrain !== 'WATER';
  }));
```
Build when `food` is the top ranked need (or in the essential-food block) and affordable. Docks count toward `jobCap` automatically via `controlledHexes(...).filter(h => h.building)`.

### Knock-on checks
- **Maintenance:** building repair loop iterates controlled hexes regardless of terrain — docks get repaired. Verify.
- **Pillaging:** soldiers can't stand on water → docks are raid-proof. Acceptable (flavor: no navy yet).
- **Renderer:** building marker already draws on any hex with `building` — shows "F" on water. Fine.
- **`computeRole`:** unchanged; water still doesn't count toward GRANARY.

### Tests
- Coastal seed run: grep log for "Fishing Dock"; assert some water hex has `building === 'FISHERY'` and the owner's food income is positive with zero plains.
- Headless regression + determinism.

---

## Suggested order & effort

| Step | Feature | Est. size | Risk |
| :--- | :--- | :--- | :--- |
| 1 | Fishing docks | ~40 lines | Low — isolated |
| 2 | Barter + SURVIVE fix | ~60 lines | Medium — touches trade dispatch & arrival |
| 3 | Field battles | ~80 lines | Medium — determinism (sort hex keys), tick-order interplay |

After each step: `node --check` the touched files, `node test/headless.js 2500 42`, and the relevant diag script (`wardiag.mjs` for battles). Existing tasks #25–27 in the session task list map to these three steps.
