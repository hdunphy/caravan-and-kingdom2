// Re-export barrel kept so existing `./diplomacy.js` imports resolve to the
// decomposed diplomacy/ package (NodeNext ESM does not resolve bare directories).
export * from './diplomacy/index.js';
