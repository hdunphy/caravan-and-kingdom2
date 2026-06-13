// Economic balance constants.

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
  DEBT_DEATH: 1000,
  DEBT_AUSTERITY: 350,
  DEBT_DECAY_BASE: 0.1,
  UPGRADE_TRIGGER_POP: 0.8,
  EXPAND_SEARCH_RADIUS: 12,
  EXPAND_MIN_DIST: 5,
  SETTLER_SCALING: 0.5,        // settler cost increase per existing colony
  WIDE_TAX_THRESHOLD: 3,       // settlements threshold before wide tax corruption starts
  WIDE_TAX_CORRUPTION: 0.04,   // tax income penalty per settlement above threshold (decreased from 0.08)
  WIDE_TAX_MAX_PENALTY: 0.35,  // maximum tax penalty cap (decreased from 0.6)
};
