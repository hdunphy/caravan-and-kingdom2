// Settlement lifecycle: founding, tiers, roles, territory, stock helpers.
import { key, range } from '../core/hex.js';
import { TIERS, ROLES, GOALS, ECON, BUILDINGS } from '../core/constants.js';
import { treasuryOf, spendGold } from './economy.js';
import { getModifier } from './systems/events.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy, Alert } from '../types.js';

const NAME_PARTS_A = ['Ald', 'Bren', 'Cor', 'Dun', 'Eld', 'Fen', 'Gold', 'Hav', 'Iron', 'Karn', 'Lor', 'Mer', 'Nor', 'Oak', 'Pell', 'Quill', 'Rav', 'Stone', 'Thorn', 'Vale'];
const NAME_PARTS_B = ['burg', 'dale', 'ford', 'haven', 'holm', 'mark', 'mere', 'stead', 'ton', 'wick'];

export function foundSettlement(world: World, factionId: number, q: number, r: number, startPop: number) {
  const id = world.nextId++;
  const s: Settlement = {
    id, factionId, q, r,
    name: world.rng.pick(NAME_PARTS_A) + world.rng.pick(NAME_PARTS_B),
    tier: 'VILLAGE',
    population: startPop,
    stock: { food: 80, timber: 80, stone: 20, ore: 0 },
    gold: ECON.GOLD_START,
    tools: 1,
    goal: GOALS.DEVELOP,
    role: ROLES.GENERAL,
    focus: null,            // labor governor's resource focus
    buildings: [],          // non-hex buildings (warehouse, market hall)
    integrity: 100,
    pendingSettler: false,
  };
  world.settlements.push(s);
  claimTerritory(world, s);
  s.role = computeRole(world, s);
  world.pathCache?.clear();
  log(world, `${s.name} founded by ${world.factions[factionId].name} (${s.role})`);
  return s;
}

export function claimTerritory(world: World, s: Settlement): void {
  world.bordersDirty = true;
  const radius = TIERS[s.tier].radius;
  const myTierVal = s.tier === 'CITY' ? 3 : s.tier === 'TOWN' ? 2 : 1;
  for (const [q, r] of range(s.q, s.r, radius)) {
    const hex = world.hexes.get(q + ',' + r);
    if (!hex) continue;
    if (hex.owner === null) {
      hex.owner = s.id;
    } else if (hex.owner !== s.id) {
      const other = world.settlements.find(o => o.id === hex.owner);
      if (other) {
        const otherTierVal = other.tier === 'CITY' ? 3 : other.tier === 'TOWN' ? 2 : 1;
        if (myTierVal > otherTierVal) {
          hex.owner = s.id;
          hex.building = null;
        }
      }
    }
  }
}

export function controlledHexes(world: World, s: Settlement): Hex[] {
  if (!s._controlledHexes || world.bordersDirty) {
    s._controlledHexes = [];
    const radius = TIERS[s.tier].radius;
    for (const [q, r] of range(s.q, s.r, radius)) {
      const hex = world.hexes.get(q + ',' + r);
      if (hex && hex.owner === s.id) s._controlledHexes.push(hex);
    }
  }
  return s._controlledHexes;
}

export function computeRole(world: World, s: Settlement): Role {
  const hexes = controlledHexes(world, s);
  if (hexes.length === 0) return ROLES.GENERAL;
  const counts: Record<string, number> = { FOREST: 0, HILLS: 0, MOUNTAINS: 0, PLAINS: 0, WATER: 0 };
  for (const h of hexes) counts[h.terrain]++;
  const n = hexes.length;
  if (counts.FOREST / n > 0.30) return ROLES.LUMBER;
  if ((counts.HILLS + counts.MOUNTAINS) / n > 0.30) return ROLES.MINING;
  if (counts.PLAINS / n > 0.50) return ROLES.GRANARY;
  return ROLES.GENERAL;
}

export function storageCap(world: World, s: Settlement): number {
  const mod = getModifier(world, s.factionId, 'storage_cap', 1.0);
  let cap = 500;
  if (s.tier === 'TOWN') cap = 1500;
  if (s.tier === 'CITY') cap = 5000;
  for (const b of s.buildings) {
    const bdef = (BUILDINGS as Record<string, any>)[b];
    if (bdef?.capacityBonus) cap += bdef.capacityBonus;
  }
  return cap * mod;
}

export function canAfford(world: World, s: Settlement, cost: Record<string, number>) {
  for (const [res, amt] of Object.entries(cost)) {
    const have = res === 'gold' ? treasuryOf(world, s.factionId) : s.stock[res] ?? 0;
    if (have < amt) return false;
  }
  return true;
}

export function pay(world: World, s: Settlement, cost: Record<string, number>) {
  for (const [res, amt] of Object.entries(cost)) {
    if (res === 'gold') spendGold(world, s.factionId, amt);
    else s.stock[res] -= amt;
  }
}

export function deposit(world: World, s: Settlement, cargo: Record<string, number>) {
  const cap = storageCap(world, s);
  for (const [res, amt] of Object.entries(cargo)) {
    if (amt > 0) s.stock[res] = Math.min(cap, (s.stock[res] ?? 0) + amt);
  }
}

export function settlementAt(world: World, q: number, r: number): Settlement | undefined {
  return world.settlements.find(s => s.q === q && s.r === r);
}

export function log(world: World, msg: string) {
  world.log.push({ tick: world.tick, msg });
  if (world.log.length > 200) world.log.shift();
}

export function pushAlert(world: World, alert: Alert) {
  world.alerts = world.alerts ?? [];
  const existing = world.alerts.findIndex(a => a.type === alert.type && a.targetId === alert.targetId);
  if (existing !== -1) {
    world.alerts[existing].tick = world.tick; // refresh
    world.alerts[existing].msg = alert.msg;
  } else {
    world.alerts.push(alert);
  }
}
