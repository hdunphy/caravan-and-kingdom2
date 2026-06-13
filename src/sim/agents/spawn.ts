// Agent creation + small shared helpers (speeds, capacities, trade tally, fallback sites).
import { distance, range } from '../../core/hex.js';
import { ECON } from '../../core/constants.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

export const AGENT_SPEED = { villager: 1.0, caravan: 1.5, settler: 0.8, soldier: 1.0 };

export const AGENT_CAPACITY = { villager: ECON.VILLAGER_CAPACITY, caravan: ECON.CARAVAN_CAPACITY, soldier: 30 };

// Cross-faction transactions warm relations; the Court tallies them each session.
export function recordTrade(world: World, fa: number, fb: number) {
  if (fa === fb || !world.diplo) return;
  const k = Math.min(fa, fb) + '|' + Math.max(fa, fb);
  world.diplo.tradeCounts[k] = (world.diplo.tradeCounts[k] ?? 0) + 1;
  if (world.stats) {
    world.stats.trades[fa] = (world.stats.trades[fa] ?? 0) + 1;
    world.stats.trades[fb] = (world.stats.trades[fb] ?? 0) + 1;
  }
}

// Nearest valid colony spot around a failed site.
export function findFallbackSite(world: World, q0: number, r0: number, radius: number = 4) {
  let best = null, bestD = Infinity;
  for (const [q, r] of range(q0, r0, radius)) {
    const hex = world.hexes.get(q + ',' + r);
    if (!hex || hex.owner !== null) continue;
    if (hex.terrain === 'WATER' || hex.terrain === 'MOUNTAINS') continue;
    if (world.settlements.some(o => distance(o.q, o.r, q, r) < ECON.EXPAND_MIN_DIST)) continue;
    const d = distance(q0, r0, q, r);
    if (d > 0 && d < bestD) { bestD = d; best = { q, r }; }
  }
  return best;
}

export function spawnAgent(world: World, type: AgentKind, factionId: number, homeId: number, q: number, r: number) {
  const agent: Agent = {
    id: world.nextId++,
    type, factionId, homeId,
    q, r,
    path: [], progress: 0,
    state: 'idle',          // idle | travel
    mission: null,
    cargo: { food: 0, timber: 0, stone: 0, ore: 0 },
    integrity: 100,
    engagedSince: null,
  };
  world.agents.push(agent);
  return agent;
}

export function homeOf(world: World, agent: Agent) {
  return world.settlements.find(s => s.id === agent.homeId);
}
