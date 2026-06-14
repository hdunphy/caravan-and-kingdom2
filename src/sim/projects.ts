import { World, Faction, Resource } from '../types.js';
import { addModifier } from './systems/events.js';
import { pushAlert } from './settlement.js';
import { spendGold } from './economy.js';

export interface ProjectDef {
  id: string;
  name: string;
  desc: string;
  cost: { food?: number; timber?: number; stone?: number; ore?: number; gold?: number };
  duration: number;
}

export const PROJECTS: ProjectDef[] = [
  {
    id: 'aqueducts',
    name: 'Aqueducts',
    desc: 'Boosts population growth (+20%) for a season.',
    cost: { stone: 800, gold: 200 },
    duration: 500
  },
  {
    id: 'public_granaries',
    name: 'Public Granaries',
    desc: 'Increases food storage capacity (+50%) for a season.',
    cost: { timber: 800, gold: 200 },
    duration: 500
  },
  {
    id: 'tooling_drive',
    name: 'Tooling Drive',
    desc: 'Doubles tool production speed for a season.',
    cost: { ore: 800, gold: 200 },
    duration: 500
  },
  {
    id: 'royal_feast',
    name: 'Royal Feast',
    desc: 'A massive feast! Boosts kingdom population growth (+50%) for a season.',
    cost: { food: 1500, gold: 300 },
    duration: 500
  }
];

export function getEmpireStock(world: World, fid: number): Record<Resource, number> {
  const stock = { food: 0, timber: 0, stone: 0, ore: 0 };
  for (const s of world.settlements) {
    if (s.factionId === fid) {
      stock.food += s.stock.food;
      stock.timber += s.stock.timber;
      stock.stone += s.stock.stone;
      stock.ore += s.stock.ore;
    }
  }
  return stock;
}

export function canAffordProject(world: World, fid: number, proj: ProjectDef): boolean {
  const f = world.factions[fid];
  if (proj.cost.gold && f.treasury < proj.cost.gold) return false;
  
  const stock = getEmpireStock(world, fid);
  for (const res of ['food', 'timber', 'stone', 'ore'] as Resource[]) {
    if (proj.cost[res] && stock[res] < proj.cost[res]!) return false;
  }
  return true;
}

export function deductEmpireStock(world: World, fid: number, cost: Partial<Record<Resource, number>>) {
  for (const res of ['food', 'timber', 'stone', 'ore'] as Resource[]) {
    let needed = cost[res] || 0;
    if (needed <= 0) continue;
    
    const setts = world.settlements.filter(s => s.factionId === fid).sort((a, b) => b.stock[res] - a.stock[res]);
    for (const s of setts) {
      if (needed <= 0) break;
      const take = Math.min(s.stock[res], needed);
      s.stock[res] -= take;
      needed -= take;
    }
  }
}

export function enactProject(world: World, fid: number, projId: string) {
  const proj = PROJECTS.find(p => p.id === projId);
  if (!proj) return;
  if (!canAffordProject(world, fid, proj)) return;
  
  const f = world.factions[fid];
  if (proj.cost.gold) spendGold(world, fid, proj.cost.gold);
  deductEmpireStock(world, fid, proj.cost);
  
  if (proj.duration > 0) {
    let modType = '';
    let modValue = 1.0;
    
    if (projId === 'aqueducts') { modType = 'pop_growth'; modValue = 1.2; }
    if (projId === 'public_granaries') { modType = 'storage_cap'; modValue = 1.5; }
    if (projId === 'tooling_drive') { modType = 'tool_production'; modValue = 2.0; }
    if (projId === 'royal_feast') { modType = 'pop_growth'; modValue = 1.5; }
    
    addModifier(world, fid, {
      id: projId,
      type: modType,
      value: modValue,
      expiresAt: world.tick + proj.duration
    });
  }
  
  if (fid === world.playerFactionId) {
    pushAlert(world, { type: 'EVENT', severity: 'INFO', factionId: fid, tick: world.tick, msg: `Royal Project enacted: ${proj.name}` });
  }
}

export function aiResolveProjects(world: World) {
  if (world.rng.next() < 0.9) return;
  for (const f of world.factions) {
    if (f.eliminated || f.id === world.playerFactionId) continue;
    
    // AI picks a random affordable project if they are rich
    if (f.treasury > 1000) {
      const affordable = PROJECTS.filter(p => canAffordProject(world, f.id, p));
      if (affordable.length > 0) {
        const proj = affordable[Math.floor(world.rng.next() * affordable.length)];
        enactProject(world, f.id, proj.id);
      }
    }
  }
}
