# Optimization & Scaling Plan — Larger Maps, More Factions

**Goal:** make the sim comfortably handle a bigger map (`mapRadius` 24 → 48–72, i.e. ~1,800 → ~7,000–16,000 hexes) and more than four factions, without melting frame rate or tick time.

This is a build spec grounded in the current code. Work is ordered so the **performance foundation lands first** — it's the prerequisite for both stretch goals. Determinism rule still holds (GDD §7): same seed must produce identical headless runs. Validate with `npm run test:headless` after every work package.

---

## Where it hurts today

The current scale (radius 24, 4 factions, a few hundred agents) hides several patterns that turn quadratic or per-frame-expensive as the world grows. Concretely:

**Rendering has no viewport culling.** `render()` in `src/ui/renderer.ts` iterates **every** hex in `world.hexes.values()` each frame — fill, 6 border edges, strokes, lens overlays — then every road hex, every settlement, every agent. At radius 24 that's ~1,800 hexes/frame; at radius 72 it's ~16,000, drawn whether on-screen or not. This is the single biggest blocker to a larger map.

**`world.settlements.find(...)` is used as a lookup table — 40+ call sites.** Many sit inside per-agent or per-hex loops: `arrival.ts` (per arriving agent), `court.ts` (nested inside an agent loop, so O(agents × settlements)), `war.ts`, `settlement.ts` `claimTerritory`. Each is O(settlements). As both settlement and agent counts climb with map/faction count, these become O(n²) per tick.

**Per-tick full scans recomputed instead of cached.** `metabolism.ts` runs `world.settlements.filter(o => o.factionId === s.factionId)` *inside* the per-settlement loop → O(settlements²) every tick. `getSettlerCost` (`governors/index.ts`) re-filters settlements on each call. `sampleHistory` (`gameLoop.ts`) re-scans all settlements and all agents once per faction.

**`pathCache` thrash.** `findPath` caches by `start:goal:planning`, but the cache is fully `.clear()`'d on every settlement founding and every road build (`settlement.ts:31`, `civil.ts:23/277/313`). On a bigger map with more settlements and more road projects, that wipes a hot cache far more often. `findPath` itself has no entry cap (the movement-layer cache caps at 20,000; the A* result cache does not).

**Faction roster is a hard-coded 4, wired by literal.** `FACTIONS` in `src/core/constants/factions.ts` has exactly 4 entries; `main.ts` calls `generateWorld(seed, 24, 4)` at three sites with the count and radius as magic numbers. Diplomacy relations are stored as pairwise string keys (O(factions²) pairs), and `world.factions[id]` indexing assumes `id === array index`.

**Worldgen start placement is O(candidates × factions × range²).** `generateWorld` scores every plains candidate against every existing start for each faction. Fine at radius 24; noticeably slower as candidate count grows with map area. One-time cost, but worth bounding.

---

## WP1 — Config & instrumentation (do first, low risk)

Make scale a knob and make slowness measurable before optimizing.

- **Lift `mapRadius` and `factionCount` out of literals.** Read both from URL params in `main.ts` (alongside the existing `?seed=`), e.g. `?radius=48&factions=6`, with the current `24`/`4` as defaults. Update all three `generateWorld` call sites. `world.mapRadius` is already stored, so the sim side mostly works off it already.
- **Add a frame/tick profiler (dev-only).** Wrap `step()` and `render()` in `performance.now()` accumulators surfaced in the HUD (or behind a `?debug=1` flag). Track: tick time, render time, agent count, hex count, `pathCache.size`. Without this, later WPs are guesswork.
- **Headless timing baseline.** Extend `test/headless.ts` to print wall-clock ms per 1,000 ticks at radius 24/48/72 and faction 4/6/8. Save numbers into `planning/` as the before/after benchmark (mirror the existing `headless-baseline.txt` convention).

**Exit criteria:** can launch any radius/faction combo from the URL; have concrete ms numbers showing where time goes.

---

## WP2 — Per-tick lookup & scan fixes (biggest tick-time win)

Eliminate the O(n²) patterns. These changes are sim-internal and must stay deterministic.

- **One `settlementById` map per tick.** Build `Map<id, Settlement>` once at the top of `step()` (or maintain it incrementally on found/capture/destroy) and replace the hot `world.settlements.find(s => s.id === …)` calls in `arrival.ts`, `court.ts`, `war.ts`, and `settlement.ts:claimTerritory`. Keep the array as the canonical ordered list (determinism); the map is a derived index. *This is the highest-leverage single change.*
- **Cache faction→settlements grouping per tick.** Compute `settlementsByFaction: Map<factionId, Settlement[]>` once per tick and have `metabolism.ts`, `getSettlerCost`, and `sampleHistory` read from it instead of re-filtering. Invalidate on the same events that change ownership.
- **Hoist `metabolism`'s faction-count out of the inner loop** — it only needs the per-faction settlement count, which the grouping above gives in O(1).
- **Trim `sampleHistory`.** Replace its `factions × (settlements + agents)` re-scan with a single pass that accumulates per-faction pop/gold/count/military into the grouped structure.

**Exit criteria:** headless ms/1,000 ticks at radius 24 unchanged or faster; the find-in-loop hotspots gone; determinism check still passes.

---

## WP3 — Renderer viewport culling & batching (biggest frame-rate win)

Decouple draw cost from total map size so it scales with what's *visible*, not what *exists*.

- **Cull to the camera viewport.** Compute the visible world-space rectangle from `cam.x/cam.y/cam.zoom` and `canvas.width/height`, expand by one hex margin, and skip any hex whose pixel center falls outside it. This alone makes radius 72 render like a small map when zoomed in.
- **Batch by fill style.** Today each hex issues its own `beginPath/fill/stroke`. Group visible hexes by terrain color and stroke style into a few batched paths to cut canvas state changes. Same for the wilderness grid and internal faint borders.
- **Pre-cull settlements, roads, and agents** with the same rectangle. The `displayPos` smoothing map already prunes dead agents; keep that.
- **Optional, only if still slow when zoomed out:** render static layers (terrain + territory tint) to an offscreen canvas that's regenerated only when `bordersDirty` or terrain changes, and blit it each frame; draw only the dynamic layers (agents, sieges, piles) live. Bigger change — gate it behind the WP1 profiler showing it's needed.

**Exit criteria:** profiler shows render time roughly flat as `mapRadius` grows (at fixed zoom), with no visual regressions at the seams.

---

## WP4 — Larger map enablement

With WP2/WP3 done, raising the radius is mostly correctness and tuning.

- **Worldgen tuning at scale.** Confirm `SCALE = mapRadius * 0.38` still yields a coherent island at radius 48–72 (feature size scales, but verify ocean falloff and that the playable plains band isn't too thin or too sparse). River count (`2 + rng % 2`) and the 40-step trace length are tuned for radius 24 — scale river count and max steps with `mapRadius` so big maps aren't bone-dry.
- **Bound start placement.** Cap the candidate set (e.g. sample or spatially bucket plains hexes) so placement stays sub-quadratic as area grows, and scale the minimum inter-start distance (currently hard-coded `9`) with map radius and faction count so starts stay sensibly spread.
- **pathCache policy.** Add an LRU/size cap to the `findPath` result cache (mirror the 20,000 cap in `movement.ts`), and make the `.clear()`-on-every-build cheaper — ideally invalidate only paths touching the changed hexes, or clear at most once per tick rather than per event. On a big map this is the difference between a warm and a cold pathfinder.
- **Movement range sanity.** `VILLAGER_FREIGHT_RANGE` and caravan/trade ranges are distance-gated; verify they still produce sensible logistics when settlements sit farther apart on a large map (may need to scale with `mapRadius` rather than stay absolute).

**Exit criteria:** radius 48 and 72 generate believable worlds, AI expands and trades normally, headless determinism holds, frame rate acceptable per the WP1 profiler.

---

## WP5 — More factions

The roster and diplomacy are the work here; most sim systems already key off `factionId` generically.

- **Expand the roster.** Add entries to `FACTIONS` in `src/core/constants/factions.ts` with distinct `color`, `persona`, and `traits` (expand/trade/industry/aggression). Keep `id` equal to array index — several places use `world.factions[id]` as a direct index, so ids must stay sequential and dense. Add a short test asserting `FACTIONS[i].id === i`.
- **Make `factionCount` data-driven.** Already wired via WP1's URL param; ensure `generateWorld` clamps `factionCount` to `FACTIONS.length` and that start placement can actually fit N non-overlapping starts on the chosen radius (more factions need a bigger map — surface a clear console warning if the requested combo can't place everyone).
- **Verify diplomacy scales.** Relations/trade-counts are pairwise (`pairKey`), so storage is O(factions²) — fine for single digits, but Court (`court.ts`, every 50 ticks) iterates faction pairs and, in places, agents-per-pair. Profile Court at 8 factions; if it's hot, apply the same `settlementById` map and precomputed bloc stats rather than re-deriving per pair.
- **Color/legend/HUD.** Confirm the HUD chart (`src/ui/hud/chart.ts`) and realm panels don't assume exactly 4 series; make the legend iterate `world.factions`.
- **Balance pass.** More factions means more early-game border friction and wars. Re-run the war-balance harness (`wardiag.mjs`, `econdiag.mjs`) at 6 and 8 factions and record results alongside `WAR_BALANCE_RESULTS.md`; expect to retune `BORDER_FRICTION`, settlement caps, and the wide-realm tax thresholds.

**Exit criteria:** 6- and 8-faction games start, run, and reach a stable mix of trade/war without one faction trivially snowballing; determinism holds; HUD renders all factions.

---

## WP6 — Verification & regression guard

- **Determinism:** `npm run test:headless` (same-seed equality) green after every WP.
- **Typecheck:** `npm run typecheck` clean.
- **Scaling benchmark:** re-run the WP1 headless timing matrix (radius 24/48/72 × factions 4/6/8); commit before/after numbers. Target: tick time grows roughly linearly with agent/hex count, not quadratically.
- **Visual smoke test:** load radius 72 / 8 factions in the browser, pan/zoom across the map, confirm steady frame rate and no render seams.
- **Optional CI:** add a headless determinism + timing-ceiling check to `.github/workflows` so a future change that reintroduces an O(n²) hotspot fails the build.

---

## Suggested order & rationale

1. **WP1** — can't optimize what you can't measure or launch at scale.
2. **WP2** — cheapest big tick-time win; pure sim, no visual risk.
3. **WP3** — unlocks larger maps on the render side.
4. **WP4** then **WP5** — both now sit on a fast foundation; do the map first since more factions generally *wants* a bigger map.
5. **WP6** — continuous, not a final phase.

WP2 and WP3 are independent and could be done in parallel. WP4 and WP5 both depend on WP1–WP3. The `settlementById` map in WP2 is the highest-leverage single change in the whole plan.
