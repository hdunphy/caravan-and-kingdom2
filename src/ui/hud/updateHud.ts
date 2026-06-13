// Observer HUD: faction overview, inspector panel, event log.
import { TERRAIN, TIERS } from '../../core/constants.js';
import { summarize } from '../../sim/gameLoop.js';
import { stateOf, getRelation } from '../../sim/diplomacy.js';
import { settlementAt, controlledHexes, storageCap } from '../../sim/settlement.js';
import { drawChart } from './chart.js';
import type { World } from '../../types.js';

const fmt = n => Math.round(n);

let eventFilter = 'all';
let filterBound = false;
let lastWorld = null;
let lastSelected = null;

function bindFilterEvents() {
  if (filterBound) return;
  const buttons = document.querySelectorAll<HTMLElement>('.event-filter');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      eventFilter = btn.dataset.filter;
      buttons.forEach(b => b.classList.toggle('active', b === btn));
      if (lastWorld) updateHud(lastWorld, lastSelected);
    });
  });
  filterBound = true;
}

export function updateHud(world: World, selected) {
  lastWorld = world;
  lastSelected = selected;
  bindFilterEvents();
  document.getElementById('tick').textContent = `Tick ${world.tick}`;

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
    const focusBadgeColor = focusColors[focus] ?? '#2ecc71';
    const focusHtml = `<span style="font-size: 8px; padding: 1px 4px; border-radius: 4px; background: ${focusBadgeColor}22; border: 1px solid ${focusBadgeColor}; color: ${focusBadgeColor}; font-weight: bold; margin-left: auto;">${focus}</span>`;

    // Vassal badge for living vassals
    let vassalHtml = '';
    if (fac.vassalOf !== undefined) {
      const masterName = world.factions[fac.vassalOf]?.name ?? '?';
      vassalHtml = `<span style="font-size: 8px; padding: 1px 4px; border-radius: 4px; background: #8b572a22; border: 1px solid #8b572a; color: #c68642; font-weight: bold; margin-left: 4px;">VASSAL · ${masterName}</span>`;
    }

    return `
    <div class="faction-row">
      <div class="faction-header" style="display: flex; align-items: center; width: 100%;">
        <span class="swatch" style="color:${fac.color}; background:${fac.color}; box-shadow: 0 0 8px ${fac.color}"></span>
        <span style="color:${fac.color}; font-weight:700;">${f.faction}</span>
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
        diploRows += `<div style="color:${colors[st]}; display:flex; justify-content:space-between; align-items:center; margin: 2px 0; font-size:11px;">
          <span>${icons[st]} <b>${world.factions[a].name}</b>–<b>${world.factions[b].name}</b></span>
          <span class="logtick">${st.toLowerCase()} ${Math.round(getRelation(world, a, b))}</span></div>`;
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
        activeWarsHtml += `
          <div style="font-size: 11px; background: rgba(231, 76, 60, 0.08); border: 1px solid rgba(231, 76, 60, 0.15); border-radius: 4px; padding: 4px 6px; margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:#e74c3c; font-weight:700;">⚔ ${facA.name} vs ${facB.name}</span>
              <span style="color:#8fa3bd; font-size: 8px;">t${w.since} (+${duration})</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size: 9px; color:#8fa3bd; margin-top:1px;">
              <span>Exhaustion: <b>${exhA}%</b> vs <b>${exhB}%</b></span>
            </div>
          </div>`;
      }
      activeWarsHtml += `</div>`;
    }
  }
  document.getElementById('factions').innerHTML = rows + (diploRows ? '<hr>' + diploRows : '') + (activeWarsHtml ? '<hr>' + activeWarsHtml : '');
  drawChart(world);

  // Inspector
  const panel = document.getElementById('inspector');
  if (!selected) { panel.innerHTML = '<i>Click a hex to inspect</i>'; }
  else {
    const hex = selected;
    const t = TERRAIN[hex.terrain];
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
      html += `Role: ${s.role} | Goal: <b>${s.goal}</b> | Focus: ${s.focus ?? '—'}<br>`;
      html += `Pop: ${fmt(s.population)} | Tools: ${s.tools} | Gold: ${fmt(s.gold)}<br>`;
      html += `<b>Stock</b> (cap ${storageCap(s)}): food ${fmt(s.stock.food)}, timber ${fmt(s.stock.timber)}, stone ${fmt(s.stock.stone)}, ore ${fmt(s.stock.ore)}<br>`;
      const built = controlledHexes(world, s).filter(h => h.building).map(h => h.building);
      const all = [...built, ...s.buildings];
      if (all.length) html += `Buildings: ${all.join(', ')}<br>`;
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

  document.getElementById('log').innerHTML = filteredLog.slice(-12).reverse()
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
