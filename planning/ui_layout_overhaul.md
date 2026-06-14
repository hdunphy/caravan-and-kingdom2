# Plan: UI Layout Overhaul (de-cluttering the right panel)

The right-hand panel is overburdened and the tabs have shrunk to the point of being hard to use. This restructures the whole HUD into distinct zones, fixes specific data gaps, and prepares the UI for **more factions and bigger maps**.

Grounded in `war-improvements`. Builds on (and partially supersedes) `improve_ui_and_notifications.md` and `ui_qol_features.md` — reuse what's there (settlement cards, map lenses, alert tiering, Realm view) rather than duplicating. This is UI-only; no sim/determinism impact.

> The HUD render lives mostly in `index.html` (markup + inline CSS) and `src/ui/hud/updateHud.ts`, with `realm.ts`, `card.ts`, `chart.ts`. updateHud.ts is already large — **recommend splitting the HUD into per-zone modules** (`banner.ts`, `bottomLog.ts`, `warPanel.ts`, `diplomacyMatrix.ts`, `analyticsWindow.ts`) as part of this work.

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

Split `updateHud.ts` into zone modules as you go; keep each zone's render pure-ish (reads `world`, writes its DOM subtree). Everything stays UI-only — verify `npm run typecheck` and that headless determinism is untouched after each phase.

| Phase | What | Size | Notes |
| :-- | :-- | :-- | :-- |
| 1 | Top banner (summary + time controls) + Settings menu (reseed/save/load/playstyle) | M | immediately de-clutters the sidebar |
| 2 | Remove Inspector tab (cards only) + bottom event-log bar (collapse/expand) | M | reclaims two tabs |
| 3 | Realm fixes: per-town `s.goal` focus, income breakdown, food prod-vs-consumption | S | small, high-value correctness/clarity |
| 4 | Persistent war/exhaustion panel | S | always-visible during conflict |
| 5 | Relationship matrix (N×N) | M | the more-factions enabler |
| 6 | Analytics pop-out window + extra graphs | M | nice-to-have; do after the essentials |
| 7 | QoL grab-bag (minimap, hotkeys, search, palette, number fmt, collapsible sidebar) | M+ | incremental |

**Open decisions:**
- Where does the persistent war panel live — docked over the map, or inside the banner? (Recommend: a thin strip docked at the top of the map area.)
- Is the relationship matrix a section of the **Kingdoms** tab, or its own **Diplomacy** tab? (Recommend: section within Kingdoms to keep 4 tabs, unless faction counts get large.)
- Banner on very narrow windows — wrap, or scroll? (Recommend: collapse less-critical stats behind the bell/gear.)
- How many factions/what map size are you targeting? That sets the bar for the matrix, palette size, minimap, and perf work.
