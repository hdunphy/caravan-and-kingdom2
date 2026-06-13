// Diplomacy: faction courts, relations, war, and peace (see DIPLOMACY_DESIGN.md).
// The Court is the faction-level brain, meeting every DIPLO.INTERVAL ticks.
// All iteration is in fixed order and all chance goes through world.rng,
// preserving headless determinism.
import { key, distance } from '../core/hex.js';
import { DIPLO, ECON, DEFAULT_TRAITS, TERRAIN } from '../core/constants.js';
import { log, deposit, controlledHexes, storageCap } from './settlement.js';
import { spawnAgent, assignPath, homeOf, cancelMission } from './agents.js';
import { findColonySite } from './governors.js';

// ---------- Relations ----------
export const pairKey = (a, b) => Math.min(a, b) + '|' + Math.max(a, b);

export function getRelation(world, a, b) {
  if (a === b) return 100;
  return world.diplo.relations[pairKey(a, b)] ?? 0;
}

export function addRelation(world, a, b, delta) {
  const k = pairKey(a, b);
  const v = (world.diplo.relations[k] ?? 0) + delta;
  world.diplo.relations[k] = Math.max(-100, Math.min(100, v));
}

export function findWar(world, a, b) {
  return world.diplo.wars.find(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)) ?? null;
}
export function atWar(world, a, b) { return !!findWar(world, a, b); }
export function atWarAny(world, a) { return world.diplo.wars.some(w => w.a === a || w.b === a); }

export function stateOf(world, a, b) {
  if (a === b) return 'SELF';
  if (atWar(world, a, b)) return 'WAR';
  if ((world.diplo.truces[pairKey(a, b)] ?? 0) > world.tick) return 'TRUCE';
  const r = getRelation(world, a, b);
  if (r >= DIPLO.FRIENDLY) return 'FRIENDLY';
  if (r <= DIPLO.HOSTILE) return 'HOSTILE';
  return 'NEUTRAL';
}

// Trade missions may only run between factions in decent standing or during a truce
export function hasEmbargo(world, a, b) {
  if (!world.diplo || !world.diplo.embargoes) return false;
  return world.diplo.embargoes.includes(pairKey(a, b));
}

export function hasPact(world, a, b) {
  if (!world.diplo || !world.diplo.pacts) return false;
  const pk = pairKey(a, b);
  return world.diplo.pacts.some(p => pairKey(p.a, p.b) === pk);
}

export function getAllies(world, fid) {
  if (!world.diplo || !world.diplo.pacts) return [];
  const allies = [];
  for (const p of world.diplo.pacts) {
    if (p.a === fid) allies.push(p.b);
    else if (p.b === fid) allies.push(p.a);
  }
  return allies;
}

export function canTrade(world, a, b) {
  if (a === b) return true;
  if (hasEmbargo(world, a, b)) return false;
  const st = stateOf(world, a, b);
  return st === 'NEUTRAL' || st === 'FRIENDLY' || st === 'TRUCE';
}
export function tradePrice(world, a, b) {
  const st = stateOf(world, a, b);
  if (st === 'SELF') return 0;
  return st === 'FRIENDLY' ? DIPLO.FRIENDLY_PRICE : ECON.TRADE_PRICE;
}

// ---------- Strength ----------
const aliveF = (world, fid) => !world.factions[fid].eliminated;
const traitsF = (world, fid) => world.factions[fid]?.traits ?? DEFAULT_TRAITS;
const effectiveAggression = (world, fid) => (traitsF(world, fid).aggression ?? 1) + (world.factions[fid]?.stagnationAggression ?? 0);
const settlementsF = (world, fid) => world.settlements.filter(s => s.factionId === fid);
const goldF = (world, fid) => settlementsF(world, fid).reduce((a, s) => a + s.gold, 0);
const tierMultiplier = (tier) => {
  if (tier === 'TOWN') return 1.5;
  if (tier === 'CITY') return 2.2;
  return 1.0;
};

export function soldiersOf(world, fid) {
  return world.agents.filter(a => a.factionId === fid && a.type === 'soldier');
}
export function strengthOf(world, fid) {
  return soldiersOf(world, fid).reduce((a, s) => a + DIPLO.SOLDIER_STRENGTH * s.integrity / 100, 0);
}

export function committedStrength(world, fid) {
  let c = 0;
  for (const w of world.diplo.wars) {
    if (w.a !== fid && w.b !== fid) continue;
    const enemy = w.a === fid ? w.b : w.a;
    c += strengthOf(world, enemy) * DIPLO.COMMIT_FACTOR;
  }
  return c;
}

export function defensiveBlocStats(world, fid) {
  const members = new Set([fid]);
  const masterId = world.factions[fid].vassalOf;
  if (masterId !== undefined && aliveF(world, masterId)) {
    members.add(masterId);
  }
  const allies = getAllies(world, fid);
  for (const allyId of allies) {
    if (aliveF(world, allyId)) {
      members.add(allyId);
    }
  }
  let totalPop = 0;
  let totalStr = 0;
  let totalCommitted = 0;
  for (const mId of members) {
    totalPop += settlementsF(world, mId).reduce((sum, s) => sum + s.population, 0);
    totalStr += strengthOf(world, mId);
    totalCommitted += committedStrength(world, mId);
  }
  return { pop: totalPop, strength: totalStr, committed: totalCommitted };
}

export function offensiveBlocStats(world, fid) {
  const members = new Set([fid]);
  for (const f of world.factions) {
    if (f.vassalOf === fid && aliveF(world, f.id)) {
      members.add(f.id);
    }
  }
  let totalPop = 0;
  let totalStr = 0;
  let totalCommitted = 0;
  for (const mId of members) {
    totalPop += settlementsF(world, mId).reduce((sum, s) => sum + s.population, 0);
    totalStr += strengthOf(world, mId);
    totalCommitted += committedStrength(world, mId);
  }
  return { pop: totalPop, strength: totalStr, committed: totalCommitted };
}
export function settlementDefense(world, s) {
  const militia = s.population * DIPLO.MILITIA_PER_POP;
  const garrison = world.agents
    .filter(a => a.type === 'soldier' && a.factionId === s.factionId && a.state === 'idle' &&
      a.q === s.q && a.r === s.r)
    .reduce((acc, a) => acc + DIPLO.SOLDIER_STRENGTH * a.integrity / 100, 0);
  return militia + garrison;
}

// Army size scales with faction population so accumulated demographic
// advantage can finally be expressed on the battlefield. Fielding the cap
// also costs real pop (SOLDIER_POP_COST), so a big army eats the very
// advantage that justified it.
export function armyCap(world, fid) {
  const pop = settlementsF(world, fid).reduce((a, s) => a + s.population, 0);
  const aggr = traitsF(world, fid).aggression ?? 1;
  return Math.max(DIPLO.ARMY_MIN, Math.round((pop / DIPLO.POP_PER_SOLDIER) * (0.7 + 0.3 * aggr)));
}

// ---------- The Court ----------
export function courtSystem(world) {
  if (!world.diplo || world.tick % DIPLO.INTERVAL !== 0 || world.tick === 0) return;
  const d = world.diplo;

  // Clean up expired pacts
  d.pacts = (d.pacts ?? []).filter(p => {
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
            const isBetween = (agent.factionId === a && agent.mission.destId && world.settlements.find(s => s.id === agent.mission.destId)?.factionId === b) ||
              (agent.factionId === b && agent.mission.destId && world.settlements.find(s => s.id === agent.mission.destId)?.factionId === a);
            if (isBetween) {
              cancelMission(world, agent);
            }
          }
        }
      }
    } else if (curR >= DIPLO.EMBARGO_LIFT_RELATION && hasEmb) {
      d.embargoes = d.embargoes.filter(k => k !== pairKey(a, b));
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

// ---------- Peace ----------
function checkPeace(world, war) {
  const ea = war.exh[war.a], eb = war.exh[war.b];
  if (ea >= DIPLO.SUE_THRESHOLD && eb >= DIPLO.SUE_THRESHOLD) makePeace(world, war, ea >= eb ? war.a : war.b);
  else if (ea >= DIPLO.SUE_THRESHOLD) makePeace(world, war, war.a);
  else if (eb >= DIPLO.SUE_THRESHOLD) makePeace(world, war, war.b);
  else if (ea >= DIPLO.MUTUAL_THRESHOLD && eb >= DIPLO.MUTUAL_THRESHOLD) makePeace(world, war, -1);
}

export function makePeace(world, war, loser) {
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
    }
  } else {
    log(world, `${world.factions[war.a].name} and ${world.factions[war.b].name} agreed to a white peace`);
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

export function declareWar(world, attackerId, defenderId, goalId, isInitial = false) {
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
function pickWarGoal(world, fid, enemyFid) {
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

function recruitSoldiers(world, fid, target) {
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

function warCouncil(world, war, side) {
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

// ---------- Peacetime ----------
function manageGarrison(world, fid) {
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

function considerGift(world, fid) {
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

// ---------- Combat (every tick) ----------
export function combatSystem(world) {
  if (!world.diplo) return;
  const settlementById = new Map(world.settlements.map(s => [s.id, s]));
  healAndAttrition(world);

  // Decay burn markers on all hexes
  for (const hex of world.hexes.values()) {
    if (hex.burnTicks && hex.burnTicks > 0) {
      hex.burnTicks--;
    }
  }

  // Reset engaged flag on all soldiers (recomputed each tick)
  for (const a of world.agents) {
    if (a.type === 'soldier') a.engaged = false;
  }

  if (world.diplo.wars.length === 0) return;

  // --- Field battles: soldiers on the same hex fight ---
  const hexBuckets = new Map();
  for (const a of world.agents) {
    if (a.type !== 'soldier') continue;
    const k = a.q + ',' + a.r;
    if (!hexBuckets.has(k)) hexBuckets.set(k, []);
    hexBuckets.get(k).push(a);
  }

  const fieldDead = [];
  const nextActiveBattles = {};

  for (const [hk, soldiers] of [...hexBuckets.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    // Collect distinct factions at this hex
    const factions = [...new Set(soldiers.map(s => s.factionId))];
    if (factions.length < 2) continue;

    let hasWar = false;
    for (let i = 0; i < factions.length; i++) {
      for (let j = i + 1; j < factions.length; j++) {
        if (atWar(world, factions[i], factions[j])) {
          hasWar = true;
          break;
        }
      }
      if (hasWar) break;
    }
    if (!hasWar) continue;

    nextActiveBattles[hk] = factions;

    // For each pair of factions at war, resolve field damage
    for (let i = 0; i < factions.length; i++) {
      for (let j = i + 1; j < factions.length; j++) {
        const fa = factions[i], fb = factions[j];
        if (!atWar(world, fa, fb)) continue;

        const hex = world.hexes.get(hk);
        const sideA = soldiers.filter(s => s.factionId === fa);
        const sideB = soldiers.filter(s => s.factionId === fb);

        // Apply a 1.3x defensive strength bonus on friendly-owned hexes
        // and local force concentration multiplier for the larger local force
        const countA = sideA.length;
        const countB = sideB.length;
        const concentrationMultA = countA > countB ? Math.min(1.5, Math.sqrt(countA / countB)) : 1.0;
        const concentrationMultB = countB > countA ? Math.min(1.5, Math.sqrt(countB / countA)) : 1.0;

        const strA = sideA.reduce((acc, s) => {
          const ownerS = hex && hex.owner !== null ? settlementById.get(hex.owner) : null;
          const mult = (ownerS && ownerS.factionId === fa ? 1.3 : 1.0) * concentrationMultA;
          return acc + DIPLO.SOLDIER_STRENGTH * (s.integrity / 100) * mult;
        }, 0);

        const strB = sideB.reduce((acc, s) => {
          const ownerS = hex && hex.owner !== null ? settlementById.get(hex.owner) : null;
          const mult = (ownerS && ownerS.factionId === fb ? 1.3 : 1.0) * concentrationMultB;
          return acc + DIPLO.SOLDIER_STRENGTH * (s.integrity / 100) * mult;
        }, 0);

        // Each soldier on side A takes damage proportional to enemy strength
        for (const s of sideA) {
          s.integrity -= strB * DIPLO.FIELD_DAMAGE / sideA.length;
          s.engaged = true;
          if (s.integrity <= 0) fieldDead.push(s);
        }
        // Disengagement check A
        for (const s of sideA) {
          if (s.mission?.kind === 'raid') {
            const committed = s.engagedSince !== null && (world.tick - s.engagedSince) < DIPLO.COMBAT_COMMIT_TICKS;
            if (!committed && strB > strA * 2) {
              s.engagedSince = null;
              s.engaged = false;
              cancelMission(world, s);
            }
          }
        }

        // Each soldier on side B takes damage proportional to enemy strength
        for (const s of sideB) {
          s.integrity -= strA * DIPLO.FIELD_DAMAGE / sideB.length;
          s.engaged = true;
          if (s.integrity <= 0) fieldDead.push(s);
        }
        // Disengagement check B
        for (const s of sideB) {
          if (s.mission?.kind === 'raid') {
            const committed = s.engagedSince !== null && (world.tick - s.engagedSince) < DIPLO.COMBAT_COMMIT_TICKS;
            if (!committed && strA > strB * 2) {
              s.engagedSince = null;
              s.engaged = false;
              cancelMission(world, s);
            }
          }
        }
      }
    }
  }

  // Battle-start logging & victory checks
  const oldActiveBattles = world.diplo.activeBattles || {};
  for (const hk of Object.keys(nextActiveBattles)) {
    if (!oldActiveBattles[hk]) {
      const hex = world.hexes.get(hk);
      if (hex) log(world, `Battle joined near (${hex.q},${hex.r})!`);
    }
  }

  // Battle resolution check
  for (const [hk, factions] of Object.entries(oldActiveBattles)) {
    if (!nextActiveBattles[hk]) {
      const [fa, fb] = factions;
      const soldiers = world.agents.filter(a => a.type === 'soldier' && a.q + ',' + a.r === hk);
      const hasA = soldiers.some(s => s.factionId === fa);
      const hasB = soldiers.some(s => s.factionId === fb);
      const war = findWar(world, fa, fb);
      if (war) {
        if (hasA && !hasB) {
          war.exh[fa] = Math.max(0, war.exh[fa] - DIPLO.EXH_BATTLE_WINNER_RELIEF);
          war.exh[fb] += DIPLO.EXH_BATTLE_LOSER_COST;
          const hex = world.hexes.get(hk);
          log(world, `Battle near (${hex.q},${hex.r}) resolved: ${world.factions[fa].name} is victorious!`);
        } else if (hasB && !hasA) {
          war.exh[fb] = Math.max(0, war.exh[fb] - DIPLO.EXH_BATTLE_WINNER_RELIEF);
          war.exh[fa] += DIPLO.EXH_BATTLE_LOSER_COST;
          const hex = world.hexes.get(hk);
          log(world, `Battle near (${hex.q},${hex.r}) resolved: ${world.factions[fb].name} is victorious!`);
        }
      }
    }
  }
  world.diplo.activeBattles = nextActiveBattles;

  // Remove dead soldiers from field battles
  if (fieldDead.length > 0) {
    for (const a of fieldDead) {
      for (const w of world.diplo.wars) {
        if (w.a === a.factionId || w.b === a.factionId) w.exh[a.factionId] += DIPLO.EXH_SOLDIER_LOST;
      }
    }
    const deadIds = new Set(fieldDead.map(a => a.id));
    world.agents = world.agents.filter(a => !deadIds.has(a.id));
  }


  // Pillage enemy land + raid enemy caravans
  for (const a of world.agents) {
    if (a.type !== 'soldier') continue;
    const hex = world.hexes.get(a.q + ',' + a.r);
    if (!hex) continue;
    const ownerS = hex.owner !== null ? settlementById.get(hex.owner) : null;
    if (ownerS && atWar(world, a.factionId, ownerS.factionId)) {
      const home = homeOf(world, a);
      let pillagedAny = false;
      for (const res of ['food', 'timber', 'stone', 'ore']) {
        const amt = hex.resources[res] || 0;
        if (amt > 0) {
          const taken = Math.ceil(amt * 0.1);
          hex.resources[res] -= taken;
          if (home) {
            const deliver = Math.max(1, Math.round(taken * 0.1));
            home.stock[res] = Math.min(storageCap(home), (home.stock[res] ?? 0) + deliver);
          }
          pillagedAny = true;
        }
      }
      if (pillagedAny) {
        const war = findWar(world, a.factionId, ownerS.factionId);
        if (war) {
          war.exh[ownerS.factionId] += 0.15;
        }
        const alreadyBurning = (hex.burnTicks ?? 0) > 0;
        hex.burnTicks = Math.min(120, (hex.burnTicks ?? 0) + 30);
        if (!alreadyBurning || world.rng.chance(0.05)) {
          log(world, `${world.factions[a.factionId].name} raiders pillaged resources near ${ownerS.name}!`);
        }
      }
      if (hex.building && hex.buildingIntegrity > 0) {
        const oldInt = hex.buildingIntegrity;
        hex.buildingIntegrity = Math.max(0, hex.buildingIntegrity - 0.5);
        if (oldInt > 0 && hex.buildingIntegrity <= 0) {
          log(world, `${world.factions[a.factionId].name} raiders DESTROYED the ${hex.building} near ${ownerS.name}!`);
        }
        hex.burnTicks = Math.min(120, (hex.burnTicks ?? 0) + 30);
        const war = findWar(world, a.factionId, ownerS.factionId);
        if (war) {
          war.exh[ownerS.factionId] += 0.25;
        }
      }
      if (hex.hasRoad) {
        hex.roadIntegrity -= 1;
        if (hex.roadIntegrity <= 0) {
          hex.hasRoad = false;
          log(world, `${world.factions[a.factionId].name} raiders destroyed the road near ${ownerS.name}!`);
        }
        hex.burnTicks = Math.min(120, (hex.burnTicks ?? 0) + 10);
      }
    }
    for (const c of world.agents) {
      if (c.type !== 'caravan' || c.q !== a.q || c.r !== a.r) continue;
      if (!atWar(world, a.factionId, c.factionId)) continue;

      const home = homeOf(world, a);
      for (const res of ['food', 'timber', 'stone', 'ore']) {
        const amt = c.cargo[res] || 0;
        if (amt > 0 && home) {
          const deliver = Math.max(1, Math.round(amt * 0.2));
          home.stock[res] = Math.min(storageCap(home), (home.stock[res] ?? 0) + deliver);
        }
      }
      world.agents = world.agents.filter(x => x.id !== c.id);
      addRelation(world, a.factionId, c.factionId, DIPLO.RAID_PENALTY);
      log(world, `A ${world.factions[c.factionId].name} caravan was raided by ${world.factions[a.factionId].name} soldiers near (${a.q},${a.r})!`);
      const war = findWar(world, a.factionId, c.factionId);
      if (war) {
        war.exh[c.factionId] += 0.5;
      }
    }
  }

  // Sieges
  const sieges = new Map();
  for (const a of world.agents) {
    if (a.type === 'soldier' && a.state === 'siege' && a.mission?.targetId != null) {
      if (!sieges.has(a.mission.targetId)) sieges.set(a.mission.targetId, []);
      sieges.get(a.mission.targetId).push(a);
    }
  }
  for (const [targetId, attackers] of [...sieges.entries()].sort((x, y) => x[0] - y[0])) {
    const s = settlementById.get(targetId);
    if (!s || !atWar(world, attackers[0].factionId, s.factionId)) {
      for (const a of attackers) cancelMission(world, a);
      continue;
    }
    const tMult = tierMultiplier(s.tier);
    if (s.siegeHp == null) {
      s.siegeHp = settlementDefense(world, s) + DIPLO.SIEGE_BULWARK * tMult;
      s.siegePop0 = s.population;   // pre-siege pop, for the death cap
      s.siegeDeaths = 0;
      log(world, `${s.name} is under siege!`);
    }
    // Bombardment & starvation: a siege kills people, visibly and permanently,
    // capped so a multi-stage stalemate cannot empty a city outright.
    {
      const cap = (s.siegePop0 ?? s.population) * DIPLO.SIEGE_DEATH_CAP;
      s.siegeDeaths = s.siegeDeaths ?? 0;
      if (s.siegeDeaths < cap) {
        const death = Math.min(s.population * DIPLO.SIEGE_DEATH_RATE, cap - s.siegeDeaths, Math.max(0, s.population - 5));
        s.population -= death;
        s.siegeDeaths += death;
      }
    }
    const atkStr = attackers.reduce((acc, a) => acc + DIPLO.SOLDIER_STRENGTH * a.integrity / 100, 0);
    let dmgReduction = 1.0;
    if (s.tier === 'TOWN') dmgReduction = DIPLO.SIEGE_REDUCTION_TOWN ?? 0.85;
    else if (s.tier === 'CITY') dmgReduction = DIPLO.SIEGE_REDUCTION_CITY ?? 0.70;
    s.siegeHp -= atkStr * DIPLO.SIEGE_ATTACK * dmgReduction;
    const counter = Math.max(0, s.siegeHp) * (DIPLO.SIEGE_DEFEND * tMult) / attackers.length;
    for (const a of attackers) a.integrity -= counter;

    const dead = attackers.filter(a => a.integrity <= 0);
    if (dead.length > 0) {
      const fid = attackers[0].factionId;
      const war = findWar(world, fid, s.factionId);
      if (war) war.exh[fid] += DIPLO.EXH_SOLDIER_LOST * dead.length;
      const ids = new Set(dead.map(a => a.id));
      world.agents = world.agents.filter(x => !ids.has(x.id));
    }
    if (s.siegeHp <= 0) {
      captureSettlement(world, s, attackers.filter(a => a.integrity > 0));
    }
  }

  // Defense recovers once a siege lifts
  for (const s of world.settlements) {
    if (s.siegeHp != null && !sieges.has(s.id)) {
      s.siegeHp += DIPLO.DEFENSE_REGEN;
      if (s.siegeHp >= settlementDefense(world, s)) { s.siegeHp = null; s.siegePop0 = null; s.siegeDeaths = 0; }
    }
  }

  // Update engagedSince property on all alive soldiers
  for (const a of world.agents) {
    if (a.type === 'soldier') {
      if (a.engaged) {
        if (a.engagedSince === null) {
          a.engagedSince = world.tick;
        }
      } else {
        a.engagedSince = null;
      }
    }
  }
}

function healAndAttrition(world) {
  const dead = [];
  for (const a of world.agents) {
    if (a.type !== 'soldier') continue;
    const home = homeOf(world, a);
    const atHome = home && a.q === home.q && a.r === home.r && a.state === 'idle';
    if (atHome) {
      a.integrity = Math.min(100, a.integrity + DIPLO.SOLDIER_HEAL);
    } else if (a.state !== 'idle') {
      const mySettlements = world.settlements.filter(s => s.factionId === a.factionId);
      let minD = Infinity;
      for (const s of mySettlements) {
        const d = distance(a.q, a.r, s.q, s.r);
        if (d < minD) minD = d;
      }
      const supplyMultiplier = minD === Infinity ? 1.0 : (minD <= 6 ? 1.0 : 1.0 + (minD - 6) * 0.15);
      a.integrity -= DIPLO.SOLDIER_FIELD_DECAY * supplyMultiplier;
      if (a.integrity <= 0) dead.push(a);
    }
  }
  if (dead.length > 0) {
    for (const a of dead) {
      for (const w of world.diplo.wars) {
        if (w.a === a.factionId || w.b === a.factionId) w.exh[a.factionId] += DIPLO.EXH_SOLDIER_LOST;
      }
    }
    const ids = new Set(dead.map(a => a.id));
    world.agents = world.agents.filter(x => !ids.has(x.id));
  }
}

function captureSettlement(world, s, survivors) {
  if (survivors.length === 0) { s.siegeHp = 1; return; } // nobody left to take it
  const loserFid = s.factionId;
  const winnerFid = survivors[0].factionId;
  const war = findWar(world, winnerFid, loserFid);

  // the old regime's local agents disband
  world.agents = world.agents.filter(a => !(a.homeId === s.id && a.factionId === loserFid));
  s.factionId = winnerFid;
  s.population = Math.max(5, s.population * (1 - DIPLO.CAPTURE_POP_LOSS));
  for (const res of ['food', 'timber', 'stone', 'ore']) s.stock[res] *= (1 - DIPLO.CAPTURE_STOCK_LOSS);
  s.siegeHp = null;
  s.siegePop0 = null;
  s.siegeDeaths = 0;
  s.pendingSettler = false;
  for (const a of survivors) {
    a.homeId = s.id; a.state = 'idle'; a.mission = null;
    deposit(s, a.cargo);
    a.cargo = { food: 0, timber: 0, stone: 0, ore: 0 };
  }
  if (war) {
    war.exh[winnerFid] = Math.max(0, war.exh[winnerFid] - DIPLO.EXH_CAPTURE_WINNER_REFUND);
    war.exh[loserFid] += DIPLO.EXH_CAPTURE_LOSER_PENALTY;
  }
  if (world.stats) {
    world.stats.captures[winnerFid] = (world.stats.captures[winnerFid] ?? 0) + 1;
  }
  addRelation(world, winnerFid, loserFid, DIPLO.CAPTURE_PENALTY);
  log(world, `${s.name} was CAPTURED by ${world.factions[winnerFid].name}!`);

  if (settlementsF(world, loserFid).length === 0) {
    world.factions[loserFid].eliminated = true;
    world.agents = world.agents.filter(a => a.factionId !== loserFid);
    world.diplo.wars = world.diplo.wars.filter(w => w.a !== loserFid && w.b !== loserFid);
    log(world, `${world.factions[loserFid].name} has fallen. Their name passes into history.`);
  } else if (war && war.goalId === s.id) {
    const aggr = effectiveAggression(world, winnerFid);
    if (war.exh[winnerFid] >= DIPLO.MUTUAL_THRESHOLD || aggr < 1.2) {
      makePeace(world, war, loserFid); // peace from strength
    }
    // aggressive victors pick a new goal at the next Court session
  }
}
