// World generation: fBm value-noise island with elevation + moisture layers.
import { makeRng } from '../core/rng.js';
import { key, range, distance, hexToPixel, neighbors } from '../core/hex.js';
import { TERRAIN, FACTIONS, DEFAULT_POLICY } from '../core/constants.js';
import { foundSettlement } from './settlement.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../types.js';

// Seeded 2D value noise with fractal octaves.
function makeNoise(seed: number) {
  const hash = (ix: number, iy: number) => {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const base = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const u = smooth(x - ix), v = smooth(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  return (x: number, y: number, octaves = 3) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += base(x * freq + o * 31.7, y * freq + o * 17.3) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };
}

export function generateWorld(seed: number = 42, mapRadius: number = 24, factionCount: number = 4) {
  const rng = makeRng(seed);
  const world: World = {
    seed, tick: 0, mapRadius,
    rng,
    hexes: new Map(),
    settlements: [],
    agents: [],
    factions: FACTIONS.slice(0, factionCount).map(f => ({ ...f, policy: { ...DEFAULT_POLICY }, treasury: ECON.GOLD_START * 3 })),
    nextId: 1,
    log: [],
    alerts: [],
    history: { interval: 25, samples: [] },
    diplo: { relations: {}, tradeCounts: {}, wars: [], truces: {} },
    stats: { trades: {}, captures: {} },
    playerFactionId: null,
    pathCache: new Map(),
  };

  const elevation = makeNoise(seed);
  const moisture = makeNoise(seed ^ 0x5bf03635);
  const SCALE = mapRadius * 0.38; // noise feature size relative to map

  for (const [q, r] of range(0, 0, mapRadius)) {
    const { x, y } = hexToPixel(q, r, 1);
    const nx = x / SCALE, ny = y / SCALE;

    // Elevation: fractal noise minus radial falloff -> island with ocean edges
    let e = elevation(nx, ny, 4);
    const d = distance(q, r, 0, 0) / mapRadius;
    e = e * 0.85 + 0.25 - Math.pow(d, 2.2) * 0.62;

    const m = moisture(nx + 40.5, ny + 92.1, 3);

    let terrain: TerrainKind;
    if (e < 0.30) terrain = 'WATER';
    else if (e > 0.66) terrain = 'MOUNTAINS';
    else if (e > 0.56) terrain = 'HILLS';
    else if (m > 0.55) terrain = 'FOREST';
    else terrain = 'PLAINS';

    world.hexes.set(key(q, r), {
      q, r, terrain,
      resources: { food: 0, timber: 0, stone: 0, ore: 0 },
      owner: null,
      building: null,
      buildingIntegrity: 100,
      hasRoad: false,
      roadIntegrity: 0,
      hasBridge: false,
      traffic: 0,
    });
  }

  // River generation: trace downhill streams from mountains/hills to water.
  const mountainOrHills = [...world.hexes.values()].filter(h => h.terrain === 'MOUNTAINS' || h.terrain === 'HILLS');
  if (mountainOrHills.length > 0) {
    const numRivers = 2 + Math.floor(rng.next() * 2); // 2 or 3 rivers
    const sources: Hex[] = [];
    for (let i = 0; i < numRivers; i++) {
      const src = mountainOrHills[Math.floor(rng.next() * mountainOrHills.length)];
      if (src && !sources.includes(src)) sources.push(src);
    }

    for (const src of sources) {
      let curr = src;
      const visited = new Set([key(curr.q, curr.r)]);
      for (let step = 0; step < 40; step++) {
        let bestNeighbor = null;
        let minElev = Infinity;
        for (const [nq, nr] of neighbors(curr.q, curr.r)) {
          const nKey = key(nq, nr);
          if (visited.has(nKey)) continue;
          const n = world.hexes.get(nKey);
          if (!n) continue;
          
          const { x: nx, y: ny } = hexToPixel(n.q, n.r, 1);
          let nE = elevation(nx / SCALE, ny / SCALE, 4);
          const nD = distance(n.q, n.r, 0, 0) / mapRadius;
          nE = nE * 0.85 + 0.25 - Math.pow(nD, 2.2) * 0.62;
          
          if (nE < minElev) {
            minElev = nE;
            bestNeighbor = n;
          }
        }
        
        if (!bestNeighbor) break;
        if (bestNeighbor.terrain === 'WATER') break;
        
        // Turn PLAINS or FOREST into RIVER
        if (bestNeighbor.terrain === 'PLAINS' || bestNeighbor.terrain === 'FOREST') {
          bestNeighbor.terrain = 'RIVER';
        }
        
        curr = bestNeighbor;
        visited.add(key(curr.q, curr.r));
      }
    }
  }

  // Faction starts: plains hexes, inland, spread apart, varied surroundings.
  const candidates = [...world.hexes.values()].filter(h =>
    h.terrain === 'PLAINS' && distance(h.q, h.r, 0, 0) <= mapRadius - 4);
  const starts = [];
  for (const faction of world.factions) {
    let bestHex = null, bestScore = -Infinity;
    for (const h of candidates) {
      const minDist = starts.length === 0 ? 99 :
        Math.min(...starts.map(s => distance(h.q, h.r, s.q, s.r)));
      if (starts.length > 0 && minDist < 9) continue;
      let variety = 0, water = 0;
      const seen = new Set();
      for (const [q, r] of range(h.q, h.r, 3)) {
        const n = world.hexes.get(key(q, r));
        if (!n) continue;
        if (n.terrain === 'WATER') water++;
        else if (!seen.has(n.terrain)) { seen.add(n.terrain); variety++; }
      }
      // Want varied land nearby, but not a coastline-dominated start
      const score = variety * 2 - water * 0.15 + minDist * 0.1 + rng.next();
      if (score > bestScore) { bestScore = score; bestHex = h; }
    }
    if (bestHex) {
      starts.push(bestHex);
      foundSettlement(world, faction.id, bestHex.q, bestHex.r, 12);
    }
  }
  return world;
}
