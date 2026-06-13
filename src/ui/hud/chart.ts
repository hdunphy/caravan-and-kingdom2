// --- History chart (faction pop/gold/military over time) ---
let chartMetric = 'pop';
for (const btn of document.querySelectorAll<HTMLElement>('[data-metric]')) {
  btn.addEventListener('click', () => {
    chartMetric = btn.dataset.metric;
    document.querySelectorAll('[data-metric]').forEach(b => b.classList.toggle('active', b === btn));
  });
}

export function drawChart(world) {
  const canvas = document.getElementById('chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const samples = world.history?.samples ?? [];
  if (samples.length < 2) {
    ctx.fillStyle = '#6c7f99';
    ctx.font = '11px sans-serif';
    ctx.fillText('Gathering history…', 8, h / 2);
    return;
  }

  // Draw war background bands first, before grid and lines!
  samples.forEach((s, i) => {
    if (s.war) {
      const x = (i / (samples.length - 1)) * (w - 4) + 2;
      const stripWidth = Math.max(1.5, (w - 4) / (samples.length - 1));
      ctx.fillStyle = 'rgba(231, 76, 60, 0.15)'; // light red
      ctx.fillRect(x - stripWidth / 2, 12, stripWidth + 0.5, h - 16);
    }
  });

  let max = 1;
  for (const s of samples) for (const f of s.f) max = Math.max(max, f[chartMetric]);

  // Grid: quarter lines
  ctx.strokeStyle = '#2c3a50';
  ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const gy = h - (g / 4) * (h - 14) - 4;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }

  world.factions.forEach((fac, fi) => {
    // Keep plotting curves of eliminated factions, they naturally drop to 0.

    // Gradient fill under the line
    ctx.fillStyle = fac.color + '18'; // ~10% opacity
    ctx.beginPath();
    ctx.moveTo(2, h - 4);
    samples.forEach((s, i) => {
      const x = (i / (samples.length - 1)) * (w - 4) + 2;
      const y = h - 4 - (s.f[fi][chartMetric] / max) * (h - 18);
      ctx.lineTo(x, y);
    });
    ctx.lineTo((samples.length - 1) / (samples.length - 1) * (w - 4) + 2, h - 4);
    ctx.closePath();
    ctx.fill();

    // Line drawing with subtle shadow blur
    ctx.strokeStyle = fac.color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = fac.color;
    ctx.shadowBlur = 3;
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = (i / (samples.length - 1)) * (w - 4) + 2;
      const y = h - 4 - (s.f[fi][chartMetric] / max) * (h - 18);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  });

  ctx.fillStyle = '#8fa3bd';
  ctx.font = "bold 9px 'Inter', sans-serif";
  ctx.textAlign = 'left';
  ctx.fillText(String(Math.round(max)), 3, 11);
  ctx.textAlign = 'right';
  ctx.fillText(`t${samples[0].t}–t${samples[samples.length - 1].t}`, w - 3, 11);
  ctx.textAlign = 'left';
}
