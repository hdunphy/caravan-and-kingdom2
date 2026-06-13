import { generateWorld } from '../src/sim/worldgen.js';
import { run } from '../src/sim/gameLoop.js';

const seed = 42;
const ticks = 10000;
const world = generateWorld(seed, 24, 4);

// Override the world logger to output directly to console
world.log = [];
const oldLog = world.log.push;
world.log.push = function(e) {
  const msg = e.msg;
  if (
    msg.includes('Defensive Pact') ||
    msg.includes('Embargo') ||
    msg.includes('SOVEREIGNTY') ||
    msg.includes('REBELLION') ||
    msg.includes('ANNEXATION') ||
    msg.includes('tribute') ||
    msg.includes('declared WAR') ||
    msg.includes('enters the war') ||
    msg.includes('dragged into the war')
  ) {
    console.log(`[t${e.tick}] ${msg}`);
  }
  return oldLog.apply(this, arguments);
};

console.log(`Running simulation for ${ticks} ticks...`);
run(world, ticks);
console.log("Simulation complete!");

console.log("\n--- FINAL RELATIONS ---");
for (let a = 0; a < world.factions.length; a++) {
  for (let b = a + 1; b < world.factions.length; b++) {
    const k = Math.min(a, b) + '|' + Math.max(a, b);
    const r = world.diplo.relations[k] ?? 0;
    console.log(`${world.factions[a].name} - ${world.factions[b].name}: ${r}`);
  }
}

console.log("\n--- FINAL ACTIVE PACTS ---");
console.log(world.diplo.pacts);
