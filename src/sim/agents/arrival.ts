// Mission resolution: what happens when an agent reaches the end of its path.
import { distance } from '../../core/hex.js';
import { ECON } from '../../core/constants.js';
import { foundSettlement, deposit, log } from '../settlement.js';
import { AGENT_CAPACITY, homeOf, spawnAgent, recordTrade, findFallbackSite } from './spawn.js';
import { assignPath, cancelMission } from './movement.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

// Called by the movement system when an agent finishes its path.
export function onArrival(world: World, agent: Agent) {
  const m = agent.mission;
  const home = homeOf(world, agent);
  if (!m) { agent.state = 'idle'; return; }

  switch (m.kind) {
    case 'return':
      agent.state = 'idle'; agent.mission = null;
      break;

    case 'gather': {
      if (m.phase === 'out') {
        const hex = world.hexes.get(m.tq + ',' + m.tr);
        const cap = (AGENT_CAPACITY as Record<string, number>)[agent.type] ?? 10;
        if (hex && hex.resources[m.resource!] > 0) {
          const take = Math.min(hex.resources[m.resource!], cap);
          hex.resources[m.resource!] -= take;
          agent.cargo[m.resource!] += take;
        }
        if (!home || !assignPath(world, agent, home.q, home.r)) { cancelMission(world, agent); return; }
        m.phase = 'back';
      } else {
        if (home) deposit(home, agent.cargo);
        agent.cargo = { food: 0, timber: 0, stone: 0, ore: 0 };
        agent.mission = null; agent.state = 'idle';
      }
      break;
    }

    case 'freight': {
      const dest = world.settlements.find(s => s.id === m.destId);
      if (m.phase === 'out') {
        if (dest) deposit(dest, agent.cargo);
        agent.cargo = { food: 0, timber: 0, stone: 0, ore: 0 };
        if (!home || !assignPath(world, agent, home.q, home.r)) { cancelMission(world, agent); return; }
        m.phase = 'back';
      } else {
        agent.mission = null; agent.state = 'idle';
      }
      break;
    }

    case 'trade': {
      const seller = world.settlements.find(s => s.id === m.destId);
      if (m.phase === 'out') {
        if (seller && home) {
          if (m.barterRes) {
            // Barter: swap goods 1:1
            const amount = Math.min(ECON.TRADE_BATCH, Math.max(0, seller.stock[m.resource!] - 60),
                                    agent.cargo[m.barterRes!] ?? 0);
            if (amount > 0) {
              seller.stock[m.resource!] -= amount;
              deposit(seller, { [m.barterRes!]: amount });
              agent.cargo[m.barterRes!] -= amount;
              agent.cargo[m.resource!] += amount;
              recordTrade(world, home.factionId, seller.factionId);
              if (home.buildings.includes('MARKET_HALL')) {
                home.gold += Math.round(amount * 0.1);
              }
              if (seller.buildings.includes('MARKET_HALL')) {
                seller.gold += Math.round(amount * 0.1);
              }
              log(world, `${home.name} bartered ${amount} ${m.barterRes} for ${m.resource} with ${seller.name}`);
            }
          } else {
            // Gold purchase
            const unit = m.price ?? ECON.TRADE_PRICE;
            const amount = Math.min(ECON.TRADE_BATCH, Math.max(0, seller.stock[m.resource!] - 60));
            const price = Math.ceil(amount * unit);
            if (amount > 0 && home.gold >= price) {
              seller.stock[m.resource!] -= amount;
              seller.gold += price;
              home.gold -= price;
              agent.cargo[m.resource!] += amount;
              recordTrade(world, home.factionId, seller.factionId);
              if (home.buildings.includes('MARKET_HALL')) {
                home.gold += Math.round(amount * 0.1);
              }
              if (seller.buildings.includes('MARKET_HALL')) {
                seller.gold += Math.round(amount * 0.1);
              }
              log(world, home.factionId === seller.factionId
                ? `${home.name} transferred ${amount} ${m.resource} from ${seller.name}`
                : `${home.name} bought ${amount} ${m.resource} from ${seller.name}`);
            }
          }
        }
        if (!home || !assignPath(world, agent, home.q, home.r)) { cancelMission(world, agent); return; }
        m.phase = 'back';
      } else {
        if (home) deposit(home, agent.cargo);
        agent.cargo = { food: 0, timber: 0, stone: 0, ore: 0 };
        agent.mission = null; agent.state = 'idle';
      }
      break;
    }

    case 'export': {
      const buyer = world.settlements.find(s => s.id === m.destId);
      if (m.phase === 'out') {
        if (buyer && home) {
          const unit = m.price ?? ECON.TRADE_PRICE;
          const offered = agent.cargo[m.resource!];
          const affordable = (home.factionId === buyer.factionId || unit === 0) ? offered : Math.floor(buyer.gold / unit);
          const sold = Math.min(offered, affordable);
          if (sold > 0) {
            const price = home.factionId === buyer.factionId ? 0 : sold * unit;
            buyer.gold -= price;
            home.gold += price;
            agent.cargo[m.resource!] -= sold;
            deposit(buyer, { [m.resource!]: sold });
            recordTrade(world, home.factionId, buyer.factionId);
            if (home.buildings.includes('MARKET_HALL')) {
              home.gold += Math.round(sold * 0.1);
            }
            if (buyer.buildings.includes('MARKET_HALL')) {
              buyer.gold += Math.round(sold * 0.1);
            }
            log(world, home.factionId === buyer.factionId
              ? `${home.name} transferred ${sold} ${m.resource} to ${buyer.name}`
              : `${home.name} sold ${sold} ${m.resource} to ${buyer.name}`);
          }
        }
        if (!home || !assignPath(world, agent, home.q, home.r)) { cancelMission(world, agent); return; }
        m.phase = 'back';
      } else {
        if (home) deposit(home, agent.cargo); // unsold goods come home
        agent.cargo = { food: 0, timber: 0, stone: 0, ore: 0 };
        agent.mission = null; agent.state = 'idle';
      }
      break;
    }

    case 'march': {
      const target = world.settlements.find(s => s.id === m.targetId);
      const hostile = target && world.diplo?.wars.some(w =>
        (w.a === agent.factionId && w.b === target.factionId) ||
        (w.b === agent.factionId && w.a === target.factionId));
      if (hostile && target.q === agent.q && target.r === agent.r) {
        agent.state = 'siege';
        agent.mission = { kind: 'siege', targetId: target.id };
      } else {
        cancelMission(world, agent); // war ended or target lost: go home
      }
      break;
    }

    case 'settle': {
      // First to arrive claims the land. Re-validate: another settlement may
      // have been founded (or territory claimed) while we were traveling.
      const here = world.hexes.get(agent.q + ',' + agent.r);
      const valid = here && here.owner === null &&
        here.terrain !== 'WATER' && here.terrain !== 'MOUNTAINS' &&
        !world.settlements.some(o => distance(o.q, o.r, agent.q, agent.r) < ECON.EXPAND_MIN_DIST);

      if (valid) {
        const s = foundSettlement(world, agent.factionId, agent.q, agent.r, ECON.SETTLER_POP);
        s.stock = { food: 100, timber: 40, stone: 10, ore: 0 };
        spawnAgent(world, 'villager', s.factionId, s.id, s.q, s.r);
        spawnAgent(world, 'villager', s.factionId, s.id, s.q, s.r);
        if (home) home.pendingSettler = false;

        // Relationship impact for settling near other factions
        if (world.diplo) {
          let maxPenalty = 0;
          let outragedNeighbor = null;
          for (const o of world.settlements) {
            if (o.factionId === agent.factionId || o.id === s.id) continue;
            const d = distance(s.q, s.r, o.q, o.r);
            if (d <= 12) {
              const penalty = d <= 6 ? 50 : 25;
              const k = Math.min(agent.factionId, o.factionId) + '|' + Math.max(agent.factionId, o.factionId);
              const v = (world.diplo.relations[k] ?? 0) - penalty;
              world.diplo.relations[k] = Math.max(-100, Math.min(100, v));
              if (penalty > maxPenalty) {
                maxPenalty = penalty;
                outragedNeighbor = o.factionId;
              }
            }
          }
          if (outragedNeighbor !== null) {
            const myName = world.factions[agent.factionId].name;
            const neighborName = world.factions[outragedNeighbor].name;
            log(world, `${myName} founded ${s.name} near ${neighborName}'s border, causing diplomatic outrage!`);
          }
        }

        world.agents = world.agents.filter(a => a.id !== agent.id);
        break;
      }

      // Site taken: look for a nearby alternative (a couple of tries), else go home.
      const retries = m.retries ?? 0;
      const alt = retries < 2 ? findFallbackSite(world, agent.q, agent.r) : null;
      if (alt && assignPath(world, agent, alt.q, alt.r)) {
        agent.mission = { kind: 'settle', tq: alt.q, tr: alt.r, retries: retries + 1 };
        log(world, `Settlers found their site claimed and diverted to (${alt.q},${alt.r})`);
      } else if (home && assignPath(world, agent, home.q, home.r)) {
        agent.mission = { kind: 'settleReturn' };
        log(world, `Settlers are returning to ${home.name}`);
      } else {
        if (home) home.pendingSettler = false;
        world.agents = world.agents.filter(a => a.id !== agent.id);
      }
      break;
    }

    case 'settleReturn': {
      // Back home: people rejoin the city, 70% of material cost is recovered.
      if (home) {
        home.population += ECON.SETTLER_POP;
        deposit(home, {
          food: ECON.SETTLER_COST.food * ECON.SETTLER_REFUND,
          timber: ECON.SETTLER_COST.timber * ECON.SETTLER_REFUND,
        });
        home.pendingSettler = false;
        log(world, `Settlers rejoined ${home.name} (partial refund)`);
      }
      world.agents = world.agents.filter(a => a.id !== agent.id);
      break;
    }

    default:
      agent.state = 'idle'; agent.mission = null;
  }
}
