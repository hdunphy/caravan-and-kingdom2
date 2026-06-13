// ASCII map preview + terrain stats
import { generateWorld } from './src/sim/worldgen.js';
const seed = Number(process.argv[2] ?? 42);
const w = generateWorld(seed, 18, 3);
const ch = { PLAINS: '.', FOREST: 'f', HILLS: 'h', MOUNTAINS: 'M', WATER: '~' };
const counts = {};
const rows = new Map();
for (const h of w.hexes.values()) {
  counts[h.terrain] = (counts[h.terrain] ?? 0) + 1;
  if (!rows.has(h.r)) rows.set(h.r, new Map());
  rows.get(h.r).set(h.q, ch[h.terrain]);
}
for (const s of w.settlements) rows.get(s.r).set(s.q, '#');
const rs = [...rows.keys()].sort((a, b) => a - b);
for (const r of rs) {
  const qs = rows.get(r);
  const qKeys = [...qs.keys()].sort((a, b) => a - b);
  let line = ' '.repeat(Math.max(0, r + 18));
  for (let q = Math.min(...qKeys); q <= Math.max(...qKeys); q++) line += (qs.get(q) ?? ' ') + ' ';
  console.log(line);
}
const total = w.hexes.size;
console.log(Object.entries(counts).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join('  '), `| starts: ${w.settlements.length}`);
