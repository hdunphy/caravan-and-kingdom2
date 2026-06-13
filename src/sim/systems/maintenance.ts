// --- 5. Maintenance: integrity decay, repairs, tool breakage (GDD 3.1, 5.2) ---
import { ECON, DIPLO } from '../../core/constants.js';
import { controlledHexes, log, pushAlert } from '../settlement.js';
import { homeOf } from '../agents.js';
import { spendGold } from '../economy.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

export function maintenanceSystem(world: World) {
  // Traffic memory fades so roads chase live routes, not ancient ones.
  // Roads decay too: only maintained (busy) ones survive long-term.
  if (world.tick % 200 === 0) world.pathCache?.clear(); // roads change costs
  if (world.tick % 10 === 0) {
    const k = Math.pow(ECON.ROAD_TRAFFIC_DECAY, 10);
    for (const hex of world.hexes.values()) {
      if (hex.traffic > 0.5) hex.traffic *= k;
      if (hex.hasRoad) {
        hex.roadIntegrity = (hex.roadIntegrity ?? 100) - ECON.ROAD_INTEGRITY_DECAY * 10;
        if (hex.roadIntegrity <= 0) {
          hex.hasRoad = false;
          hex.roadIntegrity = 0;
        }
      }
    }
  }
  for (const s of world.settlements) {
    // Buildings on hexes decay; repair from stockpile
    for (const hex of controlledHexes(world, s)) {
      if (!hex.building) continue;
      hex.buildingIntegrity = Math.max(0, hex.buildingIntegrity - ECON.INTEGRITY_DECAY_BUILDING);
      if (hex.buildingIntegrity < ECON.REPAIR_THRESHOLD) {
        const points = Math.min(20, 100 - hex.buildingIntegrity);
        const timberCost = points * ECON.REPAIR_COST_TIMBER * 0.5;
        const stoneCost = points * ECON.REPAIR_COST_TIMBER * 0.25;
        if (s.stock.timber >= timberCost && s.stock.stone >= stoneCost) {
          s.stock.timber -= timberCost;
          s.stock.stone -= stoneCost;
          hex.buildingIntegrity += points;
        }
      }
    }
    // Tools break in use
    for (let i = 0; i < s.tools; i++) {
      if (world.rng.chance(ECON.TOOL_BREAK_CHANCE)) s.tools--;
    }
  }
  // Caravans decay while traveling; repaired at home with timber
  for (const agent of world.agents) {
    if (agent.type !== 'caravan') continue;
    if (agent.state === 'travel') {
      agent.integrity = Math.max(0, agent.integrity - ECON.INTEGRITY_DECAY_CARAVAN);
      if (agent.integrity <= 0) {
        log(world, `A caravan broke down and was lost`);
      }
    } else {
      const home = homeOf(world, agent);
      if (home && agent.integrity < 100) {
        const points = Math.min(10, 100 - agent.integrity);
        const cost = points * ECON.REPAIR_COST_TIMBER;
        if (home.stock.timber >= cost) {
          home.stock.timber -= cost;
          agent.integrity += points;
        }
      }
    }
  }
  world.agents = world.agents.filter(a => a.type !== 'caravan' || a.integrity > 0);

  // Wages and upkeep: billed to the faction treasury once per tick
  const factionBills = new Map<number, number>();
  
  for (const s of world.settlements) {
    const staff = world.agents.filter(a => a.homeId === s.id && a.type !== 'settler');
    let localBill = 0;
    for (const a of staff) {
      localBill += a.type === 'caravan' ? ECON.WAGE_CARAVAN :
        a.type === 'soldier' ? DIPLO.WAGE_SOLDIER : ECON.WAGE_VILLAGER;
    }
    const buildingCount = controlledHexes(world, s).filter(h => h.building).length + s.buildings.length;
    localBill += buildingCount * ECON.BUILDING_UPKEEP_GOLD;
    
    factionBills.set(s.factionId, (factionBills.get(s.factionId) || 0) + localBill);
  }
  
  for (const [fid, bill] of factionBills.entries()) {
    if (bill > 0) {
      spendGold(world, fid, bill);
    }
  }
}
