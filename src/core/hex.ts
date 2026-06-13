// Axial hex coordinate math (pointy-top).
export const HEX_DIRS: Array<[number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const key = (q: number, r: number): string => q + ',' + r;

export function neighbors(q: number, r: number): Array<[number, number]> {
  return HEX_DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

export function distance(q1: number, r1: number, q2: number, r2: number): number {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

// All hexes within `radius` of center (inclusive).
export function range(q: number, r: number, radius: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push([q + dq, r + dr]);
    }
  }
  return out;
}

// Pointy-top hex to pixel.
export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r),
    y: size * (3 / 2 * r),
  };
}

export function pixelToHex(x: number, y: number, size: number): { q: number; r: number } {
  const qf = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
  const rf = (2 / 3 * y) / size;
  return roundHex(qf, rf);
}

function roundHex(qf: number, rf: number): { q: number; r: number } {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexCorners(cx: number, cy: number, size: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts;
}
