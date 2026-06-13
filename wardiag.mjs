// Diplomacy diagnostics: wars, peaces, captures, eliminations over a long run.
import { generateWorld } from './src/sim/worldgen.js';
import { run } from './src/sim/gameLoop.js';
const seed = Number(process.argv[2] ?? 42);
const ticks = Number(process.argv[3] ?? 10000);
const w = generateWorld(seed, 18, 3);
const events = { war: 0, peace: 0, capture: 0, fallen: 0, siege: 0, tribute: 0 };
const seen = new Set();
for (let i = 0; i < ticks; i += 500) {
  run(w, 500);
  for (const e of w.log) {
    const id = e.tick + e.msg;
    if (seen.has(id)) continue;
    seen.add(id);
    if (/declared WAR/.test(e.msg)) { events.war++; console.log('t' + e.tick, e.msg); }
    if (/peace/.test(e.msg)) { events.peace++; console.log('t' + e.tick, e.msg); }
    if (/CAPTURED/.test(e.msg)) { events.capture++; console.log('t' + e.tick, e.msg); }
    if (/has fallen/.test(e.msg)) { events.fallen++; console.log('t' + e.tick, e.msg); }
    if (/under siege/.test(e.msg)) events.siege++;
    if (/tribute/.test(e.msg)) events.tribute++;
  }
}
console.log('\nseed', seed, 'after', w.tick, 'ticks:', JSON.stringify(events));
for (const f of w.factions) {
  const towns = w.settlements.filter(s => s.factionId === f.id);
  const soldiers = w.agents.filter(a => a.factionId === f.id && a.type === 'soldier').length;
  console.log(' ', f.name, f.eliminated ? 'ELIMINATED' : `${towns.length} towns, pop ${Math.round(towns.reduce((a, s) => a + s.population, 0))}, ${soldiers} soldiers, ${Math.round(towns.reduce((a, s) => a + s.gold, 0))}g`);
}
console.log('  relations:', JSON.stringify(Object.fromEntries(Object.entries(w.diplo.relations).map(([k, v]) => [k, Math.round(v)]))));
console.log('  active wars:', w.diplo.wars.length, '| truces:', Object.keys(w.diplo.truces).length);
