// ---------- Peacetime ----------
import { DIPLO, ECON } from '../../core/constants.js';
import { log } from '../settlement.js';
import { homeOf } from '../agents.js';
import { pairKey, getRelation, addRelation, findWar, atWar, atWarAny, stateOf, hasEmbargo, hasPact, getAllies, canTrade, tradePrice } from './relations.js';
import { soldiersOf, strengthOf, committedStrength, defensiveBlocStats, offensiveBlocStats, settlementDefense, armyCap } from './strength.js';
import { aliveF, traitsF, effectiveAggression, settlementsF, goldF, tierMultiplier } from './helpers.js';
import { recruitSoldiers } from './war.js';

// ---------- Peacetime ----------
export function manageGarrison(world, fid) {
  const aggr = effectiveAggression(world, fid);
  const target = Math.min(
    Math.round(settlementsF(world, fid).length * DIPLO.GARRISON_PEACE * (aggr >= 1.2 ? 2 : 1)),
    armyCap(world, fid));
  const soldiers = soldiersOf(world, fid);
  if (soldiers.length < target) {
    recruitSoldiers(world, fid, target);
  } else if (soldiers.length > target) {
    const surplus = soldiers.filter(a => a.state === 'idle').slice(0, soldiers.length - target);
    for (const a of surplus) {
      const home = homeOf(world, a);
      if (home) home.population += Math.round(DIPLO.SOLDIER_POP_COST * DIPLO.DISBAND_POP_RETURN);
    }
    const ids = new Set(surplus.map(a => a.id));
    world.agents = world.agents.filter(a => !ids.has(a.id));
  }
}

export function considerGift(world, fid) {
  if ((traitsF(world, fid).trade ?? 1) < 1.3) return; // only mercantile courts buy peace
  for (const other of world.factions) {
    if (other.id === fid || !aliveF(world, other.id)) continue;
    if (stateOf(world, fid, other.id) !== 'HOSTILE') continue;
    if (strengthOf(world, other.id) <= strengthOf(world, fid)) continue;
    const rich = settlementsF(world, fid).sort((a, b) => b.gold - a.gold || a.id - b.id)[0];
    if (!rich || rich.gold < DIPLO.GIFT_VALUE * 2) continue;
    rich.gold -= DIPLO.GIFT_VALUE;
    const recipient = settlementsF(world, other.id)[0];
    if (recipient) recipient.gold += DIPLO.GIFT_VALUE;
    addRelation(world, fid, other.id, DIPLO.GIFT_VALUE / DIPLO.GIFT_GOLD_PER_POINT);
    log(world, `${world.factions[fid].name} sent tribute to ${other.name}`);
    return;
  }
}

