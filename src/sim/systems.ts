// Re-export barrel kept so existing `./systems.js` imports resolve to the
// decomposed systems/ package (NodeNext ESM does not resolve bare directories).
export * from './systems/index.js';
