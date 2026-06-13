// --- 2. Metabolism: population eats, grows, declines (GDD 3.1) ---
import { ECON, TIERS, DIPLO } from '../../core/constants.js';
import { log } from '../settlement.js';

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

export function abandonSettlement(world, s) {
  world.bordersDirty = true;
  world.pathCache?.clear();
  for (const hex of world.hexes.values()) {
    if (hex.owner === s.id) { hex.owner = null; hex.building = null; }
  }
  world.agents = world.agents.filter(a => a.homeId !== s.id);
}
