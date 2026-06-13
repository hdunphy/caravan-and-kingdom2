# Caravan and Kingdom

Physicalized strategy simulation (GDD v4.0 prototype). AI factions manage themselves via a Parallel Governor architecture; you observe, inspect, and control time.

## Run it

The game uses ES modules, so it needs a local server (any will do):

```
cd caravan-and-kingdom
npx serve            # or: python -m http.server 8000
```

Open the printed URL (e.g. http://localhost:3000). Optional: `?seed=123` for a specific world.

## Controls

Drag to pan, scroll to zoom, click any hex to inspect it. Speed buttons: pause / 1× / 4× / 16×. "New World" reseeds.

What you're watching: resources pile up on hexes (pale dots), villagers (small dots) haul them home, caravans (squares) handle remote piles and trade runs, settlers (triangles) found colonies. Settlements upgrade Village → Town → City and adopt roles (LUMBER/MINING/GRANARY/GENERAL) from their geography.

## Headless testing

The sim core is fully decoupled from rendering (GDD §7):

```
node test/headless.js [ticks] [seed]
```

Runs the deterministic loop, prints faction summaries, and verifies same-seed runs match exactly.

## Project layout

```
src/core/      hex math, seeded RNG, A* pathfinding, constants
src/sim/       worldgen, settlements, agents, systems, governors, game loop
src/ui/        canvas renderer, camera, HUD
test/          headless determinism + health test
```

System order each tick: Extraction → Metabolism → Movement → AI (every 10 ticks) → Logistics → Maintenance.

## Tuning

Nearly every balance knob lives in `src/core/constants.js` (`ECON`, `TIERS`, `BUILDINGS`, terrain rates). Governor behavior is in `src/sim/governors.js`, villager ant logic in `src/sim/systems.js` (`logisticsSystem`).

## Diplomacy

Factions hold Court every 50 ticks (see planning/DIPLOMACY_DESIGN.md): trade warms relations, crowded borders cool them. Hostile neighbors embargo each other; friends trade at a discount. Wars are fought by soldier agents (diamonds on the map) who pillage, raid caravans, and besiege settlements — captures flip ownership, and losing your last settlement ends the faction. War exhaustion drives peace: reparations, a 2,000-tick truce, and grudges that linger. Mercantile factions pay tribute instead of fighting. All knobs live in `DIPLO` in constants.js.

## Not yet implemented (from GDD / design docs)

Market Hall effects, evolution-based batch testing, alliances/joint wars, walls, occupation unrest (see planning/DIPLOMACY_DESIGN.md §9).
