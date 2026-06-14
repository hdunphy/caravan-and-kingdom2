import { makeRng } from '../core/rng.js';
import { Faction, World } from '../types.js';
import { indexSettlements } from './gameLoop.js';

export function saveWorld(world: World): string {
  // We extract rngState and serialize hexes as an array of entries.
  // Other fields can be JSON.stringified naturally.
  const data = {
    ...world,
    rngState: world.rng.getState(),
    hexes: Array.from(world.hexes.entries()),
    settlements: world.settlements.map(s => {
      const { _controlledHexes, ...rest } = s;
      return rest;
    })
  };
  
  // Drop non-serializable or unnecessary fields
  delete (data as any).rng;
  delete (data as any).pathCache;
  delete (data as any).settlementById;
  delete (data as any).settlementsByFaction;

  return JSON.stringify(data);
}

export function loadWorld(json: string): World {
  const data = JSON.parse(json);
  
  const rng = makeRng(data.seed);
  if (data.rngState !== undefined) {
    rng.setState(data.rngState);
  }

  const world: World = {
    ...data,
    rng,
    hexes: new Map(data.hexes),
    pathCache: new Map(),
  };

  // Migration: if factions don't have treasury, calculate it from settlement gold
  for (const fac of world.factions) {
    if (fac.treasury === undefined) {
      fac.treasury = 0;
      for (const s of world.settlements) {
        if (s.factionId === fac.id && (s as any).gold !== undefined) {
          fac.treasury += (s as any).gold;
        }
      }
    }
  }

  // Cleanup the intermediate rngState from the final world object
  delete world.rngState;
  
  // Cleanup deprecated s.gold
  for (const s of world.settlements) {
    if ('gold' in s) delete (s as any).gold;
  }
  
  indexSettlements(world);

  return world;
}
