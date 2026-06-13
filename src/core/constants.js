// Caravan and Kingdom — game constants (GDD v4.0)

export const TERRAIN = {
  PLAINS: { name: 'Plains', yield: 'food', rate: 1.2, moveCost: 1.0, color: '#8db255' },
  FOREST: { name: 'Forest', yield: 'timber', rate: 0.8, moveCost: 2.0, color: '#4a7c3f' },
  HILLS: { name: 'Hills', yield: 'stone', rate: 0.6, moveCost: 3.0, color: '#a89878' },
  MOUNTAINS: { name: 'Mountains', yield: 'ore', rate: 0.5, moveCost: 6.0, color: '#7d7a75' },
  WATER: { name: 'Water', yield: 'food', rate: 1.0, moveCost: 4.0, color: '#4a7fb5' },
  RIVER: { name: 'River', yield: 'food', rate: 1.0, moveCost: 15.0, color: '#3fa2a2' },
};

export const RESOURCES = ['food', 'timber', 'stone', 'ore'];

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

export const ECON = {
  FOOD_PER_POP: 0.05,          // food consumed per pop per tick
  FOOD_RESERVE: 30,            // food reserve per settlement per faction
  FORAGE_POP_PER_HEX: 8,       // people each controlled land hex can feed by foraging
  POP_GROWTH_RATE: 0.02,       // pop per tick when food surplus
  POP_DECLINE_RATE: 0.08,      // pop per tick when starving
  GROWTH_FOOD_THRESHOLD: 40,   // stock needed before growth
  BASE_STORAGE: 600,
  HEX_PILE_CAP: 80,            // max resources accumulated on a hex
  VILLAGER_CAPACITY: 10,
  CARAVAN_CAPACITY: 60,
  VILLAGER_COST: { food: 15 },
  CARAVAN_COST: { timber: 60 },
  SETTLER_COST: { food: 100, timber: 80 },
  SETTLER_POP: 10,             // population that leaves with a settler
  SETTLER_REFUND: 0.7,         // cost share recovered if settlers come home
  TOOL_COST: { ore: 5, timber: 3 },
  TOOL_YIELD_BONUS: 0.25,      // global yield bonus per tool batch
  TOOL_BREAK_CHANCE: 0.004,    // per tool per tick
  MAX_TOOLS: 8,
  INTEGRITY_DECAY_BUILDING: 0.02,
  INTEGRITY_DECAY_CARAVAN: 0.05,
  REPAIR_COST_TIMBER: 0.5,     // timber per integrity point
  REPAIR_THRESHOLD: 60,
  GOLD_START: 100,
  TRADE_PRICE: 2,              // gold per unit
  TRADE_BATCH: 30,
  TRADE_SURPLUS_MIN: 200,      // seller needs this much stock to sell
  TRADE_KEEP: 150,             // stock a seller always keeps for itself
  TRADE_RANGE: 40,             // max hex distance for trade routes
  GOLD_INCOME_PER_POP: 0.004,  // passive tax income per pop per tick (increased from 0.002)
  WAGE_VILLAGER: 0.004,        // gold per villager per tick
  WAGE_CARAVAN: 0.03,          // gold per caravan per tick
  DESERTION_CHANCE: 0.003,     // per unpaid agent per tick
  DESERTION_FLOOR: 3,          // a settlement never loses its last few villagers
  BUILDING_UPKEEP_GOLD: 0.012, // gold per building per tick (skipped if treasury < 20)
  RECRUIT_GOLD_BUFFER: 10,     // don't recruit if treasury below this
  VILLAGER_FREIGHT_RANGE: 8,   // max hex distance for internal freight
  ROAD_COST: { stone: 12, timber: 4 },
  BRIDGE_COST: { stone: 35, timber: 15 },
  ROAD_TRAFFIC_MIN: 250,       // traversals before a hex is worth paving
  ROAD_TRAFFIC_DECAY: 0.999,   // per tick, so roads follow CURRENT routes
  ROAD_BUILD_BUFFER: 60,       // keep this much timber+stone before paving
  ROAD_INTEGRITY_DECAY: 0.06,  // per tick; unmaintained roads crumble in ~1700 ticks
  ROAD_MAINTAIN_TRAFFIC: 60,   // only roads this busy are worth repairing
  ROAD_REPAIR_STONE: 0.05,     // stone per integrity point
  ROAD_CAP_PER_RADIUS: 2.5,    // max LOCAL roads a settlement supports = radius * this
  ROAD_MOVE_COST: 0.4,         // movement cost on a road (plains are 1.0)
  EXPAND_MIN_POP: 25,
  UPGRADE_TRIGGER_POP: 0.8,
  EXPAND_SEARCH_RADIUS: 12,
  EXPAND_MIN_DIST: 5,
  SETTLER_SCALING: 0.5,        // settler cost increase per existing colony
  WIDE_TAX_THRESHOLD: 3,       // settlements threshold before wide tax corruption starts
  WIDE_TAX_CORRUPTION: 0.04,   // tax income penalty per settlement above threshold (decreased from 0.08)
  WIDE_TAX_MAX_PENALTY: 0.35,  // maximum tax penalty cap (decreased from 0.6)
};

export const DIPLO = {
  INTERVAL: 50,                // ticks between Court sessions
  // relations
  TRADE_RELATION: 0.05,        // per completed cross-faction transaction (slowed from 1.0 to allow conflicts)
  BORDER_FRICTION: -0.4,       // per crowded settlement pair per session
  BORDER_RANGE: 6,
  DRIFT: 0.8,                  // forgiveness toward 0 per session (reduced from 1.5 to make relationships stickier)
  FRIENDLY: 30,
  HOSTILE: -30,
  DECLARE_WAR_PENALTY: -40,
  WARMONGER_PENALTY: -10,
  RAID_PENALTY: -3,
  CAPTURE_PENALTY: -25,
  GIFT_VALUE: 60,
  GIFT_GOLD_PER_POINT: 20,
  PEACE_RELATION: -15,         // relations start closer to neutral but still slightly bitter
  FRIENDLY_PRICE: 1.5,         // gold per unit between friends (vs TRADE_PRICE)
  PACT_DURATION: 2000,
  PACT_COOLDOWN: 1500,
  PACT_RELATION_REQ: 60,
  EMBARGO_RELATION_REQ: -40,
  EMBARGO_LIFT_RELATION: -20,
  VASSAL_TRIBUTE_PCT: 0.20,
  VASSAL_POP_RATIO_REQ: 2.0,
  VASSAL_INDEPENDENCE_POP_RATIO: 0.8,
  VASSAL_ANNEX_TICKS: 8000,
  // soldiers
  SOLDIER_COST: { food: 20, ore: 5, gold: 6 }, // gold cost decreased from 10
  SOLDIER_POP_COST: 15,        // a soldier is a company of people, not one person
  DISBAND_POP_RETURN: 0.5,     // fraction of pop cost returned when a garrison disbands
  WAGE_SOLDIER: 0.03,          // gold wage per soldier per tick (decreased from 0.05)
  SOLDIER_STRENGTH: 10,
  FIELD_DAMAGE: 0.05,           // fraction of enemy stack strength dealt per tick in field battles
  SOLDIER_FIELD_DECAY: 0.02,  // campaign attrition (halved from 0.04)
  SOLDIER_HEAL: 1.0,           // heal rate at home (increased from 0.5)
  MILITIA_PER_POP: 0.05,
  GARRISON_PEACE: 1,           // peacetime soldiers per settlement (x2 if aggressive)
  // war
  WAR_RELATION: -30,           // relations must be below this to declare (slightly easier to trigger wars)
  WAR_CHEST_FACTOR: 0.5,       // war chest reduction factor
  MOBILIZATION_TAX_BONUS: 1.5, // tax multiplier during mobilization/war
  MOBILIZATION_GROWTH_PENALTY: 0.5, // growth multiplier during mobilization/war
  MOBILIZE_LIMIT: 500,         // max ticks a faction can remain mobilized without declaring war
  STRIKE_RANGE: 15,
  ADVANTAGE: 1.5,              // required strength ratio (divided by aggression)
  ARMY_BASE: 6,
  ARMY_PER_AGGRESSION: 4,
  POP_PER_SOLDIER: 45,         // one soldier-company per this much faction population
  ARMY_MIN: 4,                 // every faction can always field at least this many
  SIEGE_ATTACK: 0.025,         // faster sieges: 0.008 -> 0.025
  SIEGE_DEFEND: 0.008,         // less siege defender counter-fire: 0.015 -> 0.008
  SIEGE_BULWARK: 30,           // lower stockade defense bonus: 60 -> 30
  SIEGE_DEATH_RATE: 0.0011,    // pop fraction killed per tick under siege (~20% over a typical siege)
  SIEGE_DEATH_CAP: 0.35,       // max fraction of pre-siege pop a single siege can kill
  DEFENSE_REGEN: 0.2,
  CAPTURE_POP_LOSS: 0.1,       // most pop loss now happens DURING the siege (SIEGE_DEATH_RATE)
  CAPTURE_STOCK_LOSS: 0.5,
  SIEGE_REDUCTION_TOWN: 0.85,  // Towns take 15% less siege damage
  SIEGE_REDUCTION_CITY: 0.70,  // Cities take 30% less siege damage
  // threat & stagnation pressure constants
  THUCYDIDES_THRESHOLD: 0.35,
  THUCYDIDES_PENALTY_MULT: -60, // fear-of-the-strong set to -60 to allow coalitions against top dog
  STAGNATION_AGGR_INC: 0.05,
  STAGNATION_AGGR_MAX: 1.0,
  // exhaustion & peace
  EXH_SOLDIER_LOST: 4,
  EXH_TICK: 0.015,              // base tick exhaustion (slightly lower base)
  EXH_GROWTH: 1.2,              // compound growth factor (softened from 1.5)
  EXH_GROWTH_INTERVAL: 1000,    // ticks per growth step
  EXH_CAPTURE_WINNER_REFUND: 12,  // winner LOSES this much exhaustion on capture
  EXH_CAPTURE_LOSER_PENALTY: 25,  // loser GAINS this
  EXH_BATTLE_WINNER_RELIEF: 2,    // winner relief after field battle
  EXH_BATTLE_LOSER_COST: 4,       // loser cost after field battle
  COMBAT_COMMIT_TICKS: 60,        // soldiers must fight this long before disengaging
  EXH_BROKE: 0.1,
  SUE_THRESHOLD: 70,
  MUTUAL_THRESHOLD: 40,
  DOMINANT_EXH: 20,
  REPARATIONS: 0.25,
  TRUCE_TICKS: 1500,
  COMMIT_FACTOR: 0.8,
};

export const GOALS = { SURVIVE: 'SURVIVE', THRIFTY: 'THRIFTY', UPGRADE: 'UPGRADE', EXPAND: 'EXPAND', DEVELOP: 'DEVELOP' };

export const ROLES = { LUMBER: 'LUMBER', MINING: 'MINING', GRANARY: 'GRANARY', GENERAL: 'GENERAL' };

// Personality traits scale governor behavior:
//   expand  -> settlement cap & how early EXPAND triggers
//   trade   -> caravan fleet size & how eagerly surpluses are sold
//   industry-> extraction efficiency
export const FACTIONS = [
  {
    id: 0, name: 'Aurelia', color: '#d4af37', persona: 'Mercantile',
    traits: { expand: 0.9, trade: 1.5, industry: 1.0, aggression: 0.6 }
  },
  {
    id: 1, name: 'Vesper', color: '#9b59b6', persona: 'Expansionist',
    traits: { expand: 1.5, trade: 0.9, industry: 0.9, aggression: 1.2, opportunistic: true }
  },
  {
    id: 2, name: 'Thornwall', color: '#c0392b', persona: 'Industrious',
    traits: { expand: 0.9, trade: 0.8, industry: 1.3, aggression: 1.4, opportunistic: true }
  },
  {
    id: 3, name: 'Skylde', color: '#2980b9', persona: 'Balanced',
    traits: { expand: 1.1, trade: 1.1, industry: 1.05, aggression: 1.0 }
  },
];

export const DEFAULT_TRAITS = { expand: 1, trade: 1, industry: 1, aggression: 1, opportunistic: false };

// Per-faction edict surface. The ONLY thing player (and AI) edicts touch: every
// governor reads its knob via policyOf() instead of hard-coded behavior. All
// values default to 1.0 / DEFAULT-as-current so wiring them in (WP2) changes
// nothing until a slider moves. Sim code never builds a policy from UI/DOM state,
// keeping the simulation deterministic.
export const DEFAULT_POLICY = {
  taxRate: 1.0,        // multiplies GOLD_INCOME_PER_POP
  rations: 1.0,        // multiplies food consumption (0.5 = austerity)
  recruitment: 1.0,    // multiplies villager/soldier recruit appetite
  expansion: 1.0,      // multiplies EXPAND appetite & settler budget
  tradeStance: 1.0,    // multiplies trade eagerness (0 = autarky)
  garrison: 1.0,       // multiplies peacetime garrison target
  militaryStance: 'DEFENSIVE', // 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE'
};
