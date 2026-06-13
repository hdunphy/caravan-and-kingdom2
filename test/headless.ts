// Headless determinism + health test. Run: node test/headless.js [ticks] [seed]
import { generateWorld } from '../src/sim/worldgen.js';
import { run, summarize } from '../src/sim/gameLoop.js';
import { saveWorld, loadWorld } from '../src/sim/serialize.js';

const ticks = Number(process.argv[2] ?? 3000);
const seed = Number(process.argv[3] ?? 42);

console.log(`Seed ${seed}, running ${ticks} ticks...`);
const t0 = Date.now();
const world = run(generateWorld(seed, 24, 4), ticks);
console.log(`Done in ${Date.now() - t0}ms\n`);

console.table(summarize(world));
console.log(`Settlements: ${world.settlements.map(s =>
  `${s.name}(${s.tier[0]},${s.role[0]},${s.goal},pop ${Math.round(s.population)})`).join('  ')}`);
console.log(`Agents: ${world.agents.length} | Log events: ${world.log.length}`);
console.log('\nLast events:');
for (const e of world.log.slice(-10)) console.log(`  t${e.tick}: ${e.msg}`);

// Determinism check: same seed twice must match exactly
const a = JSON.stringify(summarize(run(generateWorld(99, 12, 2), 500)));
const b = JSON.stringify(summarize(run(generateWorld(99, 12, 2), 500)));
console.log(`\nDeterminism: ${a === b ? 'PASS' : 'FAIL'}`);

// Save/Load Roundtrip
let wSave = run(generateWorld(77, 12, 2), 2000);
const json = saveWorld(wSave);
let wLoad = loadWorld(json);
wSave = run(wSave, 500);
wLoad = run(wLoad, 500);
const aRoundtrip = JSON.stringify(summarize(wSave));
const bRoundtrip = JSON.stringify(summarize(wLoad));
console.log(`Roundtrip Save/Load: ${aRoundtrip === bRoundtrip ? 'PASS' : 'FAIL'}`);
if (aRoundtrip !== bRoundtrip) {
  console.log('Original summary:', aRoundtrip);
  console.log('Loaded summary:', bRoundtrip);
}

// Health assertions
const totalPop = world.settlements.reduce((acc, s) => acc + s.population, 0);
const checks = [
  ['Population survived', totalPop > 20],
  ['Villagers recruited', world.agents.some(a2 => a2.type === 'villager')],
  ['Buildings constructed', [...world.hexes.values()].some(h => h.building)],
  ['Sim produced events', world.log.length > 3],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`);
  if (!pass) ok = false;
}
process.exit(ok && a === b && aRoundtrip === bRoundtrip ? 0 : 1);
