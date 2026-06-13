// Diplomacy, military, and war balance constants.

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
  TRUCE_TICKS: 800,
  COMMIT_FACTOR: 0.8,
};
