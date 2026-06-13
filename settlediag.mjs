import { generateWorld } from './src/sim/worldgen.js';
import { run } from './src/sim/gameLoop.js';
import { distance } from './src/core/hex.js';
for (const seed of [123, 42]) {
  const w = run(generateWorld(seed, 18, 3), 12000);
  let minD = Infinity, pair = null;
  for (let i = 0; i < w.settlements.length; i++)
    for (let j = i + 1; j < w.settlements.length; j++) {
      const a = w.settlements[i], b = w.settlements[j];
      const d = distance(a.q, a.r, b.q, b.r);
      if (d < minD) { minD = d; pair = `${a.name}-${b.name}`; }
    }
  const events = w.log.filter(e => /diverted|returning|rejoined/.test(e.msg)).length;
  console.log(`seed ${seed}: ${w.settlements.length} settlements, min pair distance ${minD} (${pair}), divert/return events: ${events} ${minD >= 5 ? 'PASS' : 'FAIL'}`);
}
