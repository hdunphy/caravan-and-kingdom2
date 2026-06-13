// --- 5. Maintenance: integrity decay, repairs, tool breakage (GDD 3.1, 5.2) ---
import { ECON, DIPLO } from '../../core/constants.js';
import { controlledHexes, log } from '../settlement.js';
import { homeOf } from '../agents.js';

export function maintenanceSystem(world) {
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

  // Wages: every agent draws pay from its home treasury. An empty treasury
  // means unpaid workers, who may desert (gold sink, balances tax income).
  const deserters = new Set();
  for (const s of world.settlements) {
    const staff = world.agents.filter(a => a.homeId === s.id && a.type !== 'settler');
    let bill = 0;
    for (const a of staff) {
      bill += a.type === 'caravan' ? ECON.WAGE_CARAVAN :
        a.type === 'soldier' ? DIPLO.WAGE_SOLDIER : ECON.WAGE_VILLAGER;
    }
    // Building upkeep: rich settlements pay it; poor ones defer maintenance
    if (s.gold >= 20) {
      const buildingCount = controlledHexes(world, s).filter(h => h.building).length + s.buildings.length;
      bill += buildingCount * ECON.BUILDING_UPKEEP_GOLD;
    }
    if (s.gold >= bill) {
      s.gold -= bill;
    } else {
      s.gold = 0;
      let villagersLeft = staff.filter(a => a.type === 'villager').length;
      for (const a of staff) {
        if (a.type === 'villager' && villagersLeft <= ECON.DESERTION_FLOOR) continue;
        if (world.rng.chance(ECON.DESERTION_CHANCE)) {
          deserters.add(a.id);
          if (a.type === 'villager') villagersLeft--;
        }
      }
    }
  }
  if (deserters.size > 0) {
    world.agents = world.agents.filter(a => !deserters.has(a.id));
    log(world, `${deserters.size} unpaid worker(s) deserted`);
  }
}
