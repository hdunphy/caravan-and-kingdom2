// Re-export barrel kept so existing `./constants.js` imports resolve to the
// decomposed constants/ package (NodeNext ESM does not resolve bare directories).
export * from './constants/index.js';
