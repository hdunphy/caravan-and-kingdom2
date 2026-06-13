// Module-private faction helpers shared across the diplomacy passes.
import { DEFAULT_TRAITS } from '../../core/constants.js';
import type { World } from '../../types.js';

export const aliveF = (world: World, fid) => !world.factions[fid].eliminated;
export const traitsF = (world: World, fid) => world.factions[fid]?.traits ?? DEFAULT_TRAITS;
export const effectiveAggression = (world: World, fid) => (traitsF(world, fid).aggression ?? 1) + (world.factions[fid]?.stagnationAggression ?? 0);
export const settlementsF = (world: World, fid) => world.settlements.filter(s => s.factionId === fid);
export const goldF = (world: World, fid) => settlementsF(world, fid).reduce((a, s) => a + s.gold, 0);
export const tierMultiplier = (tier) => {
  if (tier === 'TOWN') return 1.5;
  if (tier === 'CITY') return 2.2;
  return 1.0;
};
