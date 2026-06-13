// Re-export barrel kept so existing `./governors.js` imports resolve to the
// decomposed governors/ package (NodeNext ESM does not resolve bare directories).
export { traitsOf, getSettlerCost, aiSystem, evaluateGoal, findColonySite } from './governors/index.js';
