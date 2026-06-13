# Plan: War/Truce Pacing Rebalance + Capture & Vassal Bugs

From a playtest on `treasury-and-debt` (`b01ac6d`):

1. **Pacing** — truces feel too long (and seem to grow), wars feel too short. End-game: *"we take one city then wait 5 minutes."* Either wars should last longer, truces should be shorter, or there should be more to do during peace (all three are addressed below).
2. **Bug** — villagers/agents of a captured city still render in the **old faction's color** (Part 4).
3. **Bug** — it is possible to **declare war on your own vassal/master** (Part 5).
4. **Bug (playtest 2)** — **vassalizing every faction did not trigger a win** (Part 6).
5. **Bug (playtest 2)** — despite the most cities, highest pop, and recruitment at 3×, the player had the **fewest soldiers** (Part 7).
6. **Bug (playtest 2)** — master and vassals are **stuck in a truce with deeply negative relations** (Part 8) — this, not the relation threshold, is the "stuck truce" the player saw.

**Re-grep symbols before editing — line numbers drift.** Pacing changes intentionally shift the headless baseline, so validate with **metrics** (below), not byte-identical determinism. Constants live in `src/core/constants/diplo.ts`.

---

## Root-cause analysis (why it feels this way)

The relevant current values and code:

- **Exhaustion** drives peace: `checkPeace` (`src/sim/diplomacy/peace.ts`) sues for peace once a side's `war.exh >= SUE_THRESHOLD (70)`; `>= 90` is auto-capitulation (`court.ts`).
- **Exhaustion accrual** (`court.ts` ~line 156): `rate = EXH_TICK(0.015) * EXH_GROWTH(1.2)^(warDuration/1000)`, added per `INTERVAL`, divided by aggression. So a single war's exhaustion **compounds the longer it runs** — good for breaking stalemates, but it caps sustained warfare.
- **Capture spikes exhaustion by a FLAT amount**: `EXH_CAPTURE_LOSER_PENALTY = 25`, `EXH_CAPTURE_WINNER_REFUND = 12` (`captureSettlement` in `combat.ts`). This is the core end-game problem: **the penalty doesn't scale with empire size.** A 2-city kingdom losing half its realm and a 15-city empire losing one frontier town both take +25. So large empires hit the sue threshold after a *single* city and capitulate.
- **One capture can end the war outright**: in `captureSettlement`, if `war.goalId === s.id` and (winner `exh >= MUTUAL_THRESHOLD(40)` or aggression `< 1.2`) → immediate `makePeace`. War goals are single cities, so taking the goal city ends the war.
- **Truce is a flat `TRUCE_TICKS = 1500`** set in `makePeace` (`peace.ts:103`). During a truce, **border friction is suppressed** (`court.ts:64` only accrues friction when `!inTruce`). The player also **cannot break a truce** (`playerDeclareWar` returns early if a truce is active, `war.ts:17`).
- **⚠ Correction (playtest 2):** the "stuck in truce even at very negative relations" the player observed is **not** the `WAR_RELATION(-30)` re-sour delay I previously guessed — it's the **vassal relation/truce overwrite bug** (Part 8 below). `makePeace` unconditionally sets a truce + `PEACE_RELATION` on *every* peace including vassalizations, so a master sits in a permanent truce with its own vassals. The `-30` threshold still matters for normal rival re-declaration, but it is **not** what the player saw.
- **Net effect / "it gets longer"**: as factions grow, wars end after one city (flat penalty) → peace fires more often → cumulative truce time dominates. With truces against multiple rivals stacking, the player can end up unable to fight anyone for long stretches.
- **Nothing to do in peace**: there are no peacetime systems yet beyond economy management (mid-refactor), and the planned world events (roadmap WP6) don't exist.

---

# Part 1 — Make wars scale with stakes (primary fix)

**Goal:** big wars between big empires last; you can't end a war by taking one town.

1. **Scale the capture exhaustion penalty by share of empire lost.** In `captureSettlement` (`combat.ts`), replace the flat `EXH_CAPTURE_LOSER_PENALTY` with a value proportional to how much the loser just lost, e.g.:
   `penalty = EXH_CAPTURE_LOSER_PENALTY * (1 / loserCityCountBeforeCapture)` scaled up, or weight by **population/strength share** of the captured city vs. the loser's total. Losing 1 of 12 cities → small bump; losing 1 of 2 → large bump. Same idea for the winner refund (taking a city from a huge enemy is less relieving than finishing off a small one). This single change most directly fixes *"one city then wait."*
2. **Don't auto-peace on the first goal city for large targets.** In the `war.goalId === s.id` branch, only sue for peace if the loser has been meaningfully reduced (e.g., below some fraction of its starting size, or down to its last settlement). Otherwise let the Court pick a **new goal** next session and press on (the aggressive-victor path already does this — broaden it).
3. **Consider relative (not absolute) exhaustion.** Optionally make `SUE_THRESHOLD` effectively higher for larger empires, or measure exhaustion per-capita, so a sprawling realm can absorb a longer war. Keep it tunable.
4. **Keep the compounding `EXH_GROWTH`** as the stalemate-breaker, but verify the new scaling doesn't make wars *infinite* — the goal is "decisive multi-city campaigns," not "forever wars."

**Validate:** average cities-captured-per-war and average war duration both rise in late game; small factions still get conquered at a reasonable rate.

# Part 2 — Tune truces & give the player agency

**Goal:** less dead time; the player decides when to re-engage.

1. **Shorten and/or scale `TRUCE_TICKS`.** Drop the flat 1500 (try 600–900), **or** scale it by how decisive the peace was: a crushing defeat → longer truce; a mutual-exhaustion stalemate → short truce. Set it in `makePeace`.
2. **Let relations re-sour during/after truce** so wars can reignite: either allow border friction to accrue (at a reduced rate) during truce, or start post-truce relations lower (tune `PEACE_RELATION`).
3. **Allow the player to break a truce early** at a cost. Change `playerDeclareWar` (`war.ts:17`) so that instead of silently returning during a truce, it offers a "break the truce" path with a penalty (relation hit / temporary aggression or reputation cost, maybe a higher war-chest requirement). Surface the cost in the UI button. This removes the "just sit and wait" feeling while keeping truces meaningful for the AI.

**Validate:** percentage of late-game time the player is *able* to be at war goes up; truces still prevent instant re-declaration spam.

# Part 3 — More to do in peacetime (longer-term, cross-refs)

Pacing isn't only about war length — peace needs content. Pull from existing plans rather than duplicating:

- **World events** (roadmap `implement_player_faction_roadmap.md` WP6: droughts, plagues, **bandit camps cleared by soldiers**) — gives the military and the player something to do without a full war. Bandit camps especially scratch the "use my army in peacetime" itch.
- **Diplomacy depth**: alliances/defensive pacts (`pacts` already exist), trade agreements, gifts to court favor, arranged vassalage / demanding tribute — peacetime diplomatic goals with real payoffs.
- **Economy management** (the `economy_treasury_and_debt.md` work) — treasury, debt, austerity decisions give peacetime tension.
- **Internal projects**: wonders/large buildings, infrastructure, settling new land (the expansion policy slider).
- **Captured-city unrest/rebellion** to manage after conquest (also makes warmongering have a cost).

This is a backlog to draw from, not a single deliverable — recommend starting with **bandit camps** (smallest, highest "something to do" value) once Parts 1–2 land.

---

# Part 4 — Bug: captured city's agents keep the old color

**Symptom:** after capturing a city, its villagers render in the previous owner's color.

**Where:** `captureSettlement` (`combat.ts:358`). It sets `s.factionId = winnerFid` and **disbands** the old regime's home agents (`world.agents = world.agents.filter(a => !(a.homeId === s.id && a.factionId === loserFid))`). The renderer colors agents by `a.factionId` (`renderer.ts:299`) and settlements by `s.factionId` (`renderer.ts:229`).

**Likely causes to check (reproduce first):**
- **Agents tied to the city but not caught by the filter** — e.g., soldiers/caravans/settlers that were *away* at capture, or any agent whose `homeId === s.id` but whose `factionId` was already mutated, slip through and keep `loserFid` → render in the old color. Audit every agent that should belong to the captured settlement and ensure `factionId` (and `homeId`) is reassigned to `winnerFid` rather than left stale.
- **Decide the design:** should the captured population **convert** to the new ruler (re-color, keep working) or **disband** (vanish, new villagers spawn under the winner)? Currently it disbands home agents but may leave related units stale. Pick one and apply it consistently so no `loserFid` agent remains associated with the captured settlement or its territory.
- **Child colonies/villages** founded by the captured city are *separate* settlements with their own `factionId` and are **not** transferred (by design) — but this can read as the bug ("villages show old color"). Confirm whether the player means these; if so, decide whether colonies should defect/transfer with their parent or whether the UI should just make ownership clearer.

**Fix:** reassign or remove all agents associated with the captured settlement so none retain `loserFid`; if converting population, set `a.factionId = winnerFid`. Add an assertion/test: after a capture, no agent with `homeId === s.id` has `factionId === loserFid`, and no agent rendered on the city's hexes shows the old color.

**Validate:** scripted capture in a headless test → assert no stale-faction agents remain on the captured settlement; visual confirm in-browser.

# Part 5 — Bug: can declare war on your own vassal

**Confirmed in code.** Neither the UI nor `playerDeclareWar` excludes your vassal or your master:
- UI (`updateHud.ts` ~line 150-156): the diplomacy loop renders a **Declare War** button for any non-eliminated faction not currently at WAR with the player — *including* a faction whose `vassalOf === playerFactionId` (your vassal) or the player's own master.
- `playerDeclareWar` (`war.ts:12`): guards `atWar`, truce, and war-chest, but has **no vassal/master check**.

**Fix:**
- In `playerDeclareWar`, reject (with an INFO alert) if `world.factions[targetId].vassalOf === fid` (your vassal) or `world.factions[fid].vassalOf === targetId` (your master).
- In `updateHud`, don't render the Declare War button for your vassal/master; show the relationship instead (the VASSAL badge already exists at line 101). Optionally offer a "Release vassal" action there instead.
- Add the same guard to the core `declareWar` as a safety net so no AI path can target its own vassal/master either (AI already mostly avoids this via `court.ts:225`, but the guard makes it robust).

**Validate:** with a vassal relationship set up, the Declare War button does not appear for the vassal/master, and calling `playerDeclareWar` against them is a no-op with a clear message.

---

# Part 6 — Bug: vassalizing every faction is not a win

**Confirmed.** Win check (`checkWinLoss`, `src/main.ts:157`):
```js
const isWin = (myPop > totalPop * 0.6 && totalPop > 0)
           || (aliveFactions.length === 1 && aliveFactions[0].id === w.playerFactionId);
```
`aliveFactions` filters only on `eliminated`. **Vassals are not eliminated**, so the "last standing" clause never fires when you've vassalized (not conquered) everyone, and the pop clause needs >60% (the playtest was ~51%: 12292 of 24162). So total domination via vassalage reads as "not a win."

**Fix:** treat "every other surviving faction is your vassal (directly or transitively)" as a victory. Add a helper `isUnderHegemony(world, fid)` that returns true when every non-eliminated faction is either `fid` or has a `vassalOf` chain ending at `fid`, and OR it into `isWin`. (Decide whether sub-vassals/vassals-of-vassals count — recommend yes, walk the chain.)

**Validate:** vassalize all rivals → Victory fires; a mix of one independent rival + vassals does **not** win.

# Part 7 — Bug: player has the fewest soldiers despite most cities/pop and recruitment at 3×

**Confirmed — three compounding causes:**

1. **The recruitment slider does nothing in peacetime.** For the player at peace, the Court only calls `manageGarrison` (`court.ts:236-244`). `manageGarrison` (`peacetime.ts`) sizes the army from `policy.garrison`, **not** `policy.recruitment`: `target = min(settlements × GARRISON_PEACE(1) × (aggr≥1.2?2:1) × policy.garrison, armyCap)`. So Aurelia's target is ~`19 × garrison`, and the 3× **recruitment** slider is simply never consulted while at peace. The recruitment control is effectively dead unless you're at war.
2. **`recruitSoldiers` defeats its own multiplier.** In `recruitSoldiers` (`war.ts`), `adjustedTarget = target × policy.recruitment`, but the per-settlement loop guard is `if (count >= target) break;` — it uses the **raw** `target`, not `adjustedTarget`. So recruitment > 1 can never push the count past the base target through this loop. Fix: compare against `adjustedTarget` consistently.
3. **Vassals keep frozen wartime armies.** Vassals are skipped entirely from the military loop (`court.ts:225`), so they never demobilize — they retain the large armies (52, 92 in the playtest) they built while independent, while the peaceful player-master sits at its tiny garrison target (~27). That inverts the expected ordering.

**Fix direction:**
- Make the player's army size driven by a clear control. Either route peacetime recruiting through `policy.recruitment` (so the slider you set actually grows the army), or relabel so the player understands garrison vs. recruitment (cross-ref `improve_ui_and_notifications.md` Part B — the slider should show its real effect). Recommend: peacetime player army target = `f(garrison, recruitment)` and cap by pop/treasury (ties into the economy plan + the soldier-uncap discussion).
- Fix the `count >= target` vs `adjustedTarget` inconsistency in `recruitSoldiers`.
- Decide vassal army policy: vassals should probably demobilize toward a garrison (and/or their levies count toward / answer to the master). At minimum they shouldn't out-army their overlord while frozen.

**Validate:** with recruitment high and a large realm at peace, the player fields a proportionally large army; no faction (especially a vassal) has a wildly larger army than a much bigger overlord.

# Part 8 — Bug: master–vassal stuck in truce / negative relations

**Confirmed.** `makePeace` (`src/sim/diplomacy/peace.ts`) — the vassalization branch sets the relation to friendly (`d.relations[pk] = 40`), but **after** the `if (loser >= 0)` block, every path falls through to:
```js
d.truces[pk] = world.tick + DIPLO.TRUCE_TICKS;
d.relations[pk] = DIPLO.PEACE_RELATION; // -15  → OVERWRITES the vassal's +40
```
So a fresh vassal is immediately put into a **truce** with its master and its relation is reset to −15 (then drifts further negative). That's why the player sees a permanent hostile-looking truce with their own vassals, and why "Declare War" even shows against them (compounds Part 5).

**Fix:** make the truce/relation tail **conditional**. Skip (or special-case) it for the vassalization path — vassals should retain the friendly relation and a master–vassal *alliance* state, not a truce. Only apply `TRUCE_TICKS` + `PEACE_RELATION` to ordinary peace and cession outcomes. Ensure `stateOf` renders master–vassal as a vassalage/alliance, not TRUCE.

**Validate:** after vassalization, master–vassal relation stays friendly (no truce, no Declare War button), and stays stable over time rather than decaying into hostility.

---

## Validation harness (recommended)

Pacing is a tuning problem — measure it. Add a small headless instrumentation pass (or extend `test/headless.ts`) that, over a long run, reports: **average war duration, cities captured per war, % of ticks the player/each faction is at war vs. truced vs. neutral**, and number of wars in the last N ticks. Tune Parts 1–2 against these numbers rather than by feel, then spot-check in-browser.

## Suggested order & sizing

| Part | What | Size | Notes |
| :-- | :-- | :-- | :-- |
| 8 | Master–vassal truce/relation overwrite | XS | one-line conditional in `makePeace`; explains the "stuck truce" |
| 5 | Vassal declare-war guard | XS | quick correctness fix |
| 6 | Vassalize-all counts as a win | S | `isUnderHegemony` helper in `checkWinLoss` |
| 7 | Player army / recruitment-slider fixes | S–M | `recruitSoldiers` target bug + peacetime recruitment + vassal demob |
| 4 | Captured-agent recolor | S | reproduce, then reassign/convert consistently |
| 1 | War scales with stakes (capture penalty by share) | M | biggest pacing lever; needs metrics |
| 2 | Truce tuning + player break-truce | S–M | depends on metrics from Part 1 |
| 3 | Peacetime content (start: bandit camps) | M+ | backlog; after 1–2 |

The four XS/S correctness bugs (Parts 8, 5, 6, 7) are cheap and high-value — do them first.

**Status (commit `366d7be`):** Parts 1, 2 (incl. player break-truce), 4, 5, 6, 8 are ✅ implemented and verified. Part 7 is **partially** done — `recruitSoldiers` was rewritten to take a flat `target` (the old `count >= target` multiplier bug is gone), but see Round 2 below: the recruitment slider no longer affects soldiers at war, and the debt gate still blocks recruiting. Part 3 (peacetime content) not started.

**Definition of done:** capturing a single city no longer ends a war against a large empire; late-game wars span multiple cities and feel sustained; truces are shorter and the player can break one at a cost; captured cities show only the new owner's color with no stale agents; declaring war on your own vassal/master is impossible from UI and code; **master–vassal pairs read as friendly vassalage (no perpetual truce); vassalizing every rival triggers Victory; the player's recruitment setting actually produces a proportional army and no vassal out-armies a much larger overlord;** `npm run typecheck` clean and the pacing metrics confirm the intended shift.

---

# Round 2 — recruitment control redesign (new)

Two follow-ups from playtest 3. Both center on the **Military Recruitment** control and the new global treasury.

## Part 9 — You should be able to recruit soldiers on credit (into debt)

**Problem:** `recruitSoldiers` (`src/sim/diplomacy/war.ts`) gates each company on `treasuryOf(world, s.factionId) >= DIPLO.SOLDIER_COST.gold` (6). With the single faction treasury, a low/negative balance silently blocks **all** recruitment — even mid-war with recruitment maxed and stance aggressive (the playtest symptom). Mobilizing for war is exactly when a kingdom should be allowed to deficit-spend.

**Fix:**
- Drop the `treasuryOf >= c.gold` condition from the soldier recruit gate; keep the **physical** gates (`s.stock.food >= c.food`, `s.stock.ore >= c.ore`, pop floor). `spendGold` already permits a negative treasury (no floor), so the gold simply goes into debt and the existing exponential debt penalty / austerity handles the consequences.
- Keep one safety rail so the AI can't suicide: don't recruit if it would push the treasury past the terminal `−DEBT_DEATH (1000)` floor. (Recruiting between 0 and −1000 is fine and intended.)
- Note the interaction with austerity: today the AI austerity branch (`court.ts`, treasury ≤ −`DEBT_AUSTERITY`) sets `policy.recruitment = 0` and disbands down to a garrison. That's correct for the AI, but make sure the **player** is never force-disbanded mid-war by austerity (the player is already skipped in the policy loop — verify the disband step is too, and that the AUSTERITY *goal* on the player's settlements doesn't block soldier recruiting).

**Validate:** with treasury at/below zero, a player at war still recruits up to their target (going into debt); recruitment only stops at the `−DEBT_DEATH` floor; AI factions don't recruit themselves to death.

## Part 10 — Recruitment slider = absolute army target (0 → soldier cap), not a 0–3 multiplier

**Goal:** the Military Recruitment control becomes your **target army size in actual soldier count**, giving fine control. Range is `0 → your soldier cap`; as the cap grows with your empire, the slider's max grows but the **handle position stays put**, so your target auto-scales while you keep precise control.

**Design:**
- Define the player's **soldier cap** = the max army the population can field, e.g. `floor(totalFactionPop / DIPLO.SOLDIER_POP_COST)` with a reserve (each company already costs 15 pop), rather than the conservative aggression-scaled `armyCap` (which is the *AI's* preferred size). Pick the formula and document it; this is the slider's upper bound.
- **Store the policy as a fraction** `0..1` of the cap (this is what makes "position stays the same as the cap grows" work). Internally `policy.recruitment ∈ [0,1]`.
- **Target soldiers (player)** = `round(policy.recruitment × soldierCap)`. Route this as the `target` into `recruitSoldiers` for the player in **both** peace and war (replace the `armyCap`-as-war-target for the player; AI keeps `armyCap`). So the slider always controls your army size, in war and peace alike.
- **UI (`index.html` + `updateHud.ts` + `main.ts`):** make the range dynamic each refresh — `max = soldierCap`, `value = round(fraction × soldierCap)`, displayed as a **count** (e.g. "Target army: 137 / 240"), step 1. On input, `fraction = value / soldierCap`. Because we persist the fraction, when the cap rises the handle stays at the same spot and the count climbs.
- **Decouple villager hiring.** Today `policy.recruitment` *also* multiplies `maxVillagers` in `labor.ts` — that conflation breaks once recruitment means "soldier target." Remove the recruitment multiplier from villager hiring (let it stay demand-based), or split into a separate civilian-labor lever. The Military Recruitment slider should affect **soldiers only**.
- **Fix the now-wrong readout** in `src/ui/hud/policyLabels.ts` (it claims "in war, recruit Nx the soldier target") to describe the new absolute target, per `improve_ui_and_notifications.md` Part B (show real effect).

**Validate:** the slider reads as a soldier count and tops out at your current cap; raising population raises the max and the count while the handle stays put; setting it high recruits that many soldiers (subject to pop/food/ore and debt), in both peace and war; villager hiring is unaffected by it.

## Round 2 — order & sizing

| Part | What | Size |
| :-- | :-- | :-- |
| 9 | Recruit into debt (drop gold gate; keep `−DEBT_DEATH` rail) | XS |
| 10 | Recruitment slider → absolute army target (fraction-of-cap, dynamic UI) | M |

**Round 2 done when:** you can deficit-spend to raise an army; the Military Recruitment control is an absolute soldier target (0 → cap) that scales its bounds with your empire while holding handle position; it drives army size in peace and war; villager hiring is decoupled; labels match; `npm run typecheck` clean.
