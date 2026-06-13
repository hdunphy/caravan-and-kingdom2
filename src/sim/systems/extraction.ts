// --- 1. Extraction: resources accumulate ON the hex (GDD 3.2) ---
import { TERRAIN, ECON, GOALS, BUILDINGS, TIERS, DEFAULT_TRAITS } from '../../core/constants.js';
import { controlledHexes } from '../settlement.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

export function extractionSystem(world: World) {
  for (const s of world.settlements) {
    const toolBonus = 1 + Math.min(s.tools, ECON.MAX_TOOLS) * ECON.TOOL_YIELD_BONUS / 2;
    const industry = (world.factions[s.factionId]?.traits ?? DEFAULT_TRAITS).industry;
    const tierEfficiency = TIERS[s.tier].efficiency ?? 1.0;
    const workEfficiency = Math.min(1, s.population / 10) * toolBonus * industry * tierEfficiency;
    // Foraging is LAND-limited: each land hex can feed only so many people.
    // This is the natural population ceiling — beyond it, food must come
    // from improved extraction and imports.
    const hexes = controlledHexes(world, s);
    if (s._landHexes === undefined || world.bordersDirty) {
      s._landHexes = hexes.filter(h => h.terrain !== 'WATER').length;
    }
    const landHexes = s._landHexes;
    const forageRate = s.goal === GOALS.SURVIVE ? 0.85 : 0.45;
    const foragers = Math.min(s.population, landHexes * ECON.FORAGE_POP_PER_HEX);
    s.stock.food += foragers * ECON.FOOD_PER_POP * forageRate;
    for (const hex of hexes) {
      const t = TERRAIN[hex.terrain];
      if (hex.terrain === 'WATER') {
        // Fishing Dock on water: food goes straight into settlement stock
        //TODO does this need to be FISHING DOCK or FISHERY?
        if (hex.building === 'FISHERY') {
          s.stock.food += 1.2 * workEfficiency * (hex.buildingIntegrity / 100);
        }
        continue;
      }
      let rate = t.rate * workEfficiency;
      const bdef = (BUILDINGS as Record<string, any>)[hex.building as string];
      if (hex.building && bdef?.yieldMult) {
        rate *= bdef.yieldMult * (hex.buildingIntegrity / 100);
      } else {
        rate *= 0.4; // unimproved hexes trickle
      }
      const res = t.yield;
      hex.resources[res] = Math.min(ECON.HEX_PILE_CAP, hex.resources[res] + rate);
    }
  }
}
