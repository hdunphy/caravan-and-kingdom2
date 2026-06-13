// cmp.mjs — proves the hardcoded player changes AI-only behavior
import { generateWorld } from './src/sim/worldgen.ts';
import { run, summarize } from './src/sim/gameLoop.ts';
const wPlayer = run(generateWorld(42, 24, 4), 2500);
const wObs = generateWorld(42, 24, 4); wObs.playerFactionId = null; run(wObs, 2500);
console.log(JSON.stringify(summarize(wPlayer)) === JSON.stringify(summarize(wObs))
  ? 'IDENTICAL' : 'DIVERGES');
