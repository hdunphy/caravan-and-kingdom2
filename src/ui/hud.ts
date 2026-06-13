// Re-export barrel kept so existing `./hud.js` imports resolve to the
// decomposed hud/ package (NodeNext ESM does not resolve bare directories).
export * from './hud/index.js';
