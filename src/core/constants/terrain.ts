// Terrain types and the resource list.

export const TERRAIN = {
  PLAINS: { name: 'Plains', yield: 'food', rate: 1.2, moveCost: 1.0, color: '#8db255' },
  FOREST: { name: 'Forest', yield: 'timber', rate: 0.8, moveCost: 2.0, color: '#4a7c3f' },
  HILLS: { name: 'Hills', yield: 'stone', rate: 0.6, moveCost: 3.0, color: '#a89878' },
  MOUNTAINS: { name: 'Mountains', yield: 'ore', rate: 0.5, moveCost: 6.0, color: '#7d7a75' },
  WATER: { name: 'Water', yield: 'food', rate: 1.0, moveCost: 4.0, color: '#4a7fb5' },
  RIVER: { name: 'River', yield: 'food', rate: 1.0, moveCost: 15.0, color: '#3fa2a2' },
};

export const RESOURCES = ['food', 'timber', 'stone', 'ore'];
