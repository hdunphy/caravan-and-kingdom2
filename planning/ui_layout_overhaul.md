# Plan: UI Layout Overhaul (de-cluttering the right panel)

The right-hand panel is overburdened and the tabs have shrunk to the point of being hard to use. This restructures the whole HUD into distinct zones, fixes specific data gaps, and prepares the UI for **more factions and bigger maps**.

Grounded in `war-improvements`. Builds on (and partially supersedes) `improve_ui_and_notifications.md` and `ui_qol_features.md` — reuse what's there (settlement cards, map lenses, alert tiering, Realm view) rather than duplicating. This is UI-only; no sim/determinism impact.

> The HUD render currently lives in `index.html` (markup + inline CSS) and `src/ui/hud/updateHud.ts`, with `realm.ts`, `card.ts`, `chart.ts`. `updateHud.ts` rebuilds `innerHTML` strings each refresh — which is exactly what makes the panel cumbersome to grow. **This overhaul is done as a Svelte migration** (see *Tech foundation* below): each zone becomes a Svelte component (`Banner.svelte`, `Sidebar.svelte`, `DiplomacyMatrix.svelte`, `WarPanel.svelte`, `BottomLog.svelte`, `AnalyticsWindow.svelte`, `SettlementCard.svelte`, …) rather than imperative DOM-string builders.

---

## Tech foundation: migrate the HUD to Svelte

The HUD is moving from vanilla `innerHTML`-rebuilding to **Svelte components**. The layout overhaul *is* a near-total HUD rewrite anyway, so we build the new layout **directly in Svelte** instead of rebuilding it twice in vanilla.

**Why it's low-risk here:** the sim never imports `src/ui/`, so the UI layer is swappable without touching game logic. The migration is contained to `src/ui/` + `main.ts` + `index.html`, and the project already builds with Vite + TS (add `@sveltejs/vite-plugin-svelte` + `svelte`).

**Firm architectural rules:**
- **The map stays on `<canvas>`, imperative, exactly as it is now.** Svelte renders only the HUD/panels. Do **not** put the per-hex map in components.
- **Never re-render Svelte at 60fps.** The render loop keeps drawing the canvas every frame; the HUD updates at a **throttled human rate** (a few times/sec, or on meaningful change). Drive this with a single store that the loop bumps on a timer (e.g. every ~150–250ms or every N ticks), not every frame.
- **`world` stays the single source of truth.** Don't deep-clone it into component state. Hold the live `world` reference in a Svelte store plus a `tick`/version counter; components read derived values from `world` when the counter changes. Player actions still flow into the sim through the existing functions (`playerDeclareWar`, policy mutations, etc.) — the determinism discipline is unchanged.
- **Keep sim ↔ UI separation.** Svelte components may import pure read helpers from `src/sim/**` (as the current UI does) but never UI from sim.

**Framework:** **Svelte** (chosen). Fine-grained reactivity suits frequent HUD updates with minimal boilerplate, and the bundle stays small. `chart.ts` and the canvas renderer remain plain TS modules the components call into.

**Migration sequencing:** stand up the Svelte scaffold first (mount one root component alongside the canvas), then port zones one at a time, deleting the matching `updateHud.ts` section as each lands — so the app stays runnable throughout rather than a big-bang rewrite.

---

## Target scale (measured)

Profiled the sim headless to 2,500 ticks (sim cost only; rendering not included):

| Config | Hexes | Settlements | Agents | Sim cost |
| :-- | :-- | :-- | :-- | :-- |
| R=24, F=4 (current) | 1,801 | ~9 | ~700 | ~1.5 ms/tick |
| R=32, F=6 | 3,169 | 29 | 409 | 2.8 ms/tick |
| R=48, F=8 | 7,057 | 52 | 766 | 4.2 ms/tick |

Cost scales with how *full* the map gets (agents + settlements over time), roughly linearly, not with raw hex count.

**Targets:**
- **~8 factions** (design the matrix/palette to handle up to ~10–12; default 6–8). Diplomacy is O(N²) but cheap (≈66 pairs at 12 factions). The real limit is player legibility, not the sim.
- **Map ~R=40** (≈5k hexes) as the comfortable target. Two caveats set the real ceiling: **16× fast-forward** multiplies sim cost per frame (4 ms/tick × 16 ≈ 15fps of sim work), and the **renderer currently redraws every hex/agent each frame with no viewport culling** — the untested half and the likely bottleneck past ~R=40.
- **Prerequisite before scaling past ~R=40: add renderer viewport culling** (draw only on-screen hexes/agents) in `renderer.ts`. This is a sim-independent perf change and unblocks bigger maps + the minimap.

---

## Target layout (zones)

```
┌────────────────────────────────────────────────────────────┐
│ TOP BANNER: crest · treasury · pop · army · food · ⚔wars · tick │ ⏸ 1× 4× 16× │ 🔔 │ ⚙ │
├──────────────────────────────────────────────┬─────────────┤
│                                              │  SIDEBAR    │
│                 MAP                           │  (4 tabs):  │
│         (on-click settlement CARDS)          │  Kingdoms   │
│         [persistent WAR panel if at war]     │  Crown      │
│                                              │  Realm      │
│                                              │  Analytics  │
├──────────────────────────────────────────────┴─────────────┤
│ BOTTOM LOG: latest event ………………………………………  [▲ expand]      │
└────────────────────────────────────────────────────────────┘
```

### 1. Top banner (new, full-width)
- **Summary strip:** kingdom crest/name, treasury (color by debt), total pop, army size, food status (surplus/deficit or worst foodDays), active-war count, tick. These are the empire vitals you currently dig into Realm for — promote them so they're always visible.
- **Time controls** move here: ⏸ / 1× / 4× / 16× (from the sidebar `[data-speed]` buttons).
- **Notification bell** (🔔) with unread count → opens the alert list (reuse the alert system).
- **Settings gear** (⚙) → menu containing **Reseed, Save, Load, Playstyle** (moved out of the sidebar). Also a good home for toggles (pause-on-critical, autosave, number format) and save slots.
- Observer mode: banner shows world-level totals or a faction switcher.

### 2. Sidebar — fewer, larger tabs
After moving things out, the sidebar holds **4 tabs** (bigger hit targets):
- **Kingdoms** — faction overview + the new **relationship matrix** (§5).
- **Crown** — the policy sliders/edicts (Policy tab, renamed to fit the king theme; later the Royal Projects panel from WP6).
- **Realm** — the settlement table (§7).
- **Analytics** — charts, with pop-out (§6).
- **Removed:** *Inspector* tab → replaced entirely by the on-click settlement **cards** (§3). *Chronicle* tab → moves to the **bottom log** (§4).

### 3. Inspector → on-click cards (already built)
- Delete the Inspector tab and its `#inspector` panel. The `card.ts` settlement card already shows the per-settlement detail on click for both your and enemy towns — make that the sole inspect surface.
- Clicking empty space / Esc dismisses the card. (Also: stop the old forced tab-switch on click — see the QoL plan.)
- Minor cleanup: `card.ts` has a dynamic `import('../../core/hex.js')` inside the render path and a couple of leftover "Wait, …" comments — fold the import to the top and tidy while you're in there.

### 4. Chronicle → bottom event-log bar
- A slim, full-width bar pinned to the bottom showing the **most recent event** as a one-line ticker (reuse the badge/color logic already in `updateHud.ts`).
- An **expand** control slides it up into the full filterable log (the current Chronicle filters: All / Conflict / Economy / Build, plus a severity filter once tiering is in). Collapsed by default so it doesn't eat space.
- Clicking a log line with coords pans/selects (shared `selectSettlement` path).

### 5. Relationship matrix (scales to many factions)
The current pairwise `a–b` rows get buried and don't scale. Replace with an **N×N grid**:
- Row/column headers = faction color swatches + initials; the player's row/column highlighted.
- Each cell = the relation state color (WAR red / TRUCE yellow / NEUTRAL grey / FRIENDLY green / vassal tint) with the numeric relation, and a small icon (⚔ 🤝 ✓). Reuse `stateOf` / `getRelation`.
- Diagonal = self (faction crest). Vassal links shown distinctly (e.g. a chain icon / tint toward the overlord).
- Hover a cell → tooltip with details (relation value, truce timer, war exhaustion); click → focus that pair (and, if it involves you, surface declare-war / sue-for-peace).
- This is the key enabler for **more factions + bigger maps** — a matrix stays readable where a pairwise list explodes (N² rows → N×N grid). Make it scroll/zoom gracefully past ~6 factions.

### 6. Analytics — pop-out + more graphs
- Make the chart **detachable into a floating, draggable (and ideally resizable) window** so you can watch a graph while on another tab; remember its position in `localStorage`. Allow more than one open at once.
- **More metrics** beyond today's pop/gold/towns/military: net income over time, food security, **war exhaustion timelines** (per active war), per-faction **comparison overlays** (pick 2–3 factions to plot together), and territory/settlement count. `chart.ts` already has the multi-metric scaffold — extend the metric list and let a chart plot multiple series.
- Pin/compare: choose which factions appear in a chart (defaults to you + rivals).

### 7. Realm view fixes
- **Per-town Focus (bug):** the Focus column renders `myFaction.focus` (the shared faction-level PEACE/MOBILIZE/WAR) for *every* row, so it's identical down the column and uninformative. Show each town's **own activity** instead: `s.goal` (DEVELOP / UPGRADE / EXPAND / SURVIVE / THRIFTY / AUSTERITY) — what that settlement is actually doing — and optionally `s.focus` (its current resource priority, e.g. food/ore). Fix the sort comparator accordingly (it currently sorts focus by the same shared value, a no-op).
- **Income needs depth:** today it's a single net number. Break it into **taxes − wages − upkeep = net** (columns or a hover tooltip), with a trend arrow, so you can see *why* a town is draining. Clarify it's a contribution estimate now that gold is a single faction treasury.
- **Food needs depth:** show **production vs consumption** (a surplus/deficit *rate*, not just days of reserve) plus the foodDays runway, with a trend arrow — so you can tell a town that's stable-but-low from one that's actively starving.
- Keep the existing sort + problem-row coloring; add a quick filter (e.g. "show problems only").

### 8. Persistent war / exhaustion panel
- Whenever your faction is in an active war, a **war panel is always visible** (docked above the map or in the banner), independent of which tab you're on. Per active war show: enemy (color), **your exhaustion vs theirs** as bars, the current **war objective** (the targeted town from WP6 C2), and **Sue-for-Peace**. It vanishes at peace.
- This replaces hunting for the war info inside the Kingdoms tab.

### 9. Player targeting controls — colony site & war objective

Both shipped in WP6 but are unintuitive, and the war one doesn't actually steer the army. The redesign must fix the wiring and surface them clearly.

**⚠ Bug to fix first (war objective doesn't work):** the enemy-card button writes `war.goal_a` / `war.goal_b` (handler in `main.ts`, markup in `card.ts`), but the war AI (`warCouncil`) reads `war.goalId`. So clicking "Set War Objective" flips the button label but **never redirects the siege** — the two fields are disconnected. Fix: make `warCouncil(world, war, side)` consume the **per-side** objective — for `side`, use `side === war.a ? war.goal_a : war.goal_b` as the siege goal when set, falling back to `pickWarGoal`. Per WP6 C2b a player objective **overrides the `STRIKE_RANGE` filter** (you can target a deep town). Also: reference the war by faction **pair**, not array index — `data-waridx` / `wars.indexOf(war)` goes stale when the wars array changes; look the war up by (player, enemy) on click.

**Set War Objective — two entry points, one action:**
- On the **persistent war panel** (§8): each active war shows `Objective: <town> ▸` with a control to change it (choose from that enemy's towns, or "click a town on the map"). This is the primary, always-visible entry point — the user expects it here.
- On the **enemy settlement card** (§3): keep the "Set as war objective" button (only shown when at war with that faction), writing the same per-side objective; show a "Current objective" state when it already is the target.
- Re-targetable anytime; when the objective falls, the war panel prompts for the next (WP6 C2a/C2c). Mark the current objective on the map.

**Set Colony Target — make it a real button, not a hidden lens:**
- Today it only works if you find the "Colony Target" **map lens** and then click a hex — undiscoverable. Replace with an explicit **"Choose next colony site" button in the Realm tab** (Crown is the alternative; Realm is recommended since it's about settlements).
- Clicking it enters a **site-picking mode**: turn on the valid-site overlay (reuse `findColonySite`'s rules — unowned, not Water/Mountain/River, ≥`EXPAND_MIN_DIST` from any settlement; the existing colony lens already renders this) plus a hint ("click a highlighted hex"). A valid hex sets `world.playerTargetColony`; an invalid one is rejected with feedback.
- Show the active target plainly — "Next colony → (q,r) ✕" with a clear button, in the Realm tab and as the existing map marker.
- Behaviour per WP6 C1: a single global marker, may sit **outside** the normal search radius, and if the hex is occupied by dispatch time → **alert + fall back to auto** and clear the marker.
- In Svelte this is a small component with a "picking" state the canvas click handler consults (as the lens does now), rather than a separate hidden mode.

Both remain recorded player inputs (`playerTargetColony`, `war.goal_a/_b`) → deterministic; the only sim-logic change is making `warCouncil` actually read the per-side objective.

---

## Additional QoL suggestions

- **Minimap** (corner overlay) — increasingly necessary with bigger maps; click to jump. Pairs with the map lenses (owner / danger / resource / **relation-to-player**).
- **Collapsible / resizable sidebar** and a **map-only (cinematic) toggle** to reclaim space.
- **Cycle/jump hotkeys** — next settlement, next alert, next active front; keyboard speed/pause/esc (from the QoL plan). Add a `?` shortcuts overlay.
- **Search** settlements/factions by name → select + pan.
- **Tooltips on jargon** (goals, focus, policy terms, exhaustion) — more important as systems grow.
- **Faction palette for scale:** a larger, color-blind-friendly, visually-distinct palette so 6–10 factions stay distinguishable on map, matrix, and charts; show initials/crests alongside color, never color alone.
- **Number formatting** (1.2k, 13.4k) in the banner/tables so big-map totals stay readable; a settings toggle for raw vs abbreviated.
- **Save slots / named saves** and autosave cadence in the settings menu.
- **Selection sync everywhere:** banner, Realm rows, matrix cells, log lines, alerts, and the map all route selection through one `selectSettlement` / `focusFaction` helper so clicking any of them behaves identically.
- **Performance for bigger maps** (renderer, out of scope here but flag it): viewport culling of hexes/agents, and throttling the HUD refresh — worth confirming before scaling map size.

---

## Implementation approach & phasing

Build each zone as a Svelte component reading from the `world` store (throttled tick counter); port one zone at a time and delete the matching `updateHud.ts` section as each lands, so the app stays runnable. Everything stays UI-only — verify `npm run typecheck` and that headless determinism is untouched after each phase.

| Phase | What | Size | Notes |
| :-- | :-- | :-- | :-- |
| 0 | **Svelte scaffold** — add the Vite plugin, mount a root component beside the canvas, set up the throttled `world` store | M | foundation for everything below; canvas stays imperative |
| 1 | Top banner (summary + time controls) + Settings menu (reseed/save/load/playstyle) | M | immediately de-clutters the sidebar |
| 2 | Remove Inspector tab (cards only) + bottom event-log bar (collapse/expand) | M | reclaims two tabs |
| 3 | Realm fixes: per-town `s.goal` focus, income breakdown, food prod-vs-consumption | S | small, high-value correctness/clarity |
| 4 | Persistent war/exhaustion panel | S | always-visible during conflict |
| 5 | Relationship matrix (N×N) | M | the more-factions enabler; design for ~8 (up to ~12) factions |
| 6 | Analytics pop-out window + extra graphs | M | nice-to-have; do after the essentials |
| 7 | Renderer **viewport culling** (in `renderer.ts`) | M | sim-independent; prerequisite before maps past ~R=40, and unblocks the minimap |
| 8 | QoL grab-bag (minimap, hotkeys, search, palette, number fmt, collapsible sidebar) | M+ | incremental |

Phases 0–2 give the biggest clutter relief; 3–4 are cheap correctness/visibility wins; 5 enables more factions; 7 enables bigger maps. They can largely be done in order.

**Settled:**
- **Framework: Svelte.** Canvas map stays imperative; HUD becomes components on a throttled `world` store.
- **Scale targets: ~8 factions (matrix/palette built to handle ~12) and ~R=40 maps**, with renderer viewport culling (Phase 7) required before going bigger.

**Open decisions (minor):**
- Where does the persistent war panel live — docked over the map, or inside the banner? (Recommend: a thin strip docked at the top of the map area.)
- Is the relationship matrix a section of the **Kingdoms** tab, or its own **Diplomacy** tab? (Recommend: section within Kingdoms while factions ≤ ~8; promote to its own tab if you push toward 12.)
- Banner on very narrow windows — wrap, or scroll? (Recommend: collapse less-critical stats behind the bell/gear.)
