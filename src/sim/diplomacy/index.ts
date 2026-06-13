// Barrel: the public surface of the diplomacy package, matching the original
// diplomacy.js exports so governors / gameLoop / hud import sites are unchanged.
export {
  pairKey, getRelation, addRelation, findWar, atWar, atWarAny, stateOf,
  hasEmbargo, hasPact, getAllies, canTrade, tradePrice
} from './relations.js';
export {
  soldiersOf, strengthOf, committedStrength, defensiveBlocStats,
  offensiveBlocStats, settlementDefense, armyCap
} from './strength.js';
export { courtSystem } from './court.js';
export { makePeace } from './peace.js';
export { declareWar } from './war.js';
export { combatSystem } from './combat.js';
