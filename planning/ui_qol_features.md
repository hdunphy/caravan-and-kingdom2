# Implementation Plan: UI Quality-of-Life — Empire View, Settlement Cards, In-Map Actions

Make ruling a kingdom legible and fast: an at-a-glance empire dashboard, a settlement summary you can pull up by clicking on the map (yours **and** enemies'), and contextual actions (declare war, etc.) right where you are so you never dig through menus.

Grounded in branch `treasury-and-debt`, commit `b01ac6d` (the `add-player` branch — WP5 player faction — and `improve_ui_and_notifications.md` notification tiering are now **merged in**). **Re-grep symbols before editing — line numbers drift.** This is **UI-only**: it reads world state and calls existing sim action functions; it must not add new sim state or affect determinism. Sim is never imported into `src/ui/` for mutation beyond the already-exposed player-action helpers wired through `src/main.ts`.

> Depends on / overlaps (status as of `b01ac6d`):
> - `fix_player_faction_wp5.md` **Fix 3 — ✅ DONE.** `playerDeclareWar(world, targetId)` (`src/sim/diplomacy/war.ts`) and `sueForPeace(world, war, fid)` (`src/sim/diplomacy/peace.ts`) exist and are wired in `src/main.ts` via `.declare-war-btn` / `.sue-peace-btn` click delegation. Part C's card actions reuse these helpers + that delegation pattern directly — no new sim wiring needed.
> - `improve_ui_and_notifications.md` — ✅ notification tiering is **implemented**: `AlertSeverity` (`INFO`/`IMPORTANT`/`CRITICAL`) and `acknowledged` on the `Alert` type, a pausing `#critical-alert-modal`, and a clickable `#alerts-panel` (`.alert-item`, dismiss + pan) in `src/main.ts`. The alert→pan code there is the selection path to unify with this plan's `selectSettlement` helper.
> - `economy_treasury_and_debt.md` — ⏳ not started yet (this branch). Until the faction treasury lands, per-settlement gold is still `s.gold`; the Empire view's income column should switch to the derived net-income readout once the treasury exists.

---

## Current state (what exists)

- **Inspector** (`src/ui/hud/updateHud.ts`, ~line 197): clicking a hex sets `selected` (`src/main.ts:89-94`) and renders a **text-only** summary in the sidebar `#inspector` panel — terrain, on-hex resources, and for a settlement: tier/role/goal/focus, pop/tools/gold, stock, buildings, agent counts. It works for any settlement (yours or enemy) already, but it's plain text with **no actions**.
- Clicking **force-switches to the Inspector tab** (`src/main.ts:97-98`), which is jarring and loses your current tab.
- **Kingdoms tab** shows faction-level *aggregates* and now has both **Sue-for-Peace** (`.sue-peace-btn`) and **Declare-War** (`.declare-war-btn`) buttons per rival, handled via click delegation in `src/main.ts` — but still **no per-settlement list**.
- **Notifications are tiered** already: `#alerts-panel` toasts are clickable (`.alert-item` → pan/dismiss) and `CRITICAL` alerts raise the pausing `#critical-alert-modal`. Reuse this, don't rebuild it.
- **Win/loss** exists (`showGameOver` in `src/main.ts`). Military stance is a 3-way Defensive/Balanced/Aggressive control (`.stance-btn`).
- Selection is a bare hex object (`selected` in `src/main.ts`); the HUD redraws every ~10 frames, so a card can update live.
- Camera pan exists (`src/ui/camera.ts`); renderer is `src/ui/renderer.ts`.

---

# Part A — Empire Summary view ("Realm" dashboard)

**Goal:** one screen to diagnose the whole empire at a glance.

- New tab "Realm" (add a `.tab-button` + `.tab-content` in `index.html`; render in a new `src/ui/hud/realm.ts` called from `updateHud`).
- **Header strip:** settlement count · total population · treasury · army size · # active wars · net income/tick. (Treasury/income come from the economy plan's faction treasury + derived per-settlement income.)
- **Sortable table** of the player's settlements, one row each:
  - Name · Tier · Population (with ▲/▼ trend) · Goal · Focus · **Food days** (starvation runway) · Net income/tick · Soldiers/garrison · Stock summary · Status flags.
  - **Status flags / color** so problems jump out: red row for under-siege or starving (foodDays < ~10), amber for boxed-in (can't expand) or in-debt, grey for idle-worker surplus. Pull the same conditions the alert system uses.
  - Sort by any column (default: problems first). Persist the chosen sort in `localStorage`.
- **Row click → select that settlement**: set `selected` to its hex, pan the camera to it (`camera`), and open its card (Part B). Reuse one shared `selectSettlement(s)` helper so Realm rows, the map, and alerts all funnel through the same path.
- **Observer mode** (`playerFactionId === null`): show all factions (grouped/collapsible) or a faction picker, since there's no "your" empire.

**Accept:** Realm tab lists every player settlement with live stats; problem rows are visibly flagged and sort to the top; clicking a row selects + pans + opens the card; header totals match the faction aggregate.

---

# Part B — On-map settlement summary card (yours and enemies')

**Goal:** click a settlement on the map and get a compact, in-context card — not a forced sidebar tab switch.

- A floating card (`#settlement-card`, absolutely positioned) anchored near the clicked settlement on the canvas, following it on pan/zoom (recompute from hex→pixel each frame, like the alerts overlay). Dismiss on Esc or clicking empty space.
- **Stop force-switching to the Inspector tab** on click (`src/main.ts:97-98`): show the card instead; keep the richer sidebar Inspector as the "details" expansion. (Make the auto-switch optional or remove it.)
- **Card updates live** while selected (it's re-rendered on the HUD timer).

**Card contents — own settlement:**
- Name · faction (gold-ringed) · tier · goal/focus · pop (+trend) · food days · soldiers · net income · top stock/needs · active building.
- A one-line "diagnosis" (e.g. "Starving — 6 food-days left", "Idle workers: 4", "Boxed in — no room to expand").

**Card contents — enemy settlement:**
- Name · faction (colored) · tier · **your relation** to them · **strength comparison** (yours vs theirs, from `src/sim/diplomacy/strength.ts`) · at-war/at-peace/truce status.
- Decide the intel model: simplest is full visibility (matches "it should work for enemies"); optional later, gate exact stock/pop behind a fog/"scouted" level and show approximate bands. Note the choice; start full.

**Accept:** clicking any settlement opens a card pinned to it that tracks pan/zoom and updates live; own vs enemy cards show the right fields; no tab is force-switched; Esc/empty-click dismisses.

---

# Part C — Contextual actions on the card (no menu trips)

**Goal:** act from where you're looking.

- **Enemy card actions** (reuse the already-shipped helpers — see status box):
  - **Declare War** (when at peace + legal: no truce, war-chest ok) → calls `playerDeclareWar(world, targetId)`.
  - **Sue for Peace** (when at war) → `sueForPeace(world, war, world.playerFactionId)`.
  - (Optional) **Send Gift** to improve relation (reuse the gift transfer).
  - Show why an action is disabled (truce timer, already at war, insufficient war chest) as a tooltip, rather than hiding it.
- **Own card actions:**
  - **Set Focus** (PEACE / MOBILIZE / WAR) for that settlement/faction (the `focus` field already drives governors).
  - **Pan/center** and **Open full details** (sidebar Inspector).
  - (Optional) flag a settlement as **priority** for reinforcement (UI hint only unless sim supports it).
- All actions route through the **existing** click-delegation in `src/main.ts` (the `.declare-war-btn` / `.sue-peace-btn` handlers are already there — extend the same pattern with `data-action`/`data-target` attributes for the card). Actions apply on the next Court session per the roadmap's deterministic-edict rule; reflect "queued: council convenes next session" in the button state.

**Accept:** declaring war / suing for peace / setting focus all work from the card; illegal actions are visibly disabled with a reason; behavior matches doing the same from the Kingdoms tab.

---

# Part D — Other QoL features (suggested, pick per appetite)

**Navigation & camera**
- **Cycle my settlements** (e.g. `Tab`/`N`) and **jump to next alert** — pan + select in turn; huge for large empires.
- **Double-click to center**; **search/jump to settlement by name**.
- **Follow** a selected army/caravan (camera tracks it).
- **Minimap** (corner) for large maps, click to jump.

**Keyboard shortcuts** (wire in `src/main.ts`)
- `Space` pause/resume; `1/2/3/4` speed; `Esc` deselect/close card; `WASD`/arrows pan; `+/-` zoom. Show a `?` cheatsheet overlay.

**Map overlays / lenses** (toggles in `src/ui/renderer.ts`)
- Color hexes by **owner** (territory), by **danger** (siege/starving), or by **resource richness**; draw **faction borders**. One active lens at a time, toggle in a small control. Big for "how is my empire doing" at a glance.
- **Hover tooltip** on hexes/settlements (quick peek without clicking).

**Info & feedback**
- **Trend arrows / sparklines** on key stats (pop, treasury) so you see direction, not just value — reuse `src/ui/hud/chart.ts`.
- **Tooltips on jargon** (goal names, focus, policy terms) explaining what each means.
- **Pause-on-select** option for careful inspection.
- **At-war banner** + quick "view front" jump while wars are active.

**Comfort**
- **Remember active tab** and sidebar state across reseed/reload (`localStorage`); don't reset to a default tab.
- **Collapsible/resizable sidebar** to give the map more room.
- **Consistent styling:** promote the repeated inline-style template strings in `updateHud.ts` into CSS classes in `index.html` as you touch them (cards, rows, badges) — makes all of the above easier to keep coherent.

**Accept (Part D):** each shipped feature works without affecting the sim; shortcuts and lenses are discoverable; state persistence survives reload.

---

## Determinism & dependencies

- Pure UI: reads `world`, calls already-exposed player-action helpers. No new sim state, no change to `test:headless` determinism. Verify the headless run is unaffected after wiring actions.
- Sequence with the other plans: the player-action helpers (`playerDeclareWar`/`sueForPeace`) and notification tiering are **already merged**, so Part C and the alert→select unification can proceed now. The Empire/card income field should switch from `s.gold` to the derived net-income readout once the **economy** plan's faction treasury lands.

## Suggested order & sizing

| Part | What | Size | Notes |
| :-- | :-- | :-- | :-- |
| B | On-map settlement card (own + enemy), stop forced tab switch, shared `selectSettlement` | M | highest daily value; foundation for the rest |
| A | Realm/Empire summary table | M | reuses `selectSettlement` |
| C | Contextual actions on card | S–M | needs WP5 Fix 3 |
| D | QoL grab-bag (camera/keys/lenses/comfort) | M | incremental; ship piecemeal |

**Definition of done:** a Realm tab summarizes every settlement with problem-flagging and click-to-jump; clicking any settlement (yours or enemy) opens a live, map-anchored card with the right info per ownership; war/peace/focus actions work from the card with disabled-reasons; chosen QoL features (at minimum keyboard shortcuts + one map lens + alert/row/card unified selection) are in; `npm run typecheck` clean and `npm run test:headless -- 2500 42` PASS (UI changes leave the sim untouched).
