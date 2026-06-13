// Core simulation systems, executed in deterministic order by the game loop.
import { key, distance } from '../core/hex.js';
import { TERRAIN, ECON, GOALS, BUILDINGS, TIERS, DIPLO } from '../core/constants.js';
import { controlledHexes, storageCap, log } from './settlement.js';
import { AGENT_SPEED, AGENT_CAPACITY, homeOf, assignPath, onArrival, cancelMission } from './agents.js';
import { DEFAULT_TRAITS } from '../core/constants.js';

// --- 1. Extraction: resources accumulate ON the hex (GDD 3.2) ---
export function extractionSystem(world) {
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
      if (hex.building && BUILDINGS[hex.building]?.yieldMult) {
        rate *= BUILDINGS[hex.building].yieldMult * (hex.buildingIntegrity / 100);
      } else {
        rate *= 0.4; // unimproved hexes trickle
      }
      const res = t.yield;
      hex.resources[res] = Math.min(ECON.HEX_PILE_CAP, hex.resources[res] + rate);
    }
  }
}

// --- 2. Metabolism: population eats, grows, declines (GDD 3.1) ---
export function metabolismSystem(world) {
  for (const s of world.settlements) {
    // Market taxes: only so much commerce fits in one settlement, so taxable
    // population is bounded (stops gold scaling without limit)
    const faction = world.factions.find(f => f.id === s.factionId);
    const factionFocus = faction?.focus ?? 'PEACE';
    const factionCount = world.settlements.filter(o => o.factionId === s.factionId).length;
    const widePenalty = Math.max(1.0 - ECON.WIDE_TAX_MAX_PENALTY, 1.0 - ECON.WIDE_TAX_CORRUPTION * Math.max(0, factionCount - ECON.WIDE_TAX_THRESHOLD));
    const hasMarket = s.buildings.includes('MARKET_HALL');
    const taxableCap = TIERS[s.tier].popCap * (hasMarket ? 3.0 : 2.0);
    const taxable = Math.min(s.population, taxableCap);

    let taxBonus = 1.0;
    if (factionFocus === 'MOBILIZE' || factionFocus === 'WAR') {
      taxBonus = DIPLO.MOBILIZATION_TAX_BONUS;
    }
    s.gold += taxable * ECON.GOLD_INCOME_PER_POP * widePenalty * taxBonus;

    const besieged = s.siegeHp != null;
    let need = s.population * ECON.FOOD_PER_POP;
    if (besieged) need *= 0.5; // siege rations: the blockade starves slowly, not instantly
    if (s.stock.food >= need) {
      s.stock.food -= need;
      // No hard population cap: people only settle where food is ABUNDANT
      // (30+ days of reserves), not merely sufficient. Population is thus
      // naturally bounded by food production AND granary capacity — a city
      // can't hold 30 days of food for more people than its warehouses fit.
      const foodDays = s.stock.food / Math.max(0.05, need);
      if (!besieged && foodDays > ECON.FOOD_RESERVE) {
        const fertility = Math.min(1, (foodDays - ECON.FOOD_RESERVE) / ECON.FOOD_RESERVE);
        let growthPenalty = 1.0;
        if (factionFocus === 'MOBILIZE' || factionFocus === 'WAR') {
          growthPenalty = DIPLO.MOBILIZATION_GROWTH_PENALTY;
        }
        s.population += (ECON.POP_GROWTH_RATE + ECON.POP_GROWTH_RATE * s.population * 0.1) * fertility * growthPenalty;
      }
    } else {
      s.stock.food = 0;
      // Starvation scales with how many mouths go unfed
      s.population = Math.max(0, s.population - (0.05 + s.population * 0.0008));
      if (s.population <= 0.5) {
        log(world, `${s.name} has perished`);
        const fid = s.factionId;
        abandonSettlement(world, s);
        if (world.settlements.filter(o => o.factionId === fid && o.id !== s.id).length === 0) {
          world.factions[fid].eliminated = true;
          world.agents = world.agents.filter(a => a.factionId !== fid);
          if (world.diplo) {
            world.diplo.wars = world.diplo.wars.filter(w => w.a !== fid && w.b !== fid);
          }
          log(world, `${world.factions[fid].name} has fallen. Their name passes into history.`);
        }
      }
    }
  }
  world.settlements = world.settlements.filter(s => s.population > 0.5);
}

function abandonSettlement(world, s) {
  world.bordersDirty = true;
  world.pathCache?.clear();
  for (const hex of world.hexes.values()) {
    if (hex.owner === s.id) { hex.owner = null; hex.building = null; }
  }
  world.agents = world.agents.filter(a => a.homeId !== s.id);
}

// --- 3. Movement: agents advance along paths, paying terrain cost ---
export function movementSystem(world) {
  const agents = world.agents;
  const len = agents.length;
  for (let i = 0; i < len; i++) {
    const agent = agents[i];
    if (agent.engaged) continue;
    if (agent.state !== 'travel' || agent.path.length === 0) {
      if (agent.state === 'travel') onArrival(world, agent);
      continue;
    }
    agent.progress += AGENT_SPEED[agent.type] ?? 1.0;
    let guard = 0;
    while (agent.path.length > 0 && guard++ < 10) {
      const [nq, nr] = agent.path[0];
      const hex = world.hexes.get(nq + ',' + nr);
      if (!hex) { cancelMission(world, agent); break; }
      let cost = TERRAIN[hex.terrain].moveCost;
      if (hex.terrain === 'RIVER') {
        cost = hex.hasBridge ? ECON.ROAD_MOVE_COST : 15.0;
      }
      if (hex.hasRoad) cost = Math.min(cost, ECON.ROAD_MOVE_COST);
      if (agent.progress >= cost) {
        agent.progress -= cost;
        agent.q = nq; agent.r = nr;
        hex.traffic += agent.type === 'caravan' ? 3 : 1; // road demand signal
        agent.path.shift();
        if (agent.path.length === 0) onArrival(world, agent);
      } else break;
    }
  }
}

// --- 4. Logistics: reactive-ant villagers (GDD 5.1) ---
// --- Ticket ledger (job system) ---
// Every outbound gather mission is a "ticket" reserving carrier-capacity units
// of a specific pile. The ledger is rebuilt from live missions each time, so
// tickets self-expire when missions complete, cancel, or the agent dies.
export function buildClaims(world) {
  const claims = new Map();
  for (const a of world.agents) {
    if (a.mission?.kind === 'gather' && a.mission.phase === 'out') {
      const k = a.mission.tq + ',' + a.mission.tr + ':' + a.mission.resource;
      claims.set(k, (claims.get(k) ?? 0) + (AGENT_CAPACITY[a.type] ?? 10));
    }
  }
  return claims;
}

export function takeTicket(claims, q, r, res, capacity) {
  const k = q + ',' + r + ':' + res;
  claims.set(k, (claims.get(k) ?? 0) + capacity);
}

export function unclaimed(claims, hex, res) {
  return hex.resources[res] - (claims.get(hex.q + ',' + hex.r + ':' + res) ?? 0);
}

export function logisticsSystem(world) {
  const claimed = buildClaims(world);

  for (const agent of world.agents) {
    if (agent.type !== 'villager' || agent.state !== 'idle') continue;
    const home = homeOf(world, agent);
    if (!home) continue;
    if (home.siegeHp != null) continue; // sheltering: a besieged town sends nobody out

    // SURVIVE: everything forages food
    const needs = rankedNeeds(world, home);
    const wanted = home.goal === GOALS.SURVIVE ? ['food'] : needs;

    // 1) Local gathering: nearest worthwhile pile of a wanted resource
    let best = null, bestScore = -Infinity;
    for (const hex of controlledHexes(world, home)) {
      for (const res of wanted) {
        const pile = unclaimed(claimed, hex, res); // open ticket share only
        if (pile < 5) continue;
        const d = distance(agent.q, agent.r, hex.q, hex.r) || 1;
        const priority = wanted.length - wanted.indexOf(res);
        const score = (pile / d) * priority;
        if (score > bestScore) { bestScore = score; best = { hex, res }; }
      }
    }
    if (best) {
      if (assignPath(world, agent, best.hex.q, best.hex.r)) {
        agent.mission = { kind: 'gather', tq: best.hex.q, tr: best.hex.r, resource: best.res, phase: 'out' };
        takeTicket(claimed, best.hex.q, best.hex.r, best.res, AGENT_CAPACITY.villager);
        continue;
      }
    }

    // 2) Internal freight: ship surplus to a nearby needy friendly settlement
    const cap = storageCap(home);
    for (const res of ['food', 'timber', 'stone', 'ore']) {
      if (home.stock[res] < cap * 0.5) continue;
      const target = world.settlements.find(o =>
        o.id !== home.id && o.factionId === home.factionId && o.siegeHp == null &&
        distance(home.q, home.r, o.q, o.r) <= ECON.VILLAGER_FREIGHT_RANGE &&
        o.stock[res] < 40);
      if (target && assignPath(world, agent, target.q, target.r)) {
        const amt = Math.min(AGENT_CAPACITY.villager, home.stock[res]);
        home.stock[res] -= amt;
        agent.cargo[res] += amt;
        agent.mission = { kind: 'freight', destId: target.id, phase: 'out' };
        break;
      }
    }
  }
}

export function rankedNeeds(world, s) {
  if (s._rankedNeedsTick === world.tick && s._rankedNeeds) {
    return s._rankedNeeds;
  }
  // Lower stock = higher need; focus resource gets a boost.
  const weights = { food: 1.5, timber: 1.0, stone: 0.8, ore: 0.6 };
  const needs = ['food', 'timber', 'stone', 'ore']
    .map(res => ({ res, score: weights[res] * (1 / (1 + s.stock[res] / 50)) * (s.focus === res ? 2 : 1) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.res);
  
  s._rankedNeedsTick = world.tick;
  s._rankedNeeds = needs;
  return needs;
}

// --- 5. Maintenance: integrity decay, repairs, tool breakage (GDD 3.1, 5.2) ---
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
