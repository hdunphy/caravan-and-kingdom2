import { TIERS, ECON, DIPLO, BUILDINGS } from '../../core/constants.js';
import { policyOf } from '../../sim/policy.js';
import { controlledHexes } from '../../sim/settlement.js';
import type { World, Settlement } from '../../types.js';

let currentSort = localStorage.getItem('cnk_realm_sort') || 'name';
let sortAsc = localStorage.getItem('cnk_realm_sort_dir') !== 'desc';
let sortBound = false;

function bindSortEvents() {
  if (sortBound) return;
  const headers = document.querySelectorAll('#realm-table th[data-sort]');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const el = th as HTMLElement;
      const key = el.dataset.sort!;
      if (currentSort === key) {
        sortAsc = !sortAsc;
      } else {
        currentSort = key;
        sortAsc = true;
      }
      localStorage.setItem('cnk_realm_sort', currentSort);
      localStorage.setItem('cnk_realm_sort_dir', sortAsc ? 'asc' : 'desc');
      if ((window as any)._lastWorldRealm) {
        renderRealmTab((window as any)._lastWorldRealm);
      }
    });
  });
  sortBound = true;
}

export function renderRealmTab(world: World) {
  (window as any)._lastWorldRealm = world;
  bindSortEvents();

  const emptyMsg = document.getElementById('realm-observer-empty');
  const panel = document.getElementById('realm-panel');

  if (world.playerFactionId == null) {
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (panel) panel.style.display = 'none';
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';
  if (panel) panel.style.display = 'block';

  const mySettlements = (world.playerFactionId !== null ? (world.settlementsByFaction?.get(world.playerFactionId) || []) : []) as Settlement[];
  const myFaction = world.factions[world.playerFactionId];
  if (!myFaction) return;

  const totalPop = mySettlements.reduce((sum, s) => sum + s.population, 0);
  const armySize = world.agents.filter(a => a.factionId === world.playerFactionId && a.type === 'soldier').length;
  const activeWars = world.diplo.wars.filter(w => w.a === world.playerFactionId || w.b === world.playerFactionId).length;

  let totalNetIncome = 0;
  const settlementStats = mySettlements.map(s => {
    const taxRate = policyOf(world, s.factionId).taxRate;
    const taxes = s.population * ECON.GOLD_INCOME_PER_POP * taxRate;
    const soldiers = world.agents.filter(a => a.homeId === s.id && a.type === 'soldier');
    const wages = soldiers.length * DIPLO.WAGE_SOLDIER;
    const built = controlledHexes(world, s).filter(h => h.building).map(h => h.building);
    const all = [...built, ...s.buildings];
    const upkeep = all.length * ECON.BUILDING_UPKEEP_GOLD;
    const net = taxes - wages - upkeep;
    totalNetIncome += net;

    const popTrend = s.population > ((s as any)._lastPop || s.population) ? '▲' : s.population < ((s as any)._lastPop || s.population) ? '▼' : '';
    (s as any)._lastPop = s.population;

    const foodUsage = s.population * ECON.FOOD_PER_POP * policyOf(world, s.factionId).rations;
    const foodDays = foodUsage > 0 ? s.stock.food / foodUsage : 999;

    let flag = '';
    let rowColor = 'inherit';
    if (foodDays < 10) { flag = 'STARVING'; rowColor = 'rgba(231, 76, 60, 0.15)'; }
    else if (s.siegeHp != null) { flag = 'SIEGE'; rowColor = 'rgba(231, 76, 60, 0.15)'; }
    else if (myFaction.treasury < 0 && myFaction.goal === 'AUSTERITY') { flag = 'AUSTERITY'; rowColor = 'rgba(241, 196, 15, 0.1)'; }

    return { s, net, foodDays, popTrend, flag, rowColor, tierLevel: TIERS[s.tier].radius };
  });

  const header = document.getElementById('realm-header');
  if (header) {
    const netStr = totalNetIncome >= 0 ? `+${totalNetIncome.toFixed(1)}` : totalNetIncome.toFixed(1);
    const netColor = totalNetIncome >= 0 ? '#2ecc71' : '#e74c3c';
    header.innerHTML = `
      <span>Towns: <b>${mySettlements.length}</b></span>
      <span>Pop: <b>${Math.round(totalPop)}</b></span>
      <span>Treasury: <b style="color:#f1c40f">${Math.floor(myFaction.treasury)}g</b></span>
      <span>Army: <b>${armySize}</b></span>
      <span>Wars: <b>${activeWars}</b></span>
      <span>Income: <b style="color:${netColor}">${netStr}/t</b></span>
    `;
  }

  settlementStats.sort((a, b) => {
    let diff = 0;
    if (currentSort === 'name') diff = a.s.name.localeCompare(b.s.name);
    else if (currentSort === 'tier') diff = a.tierLevel - b.tierLevel;
    else if (currentSort === 'pop') diff = a.s.population - b.s.population;
    else if (currentSort === 'food') diff = a.foodDays - b.foodDays;
    else if (currentSort === 'income') diff = a.net - b.net;
    else if (currentSort === 'focus') diff = (myFaction.focus || '').localeCompare(myFaction.focus || ''); // sorting by focus within my settlements is meaningless as they all share myFaction.focus, but let's keep it safe.
    return sortAsc ? diff : -diff;
  });

  document.querySelectorAll('#realm-table th[data-sort]').forEach(th => {
    const el = th as HTMLElement;
    let txt = el.innerText.replace(/ [▲▼]/, '');
    if (el.dataset.sort === currentSort) {
      txt += sortAsc ? ' ▲' : ' ▼';
    }
    el.innerText = txt;
  });

  const tbody = document.getElementById('realm-tbody');
  if (tbody) {
    tbody.innerHTML = settlementStats.map(stat => {
      const netStr = stat.net >= 0 ? `+${stat.net.toFixed(1)}` : stat.net.toFixed(1);
      const netColor = stat.net >= 0 ? '#2ecc71' : '#e74c3c';
      const focusColor = myFaction.focus === 'WAR' ? '#e74c3c' : myFaction.focus === 'MOBILIZE' ? '#f1c40f' : '#2ecc71';
      return `
        <tr class="realm-row" data-id="${stat.s.id}" style="background: ${stat.rowColor}; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.02);">
          <td style="padding: 6px 4px;"><b>${stat.s.name}</b><br><span style="font-size:8px;color:#8fa3bd">${stat.flag}</span></td>
          <td style="padding: 6px 4px;">${TIERS[stat.s.tier].name[0]}</td>
          <td style="padding: 6px 4px;">${Math.round(stat.s.population)} <span style="font-size:8px">${stat.popTrend}</span></td>
          <td style="padding: 6px 4px; color:${stat.foodDays < 10 ? '#e74c3c' : 'inherit'}">${stat.foodDays > 99 ? '99+' : Math.round(stat.foodDays)}d</td>
          <td style="padding: 6px 4px; color:${netColor}">${netStr}</td>
          <td style="padding: 6px 4px; color:${focusColor}">${myFaction.focus ?? 'PEACE'}</td>
        </tr>
      `;
    }).join('');
  }
}
