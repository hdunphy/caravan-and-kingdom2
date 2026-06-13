// The AI Brain: Parallel Governor Architecture (GDD 4).
// Each governor runs independently every AI pass, so no single priority can lock the others out.
// This module is the entry point + barrel: shared helpers (traitsOf, getSettlerCost),
// goal evaluation, the per-tick aiSystem orchestrator, and the public surface.
import { TIERS, ECON, GOALS, DEFAULT_TRAITS } from '../../core/constants.js';
import { buildClaims } from '../systems.js';
import { civilGovernor, findColonySite } from './civil.js';
import { laborGovernor } from './labor.js';
import { transportGovernor } from './transport.js';
import { tradeGovernor } from './trade.js';
import type { World } from '../../types.js';

export { findColonySite } from './civil.js';

export function traitsOf(world: World, s) {
  return world.factions[s.factionId]?.traits ?? DEFAULT_TRAITS;
}

export function getSettlerCost(world: World, factionId) {
  const count = world.settlements.filter(s => s.factionId === factionId).length;
  const factor = 1.0 + ECON.SETTLER_SCALING * (count - 1);
  return {
    food: Math.round(ECON.SETTLER_COST.food * factor),
    timber: Math.round(ECON.SETTLER_COST.timber * factor)
  };
}

export function aiSystem(world: World) {
  // One shared ticket ledger per AI pass: caravan dispatches reserve piles
  // here so two caravans (even from different settlements) never chase the
  // same cargo. Villager tickets are included via buildClaims.
  world.claims = buildClaims(world);
  for (const s of world.settlements) {
    evaluateGoal(world, s);
    civilGovernor(world, s);
    laborGovernor(world, s);
    tradeGovernor(world, s);
    transportGovernor(world, s);
  }
}

// --- Goal evaluation (GDD 4.2) ---
export function evaluateGoal(world: World, s) {
  const foodDays = s.stock.food / Math.max(1, s.population * ECON.FOOD_PER_POP);
  const totalStock = s.stock.food + s.stock.timber + s.stock.stone + s.stock.ore;
  const tier = TIERS[s.tier];
  const factionFocus = world.factions[s.factionId]?.focus ?? 'PEACE';

  if (foodDays < 15) { s.goal = GOALS.SURVIVE; return; }
  if (totalStock < 100) { s.goal = GOALS.THRIFTY; return; }

  if (factionFocus === 'MOBILIZE' || factionFocus === 'WAR') {
    s.goal = GOALS.DEVELOP;
    return;
  }

  const t = traitsOf(world, s);
  if (tier.next && s.population > tier.popCap * ECON.UPGRADE_TRIGGER_POP) { s.goal = GOALS.UPGRADE; return; }
  if (s.population >= ECON.EXPAND_MIN_POP / t.expand && s.tier !== 'VILLAGE' && !s.pendingSettler) {
    s.goal = GOALS.EXPAND; return;
  }
  s.goal = GOALS.DEVELOP;
}
