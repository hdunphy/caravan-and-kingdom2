// Bootstrap: world gen + render loop, with sim stepping decoupled from rendering (GDD 7).
import { generateWorld } from './sim/worldgen.js';
import { step } from './sim/gameLoop.js';
import { makeCamera } from './ui/camera.js';
import { render, HEX_SIZE } from './ui/renderer.js';
import { updateHud } from './ui/hud.js';
import { pixelToHex, key } from './core/hex.js';
import { saveWorld, loadWorld } from './sim/serialize.js';
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
let world = generateWorld(seed, 24, 4);

// Auto-offer autosave on boot
const autosave = localStorage.getItem('cnk_autosave');
if (autosave) {
  if (confirm('An autosave was found. Load it?')) {
    try {
      world = loadWorld(autosave);
      console.log('Autosave loaded.');
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
    world = generateWorld(world.seed, 24, 4);
    applyPlaystyle(world);
    selected = null;
    updateHud(world, selected);
  });
}

const cam = makeCamera(canvas);
let selected: any = null;
let speed = 1; // ticks per frame; 0 = paused

// Tab switching logic
document.querySelectorAll<HTMLElement>('.tab-button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b === btn));
    const targetTab = btn.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === targetTab);
    });
  });
});

canvas.addEventListener('click', e => {
  if (cam.moved) return; // it was a drag
  const rect = canvas.getBoundingClientRect();
  const { x, y } = cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const { q, r } = pixelToHex(x, y, HEX_SIZE);
  selected = world.hexes.get(key(q, r)) ?? null;

  // Auto-focus the Inspector tab
  const inspectorTabButton = document.querySelector<HTMLElement>('[data-tab="inspector-tab"]');
  if (inspectorTabButton) inspectorTabButton.click();
});

for (const btn of document.querySelectorAll<HTMLElement>('[data-speed]')) {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', b === btn));
  });
}
document.getElementById('reseed')!.addEventListener('click', () => {
  world = generateWorld(Math.floor(Math.random() * 1e9), 24, 4);
  applyPlaystyle(world);
  selected = null;
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
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt * BASE_TPS * speed;
  let n = Math.floor(acc);
  if (n > 200) { n = 200; acc = 0; } else acc -= n;
  const budget = performance.now() + 25; // ms per frame for sim stepping
  while (n-- > 0) {
    step(world);
    if (performance.now() > budget) { acc = 0; break; } // keep UI responsive
  }
  render(ctx, world, cam, selected);
  if (++hudTimer % 10 === 0 || speed === 0) updateHud(world, selected);
  requestAnimationFrame(frame);
}
updateHud(world, selected);
requestAnimationFrame(t => { last = t; frame(t); });
