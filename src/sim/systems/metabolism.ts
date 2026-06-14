// --- 2. Metabolism: population eats, grows, declines (GDD 3.1) ---
import { BUILDINGS, ECON, TIERS, DIPLO } from '../../core/constants.js';
import { getModifier } from './events.js';
import { log, pushAlert, storageCap } from '../settlement.js';
import { policyOf } from '../policy.js';
import { treasuryOf, addGold } from '../economy.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

export function metabolismSystem(world: World) {
  for (const s of world.settlements) {
    // Market taxes: only so much commerce fits in one settlement, so taxable
    // population is bounded (stops gold scaling without limit)
    const faction = world.factions.find(f => f.id === s.factionId);
    const factionFocus = faction?.focus ?? 'PEACE';
    const factionCount = (world.settlementsByFaction?.get(s.factionId) || []).length;
    const widePenalty = Math.max(1.0 - ECON.WIDE_TAX_MAX_PENALTY, 1.0 - ECON.WIDE_TAX_CORRUPTION * Math.max(0, factionCount - ECON.WIDE_TAX_THRESHOLD));
    const hasMarket = s.buildings.includes('MARKET_HALL');
    const taxableCap = TIERS[s.tier].popCap * (hasMarket ? 3.0 : 2.0);
    const taxable = Math.min(s.population, taxableCap);

    let taxBonus = 1.0;
    if (factionFocus === 'MOBILIZE' || factionFocus === 'WAR') {
      taxBonus = DIPLO.MOBILIZATION_TAX_BONUS;
    }
    const policy = policyOf(world, s.factionId);
    const taxIncome = taxable * ECON.GOLD_INCOME_PER_POP * widePenalty * taxBonus * policy.taxRate;
    addGold(world, s.factionId, taxIncome);

    const besieged = s.siegeHp != null;
    if (besieged) {
      pushAlert(world, { severity: 'IMPORTANT', factionId: s.factionId, type: 'SIEGE', tick: world.tick, targetId: s.id, q: s.q, r: s.r, msg: `${s.name} is under siege!` });
    }
    
    let need = s.population * ECON.FOOD_PER_POP * policy.rations;
    if (besieged) need *= 0.5; // siege rations: the blockade starves slowly, not instantly
    if (s.stock.food >= need) {
      s.stock.food -= need;
      // No hard population cap: people only settle where food is ABUNDANT
      // (30+ days of reserves), not merely sufficient. Population is thus
      // naturally bounded by food production AND granary capacity — a city
      // can't hold 30 days of food for more people than its warehouses fit.
      const foodDays = s.stock.food / Math.max(0.05, need);
      
      const t = treasuryOf(world, s.factionId);
      const debt = Math.max(0, -t);
      const smithy = s.buildings.includes('SMITHY');
      if (smithy) {
        const maxTools = Math.max(0, s.population * 2 - s.tools);
        if (maxTools > 0 && s.stock.ore >= ECON.TOOL_COST.ore && s.stock.timber >= ECON.TOOL_COST.timber) {
          const modTools = getModifier(world, s.factionId, 'tool_production', 1.0);
          const possible = Math.min(
            maxTools,
            Math.floor(s.stock.ore / ECON.TOOL_COST.ore),
            Math.floor(s.stock.timber / ECON.TOOL_COST.timber),
            Math.floor(5 * modTools)
          );
          s.tools += possible;
          s.stock.ore -= possible * ECON.TOOL_COST.ore;
          s.stock.timber -= possible * ECON.TOOL_COST.timber;
        }
      }

      if (debt >= ECON.DEBT_DEATH) {
        const decayRate = ECON.DEBT_DECAY_BASE * (debt / ECON.DEBT_DEATH);
        s.population = Math.max(0.5, s.population - decayRate);
      }

      if (!besieged && foodDays > ECON.FOOD_RESERVE) {
        const fertility = Math.min(1, (foodDays - ECON.FOOD_RESERVE) / ECON.FOOD_RESERVE);
        let growthPenalty = 1.0;
        if (factionFocus === 'MOBILIZE' || factionFocus === 'WAR') {
          growthPenalty = DIPLO.MOBILIZATION_GROWTH_PENALTY;
        }
        if (policy.taxRate > 1.2) growthPenalty *= 0.9;
        // Rations below 0.8 starve growth; above 1.0 a well-fed populace grows
        // faster (so the upper half of the slider is a real trade: more food → more growth).
        if (policy.rations < 0.8) growthPenalty *= 0.9;
        else if (policy.rations > 1.0) growthPenalty *= 1.0 + (policy.rations - 1.0) * ECON.RATION_GROWTH_BONUS;
        
        let debtFactor = 1.0;
        if (debt > 0 && debt < ECON.DEBT_DEATH) {
          debtFactor = Math.max(0, 1 - Math.pow(debt / ECON.DEBT_DEATH, 2));
        } else if (debt >= ECON.DEBT_DEATH) {
          debtFactor = 0;
        }
        const modPop = getModifier(world, s.factionId, 'pop_growth', 1.0);
        s.population += (ECON.POP_GROWTH_RATE + ECON.POP_GROWTH_RATE * s.population * 0.1) * fertility * growthPenalty * debtFactor * modPop;
      }
    } else {
      const foodDays = Math.max(0, s.stock.food) / Math.max(0.05, need);
      pushAlert(world, { severity: foodDays < 3 ? 'CRITICAL' : 'IMPORTANT', factionId: s.factionId, type: 'STARVATION', tick: world.tick, targetId: s.id, q: s.q, r: s.r, msg: `${s.name} is starving!` });
      s.stock.food = 0;
      // Starvation scales with how many mouths go unfed
      s.population = Math.max(0, s.population - (0.05 + s.population * 0.0008));
      if (s.population <= 0.5) {
        log(world, `${s.name} has perished`);
        const fid = s.factionId;
        abandonSettlement(world, s);
        const fidTowns: Settlement[] = world.settlementsByFaction?.get(fid) || [];
        if (fidTowns.filter(o => o.id !== s.id).length === 0) {
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

export function abandonSettlement(world: World, s: Settlement) {
  world.bordersDirty = true;
  world.pathCache?.clear();
  for (const hex of world.hexes.values()) {
    if (hex.owner === s.id) { hex.owner = null; hex.building = null; }
  }
  world.agents = world.agents.filter(a => a.homeId !== s.id);
}
