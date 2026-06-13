// Observer HUD: faction overview, inspector panel, event log.
import { TERRAIN, TIERS, ECON, DIPLO, BUILDINGS } from '../../core/constants.js';
import { summarize } from '../../sim/gameLoop.js';
import { stateOf, getRelation, strengthOf, pairKey } from '../../sim/diplomacy.js';
import { settlementAt, controlledHexes, storageCap } from '../../sim/settlement.js';
import { drawChart } from './chart.js';
import { getPolicyLabels } from './policyLabels.js';
import { renderRealmTab } from './realm.js';
import { policyOf } from '../../sim/policy.js';
import type { World, Settlement, Agent, Hex, Faction, War, Stock, Resource, Mission, Diplo, Role, Goal, Tier, AgentKind, MilitaryStance, TerrainKind, Policy } from '../../types.js';

const fmt = (n: number) => Math.round(n);

let eventFilter = 'all';
let filterBound = false;
let lastWorld: any = null;
let lastSelected: any = null;

export const dismissedAlertKeys = new Set<string>();

function bindFilterEvents() {
  if (filterBound) return;
  const buttons = document.querySelectorAll<HTMLElement>('.event-filter');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      eventFilter = btn.dataset.filter!;
      buttons.forEach(b => b.classList.toggle('active', b === btn));
      if (lastWorld) updateHud(lastWorld, lastSelected);
    });
  });
  filterBound = true;
}

export function updateHud(world: World, selected: any) {
  lastWorld = world;
  lastSelected = selected;
  bindFilterEvents();
  document.getElementById('tick')!.textContent = `Tick ${world.tick}`;
  
  renderRealmTab(world);

  // Alerts rendering
  const alertsPanel = document.getElementById('alerts-panel');
  if (alertsPanel) {
    const currentKeys = new Set(world.alerts?.map(a => `${a.type}-${a.targetId}`));
    for (const k of dismissedAlertKeys) {
      if (!currentKeys.has(k)) dismissedAlertKeys.delete(k);
    }
    const visibleAlerts = world.alerts?.filter(a => 
      !dismissedAlertKeys.has(`${a.type}-${a.targetId}`) && 
      a.severity === 'IMPORTANT' && 
      (world.playerFactionId !== null && (a.factionId === world.playerFactionId || a.factionId === null))
    ) || [];

    if (visibleAlerts.length > 0) {
      alertsPanel.innerHTML = visibleAlerts.slice(-3).map(a => {
        let color = '#e74c3c';
        let icon = '⚠';
        if (a.type === 'STARVATION') { color = '#e67e22'; icon = '🍽'; }
        if (a.type === 'BANKRUPT') { color = '#f1c40f'; icon = '💸'; }
        if (a.type === 'SIEGE') { color = '#e74c3c'; icon = '⚔'; }
        if (a.type === 'STAGNANT') { color = '#9b59b6'; icon = '🛑'; }
        if (a.type === 'DIPLO') { color = '#3498db'; icon = '📜'; }
        return `
          <div class="alert-item" data-type="${a.type}" data-target="${a.targetId}" data-q="${a.q ?? ''}" data-r="${a.r ?? ''}" style="pointer-events: auto; cursor: pointer; background: rgba(20, 27, 43, 0.85); border: 1px solid ${color}; border-left: 4px solid ${color}; border-radius: 6px; padding: 10px; color: #e2e8f0; font-size: 11px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); backdrop-filter: blur(8px); display: flex; align-items: flex-start; gap: 8px; position: relative; animation: slideIn 0.3s ease;">
            <button class="dismiss-alert-btn" style="position: absolute; top: 4px; right: 4px; background: none; border: none; color: #8fa3bd; cursor: pointer; font-size: 10px; padding: 2px 4px;">✖</button>
            <span style="font-size: 14px; margin-top: 2px;">${icon}</span>
            <div style="display: flex; flex-direction: column; gap: 2px; padding-right: 12px;">
              <b style="color: ${color}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">${a.type}</b>
              <span>${a.msg}</span>
            </div>
          </div>
        `;
      }).join('');
    } else {
      alertsPanel.innerHTML = '';
    }
  }

  // Faction overview
  const summaries = summarize(world);
  const maxPop = Math.max(1, ...summaries.map(s => s.population));
  const maxGold = Math.max(1, ...summaries.map(s => s.gold));

  const rows = summaries.map((f, i) => {
    const fac = world.factions[i];
    if (fac.eliminated) return `
      <div class="faction-row" style="opacity:.45">
        <div class="faction-header">
          <span class="swatch" style="color:${fac.color}; background:${fac.color}"></span>
          <span><b>${f.faction}</b> <span class="persona">fallen</span></span>
        </div>
      </div>`;
    const soldiers = world.agents.filter(a => a.factionId === i && a.type === 'soldier').length;
    const popPct = Math.min(100, (f.population / maxPop) * 100);
    const goldPct = Math.min(100, (f.gold / maxGold) * 100);

    const focus = fac.focus ?? 'PEACE';
    const focusColors = { WAR: '#e74c3c', MOBILIZE: '#f1c40f', PEACE: '#2ecc71' };
    const focusBadgeColor = (focusColors as Record<string, string>)[focus] ?? '#2ecc71';
    const focusHtml = `<span style="font-size: 8px; padding: 1px 4px; border-radius: 4px; background: ${focusBadgeColor}22; border: 1px solid ${focusBadgeColor}; color: ${focusBadgeColor}; font-weight: bold; margin-left: auto;">${focus}</span>`;

    // Vassal badge for living vassals
    let vassalHtml = '';
    if (fac.vassalOf !== undefined) {
      const masterName = world.factions[fac.vassalOf]?.name ?? '?';
      vassalHtml = `<span style="font-size: 8px; padding: 1px 4px; border-radius: 4px; background: #8b572a22; border: 1px solid #8b572a; color: #c68642; font-weight: bold; margin-left: 4px;">VASSAL · ${masterName}</span>`;
    }

    const isPlayer = i === world.playerFactionId;
    const nameColor = isPlayer ? '#ffd700' : fac.color;
    const nameStyle = isPlayer ? `color:${nameColor}; font-weight:800; text-shadow: 0 0 4px rgba(255, 215, 0, 0.5);` : `color:${nameColor}; font-weight:700;`;
    const playerBadge = isPlayer ? `<span style="font-size: 8px; padding: 1px 4px; border-radius: 4px; background: #ffd70022; border: 1px solid #ffd700; color: #ffd700; font-weight: bold; margin-left: 4px;">YOU</span>` : '';

    return `
    <div class="faction-row" ${isPlayer ? 'style="border-color: rgba(255, 215, 0, 0.3); background: rgba(255, 215, 0, 0.05);"' : ''}>
      <div class="faction-header" style="display: flex; align-items: center; width: 100%;">
        <span class="swatch" style="color:${fac.color}; background:${fac.color}; box-shadow: 0 0 8px ${fac.color}"></span>
        <span style="${nameStyle}">${f.faction}</span>
        ${playerBadge}
        <span class="persona" style="margin-left: 6px;">${fac.persona ?? ''}</span>
        ${focusHtml}
        ${vassalHtml}
      </div>
      <div class="faction-details">
        <span>Settlements: <b>${f.settlements}</b> | Pop: <b>${Math.round(f.population)}</b></span>
        <span>Gold: <b>${Math.round(f.gold)}g</b></span>
      </div>
      <div class="faction-metrics">
        <div class="metric-bar-container" title="Population relative to largest faction">
          <div class="metric-bar" style="width:${popPct}%; background:${fac.color}"></div>
        </div>
        <div class="metric-bar-container" title="Gold relative to wealthiest faction" style="margin-top:2px;">
          <div class="metric-bar" style="width:${goldPct}%; background:#ffd700"></div>
        </div>
      </div>
      <div style="font-size:10px; color:#8fa3bd; margin-top:2px;">
        Agents: ${f.villagers}v / ${f.caravans}c / ${soldiers}s
      </div>
    </div>`;
  }).join('');

  // Diplomacy summary: one line per living faction pair
  let diploRows = '';
  let activeWarsHtml = '';
  if (world.diplo) {
    const icons = { WAR: '⚔', TRUCE: '🤝', FRIENDLY: '✓', HOSTILE: '✗', NEUTRAL: '·' };
    const colors = { WAR: '#e74c3c', TRUCE: '#f1c40f', FRIENDLY: '#2ecc71', HOSTILE: '#e67e22', NEUTRAL: '#8fa3bd' };
    for (let a = 0; a < world.factions.length; a++) {
      for (let b = a + 1; b < world.factions.length; b++) {
        if (world.factions[a].eliminated || world.factions[b].eliminated) continue;
        const st = stateOf(world, a, b);
        let actionBtn = '';
        if (world.playerFactionId != null && (a === world.playerFactionId || b === world.playerFactionId)) {
          const enemy = a === world.playerFactionId ? b : a;
          const myStr = strengthOf(world, world.playerFactionId);
          const enStr = strengthOf(world, enemy);
          const strComp = `<span style="font-size:9px; color:#cbd5e1; margin-right:4px;">Str: ${Math.round(myStr)} v ${Math.round(enStr)}</span>`;
          if (st !== 'WAR') {
            const isVassalMaster = world.factions[enemy].vassalOf === world.playerFactionId || world.factions[world.playerFactionId].vassalOf === enemy;
            if (!isVassalMaster) {
              const pk = pairKey(world.playerFactionId, enemy);
              const truce = world.diplo.truces[pk];
              const inTruce = truce && world.tick < truce;
              actionBtn = `${strComp}<button class="declare-war-btn" data-target="${enemy}" style="font-size: 8px; padding: 2px 4px; ${inTruce ? 'border: 1px solid #f1c40f; color: #f1c40f; background: transparent;' : 'background: rgba(231, 76, 60, 0.2); color: #e74c3c; border: 1px solid #e74c3c;'} border-radius: 3px; cursor: pointer;">${inTruce ? 'Break Truce' : 'Declare War'}</button>`;
            }
          }
        }
        diploRows += `<div style="color:${(colors as Record<string, string>)[st]}; display:flex; justify-content:space-between; align-items:center; margin: 2px 0; font-size:11px;">
          <span>${(icons as Record<string, string>)[st]} <b>${world.factions[a].name}</b>–<b>${world.factions[b].name}</b></span>
          <div style="display:flex; align-items:center;">
             ${actionBtn}
             <span class="logtick" style="margin-left: 4px;">${st.toLowerCase()} ${Math.round(getRelation(world, a, b))}</span>
          </div>
        </div>`;
      }
    }

    if (world.diplo.wars && world.diplo.wars.length > 0) {
      activeWarsHtml += `<div style="margin-top: 8px;"><b style="font-size:9px; color:#e74c3c; text-transform:uppercase; letter-spacing:0.5px;">Active Conflicts:</b>`;
      for (const w of world.diplo.wars) {
        const facA = world.factions[w.a];
        const facB = world.factions[w.b];
        const exhA = Math.round(w.exh[w.a]);
        const exhB = Math.round(w.exh[w.b]);
        const duration = world.tick - w.since;
        const isPlayerWar = world.playerFactionId != null && (world.playerFactionId === w.a || world.playerFactionId === w.b);
        
        let peaceBtn = '';
        if (isPlayerWar) {
          peaceBtn = `<button class="sue-peace-btn" data-a="${w.a}" data-b="${w.b}" style="font-size: 8px; padding: 2px 4px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer; margin-top: 4px;">Sue for Peace</button>`;
        }

        activeWarsHtml += `
          <div style="font-size: 11px; background: rgba(231, 76, 60, 0.08); border: 1px solid rgba(231, 76, 60, 0.15); border-radius: 4px; padding: 4px 6px; margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:#e74c3c; font-weight:700;">⚔ ${facA.name} vs ${facB.name}</span>
              <span style="color:#8fa3bd; font-size: 8px;">t${w.since} (+${duration})</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size: 9px; color:#8fa3bd; margin-top:1px; align-items: center;">
              <span>Exhaustion: <b>${exhA}%</b> vs <b>${exhB}%</b></span>
              ${peaceBtn}
            </div>
          </div>`;
      }
      activeWarsHtml += `</div>`;
    }
  }
  document.getElementById('factions')!.innerHTML = rows + (diploRows ? '<hr>' + diploRows : '') + (activeWarsHtml ? '<hr>' + activeWarsHtml : '');
  drawChart(world);

  // Sync Policy Sliders
  const policyEmpty = document.getElementById('policy-observer-empty');
  const policyPanel = document.getElementById('policy-panel');
  if (world.playerFactionId != null && world.factions[world.playerFactionId]) {
    if (policyEmpty) policyEmpty.style.display = 'none';
    if (policyPanel) policyPanel.style.display = 'block';
    
    const p = world.factions[world.playerFactionId].policy!;
    const labels = getPolicyLabels(world, world.playerFactionId);
    
    const updateSlider = (id: string, val: number, descHtml: string) => {
      const el = document.getElementById(`policy-${id}`) as HTMLInputElement;
      const valEl = document.getElementById(`policy-${id}-val`);
      const descEl = document.getElementById(`policy-desc-${id}`);
      if (el && valEl && document.activeElement !== el) {
        el.value = val.toString();
        valEl.textContent = val.toFixed(1);
      }
      if (descEl) descEl.innerHTML = descHtml;
    };
    
    updateSlider('expansion', p.expansion, labels.expansion);
    updateSlider('trade', p.tradeStance, labels.tradeStance);
    updateSlider('recruit', p.recruitment, labels.recruitment);
    updateSlider('garrison', p.garrison, labels.garrison);
    updateSlider('tax', p.taxRate, labels.taxRate);
    updateSlider('rations', p.rations, labels.rations);
    
    document.querySelectorAll('.stance-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`stance-${p.militaryStance}`)?.classList.add('active');
    
    
    const stanceDescEl = document.getElementById('policy-desc-stance');
    if (stanceDescEl) stanceDescEl.innerHTML = labels.militaryStance;
    
    // Context header
    const facSummary = summaries[world.playerFactionId];
    if (facSummary) {
      const goldEl = document.getElementById('policy-ctx-gold');
      const popEl = document.getElementById('policy-ctx-pop');
      const armyEl = document.getElementById('policy-ctx-army');
      if (goldEl) goldEl.textContent = `${facSummary.gold}g`;
      if (popEl) popEl.textContent = `${facSummary.population}`;
      if (armyEl) {
        const army = world.agents.filter(a => a.factionId === world.playerFactionId && a.type === 'soldier').length;
        armyEl.textContent = `${army}`;
      }
    }
  } else {
    // Hide policy sliders for observer
    const policyEmpty = document.getElementById('policy-observer-empty');
    const policyPanel = document.getElementById('policy-panel');
    if (policyEmpty) policyEmpty.style.display = 'block';
    if (policyPanel) policyPanel.style.display = 'none';
  }

  // Inspector
  const panel = document.getElementById('inspector')!;
  if (!selected) { panel.innerHTML = '<i>Click a hex to inspect</i>'; }
  else {
    const hex = selected;
    const t = (TERRAIN as Record<string, any>)[hex.terrain];
    const settlement = settlementAt(world, hex.q, hex.r);
    const owner = hex.owner !== null ? world.settlements.find(s => s.id === hex.owner) : null;
    let html = `<b>${t.name}</b> (${hex.q}, ${hex.r})<br>`;
    html += `Move cost: ${t.moveCost === Infinity ? '—' : t.moveCost}<br>`;
    const piles = Object.entries(hex.resources as Record<string, number>).filter(([, v]) => v >= 1)
      .map(([k, v]) => `${k} ${fmt(v)}`).join(', ');
    if (piles) html += `<b>On hex:</b> ${piles}<br>`;
    if (hex.building) html += `Building: ${hex.building} (${fmt(hex.buildingIntegrity)}%)<br>`;
    if (owner && !settlement) html += `Territory of <b>${owner.name}</b><br>`;

    if (settlement) {
      const s = settlement;
      const fac = world.factions[s.factionId];
      html += `<hr><b style="color:${fac.color}">${s.name}</b> — ${TIERS[s.tier].name} of ${fac.name}<br>`;
      // Calculate net gold
      const taxRate = policyOf(world, s.factionId).taxRate;
      const taxes = s.population * ECON.GOLD_INCOME_PER_POP * taxRate;
      const soldiers = world.agents.filter(a => a.homeId === s.id && a.type === 'soldier');
      const wages = soldiers.length * DIPLO.WAGE_SOLDIER;
      
      const built = controlledHexes(world, s).map(h => h.building).filter((b): b is string => b !== null);
      const all = [...built, ...s.buildings];
      const upkeep = all.length * ECON.BUILDING_UPKEEP_GOLD;
      const net = taxes - wages - upkeep;
      const netStr = net >= 0 ? `+${net.toFixed(1)}/t` : `${net.toFixed(1)}/t`;
      const netColor = net >= 0 ? '#2ecc71' : '#e74c3c';

      html += `Role: ${s.role} | Goal: <b>${s.goal}</b> | Focus: ${s.focus ?? '—'}<br>`;
      html += `Pop: ${fmt(s.population)} | Tools: ${s.tools} | Net Gold: <span style="color:${netColor};">${netStr}</span><br>`;
      html += `<b>Stock</b> (cap ${storageCap(s)}): food ${fmt(s.stock.food)}, timber ${fmt(s.stock.timber)}, stone ${fmt(s.stock.stone)}, ore ${fmt(s.stock.ore)}<br>`;
      if (all.length) {
        const counts: Record<string, number> = {};
        for (const b of all) {
          if (b) counts[b] = (counts[b] || 0) + 1;
        }
        const consolidated = Object.entries(counts).map(([b, c]) => c > 1 ? `${b} x${c}` : b);
        html += `Buildings: ${consolidated.join(', ')}<br>`;
      }
      const agents = world.agents.filter(a => a.homeId === s.id);
      html += `Agents: ${agents.filter(a => a.type === 'villager').length} villagers, ` +
              `${agents.filter(a => a.type === 'caravan').length} caravans ` +
              `(${agents.filter(a => a.state === 'idle').length} idle)`;
    }
    panel.innerHTML = html;
  }

  // Event log filtering & rendering
  let filteredLog = world.log;
  if (eventFilter !== 'all') {
    filteredLog = world.log.filter(e => {
      const msg = e.msg.toLowerCase();
      if (eventFilter === 'war') {
        return msg.includes('war') || msg.includes('perished') || msg.includes('fallen') || msg.includes('destroyed') || msg.includes('opportunistic') || msg.includes('outrage');
      }
      if (eventFilter === 'trade') {
        return msg.includes('bought') || msg.includes('sold') || msg.includes('transferred') || msg.includes('tribute') || msg.includes('bartered') || msg.includes('gift');
      }
      if (eventFilter === 'build') {
        return msg.includes('built') || msg.includes('upgraded') || msg.includes('founded') || msg.includes('paved') || msg.includes('bridged') || msg.includes('colony');
      }
      return true;
    });
  }

  document.getElementById('log')!.innerHTML = filteredLog.slice(-12).reverse()
    .map(e => {
      let badge = '⚱';
      let color = '#dfe6ee';
      const msg = e.msg.toLowerCase();
      if (msg.includes('war') || msg.includes('outrage')) { badge = '⚔'; color = '#e74c3c'; }
      else if (msg.includes('truce') || msg.includes('peace') || msg.includes('gift')) { badge = '🤝'; color = '#2ecc71'; }
      else if (msg.includes('built') || msg.includes('paved') || msg.includes('bridged')) { badge = '🏠'; color = '#3498db'; }
      else if (msg.includes('perished') || msg.includes('fallen') || msg.includes('destroyed')) { badge = '💀'; color = '#95a5a6'; }
      else if (msg.includes('bought') || msg.includes('sold') || msg.includes('transferred') || msg.includes('tribute') || msg.includes('bartered')) { badge = '💰'; color = '#f1c40f'; }
      else if (msg.includes('upgraded') || msg.includes('founded') || msg.includes('colony')) { badge = '👑'; color = '#9b59b6'; }
      return `
        <div class="log-item" style="border-left: 3px solid ${color}">
          <span class="logtick">t${e.tick}</span>
          <span class="log-badge">${badge}</span>
          <span class="logtext" style="color:${color === '#95a5a6' ? '#8fa3bd' : '#e2e8f0'}">${e.msg}</span>
        </div>`;
    }).join('');
}
