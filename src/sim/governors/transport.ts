// --- Transport Governor: caravan fleet + logistics missions (GDD 4.1.3) ---
import { distance } from '../../core/hex.js';
import { TIERS, ECON, GOALS } from '../../core/constants.js';
import { controlledHexes, canAfford, pay, log } from '../settlement.js';
import { spawnAgent, assignPath, AGENT_CAPACITY } from '../agents.js';
import { unclaimed, takeTicket } from '../systems.js';
import { traitsOf } from './index.js';
import type { World } from '../../types.js';

// --- Transport Governor: caravan fleet + logistics missions (GDD 4.1.3) ---
export function transportGovernor(world: World, s) {
  if (s.siegeHp != null) return; // under siege: no caravans leave the walls
  const caravans = world.agents.filter(a => a.homeId === s.id && a.type === 'caravan');
  const base = s.tier === 'VILLAGE' ? 1 : s.tier === 'TOWN' ? 2 : 3;
  const maxCaravans = base + (traitsOf(world, s).trade >= 1.4 ? 1 : 0);

  if (caravans.length < maxCaravans && s.goal !== GOALS.SURVIVE && s.goal !== GOALS.THRIFTY
    && s.gold >= ECON.RECRUIT_GOLD_BUFFER && canAfford(s, ECON.CARAVAN_COST)) {
    pay(s, ECON.CARAVAN_COST);
    spawnAgent(world, 'caravan', s.factionId, s.id, s.q, s.r);
    log(world, `${s.name} assembled a caravan`);
  }

  // Dispatch idle, healthy caravans to the richest UNCLAIMED remote pile.
  // Tickets in world.claims stop two caravans grabbing the same cargo.
  for (const caravan of caravans) {
    if (caravan.state !== 'idle' || caravan.integrity < ECON.REPAIR_THRESHOLD) continue;
    let best = null, bestScore = 0, bestRes = null;
    for (const hex of controlledHexes(world, s)) {
      const d = distance(s.q, s.r, hex.q, hex.r);
      if (d < 2) continue; // villagers handle close piles
      for (const res of ['food', 'timber', 'stone', 'ore']) {
        const open = unclaimed(world.claims, hex, res);
        if (open < 30) continue;
        const score = open / (1 + d * 0.2);
        if (score > bestScore) { bestScore = score; best = hex; bestRes = res; }
      }
    }
    if (best && assignPath(world, caravan, best.q, best.r)) {
      caravan.mission = { kind: 'gather', tq: best.q, tr: best.r, resource: bestRes, phase: 'out' };
      takeTicket(world.claims, best.q, best.r, bestRes, AGENT_CAPACITY.caravan);
    }
  }
}
