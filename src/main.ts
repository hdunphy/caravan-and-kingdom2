// Bootstrap: world gen + render loop, with sim stepping decoupled from rendering (GDD 7).
import { generateWorld } from './sim/worldgen.js';
import { step } from './sim/gameLoop.js';
import { makeCamera } from './ui/camera.js';
import { resolveEventChoice } from './sim/systems/events.js';
import { enactProject } from './sim/projects.js';
import { render, HEX_SIZE } from './ui/renderer.js';
import { updateHud, dismissedAlertKeys } from './ui/hud.js';
import { updateSettlementCard } from './ui/hud/card.js';
import { pixelToHex, hexToPixel, key } from './core/hex.js';
import { saveWorld, loadWorld } from './sim/serialize.js';
import { sueForPeace } from './sim/diplomacy/peace.js';
import { playerDeclareWar } from './sim/diplomacy/war.js';
import { soldierCap } from './sim/diplomacy.js';
import type { World } from './types.js';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener('resize', resize);
resize();

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') ?? '42', 10);
const mapRadius = parseInt(params.get('radius') ?? '24', 10);
const factionCount = parseInt(params.get('factions') ?? '4', 10);
let world = generateWorld(seed, mapRadius, factionCount);

// Auto-offer autosave on boot
const autosave = localStorage.getItem('cnk_autosave');
let loadedAutosave = false;
if (autosave) {
  if (confirm('An autosave was found. Load it?')) {
    try {
      world = loadWorld(autosave);
      console.log('Autosave loaded.');
      loadedAutosave = true;
    } catch (e) {
      console.error('Failed to load autosave:', e);
    }
  }
}

let evolvedTraits: any = null;
let selectedPlaystyle = 'default';

function applyPlaystyle(w: World) {
  if (selectedPlaystyle === 'evolved' && evolvedTraits) {
    for (const fid of Object.keys(evolvedTraits)) {
      const fIdx = parseInt(fid, 10);
      if (w.factions[fIdx]) {
        w.factions[fIdx].traits = { ...evolvedTraits[fid].traits };
        w.factions[fIdx].persona = evolvedTraits[fid].persona;
      }
    }
  }
}

fetch('./evolved_traits.json')
  .then(r => r.json())
  .then(data => {
    evolvedTraits = data;
    const container = document.getElementById('playstyle-container');
    if (container) container.style.display = 'flex';
  })
  .catch(() => {});

const select = document.getElementById('playstyle-select');
if (select) {
  select.addEventListener('change', e => {
    selectedPlaystyle = (e.target as HTMLSelectElement).value;
    world = generateWorld(world.seed, mapRadius, factionCount);
    applyPlaystyle(world);
    selected = null;
    updateHud(world, selected);
  });
}

const cam = makeCamera(canvas);
let selected: any = null;
let speed = 1; // ticks per frame; 0 = paused

export let activeLens = 'none';

document.getElementById('lens-controls')?.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('.lens-btn') as HTMLElement;
  if (!btn) return;
  document.querySelectorAll('.lens-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeLens = btn.dataset.lens || 'none';
});

// Tab switching logic
const savedTab = localStorage.getItem('cnk_active_tab') ?? 'realm-tab';
document.querySelectorAll<HTMLElement>('.tab-button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('stance-btn')) return; // handled separately
    document.querySelectorAll('.tab-container .tab-button').forEach(b => b.classList.toggle('active', b === btn));
    const targetTab = btn.dataset.tab;
    if (targetTab) {
      localStorage.setItem('cnk_active_tab', targetTab);
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === targetTab);
      });
    }
  });
  if (btn.dataset.tab === savedTab) {
    btn.click();
  }
});

canvas.addEventListener('click', e => {
  if (cam.moved) return; // it was a drag
  const rect = canvas.getBoundingClientRect();
  const { x, y } = cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const { q, r } = pixelToHex(x, y, HEX_SIZE);
  
  if (activeLens === 'colony' && world.playerFactionId !== null) {
    const hex = world.hexes.get(key(q, r));
    if (hex && hex.owner === null && hex.terrain !== 'WATER' && hex.terrain !== 'MOUNTAINS' && hex.terrain !== 'RIVER') {
      world.playerTargetColony = { q, r };
      updateHud(world, hex);
      return;
    }
  }

  selected = world.hexes.get(key(q, r)) ?? null;
  updateHud(world, selected);
});

export function selectSettlementHex(s: any) {
  const p = hexToPixel(s.q, s.r, HEX_SIZE);
  cam.x = p.x;
  cam.y = p.y;
  selected = world.hexes.get(key(s.q, s.r)) ?? null;
  updateHud(world, selected);
}

window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const btn = document.querySelector(`[data-speed="${speed === 0 ? 1 : 0}"]`) as HTMLElement;
    if (btn) btn.click();
  } else if (e.code === 'Digit1') { document.querySelector<HTMLElement>('[data-speed="1"]')?.click(); }
  else if (e.code === 'Digit2') { document.querySelector<HTMLElement>('[data-speed="4"]')?.click(); }
  else if (e.code === 'Digit3') { document.querySelector<HTMLElement>('[data-speed="16"]')?.click(); }
  else if (e.code === 'Escape') {
    selected = null;
    updateHud(world, selected);
  } else if (e.code === 'KeyW' || e.code === 'ArrowUp') { cam.y -= 20 / cam.zoom; }
  else if (e.code === 'KeyS' || e.code === 'ArrowDown') { cam.y += 20 / cam.zoom; }
  else if (e.code === 'KeyA' || e.code === 'ArrowLeft') { cam.x -= 20 / cam.zoom; }
  else if (e.code === 'KeyD' || e.code === 'ArrowRight') { cam.x += 20 / cam.zoom; }
  else if (e.code === 'Equal' || e.code === 'NumpadAdd') { cam.zoom = Math.min(4, cam.zoom * 1.2); }
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract') { cam.zoom = Math.max(0.3, cam.zoom / 1.2); }
  else if (e.code === 'Tab') {
    e.preventDefault();
    if (world.playerFactionId != null) {
      const mySettlements = world.settlements.filter(s => s.factionId === world.playerFactionId);
      if (mySettlements.length > 0) {
        let idx = mySettlements.findIndex(s => selected && selected.q === s.q && selected.r === s.r);
        idx = (idx + 1) % mySettlements.length;
        selectSettlementHex(mySettlements[idx]);
      }
    }
  }
});

for (const btn of document.querySelectorAll<HTMLElement>('[data-speed]')) {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', b === btn));
  });
}
document.getElementById('reseed')!.addEventListener('click', () => {
  world = generateWorld(Math.floor(Math.random() * 1e9), mapRadius, factionCount);
  applyPlaystyle(world);
  selected = null;
  gameOverTriggered = false;
  showFactionPicker();
});

function showFactionPicker() {
  speed = 0;
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-speed="0"]')?.classList.add('active');
  const modal = document.getElementById('faction-picker-modal')!;
  const list = document.getElementById('faction-picker-list')!;
  list.innerHTML = '';
  
  for (const fac of world.factions) {
    if (fac.eliminated) continue;
    const btn = document.createElement('button');
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    btn.innerHTML = `<span class="swatch" style="background:${fac.color};"></span> <span style="font-weight:600;">${fac.name}</span> <span style="margin-left:auto; font-size:10px; color:#8fa3bd;">${fac.persona}</span>`;
    btn.onclick = () => {
      world.playerFactionId = fac.id;
      modal.style.display = 'none';
      speed = 1;
      document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-speed="1"]')?.classList.add('active');
      updateHud(world, selected);
    };
    list.appendChild(btn);
  }
  
  document.getElementById('observe-btn')!.onclick = () => {
    world.playerFactionId = null;
    modal.style.display = 'none';
    speed = 1;
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-speed="1"]')?.classList.add('active');
    updateHud(world, selected);
  };
  
  modal.style.display = 'flex';
}

let gameOverTriggered = false;
function checkWinLoss(w: World) {
  if (w.playerFactionId == null || gameOverTriggered) return;
  const mySettlements = w.settlements.filter(s => s.factionId === w.playerFactionId);
  const isEliminated = mySettlements.length === 0 && w.tick > 10;
  
  const totalPop = w.settlements.reduce((sum, s) => sum + s.population, 0);
  const myPop = mySettlements.reduce((sum, s) => sum + s.population, 0);
  const aliveFactions = w.factions.filter(f => !f.eliminated);
  
  const isHegemony = aliveFactions.every(f => {
    if (f.id === w.playerFactionId) return true;
    let curr = f.id;
    let limit = 20;
    while (curr != null && limit-- > 0) {
      if (curr === w.playerFactionId) return true;
      curr = w.factions[curr].vassalOf;
    }
    return false;
  });
  
  const isWin = (myPop > totalPop * 0.6 && totalPop > 0) || isHegemony;
  
  if (isEliminated) {
    showGameOver("Dynasty Ends", "Your kingdom has fallen into ruin and your lands are lost. History will forget your name.", "#e74c3c");
  } else if (isWin) {
    showGameOver("Victory", "Your dynasty has secured dominance over the known world. A golden age begins!", "#f1c40f");
  }
}

function showGameOver(title: string, desc: string, color: string) {
  gameOverTriggered = true;
  speed = 0;
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-speed="0"]')?.classList.add('active');
  
  const banner = document.getElementById('game-over-banner')!;
  document.getElementById('game-over-title')!.textContent = title;
  document.getElementById('game-over-title')!.style.color = color;
  document.getElementById('game-over-desc')!.textContent = desc;
  banner.style.display = 'flex';
}

let criticalAlertActive = false;
function checkCriticalAlerts(w: World) {
  if (criticalAlertActive || w.playerFactionId == null) return;
  const critical = w.alerts?.find(a => a.severity === 'CRITICAL' && !a.acknowledged && (a.factionId === w.playerFactionId || a.factionId === null));
  if (critical) {
    criticalAlertActive = true;
    speed = 0;
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-speed="0"]')?.classList.add('active');
    const modal = document.getElementById('critical-alert-modal')!;
    document.getElementById('critical-alert-desc')!.textContent = critical.msg;
    
    document.getElementById('critical-alert-ack-btn')!.onclick = () => {
      critical.acknowledged = true;
      criticalAlertActive = false;
      modal.style.display = 'none';
      speed = 1;
      document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-speed="1"]')?.classList.add('active');
      updateHud(w, selected);
    };

    document.getElementById('critical-alert-pan-btn')!.onclick = () => {
      if (critical.q != null && critical.r != null) {
        const p = hexToPixel(critical.q, critical.r, HEX_SIZE);
        cam.x = p.x;
        cam.y = p.y;
        selected = world.hexes.get(key(critical.q, critical.r)) ?? null;
      }
      critical.acknowledged = true;
      criticalAlertActive = false;
      modal.style.display = 'none';
      updateHud(w, selected);
      const inspectorTabButton = document.querySelector<HTMLElement>('[data-tab="inspector-tab"]');
      if (inspectorTabButton) inspectorTabButton.click();
    };

    modal.style.display = 'flex';
  }
}

document.getElementById('continue-observer-btn')!.onclick = () => {
  world.playerFactionId = null;
  document.getElementById('game-over-banner')!.style.display = 'none';
  speed = 1;
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-speed="1"]')?.classList.add('active');
  updateHud(world, selected);
};

if (!loadedAutosave) {
  showFactionPicker();
}

document.getElementById('alerts-panel')!.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const alertEl = target.closest('.alert-item') as HTMLElement;
  if (!alertEl) return;
  
  const type = alertEl.dataset.type;
  const targetId = parseInt(alertEl.dataset.target!);
  const qStr = alertEl.dataset.q;
  const rStr = alertEl.dataset.r;
  
  if (target.classList.contains('dismiss-alert-btn')) {
    dismissedAlertKeys.add(`${type}-${targetId}`);
    updateHud(world, selected);
    return;
  }
  
  if (target.classList.contains('alert-choice-btn')) {
    const eventId = target.dataset.eventid!;
    const choiceId = target.dataset.choiceid!;
    const factionId = world.playerFactionId!;
    resolveEventChoice(world, factionId, eventId, choiceId);
    
    // Remove the choices from the alert so it doesn't appear again
    const alert = world.alerts.find(a => a.eventId === eventId);
    if (alert) alert.choices = undefined;
    updateHud(world, selected);
    return;
  }
  
  // Jump to location
    if (qStr && rStr) {
    const q = parseInt(qStr);
    const r = parseInt(rStr);
    selectSettlementHex({q, r});
  } else {
    // Fallback for alerts that only have targetId (e.g. settlements)
    const s = world.settlements.find(s => s.id === targetId);
    if (s) {
      selectSettlementHex(s);
    }
  }
});

document.body.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('sue-peace-btn')) {
    const a = parseInt(target.dataset.a!);
    const b = parseInt(target.dataset.b!);
    const war = world.diplo?.wars.find(w => w.a === a && w.b === b);
    if (war && world.playerFactionId != null) {
      sueForPeace(world, war, world.playerFactionId);
      updateHud(world, selected);
    }
  }
  // War actions
  if (target.id === 'btn-declare-war') {
    const targetFaction = parseInt(target.dataset.faction!);
    playerDeclareWar(world, targetFaction);
    updateHud(world, selected);
    return;
  }
  
  if (target.id === 'btn-set-war-goal') {
    const warIdx = parseInt(target.dataset.waridx!);
    const targetId = parseInt(target.dataset.targetid!);
    const war = world.diplo.wars[warIdx];
    if (war) {
      if (war.a === world.playerFactionId) war.goal_a = targetId;
      else if (war.b === world.playerFactionId) war.goal_b = targetId;
      updateHud(world, selected);
    }
    return;
  }
  if (target.classList.contains('declare-war-btn')) {
    const targetId = parseInt(target.dataset.target!);
    if (world.playerFactionId != null) {
      playerDeclareWar(world, targetId);
      updateHud(world, selected);
    }
  }
  if (target.classList.contains('set-focus-btn')) {
    const targetId = parseInt(target.dataset.target!);
    const focus = target.dataset.focus as string;
    const s = world.settlements.find(x => x.id === targetId);
    if (s && world.playerFactionId === s.factionId) {
      world.factions[s.factionId].focus = focus;
      updateHud(world, selected);
    }
  }
  const realmRow = target.closest('.realm-row') as HTMLElement;
  if (realmRow) {
    const sId = parseInt(realmRow.dataset.id!);
    const s = world.settlements.find(x => x.id === sId);
    if (s) selectSettlementHex(s);
  }
});

// Policy tab handlers
document.getElementById('policy-panel')?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('enact-project-btn') && !target.hasAttribute('disabled')) {
    const projId = target.dataset.projid!;
    if (world.playerFactionId !== null) {
      enactProject(world, world.playerFactionId, projId);
      updateHud(world, selected);
    }
  }
});

// Wire up Policy sliders
const policyInputs = ['expansion', 'trade', 'recruit', 'garrison', 'tax', 'rations'];
for (const key of policyInputs) {
  const el = document.getElementById(`policy-${key}`) as HTMLInputElement;
  const valEl = document.getElementById(`policy-${key}-val`);
  if (el && valEl) {
    el.addEventListener('input', () => {
      valEl.textContent = el.value;
      if (world.playerFactionId != null && world.factions[world.playerFactionId]) {
        const p = world.factions[world.playerFactionId].policy!;
        if (key === 'recruit') {
          // Slider is an absolute soldier count; store it as a fraction of the cap
          // so the handle position holds steady as the cap grows with the empire.
          const cap = soldierCap(world, world.playerFactionId);
          p.recruitment = cap > 0 ? parseFloat(el.value) / cap : 0;
        }
        else if (key === 'trade') p.tradeStance = parseFloat(el.value);
        else if (key === 'tax') p.taxRate = parseFloat(el.value);
        else (p as any)[key] = parseFloat(el.value);
        updateHud(world, selected); // Sync descriptions immediately
      }
    });
  }
}

// 3-way stance buttons
document.querySelectorAll('.stance-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (world.playerFactionId != null && world.factions[world.playerFactionId]) {
      const p = world.factions[world.playerFactionId].policy!;
      p.militaryStance = btn.id.replace('stance-', '') as 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE';
      updateHud(world, selected);
    }
  });
});

// Presets
const presets = {
  peace: { expansion: 1.5, tradeStance: 1.5, recruitment: 0.5, garrison: 0.5, taxRate: 0.8, rations: 1.2, militaryStance: 'DEFENSIVE' as const },
  war: { expansion: 0.5, tradeStance: 0.2, recruitment: 2.0, garrison: 2.0, taxRate: 1.5, rations: 0.8, militaryStance: 'AGGRESSIVE' as const },
  merchant: { expansion: 1.0, tradeStance: 3.0, recruitment: 0.8, garrison: 1.0, taxRate: 1.0, rations: 1.0, militaryStance: 'BALANCED' as const },
  reset: { expansion: 1.0, tradeStance: 1.0, recruitment: 1.0, garrison: 1.0, taxRate: 1.0, rations: 1.0, militaryStance: 'BALANCED' as const },
};

Object.entries(presets).forEach(([id, preset]) => {
  document.getElementById(`preset-${id}`)?.addEventListener('click', () => {
    if (world.playerFactionId != null && world.factions[world.playerFactionId]) {
      world.factions[world.playerFactionId].policy = { ...preset };
      updateHud(world, selected);
    }
  });
});

document.getElementById('save-btn')!.addEventListener('click', () => {
  const json = saveWorld(world);
  localStorage.setItem('cnk_autosave', json);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cnk_save_${world.tick}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const loadBtn = document.getElementById('load-btn')!;
const loadFile = document.getElementById('load-file') as HTMLInputElement;
loadBtn.addEventListener('click', () => loadFile.click());
loadFile.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const json = e.target?.result as string;
    if (json) {
      try {
        world = loadWorld(json);
        applyPlaystyle(world);
        selected = null;
        gameOverTriggered = false;
        console.log('World loaded.');
      } catch (err) {
        console.error('Failed to load world', err);
      }
    }
  };
  reader.readAsText(file);
});

// Fixed timestep: 1x = 8 sim ticks per second, regardless of frame rate.
const BASE_TPS = 8;
let last = performance.now();
let acc = 0;
let hudTimer = 0;

const profilerActive = params.get('debug') === '1';
let profTicks = 0, profSimMs = 0, profRenderMs = 0;

function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt * BASE_TPS * speed;
  let n = Math.floor(acc);
  if (n > 200) { n = 200; acc = 0; } else acc -= n;
  const budget = performance.now() + 25; // ms per frame for sim stepping
  
  const t0 = performance.now();
  let ticksRun = 0;
  while (n-- > 0) {
    step(world);
    ticksRun++;
    checkCriticalAlerts(world);
    if (speed === 0) break; // Pause immediately
    if (performance.now() > budget) { acc = 0; break; } // keep UI responsive
  }
  const t1 = performance.now();
  
  // Update the settlement card position live
  updateSettlementCard(world, selected, cam);
  checkWinLoss(world);
  render(ctx, world, cam, selected);
  const t2 = performance.now();

  if (profilerActive) {
    profTicks += ticksRun;
    profSimMs += (t1 - t0);
    profRenderMs += (t2 - t1);
    if (profTicks >= 60 || profRenderMs >= 1000) {
      const avgSim = profTicks > 0 ? (profSimMs / profTicks).toFixed(2) : '0.00';
      console.log(`[Profiler] avg sim: ${avgSim}ms/tick | frame render: ${t2-t1}ms | hexes: ${world.hexes.size} | agents: ${world.agents.length}`);
      profTicks = 0; profSimMs = 0; profRenderMs = 0;
    }
  }

  if (++hudTimer % 10 === 0 || speed === 0) updateHud(world, selected);
  requestAnimationFrame(frame);
}
updateHud(world, selected);
requestAnimationFrame(t => { last = t; frame(t); });
