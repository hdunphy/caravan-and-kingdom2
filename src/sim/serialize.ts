import { makeRng } from '../core/rng.js';
import type { World } from '../types.js';

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

  // Cleanup the intermediate rngState from the final world object
  delete world.rngState;

  return world;
}
