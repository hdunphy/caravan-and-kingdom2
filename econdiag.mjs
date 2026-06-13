// Economic & military diagnostic: tracks gold flows, siege success, relations over time
import { generateWorld } from './src/sim/worldgen.js';
import { step } from './src/sim/gameLoop.js';
import { getRelation, settlementDefense, strengthOf, soldiersOf, armyCap } from './src/sim/diplomacy.js';
import { DIPLO, ECON } from './src/core/constants.js';

const TICKS = 10000;
const SEED = 42;

const w = generateWorld(SEED, 18, 3);

const snapshots = [];
let siegeEvents = [];

for (let t = 0; t < TICKS; t++) {
  const prevSettlementOwners = new Map(w.settlements.map(s => [s.id, s.factionId]));
  
  step(w);
  
  // Every 500 ticks, snapshot
  if (w.tick % 500 === 0) {
    const snap = { tick: w.tick, factions: [] };
    for (const f of w.factions) {
      if (f.eliminated) continue;
      const setts = w.settlements.filter(s => s.factionId === f.id);
      const totalGold = setts.reduce((a, s) => a + s.gold, 0);
      const totalPop = setts.reduce((a, s) => a + s.population, 0);
      const soldiers = soldiersOf(w, f.id);
      const cap = armyCap(w, f.id);
      const str = strengthOf(w, f.id);
      
      let taxIncome = 0;
      let wageBill = 0;
      for (const s of setts) {
        const factionCount = setts.length;
        const widePenalty = Math.max(1.0 - ECON.WIDE_TAX_MAX_PENALTY, 1.0 - ECON.WIDE_TAX_CORRUPTION * Math.max(0, factionCount - ECON.WIDE_TAX_THRESHOLD));
        const taxable = Math.min(s.population, 150);
        taxIncome += taxable * ECON.GOLD_INCOME_PER_POP * widePenalty;
        
        const staff = w.agents.filter(a => a.homeId === s.id && a.type !== 'settler');
        for (const a of staff) {
          wageBill += a.type === 'caravan' ? ECON.WAGE_CARAVAN : a.type === 'soldier' ? DIPLO.WAGE_SOLDIER : ECON.WAGE_VILLAGER;
        }
      }
      
      const rels = {};
      for (const other of w.factions) {
        if (other.id !== f.id && !other.eliminated) {
          rels[other.name] = Math.round(getRelation(w, f.id, other.id));
        }
      }
      
      snap.factions.push({
        name: f.name,
        settlements: setts.length,
        pop: Math.round(totalPop),
        gold: Math.round(totalGold),
        soldiers: soldiers.length,
        armyCap: cap,
        str: Math.round(str),
        taxPerTick: +taxIncome.toFixed(3),
        wagePerTick: +wageBill.toFixed(3),
        netGoldPerTick: +(taxIncome - wageBill).toFixed(3),
        relations: rels,
      });
    }
    
    snap.wars = (w.diplo?.wars ?? []).map(war => ({
      sides: `${w.factions[war.a].name} vs ${w.factions[war.b].name}`,
      duration: w.tick - war.since,
      exhA: +war.exh[war.a].toFixed(1),
      exhB: +war.exh[war.b].toFixed(1),
    }));
    
    snapshots.push(snap);
  }
  
  for (const s of w.settlements) {
    const prev = prevSettlementOwners.get(s.id);
    if (prev !== undefined && prev !== s.factionId) {
      siegeEvents.push({ tick: w.tick, town: s.name, from: w.factions[prev]?.name, to: w.factions[s.factionId]?.name });
    }
  }
}

console.log('=== ECONOMIC & MILITARY DIAGNOSTIC ===');
console.log(`Seed: ${SEED}, Ticks: ${TICKS}\n`);

for (const snap of snapshots) {
  console.log(`--- Tick ${snap.tick} ---`);
  console.table(snap.factions.map(f => ({
    faction: f.name,
    setts: f.settlements,
    pop: f.pop,
    gold: f.gold,
    soldiers: `${f.soldiers}/${f.armyCap}`,
    strength: f.str,
    'tax/t': f.taxPerTick,
    'wage/t': f.wagePerTick,
    'net/t': f.netGoldPerTick,
  })));
  
  for (const f of snap.factions) {
    console.log(`  ${f.name} relations:`, f.relations);
  }
  
  if (snap.wars.length > 0) {
    console.log('  Active wars:', snap.wars);
  }
  console.log('');
}

console.log('=== CAPTURES ===');
if (siegeEvents.length === 0) {
  console.log('NO SETTLEMENTS CAPTURED IN', TICKS, 'TICKS');
} else {
  console.table(siegeEvents);
}

console.log('\n=== SETTLEMENT DEFENSE VALUES ===');
for (const s of w.settlements) {
  const def = settlementDefense(w, s);
  const garrison = w.agents.filter(a => a.type === 'soldier' && a.factionId === s.factionId && 
    a.state === 'idle' && a.q === s.q && a.r === s.r).length;
  console.log(`  ${s.name} (${s.tier}, pop ${Math.round(s.population)}, ${w.factions[s.factionId].name}): defense=${Math.round(def)}, garrison=${garrison}`);
}

console.log('\n=== SIEGE MATH ===');
const testDef = 50;
const testBulwark = DIPLO.SIEGE_BULWARK;
const totalSiegeHP = testDef + testBulwark;
console.log(`Typical village: defense=${testDef}, bulwark=${testBulwark}, total HP=${totalSiegeHP}`);
console.log(`SIEGE_ATTACK=${DIPLO.SIEGE_ATTACK}, per soldier at 100%: ${DIPLO.SOLDIER_STRENGTH * DIPLO.SIEGE_ATTACK}`);
console.log(`With 10 soldiers: ${10 * DIPLO.SOLDIER_STRENGTH * DIPLO.SIEGE_ATTACK} HP/tick`);
console.log(`Ticks to breach village: ${Math.round(totalSiegeHP / (10 * DIPLO.SOLDIER_STRENGTH * DIPLO.SIEGE_ATTACK))}`);
console.log(`Counter damage per soldier per tick from village: ${(totalSiegeHP * DIPLO.SIEGE_DEFEND) / 10}`);
console.log(`Soldier field decay/tick: ${DIPLO.SOLDIER_FIELD_DECAY}`);
