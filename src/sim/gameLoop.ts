// Deterministic game loop (GDD 7): Extraction -> Metabolism -> Movement -> AI -> Logistics -> Maintenance.
// Pure simulation — no rendering dependencies, so it runs headless for batch testing.
import { extractionSystem, metabolismSystem, movementSystem, logisticsSystem, maintenanceSystem } from './systems.js';
import { aiSystem } from './governors.js';
import { courtSystem, combatSystem } from './diplomacy.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../types.js';

const AI_INTERVAL = 10; // governors deliberate every N ticks

export function step(world: World) {
  world.tick++;
  extractionSystem(world);
  metabolismSystem(world);
  movementSystem(world);
  if (world.tick % AI_INTERVAL === 0) aiSystem(world);
  courtSystem(world);   // self-gated to every DIPLO.INTERVAL ticks
  logisticsSystem(world);
  combatSystem(world);
  maintenanceSystem(world);
  sampleHistory(world);
  
  // Age out alerts that haven't been refreshed, except unacknowledged CRITICAL ones
  world.alerts = (world.alerts ?? []).filter(a => 
    (a.severity === 'CRITICAL' && !a.acknowledged) || (world.tick - a.tick < 50)
  );
  
  world.bordersDirty = false;
  return world;
}

// Rolling faction stats for the HUD charts. When the buffer fills, every
// other sample is dropped and the interval doubles, so full history always fits.
function sampleHistory(world: World) {
  const h = world.history;
  if (!h || world.tick % h.interval !== 0) return;
  h.samples.push({
    t: world.tick,
    war: world.diplo?.wars?.length > 0,
    f: world.factions.map(f => {
      const towns = world.settlements.filter(s => s.factionId === f.id);
      return {
        pop: Math.round(towns.reduce((a, s) => a + s.population, 0)),
        gold: Math.round(towns.reduce((a, s) => a + s.gold, 0)),
        n: towns.length,
        military: world.agents.filter(a => a.factionId === f.id && a.type === 'soldier').length,
      };
    }),
  });
  if (h.samples.length >= 360) {
    h.samples = h.samples.filter((_, i) => i % 2 === 0);
    h.interval *= 2;
  }
}

export function run(world: World, ticks: number) {
  for (let i = 0; i < ticks; i++) step(world);
  return world;
}

export function summarize(world: World) {
  return world.factions.map(f => {
    const towns = world.settlements.filter(s => s.factionId === f.id);
    return {
      faction: f.name,
      settlements: towns.length,
      population: Math.round(towns.reduce((a, s) => a + s.population, 0)),
      villagers: world.agents.filter(a => a.factionId === f.id && a.type === 'villager').length,
      caravans: world.agents.filter(a => a.factionId === f.id && a.type === 'caravan').length,
      gold: Math.round(towns.reduce((a, s) => a + s.gold, 0)),
      stock: towns.reduce((acc: Record<string, number>, s) => {
        for (const r of ['food', 'timber', 'stone', 'ore']) acc[r] = Math.round((acc[r] ?? 0) + s.stock[r]);
        return acc;
      }, {} as Record<string, number>),
    };
  });
}
