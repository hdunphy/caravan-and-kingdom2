// Checkpointing war-balance diagnostic runner (plan §0 + §4).
//
// The sandbox kills any process at ~45s and doesn't persist background work, so
// a 30-40k-tick run can't finish in one call. This runner serializes the whole
// world (plus accumulated diagnostic metrics) to a JSON checkpoint after each
// chunk, then resumes from it on the next invocation. Resume is bit-exact: the
// mulberry32 RNG state is saved/restored, so checkpointed runs match
// uninterrupted ones (verified by tools/warcheck.mjs).
//
// Usage: node tools/warrun.mjs <seed> <target> [chunk] [stateFile]
//   Call repeatedly with the same args until it prints "DONE".
import fs from 'fs';
import { generateWorld } from '../src/sim/worldgen.js';
import { makeRng } from '../src/core/rng.js';
import { step } from '../src/sim/gameLoop.js';
import { settlementDefense } from '../src/sim/diplomacy.js';

const SEED = Number(process.argv[2] ?? 42);
const TARGET = Number(process.argv[3] ?? 30000);
const CHUNK = Number(process.argv[4] ?? 8000);
const STATE = process.argv[5] ?? `/tmp/warrun_${SEED}.json`;
const RECAP_WINDOW = 5000;

// ---- serialization ----
function serialize(world) {
  const plain = { ...world };
  plain.rng = { _state: world.rng.getState() };
  plain.hexes = [...world.hexes.entries()];
  plain.pathCache = undefined; // rebuilt lazily, deterministic
  plain.claims = undefined;    // rebuilt by aiSystem each cycle
  plain.diplo = { ...world.diplo, activeBattles: world.diplo.activeBattles ? [...world.diplo.activeBattles] : [] };
  return JSON.stringify(plain);
}
function deserialize(obj) {
  const world = obj;
  world.hexes = new Map(obj.hexes);
  const rng = makeRng(0); rng.setState(obj.rng._state); world.rng = rng;
  world.diplo.activeBattles = new Set(obj.diplo.activeBattles ?? []);
  world.pathCache = null;
  world.claims = world.claims ?? {};
  return world;
}

// ---- diagnostic accumulators (plain, serializable) ----
function freshDiag(world) {
  const owner = {};
  for (const s of world.settlements) owner[s.id] = s.factionId;
  return {
    owner,                       // townId -> factionId
    captures: [],                // {tick, town, loser, winner, garrison, defenseAfter, recapturedOriginal}
    lastCap: {},                 // townId -> {tick, loser}
    recapturedByOriginal: 0,
    siegeStartPop: {},           // townId -> pop at siege start
    siegeOutcomes: [],           // {town, lossPct, fell}
    soldierDeaths: 0,
    warKeys: [],
    prevSoldierIds: world.agents.filter(a => a.type === 'soldier').map(a => a.id),
  };
}

function garrisonCount(world, s) {
  return world.agents.filter(a => a.type === 'soldier' && a.factionId === s.factionId &&
    a.state === 'idle' && a.homeId === s.id && a.q === s.q && a.r === s.r).length;
}

// ---- load or init ----
let world, diag;
if (fs.existsSync(STATE)) {
  const saved = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  world = deserialize(saved.world);
  diag = saved.diag;
} else {
  world = generateWorld(SEED, 18, 3);
  diag = freshDiag(world);
}

const warKeySet = new Set(diag.warKeys);
let prevSoldierIds = new Set(diag.prevSoldierIds);

const end = Math.min(world.tick + CHUNK, TARGET);
while (world.tick < end) {
  // snapshot siege starts
  for (const s of world.settlements) {
    if (s.siegeHp != null && diag.siegeStartPop[s.id] === undefined) diag.siegeStartPop[s.id] = s.population;
  }

  step(world);

  for (const war of (world.diplo?.wars ?? [])) {
    const k = war.a + 'v' + war.b + '@' + war.since;
    if (!warKeySet.has(k)) warKeySet.add(k);
  }

  const curSoldierIds = new Set(world.agents.filter(a => a.type === 'soldier').map(a => a.id));
  for (const id of prevSoldierIds) if (!curSoldierIds.has(id)) diag.soldierDeaths++;
  prevSoldierIds = curSoldierIds;

  for (const s of world.settlements) {
    const prev = diag.owner[s.id];
    if (prev !== undefined && prev !== s.factionId) {
      const rec = { tick: world.tick, town: s.name, loser: prev, winner: s.factionId,
                    garrison: garrisonCount(world, s), defenseAfter: Math.round(settlementDefense(world, s)) };
      const last = diag.lastCap[s.id];
      if (last && s.factionId === last.loser && (world.tick - last.tick) <= RECAP_WINDOW) {
        diag.recapturedByOriginal++;
        rec.recapturedOriginal = true;
      }
      diag.captures.push(rec);
      diag.lastCap[s.id] = { tick: world.tick, loser: prev };
      if (diag.siegeStartPop[s.id] !== undefined) {
        const start = diag.siegeStartPop[s.id];
        diag.siegeOutcomes.push({ town: s.name, lossPct: 100 * (1 - s.population / Math.max(1, start)), fell: true });
        delete diag.siegeStartPop[s.id];
      }
    }
    diag.owner[s.id] = s.factionId;
  }
  for (const tid of Object.keys(diag.siegeStartPop)) {
    const s = world.settlements.find(x => String(x.id) === tid);
    if (!s) { delete diag.siegeStartPop[tid]; continue; }
    if (s.siegeHp == null) {
      diag.siegeOutcomes.push({ town: s.name, lossPct: 100 * (1 - s.population / Math.max(1, diag.siegeStartPop[tid])), fell: false });
      delete diag.siegeStartPop[tid];
    }
  }
}

diag.warKeys = [...warKeySet];
diag.prevSoldierIds = [...prevSoldierIds];

if (world.tick < TARGET) {
  fs.writeFileSync(STATE, JSON.stringify({ world: JSON.parse(serialize(world)), diag }));
  console.log(`PROGRESS seed ${SEED}: ${world.tick}/${TARGET} ticks (caps ${diag.captures.length}, sDeaths ${diag.soldierDeaths})`);
} else {
  // final report
  const popOf = fid => world.settlements.filter(s => s.factionId === fid).reduce((a, s) => a + s.population, 0);
  const livingPops = world.factions.filter(f => !f.eliminated).map(f => popOf(f.id)).filter(p => p > 0);
  const spread = livingPops.length ? Math.max(...livingPops) / Math.min(...livingPops) : 0;
  const fell = diag.siegeOutcomes.filter(o => o.fell);
  const avgFell = fell.length ? fell.reduce((a, o) => a + o.lossPct, 0) / fell.length : 0;
  const result = {
    seed: SEED, ticks: world.tick,
    captures: diag.captures.length,
    garrisonZero: diag.captures.filter(c => c.garrison === 0).length,
    avgGarrison: diag.captures.length ? (diag.captures.reduce((a, c) => a + c.garrison, 0) / diag.captures.length).toFixed(1) : '0',
    avgDefenseAfter: diag.captures.length ? Math.round(diag.captures.reduce((a, c) => a + c.defenseAfter, 0) / diag.captures.length) : 0,
    recapturedByOriginal: diag.recapturedByOriginal,
    recapPct: diag.captures.length ? Math.round(100 * diag.recapturedByOriginal / diag.captures.length) : 0,
    successfulSieges: fell.length,
    avgFellLossPct: avgFell.toFixed(1),
    failedSieges: diag.siegeOutcomes.filter(o => !o.fell).length,
    warsObserved: warKeySet.size,
    soldierDeaths: diag.soldierDeaths,
    eliminated: world.factions.filter(f => f.eliminated).length,
    powerSpread: spread.toFixed(2),
    livingPops: livingPops.map(p => Math.round(p)),
  };
  console.log('RESULT ' + JSON.stringify(result));
  fs.writeFileSync(STATE.replace(/\.json$/, '') + '.result.json', JSON.stringify(result));
  try { fs.unlinkSync(STATE); } catch {}
  console.log('DONE');
}
