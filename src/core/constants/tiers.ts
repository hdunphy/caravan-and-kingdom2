// Settlement tiers, buildings, and the goal/role enums.

export const TIERS = {
  VILLAGE: {
    name: 'Village', popCap: 30, radius: 2, jobCap: 8, next: 'TOWN',
    upgradeCost: { timber: 120, stone: 80 }, efficiency: 1.0
  },
  TOWN: {
    name: 'Town', popCap: 70, radius: 3, jobCap: 16, next: 'CITY',
    upgradeCost: { timber: 300, stone: 220 }, efficiency: 1.25
  },
  CITY: {
    name: 'City', popCap: 150, radius: 4, jobCap: 28, next: null,
    upgradeCost: null, efficiency: 1.6
  },
};

export const BUILDINGS = {
  GATHERERS_HUT: { name: "Gatherer's Hut", terrain: 'PLAINS', cost: { timber: 20 }, yieldMult: 2.0 },
  SAWMILL: { name: 'Sawmill', terrain: 'FOREST', cost: { timber: 25, stone: 10 }, yieldMult: 2.0 },
  MASONRY: { name: 'Masonry', terrain: 'HILLS', cost: { timber: 30, stone: 10 }, yieldMult: 2.0 },
  SMITHY: { name: 'Smithy', terrain: 'MOUNTAINS', cost: { timber: 35, stone: 25 }, yieldMult: 2.0 },
  FISHERY: { name: 'Fishing Dock', terrain: 'WATER', cost: { timber: 40 }, yieldMult: 1.5 },
  WAREHOUSE: { name: 'Warehouse', terrain: null, cost: { timber: 40, stone: 30 }, capacityBonus: 400 },
  MARKET_HALL: { name: 'Market Hall', terrain: null, cost: { timber: 50, stone: 40 }, tradeBonus: true },
};

export const GOALS = { SURVIVE: 'SURVIVE', THRIFTY: 'THRIFTY', UPGRADE: 'UPGRADE', EXPAND: 'EXPAND', DEVELOP: 'DEVELOP' } as const;

export const ROLES = { LUMBER: 'LUMBER', MINING: 'MINING', GRANARY: 'GRANARY', GENERAL: 'GENERAL' } as const;
