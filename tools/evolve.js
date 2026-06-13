import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { generateWorld } from '../src/sim/worldgen.js';
import { step, summarize } from '../src/sim/gameLoop.js';
import { makeRng } from '../src/core/rng.js';

// Read seed from CLI args
const GA_SEED = Number(process.argv[2] ?? 1337);
const rng = makeRng(GA_SEED);

// Number of generations and ticks
const GENERATIONS = 3;
const TICKS_PER_GAME = 8000;
const POP_SIZE = 6;
const SEEDS = [42, 123, 777];

// Default base traits from constants.js
const DEFAULTS = {
  0: { expand: 0.9, trade: 1.5, industry: 1.0, aggression: 0.6 }, // Aurelia
  1: { expand: 1.5, trade: 0.9, industry: 0.9, aggression: 1.2 }, // Vesper
  2: { expand: 0.9, trade: 0.8, industry: 1.3, aggression: 1.4 }, // Thornwall
};

// Persona fitness weights (Option A)
const PERSONA_WEIGHTS = {
  0: { popW: 0.3, goldW: 1.0, tradeW: 1.5, settleW: 0.5, capW: 0.0 },  // Aurelia: commerce
  1: { popW: 0.6, goldW: 0.2, tradeW: 0.2, settleW: 1.5, capW: 0.3 },  // Vesper: expansion
  2: { popW: 0.6, goldW: 0.2, tradeW: 0.0, settleW: 0.4, capW: 1.5 },  // Thornwall: conquest
};

// Generate initial populations by perturbing defaults
function initPopulation(baseTraits) {
  const pop = [];
  for (let i = 0; i < POP_SIZE; i++) {
    // Chromosome index 0 is always the pure default (baseline)
    if (i === 0) {
      pop.push({ ...baseTraits });
    } else {
      pop.push({
        expand: clamp(baseTraits.expand + (rng.next() * 0.6 - 0.3), 0.5, 2.5),
        trade: clamp(baseTraits.trade + (rng.next() * 0.6 - 0.3), 0.5, 2.5),
        industry: clamp(baseTraits.industry + (rng.next() * 0.6 - 0.3), 0.5, 2.5),
        aggression: clamp(baseTraits.aggression + (rng.next() * 0.6 - 0.3), 0.5, 2.5),
      });
    }
  }
  return pop;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// Run single simulation and return death ticks + total ticks run
function runSim(world, totalTicks) {
  const deaths = { 0: null, 1: null, 2: null };
  let ticksRun = 0;
  for (let t = 0; t < totalTicks; t++) {
    step(world);
    ticksRun = t + 1;
    for (let fid = 0; fid < 3; fid++) {
      if (world.factions[fid].eliminated && deaths[fid] === null) {
        deaths[fid] = t + 1;
      }
    }
    const aliveCount = world.factions.slice(0, 3).filter(f => !f.eliminated).length;
    if (aliveCount <= 1) break;
  }
  return { deaths, ticksRun };
}

function calculateFitness(world, fid, deaths, ticksRun, totalTicks) {
  const isDead = world.factions[fid].eliminated;
  if (isDead) {
    const deathTick = deaths[fid] ?? ticksRun;
    return (deathTick / totalTicks) * 50;
  } else {
    const summary = summarize(world)[fid];
    const pop = summary ? summary.population : 0;
    const gold = summary ? summary.gold : 0;
    const settlements = summary ? summary.settlements : 0;
    const trades = world.stats?.trades?.[fid] ?? 0;
    const captures = world.stats?.captures?.[fid] ?? 0;

    const w = PERSONA_WEIGHTS[fid];
    const popNorm = (pop / 4000) * 100;
    const goldNorm = (gold / 5000) * 100;
    const tradeNorm = (trades / 100) * 100;
    const settleNorm = (settlements / 12) * 100;
    const capNorm = (captures / 5) * 100;

    return 100 +
      w.popW * popNorm +
      w.goldW * goldNorm +
      w.tradeW * tradeNorm +
      w.settleW * settleNorm +
      w.capW * capNorm;
  }
}

// Evolutionary operators
function crossover(p1, p2) {
  const child = {};
  for (const gene of ['expand', 'trade', 'industry', 'aggression']) {
    // Blend crossover
    const blend = rng.next();
    child[gene] = clamp(p1[gene] * blend + p2[gene] * (1 - blend), 0.5, 2.5);
  }
  return child;
}

function mutate(chromo) {
  const mutated = { ...chromo };
  for (const gene of ['expand', 'trade', 'industry', 'aggression']) {
    if (rng.next() < 0.25) {
      // Perturb gene
      mutated[gene] = clamp(chromo[gene] + (rng.next() * 0.5 - 0.25), 0.5, 2.5);
    }
  }
  return mutated;
}

function selectParent(pop, fitnesses) {
  // Tournament selection
  const tSize = 3;
  let bestIdx = Math.floor(rng.next() * pop.length);
  for (let i = 1; i < tSize; i++) {
    const idx = Math.floor(rng.next() * pop.length);
    if (fitnesses[idx] > fitnesses[bestIdx]) {
      bestIdx = idx;
    }
  }
  return pop[bestIdx];
}

function runMatchWorker(traitsA, traitsV, traitsT, gen, round, matchIdx, idxA, idxV, idxT) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      execArgv: process.execArgv,
      workerData: {
        traitsA,
        traitsV,
        traitsT,
        gen,
        round,
        matchIdx,
        idxA,
        idxV,
        idxT
      }
    });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

// Evolve the populations
async function evolve() {
  console.log('--- Playstyle Genetic Algorithm (GA) Co-Evolution ---');
  console.log(`GA Seed: ${GA_SEED}`);
  console.log(`Populations: 3 (Aurelia, Vesper, Thornwall) | Size: ${POP_SIZE}`);
  console.log(`Generations: ${GENERATIONS} | Sim ticks: ${TICKS_PER_GAME} | Seeds: ${SEEDS.join(', ')}\n`);

  let aureliaPop = initPopulation(DEFAULTS[0]);
  let vesperPop = initPopulation(DEFAULTS[1]);
  let thornwallPop = initPopulation(DEFAULTS[2]);

  for (let gen = 1; gen <= GENERATIONS; gen++) {
    console.log(`\n=== Generation ${gen}/${GENERATIONS} ===`);
    const aurFitnesses = new Array(POP_SIZE).fill(0);
    const vesFitnesses = new Array(POP_SIZE).fill(0);
    const thoFitnesses = new Array(POP_SIZE).fill(0);

    // We do 2 rounds of pairings so every chromosome plays 2 matches
    for (let round = 0; round < 2; round++) {
      const vShift = round === 0 ? 0 : 2;
      const tShift = round === 0 ? 0 : 4;

      const promises = [];
      for (let i = 0; i < POP_SIZE; i++) {
        const idxA = i;
        const idxV = (i + vShift) % POP_SIZE;
        const idxT = (i + tShift) % POP_SIZE;

        promises.push(
          runMatchWorker(
            aureliaPop[idxA],
            vesperPop[idxV],
            thornwallPop[idxT],
            gen,
            round,
            i,
            idxA,
            idxV,
            idxT
          )
        );
      }

      // Wait for all matches in this round to complete
      const results = await Promise.all(promises);

      // Accumulate in fixed index order to guarantee float addition order determinism
      for (let i = 0; i < POP_SIZE; i++) {
        const idxA = i;
        const idxV = (i + vShift) % POP_SIZE;
        const idxT = (i + tShift) % POP_SIZE;

        const res = results[i];
        aurFitnesses[idxA] += res.fitA;
        vesFitnesses[idxV] += res.fitV;
        thoFitnesses[idxT] += res.fitT;
      }
    }

    // Average the fitness over the 2 matches played
    for (let i = 0; i < POP_SIZE; i++) {
      aurFitnesses[i] /= 2;
      vesFitnesses[i] /= 2;
      thoFitnesses[i] /= 2;
    }

    // Leaderboard
    const printLeaderboard = (name, pop, fitnesses) => {
      const idxs = [...Array(POP_SIZE).keys()].sort((a, b) => fitnesses[b] - fitnesses[a]);
      console.log(`Leaderboard for ${name}:`);
      for (let k = 0; k < 3; k++) {
        if (k >= POP_SIZE) break;
        const idx = idxs[k];
        const chr = pop[idx];
        const isDefault = idx === 0;
        console.log(`  #${k+1}: Fit: ${fitnesses[idx].toFixed(1)} | [exp: ${chr.expand.toFixed(2)}, trd: ${chr.trade.toFixed(2)}, ind: ${chr.industry.toFixed(2)}, agg: ${chr.aggression.toFixed(2)}]${isDefault ? ' (Default)' : ''}`);
      }
    };

    printLeaderboard('Aurelia', aureliaPop, aurFitnesses);
    printLeaderboard('Vesper', vesperPop, vesFitnesses);
    printLeaderboard('Thornwall', thornwallPop, thoFitnesses);

    // Evolve next generation (unless it's the last generation)
    if (gen < GENERATIONS) {
      const createNextGen = (pop, fitnesses, factionId) => {
        const nextPop = [];
        const idxs = [...Array(POP_SIZE).keys()].sort((a, b) => fitnesses[b] - fitnesses[a]);
        
        // Slot 0 is always the persistent control chromosome (pure default)
        nextPop.push({ ...DEFAULTS[factionId] });

        // Elitism: Keep top 2 best chromosomes in slots 1 and 2
        for (let k = 0; k < 2; k++) {
          nextPop.push({ ...pop[idxs[k]] });
        }

        // Fill remaining population
        while (nextPop.length < POP_SIZE) {
          const p1 = selectParent(pop, fitnesses);
          const p2 = selectParent(pop, fitnesses);
          let child = crossover(p1, p2);
          child = mutate(child);
          nextPop.push(child);
        }
        return nextPop;
      };

      aureliaPop = createNextGen(aureliaPop, aurFitnesses, 0);
      vesperPop = createNextGen(vesperPop, vesFitnesses, 1);
      thornwallPop = createNextGen(thornwallPop, thoFitnesses, 2);
    } else {
      // Last generation: save the absolute best of each population
      const getBest = (pop, fitnesses) => {
        let bestIdx = 0;
        for (let i = 1; i < POP_SIZE; i++) {
          if (fitnesses[i] > fitnesses[bestIdx]) bestIdx = i;
        }
        return { chromo: pop[bestIdx], fitness: fitnesses[bestIdx], defaultFitness: fitnesses[0] };
      };

      const resAur = getBest(aureliaPop, aurFitnesses);
      const resVes = getBest(vesperPop, vesFitnesses);
      const resTho = getBest(thornwallPop, thoFitnesses);

      const evolvedTraits = {
        0: { name: 'Aurelia', traits: resAur.chromo, persona: 'Optimized Mercantile' },
        1: { name: 'Vesper', traits: resVes.chromo, persona: 'Optimized Expansionist' },
        2: { name: 'Thornwall', traits: resTho.chromo, persona: 'Optimized Industrious' },
      };

      fs.writeFileSync('evolved_traits.json', JSON.stringify(evolvedTraits, null, 2));
      console.log('\nSuccess! Evolved traits saved to evolved_traits.json');

      console.log('\n=== Improvement Over Defaults ===');
      const logImp = (name, res) => {
        const imp = res.fitness - res.defaultFitness;
        console.log(`${name}: Default Fit: ${res.defaultFitness.toFixed(1)} | Best Fit: ${res.fitness.toFixed(1)} | Improvement: ${imp.toFixed(1)}`);
      };
      logImp('Aurelia', resAur);
      logImp('Vesper', resVes);
      logImp('Thornwall', resTho);
      console.log();
    }
  }
}

if (isMainThread) {
  evolve();
} else {
  // Worker Thread Execution
  const { traitsA, traitsV, traitsT, gen, round, matchIdx, idxA, idxV, idxT } = workerData;
  const matchStart = Date.now();
  
  let totalFitA = 0;
  let totalFitV = 0;
  let totalFitT = 0;

  for (const seed of SEEDS) {
    const world = generateWorld(seed, 18, 3);
    world.factions[0].traits = { ...traitsA };
    world.factions[1].traits = { ...traitsV };
    world.factions[2].traits = { ...traitsT };

    const { deaths, ticksRun } = runSim(world, TICKS_PER_GAME);

    totalFitA += calculateFitness(world, 0, deaths, ticksRun, TICKS_PER_GAME);
    totalFitV += calculateFitness(world, 1, deaths, ticksRun, TICKS_PER_GAME);
    totalFitT += calculateFitness(world, 2, deaths, ticksRun, TICKS_PER_GAME);
  }

  const matchElapsed = Date.now() - matchStart;
  console.log(`  [Gen ${gen} Rnd ${round} Match ${matchIdx}] A#${idxA} V#${idxV} T#${idxT} completed in ${matchElapsed}ms`);

  parentPort.postMessage({
    fitA: totalFitA / SEEDS.length,
    fitV: totalFitV / SEEDS.length,
    fitT: totalFitT / SEEDS.length,
  });
  process.exit(0);
}
