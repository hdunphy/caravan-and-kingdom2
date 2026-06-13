// --- 4. Logistics: reactive-ant villagers (GDD 5.1) ---
// --- Ticket ledger (job system) ---
// Every outbound gather mission is a "ticket" reserving carrier-capacity units
// of a specific pile. The ledger is rebuilt from live missions each time, so
// tickets self-expire when missions complete, cancel, or the agent dies.
import { distance } from '../../core/hex.js';
import { ECON, GOALS } from '../../core/constants.js';
import { controlledHexes, storageCap } from '../settlement.js';
import { AGENT_CAPACITY, homeOf, assignPath } from '../agents.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo } from '../../types.js';

export function buildClaims(world: World) {
  const claims = new Map();
  for (const a of world.agents) {
    if (a.mission?.kind === 'gather' && a.mission.phase === 'out') {
      const k = a.mission.tq + ',' + a.mission.tr + ':' + a.mission.resource;
      claims.set(k, (claims.get(k) ?? 0) + (AGENT_CAPACITY[a.type] ?? 10));
    }
  }
  return claims;
}

export function takeTicket(claims: Map<string, number>, q: number, r: number, res: string, capacity: number) {
  const k = q + ',' + r + ':' + res;
  claims.set(k, (claims.get(k) ?? 0) + capacity);
}

export function unclaimed(claims: Map<string, number>, hex: Hex, res: string) {
  return hex.resources[res] - (claims.get(hex.q + ',' + hex.r + ':' + res) ?? 0);
}

export function logisticsSystem(world: World) {
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

export function rankedNeeds(world: World, s: Settlement) {
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
