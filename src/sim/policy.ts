// Policy substrate (King-mode roadmap WP1).
//
// A faction's `policy` object is the single surface that edicts — player or AI —
// are allowed to touch. Governors and the Court read each knob through policyOf()
// rather than reading UI/DOM state directly, which keeps the headless simulation
// deterministic: edicts only ever enter the sim as plain data on the world.
//
// policyOf() falls back to DEFAULT_POLICY so worlds without a policy (old saves,
// GA-evolved worlds, hand-built test fixtures) keep working unchanged.
import { DEFAULT_POLICY } from '../core/constants.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../types.js';

export function policyOf(world: World, factionId: number) {
  const fac = world.factions?.[factionId];
  return fac?.policy ?? DEFAULT_POLICY;
}
