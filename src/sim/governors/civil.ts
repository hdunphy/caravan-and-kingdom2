// --- Civil Governor: construction, upgrades, expansion (GDD 4.1.1) ---
// Also owns road paving and colony-site selection (findColonySite is part of
// the public surface, re-exported through the barrel for diplomacy's use).
import { key, distance, range } from '../../core/hex.js';
import { TERRAIN, TIERS, BUILDINGS, ECON, GOALS, ROLES } from '../../core/constants.js';
import { controlledHexes, computeRole, claimTerritory, canAfford, pay, storageCap, log } from '../settlement.js';
import { spawnAgent, assignPath } from '../agents.js';
import { rankedNeeds } from '../systems.js';
import { findPath } from '../../core/pathfinding.js';
import { traitsOf, getSettlerCost } from './index.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

// --- Civil Governor: construction, upgrades, expansion (GDD 4.1.1) ---
export function civilGovernor(world: World, s: Settlement) {
  const tier = TIERS[s.tier];

  // Tier upgrade
  if (s.goal === GOALS.UPGRADE && tier.next && canAfford(s, tier.upgradeCost)) {
    pay(s, tier.upgradeCost);
    s.tier = tier.next;
    claimTerritory(world, s);
    world.pathCache?.clear();
    s.role = computeRole(world, s);
    log(world, `${s.name} grew into a ${TIERS[s.tier].name}!`);
    return;
  }

  // Dispatch settler
  const sCost = getSettlerCost(world, s.factionId);
  if (s.goal === GOALS.EXPAND && !s.pendingSettler && canAfford(s, sCost)) {
    const site = findColonySite(world, s);
    if (site) {
      pay(s, sCost);
      s.population -= ECON.SETTLER_POP;
      const settler = spawnAgent(world, 'settler', s.factionId, s.id, s.q, s.r);
      if (assignPath(world, settler, site.q, site.r)) {
        settler.mission = { kind: 'settle', tq: site.q, tr: site.r };
        s.pendingSettler = true;
        log(world, `${s.name} sent settlers toward (${site.q},${site.r})`);
      } else {
        world.agents = world.agents.filter(a => a.id !== settler.id);
        s.population += ECON.SETTLER_POP;
      }
    }
    return;
  }

  // Prioritize food production if there is absolutely none
  const hasFoodBuilding = controlledHexes(world, s).some(h => h.building === 'GATHERERS_HUT' || h.building === 'FISHERY');
  if (!hasFoodBuilding) {
    const hut = BUILDINGS.GATHERERS_HUT;
    if (canAfford(s, hut.cost)) {
      const hex = controlledHexes(world, s).find(h =>
        h.terrain === hut.terrain && !h.building && !(h.q === s.q && h.r === s.r));
      if (hex) {
        pay(s, hut.cost);
        hex.building = 'GATHERERS_HUT';
        hex.buildingIntegrity = 100;
        log(world, `${s.name} built a Gatherer's Hut (essential food source)`);
        return;
      }
    }
    const fish = BUILDINGS.FISHERY;
    if (canAfford(s, fish.cost)) {
      const hex = controlledHexes(world, s).find(h =>
        h.terrain === 'WATER' && !h.building &&
        [...range(h.q, h.r, 1)].some(([q, r]) => {
          const nb = world.hexes.get(key(q, r));
          return nb && nb.terrain !== 'WATER';
        }));
      if (hex) {
        pay(s, fish.cost);
        hex.building = 'FISHERY';
        hex.buildingIntegrity = 100;
        log(world, `${s.name} built a Fishing Dock (essential food source)`);
        return;
      }
    }
  }

  // Don't build while starving or broke; while UPGRADING, save materials (GDD 4.2)
  if (s.goal === GOALS.SURVIVE || s.goal === GOALS.THRIFTY || s.goal === GOALS.UPGRADE) return;

  const factionFocus = world.factions[s.factionId]?.focus ?? 'PEACE';
  if ((factionFocus === 'MOBILIZE' || factionFocus === 'WAR') && s.gold < 200) {
    const hasSmithy = controlledHexes(world, s).some(h => h.building === 'SMITHY');
    if (hasSmithy && s.tools < ECON.MAX_TOOLS && canAfford(s, ECON.TOOL_COST)) {
      pay(s, ECON.TOOL_COST);
      s.tools++;
    }
    return;
  }

  // Craft tools at a smithy
  const hasSmithy = controlledHexes(world, s).some(h => h.building === 'SMITHY');
  if (hasSmithy && s.tools < ECON.MAX_TOOLS && canAfford(s, ECON.TOOL_COST)) {
    pay(s, ECON.TOOL_COST);
    s.tools++;
  }

  // Warehouse when storage is tight
  const cap = storageCap(s);
  const totalStock = s.stock.food + s.stock.timber + s.stock.stone + s.stock.ore;
  const warehouses = s.buildings.filter(b => b === 'WAREHOUSE').length;
  if (warehouses < 3 && totalStock > cap * 0.8 && canAfford(s, BUILDINGS.WAREHOUSE.cost)) {
    pay(s, BUILDINGS.WAREHOUSE.cost);
    s.buildings.push('WAREHOUSE');
    log(world, `${s.name} built a Warehouse`);
    return;
  }

  // Market Hall when population and treasury allow (Town/City only)
  const hasMarket = s.buildings.includes('MARKET_HALL');
  if (!hasMarket && s.tier !== 'VILLAGE' && s.gold >= 80 && canAfford(s, BUILDINGS.MARKET_HALL.cost)) {
    pay(s, BUILDINGS.MARKET_HALL.cost);
    s.buildings.push('MARKET_HALL');
    log(world, `${s.name} built a Market Hall`);
    return;
  }

  // Extraction buildings: prioritize by role and needs, one per AI pass
  const builtCount = controlledHexes(world, s).filter(h => h.building).length;
  if (builtCount >= TIERS[s.tier].jobCap) return;

  const needs = rankedNeeds(world, s);
  const buildingFor = { food: 'GATHERERS_HUT', timber: 'SAWMILL', stone: 'MASONRY', ore: 'SMITHY' };
  const roleBoost = {
    [ROLES.LUMBER]: 'timber', [ROLES.MINING]: 'stone',
    [ROLES.GRANARY]: 'food', [ROLES.GENERAL]: null,
  }[s.role];
  const order = roleBoost ? [roleBoost, ...needs.filter((r: string) => r !== roleBoost)] : needs;

  for (const res of order) {
    if (res === 'food') {
      const dockHex = controlledHexes(world, s).find(h =>
        h.terrain === 'WATER' && !h.building &&
        [...range(h.q, h.r, 1)].some(([q, r]) => {
          const nb = world.hexes.get(key(q, r));
          return nb && nb.terrain !== 'WATER';
        }));
      if (dockHex && canAfford(s, BUILDINGS.FISHERY.cost)) {
        pay(s, BUILDINGS.FISHERY.cost);
        dockHex.building = 'FISHERY';
        dockHex.buildingIntegrity = 100;
        log(world, `${s.name} built a Fishing Dock`);
        return;
      }
    }
    const bKey = buildingFor[res];
    const b = BUILDINGS[bKey];
    if (!canAfford(s, b.cost)) continue;
    const hex = controlledHexes(world, s).find(h =>
      h.terrain === b.terrain && !h.building && !(h.q === s.q && h.r === s.r));
    if (hex) {
      pay(s, b.cost);
      hex.building = bKey;
      hex.buildingIntegrity = 100;
      log(world, `${s.name} built a ${b.name}`);
      return;
    }
  }

  paveRoads(world, s);
}

// Roads (GDD 6.3): roads exist to serve trade. Each settlement paves and
// maintains its half of the route to its favored partner (same faction
// first), so highways form between cities. Local high-traffic hexes are a
// secondary use of any leftover road budget. Quiet roads crumble.
// Villages pave a highway to 1 nearest friendly settlement, towns to 2,
// cities to 3 — full routes, so the network always connects even when
// partnering isn't mutual.
function favoredPartners(world: World, s: Settlement) {
  const count = s.tier === 'VILLAGE' ? 1 : s.tier === 'TOWN' ? 2 : 3;

  const friendly = [];
  for (let i = 0; i < world.settlements.length; i++) {
    const o = world.settlements[i];
    if (o.id === s.id) continue;
    if (o.factionId === s.factionId) {
      const dist = distance(s.q, s.r, o.q, o.r);
      if (dist <= ECON.TRADE_RANGE) {
        friendly.push({ o, dist });
      }
    }
  }
  friendly.sort((a, b) => a.dist - b.dist);
  if (friendly.length > 0) {
    const out = [];
    const limit = Math.min(friendly.length, count);
    for (let i = 0; i < limit; i++) {
      out.push(friendly[i].o);
    }
    return out;
  }

  const foreign = [];
  for (let i = 0; i < world.settlements.length; i++) {
    const o = world.settlements[i];
    if (o.id === s.id) continue;
    const dist = distance(s.q, s.r, o.q, o.r);
    if (dist <= ECON.TRADE_RANGE / 2) {
      foreign.push({ o, dist });
    }
  }
  foreign.sort((a, b) => a.dist - b.dist);
  return foreign.length > 0 ? [foreign[0].o] : [];
}

function paveRoads(world: World, s: Settlement) {
  const factionFocus = world.factions[s.factionId]?.focus ?? 'PEACE';
  if ((factionFocus === 'MOBILIZE' || factionFocus === 'WAR') && s.gold < 200) return;

  const reach = TIERS[s.tier].radius + 2;

  // Full trade routes to favored partners
  const partners = favoredPartners(world, s);
  let routeHexes = [];
  let routePartner = null;
  for (const partner of partners) {
    const path = findPath(world, s.q, s.r, partner.q, partner.r, true);
    if (!path) continue;
    const hexes = path
      .map(([q, r]) => world.hexes.get(key(q, r)))
      .filter(h => h && h.terrain !== 'WATER' &&
        !world.settlements.some(o => o.q === h.q && o.r === h.r));
    if (!routePartner && hexes.some(h => !h.hasRoad)) routePartner = partner;
    routeHexes.push(...hexes);
  }

  // 1) Maintain: trade-route roads always, nearby roads only if still busy
  const maintain = new Set(routeHexes.filter(h => h.hasRoad));
  for (const [q, r] of range(s.q, s.r, reach)) {
    const hex = world.hexes.get(key(q, r));
    if (hex?.hasRoad && hex.traffic >= ECON.ROAD_MAINTAIN_TRAFFIC) maintain.add(hex);
  }
  for (const hex of maintain) {
    if (hex.roadIntegrity < 70) {
      const points = Math.min(40, 100 - hex.roadIntegrity);
      const cost = points * ECON.ROAD_REPAIR_STONE;
      if (s.stock.stone >= cost) {
        s.stock.stone -= cost;
        hex.roadIntegrity += points;
      }
    }
  }

  const buffer = ECON.ROAD_BUILD_BUFFER;
  if (s.stock.timber < ECON.ROAD_COST.timber + buffer ||
    s.stock.stone < ECON.ROAD_COST.stone + buffer) return;

  // 2) Priority: pave the next missing hexes on trade routes (2 per pass)
  let paved = 0;
  for (const hex of routeHexes) {
    if (hex.hasRoad || hex.hasBridge) continue;
    if (hex.terrain === 'RIVER') {
      if (s.stock.timber < ECON.BRIDGE_COST.timber + buffer ||
        s.stock.stone < ECON.BRIDGE_COST.stone + buffer) break;
      pay(s, ECON.BRIDGE_COST);
      hex.hasBridge = true;
      hex.hasRoad = true;
      hex.roadIntegrity = 100;
    } else {
      if (s.stock.timber < ECON.ROAD_COST.timber + buffer ||
        s.stock.stone < ECON.ROAD_COST.stone + buffer) break;
      pay(s, ECON.ROAD_COST);
      hex.hasRoad = true;
      hex.roadIntegrity = 100;
    }
    if (++paved >= 2) break;
  }
  if (paved > 0) {
    world.pathCache?.clear();
    if (routePartner) log(world, `${s.name} paved/bridged the route toward ${routePartner.name}`);
    return;
  }

  // 3) Leftover budget: pave the busiest local hex (high bar)
  const roadBudget = Math.round(TIERS[s.tier].radius * ECON.ROAD_CAP_PER_RADIUS);
  let owned = 0;
  for (const [q, r] of range(s.q, s.r, reach)) {
    const h = world.hexes.get(key(q, r));
    if (h && (h.hasRoad || h.hasBridge)) owned++;
  }
  if (owned >= roadBudget) return;
  let best = null, bestTraffic = ECON.ROAD_TRAFFIC_MIN;
  for (const [q, r] of range(s.q, s.r, reach)) {
    const hex = world.hexes.get(key(q, r));
    if (!hex || hex.hasRoad || hex.hasBridge || hex.terrain === 'WATER') continue;
    if (hex.traffic > bestTraffic) { bestTraffic = hex.traffic; best = hex; }
  }
  if (best) {
    if (best.terrain === 'RIVER') {
      if (s.stock.timber < ECON.BRIDGE_COST.timber + buffer ||
        s.stock.stone < ECON.BRIDGE_COST.stone + buffer) return;
      pay(s, ECON.BRIDGE_COST);
      best.hasBridge = true;
      best.hasRoad = true;
      best.roadIntegrity = 100;
      log(world, `${s.name} built a bridge at (${best.q},${best.r})`);
    } else {
      if (s.stock.timber < ECON.ROAD_COST.timber + buffer ||
        s.stock.stone < ECON.ROAD_COST.stone + buffer) return;
      pay(s, ECON.ROAD_COST);
      best.hasRoad = true;
      best.roadIntegrity = 100;
      log(world, `${s.name} paved a road at (${best.q},${best.r})`);
    }
    world.pathCache?.clear();
  }
}


export function findColonySite(world: World, s: Settlement) {
  let best = null, bestScore = -Infinity;
  for (const [q, r] of range(s.q, s.r, ECON.EXPAND_SEARCH_RADIUS)) {
    const hex = world.hexes.get(key(q, r));
    if (!hex || hex.owner !== null || hex.terrain === 'WATER' || hex.terrain === 'MOUNTAINS' || hex.terrain === 'RIVER') continue;
    const d = distance(s.q, s.r, q, r);
    if (d < ECON.EXPAND_MIN_DIST) continue;
    if (world.settlements.some(o => distance(o.q, o.r, q, r) < ECON.EXPAND_MIN_DIST)) continue;
    // Score by unclaimed yield variety around the site
    let score = 0;
    const seen = {};
    for (const [nq, nr] of range(q, r, 2)) {
      const n = world.hexes.get(key(nq, nr));
      if (!n || n.owner !== null) continue;
      const res = TERRAIN[n.terrain].yield;
      if (res && n.terrain !== 'WATER') { score += TERRAIN[n.terrain].rate; seen[res] = true; }
    }

    // Proximity and encroachment modifiers
    let enemyDiploMod = 0;
    const otherFactionsSettle = world.settlements.filter(o => o.factionId !== s.factionId);
    if (otherFactionsSettle.length > 0) {
      const dEnemy = Math.min(...otherFactionsSettle.map(o => distance(o.q, o.r, q, r)));
      if (dEnemy <= 12) {
        // Encroachment penalty, scaled by faction's aggression trait
        const t = traitsOf(world, s);
        enemyDiploMod = - (12 - dEnemy) * 1.5 * (2.0 - (t.aggression ?? 1.0));
      } else if (dEnemy <= 24) {
        // Proximity attraction: encourages settling near other factions for trade/interaction
        enemyDiploMod = (24 - dEnemy) * 0.15;
      }
    }

    score += Object.keys(seen).length * 2 - d * 0.15 + enemyDiploMod;
    if (score > bestScore) { bestScore = score; best = { q, r }; }
  }
  return best;
}
