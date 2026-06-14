import { ECON } from '../../core/constants.js';
import { policyOf } from '../../sim/policy.js';
import { soldierCap } from '../../sim/diplomacy/strength.js';
import type { World, Policy } from '../../types.js';

export function getPolicyLabels(world: World, factionId: number) {
  const policy = policyOf(world, factionId);
  const settlements = world.settlementsByFaction?.get(factionId) || [];
  const n = settlements.length;

  return {
    expansion: `Found a new settlement once a town reaches <b style="color:#e2e8f0">${Math.round(ECON.EXPAND_MIN_POP / policy.expansion)} pop</b>. Settlers cost <b style="color:#e2e8f0">${Math.round(100/policy.expansion)}%</b>.`,
    tradeStance: policy.tradeStance === 0 ? "<b>0 = no trade (autarky).</b>" : `Buy imports until stock reaches <b style="color:#e2e8f0">${Math.round(40 * policy.tradeStance)}</b>; sell anything above <b style="color:#e2e8f0">${Math.round(200 / policy.tradeStance)}</b>.`,
    recruitment: `Target army: <b style="color:#e2e8f0">${Math.round(policy.recruitment * soldierCap(world, factionId))}</b> / ${soldierCap(world, factionId)} soldiers (raised on credit if the treasury runs dry). Applies in peace and war.`,
    garrison: `Keep <b style="color:#e2e8f0">~${Math.round(n * 1 * policy.garrison)} standing soldiers</b> in peacetime (across ${n} settlements).`,
    taxRate: `Tax income <b style="color:#e2e8f0">${policy.taxRate}x</b>.${policy.taxRate > 1.2 ? ' <span style="color:#e74c3c">⚠ Above 1.2x your population growth drops 10%.</span>' : ''}`,
    rations: `Each citizen eats <b style="color:#e2e8f0">${policy.rations}x</b> food.${policy.rations < 0.8 ? ' <span style="color:#e74c3c">⚠ Below 0.8x growth drops 10%.</span>' : policy.rations > 1.0 ? ` <span style="color:#2ecc71">Well-fed: +${Math.round((policy.rations - 1.0) * ECON.RATION_GROWTH_BONUS * 100)}% growth.</span>` : ''}`,
    militaryStance: policy.militaryStance === 'AGGRESSIVE' ? 'Focuses warfare on raiding and sieges.' : policy.militaryStance === 'DEFENSIVE' ? 'Favors intercepting enemies and defending settlements.' : 'Balanced approach to warfare and defense.'
  };
}
