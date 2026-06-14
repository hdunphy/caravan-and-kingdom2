// Barrel: public surface of the core simulation systems.
export { extractionSystem } from './extraction.js';
export { metabolismSystem, abandonSettlement } from './metabolism.js';
export { movementSystem } from './movement.js';
export { buildClaims, takeTicket, unclaimed, logisticsSystem, rankedNeeds } from './logistics.js';
export { maintenanceSystem } from './maintenance.js';
export { eventsSystem, resolvePendingEvents, resolveEventChoice } from './events.js';
