// --- 3. Movement: agents advance along paths, paying terrain cost ---
import { TERRAIN, ECON } from '../../core/constants.js';
import { AGENT_SPEED, onArrival, cancelMission } from '../agents.js';

export function movementSystem(world) {
  const agents = world.agents;
  const len = agents.length;
  for (let i = 0; i < len; i++) {
    const agent = agents[i];
    if (agent.engaged) continue;
    if (agent.state !== 'travel' || agent.path.length === 0) {
      if (agent.state === 'travel') onArrival(world, agent);
      continue;
    }
    agent.progress += AGENT_SPEED[agent.type] ?? 1.0;
    let guard = 0;
    while (agent.path.length > 0 && guard++ < 10) {
      const [nq, nr] = agent.path[0];
      const hex = world.hexes.get(nq + ',' + nr);
      if (!hex) { cancelMission(world, agent); break; }
      let cost = TERRAIN[hex.terrain].moveCost;
      if (hex.terrain === 'RIVER') {
        cost = hex.hasBridge ? ECON.ROAD_MOVE_COST : 15.0;
      }
      if (hex.hasRoad) cost = Math.min(cost, ECON.ROAD_MOVE_COST);
      if (agent.progress >= cost) {
        agent.progress -= cost;
        agent.q = nq; agent.r = nr;
        hex.traffic += agent.type === 'caravan' ? 3 : 1; // road demand signal
        agent.path.shift();
        if (agent.path.length === 0) onArrival(world, agent);
      } else break;
    }
  }
}
