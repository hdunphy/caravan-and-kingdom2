import { generateWorld } from '../src/sim/worldgen.js';
import { step } from '../src/sim/gameLoop.js';


const TICKS = 60000;
const SEEDS = [42, 123, 777];

function runSeed(seed) {
  const w = generateWorld(seed, 18, 3);
  let dogPiles = 0;
  let concurrentWars = 0;
  let cededSettlements = 0;
  let vassalizations = 0;
  
  // Track war dates
  const warStarts = {};
  const warEnds = {};
  const gaps = [];

  let leaderAt30k = null;
  let leaderShare30k = 0;
  
  // override console.log to intercept cession and vassalization logs
  const origLog = console.log;
  console.log = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('!!! CESSION !!!')) cededSettlements++;
    if (msg.includes('!!! SOVEREIGNTY LOSS !!!') || msg.includes('!!! CAPITULATION !!!')) vassalizations++;
    // origLog(...args); // uncomment if you want to see them
  };

  for (let t = 0; t < TICKS; t++) {
    step(w);
    
    // Check concurrent wars
    for (const f of w.factions) {
      const active = w.diplo?.wars.filter(war => war.a === f.id || war.b === f.id).length || 0;
      if (active >= 2) concurrentWars++;
    }
    
    // Check dog-piling
    // Actually, dogpiling is a bit harder to track per tick, concurrent wars naturally implies it if they overlap.
    
    if (t === 30000) {
      const pops = w.factions.map(f => w.settlements.filter(s => s.factionId === f.id).reduce((sum, s) => sum + s.population, 0));
      const maxPop = Math.max(...pops);
      const minPop = Math.min(...pops.filter(p => p > 0));
      if (minPop > 0 && maxPop / minPop >= 1.8) {
        leaderAt30k = pops.indexOf(maxPop);
        leaderShare30k = w.settlements.filter(s => s.factionId === leaderAt30k).length / w.settlements.length;
      }
    }
  }

  // Restore log
  console.log = origLog;

  let leaderShare60k = 0;
  if (leaderAt30k !== null) {
    leaderShare60k = w.settlements.filter(s => s.factionId === leaderAt30k).length / w.settlements.length;
  }

  return {
    seed,
    concurrentWars: concurrentWars > 0,
    cededSettlements,
    vassalizations,
    leaderSnowballed: leaderAt30k !== null ? (leaderShare60k > leaderShare30k) : 'N/A'
  };
}

for (const seed of SEEDS) {
  const res = runSeed(seed);
  console.log(`Seed ${seed}: Concurrent Wars: ${res.concurrentWars}, Ceded: ${res.cededSettlements}, Vassalizations: ${res.vassalizations}, Leader Snowballed: ${res.leaderSnowballed}`);
}
