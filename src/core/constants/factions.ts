// Faction roster, default traits, and the default per-faction policy/edict surface.

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
