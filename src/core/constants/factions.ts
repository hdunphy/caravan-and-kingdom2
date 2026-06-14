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
  {
    id: 4, name: 'Koranth', color: '#16a085', persona: 'Commercial',
    traits: { expand: 1.1, trade: 1.4, industry: 0.8, aggression: 0.8 }
  },
  {
    id: 5, name: 'Ignis', color: '#d35400', persona: 'Militant',
    traits: { expand: 0.8, trade: 0.7, industry: 1.2, aggression: 1.5, opportunistic: true }
  },
  {
    id: 6, name: 'Oakhaven', color: '#27ae60', persona: 'Isolationist',
    traits: { expand: 0.6, trade: 0.5, industry: 1.5, aggression: 0.4 }
  },
  {
    id: 7, name: 'Zephyr', color: '#1abc9c', persona: 'Opportunistic',
    traits: { expand: 1.3, trade: 1.2, industry: 0.9, aggression: 1.1, opportunistic: true }
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
  recruitment: 0.5,    // player: fraction (0..1) of soldier cap to target. AI: recruit-appetite multiplier (Court resets it from aggression each session)
  expansion: 1.0,      // multiplies EXPAND appetite & settler budget
  tradeStance: 1.0,    // multiplies trade eagerness (0 = autarky)
  garrison: 1.0,       // multiplies peacetime garrison target
  militaryStance: 'DEFENSIVE' as const, // 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE'
};
