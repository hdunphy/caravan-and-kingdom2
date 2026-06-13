// ---------- Combat (every tick) ----------
import { key, distance } from '../../core/hex.js';
import { DIPLO, ECON, TERRAIN } from '../../core/constants.js';
import { log, deposit, controlledHexes, storageCap, pushAlert } from '../settlement.js';
import { spawnAgent, assignPath, homeOf, cancelMission } from '../agents.js';
import { pairKey, getRelation, addRelation, findWar, atWar, atWarAny, stateOf, hasEmbargo, hasPact, getAllies, canTrade, tradePrice } from './relations.js';
import { soldiersOf, strengthOf, committedStrength, defensiveBlocStats, offensiveBlocStats, settlementDefense, armyCap } from './strength.js';
import { aliveF, traitsF, effectiveAggression, settlementsF, goldF, tierMultiplier } from './helpers.js';
import { makePeace } from './peace.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

// ---------- Combat (every tick) ----------
export function combatSystem(world: World) {
  if (!world.diplo) return;
  const settlementById: Map<number, any> = new Map(world.settlements.map(s => [s.id, s] as [number, any]));
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
  const hexBuckets: Map<string, any[]> = new Map();
  for (const a of world.agents) {
    if (a.type !== 'soldier') continue;
    const k = a.q + ',' + a.r;
    if (!hexBuckets.has(k)) hexBuckets.set(k, []);
    hexBuckets.get(k)!.push(a);
  }

  const fieldDead = [];
  const nextActiveBattles: Record<string, number[]> = {};

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
  const oldActiveBattles: Record<string, number[]> = world.diplo.activeBattles || {};
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
          const hex = world.hexes.get(hk)!;
          log(world, `Battle near (${hex.q},${hex.r}) resolved: ${world.factions[fa].name} is victorious!`);
        } else if (hasB && !hasA) {
          war.exh[fb] = Math.max(0, war.exh[fb] - DIPLO.EXH_BATTLE_WINNER_RELIEF);
          war.exh[fa] += DIPLO.EXH_BATTLE_LOSER_COST;
          const hex = world.hexes.get(hk)!;
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
  const sieges: Map<number, any[]> = new Map();
  for (const a of world.agents) {
    if (a.type === 'soldier' && a.state === 'siege' && a.mission?.targetId != null) {
      if (!sieges.has(a.mission.targetId)) sieges.set(a.mission.targetId, []);
      sieges.get(a.mission.targetId)!.push(a);
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

function healAndAttrition(world: World) {
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

function captureSettlement(world: World, s: Settlement, survivors: Agent[]) {
  if (survivors.length === 0) { s.siegeHp = 1; return; } // nobody left to take it
  const loserFid = s.factionId;
  const winnerFid = survivors[0].factionId;
  const war = findWar(world, winnerFid, loserFid);

  let popFraction = 1;
  const loserSettlements = settlementsF(world, loserFid);
  if (loserSettlements.length > 0) {
    const totalLoserPop = loserSettlements.reduce((sum, set) => sum + set.population, 0);
    popFraction = totalLoserPop > 0 ? s.population / totalLoserPop : 1;
  }

  // Convert the old regime's local agents instead of disbanding
  for (const a of world.agents) {
    if (a.homeId === s.id && a.factionId === loserFid) {
      a.factionId = winnerFid;
      a.mission = null;
      a.state = 'idle';
      if (a.type === 'soldier') {
        a.type = 'villager'; // Demobilize captured soldiers to prevent instant army spikes
      }
    }
  }

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
    const penaltyScale = Math.max(0.2, Math.min(4.0, popFraction * 4)); // Losing 25% of empire = 1.0x penalty
    war.exh[winnerFid] = Math.max(0, war.exh[winnerFid] - DIPLO.EXH_CAPTURE_WINNER_REFUND * penaltyScale);
    war.exh[loserFid] += DIPLO.EXH_CAPTURE_LOSER_PENALTY * penaltyScale;
  }
  
  if (world.stats) {
    world.stats.captures[winnerFid] = (world.stats.captures[winnerFid] ?? 0) + 1;
  }
  addRelation(world, winnerFid, loserFid, DIPLO.CAPTURE_PENALTY);
  log(world, `${s.name} was CAPTURED by ${world.factions[winnerFid].name}!`);
  pushAlert(world, { severity: 'CRITICAL', factionId: loserFid, type: 'SETTLEMENT_LOST', tick: world.tick, targetId: s.id, q: s.q, r: s.r, msg: `${s.name} was CAPTURED by ${world.factions[winnerFid].name}!` });
  pushAlert(world, { severity: 'IMPORTANT', factionId: winnerFid, type: 'SETTLEMENT_CAPTURED', tick: world.tick, targetId: s.id, q: s.q, r: s.r, msg: `You CAPTURED ${s.name} from ${world.factions[loserFid].name}!` });

  if (settlementsF(world, loserFid).length === 0) {
    world.factions[loserFid].eliminated = true;
    world.agents = world.agents.filter(a => a.factionId !== loserFid);
    world.diplo.wars = world.diplo.wars.filter(w => w.a !== loserFid && w.b !== loserFid);
    log(world, `${world.factions[loserFid].name} has fallen. Their name passes into history.`);
  } else if (war && war.goalId === s.id) {
    const aggr = effectiveAggression(world, winnerFid);
    const loserSettsRemaining = settlementsF(world, loserFid).length;
    if (war.exh[winnerFid] >= DIPLO.MUTUAL_THRESHOLD || aggr < 1.2 || loserSettsRemaining <= 2) {
      makePeace(world, war, loserFid); // peace from strength
    }
    // aggressive victors or those against large empires pick a new goal at the next Court session
  }
}
