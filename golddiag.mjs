import { generateWorld } from './src/sim/worldgen.js';
import { run, summarize } from './src/sim/gameLoop.js';
const w = generateWorld(123, 18, 3);
for (const t of [3000, 6000, 9000, 12000]) {
  run(w, 3000);
  const s = summarize(w);
  console.log(`t${t}: ` + s.map(f => `${f.faction} pop=${f.population} gold=${f.gold} v=${f.villagers} c=${f.caravans}`).join(' | '));
}
