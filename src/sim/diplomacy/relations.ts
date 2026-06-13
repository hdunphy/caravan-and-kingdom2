// ---------- Relations ----------
import { DIPLO, ECON } from '../../core/constants.js';
import type { World } from '../../types.js';

export const pairKey = (a, b) => Math.min(a, b) + '|' + Math.max(a, b);

export function getRelation(world: World, a, b) {
  if (a === b) return 100;
  return world.diplo.relations[pairKey(a, b)] ?? 0;
}

export function addRelation(world: World, a, b, delta) {
  const k = pairKey(a, b);
  const v = (world.diplo.relations[k] ?? 0) + delta;
  world.diplo.relations[k] = Math.max(-100, Math.min(100, v));
}

export function findWar(world: World, a, b) {
  return world.diplo.wars.find(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)) ?? null;
}
export function atWar(world: World, a, b) { return !!findWar(world, a, b); }
export function atWarAny(world: World, a) { return world.diplo.wars.some(w => w.a === a || w.b === a); }

export function stateOf(world: World, a, b) {
  if (a === b) return 'SELF';
  if (atWar(world, a, b)) return 'WAR';
  if ((world.diplo.truces[pairKey(a, b)] ?? 0) > world.tick) return 'TRUCE';
  const r = getRelation(world, a, b);
  if (r >= DIPLO.FRIENDLY) return 'FRIENDLY';
  if (r <= DIPLO.HOSTILE) return 'HOSTILE';
  return 'NEUTRAL';
}

// Trade missions may only run between factions in decent standing or during a truce
export function hasEmbargo(world: World, a, b) {
  if (!world.diplo || !world.diplo.embargoes) return false;
  return world.diplo.embargoes.includes(pairKey(a, b));
}

export function hasPact(world: World, a, b) {
  if (!world.diplo || !world.diplo.pacts) return false;
  const pk = pairKey(a, b);
  return world.diplo.pacts.some(p => pairKey(p.a, p.b) === pk);
}

export function getAllies(world: World, fid) {
  if (!world.diplo || !world.diplo.pacts) return [];
  const allies = [];
  for (const p of world.diplo.pacts) {
    if (p.a === fid) allies.push(p.b);
    else if (p.b === fid) allies.push(p.a);
  }
  return allies;
}

export function canTrade(world: World, a, b) {
  if (a === b) return true;
  if (hasEmbargo(world, a, b)) return false;
  const st = stateOf(world, a, b);
  return st === 'NEUTRAL' || st === 'FRIENDLY' || st === 'TRUCE';
}
export function tradePrice(world: World, a, b) {
  const st = stateOf(world, a, b);
  if (st === 'SELF') return 0;
  return st === 'FRIENDLY' ? DIPLO.FRIENDLY_PRICE : ECON.TRADE_PRICE;
}
