// --- Labor (HR) Governor: recruitment + focus (GDD 4.1.2) ---
import { TIERS, ECON, GOALS } from '../../core/constants.js';
import { canAfford, pay } from '../settlement.js';
import { spawnAgent } from '../agents.js';
import { rankedNeeds } from '../systems.js';

export function laborGovernor(world, s) {
  // High-level focus = most needed resource
  const factionFocus = world.factions[s.factionId]?.focus ?? 'PEACE';
  if (factionFocus === 'MOBILIZE' || factionFocus === 'WAR') {
    s.focus = (s.stock.food < s.stock.ore * 4) ? 'food' : 'ore';
  } else {
    s.focus = rankedNeeds(world, s)[0];
  }

  if (s.goal === GOALS.THRIFTY || s.goal === GOALS.SURVIVE) return; // recruitment paused
  const mine = world.agents.filter(a => a.homeId === s.id && a.type === 'villager');
  const villagers = mine.length;
  const idle = mine.filter(a => a.state === 'idle').length;
  // Demand-aware hiring: idle hands mean labor already outstrips extraction
  if (idle >= 2) return;
  const maxVillagers = Math.min(TIERS[s.tier].jobCap, Math.floor(s.population / 3));
  if (villagers < maxVillagers && s.gold >= ECON.RECRUIT_GOLD_BUFFER && canAfford(s, ECON.VILLAGER_COST)) {
    pay(s, ECON.VILLAGER_COST);
    spawnAgent(world, 'villager', s.factionId, s.id, s.q, s.r);
  }
}
