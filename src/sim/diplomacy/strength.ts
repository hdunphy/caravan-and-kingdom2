// ---------- Strength ----------
import { DIPLO } from '../../core/constants.js';
import { getAllies } from './relations.js';
import { aliveF, traitsF, settlementsF } from './helpers.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

export function soldiersOf(world: World, fid: number) {
  return world.agents.filter(a => a.factionId === fid && a.type === 'soldier');
}
export function strengthOf(world: World, fid: number) {
  return soldiersOf(world, fid).reduce((a, s) => a + DIPLO.SOLDIER_STRENGTH * s.integrity / 100, 0);
}

export function committedStrength(world: World, fid: number) {
  let c = 0;
  for (const w of world.diplo.wars) {
    if (w.a !== fid && w.b !== fid) continue;
    const enemy = w.a === fid ? w.b : w.a;
    c += strengthOf(world, enemy) * DIPLO.COMMIT_FACTOR;
  }
  return c;
}

export function defensiveBlocStats(world: World, fid: number) {
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

export function offensiveBlocStats(world: World, fid: number) {
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
export function settlementDefense(world: World, s: Settlement) {
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
export function armyCap(world: World, fid: number) {
  const pop = settlementsF(world, fid).reduce((a, s) => a + s.population, 0);
  const aggr = traitsF(world, fid).aggression ?? 1;
  return Math.max(DIPLO.ARMY_MIN, Math.round((pop / DIPLO.POP_PER_SOLDIER) * (0.7 + 0.3 * aggr)));
}
