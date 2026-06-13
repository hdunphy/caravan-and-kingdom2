// ---------- Peace ----------
import { key, distance } from '../../core/hex.js';
import { DIPLO, ECON } from '../../core/constants.js';
import { log, pushAlert } from '../settlement.js';
import { homeOf, cancelMission } from '../agents.js';
import { pairKey, getRelation, addRelation, findWar, atWar, atWarAny, stateOf, hasEmbargo, hasPact, getAllies, canTrade, tradePrice } from './relations.js';
import { soldiersOf, strengthOf, committedStrength, defensiveBlocStats, offensiveBlocStats, settlementDefense, armyCap } from './strength.js';
import { aliveF, traitsF, effectiveAggression, settlementsF, goldF, tierMultiplier } from './helpers.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

// ---------- Peace ----------
export function checkPeace(world: World, war: War) {
  const ea = war.exh[war.a], eb = war.exh[war.b];
  if (ea >= DIPLO.SUE_THRESHOLD && eb >= DIPLO.SUE_THRESHOLD) makePeace(world, war, ea >= eb ? war.a : war.b);
  else if (ea >= DIPLO.SUE_THRESHOLD) makePeace(world, war, war.a);
  else if (eb >= DIPLO.SUE_THRESHOLD) makePeace(world, war, war.b);
  else if (ea >= DIPLO.MUTUAL_THRESHOLD && eb >= DIPLO.MUTUAL_THRESHOLD) makePeace(world, war, -1);
}

export function makePeace(world: World, war: War, loser: number) {
  const d = world.diplo;
  if (loser >= 0) {
    const winner = loser === war.a ? war.b : war.a;
    const losers = settlementsF(world, loser);
    const winners = settlementsF(world, winner);
    const popWinner = winners.reduce((sum, s) => sum + s.population, 0);
    const popLoser = losers.reduce((sum, s) => sum + s.population, 0);

    if ((losers.length === 1 || war.exh[loser] >= 90) && popWinner >= popLoser * DIPLO.VASSAL_POP_RATIO_REQ) {
      // Loser becomes vassal!
      const vassalFac = world.factions[loser];
      vassalFac.vassalOf = winner;
      vassalFac.vassalSince = world.tick;

      // Clear other wars of vassal recursively / cleanly
      for (const otherWar of [...d.wars]) {
        if (otherWar !== war && (otherWar.a === loser || otherWar.b === loser)) {
          makePeace(world, otherWar, -1);
        }
      }

      // Relations boost
      const pk = pairKey(loser, winner);
      d.relations[pk] = 40;

      log(world, `!!! SOVEREIGNTY LOSS !!! ${vassalFac.name} has surrendered their sovereignty and became a vassal of ${world.factions[winner].name}!`);
      pushAlert(world, { type: 'DIPLO', tick: world.tick, targetId: losers[0]?.id, msg: `${vassalFac.name} became a vassal of ${world.factions[winner].name}!` });
    } else {
      if (war.exh[loser] >= DIPLO.SUE_THRESHOLD && war.exh[winner] <= DIPLO.DOMINANT_EXH && losers.length > 1) {
        let bestS = null;
        let bestDist = Infinity;
        for (const ls of losers) {
          for (const ws of winners) {
            const dist = distance(ls.q, ls.r, ws.q, ws.r);
            if (dist < bestDist) {
              bestDist = dist;
              bestS = ls;
            }
          }
        }
        if (bestS) {
          bestS.factionId = winner;
          world.agents = world.agents.filter(a => !(a.factionId === loser && a.q === bestS.q && a.r === bestS.r));
          bestS.siegeHp = null;
          bestS.siegePop0 = null;
          bestS.siegeDeaths = 0;
          log(world, `!!! CESSION !!! ${world.factions[loser].name} ceded ${bestS.name} to ${world.factions[winner].name} in the peace of ${world.tick}!`);
          pushAlert(world, { type: 'DIPLO', tick: world.tick, targetId: bestS.id, msg: `${world.factions[loser].name} ceded ${bestS.name} to ${world.factions[winner].name}!` });
        }
      }

      let total = 0;
      for (const s of losers) {
        if (s.factionId === loser) {
          const pay = s.gold * DIPLO.REPARATIONS; s.gold -= pay; total += pay;
        }
      }
      for (const s of winners) s.gold += total / Math.max(1, winners.length);
      log(world, `${world.factions[loser].name} sued for peace with ${world.factions[winner].name} (${Math.round(total)}g reparations)`);
      pushAlert(world, { type: 'DIPLO', tick: world.tick, targetId: losers[0]?.id, msg: `${world.factions[loser].name} made peace with ${world.factions[winner].name}.` });
    }
  } else {
    log(world, `${world.factions[war.a].name} and ${world.factions[war.b].name} agreed to a white peace`);
    const s = world.settlements.find(s => s.factionId === war.a);
    pushAlert(world, { type: 'DIPLO', tick: world.tick, targetId: s?.id, msg: `${world.factions[war.a].name} and ${world.factions[war.b].name} signed a white peace.` });
  }
  d.wars = d.wars.filter(w => w !== war);
  const pk = pairKey(war.a, war.b);
  d.truces[pk] = world.tick + DIPLO.TRUCE_TICKS;
  d.relations[pk] = DIPLO.PEACE_RELATION;

  // Reset focuses to PEACE when war ends
  for (const fid of [war.a, war.b]) {
    if (!atWarAny(world, fid)) {
      const fac = world.factions.find(f => f.id === fid);
      if (fac) {
        fac.focus = 'PEACE';
        fac.mobilizeTicks = 0;
        fac.mobilizeTarget = null;
      }
    }
  }

  // armies stand down
  for (const a of world.agents) {
    if (a.type === 'soldier' && (a.factionId === war.a || a.factionId === war.b) &&
      (a.mission?.kind === 'march' || a.mission?.kind === 'siege')) {
      cancelMission(world, a);
    }
  }
  for (const s of world.settlements) { s.siegeHp = null; s.siegePop0 = null; s.siegeDeaths = 0; }
}

export function sueForPeace(world: World, war: War, factionId: number) {
  const enemyId = factionId === war.a ? war.b : war.a;
  const myExh = war.exh[factionId];
  const enemyExh = war.exh[enemyId];
  
  // The side with higher exhaustion is considered the loser in the peace treaty.
  // If tied or close, the suer takes the slight disadvantage by being the loser,
  // but if the suer is clearly winning (lower exhaustion), the enemy pays reparations/cedes.
  let loser = factionId;
  if (myExh < enemyExh) {
    loser = enemyId;
  }
  makePeace(world, war, loser);
}
