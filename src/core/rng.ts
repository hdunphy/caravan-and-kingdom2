// Deterministic seeded RNG (mulberry32) - keeps the sim reproducible for batch runs.
export interface Rng {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(arr: T[]) => T;
  chance: (p: number) => boolean;
  getState: () => number;
  setState: (s: number) => void;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(arr: T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
    getState: () => a >>> 0,
    setState: (s: number) => { a = s >>> 0; },
  };
}
