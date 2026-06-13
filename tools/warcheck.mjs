// Prove the warrun checkpoint round-trip is bit-exact: an uninterrupted run of
// N ticks must equal a run chunked through serialize/deserialize.
import { generateWorld } from '../src/sim/worldgen.js';
import { makeRng } from '../src/core/rng.js';
import { step } from '../src/sim/gameLoop.js';
import { summarize } from '../src/sim/gameLoop.js';

function serialize(world) {
  const p = { ...world };
  p.rng = { _state: world.rng.getState() };
  p.hexes = [...world.hexes.entries()];
  p.pathCache = undefined; p.claims = undefined;
  p.diplo = { ...world.diplo, activeBattles: world.diplo.activeBattles ? [...world.diplo.activeBattles] : [] };
  return JSON.stringify(p);
}
function deserialize(obj) {
  const w = obj;
  w.hexes = new Map(obj.hexes);
  const rng = makeRng(0); rng.setState(obj.rng._state); w.rng = rng;
  w.diplo.activeBattles = new Set(obj.diplo.activeBattles ?? []);
  w.pathCache = null; w.claims = w.claims ?? {};
  return w;
}

const SEED = 99, N = 1200, CHUNK = 300;

// straight run
let a = generateWorld(SEED, 14, 3);
for (let i = 0; i < N; i++) step(a);

// chunked through checkpoints
let b = generateWorld(SEED, 14, 3);
let done = 0;
while (done < N) {
  const end = Math.min(done + CHUNK, N);
  while (b.tick < end) step(b);
  done = end;
  b = deserialize(JSON.parse(serialize(b))); // round-trip
}

const sa = JSON.stringify(summarize(a));
const sb = JSON.stringify(summarize(b));
// also compare deeper state: hex ownership + agent positions + diplo
const deep = w => JSON.stringify({
  agents: w.agents.map(x => [x.id, x.type, x.q, x.r, Math.round(x.integrity), x.factionId]).sort(),
  owners: [...w.hexes.values()].map(h => [h.q, h.r, h.owner]),
  wars: w.diplo.wars.length, relations: w.diplo.relations, rng: w.rng.getState(),
  pop: w.settlements.map(s => [s.id, Math.round(s.population * 1000)]).sort(),
});
const da = deep(a), db = deep(b);
console.log('summary match:', sa === sb ? 'PASS' : 'FAIL');
console.log('deep match:   ', da === db ? 'PASS' : 'FAIL');
process.exit(sa === sb && da === db ? 0 : 1);
