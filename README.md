# Caravan and Kingdom

Physicalized strategy simulation (GDD v4.0 prototype). AI factions manage themselves via a Parallel Governor architecture; you observe, inspect, and control time.


## Run it

The project is TypeScript, bundled/served by [Vite](https://vite.dev). Install deps once, then start the dev server:

```
cd caravan-and-kingdom
npm install
npm run dev          # Vite dev server with hot reload
```

Open the printed URL (e.g. http://localhost:5173). Optional: `?seed=123` for a specific world. Run `npm run build` for a production bundle in `dist/` (preview it with `npm run preview`).

## Controls

Drag to pan, scroll to zoom, click any hex to inspect it. Speed buttons: pause / 1× / 4× / 16×. "New World" reseeds.

What you're watching: resources pile up on hexes (pale dots), villagers (small dots) haul them home, caravans (squares) handle remote piles and trade runs, settlers (triangles) found colonies. Settlements upgrade Village → Town → City and adopt roles (LUMBER/MINING/GRANARY/GENERAL) from their geography.

## Headless testing

The sim core is fully decoupled from rendering (GDD §7) and runs directly under [tsx](https://tsx.is) — no build step:

```
npm run test:headless          # = tsx test/headless.ts (defaults: 3000 ticks, seed 42)
npx tsx test/headless.ts 5000 7  # custom ticks / seed
```

Runs the deterministic loop, prints faction summaries, and verifies same-seed runs match exactly. Type-check the whole project with `npm run typecheck` (`tsc --noEmit`).

## Project layout

```
src/core/      hex math, seeded RNG, A* pathfinding, constants/ (split by concern)
src/sim/       worldgen, settlement, policy + packages: agents/, systems/, governors/, diplomacy/, game loop
src/ui/        canvas renderer, camera, hud/ (updateHud + chart)
src/types.ts   shared domain types (World, Hex, Settlement, Agent, …)
test/          headless determinism + health test
```

Oversized modules were decomposed into folders with a barrel (`index.ts`) that re-exports the original public surface, so import sites are unchanged. The codebase is TypeScript throughout (mixed `.ts` resolved via NodeNext).

System order each tick: Extraction → Metabolism → Movement → AI (every 10 ticks) → Logistics → Maintenance.

## Tuning

Nearly every balance knob lives in `src/core/constants/` (`ECON`, `TIERS`, `BUILDINGS`, terrain rates). Governor behavior is in `src/sim/governors/`, villager ant logic in `src/sim/systems/logistics.ts` (`logisticsSystem`).

## Diplomacy

Factions hold Court every 50 ticks (see planning/DIPLOMACY_DESIGN.md): trade warms relations, crowded borders cool them. Hostile neighbors embargo each other; friends trade at a discount. Wars are fought by soldier agents (diamonds on the map) who pillage, raid caravans, and besiege settlements — captures flip ownership, and losing your last settlement ends the faction. War exhaustion drives peace: reparations, a 2,000-tick truce, and grudges that linger. Mercantile factions pay tribute instead of fighting. All knobs live in `DIPLO` in `src/core/constants/diplo.ts`.

## Not yet implemented (from GDD / design docs)

Market Hall effects, evolution-based batch testing, alliances/joint wars, walls, occupation unrest (see planning/DIPLOMACY_DESIGN.md §9).
