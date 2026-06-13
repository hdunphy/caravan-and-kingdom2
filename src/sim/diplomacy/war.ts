// ---------- War conduct ----------
import { key, distance } from '../../core/hex.js';
import { DIPLO, ECON, TERRAIN } from '../../core/constants.js';
import { log, controlledHexes } from '../settlement.js';
import { spawnAgent, assignPath, homeOf, cancelMission } from '../agents.js';
import { pairKey, getRelation, addRelation, findWar, atWar, atWarAny, stateOf, hasEmbargo, hasPact, getAllies, canTrade, tradePrice } from './relations.js';
import { soldiersOf, strengthOf, committedStrength, defensiveBlocStats, offensiveBlocStats, settlementDefense, armyCap } from './strength.js';
import { aliveF, traitsF, effectiveAggression, settlementsF, goldF, tierMultiplier } from './helpers.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo } from '../../types.js';

export function declareWar(world: World, attackerId: number, defenderId: number, goalId: number, isInitial = false) {
  if (atWar(world, attackerId, defenderId)) return;

  const pk = pairKey(attackerId, defenderId);
  delete world.diplo.truces[pk];

  if (world.diplo.pacts) {
    world.diplo.pacts = world.diplo.pacts.filter(p => pairKey(p.a, p.b) !== pk);
  }

  world.diplo.wars.push({
    a: attackerId,
    b: defenderId,
    since: world.tick,
    goalId: goalId,
    exh: { [attackerId]: 0, [defenderId]: 0 }
  });

  addRelation(world, attackerId, defenderId, DIPLO.DECLARE_WAR_PENALTY);

  const attFac = world.factions.find(f => f.id === attackerId);
  if (attFac) {
    attFac.focus = 'WAR';
    attFac.mobilizeTicks = 0;
    attFac.mobilizeTarget = null;
  }
  const defFac = world.factions.find(f => f.id === defenderId);
  if (defFac) {
    defFac.focus = 'WAR';
    defFac.mobilizeTicks = 0;
    defFac.mobilizeTarget = null;
  }

  if (isInitial) {
    for (const f of world.factions) {
      if (f.id !== attackerId && f.id !== defenderId && aliveF(world, f.id)) {
        addRelation(world, f.id, attackerId, DIPLO.WARMONGER_PENALTY);
      }
    }
  }

  // Defender's defensive allies join war
  const defenderAllies = getAllies(world, defenderId);
  for (const allyId of defenderAllies) {
    if (allyId !== attackerId && aliveF(world, allyId) && !atWar(world, attackerId, allyId)) {
      log(world, `${world.factions[allyId].name} enters the war to defend their ally ${world.factions[defenderId].name}!`);
      declareWar(world, attackerId, allyId, goalId, false);
    }
  }

  // Master defends vassal
  const defenderMaster = world.factions[defenderId].vassalOf;
  if (defenderMaster !== undefined && aliveF(world, defenderMaster) && !atWar(world, attackerId, defenderMaster)) {
    log(world, `${world.factions[defenderMaster].name} enters the war to defend their vassal ${world.factions[defenderId].name}!`);
    declareWar(world, attackerId, defenderMaster, goalId, false);
  }

  // Vassal joins master's war (attacker side)
  for (const f of world.factions) {
    if (f.vassalOf === attackerId && aliveF(world, f.id) && !atWar(world, f.id, defenderId)) {
      log(world, `${f.name} is dragged into the war to support their overlord ${world.factions[attackerId].name}!`);
      declareWar(world, f.id, defenderId, goalId, false);
    }
  }

  // Vassal joins master's war (defender side)
  for (const f of world.factions) {
    if (f.vassalOf === defenderId && aliveF(world, f.id) && !atWar(world, attackerId, f.id)) {
      log(world, `${f.name} is dragged into the war to defend their overlord ${world.factions[defenderId].name}!`);
      declareWar(world, attackerId, f.id, goalId, false);
    }
  }
}

// ---------- War conduct ----------
export function pickWarGoal(world: World, fid: number, enemyFid: number) {
  const mine = settlementsF(world, fid);
  let best = null, bestScore = Infinity;
  for (const t of settlementsF(world, enemyFid)) {
    const near = Math.min(...mine.map(s => distance(s.q, s.r, t.q, t.r)));
    if (near > DIPLO.STRIKE_RANGE) continue;
    const score = settlementDefense(world, t) + near * 2;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}

export function recruitSoldiers(world: World, fid: number, target: number) {
  let count = soldiersOf(world, fid).length;
  if (count >= target) return;

  const isAtWar = atWarAny(world, fid);
  const maxPerSettlement = isAtWar ? 3 : 1;

  for (const s of settlementsF(world, fid)) {
    if (count >= target) break;
    if (s.population <= 40) continue; // a soldier-company costs real pop; don't hollow out villages
    const c = DIPLO.SOLDIER_COST;
    let recruited = 0;
    while (recruited < maxPerSettlement && count < target && s.population > 40 + DIPLO.SOLDIER_POP_COST) {
      if (s.stock.food >= c.food && s.stock.ore >= c.ore && s.gold >= c.gold) {
        s.stock.food -= c.food; s.stock.ore -= c.ore; s.gold -= c.gold;
        s.population -= DIPLO.SOLDIER_POP_COST;
        spawnAgent(world, 'soldier', fid, s.id, s.q, s.r);
        count++;
        recruited++;
      } else {
        break;
      }
    }
  }
}

export function warCouncil(world: World, war: War, side: string) {
  const enemy = side === war.a ? war.b : war.a;
  const mySettlements = settlementsF(world, side);
  if (mySettlements.length === 0) return;

  // Always recruit up to army cap during war
  recruitSoldiers(world, side, armyCap(world, side));

  const aggr = effectiveAggression(world, side);
  const cap = armyCap(world, side);
  const mySoldiers = soldiersOf(world, side);
  const currentArmy = mySoldiers.length;

  // 1. Staging/Muster Town
  let goal = world.settlements.find(s => s.id === war.goalId);
  if (!goal || goal.factionId === side) {
    goal = pickWarGoal(world, side, enemy);
    if (goal) {
      war.goalId = goal.id;
    }
  }

  let musterTown = null;
  if (goal) {
    let minDist = Infinity;
    for (const s of mySettlements) {
      const d = distance(s.q, s.r, goal.q, goal.r);
      if (d < minDist) {
        minDist = d;
        musterTown = s;
      }
    }
  } else {
    musterTown = mySettlements[0];
  }

  // 2. Primary Operations Scoring
  // MUSTER
  const isBesieged = mySettlements.some(s => s.siegeHp !== null);
  const noUrgentThreat = !isBesieged;
  const score_muster = (1 - currentArmy / cap) * 60 * (noUrgentThreat ? 1.5 : 0.3);

  // DEFEND
  const besiegedSettlement = mySettlements.find(s => s.siegeHp !== null);
  const enemySoldiers = world.agents.filter(a => a.type === 'soldier' && a.factionId === enemy);

  let enemyNearby = false;
  let nearestThreatenedSettlement = null;
  let maxThreatenedTierValue = 0;
  for (const s of mySettlements) {
    const hasEnemyClose = enemySoldiers.some(es => distance(s.q, s.r, es.q, es.r) <= 4);
    if (hasEnemyClose) {
      enemyNearby = true;
      const tierVal = s.tier === 'CITY' ? 3 : (s.tier === 'TOWN' ? 2 : 1);
      if (tierVal > maxThreatenedTierValue) {
        maxThreatenedTierValue = tierVal;
        nearestThreatenedSettlement = s;
      }
    }
  }

  let score_defend = 0;
  let defendTarget = null;
  if (besiegedSettlement) {
    score_defend = 90;
    defendTarget = besiegedSettlement;
  } else if (enemyNearby) {
    score_defend = maxThreatenedTierValue * 15;
    defendTarget = nearestThreatenedSettlement;
  }

  // SIEGE
  const startTown = musterTown || mySettlements[0];
  const targetDist = startTown ? distance(startTown.q, startTown.r, goal ? goal.q : startTown.q, goal ? goal.r : startTown.r) : 99;
  const mustered = currentArmy >= cap * 0.5;
  const targetDefense = goal ? settlementDefense(world, goal) : 1;
  const score_siege = goal ? (strengthOf(world, side) / Math.max(1, targetDefense)) * 30 + (mustered ? 40 : 0) - (targetDist * 2) : 0;

  // 3. Secondary Operations Scoring
  // RAID
  let bestRaidHex = null;
  let bestRaidScore = -Infinity;
  const enemySettlements = settlementsF(world, enemy);
  for (const s of enemySettlements) {
    for (const hex of controlledHexes(world, s)) {
      if (hex.q === s.q && hex.r === s.r) continue;
      let econValue = 0;
      for (const res of ['food', 'timber', 'stone', 'ore']) {
        econValue += hex.resources[res] || 0;
      }
      if (hex.building) econValue += 20;
      if (hex.hasRoad) econValue += 10;
      if (econValue === 0) continue;

      const enemyGarrisonCount = enemySoldiers.filter(es => distance(hex.q, hex.r, es.q, es.r) <= 3).length;
      const score = econValue * 20 / (1 + enemyGarrisonCount);
      if (score > bestRaidScore) {
        bestRaidScore = score;
        bestRaidHex = hex;
      }
    }
  }
  const score_raid = bestRaidHex ? (bestRaidScore + aggr * 10) : 0;

  // INTERCEPT
  let score_intercept = 0;
  let interceptTarget = null;
  const enemiesInOurLand = enemySoldiers.filter(es => {
    const hex = world.hexes.get(es.q + ',' + es.r);
    return hex && hex.owner !== null && world.settlements.find(s => s.id === hex.owner)?.factionId === side;
  });
  const enemiesInTerritory = enemiesInOurLand.length > 0;
  if (enemiesInTerritory) {
    let bestEnemy = null;
    let bestScore = -Infinity;
    for (const es of enemiesInOurLand) {
      const ourSoldiersClose = mySoldiers.filter(a => distance(a.q, a.r, es.q, es.r) <= 5);
      const localStr = ourSoldiersClose.reduce((acc, s) => acc + DIPLO.SOLDIER_STRENGTH * (s.integrity / 100), 0);
      const enemyStr = es.integrity / 100 * DIPLO.SOLDIER_STRENGTH;
      const strRatio = enemyStr > 0 ? (localStr / enemyStr) : 10;
      const score = strRatio * 40;
      if (score > bestScore) {
        bestScore = score;
        bestEnemy = es;
      }
    }
    score_intercept = bestScore;
    interceptTarget = bestEnemy;
  }

  // 4. Demobilize
  const exhaustion = war.exh[side];
  const score_demobilize = (exhaustion / DIPLO.SUE_THRESHOLD) * 50 - (aggr * 15);

  // 5. Operation Selection
  let primaryOp = 'MUSTER';
  let primaryScore = score_muster;
  let primaryTarget = musterTown;

  if (score_defend > primaryScore) {
    primaryOp = 'DEFEND';
    primaryScore = score_defend;
    primaryTarget = defendTarget;
  }
  if (score_siege > primaryScore) {
    primaryOp = 'SIEGE';
    primaryScore = score_siege;
    primaryTarget = goal;
  }

  let secondaryOp = 'NONE';
  let secondaryScore = 0;
  let secondaryTarget = null;

  if (score_raid > score_intercept) {
    if (score_raid >= 15) {
      secondaryOp = 'RAID';
      secondaryScore = score_raid;
      secondaryTarget = bestRaidHex;
    }
  } else {
    if (score_intercept >= 15) {
      secondaryOp = 'INTERCEPT';
      secondaryScore = score_intercept;
      secondaryTarget = interceptTarget;
    }
  }

  if (score_demobilize > primaryScore && score_demobilize > secondaryScore) {
    primaryOp = 'DEMOBILIZE';
    primaryTarget = null;
    secondaryOp = 'NONE';
    secondaryTarget = null;
  }

  // Save chosen orders
  if (!war.orders) war.orders = {};
  war.orders[side] = {
    primary: { op: primaryOp, targetId: primaryTarget ? primaryTarget.id : null, tq: primaryTarget ? primaryTarget.q : null, tr: primaryTarget ? primaryTarget.r : null },
    secondary: { op: secondaryOp, targetId: secondaryTarget ? (secondaryTarget.id || null) : null, tq: secondaryTarget ? secondaryTarget.q : null, tr: secondaryTarget ? secondaryTarget.r : null }
  };

  // Logging
  let targetName = "";
  if (primaryOp === 'SIEGE' && goal) targetName = goal.name;
  else if (primaryOp === 'DEFEND' && primaryTarget) targetName = primaryTarget.name;
  else if (primaryOp === 'MUSTER' && musterTown) targetName = musterTown.name;

  let secondaryTargetName = "";
  if (secondaryOp === 'RAID' && bestRaidHex) {
    const ownerS = bestRaidHex.owner !== null ? world.settlements.find(s => s.id === bestRaidHex.owner) : null;
    secondaryTargetName = `${TERRAIN[bestRaidHex.terrain]?.name || 'land'} near ${ownerS ? ownerS.name : 'unknown'}`;
  } else if (secondaryOp === 'INTERCEPT' && interceptTarget) {
    secondaryTargetName = `enemy near (${interceptTarget.q},${interceptTarget.r})`;
  }

  log(world, `${world.factions[side].name} War Council orders: ${primaryOp} ${targetName} ${secondaryOp !== 'NONE' ? `| ${secondaryOp} ${secondaryTargetName}` : ''}`);

  // 6. Task Force Assignment
  const freeSoldiers = mySoldiers.filter(s => {
    const committed = s.engagedSince !== null && (world.tick - s.engagedSince) < DIPLO.COMBAT_COMMIT_TICKS;
    return !committed;
  });

  let secondarySoldiers = [];
  if (secondaryOp === 'RAID' && bestRaidHex) {
    const candidates = freeSoldiers.filter(s => s.state !== 'siege');
    candidates.sort((a, b) => distance(a.q, a.r, bestRaidHex.q, bestRaidHex.r) - distance(b.q, b.r, bestRaidHex.q, bestRaidHex.r));
    secondarySoldiers = candidates.slice(0, 3);
    for (const s of secondarySoldiers) {
      if (assignPath(world, s, bestRaidHex.q, bestRaidHex.r)) {
        s.mission = { kind: 'raid', tq: bestRaidHex.q, tr: bestRaidHex.r };
      }
    }
  } else if (secondaryOp === 'INTERCEPT' && interceptTarget) {
    const candidates = freeSoldiers.filter(s => s.state !== 'siege');
    candidates.sort((a, b) => distance(a.q, a.r, interceptTarget.q, interceptTarget.r) - distance(b.q, b.r, interceptTarget.q, interceptTarget.r));
    secondarySoldiers = candidates.slice(0, 3);
    for (const s of secondarySoldiers) {
      if (assignPath(world, s, interceptTarget.q, interceptTarget.r)) {
        s.mission = { kind: 'intercept', tq: interceptTarget.q, tr: interceptTarget.r };
      }
    }
  }

  const remainingSoldiers = freeSoldiers.filter(s => !secondarySoldiers.includes(s));
  const garrisonTarget = Math.round(DIPLO.GARRISON_PEACE * (aggr >= 1.2 ? 2 : 1));
  const keptCount = new Map();

  if (primaryOp === 'DEFEND' && defendTarget) {
    for (const s of remainingSoldiers) {
      if (s.q !== defendTarget.q || s.r !== defendTarget.r) {
        if (assignPath(world, s, defendTarget.q, defendTarget.r)) {
          s.mission = { kind: 'march', targetId: defendTarget.id, tq: defendTarget.q, tr: defendTarget.r };
        }
      }
    }
  } else if (primaryOp === 'MUSTER' && musterTown) {
    for (const s of remainingSoldiers) {
      if (s.q === musterTown.q && s.r === musterTown.r) {
        s.mission = { kind: 'muster', tq: musterTown.q, tr: musterTown.r };
        continue;
      }
      const k = keptCount.get(s.homeId) ?? 0;
      if (s.q === homeOf(world, s)?.q && s.r === homeOf(world, s)?.r && k < garrisonTarget) {
        keptCount.set(s.homeId, k + 1);
        cancelMission(world, s);
        continue;
      }
      if (assignPath(world, s, musterTown.q, musterTown.r)) {
        s.mission = { kind: 'muster', tq: musterTown.q, tr: musterTown.r };
      }
    }
  } else if (primaryOp === 'SIEGE' && goal) {
    for (const s of remainingSoldiers) {
      if (s.state === 'siege' && s.mission?.targetId === goal.id) {
        continue;
      }
      const k = keptCount.get(s.homeId) ?? 0;
      if (s.q === homeOf(world, s)?.q && s.r === homeOf(world, s)?.r && k < garrisonTarget) {
        keptCount.set(s.homeId, k + 1);
        cancelMission(world, s);
        continue;
      }
      if (assignPath(world, s, goal.q, goal.r)) {
        s.mission = { kind: 'march', targetId: goal.id, tq: goal.q, tr: goal.r };
      }
    }
  } else if (primaryOp === 'DEMOBILIZE') {
    for (const s of remainingSoldiers) {
      cancelMission(world, s);
    }
  }
}

