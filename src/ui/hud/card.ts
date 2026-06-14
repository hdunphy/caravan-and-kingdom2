import { TIERS, ECON, DIPLO, BUILDINGS } from '../../core/constants.js';
import { policyOf } from '../../sim/policy.js';
import { controlledHexes, storageCap } from '../../sim/settlement.js';
import { stateOf, getRelation, strengthOf, pairKey } from '../../sim/diplomacy.js';
import { HEX_SIZE } from '../renderer.js';
import type { World } from '../../types.js';

export function updateSettlementCard(world: World, selected: any, cam: any) {
  const card = document.getElementById('settlement-card');
  if (!card) return;

  if (!selected || selected.owner === undefined) {
    card.style.display = 'none';
    return;
  }

  const s = world.settlements.find(x => x.q === selected.q && x.r === selected.r);
  if (!s) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  // Position
  const pos = cam.worldToScreen(cam.x, cam.y); 
  // Wait, the hex's world pos is needed, but we already know `cam.worldToScreen`.
  // Actually, we need to map the hex's world coordinates to screen coords.
  // Wait, `selected` is just a hex object `{q, r, ...}`. We need its pixel coords.
  import('../../core/hex.js').then(({ hexToPixel }) => {
    const { x, y } = hexToPixel(s.q, s.r, HEX_SIZE);
    const screenPos = cam.worldToScreen(x, y);
    card.style.left = `${screenPos.x}px`;
    card.style.top = `${screenPos.y - 15}px`;
  });

  const fac = world.factions[s.factionId];
  const isPlayer = s.factionId === world.playerFactionId;

  // Common header
  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 8px;">
      <div>
        <div style="font-weight:700; font-size:14px; color:${isPlayer ? '#ffd700' : fac.color}; text-shadow: 0 1px 4px rgba(0,0,0,0.5);">${s.name}</div>
        <div style="font-size:10px; color:#8fa3bd;">${TIERS[s.tier].name} of ${fac.name}</div>
      </div>
      <button onclick="document.getElementById('settlement-card').style.display='none'" style="background:none; border:none; color:#8fa3bd; font-size:14px; cursor:pointer;">✖</button>
    </div>
  `;

  if (isPlayer) {
    const taxRate = policyOf(world, s.factionId).taxRate;
    const taxes = s.population * ECON.GOLD_INCOME_PER_POP * taxRate;
    const soldiers = world.agents.filter(a => a.homeId === s.id && a.type === 'soldier');
    const wages = soldiers.length * DIPLO.WAGE_SOLDIER;
    const built = controlledHexes(world, s).filter(h => h.building).map(h => h.building);
    const all = [...built, ...s.buildings];
    const upkeep = all.length * ECON.BUILDING_UPKEEP_GOLD;
    const net = taxes - wages - upkeep;
    const netStr = net >= 0 ? `+${net.toFixed(1)}/t` : `${net.toFixed(1)}/t`;
    const netColor = net >= 0 ? '#2ecc71' : '#e74c3c';

    const foodUsage = s.population * ECON.FOOD_PER_POP * policyOf(world, s.factionId).rations;
    const foodDays = foodUsage > 0 ? Math.floor(s.stock.food / foodUsage) : 999;
    
    const stocks = Object.entries(s.stock).sort(([,a], [,b]) => (b as number) - (a as number));
    const topStock = stocks.slice(0, 2).map(([k, v]) => `${k}:${Math.floor(v as number)}`).join(', ');

    let diagnosis = '';
    if (foodDays < 10) diagnosis = `<span style="color:#e74c3c;">⚠ Starving — ${foodDays} days left</span>`;
    else if (s.siegeHp != null) diagnosis = `<span style="color:#e74c3c;">⚔ Under Siege (${Math.floor(s.siegeHp)}%)</span>`;
    else if (world.factions[s.factionId].treasury < 0 && world.factions[s.factionId].goal === 'AUSTERITY') diagnosis = `<span style="color:#f1c40f;">💸 Austerity Measures Active</span>`;
    else diagnosis = `<span style="color:#8fa3bd;">All quiet</span>`;

    html += `
      <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
        <span style="color:#cbd5e1;">Pop: <b>${Math.floor(s.population)}</b></span>
        <span style="color:#cbd5e1;">Income: <b style="color:${netColor};">${netStr}</b></span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
        <span style="color:#cbd5e1;">Food: <b>${foodDays}d</b></span>
        <span style="color:#cbd5e1; font-size:9px;">${topStock}</span>
      </div>
      <div style="margin-bottom: 8px; font-size:10px; padding: 4px; background: rgba(0,0,0,0.2); border-radius:4px;">
        ${diagnosis}
      </div>
      <div style="display:flex; flex-direction:column; gap:4px; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
        <span style="font-size:10px; color:#8fa3bd;">Set Focus:</span>
        <div style="display:flex; gap:4px;">
          <button class="set-focus-btn ${fac.focus === 'PEACE' ? 'active' : ''}" data-target="${s.id}" data-focus="PEACE" style="flex:1; font-size:9px; padding:4px;">Peace</button>
          <button class="set-focus-btn ${fac.focus === 'MOBILIZE' ? 'active' : ''}" data-target="${s.id}" data-focus="MOBILIZE" style="flex:1; font-size:9px; padding:4px;">Mobilize</button>
          <button class="set-focus-btn ${fac.focus === 'WAR' ? 'active' : ''}" data-target="${s.id}" data-focus="WAR" style="flex:1; font-size:9px; padding:4px;">War</button>
        </div>
      </div>
    `;
  } else {
    // Enemy settlement
    const pFid = world.playerFactionId;
    if (pFid != null) {
      const myStr = strengthOf(world, pFid);
      const enStr = strengthOf(world, s.factionId);
      const st = stateOf(world, pFid, s.factionId);
      const rel = getRelation(world, pFid, s.factionId);

      const icons = { WAR: '⚔', TRUCE: '🤝', FRIENDLY: '✓', HOSTILE: '✗', NEUTRAL: '·' };
      const colors = { WAR: '#e74c3c', TRUCE: '#f1c40f', FRIENDLY: '#2ecc71', HOSTILE: '#e67e22', NEUTRAL: '#8fa3bd' };
      
      html += `
        <div style="display:flex; justify-content:space-between; margin-bottom: 4px; font-size: 11px;">
          <span style="color:${(colors as any)[st]}">${(icons as any)[st]} <b>${st}</b> (${Math.round(rel)})</span>
          <span style="color:#cbd5e1;">Str: ${Math.round(myStr)} v ${Math.round(enStr)}</span>
        </div>
      `;

      html += `<div style="display:flex; flex-direction:column; gap:4px; margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">`;
      
      if (st === 'WAR') {
        const war = world.diplo.wars.find(w => (w.a === pFid && w.b === s.factionId) || (w.b === pFid && w.a === s.factionId));
        if (war) {
          html += `<button class="sue-peace-btn" data-a="${war.a}" data-b="${war.b}" style="width:100%; background: #e74c3c; border-color: #e74c3c; color: white;">Sue for Peace</button>`;
        }
      } else {
        const isVassalMaster = world.factions[s.factionId].vassalOf === pFid || world.factions[pFid].vassalOf === s.factionId;
        if (!isVassalMaster) {
          const truce = world.diplo.truces[pairKey(pFid, s.factionId)];
          const inTruce = truce && world.tick < truce;
          html += `<button class="declare-war-btn" data-target="${s.factionId}" style="width:100%; ${inTruce ? 'border-color: #f1c40f; color: #f1c40f; background: transparent;' : 'background: rgba(231, 76, 60, 0.2); border-color: #e74c3c; color: #e74c3c;'}">${inTruce ? 'Break Truce' : 'Declare War'}</button>`;
          if (inTruce) {
             html += `<div style="font-size:10px; color:#f1c40f; text-align:center; margin-top:2px;">Truce Active</div>`;
          }
        }
      }
      
      html += `</div>`;
    } else {
      html += `<div style="font-size:10px; color:#8fa3bd; text-align:center; padding: 10px;">Observer Mode</div>`;
    }
    const isAtWar = !!world.diplo.wars.find(w => (w.a === world.playerFactionId && w.b === s.factionId) || (w.b === world.playerFactionId && w.a === s.factionId));
    if (isAtWar) {
      // Find the war
      const war = world.diplo.wars.find(w => (w.a === world.playerFactionId && w.b === s.factionId) || (w.b === world.playerFactionId && w.a === s.factionId))!;
      const myGoalKey = war.a === world.playerFactionId ? 'goal_a' : 'goal_b';
      const isTarget = war[myGoalKey] === s.id;
      if (isTarget) {
        html += `<button disabled style="margin-top: 10px; padding: 6px; background: rgba(231,76,60,0.2); border: 1px solid #e74c3c; color: #fff; width: 100%; border-radius: 4px;">Current War Objective</button>`;
      } else {
        html += `<button id="btn-set-war-goal" data-waridx="${world.diplo.wars.indexOf(war)}" data-targetid="${s.id}" style="margin-top: 10px; padding: 6px; background: rgba(231,76,60,0.2); border: 1px solid #e74c3c; color: #fff; width: 100%; border-radius: 4px; cursor: pointer; transition: background 0.2s;">Set War Objective</button>`;
      }
    }
  }

  card.innerHTML = html;
}
