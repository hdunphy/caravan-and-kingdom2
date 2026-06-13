// Central data shapes for the simulation. Derived from how objects are actually
// constructed in worldgen / settlement / agents. Kept permissive during the
// migration (many optional / index-signature fields); tightened in Phase 8.

export type Resource = 'food' | 'timber' | 'stone' | 'ore';

export type Stock = Record<Resource, number> & { [k: string]: number };

export type TerrainKind =
  | 'PLAINS' | 'FOREST' | 'HILLS' | 'MOUNTAINS' | 'WATER' | 'RIVER';

export type Tier = 'VILLAGE' | 'TOWN' | 'CITY';

export type Role = 'LUMBER' | 'MINING' | 'GRANARY' | 'GENERAL';

export type Goal = 'SURVIVE' | 'THRIFTY' | 'UPGRADE' | 'EXPAND' | 'DEVELOP' | 'AUSTERITY';

export type AgentKind = 'villager' | 'caravan' | 'settler' | 'soldier';

export type MilitaryStance = 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface Hex {
  q: number;
  r: number;
  terrain: TerrainKind;
  resources: Stock;
  owner: number | null;       // owning settlement id
  building: string | null;
  buildingIntegrity: number;
  hasRoad: boolean;
  roadIntegrity: number;
  hasBridge: boolean;
  traffic: number;
  [key: string]: any;
}

export interface Settlement {
  id: number;
  factionId: number;
  q: number;
  r: number;
  name: string;
  tier: Tier;
  population: number;
  stock: Stock;
  tools: number;
  goal: Goal;
  role: Role;
  focus: Resource | null;
  buildings: string[];
  integrity: number;
  pendingSettler: boolean;
  _controlledHexes?: Hex[];
  [key: string]: any;
}

export interface Mission {
  kind: string;
  phase?: 'out' | 'back';
  tq?: number;
  tr?: number;
  destId?: number;
  targetId?: number;
  resource?: Resource;
  barterRes?: Resource;
  price?: number;
  retries?: number;
  [key: string]: any;
}

export interface Agent {
  id: number;
  type: AgentKind;
  factionId: number;
  homeId: number;
  q: number;
  r: number;
  path: Array<[number, number]>;
  progress: number;
  state: string;              // idle | travel | siege | ...
  mission: Mission | null;
  cargo: Stock;
  integrity: number;
  engagedSince: number | null;
  [key: string]: any;
}

export interface Policy {
  taxRate: number;
  rations: number;
  recruitment: number;
  expansion: number;
  tradeStance: number;
  garrison: number;
  militaryStance: MilitaryStance;
  [key: string]: any;
}

export interface FactionTraits {
  expand: number;
  trade: number;
  industry: number;
  aggression: number;
  opportunistic?: boolean;
  [key: string]: any;
}

export interface Faction {
  id: number;
  name: string;
  color: string;
  persona: string;
  treasury: number;
  traits: FactionTraits;
  policy?: Policy;
  [key: string]: any;
}

export interface War {
  a: number;
  b: number;
  [key: string]: any;
}

export interface Diplo {
  relations: Record<string, number>;
  tradeCounts: Record<string, number>;
  wars: War[];
  truces: Record<string, any>;
  [key: string]: any;
}

export interface HistorySample {
  t: number;
  war: boolean;
  f: Array<{ pop: number; gold: number; n: number; military: number }>;
}

export interface LogEvent {
  tick: number;
  msg: string;
}

export type AlertSeverity = 'INFO' | 'IMPORTANT' | 'CRITICAL';
export interface Alert {
  type: 'STARVATION' | 'BANKRUPT' | 'SIEGE' | 'STAGNANT'
      | 'WAR_DECLARED' | 'SETTLEMENT_LOST' | 'SETTLEMENT_CAPTURED'
      | 'PEACE_SIGNED' | 'EXHAUSTION_HIGH' | 'DIPLO';
  severity: AlertSeverity;
  factionId: number | null;
  tick: number;
  targetId?: number;
  q?: number;
  r?: number;
  msg: string;
  acknowledged?: boolean;
}

export interface World {
  seed: number;
  tick: number;
  mapRadius: number;
  playerFactionId: number | null;
  rng: ReturnType<typeof import('./core/rng.js').makeRng>;
  hexes: Map<string, Hex>;
  settlements: Settlement[];
  agents: Agent[];
  factions: Faction[];
  nextId: number;
  log: LogEvent[];
  alerts: Alert[];
  history: { interval: number; samples: HistorySample[] };
  diplo: Diplo;
  stats: { trades: Record<number, number>; captures: Record<number, number> };
  pathCache: Map<string, Array<[number, number]> | null>;
  bordersDirty?: boolean;
  [key: string]: any;
}
