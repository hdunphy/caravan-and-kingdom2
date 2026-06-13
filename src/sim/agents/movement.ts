// Path assignment + mission cancellation (route cache lives on the world).
import { findPath } from '../../core/pathfinding.js';
import { homeOf } from './spawn.js';
import type { World } from '../../types.js';

// Route cache: hundreds of agents walk the same settlement<->pile routes,
// so A* results are shared. Cleared periodically (roads change costs).
export function assignPath(world: World, agent, tq, tr) {
  if (!world.pathCache) world.pathCache = new Map();
  const ck = agent.q + ',' + agent.r + '>' + tq + ',' + tr;
  let path = world.pathCache.get(ck);
  if (path === undefined) {
    path = findPath(world, agent.q, agent.r, tq, tr);
    if (world.pathCache.size < 20000) {
      world.pathCache.set(ck, path === null ? null : path.slice());
    }
  }
  if (path === null) return false;
  agent.path = path.slice();
  agent.progress = 0;
  agent.state = 'travel';
  return true;
}

export function cancelMission(world: World, agent) {
  agent.mission = null;
  agent.cargo = { food: 0, timber: 0, stone: 0, ore: 0 };
  const home = homeOf(world, agent);
  if (home && (agent.q !== home.q || agent.r !== home.r)) {
    if (assignPath(world, agent, home.q, home.r)) {
      agent.mission = { kind: 'return' };
      return;
    }
  }
  agent.state = 'idle';
}
