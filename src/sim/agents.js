// Re-export barrel kept so existing `./agents.js` imports resolve to the
// decomposed agents/ package (NodeNext ESM does not resolve bare directories).
export * from './agents/index.js';
