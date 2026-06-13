// War-balance diagnostic (plan §0 + §4).
// Steps tick-by-tick, detecting captures by ownership change, and records per
// capture: garrison re-homed, settlementDefense after, and whether the town is
// recaptured by its original owner within RECAP_WINDOW ticks. Also tracks siege
// casualties, soldier deaths per war, and end-state power spread.
//
// Usage: node tools/wardiag2.mjs [ticks] [seed1,seed2,...]
import { generateWorld } from '../src/sim/worldgen.js';
import { step } from '../src/sim/gameLoop.js';
import { settlementDefense } from '../src/sim/diplomacy.js';

const TICKS = Number(process.argv[2] ?? 30000);
const SEEDS = (process.argv[3] ?? '42,123,777').split(',').map(Number);
const RECAP_WINDOW = 5000;

function popOf(world, fid) {
  return world.settlements.filter(s => s.factionId === fid).reduce((a, s) => a + s.population, 0);
}
function garrisonCount(world, s) {
  return world.agents.filter(a => a.type === 'soldier' && a.factionId === s.factionId &&
    a.state === 'idle' && a.homeId === s.id && a.q === s.q && a.r === s.r).length;
}

function runSeed(seed) {
  const w = generateWorld(seed, 18, 3);
  const owner = new Map();              // townId -> current factionId
  for (const s of w.settlements) owner.set(s.id, s.factionId);

  const captures = [];                  // {tick, town, townId, loser, winner, garrison, defenseAfter, recapturedBy, recapTick}
  const lastCap = new Map();            // townId -> last capture record
  let recapturedByOriginal = 0;

  // Siege casualty tracking: snapshot pop when a siege starts, measure when it ends/falls.
  const siegeStartPop = new Map();      // townId -> pop at siege start
  const siegeOutcomes = [];             // {town, lossPct, fell}

  // Soldier deaths per war: count agents disappearing that were soldiers.
  let soldierDeaths = 0;
  let warsObserved = 0;
  const warKeys = new Set();

  let prevSoldierIds = new Set(w.agents.filter(a => a.type === 'soldier').map(a => a.id));

  for (let t = 0; t < TICKS; t++) {
    // snapshot siege starts (pop at the tick a siege becomes active)
    for (const s of w.settlements) {
      if (s.siegeHp != null && !siegeStartPop.has(s.id)) siegeStartPop.set(s.id, s.population);
    }

    step(w);

    // track wars seen
    for (const war of (w.diplo?.wars ?? [])) {
      const k = war.a + 'v' + war.b + '@' + war.since;
      if (!warKeys.has(k)) { warKeys.add(k); warsObserved++; }
    }

    // soldier deaths
    const curSoldierIds = new Set(w.agents.filter(a => a.type === 'soldier').map(a => a.id));
    for (const id of prevSoldierIds) if (!curSoldierIds.has(id)) soldierDeaths++;
    prevSoldierIds = curSoldierIds;

    // detect ownership changes (captures)
    for (const s of w.settlements) {
      const prev = owner.get(s.id);
      if (prev !== undefined && prev !== s.factionId) {
        const rec = { tick: w.tick, town: s.name, townId: s.id, loser: prev, winner: s.factionId,
                      garrison: garrisonCount(w, s), defenseAfter: Math.round(settlementDefense(w, s)) };
        // recapture-by-original check
        const last = lastCap.get(s.id);
        if (last && s.factionId === last.loser && (w.tick - last.tick) <= RECAP_WINDOW) {
          recapturedByOriginal++;
          rec.recapturedOriginal = true;
        }
        captures.push(rec);
        lastCap.set(s.id, rec);
        // siege outcome: town fell
        if (siegeStartPop.has(s.id)) {
          const start = siegeStartPop.get(s.id);
          siegeOutcomes.push({ town: s.name, lossPct: 100 * (1 - s.population / Math.max(1, start)), fell: true });
          siegeStartPop.delete(s.id);
        }
      }
      owner.set(s.id, s.factionId);
    }
    // detect lifted sieges (no capture) -> record loss, scars from failed sieges
    for (const [tid, start] of [...siegeStartPop.entries()]) {
      const s = w.settlements.find(x => x.id === tid);
      if (!s) { siegeStartPop.delete(tid); continue; }
      if (s.siegeHp == null) {
        siegeOutcomes.push({ town: s.name, lossPct: 100 * (1 - s.population / Math.max(1, start)), fell: false });
        siegeStartPop.delete(tid);
      }
    }
  }

  // power spread among living factions
  const livingPops = w.factions.filter(f => !f.eliminated).map(f => popOf(w, f.id)).filter(p => p > 0);
  const spread = livingPops.length ? Math.max(...livingPops) / Math.min(...livingPops) : 0;
  const eliminated = w.factions.filter(f => f.eliminated).length;

  const fellCaps = siegeOutcomes.filter(o => o.fell);
  const avgFellLoss = fellCaps.length ? fellCaps.reduce((a, o) => a + o.lossPct, 0) / fellCaps.length : 0;

  return {
    seed, ticks: w.tick,
    captures: captures.length,
    garrisonZero: captures.filter(c => c.garrison === 0).length,
    avgGarrison: captures.length ? (captures.reduce((a, c) => a + c.garrison, 0) / captures.length).toFixed(1) : '0',
    avgDefenseAfter: captures.length ? Math.round(captures.reduce((a, c) => a + c.defenseAfter, 0) / captures.length) : 0,
    recapturedByOriginal,
    recapPct: captures.length ? Math.round(100 * recapturedByOriginal / captures.length) : 0,
    successfulSieges: fellCaps.length,
    avgFellLossPct: avgFellLoss.toFixed(1),
    failedSieges: siegeOutcomes.filter(o => !o.fell).length,
    warsObserved,
    soldierDeaths,
    eliminated,
    powerSpread: spread.toFixed(2),
    livingPops: livingPops.map(p => Math.round(p)),
  };
}

const results = [];
for (const seed of SEEDS) {
  const r = runSeed(seed);
  results.push(r);
  console.log(JSON.stringify(r));
}
console.log('\n=== SUMMARY ===');
console.table(results.map(r => ({
  seed: r.seed, caps: r.captures, garr0: r.garrisonZero, avgGarr: r.avgGarrison,
  recap: r.recapturedByOriginal + '/' + r.captures + ' (' + r.recapPct + '%)',
  succSieges: r.successfulSieges, avgFellLoss: r.avgFellLossPct + '%',
  wars: r.warsObserved, sDeaths: r.soldierDeaths, elim: r.eliminated, spread: r.powerSpread,
})));
console.log('DONE');
