// Canvas renderer: hex map, territory borders, buildings, resource piles, agents.
import { hexToPixel, hexCorners, HEX_DIRS, key } from '../core/hex.js';
import { TERRAIN, TIERS } from '../core/constants.js';

export const HEX_SIZE = 26;

// Render-side position smoothing: the sim moves agents hex-to-hex, the
// renderer eases their drawn position toward the true one every frame.
const displayPos = new Map();
function smoothPos(agent, tx, ty) {
  let p = displayPos.get(agent.id);
  if (!p) { p = { x: tx, y: ty }; displayPos.set(agent.id, p); return p; }
  const dx = tx - p.x, dy = ty - p.y;
  if (dx * dx + dy * dy > (HEX_SIZE * 5) ** 2) { p.x = tx; p.y = ty; } // teleport-scale jump: snap
  else { p.x += dx * 0.2; p.y += dy * 0.2; }
  return p;
}

export function render(ctx, world, cam, selected) {
  const { canvas } = ctx;
  ctx.fillStyle = '#1a2230';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  const factionColor = id => world.factions[id]?.color ?? '#fff';
  const settlementById = new Map(world.settlements.map(s => [s.id, s]));
  const settlementKeys = new Set(world.settlements.map(s => key(s.q, s.r)));

  // Hexes
  for (const hex of world.hexes.values()) {
    const { x, y } = hexToPixel(hex.q, hex.r, HEX_SIZE);
    const corners = hexCorners(x, y, HEX_SIZE - 0.5);
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath();
    ctx.fillStyle = TERRAIN[hex.terrain].color;
    ctx.fill();

    // Territory tint and borders
    if (hex.owner !== null) {
      const owner = settlementById.get(hex.owner);
      if (owner) {
        const myFactionId = owner.factionId;
        const color = factionColor(myFactionId);

        // Fill territory tint
        ctx.fillStyle = color + '30';
        ctx.fill();

        // Contiguous borders: check each neighbor direction
        const dirToEdge = [0, 5, 4, 3, 2, 1];
        ctx.save();
        ctx.lineCap = 'round';

        for (let d = 0; d < 6; d++) {
          const [dq, dr] = HEX_DIRS[d];
          const nHex = world.hexes.get(key(hex.q + dq, hex.r + dr));
          let sameFaction = false;
          if (nHex && nHex.owner !== null) {
            const nOwner = settlementById.get(nHex.owner);
            if (nOwner && nOwner.factionId === myFactionId) {
              sameFaction = true;
            }
          }

          const e = dirToEdge[d];
          if (!sameFaction) {
            // Draw thick contiguous border edge
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
          } else {
            // Draw very faint internal grid boundary
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
            ctx.lineWidth = 0.5;
          }
          ctx.beginPath();
          ctx.moveTo(corners[e][0], corners[e][1]);
          ctx.lineTo(corners[(e + 1) % 6][0], corners[(e + 1) % 6][1]);
          ctx.stroke();
        }
        ctx.restore();
      }
    } else {
      // Wilderness standard faint grid
      ctx.strokeStyle = '#00000022';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i][0], corners[i][1]);
      ctx.closePath();
      ctx.stroke();
    }

    // Burn marker overlay
    if (hex.burnTicks && hex.burnTicks > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fill();
      ctx.fillStyle = 'rgba(230, 92, 23, 0.3)';
      ctx.fill();
      ctx.fillStyle = 'rgba(40, 40, 40, 0.5)';
      for (let p = 0; p < 2; p++) {
        const t = (world.tick + p * 20 + (hex.q * 13 + hex.r * 7)) % 40;
        const scale = t / 40;
        const px = x + Math.sin((hex.q * 3 + hex.r * 5) + scale * 3) * 3;
        const py = y - scale * 12;
        const r = 1 + scale * 2.5;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Selection highlight
    if (selected && selected.q === hex.q && selected.r === hex.r) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Building marker
    if (hex.building) {
      ctx.fillStyle = '#2c2c2c';
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = '#e8d8a0';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = '#2c2c2c';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(hex.building[0], x, y + 2.5);
    }

    // Bridge marker
    if (hex.terrain === 'RIVER' && hex.hasBridge) {
      ctx.save();
      let angle = 0;
      for (let i = 0; i < HEX_DIRS.length; i++) {
        const [dq, dr] = HEX_DIRS[i];
        const nKey = key(hex.q + dq, hex.r + dr);
        const n = world.hexes.get(nKey);
        if (n && (n.hasRoad || settlementKeys.has(nKey))) {
          angle = (i * Math.PI) / 3;
          break;
        }
      }
      ctx.translate(x, y);
      ctx.rotate(angle);

      // Bridge supports (stone dark casing)
      ctx.fillStyle = '#2c2214';
      ctx.fillRect(-10, -5, 20, 10);

      // Bridge deck (wooden planks)
      ctx.fillStyle = '#b38b59';
      ctx.fillRect(-12, -3, 24, 6);

      // Rails
      ctx.fillStyle = '#6e4f2b';
      ctx.fillRect(-10, -4.5, 20, 1.2);
      ctx.fillRect(-10, 3.3, 20, 1.2);

      ctx.restore();
    }

    // Resource pile dots (size by amount)
    const total = hex.resources.food + hex.resources.timber + hex.resources.stone + hex.resources.ore;
    if (total > 4) {
      const rPile = Math.min(6, 1.5 + total / 25);
      ctx.beginPath();
      ctx.arc(x + HEX_SIZE * 0.42, y + HEX_SIZE * 0.42, rPile, 0, Math.PI * 2);
      ctx.fillStyle = '#f5e6b8';
      ctx.fill();
      ctx.strokeStyle = '#00000055';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  // Roads: connect adjacent road hexes (and roads to settlements).
  // Two passes: dark casing then bright surface, so highways read clearly.
  const roadSegments = [];
  for (const hex of world.hexes.values()) {
    if (!hex.hasRoad) continue;
    const { x, y } = hexToPixel(hex.q, hex.r, HEX_SIZE);
    let linked = false;
    for (let i = 0; i < HEX_DIRS.length; i++) {
      const [dq, dr] = HEX_DIRS[i];
      const nKey = key(hex.q + dq, hex.r + dr);
      const n = world.hexes.get(nKey);
      const connects = (n && n.hasRoad) || settlementKeys.has(nKey);
      if (!connects) continue;
      linked = true;
      if (n && n.hasRoad && i >= 3) continue; // draw each road-road edge once
      const { x: nx, y: ny } = hexToPixel(hex.q + dq, hex.r + dr, HEX_SIZE);
      roadSegments.push([x, y, nx, ny]);
    }
    if (!linked) roadSegments.push([x, y, x, y]); // stub: dot
  }
  ctx.lineCap = 'round';
  for (const [w_, color] of [[6, '#3a2d1a'], [3.5, '#c89858']]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w_;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of roadSegments) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  // Settlements
  for (const s of world.settlements) {
    const { x, y } = hexToPixel(s.q, s.r, HEX_SIZE);
    const tierR = s.tier === 'VILLAGE' ? 8 : s.tier === 'TOWN' ? 11 : 14;

    // Drop shadow glow for settlements
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1.5;
    ctx.shadowOffsetY = 1.5;

    ctx.beginPath();
    ctx.arc(x, y, tierR, 0, Math.PI * 2);
    ctx.fillStyle = factionColor(s.factionId);
    ctx.fill();
    ctx.strokeStyle = '#0e131a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner accent ring
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, tierR - 2.5), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = '#0e131a';
    ctx.font = `bold ${tierR - 1}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(s.tier === 'VILLAGE' ? 'v' : s.tier === 'TOWN' ? 'T' : 'C', x, y + tierR * 0.32);

    ctx.fillStyle = '#ffffff';
    ctx.font = "bold 9px sans-serif";
    ctx.strokeStyle = '#0e131a';
    ctx.lineWidth = 3;
    ctx.strokeText(`${s.name} (${Math.round(s.population)})`, x, y - tierR - 5);
    ctx.fillText(`${s.name} (${Math.round(s.population)})`, x, y - tierR - 5);

    // Siege indicator: pulsing red ring + smoke particles
    if (s.siegeHp != null) {
      const pulse = 2 + ((world.tick % 30) / 30) * 4;
      ctx.beginPath();
      ctx.arc(x, y, tierR + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Smoke particles
      ctx.fillStyle = 'rgba(80, 80, 80, 0.45)';
      for (let p = 0; p < 3; p++) {
        const t = (world.tick + p * 15) % 45;
        const scale = t / 45;
        const px = x + Math.sin(p * 2 + scale * 4) * 4;
        const py = y - tierR - scale * 22;
        const r = 2.5 + scale * 4;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Agents (smoothed display positions)
  if (displayPos.size > world.agents.length * 2 + 50) {
    const live = new Set(world.agents.map(a => a.id));
    for (const id of displayPos.keys()) if (!live.has(id)) displayPos.delete(id);
  }
  for (const a of world.agents) {
    const target = hexToPixel(a.q, a.r, HEX_SIZE);
    const { x, y } = smoothPos(a, target.x, target.y);
    const color = factionColor(a.factionId);

    const currentHex = world.hexes.get(key(a.q, a.r));
    const isOnWater = currentHex && currentHex.terrain === 'WATER';

    if (isOnWater) {
      // Boat shape
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 2);
      ctx.lineTo(x + 5, y + 2);
      ctx.lineTo(x + 3.5, y + 5);
      ctx.lineTo(x - 3.5, y + 5);
      ctx.closePath();
      ctx.fillStyle = '#ebd2b0';
      ctx.fill();
      ctx.strokeStyle = '#3a2d1a';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Mast
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x, y - 4);
      ctx.strokeStyle = '#3a2d1a';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Sail
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x - 3.5, y + 1);
      ctx.lineTo(x, y + 1);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffffaa';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    } else if (a.type === 'villager') {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    } else if (a.type === 'caravan') {
      ctx.fillStyle = color;
      ctx.fillRect(x - 5, y - 3.5, 10, 7);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 5, y - 3.5, 10, 7);
    } else if (a.type === 'soldier') {
      // Battle halo for engaged soldiers
      if (a.engaged) {
        const pulse = 0.5 + 0.5 * Math.sin(world.tick * 0.3);
        ctx.beginPath();
        ctx.arc(x, y + 1, 11 + pulse * 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(231, 76, 60, 0.25)';
        ctx.fill();
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw crossed swords above head
        ctx.save();
        ctx.fillStyle = '#e74c3c';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚔', x, y - 9);
        ctx.restore();
      }

      // Draw Shield shape
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 6);
      ctx.lineTo(x + 6, y - 6);
      ctx.lineTo(x + 6, y + 1);
      ctx.quadraticCurveTo(x + 6, y + 7, x, y + 11);
      ctx.quadraticCurveTo(x - 6, y + 7, x - 6, y + 1);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Embossed metal cross inside the shield
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 6);
      ctx.moveTo(x - 3, y - 1);
      ctx.lineTo(x + 3, y - 1);
      ctx.strokeStyle = '#ffffffdd';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else { // settler
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  ctx.restore();

  // Drifting clouds (rendered in screen-space, after restoring camera transformations)
  const nowTime = performance.now();
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const speedX = 0.006 + i * 0.003;
    const speedY = 0.003;
    const cx = ((nowTime * speedX + i * 400) % (canvas.width + 500)) - 250;
    const cy = ((nowTime * speedY + i * 250) % (canvas.height + 400)) - 200;

    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.arc(cx + 35, cy - 12, 40, 0, Math.PI * 2);
    ctx.arc(cx + 60, cy + 10, 35, 0, Math.PI * 2);
    ctx.arc(cx - 30, cy + 5, 35, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
