import { generateWorld } from './src/sim/worldgen.js';
import { run } from './src/sim/gameLoop.js';
const seed = Number(process.argv[2]);
const t0 = Date.now();
const w = run(generateWorld(seed, 18, 3), 15000);
console.log(`seed ${seed} (${Date.now()-t0}ms): ${w.settlements.length} settlements, agents ${w.agents.length}`);
for (const s of w.settlements) {
  console.log(`  ${s.name} ${s.tier[0]} ${s.role[0]} goal=${s.goal} pop=${Math.round(s.population)} f${Math.round(s.stock.food)}/t${Math.round(s.stock.timber)}/s${Math.round(s.stock.stone)}/o${Math.round(s.stock.ore)} gold=${Math.round(s.gold)}`);
}
