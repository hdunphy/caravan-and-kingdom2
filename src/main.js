// Bootstrap: world gen + render loop, with sim stepping decoupled from rendering (GDD 7).
import { generateWorld } from './sim/worldgen.js';
import { step } from './sim/gameLoop.js';
import { makeCamera } from './ui/camera.js';
import { render, HEX_SIZE } from './ui/renderer.js';
import { updateHud } from './ui/hud.js';
import { pixelToHex, key } from './core/hex.js';

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener('resize', resize);
resize();

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') ?? '42', 10);
let world = generateWorld(seed, 24, 4);

let evolvedTraits = null;
let selectedPlaystyle = 'default';

function applyPlaystyle(w) {
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
    selectedPlaystyle = e.target.value;
    world = generateWorld(world.seed, 24, 4);
    applyPlaystyle(world);
    selected = null;
    updateHud(world, selected);
  });
}

const cam = makeCamera(canvas);
let selected = null;
let speed = 1; // ticks per frame; 0 = paused

// Tab switching logic
document.querySelectorAll('.tab-button').forEach(btn => {
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
  const inspectorTabButton = document.querySelector('[data-tab="inspector-tab"]');
  if (inspectorTabButton) inspectorTabButton.click();
});

for (const btn of document.querySelectorAll('[data-speed]')) {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', b === btn));
  });
}
document.getElementById('reseed').addEventListener('click', () => {
  world = generateWorld(Math.floor(Math.random() * 1e9), 24, 4);
  applyPlaystyle(world);
  selected = null;
});

// Fixed timestep: 1x = 8 sim ticks per second, regardless of frame rate.
const BASE_TPS = 8;
let last = performance.now();
let acc = 0;
let hudTimer = 0;
function frame(now) {
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
