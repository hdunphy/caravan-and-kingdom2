// ---------- The Court ----------
// The faction-level brain, meeting every DIPLO.INTERVAL ticks.
import { key, distance } from '../../core/hex.js';
import { DIPLO, ECON, TERRAIN } from '../../core/constants.js';
import { log, deposit, controlledHexes, storageCap } from '../settlement.js';
import { spawnAgent, assignPath, homeOf, cancelMission } from '../agents.js';
import { findColonySite } from '../governors.js';
import { pairKey, getRelation, addRelation, findWar, atWar, atWarAny, stateOf, hasEmbargo, hasPact, getAllies, canTrade, tradePrice } from './relations.js';
import { soldiersOf, strengthOf, committedStrength, defensiveBlocStats, offensiveBlocStats, settlementDefense, armyCap } from './strength.js';
import { aliveF, traitsF, effectiveAggression, settlementsF, goldF, tierMultiplier } from './helpers.js';
import { declareWar, pickWarGoal, recruitSoldiers, warCouncil } from './war.js';
import { checkPeace, makePeace } from './peace.js';
import { manageGarrison, considerGift } from './peacetime.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

export function courtSystem(world: World) {
  if (!world.diplo || world.tick % DIPLO.INTERVAL !== 0 || world.tick === 0) return;
  const d = world.diplo;

  // Clean up expired pacts
  d.pacts = (d.pacts ?? []).filter((p: any) => {
    const active = p.expires > world.tick;
    if (!active) {
      d.pactCooldowns = d.pactCooldowns ?? {};
      d.pactCooldowns[pairKey(p.a, p.b)] = world.tick + DIPLO.PACT_COOLDOWN;
      log(world, `The Defensive Pact between ${world.factions[p.a].name} and ${world.factions[p.b].name} has expired.`);
    }
    return active;
  });

  // 1. Trade since last session warms relations
  for (const k of Object.keys(d.tradeCounts).sort()) {
    const [a, b] = k.split('|').map(Number);
    addRelation(world, a, b, d.tradeCounts[k] * DIPLO.TRADE_RELATION);
  }
  d.tradeCounts = {};

  // 2. Border friction + forgiveness drift
  const n = world.factions.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (!aliveF(world, a) || !aliveF(world, b)) continue;
    let crowded = 0;
    for (const sa of settlementsF(world, a))
      for (const sb of settlementsF(world, b))
        if (distance(sa.q, sa.r, sb.q, sb.r) <= DIPLO.BORDER_RANGE) crowded++;
    const inTruce = (world.diplo.truces[pairKey(a, b)] ?? 0) > world.tick;
    if (crowded > 0 && !inTruce) addRelation(world, a, b, DIPLO.BORDER_FRICTION * crowded);
    const r = getRelation(world, a, b);
    if (r !== 0 && !atWar(world, a, b)) {
      addRelation(world, a, b, Math.sign(-r) * Math.min(DIPLO.DRIFT, Math.abs(r)));
    }

    // Common Threat relation warming
    if (!atWar(world, a, b)) {
      let commonThreatBonus = 0;
      for (let t = 0; t < n; t++) {
        if (t === a || t === b || !aliveF(world, t)) continue;
        const warA = atWar(world, a, t);
        const warB = atWar(world, b, t);
        if (warA && warB) {
          commonThreatBonus += 8;
        } else {
          const relA = getRelation(world, a, t);
          const relB = getRelation(world, b, t);
          if (relA <= -30 && relB <= -30) {
            commonThreatBonus += 3;
          }
        }
      }
      if (commonThreatBonus > 0) {
        addRelation(world, a, b, commonThreatBonus);
      }
    }

    // Defensive Pact & Embargo Checks
    const curR = getRelation(world, a, b);
    const inCooldown = world.tick < (d.pactCooldowns?.[pairKey(a, b)] ?? 0);
    const isVassalA = world.factions[a].vassalOf !== undefined;
    const isVassalB = world.factions[b].vassalOf !== undefined;

    // Sign Defensive Pact
    if (curR >= DIPLO.PACT_RELATION_REQ && !hasPact(world, a, b) && !inCooldown && !isVassalA && !isVassalB && !atWarAny(world, a) && !atWarAny(world, b)) {
      if (world.rng.chance(0.15)) {
        d.pacts = d.pacts ?? [];
        d.pacts.push({ a, b, expires: world.tick + DIPLO.PACT_DURATION });
        log(world, `${world.factions[a].name} and ${world.factions[b].name} signed a Defensive Pact for ${DIPLO.PACT_DURATION} ticks.`);
      }
    }

    // Trade Embargo
    const hasEmb = hasEmbargo(world, a, b);
    if (curR <= DIPLO.EMBARGO_RELATION_REQ && !hasEmb && !atWar(world, a, b)) {
      d.embargoes = d.embargoes ?? [];
      d.embargoes.push(pairKey(a, b));
      log(world, `${world.factions[a].name} declared a Trade Embargo against ${world.factions[b].name}!`);

      // Cancel existing trade caravans between a and b!
      for (const agent of world.agents) {
        if ((agent.type === 'villager' || agent.type === 'caravan') && agent.mission && (agent.mission.kind === 'trade' || agent.mission.kind === 'export')) {
          const home = homeOf(world, agent);
          if (home) {
            const isBetween = (agent.factionId === a && agent.mission?.destId && world.settlements.find(s => s.id === agent.mission!.destId)?.factionId === b) ||
              (agent.factionId === b && agent.mission?.destId && world.settlements.find(s => s.id === agent.mission!.destId)?.factionId === a);
            if (isBetween) {
              cancelMission(world, agent);
            }
          }
        }
      }
    } else if (curR >= DIPLO.EMBARGO_LIFT_RELATION && hasEmb) {
      d.embargoes = d.embargoes.filter((k: any) => k !== pairKey(a, b));
      log(world, `${world.factions[a].name} lifted the Trade Embargo against ${world.factions[b].name}.`);
    }
  }

  // Thucydides Trap (threat modifier based on population share)
  const totalPop = world.settlements.reduce((sum, s) => sum + s.population, 0);
  if (totalPop > 0) {
    for (let a = 0; a < n; a++) {
      if (!aliveF(world, a)) continue;
      const popA = settlementsF(world, a).reduce((sum, s) => sum + s.population, 0);
      const share = popA / totalPop;
      if (share > DIPLO.THUCYDIDES_THRESHOLD) {
        const penalty = (share - DIPLO.THUCYDIDES_THRESHOLD) * DIPLO.THUCYDIDES_PENALTY_MULT;
        for (let b = 0; b < n; b++) {
          if (b !== a && aliveF(world, b)) {
            addRelation(world, a, b, penalty);
          }
        }
      }
    }
  }

  // 3. Wars: exhaustion accrual + peace checks
  for (const war of [...d.wars]) {
    for (const side of [war.a, war.b]) {
      const aggr = effectiveAggression(world, side);
      const warDuration = world.tick - war.since;
      const rate = DIPLO.EXH_TICK * Math.pow(DIPLO.EXH_GROWTH, warDuration / DIPLO.EXH_GROWTH_INTERVAL);
      war.exh[side] += (rate * DIPLO.INTERVAL) / aggr;
      if (goldF(world, side) <= 1) war.exh[side] += DIPLO.EXH_BROKE * DIPLO.INTERVAL;
    }

    let capitulated = false;
    for (const [side, other] of [[war.a, war.b], [war.b, war.a]]) {
      if (war.exh[side] >= 90) {
        const winnerPop = settlementsF(world, other).reduce((s, t) => s + t.population, 0);
        const loserPop = settlementsF(world, side).reduce((s, t) => s + t.population, 0);
        if (winnerPop >= loserPop * DIPLO.VASSAL_POP_RATIO_REQ) {
          makePeace(world, war, side); // collapses into vassalization path
          capitulated = true;
          break;
        }
      }
    }
    if (!capitulated) checkPeace(world, war);
  }

  // 4. Conduct ongoing wars via the War Council
  for (const war of d.wars) {
    if (aliveF(world, war.a)) warCouncil(world, war, war.a);
    if (aliveF(world, war.b)) warCouncil(world, war, war.b);
  }

  // Update stagnation dynamic aggression
  for (const fac of world.factions) {
    const fid = fac.id;
    if (!aliveF(world, fid)) continue;
    fac.stagnationAggression = fac.stagnationAggression ?? 0;
    const t = traitsF(world, fid);
    let isBoxedIn = false;
    const mySettlements = settlementsF(world, fid);
    let wantToExpand = false;
    let canExpand = false;
    for (const s of mySettlements) {
      if (s.population >= ECON.EXPAND_MIN_POP / t.expand) {
        wantToExpand = true;
        if (findColonySite(world, s)) {
          canExpand = true;
          break;
        }
      }
    }
    if (wantToExpand && !canExpand) {
      isBoxedIn = true;
    }
    if (isBoxedIn) {
      fac.stagnationAggression = Math.min(
        DIPLO.STAGNATION_AGGR_MAX,
        fac.stagnationAggression + DIPLO.STAGNATION_AGGR_INC
      );
    } else {
      fac.stagnationAggression = Math.max(0, fac.stagnationAggression - 0.02);
    }
  }

  // Initialize focuses
  for (const fac of world.factions) {
    fac.focus = fac.focus ?? 'PEACE';
    fac.mobilizeTicks = fac.mobilizeTicks ?? 0;
  }

  // 5. Peacetime business & Focus management, in faction order
  for (const fac of world.factions) {
    const fid = fac.id;
    if (!aliveF(world, fid)) continue;
    if (fac.vassalOf !== undefined) continue; // Vassals do not mobilize or declare wars independently

    // If we are at war, force WAR focus
    if (atWarAny(world, fid)) {
      fac.focus = 'WAR';
      fac.mobilizeTicks = 0;
      fac.mobilizeTarget = null;
      // During war, keep recruiting up to wartime target
      const aggr = effectiveAggression(world, fid);
      recruitSoldiers(world, fid, armyCap(world, fid));
    }

    // Check for opportunistic attacks (if we are opportunistic, at peace, and see a significantly weaker neighbor/bloc)
    const traits = traitsF(world, fid);
    if (traits.opportunistic) {
      let declaredOpp = false;
      for (const other of world.factions) {
        const b = other.id;
        if (b === fid || !aliveF(world, b) || atWar(world, fid, b)) continue;
        if ((world.diplo.truces[pairKey(fid, b)] ?? 0) > world.tick) continue;

        const myBloc = offensiveBlocStats(world, fid);
        const enemyBloc = defensiveBlocStats(world, b);
        const myEffective = Math.max(0, myBloc.strength - myBloc.committed);
        const oppFactor = Math.max(0, Math.min(1, traits.aggression - 0.5));
        const enemyEffective = Math.max(0, enemyBloc.strength - enemyBloc.committed * oppFactor);

        if (myBloc.pop > enemyBloc.pop * 1.5 && myEffective > enemyEffective * 1.5) {
          // Proximity check (at least one settlement within range 15)
          let near = false;
          for (const sa of settlementsF(world, fid)) {
            for (const sb of settlementsF(world, b)) {
              if (distance(sa.q, sa.r, sb.q, sb.r) <= 15) {
                near = true;
                break;
              }
            }
            if (near) break;
          }

          if (near) {
            const aggr = effectiveAggression(world, fid);
            if (world.rng.chance(0.08 * aggr)) {
              const goal = pickWarGoal(world, fid, b);
              if (goal) {
                log(world, `${world.factions[fid].name} launched an OPPORTUNISTIC invasion of ${world.factions[b].name}! The world is outraged!`);
                declareWar(world, fid, b, goal.id, false);
                addRelation(world, fid, b, -50); // backstab penalty
                for (const f of world.factions) {
                  if (f.id !== fid && f.id !== b && aliveF(world, f.id)) {
                    addRelation(world, f.id, fid, -60); // outrage
                  }
                }
                declaredOpp = true;
                break;
              }
            }
          }
        }
      }
      if (declaredOpp) {
        recruitSoldiers(world, fid, armyCap(world, fid));
        continue;
      }
    }

    // Find any hostile threats we want to fight
    let bestThreat = null;
    let worstRelation = DIPLO.WAR_RELATION; // relation must be < this to count as threat
    for (const other of world.factions) {
      const b = other.id;
      //TODO: does this check if we are at war then don't look
      if (b === fid || !aliveF(world, b) || atWar(world, fid, b)) continue;
      const rel = getRelation(world, fid, b);
      if (rel < worstRelation) {
        if ((world.diplo.truces[pairKey(fid, b)] ?? 0) > world.tick) continue;
        worstRelation = rel;
        bestThreat = b;
      }
    }

    if (bestThreat !== null) {
      const aggr = effectiveAggression(world, fid);
      const army = armyCap(world, fid);
      const activeWars = world.diplo.wars.filter(w => w.a === fid || w.b === fid).length;
      const requiredWarChest = army * DIPLO.WAGE_SOLDIER * 1500 * (activeWars + 1);
      const currentGold = goldF(world, fid);

      const myBloc = offensiveBlocStats(world, fid);
      const enemyBloc = defensiveBlocStats(world, bestThreat);
      const myEffective = Math.max(0, myBloc.strength - myBloc.committed);
      const oppFactor = Math.max(0, Math.min(1, traitsF(world, fid).aggression - 0.5));
      const enemyEffective = Math.max(0, enemyBloc.strength - enemyBloc.committed * oppFactor);
      const strongEnough = myEffective > enemyEffective * (DIPLO.ADVANTAGE / aggr);
      const readyForWar = strongEnough && (currentGold >= requiredWarChest || myEffective > enemyEffective * 1.8);

      if (readyForWar) {
        const goal = pickWarGoal(world, fid, bestThreat);
        if (goal && world.rng.chance(0.3 * aggr)) {
          log(world, `${world.factions[fid].name} declared WAR on ${world.factions[bestThreat].name}!`);
          declareWar(world, fid, bestThreat, goal.id, true);
          continue;
        }
      }

      // If we are not ready, enter/stay in MOBILIZE
      fac.focus = 'MOBILIZE';
      fac.mobilizeTarget = bestThreat;
      fac.mobilizeTicks += DIPLO.INTERVAL;

      // During mobilization, recruit up to wartime target
      recruitSoldiers(world, fid, Math.round(army));

      // Loop prevention check: force declaration or stand down
      if (fac.mobilizeTicks >= DIPLO.MOBILIZE_LIMIT) {
        if (aggr >= 1.2) {
          const goal = pickWarGoal(world, fid, bestThreat);
          if (goal) {
            log(world, `${world.factions[fid].name} grew impatient and declared WAR on ${world.factions[bestThreat].name}!`);
            declareWar(world, fid, bestThreat, goal.id, true);
          }
        } else {
          log(world, `${world.factions[fid].name} demobilized and cooled tensions with ${world.factions[bestThreat].name}`);
          fac.focus = 'PEACE';
          fac.mobilizeTicks = 0;
          fac.mobilizeTarget = null;
          addRelation(world, fid, bestThreat, 15); // diplomatic relief/cooling-off
          manageGarrison(world, fid);
          considerGift(world, fid);
        }
      }
    } else {
      fac.focus = 'PEACE';
      fac.mobilizeTicks = 0;
      fac.mobilizeTarget = null;
      manageGarrison(world, fid);
      considerGift(world, fid);
    }
  }

  // 5b. Vassal mechanics: tribute, annexation, and independence checks
  for (const fac of world.factions) {
    const fid = fac.id;
    if (!aliveF(world, fid) || fac.vassalOf === undefined) continue;

    const masterId = fac.vassalOf;
    const masterFac = world.factions[masterId];
    if (!masterFac || masterFac.eliminated) {
      log(world, `${fac.name}'s overlord has fallen. They regain their independence!`);
      delete fac.vassalOf;
      continue;
    }

    // A. Check for Independence War
    const mySettlements = settlementsF(world, fid);
    const masterSettlements = settlementsF(world, masterId);
    const myPop = mySettlements.reduce((sum, s) => sum + s.population, 0);
    const masterPop = masterSettlements.reduce((sum, s) => sum + s.population, 0);
    const rel = getRelation(world, fid, masterId);

    const stronger = mySettlements.length > masterSettlements.length;
    const hostileAndPop = (myPop >= masterPop * DIPLO.VASSAL_INDEPENDENCE_POP_RATIO) && (rel <= -30);

    if (stronger || hostileAndPop) {
      log(world, `!!! REBELLION !!! ${fac.name} has declared a WAR OF INDEPENDENCE against their overlord, ${masterFac.name}!`);
      delete fac.vassalOf;
      const goal = masterSettlements[0];
      if (goal) {
        declareWar(world, fid, masterId, goal.id, true);
      }
      continue;
    }

    if (world.tick - (fac.vassalSince ?? 0) >= DIPLO.VASSAL_ANNEX_TICKS && masterPop >= myPop * 3.0) {
      log(world, `!!! ANNEXATION !!! ${fac.name} has been fully integrated into the realm of ${masterFac.name}!`);
      for (const s of mySettlements) s.factionId = masterId;
      world.agents = world.agents.filter(a => a.factionId !== fid);
      fac.eliminated = true;
      world.diplo.wars = world.diplo.wars.filter(w => w.a !== fid && w.b !== fid);
      continue;
    }

    // B. Tribute payment & Annexation (faction-level, not per-settlement)
    if (masterSettlements.length > 0) {
      const masterSettlement = masterSettlements[0];

      // Sum total gold across all vassal settlements
      const totalFactionGold = mySettlements.reduce((sum, s) => sum + s.gold, 0);
      const totalTribute = Math.floor(totalFactionGold * DIPLO.VASSAL_TRIBUTE_PCT);

      if (totalFactionGold < 20) {
        // Faction as a whole cannot pay — annexation
        log(world, `!!! ANNEXATION !!! ${fac.name} was unable to pay tribute. They have forfeited their lands and been annexed by ${masterFac.name}!`);
        for (const s of mySettlements) s.factionId = masterId;   // ALL settlements
        world.agents = world.agents.filter(a => a.factionId !== fid);
        fac.eliminated = true;
        world.diplo.wars = world.diplo.wars.filter(w => w.a !== fid && w.b !== fid);
      } else if (totalTribute > 0) {
        // Collect proportionally from each settlement so no single town is drained
        for (const s of mySettlements) {
          const share = Math.floor((s.gold / totalFactionGold) * totalTribute);
          s.gold -= share;
          masterSettlement.gold += share;
        }
        log(world, `${fac.name} paid ${totalTribute}g tribute to their overlord, ${masterFac.name}.`);
      }
    }
  }

  // 6. Return displaced idle soldiers home (only if not at war)
  for (const a of world.agents) {
    if (a.type === 'soldier' && a.state === 'idle' && !atWarAny(world, a.factionId)) {
      const home = homeOf(world, a);
      if (home && (a.q !== home.q || a.r !== home.r)) {
        const curSettlement = world.settlements.find(s => s.q === a.q && s.r === a.r);
        if (!curSettlement || curSettlement.siegeHp === null) {
          cancelMission(world, a);
        }
      }
    }
  }
}

