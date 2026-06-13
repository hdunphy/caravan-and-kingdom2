import type { World } from '../types.js';

export function treasuryOf(world: World, factionId: number): number {
  const fac = world.factions.find(f => f.id === factionId);
  return fac?.treasury ?? 0;
}

export function spendGold(world: World, factionId: number, amount: number): boolean {
  const fac = world.factions.find(f => f.id === factionId);
  if (!fac) return false;
  
  // No strict negative floor for the spend itself; 
  // debt is allowed and handled by growth penalties.
  fac.treasury -= amount;
  return true;
}

export function addGold(world: World, factionId: number, amount: number) {
  const fac = world.factions.find(f => f.id === factionId);
  if (fac) fac.treasury += amount;
}
