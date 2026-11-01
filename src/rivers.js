// The rivers lie lower than the city: a bank slopes from street level down to the water's edge, the water surface is below the
// street, and the bed is deeper still. Pure data + one lookup, shared by terrain.js (the car rides the bank), structures.js (pier
// bases), riverbanks.js (the meshes) and boats.js. `rivers` is city.rivers: [{ half, pts: [[x, z], ...] }].
export const WATER_Y = -1.6, BED_Y = -2.5, BANK_W = 7, EDGE_Y = -2.2;

export function createRiverField(rivers) {
  const CELL = 80, key = (cx, cz) => (cx + 4000) * 8009 + cz + 4000, grid = new Map(), segs = [];
  (rivers || []).forEach((r, ri) => {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], m = r.half + BANK_W + 2;
      const s = { ax: a[0], az: a[1], dx: b[0] - a[0], dz: b[1] - a[1], half: r.half, ri };
      s.l2 = s.dx * s.dx + s.dz * s.dz || 1; segs.push(s);
      const x0 = Math.floor((Math.min(a[0], b[0]) - m) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + m) / CELL);
      const z0 = Math.floor((Math.min(a[1], b[1]) - m) / CELL), z1 = Math.floor((Math.max(a[1], b[1]) + m) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const k = key(cx, cz), l = grid.get(k); if (l) l.push(s); else grid.set(k, [s]); }
    }
  });
  const EMPTY = [];
  // signed distance from the water's edge to (x, z): negative in the channel, positive on land (the nearest river wins); +Infinity when no river is near
  function edgeDist(x, z, skip = -1) {
    let best = Infinity;
    for (const s of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY) {
      if (s.ri === skip) continue;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.l2));
      const d = Math.hypot(x - s.ax - s.dx * t, z - s.az - s.dz * t) - s.half;
      if (d < best) best = d;
    }
    return best;
  }
  // height of the ground (the bank and the bed) at (x, z); 0 away from the rivers
  function groundY(x, z) {
    const e = edgeDist(x, z);
    if (e >= BANK_W) return 0;
    if (e <= 0) return EDGE_Y + (BED_Y - EDGE_Y) * Math.min(1, -e / 6);
    const t = e / BANK_W, k = t * t * (3 - 2 * t);
    return EDGE_Y * (1 - k);
  }
  return { edgeDist, groundY, segs };
}
