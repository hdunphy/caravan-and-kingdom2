# Diplomacy Design — Caravan and Kingdom (v1.0)
*Status: Rules specification, pre-implementation*

Locked decisions: soldiers are agents on the map · sieges can capture settlements · factions can be eliminated · the player remains a pure observer.

---

## 1. Design Principles

1. **Diplomacy is faction-level.** Settlements have governors; factions get a **Court** that meets every 50 ticks (the diplomacy interval) to update relations, declare wars, and negotiate peace. This mirrors the Parallel Governor pattern one level up.
2. **Wars are economic events.** Soldiers draw wages, armies eat food, sieges burn stockpiles. A war you can't afford is a war you lose — the existing wage/desertion machinery applies to soldiers unchanged.
3. **Everything stays watchable and deterministic.** All randomness through the seeded RNG, all iteration in fixed order (faction id ascending, pair keys sorted). Headless determinism tests must keep passing.

---

## 2. Relations

A symmetric score **R(a,b) ∈ [−100, +100]** for every faction pair, starting at 0.

### 2.1 Continuous drivers (applied each Court session, every 50 ticks)
| Driver | Effect |
| :--- | :--- |
| Completed trade or export between the pair | **+1** per transaction (logged at transaction time, applied at session) |
| Border friction: settlements of different factions within 6 hexes | **−0.5** per crowded pair |
| Forgiveness drift | ±0.5 toward 0 |

### 2.2 Event drivers (applied immediately)
| Event | Effect |
| :--- | :--- |
| War declared on you | **−40** toward aggressor |
| Third party declares a war (warmonger penalty) | **−10** toward aggressor from everyone else |
| Your hex pillaged / caravan raided | −3 per incident |
| Your settlement captured | −25 |
| Gift/tribute received | +1 per 20 gold of value |
| Peace treaty signed | relations reset to **−20**, truce begins |

### 2.3 Diplomatic states (derived from R)
| State | Range | Effects |
| :--- | :--- | :--- |
| **Friendly** | R ≥ +30 | Trade price discount (×0.75); caravans prefer friendly sellers |
| **Neutral** | −30 < R < +30 | Normal trade |
| **Hostile** | R ≤ −30 | No new trade missions (existing ones complete); Court may consider war |
| **War** | explicit flag | Total embargo; soldiers raid, pillage, besiege |
| **Truce** | timer after peace | Behaves as Hostile but war declarations are forbidden |

---

## 3. The Trade Layer

Existing settlement-level trade continues but becomes diplomacy-aware:

- **Embargo:** Trade and export missions never target factions you are at War with, or Hostile factions. Trade thus naturally concentrates among friends — and since every transaction adds +1 R, trade partnerships self-reinforce into blocs.
- **Friendly discount:** between Friendly factions the unit price is 1.5 gold instead of 2. Buyers prefer Friendly sellers when choice exists (tie-break before distance).
- **Gifts (tribute):** a Mercantile-style faction (trade trait ≥ 1.3) that is Hostile with a *stronger* faction may dispatch a tribute caravan (~60 gold value) to buy the relationship back above −30. This is the peaceful counterplay to militarism: Aurelia bribes, Thornwall arms.
- Cross-faction road paving (already in game) remains: roads to foreign partners only persist while trade flows, so embargoes visibly starve border highways.

---

## 4. Soldiers

A new agent type, recruited and paid like villagers/caravans:

| Property | Value |
| :--- | :--- |
| Recruit cost | 20 food, 5 ore, 10 gold (ore matters: smithies become strategic) |
| Wage | 0.05 gold/tick — ~12× a villager, so standing armies are expensive |
| Speed | 1.0 (1.5 on roads via normal road bonus) |
| Strength | 10 × (integrity / 100) |
| Upkeep | integrity decays 0.03/tick in the field; recovers 0.5/tick garrisoned at home |
| Population | recruiting converts 1 pop into the soldier; disbanding returns it |

**Garrison vs. army.** Soldiers default to garrison duty at their home settlement. The Court maintains a peacetime garrison target (1 per settlement; ×2 for aggressive factions) and disbands the surplus when treasuries strain — wages and desertion already handle mutiny for free.

**Settlement defense** = garrison strength + militia (population × 0.05) + walls bonus (none in v1).

---

## 5. War

### 5.1 Declaration (Court decision, every 50 ticks)
A declares war on B only if ALL hold:
- R(A,B) < −40 and no truce between A and B
- A is not already in a war (one war per faction)
- Military advantage: A's total strength > B's × (1.5 / aggression trait)
- Opportunity: B has a settlement within striking range (≤ 15 hexes of an A settlement)
- War chest: A's faction gold > soldiers' wages for the projected campaign (~2000 ticks)

The **war goal** is chosen at declaration: the nearest weakly-defended border settlement of B.

### 5.2 Conduct
1. **Mobilize** — the staging settlement (A's closest to the goal) recruits up to army size = 6 + 4 × aggression soldiers; garrisons across A may transfer.
2. **March** — the army paths to the goal as ordinary agents (roads matter strategically).
3. **Raid & pillage en route** — enemy caravans on the army's hex are destroyed (cargo looted to the army's pockets, banked on return). Enemy-owned hexes the army crosses lose their resource piles, building integrity −30, road integrity −50.
4. **Siege** — at the goal, each tick: attackers deal Σstrength × 0.02 damage to settlement defense; defenders deal defense × 0.015 spread across attacker integrity. Defense regenerates +0.2/tick from militia if the siege lifts.
5. **Capture** — defense ≤ 0: settlement flips to A (`factionId` change; territory follows automatically). Population −25%, stockpiles −50% (sacked), surviving attackers become its garrison. Or the siege fails: survivors retreat home.

### 5.3 Elimination
A faction whose last settlement is captured is eliminated: remaining agents disband, the faction stays in history charts (line goes flat at 0) and in the log ("Vesper has fallen").

---

## 6. Peace

### 6.1 War exhaustion (0–100 per side, per war)
| Source | Exhaustion |
| :--- | :--- |
| Per soldier lost | +4 |
| Per settlement lost | +20 |
| Passage of time at war | +0.02/tick (scaled by 1/aggression) |
| Treasury at 0 while at war | +0.1/tick |

### 6.2 Negotiation (checked each Court session)
- One side ≥ 70 exhaustion → it **sues for peace** (accepts loser terms).
- Both sides ≥ 40 → **mutual peace** (status quo terms).
- War goal captured and attacker exhaustion < 40 → attacker may press on to a new goal **only if** aggression ≥ 1.2; otherwise offers peace from strength.

### 6.3 Terms (computed, not bargained)
- **Territory:** captured settlements stay captured (uti possidetis).
- **Reparations:** the suing side pays 25% of its faction-wide gold to the other.
- **Truce:** 2,000 ticks; no declarations between the pair; relations set to −20.

---

## 7. Personality Integration

New trait `aggression` joins expand/trade/industry:

| Faction | Persona | aggression | Diplomatic flavor |
| :--- | :--- | :--- | :--- |
| Aurelia | Mercantile | 0.6 | Trades into friendships, pays tribute rather than fight, war only when overwhelming |
| Vesper | Expansionist | 1.2 | Border friction magnet (many settlements), opportunistic wars |
| Thornwall | Industrious | 1.4 | The militarist: ore economy feeds soldiers, declares earliest, exhausts slowest |
| Skylde | Balanced | 1.0 | Middle of the road |

Aggression scales: declaration threshold, army size, exhaustion accumulation, peacetime garrison.

---

## 8. Architecture & System Order

- **New module `src/sim/diplomacy.js`:** relations matrix, war list, Court logic (relations update → peace checks → declarations → war conduct orders → garrison quotas). State lives in `world.diplo = { relations, wars, truces, pendingEvents }`.
- **New mission kinds** in `agents.js`: `muster`, `march`, `siege` (raids/pillage are side effects of movement through enemy land, handled in the combat system).
- **Combat system** added to the loop. New deterministic order:
  `Extraction → Metabolism → Movement → AI (10) → Court/Diplomacy (50) → Logistics → Combat → Maintenance`
- **Trade governor** gains the embargo/discount/gift rules (§3).
- **UI:** relations rows in the Factions panel (⚔ at war, ✓ friendly), soldiers drawn as small shields in faction color, besieged settlements get a pulsing red ring, war/peace headlines in the event log, and a "Wars" line in history sampling.
- **Determinism:** pair keys are `min(id)|max(id)`; Courts deliberate in faction-id order; all chance via `world.rng`.

### Suggested implementation phases
1. Relations matrix + states + trade embargo/discount/gifts (no combat yet) — verify trade blocs form.
2. Soldiers + garrisons + wages/disband (no wars yet) — verify economies carry peacetime armies.
3. Declarations + marches + sieges + capture + elimination.
4. Exhaustion + peace + truces. Balance pass with headless runs (target: wars occur but no snowball-to-one-faction in <15k ticks on most seeds).
5. UI layer.

---

## 9. Explicitly Out of Scope (v2 candidates)
Alliances and joint wars · walls/fortifications · naval anything · occupation unrest/revolts · mercenaries · peace conferences with multi-term bargaining · player intervention tools.
