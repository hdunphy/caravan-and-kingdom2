# WP6 (revised): World Events, Royal Projects & Player Targeting

**This supersedes the original roadmap WP6** (drought/plague/**bandit camps**). Keeping *random events*, but dropping bandit camps and adding two new pillars the king actually drives:

- **A. Random events** — seeded, deterministic, ideally *choice-driven* (a king decision, not just a passive modifier).
- **B. Royal Projects / Edicts** — spend *excess* materials for bonuses (the "wheelbarrows for growth" idea, generalized into a clean catalog). Gives the late-game surplus a purpose.
- **C. Targeting** — let the player point the kingdom at things: a *site* for the next settlement (with valid areas shown), and a *town* to capture in a war.

This is a brainstorm/design doc, not a build spec — it lists options and **open decisions** to settle before implementation. Grounded in `war-improvements`. Determinism rule still holds: every player choice enters the sim as recorded data (like the policy pipe), and events are seeded from `world.rng` at a fixed cadence.

---

## Pillar A — Random events (deterministic, choice-driven)

**Framework**
- A `world.events` system ticked at a fixed cadence (e.g. every `EVENT_INTERVAL` ticks), rolling against `world.rng` so it stays deterministic. Suggested home: `src/sim/systems/events.ts`, registered in the systems barrel.
- Each event = an `alert` (reuse the WP4 tiering: INFO/IMPORTANT/CRITICAL) + an optional **king choice** with a deadline. If the player (or AI) doesn't choose by the deadline, a deterministic default resolves it (so AI and headless stay deterministic).
- Choices are the interesting part: most events should offer 2–3 options with **resource trade-offs**, not just "OK."
- AI factions auto-resolve via a simple deterministic policy (e.g., pick the cheapest affordable beneficial option).

**Event catalog (no bandit camps — favouring economic/edict-style choices):**

*Natural / environmental*
- **Bountiful Harvest** — kingdom-wide food rate ×1.5 for N ticks (pure good news; INFO). *(Global per A3.)*
- **Drought** — kingdom-wide food rate ×0.5 for N ticks. Choice: "Open the granaries" (spend food stock to avoid a growth penalty) vs ride it out. *(Global per A3.)*
- **Plague** — a settlement's pop decays until you act. Choice: "Quarantine" (halt its trade/recruitment for N ticks to stop the spread) vs "Let it run" (faster recovery, more deaths).
- **Hard Winter** — food consumption ×1.25 kingdom-wide for N ticks; pairs naturally with the new rations lever.

*Economic / discovery*
- **Rich Vein Discovered** — a hex near a settlement reveals bonus ore/stone. Choice: invest stone/timber to develop the mine now vs leave it.
- **Master Caravaneer** — one-time: a wandering merchant offers a bulk buy/sell at a good rate (dump surplus for gold, or buy scarce goods cheap).
- **Trade Boom / Bust** — caravan income ×1.5 / ×0.5 for N ticks.

*Social / population*
- **Migrants Arrive** — a band of settlers wants in. Choice: "Welcome them" (instant pop to a chosen/total settlement, but a food cost) vs "Turn them away" (small relation/morale ding). Ties to the targeting pillar.
- **Festival Opportunity** — spend food + gold for a temporary kingdom-wide growth/morale spike. (Basically a one-shot project surfaced as an event.)
- **Unrest** — fires in heavily-indebted or recently-captured settlements. Choice: spend gold to placate vs risk a revolt (settlement temporarily stops producing / could defect). A good *cost* for warmongering and reckless debt.

*Diplomatic (non-combat-spawn)*
- **Defector** — a rival's vassal secretly offers to switch allegiance for a gold gift.
- **Royal Wedding / Pact Offer** — a rival proposes a non-aggression pact or trade deal (one-click diplomacy).

**Decisions (locked):**
- A1. **Mix** — ~⅓ pure ambient modifiers, ~⅔ king choices.
- A2. **One active decision event at a time** for the player; ambient modifiers may stack.
- A3. **Global scope for now** — no region concept yet. Natural events apply kingdom-wide (or to a whole faction) rather than to a sub-region; a regional model can come later.

---

## Pillar B — Royal Projects / Edicts (spend surplus for bonuses)

The "wheelbarrows" idea, generalized: a menu of **investments that convert a surplus resource into a bonus**. This is distinct from the existing policy sliders (which are continuous steady-state behaviour) — projects are **discrete spends for buffs**, and crucially they're a **sink for the excess stockpiles** the economy piles up late-game.

**Model (locked): one-shot timed projects** — pay a lump of resources now → a buff for N ticks. Simple, punchy, no bookkeeping; it's also the natural sink for surplus. *(A standing-edict-with-upkeep model was considered and deferred.)*

**Catalog, organized by the resource it drains** (names are placeholders):

| Spend | Project | Effect |
| :-- | :-- | :-- |
| Timber | **Wheelbarrows & Carts** | +extraction (or +growth) for N ticks |
| Timber | **Public Granaries** | +food storage cap / softens starvation for N ticks |
| Stone | **Aqueducts** | +population growth (clean water) for N ticks |
| Stone | **Bastions** | +settlement defense (helps in the longer wars) |
| Ore | **Tooling Drive** | +tools / +military strength for N ticks |
| Ore | **Arms Stockpile** | next levy of soldiers is cheaper / partly pre-paid |
| Food | **Royal Feast** | one-shot kingdom-wide growth/morale spike |
| Food | **War Rations Cache** | offsets the food drain of a big standing army |
| Gold (treasury) | **Patronage** | relation boost with a chosen rival, or fund a project without the raw material |

Design notes:
- Scope it **faction-wide** to start (king-appropriate, less UI) — a "Projects" panel in the Crown/Policy tab listing affordable projects with their cost and effect. Per-settlement projects are a possible later refinement.
- Buffs should be **modest and temporary** so they're a recurring decision, not a fire-and-forget power spike — and so surplus keeps getting spent.
- Implementation pipe: a project is a player input recorded with its tick (deterministic), applying a timed modifier stored on the faction/world (like an event modifier). Reuse the same modifier mechanism as Pillar A.

**Decisions (locked):**
- B1. **One-shot timed projects** (pay a lump now → buff for N ticks). No standing-edict/upkeep model for now.
- B2. **Faction-wide** scope — a "Projects" panel in the Crown/Policy tab; not per-settlement.
- B3. **AI uses projects too** via a simple deterministic heuristic (e.g. buy the cheapest beneficial affordable project), so the player isn't at an inherent advantage and headless stays balanced.
- B4. **Deferred to a future pass:** event/discovery-unlocked projects (A↔B synergy). Build the flat project catalog first.

---

## Pillar C — Player targeting

### C1. Target a site for the next settlement

Today `findColonySite(world, s)` auto-picks the best valid site. Its validity rules (reuse these to show the player what's allowed): hex exists, **unowned**, terrain **not** Water/Mountains/River, **≥ `EXPAND_MIN_DIST` (5)** from the origin, and **no settlement within `EXPAND_MIN_DIST`**. It then scores by resource variety/proximity.

**Player feature:**
- A **"valid colony sites" map overlay** (a new map lens — ties into the lenses already added in the UI QoL work): highlight every hex passing the validity predicate, optionally shaded by the existing site score so the player sees good vs marginal spots.
- Let the player **click a valid hex to set a target site** (per-settlement, or a single "next colony goes here" marker). When that settlement hits EXPAND and dispatches, the settler heads to the player's target instead of the auto-pick.
- Hook: in `civilGovernor`'s dispatch, if the player set a target for this settlement, use it instead of `findColonySite`. Validate at dispatch time (still must be unowned/valid); if it's been taken, fall back to auto or alert the player.
- Consider letting the player target **beyond `EXPAND_SEARCH_RADIUS`** (manual expansion can be more ambitious than the AI's auto-search). Decision below.

**Decisions (locked):**
- C1a. **One global "next colony" marker.** The next eligible town to hit EXPAND fulfils it (then the marker clears). Not per-settlement.
- C1b. **Allow targeting outside the normal search radius** — a deliberate king choice; the cost is a longer settler journey. (The valid-site overlay should still show eligibility — unowned, valid terrain, ≥`EXPAND_MIN_DIST` from any settlement — regardless of distance from the origin town.)
- C1c. **If the target becomes invalid** (claimed/occupied by the time a settler dispatches): **alert the player and fall back to the auto-pick** (`findColonySite`), clearing the marker.

### C2. Target a town for capture in a war

`war.goalId` already **is** the objective: `warCouncil` sieges the goal town, and only re-picks via `pickWarGoal` when the goal is captured or no longer enemy-owned. So player targeting is a small, safe override.

**Player feature:**
- When declaring war (or any time during it), let the player **pick which enemy town is the war objective** — set `war.goalId` to it. The army then concentrates on besieging that town.
- UI: a **"Set as war objective" action on the enemy settlement card** (the card from the UI QoL work), and/or a target marker on the map. Show the current objective clearly.
- Allow **re-targeting mid-war** (objective shifts as the front moves). When the target falls, prompt the player for the next objective (or auto-pick if they don't choose, deterministically).
- Note: `pickWarGoal` normally filters by `STRIKE_RANGE`; a *player* override can ignore that to let you set an ambitious deep target (the army just has farther to march).

**Decisions (locked):**
- C2a. **Re-targetable anytime** during the war (not just at declaration).
- C2b. **Player objective overrides the `STRIKE_RANGE` filter** — you can set an ambitious deep target; the army just marches farther.
- C2c. **One objective at a time.** When the target falls, re-prompt the player for the next objective (deterministic auto-pick if they don't choose by a deadline).

---

## Determinism & integration

- All three pillars feed the sim as **recorded player inputs / seeded rolls**, never live DOM reads — same discipline as the policy substrate. Events roll on `world.rng`; projects and targets are data on the faction/world stamped with their tick.
- Reuse existing infrastructure: the **alert tiering** (A surfaces through it), the **map lenses** (C1's valid-site overlay), the **settlement card actions** (C2's objective, plus migrant placement from A), and the **policy/edict pipe** (B).
- Add a headless check that events fire deterministically and that AI auto-resolution keeps run-to-run determinism PASS.

## Suggested phasing & sizing

| Phase | What | Size | Why this order |
| :-- | :-- | :-- | :-- |
| 1 | Event framework + 3–4 events (choice-driven, alert-integrated, AI auto-resolve) | M | foundation; reusable modifier system |
| 2 | Royal Projects (one-shot timed, faction-wide) reusing the modifier system | M | gives surplus a purpose; biggest "new toy" feel |
| 3 | C2 war-objective targeting (set `war.goalId` via card/map) | S | tiny hook, big agency payoff; pairs with longer wars |
| 4 | C1 settlement-site targeting (valid-site lens + dispatch override) | M | needs the overlay + dispatch hook |
| 5 | More events + project variety; optional standing edicts; A↔B unlock synergy | M+ | content, once frameworks exist |

**All design decisions are locked** (see the "Decisions (locked)" blocks under each pillar). This doc is ready to hand to an implementing agent. Quick recap of the locked choices: events are a ⅓-ambient/⅔-choice mix, one decision-event at a time, global scope; projects are one-shot timed, faction-wide, AI-enabled, with discovery-unlocks deferred; the next-colony marker is a single global target that may sit outside the search radius and falls back to auto if invalidated; war objectives are re-targetable, override strike range, one at a time.
