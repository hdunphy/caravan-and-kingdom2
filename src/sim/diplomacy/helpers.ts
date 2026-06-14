// Module-private faction helpers shared across the diplomacy passes.
import { DEFAULT_TRAITS } from '../../core/constants.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';
import { treasuryOf } from '../economy.js';

export const aliveF = (world: World, fid: number) => !world.factions[fid].eliminated;
export const traitsF = (world: World, fid: number) => world.factions[fid]?.traits ?? DEFAULT_TRAITS;
export const effectiveAggression = (world: World, fid: number) => (traitsF(world, fid).aggression ?? 1) + (world.factions[fid]?.stagnationAggression ?? 0);
export const settlementsF = (world: World, fid: number): Settlement[] => world.settlementsByFaction?.get(fid) || [];
export const goldF = treasuryOf;
export const tierMultiplier = (tier: string) => {
  if (tier === 'TOWN') return 1.5;
  if (tier === 'CITY') return 2.2;
  return 1.0;
};
