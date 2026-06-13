// --- Trade Governor: buy scarce resources, export surpluses (GDD 4.1.4) ---
import { distance } from '../../core/hex.js';
import { TIERS, ECON, GOALS } from '../../core/constants.js';
import { assignPath } from '../agents.js';
import { rankedNeeds } from '../systems.js';
import { canTrade, tradePrice, stateOf } from '../diplomacy.js';
import { traitsOf } from './index.js';
import { policyOf } from '../policy.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

// --- Trade Governor: buy scarce resources, export surpluses (GDD 4.1.4) ---
export function tradeGovernor(world: World, s: Settlement) {
  if (s.siegeHp != null) return; // under siege: trade is cut off
  const policy = policyOf(world, s.factionId);
  if (policy.tradeStance === 0) return; // autarky
  const survival = s.goal === GOALS.SURVIVE;
  const idle = world.agents.filter(a =>
    a.homeId === s.id && a.type === 'caravan' && a.state === 'idle' &&
    a.integrity >= ECON.REPAIR_THRESHOLD);
  if (idle.length === 0) return;
  let caravan = idle.shift()!;

  // Buy what we're missing (outbound gold or barter). While saving for an upgrade,
  // keep buying until the upgrade cost is covered.
  const buyNeeds = survival ? ['food'] : rankedNeeds(world, s);
  for (const res of buyNeeds) {
    const upgradeNeed = (s.goal === GOALS.UPGRADE && TIERS[s.tier].next)
      ? ((TIERS[s.tier].upgradeCost as Record<string, number> | null)?.[res] ?? 0) + 40 : 0;
    const target = Math.max(40, upgradeNeed) * policy.tradeStance;
    if (s.stock[res] >= target) continue;

    // Market Hall trade range bonus
    const hasMarket = s.buildings.includes('MARKET_HALL');
    const tradeRange = hasMarket ? ECON.TRADE_RANGE * 1.5 : ECON.TRADE_RANGE;

    const seller = world.settlements
      .filter(o => o.id !== s.id && o.stock[res] >= ECON.TRADE_SURPLUS_MIN && o.siegeHp == null &&
        canTrade(world, s.factionId, o.factionId) &&
        distance(s.q, s.r, o.q, o.r) <= tradeRange)
      .sort((a, b) => {
        // friends before strangers, then nearest
        const fa = stateOf(world, s.factionId, a.factionId) === 'FRIENDLY' || a.factionId === s.factionId ? 0 : 1;
        const fb = stateOf(world, s.factionId, b.factionId) === 'FRIENDLY' || b.factionId === s.factionId ? 0 : 1;
        return fa - fb || distance(s.q, s.r, a.q, a.r) - distance(s.q, s.r, b.q, b.r);
      })[0];
    if (!seller) continue;

    let unit = tradePrice(world, s.factionId, seller.factionId);
    // Market Hall discount on imports
    if (hasMarket) {
      unit = Math.max(1.0, unit * 0.8); // 20% discount on imports
    }

    const cost = Math.ceil(ECON.TRADE_BATCH * unit);
    let barterRes = null;
    if (s.gold < cost) {
      // Can't afford gold — try bartering a surplus resource 1:1
      barterRes = ['ore', 'stone', 'timber', 'food']
        .find(r => r !== res && s.stock[r] >= ECON.TRADE_BATCH + 60);
      if (!barterRes) continue; // can't pay either way
    }
    if (assignPath(world, caravan, seller.q, seller.r)) {
      if (barterRes) {
        const amt = Math.min(ECON.TRADE_BATCH, s.stock[barterRes] - 60);
        s.stock[barterRes] -= amt;
        caravan.cargo[barterRes] += amt;
      }
      caravan.mission = {
        kind: 'trade', destId: seller.id, resource: res as Resource, phase: 'out',
        price: unit, barterRes: (barterRes ?? undefined) as Resource | undefined
      };
      caravan = idle.shift()!;
      if (!caravan) return;
      break;
    }
  }

  // Skip exports when in survival mode — focus on importing food
  if (survival) return;

  // Export surpluses to needy neighbors (inbound gold) — this keeps gold
  // circulating so trade doesn't starve after the first purchase.
  const hasMarket = s.buildings.includes('MARKET_HALL');
  const tradeRange = hasMarket ? ECON.TRADE_RANGE * 1.5 : ECON.TRADE_RANGE;

  for (const res of ['timber', 'stone', 'food', 'ore']) {
    if (s.stock[res] < ECON.TRADE_SURPLUS_MIN / policy.tradeStance) continue;
    const buyer = world.settlements
      .filter(o => o.id !== s.id && o.stock[res] < 100 && o.siegeHp == null &&
        (o.factionId === s.factionId || o.gold >= ECON.TRADE_PRICE * 5) &&
        canTrade(world, s.factionId, o.factionId) &&
        distance(s.q, s.r, o.q, o.r) <= tradeRange)
      .sort((a, b) => distance(s.q, s.r, a.q, a.r) - distance(s.q, s.r, b.q, b.r))[0];
    if (buyer && assignPath(world, caravan, buyer.q, buyer.r)) {
      const amt = Math.min(ECON.TRADE_BATCH, s.stock[res] - ECON.TRADE_KEEP);
      s.stock[res] -= amt;
      caravan.cargo[res] += amt;

      let price = tradePrice(world, s.factionId, buyer.factionId);
      // Market Hall premium on exports
      if (hasMarket) {
        price = price * 1.25; // 25% premium on exports
      }

      caravan.mission = {
        kind: 'export', destId: buyer.id, resource: res as Resource, phase: 'out',
        price
      };
      return;
    }
  }
}
