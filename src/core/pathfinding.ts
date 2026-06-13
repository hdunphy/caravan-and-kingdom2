// A* pathfinding over the hex grid, weighted by terrain move cost.
import { TERRAIN, ECON } from './constants.js';
import type { World } from '../types.js';

type QR = [number, number];

// Returns array of [q,r] from start (exclusive) to goal (inclusive), or null.
export function findPath(world: World, sq: number, sr: number, gq: number, gr: number, isPlanning = false): QR[] | null {
  const cacheKey = sq + ',' + sr + ':' + gq + ',' + gr + ':' + isPlanning;
  if (world.pathCache && world.pathCache.has(cacheKey)) {
    const cached = world.pathCache.get(cacheKey);
    return cached ? cached.map((p): QR => [p[0], p[1]]) : null;
  }

  const startKey = sq + ',' + sr;
  const goalKey = gq + ',' + gr;
  if (startKey === goalKey) {
    if (world.pathCache) world.pathCache.set(cacheKey, []);
    return [];
  }
  const goalHex = world.hexes.get(goalKey);
  if (!goalHex || TERRAIN[goalHex.terrain].moveCost === Infinity) {
    if (world.pathCache) world.pathCache.set(cacheKey, null);
    return null;
  }

  const open = new MinHeap();
  open.push(0, { q: sq, r: sr, key: startKey });
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);

  while (open.size > 0) {
    const current = open.pop();
    const currentKey = current.key;
    if (currentKey === goalKey) {
      const path: QR[] = [];
      let k = goalKey;
      while (k !== startKey) {
        const [q, r] = k.split(',').map(Number);
        path.push([q, r] as QR);
        k = cameFrom.get(k)!;
      }
      const resultPath = path.reverse();
      if (world.pathCache) {
        world.pathCache.set(cacheKey, resultPath.map((p): QR => [p[0], p[1]]));
      }
      return resultPath;
    }

    const cq = current.q;
    const cr = current.r;

    // Inlined pointy-top hex directions to avoid allocating neighbors array
    for (let i = 0; i < 6; i++) {
      let nq, nr;
      if (i === 0) { nq = cq + 1; nr = cr; }
      else if (i === 1) { nq = cq + 1; nr = cr - 1; }
      else if (i === 2) { nq = cq; nr = cr - 1; }
      else if (i === 3) { nq = cq - 1; nr = cr; }
      else if (i === 4) { nq = cq - 1; nr = cr + 1; }
      else { nq = cq; nr = cr + 1; }

      const nKey = nq + ',' + nr;
      const hex = world.hexes.get(nKey);
      if (!hex) continue;
      
      let cost = TERRAIN[hex.terrain].moveCost;
      if (hex.terrain === 'RIVER') {
        cost = hex.hasBridge ? ECON.ROAD_MOVE_COST : (isPlanning ? 3.0 : 15.0);
      }
      if (cost === Infinity) continue;
      if (hex.hasRoad) cost = Math.min(cost, ECON.ROAD_MOVE_COST);
      
      const tentative = gScore.get(currentKey)! + cost;
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentative);
        // Inline distance calculation
        const hDist = (Math.abs(nq - gq) + Math.abs(nq + nr - gq - gr) + Math.abs(nr - gr)) / 2;
        open.push(tentative + hDist, { q: nq, r: nr, key: nKey });
      }
    }
  }
  
  if (world.pathCache) {
    world.pathCache.set(cacheKey, null);
  }
  return null;
}

interface HeapItem { priority: number; value: any; }

class MinHeap {
  items: HeapItem[];
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(priority: number, value: any) {
    this.items.push({ priority, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].priority <= this.items[i].priority) break;
      
      const temp = this.items[p];
      this.items[p] = this.items[i];
      this.items[i] = temp;
      
      i = p;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let m = i;
        if (l < this.items.length && this.items[l].priority < this.items[m].priority) m = l;
        if (r < this.items.length && this.items[r].priority < this.items[m].priority) m = r;
        if (m === i) break;
        
        const temp = this.items[m];
        this.items[m] = this.items[i];
        this.items[i] = temp;
        
        i = m;
      }
    }
    return top.value;
  }
}
